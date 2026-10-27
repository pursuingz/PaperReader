import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { PDFDocument, PageSizes } from 'pdf-lib'
import type { AgentExportSpec, AgentReceipt } from '../shared/agentTypes'
import type { AutomationRenderPayload, AutomationRenderResult } from '../shared/renderJobTypes'
import type { CanvasExportOptions, CanvasNotebook, CanvasRegion, NotebookPage } from '../shared/notebookTypes'
import type { MindMapDocument } from '../shared/diagramTypes'
import type { Paper, PaperState, PaperSummary, PdfInk, ReadingMarks } from '../shared/types'
import type { PaperStore } from './storage'
import type { NotebookStore } from './notebookStore'
import type { DiagramStore } from './diagramStore'
import { validateAgentExport } from './agentValidation'
import { validId } from './validation'
import { CanvasStore } from './canvasStore'
import { inspectCanvasImage } from './canvasValidation'
import { buildAnnotatedPdf } from './annotatedPdfExport'
import { formatReadingExport, readingExportFileName } from './readingExport'
import { canvasExportPlan } from '../shared/canvasViewport'
import { assertSavedCanvasExport } from './infiniteExportScope'
import { notebookConnection, notebookContentBounds } from '../renderer/src/notebookGeometry'
import { computeMindMapLayout } from './mindMapGeometry'
import { validateMindMapDocument } from './diagramValidation'

export interface AutomationFileExportDependencies {
  store: PaperStore
  notebookStore: Pick<NotebookStore, 'load' | 'flush'>
  diagramStore: Pick<DiagramStore, 'loadMap' | 'flush'>
  generatedNotes: { markdown(paperId: string, draftId: string): Promise<string> }
  renderJobs: { run(payload: AutomationRenderPayload, signal?: AbortSignal): Promise<AutomationRenderResult> }
  chooseDirectory(signal: AbortSignal): Promise<string | null>
  registerArtifacts?(paperId:string,paths:string[]):Promise<string>
  readCanvasImage?(paperId: string, assetId: string): Promise<{ bytes: Uint8Array }>
  resolveCanvasRegion?(paperId: string, boardId: string, area: 'viewport' | 'region', signal: AbortSignal): Promise<CanvasRegion | null>
}
interface SavedExport {
  paper: Paper
  bytes?: Uint8Array
  state?: PaperState
  marks?: ReadingMarks
  ink?: PdfInk
  summary?: PaperSummary | null
  notebook?: CanvasNotebook
  map?: MindMapDocument
  draft?: string
  assets?: Record<string, string>
}
interface Output { name: string; bytes: Uint8Array }
const MAX_OUTPUT = 256 * 1024 * 1024
function cancelled(signal: AbortSignal): void { if (signal.aborted) throw new Error('Export cancelled') }
function contains(root: string, path: string): boolean { const rel = relative(resolve(root), resolve(path)); return !rel || !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) }
function samePath(a: string, b: string): boolean { return process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b) }
function sha(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
function fingerprint(value: unknown): string { return createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) => item instanceof Uint8Array ? { sha256: sha(item), byteLength: item.length } : item)).digest('hex') }
function titleLine(title: string): string { return title.replace(/[\r\n\t]/g, ' ').trim() }
function fileStem(title: string): string { return readingExportFileName(title).replace(/-reading-notes\.md$/, '').slice(0, 80) }
function textOutput(name: string, markdown: string): Output { return { name, bytes: new TextEncoder().encode(markdown) } }

export function automationMindMapMarkdown(map: MindMapDocument, title = 'Mind map'): string {
  validateMindMapDocument(map, map.paperId)
  const lines = [`# ${titleLine(title)} — Mind map`, '']
  const visit = (parentId: string | null, depth: number): void => {
    for (const node of map.nodes.filter(item => item.parentId === parentId).sort((a, b) => a.order - b.order)) {
      const text = node.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]#!|]/g, '\\$&').replace(/\r?\n/g, '<br>')
      lines.push(`${'  '.repeat(depth)}- ${text}`)
      visit(node.id, depth + 1)
    }
  }
  visit(null, 0)
  return lines.join('\n') + '\n'
}

export class AutomationFileExportService {
  private readonly directories = new WeakMap<AbortSignal, Promise<string>>()
  private readonly paperFolders = new WeakMap<AbortSignal, Map<string, Promise<string>>>()
  private readonly readImage: NonNullable<AutomationFileExportDependencies['readCanvasImage']>
  constructor(private readonly dependencies: AutomationFileExportDependencies) {
    const assets = new CanvasStore(dependencies.store)
    this.readImage = dependencies.readCanvasImage ?? ((paperId, assetId) => assets.readImage(paperId, assetId))
  }
  private async protectedDirectories(): Promise<string[]> {
    const requested = [this.dependencies.store.root, ...await this.dependencies.store.getManagedPdfDirectories()]
    const all = new Set(requested.map(path => resolve(path)))
    for (const path of requested) {
      try { all.add(await realpath(path)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    return [...all]
  }
  private async validateDirectory(directory: string): Promise<string> {
    if (typeof directory !== 'string' || !isAbsolute(directory) || directory.includes('\0')) throw new Error('Choose an existing output folder outside internal data and managed Papers')
    const canonical = await realpath(directory)
    if (!(await lstat(canonical)).isDirectory()) throw new Error('Choose an existing output directory')
    if ((await this.protectedDirectories()).some(root => contains(root, directory) || contains(root, canonical))) throw new Error('Choose an export folder outside internal data and every managed Papers directory')
    return canonical
  }
  private outputDirectory(signal: AbortSignal): Promise<string> {
    let selection = this.directories.get(signal)
    if (!selection) {
      selection = Promise.resolve().then(async () => {
        cancelled(signal)
        const directory = await this.dependencies.chooseDirectory(signal)
        cancelled(signal)
        if (!directory) throw new Error('Export folder selection cancelled')
        return this.validateDirectory(directory)
      })
      this.directories.set(signal, selection)
    }
    return selection
  }
  private paperFolder(signal: AbortSignal, directory: string, paper: Paper): Promise<string> {
    let scope = this.paperFolders.get(signal)
    if (!scope) { scope = new Map(); this.paperFolders.set(signal, scope) }
    let folder = scope.get(paper.id)
    if (!folder) {
      folder = Promise.resolve().then(async () => {
        if (!samePath(await this.validateDirectory(directory), directory)) throw new Error('Export folder changed; select a new directory')
        for (let attempt = 0; attempt < 8; attempt++) {
          cancelled(signal)
          const candidate = join(directory, `${fileStem(paper.title)}--${paper.id}--${randomUUID()}`)
          try { await mkdir(candidate); return candidate } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
        }
        throw new Error('Could not create an exclusive paper export folder')
      })
      scope.set(paper.id, folder)
    }
    return folder
  }
  private selectedPages(notebook: CanvasNotebook, spec: AgentExportSpec): NotebookPage[] {
    if (spec.boardIds === undefined) return notebook.pages
    if (!spec.boardIds.length || new Set(spec.boardIds).size !== spec.boardIds.length) throw new Error('Choose at least one distinct Canvas board')
    const pages = spec.boardIds.map(id => notebook.pages.find(page => page.id === id))
    if (pages.some(page => !page)) throw new Error('A selected Canvas board is missing; refresh the selection')
    return pages as NotebookPage[]
  }
  private async snapshot(paperId: string, spec: AgentExportSpec): Promise<SavedExport> {
    const store = this.dependencies.store
    const [papers, metadata] = await Promise.all([store.list(), store.loadLibraryMetadata()])
    const paper = papers.find(item => item.id === paperId && !item.isDemo)
    if (!paper) throw new Error('Paper not found. Import a local PDF first.')
    const saved: SavedExport = { paper: { ...paper, ...metadata[paperId] } }
    if (spec.content === 'original' || spec.content === 'annotated') saved.bytes = await store.readPdf(paperId)
    if (spec.content === 'text' || spec.content === 'reading-record') saved.state = await store.loadState(paperId)
    if (spec.content === 'annotated' || spec.content === 'reading-record') [saved.marks, saved.ink] = await Promise.all([store.loadMarks(paperId), store.loadPdfInk(paperId)])
    if (spec.content === 'summary' || spec.content === 'reading-record') saved.summary = await store.loadSummary(paperId)
    if (spec.content === 'reading-draft' && spec.draftId) saved.draft = await this.dependencies.generatedNotes.markdown(paperId, spec.draftId)
    if (spec.content === 'mind-map') saved.map = await this.dependencies.diagramStore.loadMap(paperId)
    if (spec.content === 'canvas') {
      saved.notebook = await this.dependencies.notebookStore.load(paperId)
      saved.assets = {}
      for (const page of this.selectedPages(saved.notebook, spec)) for (const object of page.objects) if (object.type === 'image' && saved.assets[object.assetId] === undefined) saved.assets[object.assetId] = sha((await this.readImage(paperId, object.assetId)).bytes)
    }
    return structuredClone(saved)
  }
  private async prepare(paperId: string, signal: AbortSignal): Promise<void> {
    cancelled(signal)
    const result = await this.dependencies.renderJobs.run({ kind: 'prepare', paperId }, signal)
    if (result.kind !== 'prepare') throw new Error('The editor could not prepare a saved export snapshot')
    await Promise.all([this.dependencies.store.flush(), this.dependencies.notebookStore.flush(), this.dependencies.diagramStore.flush()])
    cancelled(signal)
  }
  private unavailable(saved: SavedExport, spec: AgentExportSpec): AgentReceipt | null {
    const base = { paperId: saved.paper.id, kind: 'export', title: `${saved.paper.title} — ${spec.content}` }
    if (spec.content === 'summary' && !saved.summary) return { ...base, status: 'unavailable', detail: 'No complete saved Summary is available.' }
    if (spec.content === 'text' && !saved.state?.note.trim()) return { ...base, status: 'unavailable', detail: 'No saved Text notes are available.' }
    if (spec.content === 'reading-draft' && !spec.draftId) return { ...base, status: 'needs-review', detail: 'Choose a saved independent reading-note draft first.' }
    if (spec.content === 'mind-map' && !saved.map?.nodes.length) return { ...base, status: 'unavailable', detail: 'No saved Mind map is available.' }
    return null
  }
  private async rasterImages(images: Uint8Array[], expected: Array<{ width: number; height: number }>, tolerance = 0): Promise<Uint8Array[]> {
    if (!Array.isArray(images) || images.length !== expected.length || !images.length || images.length > 128) throw new Error('Rendered export tile count does not match the complete plan')
    let total = 0
    const decoder = await PDFDocument.create(), snapshots: Uint8Array[] = []
    for (const [index, image] of images.entries()) {
      if (!(image instanceof Uint8Array) || (total += image.length) > 64 * 1024 * 1024) throw new Error('Rendered export image limit exceeded')
      const snapshot = new Uint8Array(image), info = inspectCanvasImage(snapshot)
      if (info.mimeType !== 'image/png' || Math.abs(info.width - expected[index].width) > tolerance || Math.abs(info.height - expected[index].height) > tolerance) throw new Error(`Rendered PNG tile ${index + 1} dimensions do not match the complete export`)
      try { await decoder.embedPng(snapshot) } catch { throw new Error(`Rendered PNG tile ${index + 1} could not be decoded`) }
      snapshots.push(snapshot)
    }
    return snapshots
  }
  private async canvasOptions(paperId: string, pages: NotebookPage[], spec: AgentExportSpec, signal: AbortSignal): Promise<CanvasExportOptions[] | null> {
    const options: CanvasExportOptions[] = []
    for (const page of pages) {
      const area = spec.area ?? 'all'
      const region = area === 'all' ? notebookContentBounds(page) : await this.dependencies.resolveCanvasRegion?.(paperId, page.id, area, signal)
      if (!region) return null
      const item: CanvasExportOptions = { format: spec.format as 'png' | 'pdf', scope: area === 'region' ? 'selection' : area, region: structuredClone(region) }
      await assertSavedCanvasExport(page, item, id => this.readImage(paperId, id))
      if (page.diagram.connections.some(connection => !notebookConnection(page, connection))) throw new Error('Canvas has a missing connection endpoint; restore or remove it before exporting')
      options.push(item)
    }
    return options
  }
  private async build(saved: SavedExport, spec: AgentExportSpec, options: CanvasExportOptions[] | null, signal: AbortSignal): Promise<Output[]> {
    const paper = saved.paper, name = fileStem(paper.title)
    if (spec.content === 'original') return [{ name: `${name}-original.pdf`, bytes: saved.bytes! }]
    if (spec.content === 'annotated') return [{ name: `${name}-annotated.pdf`, bytes: await buildAnnotatedPdf(saved.bytes!, saved.marks!, saved.ink!) }]
    if (spec.content === 'text') return [textOutput(`${name}-text.md`, `# ${titleLine(paper.title)} — Text notes\n\n${saved.state!.note}\n`)]
    if (spec.content === 'reading-draft') return [textOutput(`${name}-reading-draft.md`, saved.draft!)]
    if (spec.content === 'reading-record') return [textOutput(`${name}-reading-record.md`, formatReadingExport(paper, saved.state!, saved.marks!, saved.summary!, saved.ink!))]
    if (spec.content === 'summary') {
      const summary = saved.summary!
      return [textOutput(`${name}-summary.md`, [`# ${titleLine(paper.title)} — Summary`, 'AI-generated summary. Page references do not establish factual correctness.', `Model: ${titleLine(summary.model)} · Generated: ${summary.createdAt}`, ...summary.sections.flatMap(section => [`## ${titleLine(section.title)}`, section.content, `Source pages: ${section.pages.join(', ') || 'none'}`])].join('\n\n') + '\n')]
    }
    if (spec.content === 'canvas') {
      const outputs: Output[] = [], pages = this.selectedPages(saved.notebook!, spec)
      let total = 0
      for (const [index, page] of pages.entries()) {
        cancelled(signal)
        const option = options![index], plan = canvasExportPlan(option)
        const rendered = await this.dependencies.renderJobs.run({ kind: 'canvas', paperId: paper.id, page, options: option }, signal)
        if (rendered.kind !== 'canvas') throw new Error('Canvas renderer returned another artifact')
        const images = await this.rasterImages(rendered.images, plan)
        let bytes = images[0]
        if (spec.format === 'pdf') {
          const pdf = await PDFDocument.create()
          for (const [tileIndex, image] of images.entries()) {
            const embedded = await pdf.embedPng(image), region = plan[tileIndex].region
            pdf.addPage([region.width, region.height]).drawImage(embedded, { x: 0, y: 0, width: region.width, height: region.height })
          }
          bytes = await pdf.save()
        }
        if ((total += bytes.length) > MAX_OUTPUT) throw new Error('Canvas batch exceeds the export byte limit; export fewer boards')
        outputs.push({ name: `canvas-${index + 1}-${fileStem(page.name)}.${spec.format}`, bytes })
      }
      return outputs
    }
    const map = saved.map!
    if (spec.format === 'md') return [textOutput(`${name}-mind-map.md`, automationMindMapMarkdown(map, paper.title))]
    const layout = computeMindMapLayout(map), expected: Array<{ width: number; height: number }> = []
    if (spec.format === 'png') expected.push({ width: layout.width, height: layout.height })
    else for (let y = 0; y < layout.height; y += 1123) for (let x = 0; x < layout.width; x += 794) expected.push({ width: Math.min(794, layout.width - x), height: Math.min(1123, layout.height - y) })
    const rendered = await this.dependencies.renderJobs.run({ kind: 'mind-map', paperId: paper.id, map, format: spec.format as 'png' | 'pdf' }, signal)
    if (rendered.kind !== 'mind-map') throw new Error('Mind map renderer returned another artifact')
    const images = await this.rasterImages(rendered.images, expected, 1)
    if (spec.format === 'png') return [{ name: `${name}-mind-map.png`, bytes: images[0] }]
    const pdf = await PDFDocument.create(), [width, height] = PageSizes.A4, scale = Math.min(width / 794, height / 1123)
    for (const [index, image] of images.entries()) {
      const embedded = await pdf.embedPng(image), tile = expected[index]
      pdf.addPage(PageSizes.A4).drawImage(embedded, { x: 0, y: height - tile.height * scale, width: tile.width * scale, height: tile.height * scale })
    }
    return [{ name: `${name}-mind-map.pdf`, bytes: await pdf.save() }]
  }
  async exportContent(paperId: string, rawSpec: AgentExportSpec, signal: AbortSignal): Promise<AgentReceipt> {
    validId(paperId); validateAgentExport(rawSpec); cancelled(signal)
    const spec = structuredClone(rawSpec)
    if (spec.content !== 'canvas' && (spec.boardIds !== undefined || spec.area !== undefined) || spec.content !== 'reading-draft' && spec.draftId !== undefined) throw new Error('Export selection fields do not match the requested content')
    await this.prepare(paperId, signal)
    const saved = await this.snapshot(paperId, spec), unavailable = this.unavailable(saved, spec)
    if (unavailable) return unavailable
    const options = spec.content === 'canvas' ? await this.canvasOptions(paperId, this.selectedPages(saved.notebook!, spec), spec, signal) : null
    if (spec.content === 'canvas' && !options) return { paperId, kind: 'export', title: `${saved.paper.title} — Canvas`, status: 'needs-review', detail: 'Choose an actual viewport or region on each selected Canvas board, or export all saved content.' }
    const directory = await this.outputDirectory(signal), outputs = await this.build(saved, spec, options, signal)
    if (!outputs.length || outputs.reduce((sum, output) => sum + output.bytes.length, 0) > MAX_OUTPUT) throw new Error('Export has no output or exceeds the bounded byte limit')
    await this.prepare(paperId, signal)
    if (fingerprint(await this.snapshot(paperId, spec)) !== fingerprint(saved)) throw new Error('Saved content changed while exporting. Existing files and edits were preserved; retry from the new revision.')
    cancelled(signal)
    const folder = await this.paperFolder(signal, directory, saved.paper), names: string[] = []
    try {
      for (const output of outputs) {
        cancelled(signal)
        if (!samePath(await this.validateDirectory(folder), folder) || (await lstat(folder)).isSymbolicLink()) throw new Error('Export folder changed while saving')
        const extension = output.name.slice(output.name.lastIndexOf('.')), stem = output.name.slice(0, -extension.length)
        let written = false
        for (let attempt = 0; attempt < 8; attempt++) {
          const name = `${stem}--${randomUUID()}${extension}`
          try { await writeFile(join(folder, name), output.bytes, { flag: 'wx', mode: 0o600 }); names.push(join(basename(folder), name)); written = true; break } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
        }
        if (!written) throw new Error('Could not create an exclusive export file')
      }
    } catch (error) {
      if (names.length) throw new Error(`Export stopped after ${names.length} saved artifact(s), preserved in ${basename(folder)}. ${error instanceof Error ? error.message : 'Save failed'}`)
      throw error
    }
    let artifactId:string|undefined
    if(this.dependencies.registerArtifacts){try{artifactId=await this.dependencies.registerArtifacts(paperId,names.map(name=>join(folder,basename(name))))}catch{return {paperId,kind:'export',title:`${saved.paper.title} — ${spec.content}`,status:'needs-review',fileName:names.length===1?basename(names[0]):basename(folder),detail:`Saved ${names.length} artifact(s), but their openable links could not be recorded. Files were preserved in ${basename(folder)}: ${names.join(', ')}`}}}
    return { paperId, kind: 'export', title: `${saved.paper.title} — ${spec.content}`, status: 'succeeded', ...(artifactId?{id:artifactId}:{}), fileName: names.length === 1 ? basename(names[0]) : basename(folder), detail: `Saved ${names.length} artifact(s) in the selected output folder: ${names.join(', ')}` }
  }
}
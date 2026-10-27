import { mkdir, readFile, writeFile, rename, copyFile, readdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { LibraryMetadata, LibraryOrganization, Paper, PaperMetadata, PaperState, PaperSummary, PdfInk, ReadingMarks } from '../shared/types'
import { validId, validateMarks, validateState, validateSummary } from './validation'
import { validateAssignment, validateCategoryId, validateCategoryName, validateLibraryOrganization, validatePdfInk } from './workflowValidation'
import { normalizePaperMetadata, validateLibraryMetadata } from './metadataValidation'
import { ManagedPaperFiles } from './managedPaperFiles'
import type { ManagedConsolidationResult, ManagedDirectoryStatus, ManagedPaperFileStatus, ManagedPaperImportOptions, ManagedPaperImportResult, ManagedScanOptions, ManagedScanResult } from '../shared/managedPaperTypes'

function validateLibrary(value: unknown): void {
  if (!Array.isArray(value)) throw new Error('Invalid library')
  for (const paper of value) {
    if (!paper || typeof paper !== 'object') throw new Error('Invalid paper')
    validId(paper.id)
    if (typeof paper.title !== 'string' || typeof paper.fileName !== 'string' || typeof paper.category !== 'string' || typeof paper.importedAt !== 'string') throw new Error('Invalid paper')
  }
}

export class PaperStore {
  private tail: Promise<unknown> = Promise.resolve()
  private readonly managed: ManagedPaperFiles
  constructor(readonly root: string, options: { managedDirectory?: string } = {}) {
    this.managed = new ManagedPaperFiles(root, {
      readPapers: () => this.readStoredLibrary(),
      savePapers: (papers, signal) => this.atomicJson(join(this.root, 'library.json'), papers, signal),
      atomicJson: (path, value, signal) => this.atomicJson(path, value, signal)
    }, options.managedDirectory)
  }
  async flush(): Promise<void> { await this.tail }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation); this.tail = next.catch(() => {}); return next
  }
  async atomicJson(path: string, value: unknown, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('Request cancelled')
    const temporary = `${path}.tmp-${randomUUID()}`
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
    try { await copyFile(path, `${path}.backup-${Date.now()}-${randomUUID()}`) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    // Cancellation before the commit preserves the previous file; retain temporary files for recovery.
    if (signal?.aborted) throw new Error('Request cancelled')
    await rename(temporary, path)
  }
  async readJson<T>(path: string, validate: (value: unknown) => void): Promise<T> {
    try { const value: unknown = JSON.parse(await readFile(path, 'utf8')); validate(value); return value as T } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error
      const directory = join(path, '..'); const prefix = basename(path) + '.backup-'
      const backups = (await readdir(directory)).filter(name => name.startsWith(prefix)).sort().reverse()
      for (const backup of backups) {
        try { const value: unknown = JSON.parse(await readFile(join(directory, backup), 'utf8')); validate(value); return value as T } catch { /* Keep damaged files and inspect older backups. */ }
      }
      throw new Error('Local data is damaged. Existing files were preserved for recovery.')
    }
  }
  private paperDirectory(id: string): string { validId(id); return join(this.root, 'papers', id) }
  async list(): Promise<Paper[]> {
    await this.tail
    try { return await this.readJson<Paper[]>(join(this.root, 'library.json'), validateLibrary) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }
  private async requirePaper(id: string): Promise<Paper> {
    validId(id); const paper = (await this.list()).find(item => item.id === id)
    if (!paper) throw new Error('Paper not found. Import a local PDF first.'); return paper
  }
  private async requireStoredPaper(id: string): Promise<void> {
    let papers: Paper[] = []
    try { papers = await this.readJson<Paper[]>(join(this.root, 'library.json'), validateLibrary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (!papers.some(paper => paper.id === id)) throw new Error('Paper not found. Import a local PDF first.')
  }
  private async readStoredLibrary(): Promise<Paper[]> {
    try { return await this.readJson<Paper[]>(join(this.root, 'library.json'), validateLibrary) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error
    }
  }
  async getManagedDirectory(): Promise<ManagedDirectoryStatus> {
    await this.tail
    return this.managed.getDirectory()
  }
  async getManagedPdfDirectories(): Promise<string[]> {
    await this.tail
    return this.managed.protectedDirectories()
  }
  async configureManagedDirectory(directory: string): Promise<ManagedDirectoryStatus> {
    return this.serial(() => this.managed.configure(directory))
  }
  async importManagedPdf(source: string, options: ManagedPaperImportOptions = {}): Promise<ManagedPaperImportResult> {
    const snapshot = { ...options, identifiers: options.identifiers ? { ...options.identifiers } : undefined }
    return this.serial(() => this.managed.importFile(source, snapshot))
  }
  async importManagedBytes(bytes: Uint8Array, fileName: string, options: ManagedPaperImportOptions = {}): Promise<ManagedPaperImportResult> {
    if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 200 * 1024 * 1024) throw new Error('Choose valid PDF bytes smaller than 200 MB')
    const snapshot = new Uint8Array(bytes), settings = { ...options, identifiers: options.identifiers ? { ...options.identifiers } : undefined }
    return this.serial(() => this.managed.importBytes(snapshot, fileName, settings))
  }
  async importPdf(source: string): Promise<Paper> {
    return this.serial(async () => {
      if ((await this.managed.getDirectory()).configured) {
        const result = await this.managed.importFile(source)
        if (!result.paper) throw new Error('Select whether to import a distinct PDF version')
        return result.paper
      }
      const metadata = await stat(source)
      if (!metadata.isFile() || metadata.size > 200 * 1024 * 1024) throw new Error('Choose a PDF smaller than 200 MB')
      const bytes = await readFile(source)
      if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Selected file is not a PDF')
      const paper: Paper = { id: randomUUID(), title: basename(source).replace(/\.pdf$/i, ''), fileName: basename(source), importedAt: new Date().toISOString(), category: 'Imported' }
      const directory = this.paperDirectory(paper.id); await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'document.pdf'), bytes)
      const current = await this.readStoredLibrary()
      await this.atomicJson(join(this.root, 'library.json'), [...current, paper]); return paper
    })
  }
  async readPdf(id: string): Promise<Uint8Array> {
    await this.requirePaper(id)
    return (await this.managed.read(id)).bytes
  }
  async resolvePaperPath(id: string): Promise<string> {
    await this.requirePaper(id)
    return (await this.managed.read(id)).path
  }
  async getPaperFileStatus(id: string): Promise<ManagedPaperFileStatus> {
    await this.requirePaper(id)
    return this.managed.fileStatus(id)
  }
  async relinkPaperPdf(id: string, source: string): Promise<ManagedPaperFileStatus> {
    validId(id)
    return this.serial(async () => { await this.requireStoredPaper(id); return this.managed.relink(id, source) })
  }
  async consolidateLegacyPdfs(ids?: string[]): Promise<ManagedConsolidationResult> {
    const selection = ids ? [...ids] : undefined
    return this.serial(() => this.managed.consolidate(selection))
  }
  async scanManagedDirectory(options: ManagedScanOptions = {}): Promise<ManagedScanResult> {
    const snapshot = { ...options }
    return this.serial(() => this.managed.scan(snapshot))
  }
  async importScannedPdf(token: string): Promise<ManagedPaperImportResult> {
    return this.serial(() => this.managed.importToken(token))
  }
  async loadState(id: string): Promise<PaperState> {
    validId(id)
    if (id !== 'demo-workspace') await this.requirePaper(id)
    else await this.tail
    try { return await this.readJson<PaperState>(join(this.paperDirectory(id), 'state.json'), value => validateState(value, id)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { note: '', messages: [], lastPage: 1 }; throw error
    }
  }
  async saveState(id: string, state: PaperState): Promise<void> {
    validId(id); validateState(state, id)
    const snapshot = structuredClone(state)
    await this.serial(async () => {
      if (id !== 'demo-workspace') await this.requireStoredPaper(id)
      await mkdir(this.paperDirectory(id), { recursive: true })
      await this.atomicJson(join(this.paperDirectory(id), 'state.json'), { ...snapshot, messages: snapshot.messages.filter(message => !message.isDemo) })
    })
  }
  async appendTextIfUnchanged(id: string, markdown: string, expectedSha256: string, guard?: () => boolean): Promise<PaperState> {
    validId(id)
    if (guard !== undefined && typeof guard !== 'function') throw new Error('Invalid note append owner guard')
    if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Invalid reviewed Text revision hash')
    if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > 2_000_000) throw new Error('Append text must be nonempty and within the note limit')
    return this.serial(async () => {
      if (guard && !guard()) throw new Error('Note append cancelled')
      await this.requireStoredPaper(id)
      const directory = this.paperDirectory(id), path = join(directory, 'state.json')
      let current: PaperState
      try { current = await this.readJson<PaperState>(path, value => validateState(value, id)) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        let files: string[] = []
        try { files = await readdir(directory) } catch (directoryError) { if ((directoryError as NodeJS.ErrnoException).code !== 'ENOENT') throw directoryError }
        if (files.some(name => name.startsWith('state.json.backup-') || name.startsWith('state.json.tmp-') || name.startsWith('state.json.retained'))) throw new Error('The notes primary is missing. Retained recovery files were preserved; recover notes before appending.')
        current = { note: '', messages: [], lastPage: 1 }
      }
      if (createHash('sha256').update(current.note, 'utf8').digest('hex') !== expectedSha256) throw new Error('Text revision changed after review. Independent notes and the latest edits were preserved.')
      const next: PaperState = { ...current, note: current.note + (current.note.trim() ? '\n\n' : '') + markdown }
      validateState(next, id)
      await mkdir(directory, { recursive: true })
      if (guard && !guard()) throw new Error('Note append cancelled')
      await this.atomicJson(path, next)
      return structuredClone(next)
    })
  }
  async loadMarks(id: string): Promise<ReadingMarks> {
    validId(id)
    if (id !== 'demo-workspace') await this.requirePaper(id)
    else await this.tail
    try { return await this.readJson<ReadingMarks>(join(this.paperDirectory(id), 'marks.json'), validateMarks) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { highlights: [], strokes: [] }; throw error
    }
  }
  async saveMarks(id: string, marks: ReadingMarks): Promise<void> {
    validId(id); validateMarks(marks)
    const snapshot = structuredClone(marks)
    await this.serial(async () => {
      if (id !== 'demo-workspace') await this.requireStoredPaper(id)
      await mkdir(this.paperDirectory(id), { recursive: true })
      await this.atomicJson(join(this.paperDirectory(id), 'marks.json'), snapshot)
    })
  }
  async loadSummary(id: string): Promise<PaperSummary | null> {
    await this.requirePaper(id)
    try { return await this.readJson<PaperSummary>(join(this.paperDirectory(id), 'summary.json'), value => validateSummary(value, id)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error
    }
  }
  async saveSummary(id: string, summary: PaperSummary, signal?: AbortSignal): Promise<void> {
    validId(id); validateSummary(summary, id)
    const snapshot = structuredClone(summary)
    await this.serial(async () => {
      if (signal?.aborted) throw new Error('Request cancelled')
      await this.requireStoredPaper(id)
      await this.atomicJson(join(this.paperDirectory(id), 'summary.json'), snapshot, signal)
    })
  }
  // Internal readers do not await the queue: mutations call them from inside it.
  private async readStoredOrganization(): Promise<LibraryOrganization> {
    let papers: Paper[] = []
    try { papers = await this.readJson<Paper[]>(join(this.root, 'library.json'), validateLibrary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const paperIds = new Set(papers.map(paper => paper.id))
    try {
      return await this.readJson<LibraryOrganization>(join(this.root, 'library-organization.json'), value => {
        validateLibraryOrganization(value)
        if (Object.keys(value.assignments).some(id => !paperIds.has(id))) throw new Error('Invalid assignment to missing paper')
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { categories: [], assignments: {} }; throw error
    }
  }
  async loadLibraryOrganization(): Promise<LibraryOrganization> {
    await this.tail
    return this.readStoredOrganization()
  }
  private async writeOrganization(organization: LibraryOrganization): Promise<LibraryOrganization> {
    validateLibraryOrganization(organization)
    await mkdir(this.root, { recursive: true })
    await this.atomicJson(join(this.root, 'library-organization.json'), organization)
    return organization
  }
  async createCategory(name: string): Promise<LibraryOrganization> {
    const normalized = validateCategoryName(name)
    return this.serial(async () => {
      const organization = await this.readStoredOrganization()
      if (organization.categories.some(category => category.name.toLowerCase() === normalized.toLowerCase())) throw new Error('A category with this name already exists')
      organization.categories.push({ id: randomUUID(), name: normalized })
      return this.writeOrganization(organization)
    })
  }
  async renameCategory(categoryId: string, name: string): Promise<LibraryOrganization> {
    validateCategoryId(categoryId); const normalized = validateCategoryName(name)
    return this.serial(async () => {
      const organization = await this.readStoredOrganization()
      const category = organization.categories.find(item => item.id === categoryId)
      if (!category) throw new Error('Category not found')
      if (organization.categories.some(item => item.id !== categoryId && item.name.toLowerCase() === normalized.toLowerCase())) throw new Error('A category with this name already exists')
      category.name = normalized
      return this.writeOrganization(organization)
    })
  }
  async assignPaperCategory(paperId: string, categoryId: string | null): Promise<LibraryOrganization> {
    validateAssignment(paperId, categoryId)
    return this.serial(async () => {
      await this.requireStoredPaper(paperId)
      const organization = await this.readStoredOrganization()
      if (categoryId !== null && !organization.categories.some(category => category.id === categoryId)) throw new Error('Category not found')
      if (categoryId === null) delete organization.assignments[paperId]
      else organization.assignments[paperId] = categoryId
      return this.writeOrganization(organization)
    })
  }
  private async readStoredMetadata(requiredPaperId?: string): Promise<LibraryMetadata> {
    let papers: Paper[] = []
    try { papers = await this.readJson<Paper[]>(join(this.root, 'library.json'), validateLibrary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const paperIds = new Set(papers.filter(paper => !paper.isDemo).map(paper => paper.id))
    if (requiredPaperId && !paperIds.has(requiredPaperId)) throw new Error('Paper not found. Import a local PDF first.')
    try {
      return await this.readJson<LibraryMetadata>(join(this.root, 'library-metadata.json'), value => {
        validateLibraryMetadata(value)
        if (Object.keys(value).some(id => !paperIds.has(id))) throw new Error('Invalid metadata for a missing paper')
      })
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
  }
  async loadLibraryMetadata(): Promise<LibraryMetadata> {
    await this.tail
    return this.readStoredMetadata()
  }
  async savePaperMetadata(paperId: string, input: PaperMetadata): Promise<LibraryMetadata> {
    validateCategoryId(paperId)
    const snapshot = normalizePaperMetadata(input)
    return this.serial(async () => {
      // A damaged metadata file must never become a writable empty map.
      const metadata = await this.readStoredMetadata(paperId)
      const updated = { ...metadata, [paperId]: snapshot }
      validateLibraryMetadata(updated)
      await mkdir(this.root, { recursive: true })
      await this.atomicJson(join(this.root, 'library-metadata.json'), updated)
      return updated
    })
  }
  private async readStoredPdfInk(id: string): Promise<PdfInk> {
    try { return await this.readJson<PdfInk>(join(this.paperDirectory(id), 'pdf-ink.json'), validatePdfInk) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { strokes: [] }; throw error
    }
  }
  async loadPdfInk(id: string): Promise<PdfInk> {
    validateCategoryId(id); await this.requirePaper(id)
    return this.readStoredPdfInk(id)
  }
  async savePdfInk(id: string, ink: PdfInk): Promise<void> {
    validateCategoryId(id); validatePdfInk(ink)
    const snapshot = structuredClone(ink)
    await this.serial(async () => {
      await this.requireStoredPaper(id)
      // A failed load must never turn into a writable empty sidecar.
      await this.readStoredPdfInk(id)
      await mkdir(this.paperDirectory(id), { recursive: true })
      await this.atomicJson(join(this.paperDirectory(id), 'pdf-ink.json'), snapshot)
    })
  }
  async savePrivateSettings(value: unknown): Promise<void> {
    await this.serial(async () => { await mkdir(this.root, { recursive: true }); await this.atomicJson(join(this.root, 'settings.json'), value) })
  }
}


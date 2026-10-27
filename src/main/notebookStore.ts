import { lstat, mkdir, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import type { CanvasNotebook, NotebookQuoteObject } from '../shared/notebookTypes'
import type { Highlight } from '../shared/types'
import type { PaperStore } from './storage'
import type { CanvasStore } from './canvasStore'
import type { DiagramStore } from './diagramStore'
import { validateCanvasPaperId } from './canvasValidation'
import { notebookFileLimit, validateCanvasNotebook } from './notebookValidation'

interface NotebookStoreOptions { infinite: true; legacy: NotebookStore }
type QuoteIdentity = Pick<NotebookQuoteObject, 'quote' | 'source'>
function quoteSignature(value: QuoteIdentity): string {
  const source = value.source
  return createHash('sha256').update(JSON.stringify([value.quote, source.paperId, source.highlightId, source.page, source.rects.map(rect => [rect.x, rect.y, rect.width, rect.height]), source.importedAt])).digest('hex')
}
interface QuoteRegistryUpdate { quotes: Map<string, QuoteIdentity>; addedCount: number; addedBytes: number }
export class NotebookStore {
  private tail: Promise<unknown> = Promise.resolve()
  private readonly knownQuotes = new Map<string, Map<string, QuoteIdentity>>()
  private knownQuoteCount = 0
  private knownQuoteBytes = 0
  constructor(private readonly papers: PaperStore, private readonly canvas: CanvasStore, private readonly diagrams: DiagramStore, private readonly options?: NotebookStoreOptions) {}
  private get fileName(): string { return this.options?.infinite ? 'canvas-infinite.json' : 'canvas-notebook.json' }
  private validateSurface(value: CanvasNotebook): void {
    if (this.options?.infinite ? value.surface !== 'infinite' : value.surface !== undefined) throw new Error('Notebook surface does not match this finite/infinite store')
  }
  async flush(): Promise<void> { await this.tail }
  private serial<T>(operation: () => Promise<T>): Promise<T> { const task = this.tail.then(operation); this.tail = task.catch(() => undefined); return task }
  private async directory(paperId: string): Promise<string> {
    validateCanvasPaperId(paperId)
    if (!(await this.papers.list()).some(paper => paper.id === paperId && !paper.isDemo)) throw new Error('Paper not found. Import a local PDF first.')
    return join(this.papers.root, 'papers', paperId)
  }
  /** Preserve quote identities for session undo, never silently evict an active session's records. */
  private prepareQuoteRegistry(paperId: string, ...documents: CanvasNotebook[]): QuoteRegistryUpdate {
    const quotes = new Map(this.knownQuotes.get(paperId)); let addedCount = 0, addedBytes = 0
    for (const document of documents) for (const page of document.pages) for (const item of page.objects) if (item.type === 'quote') {
      const known = quotes.get(item.id)
      if (known) {
        if (known.quote !== item.quote || !isDeepStrictEqual(known.source, item.source)) throw new Error('Saved quote original and source are immutable; edit the Canvas comment instead.')
      } else {
        const record = { quote: item.quote, source: structuredClone(item.source) }
        quotes.set(item.id, record); addedCount++; addedBytes += Buffer.byteLength(JSON.stringify({ id: item.id, ...record }), 'utf8')
      }
    }
    // Thirty full 5000-object edit states per paper; the stricter byte budget bounds retained text/source payloads.
    if (quotes.size > 150000 || this.knownQuoteCount + addedCount > 300000 || this.knownQuoteBytes + addedBytes > 16 * 1024 * 1024) throw new Error('Session quote memory limit exceeded. Saved data and known undo identities are preserved; restart the application before adding more quote snapshots.')
    return { quotes, addedCount, addedBytes }
  }
  private commitQuoteRegistry(paperId: string, update: QuoteRegistryUpdate) {
    if (update.quotes.size) this.knownQuotes.set(paperId, update.quotes)
    this.knownQuoteCount += update.addedCount; this.knownQuoteBytes += update.addedBytes
  }
  private async read(directory: string, paperId: string): Promise<CanvasNotebook> {
    const path = join(directory, this.fileName)
    try {
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.size > notebookFileLimit) throw new Error('Notebook file is invalid or exceeds the 16 MiB limit')
      const handle = await open(path, 'r')
      try {
        const bytes = Buffer.alloc(notebookFileLimit + 1); let length = 0
        while (length < bytes.length) { const result = await handle.read(bytes, length, bytes.length - length, length); if (!result.bytesRead) break; length += result.bytesRead }
        if (length > notebookFileLimit) throw new Error('Notebook file exceeds the 16 MiB limit')
        const value: unknown = JSON.parse(bytes.subarray(0, length).toString('utf8')); validateCanvasNotebook(value, paperId); this.validateSurface(value); return value
      } finally { await handle.close() }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const files = await readdir(directory).catch((reason: NodeJS.ErrnoException) => { if (reason.code === 'ENOENT') return []; throw reason })
        if (files.some(file => file.startsWith(`${this.fileName}.backup-`) || file.startsWith(`${this.fileName}.tmp-`))) throw new Error('Notebook primary is missing. Retained recovery files are protected; retry or recover the original before editing.')
        if (this.options?.infinite) {
          const legacy = await this.options.legacy.load(paperId), value: CanvasNotebook = { ...legacy, surface: 'infinite' }
          validateCanvasNotebook(value, paperId); this.validateSurface(value); return value
        }
        const [canvas, diagram] = await Promise.all([this.canvas.load(paperId), this.diagrams.loadDiagram(paperId)])
        const value: CanvasNotebook = { version: 1, paperId, activePageId: 'legacy-page', pages: [{ id: 'legacy-page', name: 'Canvas', width: canvas.width, height: canvas.height, objects: canvas.objects, diagram }] }
        validateCanvasNotebook(value, paperId); this.validateSurface(value); return value
      }
      throw new Error(`Notebook data is damaged or invalid; original bytes are protected. ${error instanceof Error ? error.message : 'Read failed'}`)
    }
  }
  async load(paperId: string): Promise<CanvasNotebook> {
    return this.serial(async () => { const value = await this.read(await this.directory(paperId), paperId), update = this.prepareQuoteRegistry(paperId, value); this.commitQuoteRegistry(paperId, update); return value })
  }
  async readHighlight(paperId: string, highlightId: string): Promise<Highlight> {
    validateCanvasPaperId(highlightId); await this.directory(paperId)
    const highlight = (await this.papers.loadMarks(paperId)).highlights.find(item => item.id === highlightId)
    if (!highlight) throw new Error('Source highlight is missing. Save a current highlight before adding it to Canvas.')
    return structuredClone(highlight)
  }
  async save(paperId: string, value: unknown): Promise<void> {
    validateCanvasPaperId(paperId); validateCanvasNotebook(value, paperId); this.validateSurface(value); const snapshot = structuredClone(value)
    if (Buffer.byteLength(JSON.stringify(snapshot, null, 2), 'utf8') > notebookFileLimit) throw new Error('Notebook exceeds the 16 MiB file limit')
    await this.serial(async () => {
      const directory = await this.directory(paperId), previous = await this.read(directory, paperId), savedQuotes = this.prepareQuoteRegistry(paperId, previous).quotes
      const savedOrigins = new Map([...savedQuotes.values()].map(record => [quoteSignature(record), record]))
      for (const page of snapshot.pages) {
        const reserved = [...page.diagram.shapes, ...page.diagram.arrows, ...page.diagram.connections, ...page.objects.flatMap(item => item.type === 'mindmap' ? item.nodes : [])]
        if (reserved.some(item => savedQuotes.has(item.id))) throw new Error('Saved quote identifiers are immutable and cannot become diagram objects or map nodes.')
      }
      for (const page of snapshot.pages) for (const item of page.objects) {
        const saved = savedQuotes.get(item.id)
        if (saved && (item.type !== 'quote' || saved.quote !== item.quote || !isDeepStrictEqual(saved.source, item.source))) throw new Error('Saved quote original and source are immutable; edit the Canvas comment instead.')
        if (item.type === 'image') await this.canvas.readImage(paperId, item.assetId)
        if (item.type === 'quote' && !saved) {
          const trustedCopy = savedOrigins.get(quoteSignature(item))
          if (trustedCopy && trustedCopy.quote === item.quote && isDeepStrictEqual(trustedCopy.source, item.source)) continue
          const live = await this.readHighlight(paperId, item.source.highlightId)
          if (item.quote !== live.quote || item.comment !== live.comment || item.source.page !== live.page || !isDeepStrictEqual(item.source.rects, live.rects)) throw new Error('New quote snapshot does not match the saved source highlight. Save the source and import it again.')
        }
      }
      const update = this.prepareQuoteRegistry(paperId, previous, snapshot)
      await mkdir(directory, { recursive: true }); await this.papers.atomicJson(join(directory, this.fileName), snapshot)
      this.commitQuoteRegistry(paperId, update)
    })
  }
}



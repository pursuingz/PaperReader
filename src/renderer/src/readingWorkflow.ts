import type { AIContextMode, AIRequest, DesktopAPI, LibraryOrganization, Paper, PaperState, PdfInk, PdfInkStroke, PdfTextPage } from '../../shared/types'
import { extractAllPages } from './readingFeatures'
import { NOTE_ORGANIZATION_PREFIX } from '../../shared/aiPrompts'
import { StrokeHistory, type InkBounds, type InkPoint } from './annotationEditing'

export const organizationPrompt = 'Organize my text notes into a clear reading outline. Preserve my ideas, distinguish open questions, and do not invent paper claims. Return a suggested version for me to review.'
export const scopeDescriptions: Record<AIContextMode, string> = {
  page: 'Sends current-page text, selected passage and recent chat to DeepSeek.',
  paper: 'Sends all extracted paper text and recent chat to DeepSeek; does not add your text note.',
  notes: 'Sends only your current text note to DeepSeek; paper text and chat stay local.',
  'paper-notes': 'Sends all extracted paper text, your current text note and recent chat to DeepSeek.'
}

/** Capture selected sources before extraction or another asynchronous operation. */
export function createQuestionSnapshot(input: {
  requestId: string; paper: Paper; state: PaperState; question: string; mode: AIContextMode
  pageText: string; selection: string; action?: AIRequest['action']
}): AIRequest {
  const mode = input.action === 'organize-notes' ? 'notes' : input.mode
  const note = mode === 'notes' || mode === 'paper-notes' ? input.state.note : undefined
  if (note !== undefined && note.length > 100000) throw new Error('AI notes support up to 100,000 characters. Your note has not been sent.')
  if (mode === 'notes' && !note?.trim()) throw new Error('Write a text note before using Notes only or Organize with AI.')
  if (mode === 'page' && !input.pageText.trim() && !input.selection.trim()) throw new Error('This page has no readable text yet. Wait for the page to load, or choose a text-based page. Scanned PDFs need OCR.')
  if (mode === 'page' && input.pageText.length > 100000) throw new Error('Current-page context supports up to 100,000 characters. This page has not been sent.')
  if (mode === 'page' && input.selection.length > 30000) throw new Error('Selected passages support up to 30,000 characters. Choose a shorter passage.')
  return {
    requestId: input.requestId, paperId: input.paper.id,
    question: input.action === 'organize-notes' ? organizationPrompt : input.question.trim(),
    action: input.action ?? 'ask',
    history: mode === 'notes' ? [] : input.state.messages.filter(item => !item.isDemo).slice(-12).map(({ role, content }) => ({ role, content })),
    context: {
      mode, paperTitle: input.paper.title, page: input.state.lastPage,
      pageText: mode === 'page' ? input.pageText : '',
      ...(mode === 'page' && input.selection ? { selection: input.selection } : {}),
      ...(note !== undefined ? { note } : {})
    }
  }
}

export function withExtractedPages(request: AIRequest, pages: PdfTextPage[]): AIRequest {
  if (request.context.mode !== 'paper' && request.context.mode !== 'paper-notes') return request
  return { ...request, context: { ...request.context, pages: pages.map(page => ({ ...page })) } }
}

export function appendAIResponse(latest: PaperState, paperId: string, content: string, organized: boolean, id: string): PaperState {
  return { ...latest, messages: [...latest.messages, { id, paperId, role: 'assistant', createdAt: new Date().toISOString(), content: organized ? NOTE_ORGANIZATION_PREFIX + content : content }] }
}

type ExtractionDocument = Parameters<typeof extractAllPages>[0]
type ExtractionTask = { promise: Promise<ExtractionDocument>; destroy(): Promise<void> }
/** Each chat extraction owns a fresh task; Reader and Summary proxies never enter it. */
export class WholePaperReader {
  private epoch = 0
  private active: { task: ExtractionTask | null; destroyed: boolean } | null = null
  constructor(private readPaper: (id: string) => Promise<Uint8Array>, private createTask: (bytes: Uint8Array) => ExtractionTask) {}
  private async destroy(job: { task: ExtractionTask | null; destroyed: boolean }) {
    if (!job.task || job.destroyed) return
    job.destroyed = true
    await job.task.destroy().catch(() => undefined)
  }
  async cancel() {
    ++this.epoch
    const job = this.active; this.active = null
    if (job) await this.destroy(job)
  }
  async read(paperId: string, current: () => boolean, progress?: (page: number, total: number) => void): Promise<PdfTextPage[]> {
    if (this.active) throw new Error('AI reading is already in progress.')
    const epoch = ++this.epoch, job = { task: null as ExtractionTask | null, destroyed: false }
    this.active = job
    const alive = () => this.epoch === epoch && this.active === job && current()
    const check = () => { if (!alive()) throw new Error('AI reading cancelled.') }
    try {
      const bytes = await this.readPaper(paperId); check()
      job.task = this.createTask(new Uint8Array(bytes))
      const document = await job.task.promise; check()
      const pages = await extractAllPages(document, alive, progress); check()
      return pages
    } finally { if (this.active === job) this.active = null; await this.destroy(job) }
  }
}

export async function flushBeforeExport<T>(saves: Array<() => Promise<void>>, exportSaved: () => Promise<T>): Promise<T> {
  await Promise.all(saves.map(save => save()))
  return exportSaved()
}

export function groupLibrary(papers: Paper[], organization: LibraryOrganization) {
  const assigned = new Set(organization.categories.map(category => category.id))
  return [
    ...organization.categories.map(category => ({ id: category.id, name: category.name, papers: papers.filter(paper => !paper.isDemo && organization.assignments[paper.id] === category.id) })),
    { id: 'unassigned', name: 'Imported / unassigned', papers: papers.filter(paper => !paper.isDemo && !assigned.has(organization.assignments[paper.id])) },
    ...(papers.some(paper => paper.isDemo) ? [{ id: 'demo', name: 'Demonstration', papers: papers.filter(paper => paper.isDemo) }] : [])
  ]
}

const emptyInk = (): PdfInk => ({ strokes: [] })
/** Independent sidecar state: load failures stay read-only, writes are serialized. */
export class PdfInkSession {
  id: string | null = null
  ready = false
  value: PdfInk = emptyInk()
  private epoch = 0
  private version = 0
  private saved = 0
  private queue: Promise<void> = Promise.resolve()
  private history = new StrokeHistory<PdfInkStroke>(stroke => stroke.page)
  constructor(private api: Pick<DesktopAPI, 'loadPdfInk' | 'savePdfInk'>) {}
  async open(id: string | null) {
    const epoch = ++this.epoch
    this.id = id; this.ready = false; this.value = emptyInk(); this.version = 0; this.saved = 0; this.history.reset([])
    if (!id) return
    const value = await this.api.loadPdfInk(id)
    if (this.epoch !== epoch) return
    this.value = value; this.ready = true; this.history.reset(value.strokes)
  }
  add(stroke: PdfInkStroke) {
    if (!this.ready || !this.id) return false
    if (!Number.isSafeInteger(stroke.page) || stroke.page < 1 || !stroke.points.length || stroke.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) throw new Error('PDF ink coordinates must remain within their original page.')
    if (this.value.strokes.length >= 1000 || stroke.points.length > 10000 || this.value.strokes.reduce((count, item) => count + item.points.length, stroke.points.length) > 200000) throw new Error('PDF drawing is full (1,000 strokes / 200,000 points). Existing ink is preserved.')
    return this.history.add(stroke) ? this.changed() : false
  }
  private changed() { this.value = { strokes: this.history.value }; this.version++; return true }
  beginErase(page: number) { return this.ready && Number.isSafeInteger(page) && page > 0 ? this.history.beginErase(page) : false }
  erase(from: InkPoint, to: InkPoint, bounds: InkBounds) { return this.ready && this.history.erase(from, to, bounds) ? this.changed() : false }
  finishErase() { return this.history.finishErase() }
  canUndo(page: number) { return this.ready && this.history.canUndo(page) }
  canRedo(page: number) { return this.ready && this.history.canRedo(page) }
  undo(page: number) { return this.canUndo(page) && this.history.undo(page) ? this.changed() : false }
  redo(page: number) { return this.canRedo(page) && this.history.redo(page) ? this.changed() : false }
  flush(): Promise<void> {
    this.finishErase()
    const id = this.id, epoch = this.epoch, version = this.version
    if (!id || !this.ready || this.saved === version) return this.queue
    const snapshot = structuredClone(this.value)
    const task = this.queue.catch(() => undefined).then(() => this.api.savePdfInk(id, snapshot))
    this.queue = task
    return task.then(() => { if (this.epoch === epoch) this.saved = Math.max(this.saved, version) })
  }
}

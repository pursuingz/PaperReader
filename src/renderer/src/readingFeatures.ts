import type { DesktopAPI, Highlight, InkStroke, NormalizedRect, PdfTextPage, ReadingMarks } from '../../shared/types'
import { StrokeHistory, validateInk, type InkBounds, type InkPoint } from './annotationEditing'

type Bounds = { left: number; top: number; width: number; height: number }
const clamp = (value: number) => Math.max(0, Math.min(1, value))
export const emptyMarks = (): ReadingMarks => ({ highlights: [], strokes: [] })

export function normalizedPoint(x: number, y: number, bounds: Bounds) {
  return { x: clamp((x - bounds.left) / bounds.width), y: clamp((y - bounds.top) / bounds.height) }
}

export function normalizedRects(rects: Bounds[], page: Bounds): NormalizedRect[] {
  if (!page.width || !page.height) return []
  return rects.flatMap(rect => {
    const left = Math.max(page.left, rect.left), top = Math.max(page.top, rect.top)
    const right = Math.min(page.left + page.width, rect.left + rect.width)
    const bottom = Math.min(page.top + page.height, rect.top + rect.height)
    if (right <= left || bottom <= top) return []
    return [{ x: (left - page.left) / page.width, y: (top - page.top) / page.height, width: (right - left) / page.width, height: (bottom - top) / page.height }]
  })
}

type TextDocument = { numPages: number; getPage(page: number): Promise<{ getTextContent(): Promise<{ items: Array<unknown> }> }> }
export async function readReaderPage(document: TextDocument, page: number, alive: () => boolean): Promise<string | null> {
  if (!alive()) return null
  const value = await document.getPage(page)
  if (!alive()) return null
  const content = await value.getTextContent()
  if (!alive()) return null
  return content.items.map(item => item && typeof item === 'object' && 'str' in item ? String(item.str) : '').join(' ')
}
export async function extractAllPages(document: TextDocument, alive: () => boolean, progress?: (page: number, total: number) => void): Promise<PdfTextPage[]> {
  if (document.numPages > 200) throw new Error('AI reading supports up to 200 pages. This paper has not been sent.')
  const pages: PdfTextPage[] = []
  let length = 0
  const check = () => { if (!alive()) throw new Error('AI reading cancelled.') }
  for (let page = 1; page <= document.numPages; page++) {
    check()
    const pdfPage = await document.getPage(page)
    check()
    const content = await pdfPage.getTextContent()
    check()
    const text = content.items.map(item => item && typeof item === 'object' && 'str' in item ? String(item.str) : '').join(' ').trim()
    length += text.length
    if (length > 240000) throw new Error('AI reading supports up to 240,000 text characters. This paper has not been sent.')
    pages.push({ page, text })
    progress?.(page, document.numPages)
  }
  return pages
}

/** Load errors never become editable empty marks; writes take immutable snapshots. */
export class ReadingMarksSession {
  id: string | null = null
  ready = false
  value: ReadingMarks = emptyMarks()
  private token = 0
  private version = 0
  private savedVersion = 0
  private queue: Promise<void> = Promise.resolve()
  private ink = new StrokeHistory<InkStroke>(() => 0, 1.2)
  draft: InkStroke | null = null
  private highlightPast: HighlightEdit[] = []
  private highlightFuture: HighlightEdit[] = []
  private highlightRanks = new Map<string, number>()
  private nextHighlightRank = 0
  constructor(private api: Pick<DesktopAPI, 'loadMarks' | 'saveMarks'>) {}
  async open(id: string | null) {
    const token = ++this.token
    this.id = id; this.ready = false; this.value = emptyMarks(); this.version = 0; this.savedVersion = 0
    this.ink.reset([]); this.draft = null; this.highlightPast = []; this.highlightFuture = []; this.highlightRanks.clear(); this.nextHighlightRank = 0
    if (!id) return
    const value = await this.api.loadMarks(id)
    if (token !== this.token) return
    this.value = value; this.ready = true; this.ink.reset(value.strokes)
    value.highlights.forEach(item => this.highlightRanks.set(item.id, this.nextHighlightRank++))
  }
  update(value: ReadingMarks) {
    if (!this.ready || !this.id) return false
    for (const item of value.highlights) if (!this.value.highlights.some(old => old.id === item.id)) {
      this.highlightRanks.set(item.id, this.nextHighlightRank++)
      this.recordHighlight({ kind: 'add', item: structuredClone(item) })
    }
    if (value.strokes !== this.value.strokes) this.ink.reset(value.strokes)
    this.value = value; this.version++
    return true
  }
  private recordHighlight(edit: HighlightEdit) { this.highlightPast.push(edit); this.highlightFuture = [] }
  setHighlightColor(id: string, color: Highlight['color']) {
    if (!this.ready || !['yellow', 'coral', 'mint'].includes(color)) return false
    const item = this.value.highlights.find(item => item.id === id)
    if (!item || item.color === color) return false
    this.recordHighlight({ kind: 'color', id, before: item.color, after: color })
    this.value = { ...this.value, highlights: this.value.highlights.map(item => item.id === id ? { ...item, color } : item) }; this.version++; return true
  }
  removeHighlight(id: string) {
    if (!this.ready) return false
    const item = this.value.highlights.find(item => item.id === id)
    if (!item) return false
    this.recordHighlight({ kind: 'remove', item: structuredClone(item) })
    this.value = { ...this.value, highlights: this.value.highlights.filter(item => item.id !== id) }; this.version++; return true
  }
  canUndoHighlight() { return this.ready && this.highlightPast.length > 0 }
  canRedoHighlight() { return this.ready && this.highlightFuture.length > 0 }
  private applyHighlight(edit: HighlightEdit, backwards: boolean) {
    let highlights = this.value.highlights
    if (edit.kind === 'color') highlights = highlights.map(item => item.id === edit.id ? { ...item, color: backwards ? edit.before : edit.after } : item)
    else if ((edit.kind === 'add') === backwards) {
      // Keep any comments made since the creation/restoration for the next redo.
      edit.item = structuredClone(highlights.find(item => item.id === edit.item.id) ?? edit.item)
      highlights = highlights.filter(item => item.id !== edit.item.id)
    } else highlights = [...highlights, structuredClone(edit.item)].sort((a, b) => this.highlightRanks.get(a.id)! - this.highlightRanks.get(b.id)!)
    if (highlights.length > 2000 || highlights.reduce((total, item) => total + item.rects.length, 0) > 20000 || highlights.reduce((total, item) => total + item.quote.length + item.comment.length, 0) > 2000000) throw new Error('This edit would exceed the reading marks size limit. Shorten comments before restoring the highlight.')
    this.value = { ...this.value, highlights }; this.version++
  }
  undoHighlight() { if (!this.canUndoHighlight()) return false; const edit = this.highlightPast.at(-1)!; this.applyHighlight(edit, true); this.highlightPast.pop(); this.highlightFuture.push(edit); return true }
  redoHighlight() { if (!this.canRedoHighlight()) return false; const edit = this.highlightFuture.at(-1)!; this.applyHighlight(edit, false); this.highlightFuture.pop(); this.highlightPast.push(edit); return true }
  beginInk(paperId: string, stroke: InkStroke) {
    if (!this.ready || this.id !== paperId || this.draft) return false
    validateInk([...this.value.strokes, stroke.points.length === 1 ? { ...stroke, points: [stroke.points[0], stroke.points[0]] } : stroke]); this.draft = structuredClone(stroke); return true
  }
  inkPoint(point: InkPoint) {
    if (!this.draft) return false
    const points = this.draft.points, previous = points.at(-1)!
    if (Math.hypot(point.x - previous.x, point.y - previous.y) < .0015 || points.length >= 10000 || this.value.strokes.reduce((total, stroke) => total + stroke.points.length, points.length) >= 200000) return false
    this.draft = { ...this.draft, points: [...points, point] }; return true
  }
  finishInk() {
    const draft = this.draft
    if (!draft) return false
    if (draft.points.length === 1) draft.points.push({ ...draft.points[0] })
    if (!this.ink.add(draft)) return false
    this.draft = null; return this.syncInk()
  }
  private syncInk() { this.value = { ...this.value, strokes: this.ink.value }; this.version++; return true }
  beginEraseInk(paperId: string) { if (!this.ready || this.id !== paperId || this.draft) return false; return this.ink.beginErase(0) }
  eraseInk(from: InkPoint, to: InkPoint, bounds: InkBounds) { return this.ready && this.ink.erase(from, to, bounds) ? this.syncInk() : false }
  finishEraseInk() { return this.ink.finishErase() }
  canUndoInk() { return this.ready && !this.draft && this.ink.canUndo(0) }
  canRedoInk() { return this.ready && !this.draft && this.ink.canRedo(0) }
  undoInk() { return this.canUndoInk() && this.ink.undo(0) ? this.syncInk() : false }
  redoInk() { return this.canRedoInk() && this.ink.redo(0) ? this.syncInk() : false }
  flush(): Promise<void> {
    this.finishInk(); this.finishEraseInk()
    const id = this.id, token = this.token, version = this.version
    if (!id || !this.ready || version === this.savedVersion) return this.queue
    const snapshot = structuredClone(this.value)
    const task = this.queue.catch(() => undefined).then(() => this.api.saveMarks(id, snapshot))
    this.queue = task
    return task.then(() => { if (this.token === token) this.savedVersion = Math.max(this.savedVersion, version) })
  }
}

type HighlightEdit = { kind: 'color'; id: string; before: Highlight['color']; after: Highlight['color'] } | { kind: 'add' | 'remove'; item: Highlight }

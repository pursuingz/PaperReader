import type { CanvasDiagram, DiagramArrow, DiagramConnection, DiagramEndpoint, DiagramShape } from '../../shared/diagramTypes'
import type { DesktopAPI } from '../../shared/types'
import type { CanvasPoint } from './canvasWorkspace'
import { emptyDiagram, validateCanvasDiagram } from '../../main/diagramValidation'
import { moveDiagramItem, resizeDiagramShape } from './diagramModel'
/** Sidecars have independent history, failures and write queues; no old canvas schema is rewritten. */
export class SidecarSession<T extends { paperId: string }> {
  paperId: string | null = null
  ready = false
  exporting = false
  status = 'Open an imported paper to edit'
  selectedId: string | null = null
  document: T
  protected epoch = 0
  private version = 0
  private savedVersion = 0
  private tail: Promise<void> = Promise.resolve()
  private previous: T[] = []
  private future: T[] = []
  protected gesture: { before: T; id?: string; kind: string; start?: CanvasPoint } | null = null
  constructor(private load: (id: string) => Promise<T>, private save: (id: string, value: T) => Promise<void>, private empty: (id: string) => T, private validate: (value: unknown, paperId?: string) => void, protected notify: () => void = () => undefined) { this.document = empty('unopened') }
  get editing() { return this.gesture !== null }
  get canUndo() { return this.ready && !this.exporting && (this.previous.length > 0 || !!this.gesture && this.gesture.before !== this.document) }
  get canRedo() { return this.ready && !this.exporting && this.future.length > 0 }
  async open(id: string | null) {
    if (this.exporting) throw new Error('Finish the PNG export before changing papers')
    await this.flush(); const epoch = ++this.epoch
    this.paperId = id; this.ready = false; this.document = this.empty(id ?? 'unopened'); this.selectedId = null; this.previous = []; this.future = []; this.gesture = null; this.version = this.savedVersion = 0; this.status = id ? 'Loading…' : 'Open an imported paper to edit'; this.notify()
    if (!id) return
    try { const value = await this.load(id); if (epoch !== this.epoch || id !== this.paperId) return; this.validate(value, id); this.document = structuredClone(value); this.ready = true; this.status = 'Saved locally'; this.notify() }
    catch (error) { if (epoch !== this.epoch) return; this.status = 'Unavailable · saved data protected'; this.notify(); throw error }
  }
  protected update(document: T) { this.validate(document, this.paperId ?? undefined); this.document = document; this.version++; this.status = 'Unsaved changes'; this.notify() }
  protected commit(document: T) { if (!this.ready || this.exporting || this.document === document) return; this.finish(); const before = this.document; this.update(document); this.previous.push(before); this.future = []; this.trim(); this.notify() }
  private trim() { while (this.previous.length > 30 || this.previous.length > 1 && this.previous.reduce((sum, value) => sum + JSON.stringify(value).length, 0) > 2000000) this.previous.shift(); while (this.future.length > 30 || this.future.length > 1 && this.future.reduce((sum, value) => sum + JSON.stringify(value).length, 0) > 2000000) this.future.shift() }
  finish() { const gesture = this.gesture; this.gesture = null; if (!gesture) return; if (gesture.before !== this.document) { this.previous.push(gesture.before); this.future = []; this.trim() }; this.notify() }
  select(id: string | null) { if (this.exporting) return; this.finish(); this.selectedId = id; this.notify() }
  undo() { if (!this.ready || this.exporting) return; this.finish(); const value = this.previous.pop(); if (!value) return; this.future.push(this.document); this.update(value); this.selectedId = null; this.notify() }
  redo() { if (!this.ready || this.exporting) return; this.finish(); const value = this.future.pop(); if (!value) return; this.previous.push(this.document); this.update(value); this.selectedId = null; this.notify() }
  async flush() {
    this.finish(); const id = this.paperId, epoch = this.epoch
    if (!id || !this.ready) { await this.tail.catch(() => undefined); return }
    if (this.savedVersion === this.version) { await this.tail; return }
    const version = this.version, snapshot = structuredClone(this.document); this.status = 'Saving…'; this.notify()
    const task = this.tail.catch(() => undefined).then(() => this.save(id, snapshot)); this.tail = task
    try { await task; if (epoch === this.epoch) { this.savedVersion = Math.max(this.savedVersion, version); this.status = this.savedVersion === this.version ? 'Saved locally' : 'Unsaved changes'; this.notify() } }
    catch (error) { if (epoch === this.epoch) { this.status = 'Save failed · changes kept in this session'; this.notify() }; throw error }
  }
  dispose() { this.finish(); this.epoch++ }
}
type API = Pick<DesktopAPI, 'loadCanvasDiagram' | 'saveCanvasDiagram'>
export class DiagramSession extends SidecarSession<CanvasDiagram> {
  constructor(api: API, notify?: () => void) { super(id => api.loadCanvasDiagram(id), (id, value) => api.saveCanvasDiagram(id, value), emptyDiagram, validateCanvasDiagram, notify) }
  private count() { return this.document.shapes.length + this.document.arrows.length + this.document.connections.length }
  addShape(kind: DiagramShape['kind']): string | null {
    if (!this.ready || this.exporting) return null
    const id = crypto.randomUUID(), offset = this.count() % 8 * 24
    this.commit({ ...this.document, shapes: [...this.document.shapes, { id, kind, x: 80 + offset, y: 80 + offset, width: kind === 'circle' ? 160 : 180, height: kind === 'circle' ? 160 : 140, fill: '#fffbf2', color: '#334155', lineWidth: 3 }] }); this.selectedId = id; this.notify(); return id
  }
  addArrow(): string | null {
    if (!this.ready || this.exporting) return null
    const id = crypto.randomUUID(); this.commit({ ...this.document, arrows: [...this.document.arrows, { id, start: { x: 100, y: 100 }, end: { x: 320, y: 240 }, color: '#334155', lineWidth: 3 }] }); this.selectedId = id; this.notify(); return id
  }
  addConnection(from: DiagramEndpoint, to: DiagramEndpoint): string | null {
    if (!this.ready || this.exporting) return null
    const id = crypto.randomUUID(); this.commit({ ...this.document, connections: [...this.document.connections, { id, from: { ...from }, to: { ...to }, color: '#334155', lineWidth: 3 }] }); this.selectedId = id; this.notify(); return id
  }
  updateItem(id: string, patch: Partial<DiagramShape & DiagramArrow & DiagramConnection>) {
    if (!this.ready || this.exporting) return
    patch = structuredClone(patch)
    const shapes = this.document.shapes.map(item => item.id === id ? { ...item, ...Object.fromEntries(Object.entries(patch).filter(([key]) => ['kind', 'x', 'y', 'width', 'height', 'fill', 'color', 'lineWidth'].includes(key))) } : { ...item })
    for (const shape of shapes) {
      if (shape.kind === 'circle') { const requested = shape.id === id && patch.width !== undefined && patch.height === undefined ? shape.width : shape.id === id && patch.height !== undefined && patch.width === undefined ? shape.height : Math.min(shape.width, shape.height); shape.width = shape.height = Math.max(20, Math.min(1000, requested)) }
      shape.width = Math.max(20, Math.min(1000, shape.width)); shape.height = Math.max(20, Math.min(1200, shape.height)); shape.x = Math.max(0, Math.min(1000 - shape.width, shape.x)); shape.y = Math.max(0, Math.min(1200 - shape.height, shape.y))
    }
    const arrows = this.document.arrows.map(item => item.id === id ? { ...item, ...Object.fromEntries(Object.entries(patch).filter(([key]) => ['start', 'end', 'color', 'lineWidth'].includes(key))) } : item)
    const connections = this.document.connections.map(item => item.id === id ? { ...item, ...Object.fromEntries(Object.entries(patch).filter(([key]) => ['from', 'to', 'color', 'lineWidth'].includes(key))) } : item)
    this.commit({ ...this.document, shapes, arrows, connections })
  }
  removeSelected() { if (!this.ready || this.exporting || !this.selectedId) return; const id = this.selectedId; this.commit({ ...this.document, shapes: this.document.shapes.filter(item => item.id !== id), arrows: this.document.arrows.filter(item => item.id !== id), connections: this.document.connections.filter(item => item.id !== id) }); this.selectedId = null; this.notify() }
  beginMove(id: string, point: CanvasPoint) { if (!this.ready || this.exporting || this.editing || ![...this.document.shapes, ...this.document.arrows].some(item => item.id === id)) return false; this.finish(); this.selectedId = id; this.gesture = { before: this.document, id, kind: 'move', start: point }; this.notify(); return true }
  moveTo(point: CanvasPoint) { const gesture = this.gesture; if (!gesture || gesture.kind !== 'move') return; this.update(moveDiagramItem(gesture.before, gesture.id!, point.x - gesture.start!.x, point.y - gesture.start!.y)) }
  beginResize(id: string, point: CanvasPoint) { if (!this.ready || this.exporting || this.editing || !this.document.shapes.some(item => item.id === id)) return false; this.selectedId = id; this.gesture = { before: this.document, id, kind: 'resize', start: point }; this.notify(); return true }
  resizeTo(point: CanvasPoint) { const gesture = this.gesture; if (!gesture || gesture.kind !== 'resize') return; const shape = gesture.before.shapes.find(item => item.id === gesture.id)!, dx = point.x - gesture.start!.x, dy = point.y - gesture.start!.y, delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy; this.update(resizeDiagramShape(gesture.before, shape.id, shape.width + (shape.kind === 'circle' ? delta : dx), shape.height + (shape.kind === 'circle' ? delta : dy))) }
  beginArrowEnd(id: string, end: 'start' | 'end') { if (!this.ready || this.exporting || this.editing || !this.document.arrows.some(item => item.id === id)) return false; this.selectedId = id; this.gesture = { before: this.document, id, kind: end }; this.notify(); return true }
  arrowEndTo(point: CanvasPoint) { const gesture = this.gesture; if (!gesture || !['start', 'end'].includes(gesture.kind)) return; const at = { x: Math.max(0, Math.min(1000, point.x)), y: Math.max(0, Math.min(1200, point.y)) }; this.update({ ...this.document, arrows: this.document.arrows.map(arrow => arrow.id === gesture.id ? { ...arrow, [gesture.kind]: at } : arrow) }) }
}

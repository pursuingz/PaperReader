import { isHexColor } from '../../shared/colors'
import type { CanvasDocument, CanvasImageAsset, CanvasImageData, CanvasImageSource, CanvasObject, DesktopAPI, NoteExportResult, PdfCaptureInput } from '../../shared/types'
import { canvasColors, validateCanvasDocument, validateCanvasImageAsset } from '../../main/canvasValidation'
import { validateCanvasSource } from '../../main/canvasCaptureValidation'
import { hitStroke } from './annotationEditing'

export type CanvasMode = 'select' | 'draw' | 'erase'
export type CanvasPoint = { x: number; y: number }
export type CanvasRect = CanvasPoint & { width: number; height: number }
export type CanvasAssetView = { url?: string; error?: string; source?: CanvasImageSource }
const empty = (): CanvasDocument => ({ version: 1, width: 1000, height: 1200, objects: [] })
const clampPoint = (point: CanvasPoint): CanvasPoint => ({ x: Math.max(0, Math.min(1000, point.x)), y: Math.max(0, Math.min(1200, point.y)) })
export function clampCanvasRect(rect: CanvasRect): CanvasRect {
  const width = Math.max(Number.MIN_VALUE, Math.min(1000, rect.width)), height = Math.max(Number.MIN_VALUE, Math.min(1200, rect.height))
  return { x: Math.max(0, Math.min(1000 - width, rect.x)), y: Math.max(0, Math.min(1200 - height, rect.y)), width, height }
}
export function proportionalCanvasRect(rect: CanvasRect, requestedWidth: number): CanvasRect {
  const aspect = rect.width / rect.height, maximum = Math.min(1000 - rect.x, (1200 - rect.y) * aspect)
  let width = Math.max(Math.min(20, maximum), Math.min(maximum, requestedWidth))
  if (rect.y + width / aspect > 1200) width = Math.max(Number.MIN_VALUE, width - 1e-9)
  return { x: rect.x, y: rect.y, width, height: width / aspect }
}
interface Gesture { kind: 'move' | 'resize' | 'stroke' | 'erase' | 'text'; before: CanvasDocument; id?: string; start?: CanvasPoint; rect?: CanvasRect; previous?: CanvasPoint }
type CanvasAPI = Pick<DesktopAPI, 'loadCanvas' | 'saveCanvas' | 'importCanvasImage' | 'readCanvasImage' | 'saveCanvasCapture' | 'exportCanvasPng'>
/** Stateful session outlives compact/expanded editors; all documents and history frames are immutable. */
export class CanvasSession {
  paperId: string | null = null
  ready = false
  exporting = false
  status = 'Open an imported paper to use Canvas'
  document = empty()
  selectedId: string | null = null
  mode: CanvasMode = 'select'
  color: string = canvasColors[0]
  assets: Record<string, CanvasAssetView> = {}
  private epoch = 0
  private version = 0
  private savedVersion = 0
  private writeTail: Promise<void> = Promise.resolve()
  private pendingImports = new Set<Promise<void>>()
  private gesture: Gesture | null = null
  private previous: CanvasDocument[] = []
  private future: CanvasDocument[] = []
  private loadingAssets = new Set<string>()
  constructor(private api: CanvasAPI, private notify: () => void = () => undefined,
    private createURL: (image: CanvasImageData) => string = image => URL.createObjectURL(new Blob([new Uint8Array(image.bytes).buffer], { type: image.mimeType })),
    private revokeURL: (url: string) => void = url => URL.revokeObjectURL(url)) {}
  get editing() { return !!this.gesture }
  get canUndo() { return this.ready && !this.exporting && (this.previous.length > 0 || !!this.gesture && this.gesture.before !== this.document) }
  get canRedo() { return this.ready && !this.exporting && this.future.length > 0 }
  private releaseAssets() { for (const asset of Object.values(this.assets)) if (asset.url) this.revokeURL(asset.url); this.assets = {}; this.loadingAssets.clear() }
  async open(id: string | null): Promise<void> {
    this.finish(); const epoch = ++this.epoch
    this.releaseAssets(); this.pendingImports = new Set(); this.paperId = id; this.ready = false; this.document = empty(); this.selectedId = null; this.previous = []; this.future = []; this.gesture = null; this.version = this.savedVersion = 0
    this.status = id ? 'Loading canvas…' : 'Open an imported paper to use Canvas'; this.notify()
    if (!id) return
    try {
      const document = await this.api.loadCanvas(id)
      if (this.epoch !== epoch || this.paperId !== id) return
      validateCanvasDocument(document); this.document = structuredClone(document); this.ready = true; this.status = 'Saved locally'; this.notify(); this.ensureAssets()
    } catch (error) { if (this.epoch !== epoch) return; this.status = 'Canvas unavailable · saved data protected'; this.notify(); throw error }
  }
  private trimHistory() {
    const cost = (document: CanvasDocument) => document.objects.reduce((total, object) => total + (object.type === 'text' ? object.text.length : object.type === 'stroke' ? object.points.length * 2 : 20), 0)
    while (this.previous.length > 30 || this.previous.length > 1 && this.previous.reduce((sum, value) => sum + cost(value), 0) > 2000000) this.previous.shift()
    while (this.future.length > 30 || this.future.length > 1 && this.future.reduce((sum, value) => sum + cost(value), 0) > 2000000) this.future.shift()
  }
  private checkpoint(before: CanvasDocument) { if (before === this.document) return; this.previous.push(before); this.future = []; this.trimHistory() }
  private update(document: CanvasDocument) { validateCanvasDocument(document); this.document = document; this.version++; this.status = 'Unsaved changes'; this.notify() }
  private commit(document: CanvasDocument) { this.finish(); const before = this.document; this.update(document); this.checkpoint(before); this.ensureAssets(); this.notify() }
  private replace(id: string, replacement: CanvasObject) { this.update({ ...this.document, objects: this.document.objects.map(object => object.id === id ? replacement : object) }) }
  finish() { const gesture = this.gesture; this.gesture = null; if (gesture) { this.checkpoint(gesture.before); this.notify() } }
  select(id: string | null) { if (this.exporting) return; this.finish(); this.selectedId = id && this.document.objects.some(object => object.id === id) ? id : null; this.notify() }
  setMode(mode: CanvasMode) { if (this.exporting) return; this.finish(); this.mode = mode; this.notify() }
  setColor(color: string) { if (this.exporting || !isHexColor(color)) return; this.finish(); this.color = color; this.notify() }
  addText(): string | null {
    if (!this.ready || this.exporting) return null
    const id = crypto.randomUUID(), offset = Math.min(this.document.objects.length % 8 * 24, 168)
    this.commit({ ...this.document, objects: [...this.document.objects, { id, type: 'text', x: 80 + offset, y: 80 + offset, width: 400, height: 220, text: '', color: this.color, fontSize: 24 }] }); this.selectedId = id; this.mode = 'select'; this.notify(); return id
  }
  editText(id: string, text: string) {
    if (!this.ready || this.exporting) return
    const object = this.document.objects.find(object => object.id === id)
    if (!object || object.type !== 'text' || object.text === text) return
    if (this.gesture?.kind !== 'text' || this.gesture.id !== id) { this.finish(); this.gesture = { kind: 'text', before: this.document, id } }
    this.replace(id, { ...object, text })
  }
  updateObject(id: string, patch: Partial<CanvasRect & { text: string; fontSize: number; color: string }>) {
    if (!this.ready || this.exporting) return
    this.finish(); const object = this.document.objects.find(object => object.id === id)
    if (!object || object.type === 'stroke') return
    const changed = { ...object, ...patch }
    if (object.type === 'image') { delete (changed as Partial<{ text: string; fontSize: number; color: string }>).text; delete (changed as Partial<{ fontSize: number }>).fontSize; delete (changed as Partial<{ color: string }>).color }
    const geometry = clampCanvasRect(changed)
    this.commit({ ...this.document, objects: this.document.objects.map(item => item.id === id ? { ...changed, ...geometry } : item) })
  }
  resizeSelectedWidth(width: number) { const object = this.document.objects.find(object => object.id === this.selectedId); if (!this.ready || !object || object.type !== 'image' || !Number.isFinite(width)) return; this.updateObject(object.id, proportionalCanvasRect(object, width)) }
  removeSelected() { if (!this.ready || this.exporting || !this.selectedId) return; this.finish(); const id = this.selectedId; this.commit({ ...this.document, objects: this.document.objects.filter(object => object.id !== id) }); this.selectedId = null; this.notify() }
  undo() { if (!this.ready || this.exporting) return; this.finish(); const document = this.previous.pop(); if (!document) return; this.future.push(this.document); this.update(document); this.selectedId = null; this.trimHistory(); this.ensureAssets(); this.notify() }
  redo() { if (!this.ready || this.exporting) return; this.finish(); const document = this.future.pop(); if (!document) return; this.previous.push(this.document); this.update(document); this.selectedId = null; this.trimHistory(); this.ensureAssets(); this.notify() }
  beginMove(id: string, point: CanvasPoint) {
    if (!this.ready || this.exporting) return false
    this.finish(); const object = this.document.objects.find(object => object.id === id); this.select(id)
    if (!object || object.type === 'stroke') return false
    this.gesture = { kind: 'move', before: this.document, id, start: clampPoint(point), rect: { x: object.x, y: object.y, width: object.width, height: object.height } }; this.notify(); return true
  }
  moveTo(point: CanvasPoint) {
    const gesture = this.gesture
    if (!gesture || gesture.kind !== 'move') return
    const object = this.document.objects.find(object => object.id === gesture.id); if (!object || object.type === 'stroke') return
    const at = clampPoint(point), start = gesture.start!, rect = gesture.rect!, geometry = clampCanvasRect({ ...rect, x: rect.x + at.x - start.x, y: rect.y + at.y - start.y })
    if (geometry.x !== object.x || geometry.y !== object.y) this.replace(object.id, { ...object, ...geometry })
  }
  beginResize(id: string, point: CanvasPoint) { if (!this.ready || this.exporting) return false; this.finish(); const object = this.document.objects.find(object => object.id === id); if (!object || object.type !== 'image') return false; this.select(id); this.gesture = { kind: 'resize', before: this.document, id, start: point, rect: { x: object.x, y: object.y, width: object.width, height: object.height } }; this.notify(); return true }
  resizeTo(point: CanvasPoint) { const gesture = this.gesture; if (!gesture || gesture.kind !== 'resize') return; const object = this.document.objects.find(object => object.id === gesture.id); if (!object || object.type !== 'image') return; const rect = gesture.rect!, geometry = proportionalCanvasRect(rect, rect.width + point.x - gesture.start!.x); if (geometry.width !== object.width) this.replace(object.id, { ...object, ...geometry }) }
  beginStroke(point: CanvasPoint) {
    if (!this.ready || this.exporting) return false
    this.finish(); const before = this.document, id = crypto.randomUUID(), at = clampPoint(point)
    this.gesture = { kind: 'stroke', before, id }; this.selectedId = null
    try { this.update({ ...before, objects: [...before.objects, { id, type: 'stroke', color: this.color, strokeWidth: 4, points: [at, { ...at }] }] }); return true }
    catch (error) { this.gesture = null; throw error }
  }
  strokeTo(point: CanvasPoint) { const gesture = this.gesture; if (!gesture || gesture.kind !== 'stroke') return; const object = this.document.objects.find(object => object.id === gesture.id); if (!object || object.type !== 'stroke') return; const at = clampPoint(point), last = object.points.at(-1)!; if (Math.hypot(at.x - last.x, at.y - last.y) < 1 || object.points.length >= 10000) return; this.replace(object.id, { ...object, points: [...object.points, at] }) }
  beginErase(point: CanvasPoint) { if (!this.ready || this.exporting) return false; this.finish(); this.selectedId = null; this.gesture = { kind: 'erase', before: this.document, previous: clampPoint(point) }; this.notify(); this.eraseTo(point); return true }
  eraseTo(point: CanvasPoint) {
    const gesture = this.gesture; if (!gesture || gesture.kind !== 'erase') return
    const at = clampPoint(point), from = gesture.previous!, normalize = (value: CanvasPoint) => ({ x: value.x / 1000, y: value.y / 1200 })
    const objects = this.document.objects.filter(object => object.type !== 'stroke' || !hitStroke({ id: object.id, points: object.points.map(normalize), color: object.color, width: object.strokeWidth / 1000 }, normalize(from), normalize(at), { width: 1000, height: 1200 }, 12, 1.2))
    gesture.previous = at; if (objects.length !== this.document.objects.length) this.update({ ...this.document, objects })
  }
  private ensureAssets() {
    const ids = new Set(this.document.objects.filter(object => object.type === 'image').map(object => object.assetId))
    for (const [id, asset] of Object.entries(this.assets)) if (!ids.has(id)) { if (asset.url) this.revokeURL(asset.url); delete this.assets[id] }
    for (const id of ids) if (!this.assets[id] && !this.loadingAssets.has(id)) void this.loadAsset(id)
  }
  imageUnavailable(assetId: string) {
    if (!this.document.objects.some(object => object.type === 'image' && object.assetId === assetId)) return
    if (this.assets[assetId]?.url) this.revokeURL(this.assets[assetId].url!)
    this.assets = { ...this.assets, [assetId]: { source: this.assets[assetId]?.source, error: 'Image could not be displayed. Its object and saved resource were preserved.' } }; this.notify()
  }
  async retryImage(assetId: string) { if (this.assets[assetId]?.url) this.revokeURL(this.assets[assetId].url!); delete this.assets[assetId]; await this.loadAsset(assetId) }
  private async loadAsset(assetId: string) {
    const id = this.paperId, epoch = this.epoch
    if (!id || !this.ready || this.loadingAssets.has(assetId)) return
    this.loadingAssets.add(assetId)
    try {
      const image = await this.api.readCanvasImage(id, assetId)
      if (epoch !== this.epoch || this.paperId !== id || !this.document.objects.some(object => object.type === 'image' && object.assetId === assetId)) return
      if (image.assetId !== assetId) throw new Error('Canvas image resource identity changed')
      if (image.source) validateCanvasSource(image.source)
      const url = this.createURL(image); this.assets = { ...this.assets, [assetId]: { url, ...(image.source ? { source: structuredClone(image.source) } : {}) } }; this.notify()
    } catch (error) { if (epoch === this.epoch && this.document.objects.some(object => object.type === 'image' && object.assetId === assetId)) { this.assets = { ...this.assets, [assetId]: { error: String(error instanceof Error ? error.message : error) } }; this.notify() } }
    finally { if (epoch === this.epoch) this.loadingAssets.delete(assetId) }
  }
  importImage(): Promise<void> {
    if (!this.ready || !this.paperId || this.exporting) return Promise.resolve()
    this.finish(); const id = this.paperId, epoch = this.epoch, pending = this.pendingImports
    const task = (async () => {
      const asset = await this.api.importCanvasImage(id)
      if (!asset || epoch !== this.epoch || this.paperId !== id || !this.ready) return
      await this.insertImage(asset)
    })()
    pending.add(task); void task.finally(() => pending.delete(task)).catch(() => undefined); return task
  }
  captureImage(capture: PdfCaptureInput): Promise<void> {
    if (!this.ready || !this.paperId || this.exporting) return Promise.resolve()
    this.finish(); const id = this.paperId, epoch = this.epoch, pending = this.pendingImports, snapshot = structuredClone(capture)
    const task = (async () => {
      const asset = await this.api.saveCanvasCapture(id, snapshot)
      if (epoch !== this.epoch || this.paperId !== id || !this.ready) return
      await this.insertImage(asset)
    })()
    pending.add(task); void task.finally(() => pending.delete(task)).catch(() => undefined); return task
  }
  private async insertImage(asset: CanvasImageAsset) {
    validateCanvasImageAsset(asset)
    const width = Math.min(420, 320 * asset.width / asset.height), height = width * asset.height / asset.width, objectId = crypto.randomUUID()
    this.commit({ ...this.document, objects: [...this.document.objects, { id: objectId, type: 'image', x: 80, y: 80, width, height, assetId: asset.assetId }] }); this.selectedId = objectId; this.mode = 'select'; this.notify()
    await this.loadAsset(asset.assetId)
  }
  async exportPng(raster: (paperId: string, document: CanvasDocument) => Promise<Uint8Array>): Promise<NoteExportResult> {
    if (!this.ready || !this.paperId) throw new Error('Open an imported paper with an available Canvas before exporting')
    if (this.exporting) throw new Error('A Canvas PNG export is already in progress')
    const id = this.paperId, epoch = this.epoch; this.exporting = true; this.finish(); this.notify()
    try {
      await this.flush()
      if (epoch !== this.epoch || id !== this.paperId || !this.ready) throw new Error('Canvas export canceled because the paper changed')
      const bytes = await raster(id, structuredClone(this.document))
      if (epoch !== this.epoch || id !== this.paperId || !this.ready) throw new Error('Canvas export canceled because the paper changed')
      return await this.api.exportCanvasPng(id, bytes)
    } finally { this.exporting = false; this.notify() }
  }
  async flush(): Promise<void> {
    this.finish(); const id = this.paperId, epoch = this.epoch
    if (!id || !this.ready) { await this.writeTail.catch(() => undefined); return }
    while (epoch === this.epoch && this.pendingImports.size) {
      const results = await Promise.allSettled([...this.pendingImports]), failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    }
    if (epoch !== this.epoch || this.paperId !== id || !this.ready) return
    this.finish(); if (this.savedVersion === this.version) { await this.writeTail; return }
    const version = this.version, snapshot = structuredClone(this.document)
    this.status = 'Saving…'; this.notify()
    const task = this.writeTail.catch(() => undefined).then(() => this.api.saveCanvas(id, snapshot)); this.writeTail = task
    try { await task; if (epoch === this.epoch) { this.savedVersion = Math.max(this.savedVersion, version); this.status = this.savedVersion === this.version ? 'Saved locally' : 'Unsaved changes'; this.notify() } }
    catch (error) { if (epoch === this.epoch) { this.status = 'Save failed · changes kept in this session'; this.notify() }; throw error }
  }
  dispose() { this.finish(); this.releaseAssets(); ++this.epoch }
}

/** One production scheduler is shared by the hook and behavior tests. */
export class CanvasAutosave {
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(private session: CanvasSession, private save: () => Promise<void>, private delay = 500) {}
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null }
  schedule() {
    this.stop()
    if (!this.session.ready || this.session.editing || this.session.exporting || this.session.status !== 'Unsaved changes') return
    this.timer = setTimeout(() => {
      this.timer = null
      // A gesture may begin after scheduling; never finish it merely because this delay elapsed.
      if (!this.session.ready || this.session.editing || this.session.exporting || this.session.status !== 'Unsaved changes') return
      void this.save().catch(() => undefined)
    }, this.delay)
  }
}

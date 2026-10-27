import type { CanvasExportOptions, CanvasNotebook, CanvasViewport, NotebookObject, NotebookPage, NotebookTextObject, RichTextDocument } from '../../shared/notebookTypes'
import type { CanvasImageAsset, CanvasImageData, DesktopAPI, PdfCaptureInput } from '../../shared/types'
import type { DiagramArrow, DiagramConnection, DiagramEndpoint, DiagramShape } from '../../shared/diagramTypes'
import { validateCanvasNotebook } from '../../main/notebookValidation'
import { validateCanvasAssetId, validateCanvasImageAsset } from '../../main/canvasValidation'
import { isHexColor } from '../../shared/colors'
import { emptyDiagram, validateMindMapDocument } from '../../main/diagramValidation'
import { computeMindMapLayout } from '../../main/mindMapGeometry'
import { hitStroke } from './annotationEditing'
import { assertNotebookVisibleBounds, notebookContentBounds, notebookWorldLimit } from './notebookGeometry'
import { normalizeRichText, plainRichText, richTextPlain } from './notebookRichText'
import { notebookTextMetrics, rasterNotebookPng, rasterNotebookRegion } from './notebookRaster'

export type NotebookAPI = Pick<DesktopAPI, 'loadCanvasNotebook' | 'saveCanvasNotebook' | 'readCanvasHighlight' | 'loadMindMap' | 'loadMarks' | 'importCanvasImage' | 'saveCanvasCapture' | 'readCanvasImage'>
export interface NotebookPoint { x: number; y: number }
export type NotebookObjectPatch = Partial<{ x: number; y: number; width: number; height: number; text: string; color: string; fontSize: number; comment: string }>
export interface NotebookAsset { url?: string; source?: CanvasImageData['source']; error?: string }
type RectObject = Exclude<NotebookObject, { type: 'stroke' }>
type Gesture = { before: CanvasNotebook; kind: 'move' | 'resize' | 'stroke' | 'erase' | 'text' | 'diagram-move' | 'diagram-resize' | 'arrow-start' | 'arrow-end'; id?: string; start?: NotebookPoint; original?: RectObject | DiagramShape | DiagramArrow; previous?: NotebookPoint }
const newPage = (paperId: string, name: string, width = 1000, height = 1200): NotebookPage => ({ id: crypto.randomUUID(), name, width, height, objects: [], diagram: emptyDiagram(paperId) })
const empty = (): CanvasNotebook => ({ version: 1, paperId: 'unopened', activePageId: '', pages: [] })
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export class NotebookSession {
  paperId: string | null = null
  ready = false
  exporting = false
  importing = 0
  status = 'Open a paper to use Canvas'
  document: CanvasNotebook = empty()
  selectedId: string | null = null
  mode: 'select' | 'draw' | 'erase' = 'select'
  color = '#334155'
  strokeWidth = 4
  legacyInkCount = 0
  assets: Record<string, NotebookAsset> = {}
  private epoch = 0
  private pageEpoch = 0
  private editorCommit: (() => void) | null = null
  private committingEditor = false
  private pageTasks = 0
  private version = 0
  private savedVersion = 0
  private writeTail: Promise<void> = Promise.resolve()
  private gesture: Gesture | null = null
  private past: CanvasNotebook[] = []
  private future: CanvasNotebook[] = []
  constructor(private api: NotebookAPI, private notify = () => undefined, private createUrl = (data: CanvasImageData) => URL.createObjectURL(new Blob([new Uint8Array(data.bytes).buffer], { type: data.mimeType })), private revokeUrl = (url: string) => URL.revokeObjectURL(url), private raster = rasterNotebookPng, private regionRaster = rasterNotebookRegion) {}
  get busy() { return this.importing > 0 || this.exporting || this.pageTasks > 0 }
  get activePage(): NotebookPage | null { return this.document.pages.find(page => page.id === this.document.activePageId) ?? null }
  get infinite() { return this.document.surface === 'infinite' }
  get viewport(): CanvasViewport { return this.activePage?.viewport ?? { x: 0, y: 0, zoom: 1 } }
  private limits() { return { min: this.infinite ? -notebookWorldLimit : 0, x: this.infinite ? notebookWorldLimit : this.activePage!.width, y: this.infinite ? notebookWorldLimit : this.activePage!.height, size: this.infinite ? notebookWorldLimit : Infinity } }
  private placement(x: number, y: number, width = 0, height = 0): NotebookPoint { const v = this.viewport, limits = this.limits(); return this.infinite ? { x: Math.max(limits.min, Math.min(limits.x - width, v.x + x / v.zoom)), y: Math.max(limits.min, Math.min(limits.y - height, v.y + y / v.zoom)) } : { x, y } }
  setViewport(viewport: CanvasViewport) {
    this.writable(); if (![viewport.x, viewport.y, viewport.zoom].every(Number.isFinite) || Math.abs(viewport.x) > notebookWorldLimit || Math.abs(viewport.y) > notebookWorldLimit || viewport.zoom < .000001 || viewport.zoom > 4) throw Error('Invalid Canvas viewport')
    const page = this.activePage!; if (same(page.viewport, viewport)) return
    this.changed({ ...this.document, pages: this.document.pages.map(value => value.id === page.id ? { ...value, viewport: { ...viewport } } : value) })
  }
  private preserveViewports(value: CanvasNotebook): CanvasNotebook { return { ...value, pages: value.pages.map(page => { const camera = this.document.pages.find(current => current.id === page.id)?.viewport; return camera ? { ...page, viewport: { ...camera } } : page }) } }
  get editing() { return this.gesture !== null }
  get dirty() { return this.version !== this.savedVersion }
  get canAutosave() { return this.ready && this.dirty && !this.busy && (!this.gesture || this.gesture.kind === 'text') }
  get canUndo() { return this.ready && !this.exporting && this.past.length > 0 }
  get canRedo() { return this.ready && !this.exporting && this.future.length > 0 }
  private writable(allowImport = false) { if (this.pageTasks && !allowImport && !this.committingEditor) throw Error("Wait for the current page command to finish"); if (this.importing && !allowImport && !this.committingEditor) throw Error("Wait for the current import to finish before editing"); if (!this.ready || !this.paperId || !this.activePage) throw Error('Load the notebook successfully before editing'); if (this.exporting && !this.committingEditor) throw Error('Wait for the current page export to finish') }
  private prepareMutation() { this.writable(); this.finish() }
  private changed(value: CanvasNotebook) { validateCanvasNotebook(value, this.paperId!); this.document = value; ++this.version; this.status = 'Unsaved changes'; this.notify() }
  private history(value: CanvasNotebook) {
    this.past.push(value); this.future = []
    const cost = (v: CanvasNotebook) => v.pages.reduce((sum, page) => sum + page.objects.reduce((n, o) => n + (o.type === 'text' ? o.text.length : o.type === 'quote' ? o.quote.length + o.comment.length : o.type === 'stroke' ? o.points.length * 2 : o.type === 'mindmap' ? o.nodes.reduce((n, node) => n + node.text.length, 0) : 20), 0), 0)
    while (this.past.length > 40 || this.past.length > 1 && this.past.reduce((sum, v) => sum + cost(v), 0) > 2000000) this.past.shift()
  }
  private commit(value: CanvasNotebook, allowImport = false) { this.writable(allowImport); this.finish(); if (same(value, this.document)) return; const before = this.document; this.changed(value); this.history(before); this.notify() }
  private updatePage(value: NotebookPage, gesture = false, allowImport = false) {
    const next = { ...this.document, pages: this.document.pages.map(page => page.id === value.id ? value : page) }
    if (gesture) this.changed(next); else this.commit(next, allowImport)
  }
  registerEditorCommit(commit: () => void) {
    const epoch = this.epoch, pageId = this.activePage?.id
    const owned = () => { if (epoch === this.epoch && pageId === this.activePage?.id) commit() }
    this.editorCommit = owned
    return () => { if (this.editorCommit === owned) this.editorCommit = null }
  }
  finish() {
    if (this.committingEditor) return
    this.committingEditor = true
    try { this.editorCommit?.() } finally { this.committingEditor = false }
    const gesture = this.gesture; this.gesture = null
    if (gesture && !same(gesture.before, this.document)) this.history(gesture.before)
    this.notify()
  }
  private releaseAssets() { for (const value of Object.values(this.assets)) if (value.url) this.revokeUrl(value.url); this.assets = {} }
  async open(paperId: string | null) {
    ++this.pageEpoch; this.finish(); if (this.ready && this.dirty) await this.flush()
    const epoch = ++this.epoch; ++this.pageEpoch; this.releaseAssets(); this.paperId = paperId; this.ready = false; this.selectedId = null; this.mode = 'select'; this.past = []; this.future = []; this.version = this.savedVersion = 0; this.legacyInkCount = 0; this.document = empty(); this.status = paperId ? 'Loading Canvas notebook…' : 'Open a paper to use Canvas'; this.notify()
    if (!paperId) return
    try {
      const value = await this.api.loadCanvasNotebook(paperId)
      if (epoch !== this.epoch) return
      validateCanvasNotebook(value, paperId); this.document = structuredClone(value); this.ready = true; this.status = 'Saved locally'; this.notify(); void this.loadActiveAssets()
      void this.api.loadMarks(paperId).then(marks => { if (epoch === this.epoch) { this.legacyInkCount = marks.strokes.length; this.notify() } }).catch(() => undefined)
    } catch (error) { if (epoch === this.epoch) { this.status = 'Saved notebook unavailable · editing protected'; this.notify() }; throw error }
  }
  async flush(finishEditor = true): Promise<void> {
    if (finishEditor) this.finish()
    const id = this.paperId, epoch = this.epoch
    if (!id || !this.ready) { await this.writeTail; return }
    while (epoch === this.epoch && this.dirty) {
      const version = this.version, snapshot = structuredClone(this.document)
      this.status = 'Saving…'; this.notify()
      const task = this.writeTail.catch(() => undefined).then(() => this.api.saveCanvasNotebook(id, snapshot)); this.writeTail = task
      try { await task; if (epoch === this.epoch) { this.savedVersion = Math.max(this.savedVersion, version); this.status = this.dirty ? 'Unsaved changes' : 'Saved locally'; this.notify() } }
      catch (error) { if (epoch === this.epoch) { this.status = 'Save failed · changes kept in this session'; this.notify() }; throw error }
    }
    await this.writeTail
  }
  private async pageOperation<T>(operation: () => T): Promise<T> {
    if (this.pageTasks) throw Error('Wait for the current page command to finish')
    this.writable(true); const token = this.context(); ++this.pageTasks; this.notify()
    try {
      this.finish(); await this.flush(); this.assertContext(token)
      const value = operation(), changed = this.context()
      await this.flush(); this.assertContext(changed)
      return value
    } finally { --this.pageTasks; this.notify() }
  }
  async switchPage(id: string): Promise<void> {
    if (this.pageTasks) throw Error('Wait for the current page command to finish')
    this.writable(true); const token = this.context(); ++this.pageTasks; this.notify()
    try {
      this.finish(); await this.flush(); this.assertContext(token)
      if (!this.document.pages.some(page => page.id === id)) throw Error('Canvas page is unavailable')
      if (this.document.activePageId === id) return
      const next = { ...this.document, activePageId: id }, snapshot = structuredClone(next)
      this.status = 'Saving…'; this.notify()
      const task = this.writeTail.catch(() => undefined).then(() => this.api.saveCanvasNotebook(token.paperId, snapshot)); this.writeTail = task
      try { await task }
      catch (error) {
        if (this.ready && this.paperId === token.paperId && this.epoch === token.epoch && this.pageEpoch === token.pageEpoch && this.activePage?.id === token.pageId) {
          ++this.version; this.status = 'Save failed · changes kept in this session'; this.notify()
        } else if (this.writeTail === task) this.writeTail = task.catch(() => undefined)
        throw error
      }
      this.assertContext(token)
      this.document = next; this.savedVersion = ++this.version; ++this.pageEpoch; this.selectedId = null
      this.status = 'Saved locally'; this.releaseAssets(); void this.loadActiveAssets(); this.notify()
    } finally { --this.pageTasks; this.notify() }
  }
  async addPage(name = 'Page ' + (this.document.pages.length + 1), width = 1000, height = 1200): Promise<string> {
    return this.pageOperation(() => {
      const page = newPage(this.paperId!, name, width, height); if (this.infinite) page.viewport = { x: 0, y: 0, zoom: 1 }
      this.commit({ ...this.document, activePageId: page.id, pages: [...this.document.pages, page] }, true)
      ++this.pageEpoch; this.selectedId = null; this.releaseAssets(); return page.id
    })
  }
  async deletePage(): Promise<void> {
    this.writable()
    if (this.document.pages.length <= 1) throw Error('At least one Canvas board must remain')
    const token = this.context(); ++this.pageTasks; this.notify()
    try {
      this.finish(); await this.flush(); this.assertContext(token)
      const before = this.document, index = before.pages.findIndex(page => page.id === token.pageId), pages = before.pages.filter(page => page.id !== token.pageId)
      if (!pages.length) throw Error('At least one Canvas board must remain')
      const next = { ...before, pages, activePageId: pages[Math.min(index, pages.length - 1)].id }
      validateCanvasNotebook(next, token.paperId)
      this.status = 'Saving…'; this.notify()
      const task = this.writeTail.catch(() => undefined).then(() => this.api.saveCanvasNotebook(token.paperId, structuredClone(next))); this.writeTail = task
      try { await task } catch (error) {
        if (this.writeTail === task) this.writeTail = task.catch(() => undefined)
        if (this.paperId === token.paperId && this.epoch === token.epoch && this.pageEpoch === token.pageEpoch) { this.status = 'Save failed · source board preserved'; this.notify() }
        throw error
      }
      this.assertContext(token)
      this.document = next; this.history(before); this.savedVersion = ++this.version; ++this.pageEpoch; this.selectedId = null
      this.status = 'Saved locally'; this.releaseAssets(); void this.loadActiveAssets(); this.notify()
    } finally { --this.pageTasks; this.notify() }
  }
  renamePage(id: string, name: string) { this.prepareMutation(); this.commit({ ...this.document, pages: this.document.pages.map(page => page.id === id ? { ...page, name } : page) }) }
  reorderPage(id: string, direction: -1 | 1) {
    this.prepareMutation(); const pages = [...this.document.pages], index = pages.findIndex(page => page.id === id), target = index + direction
    if (index < 0 || target < 0 || target >= pages.length) return
    ;[pages[index], pages[target]] = [pages[target], pages[index]]; this.commit({ ...this.document, pages })
  }
  async duplicatePage(): Promise<string> {
    return this.pageOperation(() => { const original = this.activePage!, page = structuredClone(original), ids = new Map<string, string>()
    const remap = (id: string) => { if (!ids.has(id)) ids.set(id, crypto.randomUUID()); return ids.get(id)! }
    page.id = crypto.randomUUID(); page.name = (original.name + ' copy').slice(0, 120)
    for (const object of page.objects) { object.id = remap(object.id); if (object.type === 'mindmap') { for (const node of object.nodes) remap(node.id); object.nodes = object.nodes.map(node => ({ ...node, id: remap(node.id), parentId: node.parentId === null ? null : remap(node.parentId) })) } }
    for (const item of [...page.diagram.shapes, ...page.diagram.arrows, ...page.diagram.connections]) item.id = remap(item.id)
    for (const item of page.diagram.connections) { item.from.objectId = ids.get(item.from.objectId) ?? item.from.objectId; item.to.objectId = ids.get(item.to.objectId) ?? item.to.objectId }
    this.commit({ ...this.document, activePageId: page.id, pages: [...this.document.pages, page] }, true); ++this.pageEpoch; this.selectedId = null; this.releaseAssets(); void this.loadActiveAssets(); return page.id
    })
  }
  resizePage(width: number, height: number) { this.prepareMutation(); try { const page = { ...this.activePage!, width, height }; if (!this.infinite && (width < this.activePage!.width || height < this.activePage!.height)) assertNotebookVisibleBounds(page); this.updatePage(page) } catch (error) { throw Error("Page resize refused: existing contents must fit within the new page. " + (error instanceof Error ? error.message : String(error))) } }
  select(id: string | null) { this.finish(); this.selectedId = id; this.mode = 'select'; this.notify() }
  setMode(mode: 'select' | 'draw' | 'erase') { this.finish(); this.mode = mode; this.selectedId = null; this.notify() }
  setColor(color: string) { if (!isHexColor(color)) throw Error('Invalid pen color'); this.color = color; this.notify() }
  setStrokeWidth(width: number) { if (!Number.isFinite(width) || width < 1 || width > 20) throw Error('Invalid pen width'); this.strokeWidth = width; this.notify() }
  addText(): string {
    this.prepareMutation(); const page = this.activePage!, id = crypto.randomUUID(), width = this.infinite ? 400 : Math.min(400, page.width - Math.min(80, page.width / 4) - 20), height = this.infinite ? 220 : Math.min(220, page.height - Math.min(80, page.height / 4) - 20), { x, y } = this.placement(Math.min(80, page.width / 4), Math.min(80, page.height / 4), width, height)
    this.updatePage({ ...page, objects: [...page.objects, { id, type: 'text', x, y, width, height, text: '', color: this.color, fontSize: 24 }] }); this.selectedId = id; this.mode = 'select'; this.notify(); return id
  }
  updateObject(id: string, patch: NotebookObjectPatch) {
    this.prepareMutation(); const page = this.activePage!, object = page.objects.find(object => object.id === id)
    if (!object || object.type === 'stroke') return
    let next: RectObject = { ...object }
    for (const key of ['x','y','width','height'] as const) if (patch[key] !== undefined) next[key] = patch[key]!
    if (next.type === 'text') { if (patch.fontSize !== undefined) next.fontSize = patch.fontSize; if (patch.color !== undefined) next.color = patch.color; if (patch.text !== undefined) { next.text = patch.text; next.richText = plainRichText(patch.text) } }
    if (next.type === 'quote') { if (patch.comment !== undefined) next.comment = patch.comment; if (patch.fontSize !== undefined) next.fontSize = patch.fontSize }
    if (next.type === 'mindmap') { const layout = computeMindMapLayout({ version: 1, paperId: this.paperId!, nodes: next.nodes }); if (Math.min(next.width / layout.width, next.height / layout.height) < .75) throw Error('Keep map text readable; enlarge the group instead of shrinking it below 12 px') }
    this.updatePage({ ...page, objects: page.objects.map(value => value.id === id ? next : value) })
  }
  editRichText(id: string, richText: RichTextDocument) {
    this.writable(); const page = this.activePage!, object = page.objects.find(object => object.id === id)
    if (!object || object.type !== 'text') return
    const rich = normalizeRichText(richText); if (object.text === richTextPlain(rich) && same(object.richText ?? plainRichText(object.text), rich)) return; if (this.gesture?.kind !== 'text' || this.gesture.id !== id) { this.finish(); this.gesture = { kind: 'text', id, before: this.document } }
    this.updatePage({ ...page, objects: page.objects.map(value => value.id === id ? { ...object, text: richTextPlain(rich), richText: rich } : value) }, true)
  }
  editText(id: string, text: string) { this.editRichText(id, plainRichText(text)) }
  fitText(id: string) {
    this.prepareMutation(); const object = this.activePage!.objects.find(object => object.id === id)
    if (!object || (object.type !== 'text' && object.type !== 'quote')) return
    const height = Math.ceil(notebookTextMetrics(object).height)
    if (!this.infinite && object.y + height > this.activePage!.height) throw Error('Not enough page space for all text. Enlarge this page or move the object before fitting content.')
    this.updateObject(id, { height })
  }
  editMapNode(id: string, nodeId: string, text: string) {
    this.prepareMutation(); const page = this.activePage!, object = page.objects.find(object => object.id === id)
    if (!object || object.type !== 'mindmap') return
    const old = computeMindMapLayout({ version: 1, paperId: this.paperId!, nodes: object.nodes }), nodes = object.nodes.map(node => node.id === nodeId ? { ...node, text } : node), layout = computeMindMapLayout({ version: 1, paperId: this.paperId!, nodes }), scale = Math.min(object.width / old.width, object.height / old.height)
    const next = { ...object, nodes, width: layout.width * scale, height: layout.height * scale }
    if (!this.infinite && (next.x + next.width > page.width || next.y + next.height > page.height)) throw Error('Edited map no longer fits this page. Enlarge the page or move the map.')
    this.updatePage({ ...page, objects: page.objects.map(value => value.id === id ? next : value) })
  }
  removeSelected() {
    this.prepareMutation(); if (!this.selectedId) return; const page = this.activePage!, id = this.selectedId
    this.updatePage({ ...page, objects: page.objects.filter(object => object.id !== id), diagram: { ...page.diagram, shapes: page.diagram.shapes.filter(item => item.id !== id), arrows: page.diagram.arrows.filter(item => item.id !== id), connections: page.diagram.connections.filter(item => item.id !== id) } }); this.selectedId = null; this.notify()
  }
  private point(at: NotebookPoint): NotebookPoint { if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) throw Error('Invalid Canvas point'); const limits = this.limits(); return { x: Math.max(limits.min, Math.min(limits.x, at.x)), y: Math.max(limits.min, Math.min(limits.y, at.y)) } }
  beginMove(id: string, at: NotebookPoint) {
    this.writable(); this.finish(); const object = this.activePage!.objects.find(object => object.id === id)
    if (!object || object.type === 'stroke') return false
    this.selectedId = id; this.gesture = { kind: 'move', id, before: this.document, start: at, original: object }; this.notify(); return true
  }
  moveTo(at: NotebookPoint) {
    const g = this.gesture; if (!g || g.kind !== 'move') return; const old = g.original as RectObject, page = this.activePage!
    const limits = this.limits(), next = { ...old, x: Math.max(limits.min, Math.min(limits.x - old.width, old.x + at.x - g.start!.x)), y: Math.max(limits.min, Math.min(limits.y - old.height, old.y + at.y - g.start!.y)) }
    this.updatePage({ ...page, objects: page.objects.map(object => object.id === g.id ? next : object) }, true)
  }
  beginResize(id: string, at: NotebookPoint) { if (!this.beginMove(id, at)) return false; this.gesture!.kind = 'resize'; return true }
  resizeTo(at: NotebookPoint) {
    const g = this.gesture; if (!g || g.kind !== 'resize') return; const old = g.original as RectObject, page = this.activePage!
    const limits = this.limits()
    let width = Math.max(40, Math.min(limits.size, limits.x - old.x, old.width + at.x - g.start!.x)), height = Math.max(40, Math.min(limits.size, limits.y - old.y, old.height + at.y - g.start!.y))
    if (old.type === 'image' || old.type === 'mindmap') { const aspect = old.width / old.height; width = Math.min(width, Math.min(limits.size, limits.y - old.y) * aspect); height = width / aspect }
    if (old.type === 'mindmap') { const layout = computeMindMapLayout({ version:1,paperId:this.paperId!,nodes:old.nodes }); if (Math.min(width/layout.width,height/layout.height) < .75) return }
    this.updatePage({ ...page, objects: page.objects.map(object => object.id === g.id ? { ...old, width, height } : object) }, true)
  }
  beginStroke(at: NotebookPoint) {
    this.writable(); this.finish(); const page = this.activePage!, point = this.point(at), id = crypto.randomUUID()
    this.gesture = { kind: 'stroke', id, before: this.document }; this.updatePage({ ...page, objects: [...page.objects, { id, type: 'stroke', color: this.color, strokeWidth: this.strokeWidth, points: [point, { ...point }] }] }, true); this.notify(); return true
  }
  strokeTo(at: NotebookPoint) { const g = this.gesture; if (!g || g.kind !== 'stroke') return; const page = this.activePage!; this.updatePage({ ...page, objects: page.objects.map(object => object.id === g.id && object.type === 'stroke' ? { ...object, points: [...object.points, this.point(at)] } : object) }, true) }
  beginErase(at: NotebookPoint) { this.writable(); this.finish(); this.gesture = { kind: 'erase', before: this.document, previous: this.point(at) }; this.eraseTo(at); this.notify(); return true }
  eraseTo(at: NotebookPoint) {
    const g = this.gesture; if (!g || g.kind !== 'erase') return; const page = this.activePage!, to = this.point(at), normalize = (p: NotebookPoint) => ({ x: p.x / page.width, y: p.y / page.height })
    const objects = page.objects.filter(object => object.type !== 'stroke' || !hitStroke({ id: object.id, color: object.color, width: object.strokeWidth / page.width, points: object.points.map(normalize) }, normalize(g.previous!), normalize(to), page, this.infinite ? 12 / this.viewport.zoom : 12, page.height / page.width))
    g.previous = to; if (objects.length !== page.objects.length) this.updatePage({ ...page, objects }, true)
  }
  addShape(kind: 'rectangle' | 'circle'): string {
    this.prepareMutation(); const page = this.activePage!, id = crypto.randomUUID(), size = this.infinite ? 160 : Math.min(160, page.width - 60, page.height - 60), { x, y } = this.placement(40, 40, size, size)
    this.updatePage({ ...page, diagram: { ...page.diagram, shapes: [...page.diagram.shapes, { id, kind, x, y, width: size, height: size, fill: '#fffbf2', color: this.color, lineWidth: 2 }] } }); this.selectedId = id; this.notify(); return id
  }
  addArrow(): string { this.prepareMutation(); const page = this.activePage!, id = crypto.randomUUID(); this.updatePage({ ...page, diagram: { ...page.diagram, arrows: [...page.diagram.arrows, { id, start: this.placement(60, 180, 260, 0), end: this.infinite ? { x: this.placement(60, 180, 260, 0).x + 260, y: this.placement(60, 180, 260, 0).y } : { x: Math.min(page.width - 40, 320), y: 180 }, color: this.color, lineWidth: 2 }] } }); this.selectedId = id; this.notify(); return id }
  addConnection(from: DiagramEndpoint, to: DiagramEndpoint): string {
    this.prepareMutation(); const page = this.activePage!, id = crypto.randomUUID(); if (from.domain === to.domain && from.objectId === to.objectId) throw Error('Choose different connection endpoints')
    this.updatePage({ ...page, diagram: { ...page.diagram, connections: [...page.diagram.connections, { id, from: { ...from }, to: { ...to }, color: this.color, lineWidth: 2 }] } }); this.selectedId = id; this.notify(); return id
  }
  updateDiagram(id: string, patch: Partial<DiagramShape & DiagramArrow & DiagramConnection>) {
    this.prepareMutation(); const page = this.activePage!, diagram = { ...page.diagram }
    diagram.shapes = diagram.shapes.map(item => item.id === id ? { ...item, ...patch, id, kind: item.kind } : item)
    diagram.arrows = diagram.arrows.map(item => item.id === id ? { ...item, ...patch, id } : item)
    diagram.connections = diagram.connections.map(item => item.id === id ? { ...item, ...patch, id } : item)
    this.updatePage({ ...page, diagram })
  }
  beginDiagram(id: string, at: NotebookPoint, kind: 'move' | 'resize' | 'start' | 'end') {
    this.writable(); this.finish(); const page = this.activePage!, item = [...page.diagram.shapes, ...page.diagram.arrows].find(item => item.id === id)
    if (!item) return false; this.selectedId = id; this.gesture = { before: this.document, id, start: at, original: item, kind: kind === 'move' ? 'diagram-move' : kind === 'resize' ? 'diagram-resize' : kind === 'start' ? 'arrow-start' : 'arrow-end' }; this.notify(); return true
  }
  diagramTo(at: NotebookPoint) {
    const g = this.gesture; if (!g?.original) return; const page = this.activePage!, diagram = { ...page.diagram }, limits = this.limits()
    if ('kind' in g.original) {
      const old = g.original as DiagramShape
      let next = { ...old }
      if (g.kind === 'diagram-move') { next.x = Math.max(limits.min, Math.min(limits.x - old.width, old.x + at.x - g.start!.x)); next.y = Math.max(limits.min, Math.min(limits.y - old.height, old.y + at.y - g.start!.y)) }
      else { next.width = Math.max(20, Math.min(limits.size, limits.x - old.x, old.width + at.x - g.start!.x)); next.height = Math.max(20, Math.min(limits.size, limits.y - old.y, old.height + at.y - g.start!.y)); if (old.kind === 'circle') next.width = next.height = Math.min(next.width, next.height) }
      diagram.shapes = diagram.shapes.map(item => item.id === g.id ? next : item)
    } else if ('start' in g.original) {
      const old = g.original as DiagramArrow; let next = { ...old }
      if (g.kind === 'diagram-move') { const dx = Math.max(limits.min - Math.min(old.start.x, old.end.x), Math.min(limits.x - Math.max(old.start.x, old.end.x), at.x - g.start!.x)), dy = Math.max(limits.min - Math.min(old.start.y, old.end.y), Math.min(limits.y - Math.max(old.start.y, old.end.y), at.y - g.start!.y)); next = { ...old, start: { x: old.start.x + dx, y: old.start.y + dy }, end: { x: old.end.x + dx, y: old.end.y + dy } } }
      else if (g.kind === 'arrow-start') next.start = this.point(at); else if (g.kind === 'arrow-end') next.end = this.point(at)
      diagram.arrows = diagram.arrows.map(item => item.id === g.id ? next : item)
    }
    this.updatePage({ ...page, diagram }, true)
  }
  undo() { this.prepareMutation(); if (!this.canUndo) return; const before = this.past.pop()!; this.future.push(this.document); this.changed(this.preserveViewports(before)); ++this.pageEpoch; this.selectedId = null; this.releaseAssets(); void this.loadActiveAssets() }
  redo() { this.prepareMutation(); if (!this.canRedo) return; const next = this.future.pop()!; this.past.push(this.document); this.changed(this.preserveViewports(next)); ++this.pageEpoch; this.selectedId = null; this.releaseAssets(); void this.loadActiveAssets() }
  private context() { this.writable(true); return { paperId: this.paperId!, pageId: this.activePage!.id, epoch: this.epoch, pageEpoch: this.pageEpoch } }
  private assertContext(token: ReturnType<NotebookSession['context']>) { if (!this.ready || this.paperId !== token.paperId || this.epoch !== token.epoch || this.pageEpoch !== token.pageEpoch || this.activePage?.id !== token.pageId) throw Error('Import cancelled because the paper or Canvas page changed') }
  private async importIntoPage(operation: (token: ReturnType<NotebookSession['context']>) => Promise<void>) {
    this.writable(); const token = this.context(); ++this.importing; this.notify()
    try { this.finish(); await this.flush(); this.assertContext(token); await operation(token) } finally { --this.importing; this.notify() }
  }
  private insert(object: NotebookObject) {
    this.finish(); const page = this.activePage!
    if (!this.infinite && object.type !== 'stroke' && (object.x + object.width > page.width || object.y + object.height > page.height)) throw Error('Not enough space for this content. Enlarge the page or add a larger page; nothing was clipped or inserted.')
    this.updatePage({ ...page, objects: [...page.objects, object] }, false, true); this.selectedId = object.id; this.mode = 'select'; this.notify()
  }
  async importHighlight(highlightId: string): Promise<void> {
    return this.importIntoPage(async token => {
      const source = await this.api.readCanvasHighlight(token.paperId, highlightId); this.assertContext(token); if (source.id !== highlightId) throw Error('Highlight ownership changed')
      const repeated = this.document.pages.some(page => page.objects.some(object => object.type === 'quote' && object.source.highlightId === highlightId))
      const object = { id: crypto.randomUUID(), type: 'quote' as const, ...this.placement(24, 24, 480, 200), width: this.infinite ? 480 : Math.min(480, this.activePage!.width - 48), height: 200, quote: source.quote, comment: source.comment, fontSize: 18, source: { paperId: token.paperId, highlightId, page: source.page, rects: structuredClone(source.rects), importedAt: new Date().toISOString() } }
      object.height = Math.ceil(notebookTextMetrics(object).height)
      this.insert(object); await this.flush(); this.assertContext(token); this.status = repeated ? 'Another independent copy of this highlight was saved' : 'Highlight copy saved · comments edit independently'; this.notify()
    })
  }
  async importMindMap(): Promise<void> {
    return this.importIntoPage(async token => {
      const source = await this.api.loadMindMap(token.paperId); this.assertContext(token); validateMindMapDocument(source, token.paperId); if (!source.nodes.length) throw Error('Start and save a Mind map before importing it')
      const ids = new Map(source.nodes.map(node => [node.id, crypto.randomUUID()])), nodes = source.nodes.map(node => ({ ...node, id: ids.get(node.id)!, parentId: node.parentId === null ? null : ids.get(node.parentId)! })), layout = computeMindMapLayout({ ...source, nodes })
      this.insert({ id: crypto.randomUUID(), type: 'mindmap', ...this.placement(24, 24, layout.width, layout.height), width: layout.width, height: layout.height, nodes, source: { paperId: token.paperId, importedAt: new Date().toISOString() } }); await this.flush(); this.assertContext(token); this.status = 'Editable map copy saved · independent of Mind map'; this.notify()
    })
  }
  async importLegacyInk(): Promise<void> {
    return this.importIntoPage(async token => {
      const source = await this.api.loadMarks(token.paperId); this.assertContext(token); if (!source.strokes.length) throw Error('No legacy ink is saved for this paper')
      const repeated = this.document.pages.some(page => page.name.startsWith('Legacy ink copy'))
      const page = newPage(token.paperId, repeated ? 'Legacy ink copy ' + (this.document.pages.filter(page => page.name.startsWith('Legacy ink copy')).length + 1) : 'Legacy ink copy'), origin = this.infinite ? this.placement(0, 0, 1000, 1200) : { x: 0, y: 0 }; if (this.infinite) page.viewport = { ...this.viewport }
      page.objects = source.strokes.map(stroke => ({ id: crypto.randomUUID(), type: 'stroke', color: stroke.color, strokeWidth: stroke.width * 1000, points: stroke.points.map(point => ({ x: origin.x + point.x * 1000, y: origin.y + point.y * 1200 })) }))
      this.commit({ ...this.document, activePageId: page.id, pages: [...this.document.pages, page] }, true); ++this.pageEpoch; this.selectedId = null; this.releaseAssets(); const saved = this.context(); await this.flush(); this.assertContext(saved); this.status = repeated ? 'Another legacy ink copy saved · originals kept' : 'Legacy ink copied to its own page · originals kept'; this.notify()
    })
  }
  private async insertImage(asset: CanvasImageAsset, token: ReturnType<NotebookSession['context']>) {
    validateCanvasImageAsset(asset); this.assertContext(token); const page = this.activePage!, width = this.infinite ? Math.min(420, 420 * asset.width / asset.height) : Math.min(420, page.width - 48, (page.height - 48) * asset.width / asset.height), height = width * asset.height / asset.width
    this.insert({ id: crypto.randomUUID(), type: 'image', ...this.placement(24, 24, width, height), width, height, assetId: asset.assetId }); await this.loadAsset(asset.assetId); this.assertContext(token); await this.flush(); this.assertContext(token)
  }
  addOwnedImage(assetId: string, point?: NotebookPoint): Promise<void> {
    validateCanvasAssetId(assetId)
    const target = point && { ...point }
    if (target && ![target.x, target.y].every(Number.isFinite)) return Promise.reject(Error('Invalid image drop point'))
    return this.importIntoPage(async token => {
      const resource = await this.api.readCanvasImage(token.paperId, assetId); this.assertContext(token)
      if (resource.assetId !== assetId) throw Error('Image ownership changed')
      const asset = { assetId: resource.assetId, mimeType: resource.mimeType, width: resource.width, height: resource.height }
      validateCanvasImageAsset(asset)
      const page = this.activePage!, width = this.infinite ? Math.min(420, 420 * asset.width / asset.height) : Math.min(420, page.width - 48, (page.height - 48) * asset.width / asset.height), height = width * asset.height / asset.width
      const at = target ?? this.placement(24, 24, width, height)
      this.insert({ id: crypto.randomUUID(), type: 'image', ...at, width, height, assetId })
      const old = this.assets[assetId]?.url; if (old) this.revokeUrl(old)
      this.assets = { ...this.assets, [assetId]: { url: this.createUrl(resource), source: resource.source } }; this.notify()
      await this.flush(); this.assertContext(token)
    })
  }
  importImage(): Promise<void> { return this.importIntoPage(async token => { const asset = await this.api.importCanvasImage(token.paperId); this.assertContext(token); if (asset) await this.insertImage(asset, token) }) }
  captureImage(capture: PdfCaptureInput): Promise<void> { const snapshot = structuredClone(capture); return this.importIntoPage(async token => { const asset = await this.api.saveCanvasCapture(token.paperId, snapshot); await this.insertImage(asset, token) }) }
  private async loadActiveAssets() { const assets = this.activePage?.objects.filter(object => object.type === 'image').map(object => object.assetId) ?? []; await Promise.all(assets.map(id => this.loadAsset(id))) }
  private async loadAsset(assetId: string) {
    const token = this.context(), pageId = token.pageId
    try {
      const resource = await this.api.readCanvasImage(token.paperId, assetId)
      if (this.paperId !== token.paperId || this.epoch !== token.epoch || this.activePage?.id !== pageId || !this.activePage.objects.some(object => object.type === 'image' && object.assetId === assetId)) return
      if (resource.assetId !== assetId) throw Error('Image ownership changed')
      const old = this.assets[assetId]?.url; if (old) this.revokeUrl(old)
      this.assets = { ...this.assets, [assetId]: { url: this.createUrl(resource), source: resource.source } }; this.notify()
    } catch (error) { if (this.paperId === token.paperId && this.epoch === token.epoch && this.activePage?.id === pageId && this.activePage.objects.some(object => object.type === 'image' && object.assetId === assetId)) { this.assets = { ...this.assets, [assetId]: { error: error instanceof Error ? error.message : String(error) } }; this.notify() } }
  }
  retryImage(assetId: string) { return this.loadAsset(assetId) }
  imageUnavailable(assetId: string) { const old = this.assets[assetId]?.url; if (old) this.revokeUrl(old); this.assets = { ...this.assets, [assetId]: { error: 'Saved image could not be displayed; retry it before export' } }; this.notify() }
  async exportPng(): Promise<Uint8Array> {
    this.writable(); const token = this.context(); this.finish()
    this.exporting = true; this.notify()
    try {
      await this.flush(); this.assertContext(token)
      const bytes = await this.raster(token.paperId, structuredClone(this.activePage!), (paperId, assetId) => this.api.readCanvasImage(paperId, assetId))
      this.assertContext(token); return bytes
    } finally { this.exporting = false; this.notify() }
  }
  async exportRegion(options: CanvasExportOptions): Promise<Uint8Array[]> {
    this.writable(); const token = this.context(); this.finish(); this.exporting = true; this.notify()
    try {
      await this.flush(); this.assertContext(token)
      const snapshot = structuredClone(this.activePage!), chosen = { ...structuredClone(options), region: options.scope === 'all' ? notebookContentBounds(snapshot) : { ...options.region } }
      const images = await this.regionRaster(token.paperId, snapshot, chosen, (paperId, assetId) => { this.assertContext(token); return this.api.readCanvasImage(paperId, assetId) })
      this.assertContext(token); if (images.reduce((total, image) => total + image.byteLength, 0) > 64 * 1024 * 1024) throw Error('Canvas export exceeds the 64 MiB image budget'); return images
    } finally { this.exporting = false; this.notify() }
  }
  dispose() { this.finish(); ++this.epoch; ++this.pageEpoch; this.releaseAssets() }
}
export class NotebookAutosave {
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(private session: NotebookSession, private delay = 500) {}
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null }
  schedule() {
    this.stop(); if (!this.session.canAutosave) return
    this.timer = setTimeout(() => { this.timer = null; if (this.session.canAutosave) void this.session.flush(false).catch(() => undefined) }, this.delay)
  }
}





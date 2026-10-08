import type { CanvasDiagram, MindMapDocument } from '../../shared/diagramTypes'
import type { CanvasDocument, DesktopAPI } from '../../shared/types'
import { CanvasSession, type CanvasPoint } from './canvasWorkspace'
import { DiagramSession } from './diagramSession'
import { MindMapSession } from './mindMapSession'
export class CanvasBoards {
  readonly base: CanvasSession
  readonly diagram: DiagramSession
  readonly map: MindMapSession
  boardMode: 'canvas' | 'mind-map' = 'canvas'
  editingDomain: 'base' | 'diagram' = 'base'
  exporting = false
  transitioning = false
  private pointerOwner: 'base' | 'diagram' | null = null
  private epoch = 0
  constructor(api: DesktopAPI, private notify: () => void = () => undefined) { this.base = new CanvasSession(api, notify); this.diagram = new DiagramSession(api, notify); this.map = new MindMapSession(api, notify) }
  get editing() { return this.base.editing || this.diagram.editing || this.map.editing }
  get dirty() { return [this.base, this.diagram, this.map].some(session => session.status === 'Unsaved changes') }
  finish() { this.pointerOwner = null; this.base.finish(); this.diagram.finish(); this.map.finish() }
  private lock(value: boolean) { this.base.exporting = value; this.diagram.exporting = value; this.map.exporting = value }
  async flush() {
    this.finish(); const results = await Promise.allSettled([this.base.flush(), this.diagram.flush(), this.map.flush()])
    const failure = results.find(result => result.status === 'rejected'); if (failure?.status === 'rejected') throw failure.reason
  }
  async open(id: string | null) {
    if (this.exporting) throw new Error('Finish the current canvas export before changing papers')
    const epoch = ++this.epoch
    this.transitioning = true; this.lock(true); this.notify()
    try {
      await this.flush(); if (epoch !== this.epoch) return; this.lock(false)
      const results = await Promise.allSettled([this.base.open(id), this.diagram.open(id), this.map.open(id)])
      if (epoch !== this.epoch) return
      const failure = results.find(result => result.status === 'rejected'); if (failure?.status === 'rejected') throw failure.reason
    } finally { if (epoch === this.epoch) { this.transitioning = false; this.lock(false); this.notify() } }
  }
  async setBoardMode(mode: 'canvas' | 'mind-map') {
    if (this.exporting || this.transitioning || mode === this.boardMode) return
    const epoch = ++this.epoch
    this.transitioning = true; this.lock(true); this.notify()
    try { await this.flush(); if (epoch === this.epoch) this.boardMode = mode }
    finally { if (epoch === this.epoch) { this.transitioning = false; this.lock(false); this.notify() } }
  }
  chooseDomain(domain: 'base' | 'diagram') { if (this.exporting || this.transitioning) return; this.finish(); this.editingDomain = domain; if (domain === 'diagram') { this.base.select(null); this.base.setMode('select') } else this.diagram.select(null); this.notify() }
  beginBase(kind: 'move' | 'resize' | 'draw' | 'erase', point: CanvasPoint, id?: string) {
    if (this.pointerOwner || this.exporting || this.transitioning) return false
    this.chooseDomain('base')
    const started = kind === 'move' ? this.base.beginMove(id!, point) : kind === 'resize' ? this.base.beginResize(id!, point) : kind === 'draw' ? this.base.beginStroke(point) : this.base.beginErase(point)
    if (started) this.pointerOwner = 'base'; return started
  }
  beginDiagram(kind: 'move' | 'resize' | 'start' | 'end', id: string, point: CanvasPoint) {
    if (this.pointerOwner || this.exporting || this.transitioning) return false
    this.chooseDomain('diagram')
    const started = kind === 'move' ? this.diagram.beginMove(id, point) : kind === 'resize' ? this.diagram.beginResize(id, point) : this.diagram.beginArrowEnd(id, kind)
    if (started) this.pointerOwner = 'diagram'; return started
  }
  async exportPng(canvasRaster: (id: string, base: CanvasDocument, diagram: CanvasDiagram) => Promise<Uint8Array>, mapRaster: (document: MindMapDocument) => Promise<Uint8Array>): Promise<Uint8Array> {
    if (this.exporting || this.transitioning) throw new Error('A canvas operation is already in progress')
    const mode = this.boardMode, id = this.base.paperId, epoch = this.epoch
    if (!id || (mode === 'canvas' ? !this.base.ready || !this.diagram.ready : !this.map.ready)) throw new Error('Load the selected board successfully before exporting; saved data is protected')
    this.exporting = true; this.lock(true); this.finish(); this.notify()
    try {
      await this.flush()
      if (epoch !== this.epoch || id !== this.base.paperId) throw new Error('Board export canceled because the editor closed or paper changed')
      const base = structuredClone(this.base.document), diagram = structuredClone(this.diagram.document), map = structuredClone(this.map.document)
      const bytes = mode === 'canvas' ? await canvasRaster(id, base, diagram) : await mapRaster(map)
      if (epoch !== this.epoch || id !== this.base.paperId) throw new Error('Board export canceled because the editor closed or paper changed')
      return bytes
    } finally { this.exporting = false; this.lock(false); this.notify() }
  }
  dispose() { this.epoch++; this.finish(); this.base.dispose(); this.diagram.dispose(); this.map.dispose() }
}

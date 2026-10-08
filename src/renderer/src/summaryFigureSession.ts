import type { DesktopAPI, NormalizedRect, PaperSourceEntry, SummaryFigureCapture, SummaryFigures } from '../../shared/types'
import { captureRect, type Point } from './pdfInteraction'

export function matchingFigureCrop(manifest: SummaryFigures | null, entry: PaperSourceEntry, page: number) {
  return entry.kind === 'figure' && entry.pages.includes(page) ? manifest?.crops.find(crop => crop.entryId === entry.id && crop.caption === entry.text && crop.page === page) ?? null : null
}

/** The full rotated/cropped PDF viewport fits a bounded raster; no figure boundaries are inferred. */
export function figurePreviewGeometry(viewport: { width: number; height: number }) {
  if (![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid PDF page dimensions.')
  const scale = Math.min(1600 / viewport.width, 1800 / viewport.height)
  return { width: Math.max(1, Math.floor(viewport.width * scale)), height: Math.max(1, Math.floor(viewport.height * scale)), scale }
}

/** Percent inputs provide a keyboard alternative to dragging a crop. */
export function updateFigureCrop(rect: NormalizedRect, field: keyof NormalizedRect, percent: number): NormalizedRect | null {
  if (!Number.isFinite(percent)) return null
  if (field === 'x' || field === 'y') {
    const position = Math.max(0, Math.min(.99, percent / 100))
    const extent = field === 'x' ? 'width' : 'height'
    return { ...rect, [field]: position, [extent]: Math.min(rect[extent], 1 - position) }
  }
  const maximum = field === 'width' ? 1 - rect.x : 1 - rect.y
  return { ...rect, [field]: Math.min(maximum, Math.max(.01, percent / 100)) }
}

export function figureCropFromPointer(start: Point, pointer: Point, bounds: { left: number; top: number; width: number; height: number }, minimum: number) {
  return captureRect({ x: start.x * bounds.width, y: start.y * bounds.height }, { x: pointer.x - bounds.left, y: pointer.y - bounds.top }, bounds, minimum)
}

export function figureDialogTabTarget<T>(controls: readonly T[], active: T | null, reverse: boolean): T | 'dialog' | null {
  if (!controls.length) return 'dialog'
  const first = controls[0], last = controls[controls.length - 1]
  if (active === null || !controls.includes(active)) return reverse ? last : first
  return reverse && active === first ? last : !reverse && active === last ? first : null
}

type FigureAPI = Pick<DesktopAPI, 'loadSummaryFigures' | 'saveSummaryFigure' | 'resetSummaryFigure'>
/** Load failures never turn into an editable empty document; late writes retain their original identity. */
export class SummaryFigureEdits {
  private paperId = ''
  private epoch = 0
  ready = false
  busy = false
  constructor(private api: FigureAPI) {}
  async open(paperId: string): Promise<SummaryFigures | null> {
    const epoch = ++this.epoch; this.paperId = paperId; this.ready = false; this.busy = false
    try {
      const result = await this.api.loadSummaryFigures(paperId)
      if (epoch !== this.epoch) return null
      if (result.paperId !== paperId) throw new Error('Saved figure ownership does not match this paper.')
      this.ready = true; return result
    } catch (error) { if (epoch === this.epoch) throw error; return null }
  }
  close() { ++this.epoch; this.paperId = ''; this.ready = false; this.busy = false }
  private async mutate(operation: (paperId: string) => Promise<SummaryFigures>) {
    if (!this.ready || !this.paperId) throw new Error('Load saved figures successfully before editing.')
    if (this.busy) throw new Error('A figure change is already in progress.')
    const paperId = this.paperId, epoch = this.epoch
    this.busy = true
    try {
      const value = await operation(paperId)
      if (epoch !== this.epoch) return null
      if (value.paperId !== paperId) throw new Error('Saved figure ownership does not match this paper.')
      return value
    } catch (error) { if (epoch === this.epoch) throw error; return null }
    finally { if (epoch === this.epoch) this.busy = false }
  }
  save(capture: SummaryFigureCapture) {
    const snapshot = { ...capture, rect: { ...capture.rect }, bytes: new Uint8Array(capture.bytes) }
    return this.mutate(id => this.api.saveSummaryFigure(id, snapshot))
  }
  reset(entryId: string) { return this.mutate(id => this.api.resetSummaryFigure(id, entryId)) }
}

interface FigurePage { cleanup(): unknown }
interface FigureDocument<P extends FigurePage> { numPages: number; getPage(page: number): Promise<P> }
interface PdfTask<T> { promise: Promise<T>; destroy(): Promise<void> }
interface RenderTask { promise: Promise<unknown>; cancel(): void }
type PdfJob<P extends FigurePage> = { task: PdfTask<FigureDocument<P>> | null; document: FigureDocument<P> | null; destruction: Promise<void> | null }

/** One independently owned PDF and at most one active raster, opened only when its gallery is visible. */
export class FigurePdfSession<P extends FigurePage> {
  private job: PdfJob<P> | null = null
  private renderEpoch = 0
  private raster: RenderTask | null = null
  private settling: Promise<void> = Promise.resolve()
  constructor(private read: (paperId: string) => Promise<Uint8Array>, private create: (bytes: Uint8Array) => PdfTask<FigureDocument<P>>) {}
  private destroy(job: PdfJob<P>) { return job.task ? job.destruction ??= job.task.destroy().catch(() => undefined) : Promise.resolve() }
  async open(paperId: string): Promise<FigureDocument<P> | null> {
    void this.close()
    const job: PdfJob<P> = { task: null, document: null, destruction: null }; this.job = job
    try {
      const bytes = await this.read(paperId)
      if (this.job !== job) return null
      job.task = this.create(new Uint8Array(bytes))
      const document = await job.task.promise
      if (this.job !== job) { await this.destroy(job); return null }
      job.document = document; return document
    } catch (error) {
      if (this.job !== job) return null
      this.job = null; await this.destroy(job); throw error
    }
  }
  cancelRender() {
    ++this.renderEpoch
    const render = this.raster; this.raster = null
    if (render) {
      this.settling = Promise.allSettled([this.settling, render.promise]).then(() => undefined)
      render.cancel()
    }
  }
  async close() { this.cancelRender(); const job = this.job; this.job = null; if (job) await this.destroy(job) }
  async render(number: number, draw: (page: P) => RenderTask): Promise<boolean> {
    this.cancelRender()
    const epoch = this.renderEpoch, job = this.job, document = job?.document
    if (!document || !Number.isSafeInteger(number) || number < 1 || number > document.numPages) throw new Error('This figure source page is unavailable.')
    const current = () => this.job === job && epoch === this.renderEpoch
    let page: P | null = null
    try {
      await this.settling
      if (!current()) return false
      page = await document.getPage(number)
      if (!current()) return false
      const render = draw(page); this.raster = render
      await render.promise
      return current()
    } catch (error) { if (current()) throw error; return false }
    finally { page?.cleanup(); if (current()) this.raster = null }
  }
}

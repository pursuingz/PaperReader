import type { NormalizedRect } from '../../shared/types'

export type PdfInteractionMode = 'read' | 'hand' | 'capture'
export interface Point { x: number; y: number }
interface Size { width: number; height: number }
export const PDF_CAPTURE_BYTE_LIMIT = 10 * 1024 * 1024
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

export function captureRect(start: Point, end: Point, size: Size, minimum = 8): NormalizedRect | null {
  if (![start.x, start.y, end.x, end.y, size.width, size.height, minimum].every(Number.isFinite) || size.width <= 0 || size.height <= 0 || minimum <= 0) return null
  const left = clamp(Math.min(start.x, end.x), 0, size.width), right = clamp(Math.max(start.x, end.x), 0, size.width)
  const top = clamp(Math.min(start.y, end.y), 0, size.height), bottom = clamp(Math.max(start.y, end.y), 0, size.height)
  if (right - left < minimum || bottom - top < minimum) return null
  const x = left / size.width, y = top / size.height
  return { x, y, width: Math.min(1 - x, (right - left) / size.width), height: Math.min(1 - y, (bottom - top) / size.height) }
}

export function rasterCrop(rect: NormalizedRect, raster: Size) {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1 || rect.y + rect.height > 1) throw new Error('Choose a valid rectangle inside the PDF page.')
  if (![raster.width, raster.height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('The PDF raster is not ready.')
  const pixel = (value: number) => Math.abs(value - Math.round(value)) < 1e-7 ? Math.round(value) : value
  const sourceX = Math.floor(pixel(rect.x * raster.width)), sourceY = Math.floor(pixel(rect.y * raster.height))
  const sourceWidth = Math.min(raster.width, Math.ceil(pixel((rect.x + rect.width) * raster.width))) - sourceX
  const sourceHeight = Math.min(raster.height, Math.ceil(pixel((rect.y + rect.height) * raster.height))) - sourceY
  const scale = Math.min(1, 4096 / sourceWidth, 4096 / sourceHeight, Math.sqrt(16000000 / (sourceWidth * sourceHeight)))
  return { sourceX, sourceY, sourceWidth, sourceHeight, width: Math.max(1, Math.floor(sourceWidth * scale)), height: Math.max(1, Math.floor(sourceHeight * scale)) }
}

export function panScroll(start: Point & { left: number; top: number }, pointer: Point, area: { scrollWidth: number; scrollHeight: number; clientWidth: number; clientHeight: number }) {
  return { left: clamp(start.left + start.x - pointer.x, 0, Math.max(0, area.scrollWidth - area.clientWidth)), top: clamp(start.top + start.y - pointer.y, 0, Math.max(0, area.scrollHeight - area.clientHeight)) }
}

/** Modal dialogs own Escape even while a PDF selection remains underneath them. */
export function shouldDismissPdfCapture(event: { key: string; defaultPrevented: boolean }, selectionActive: boolean, visibleModal: boolean): boolean {
  return event.key === 'Escape' && !event.defaultPrevented && selectionActive && !visibleModal
}

export interface CaptureTicket { frame: number; capture: number }
/** PDF raster identity and async crop identity are independently invalidated. */
export class PdfRenderLifecycle {
  private context: { file: object | undefined; page: number; width: number; pixelRatio: number } | null = null
  private frame = 0
  private ready = 0
  private capture = 0
  private mode: PdfInteractionMode = 'read'
  update(file: object | undefined, page: number, width: number, mode: PdfInteractionMode, pixelRatio = 1): number {
    if (!this.context || this.context.file !== file || this.context.page !== page || this.context.width !== width || this.context.pixelRatio !== pixelRatio) {
      this.context = { file, page, width, pixelRatio }; ++this.frame; this.ready = 0; ++this.capture
    }
    if (this.mode !== mode) { this.mode = mode; ++this.capture }
    return this.frame
  }
  rendered(frame: number): boolean {
    if (!this.context?.file || frame !== this.frame || !Number.isFinite(this.context.width) || this.context.width <= 0 || !Number.isSafeInteger(this.context.page) || this.context.page < 1) return false
    this.ready = frame; return true
  }
  failed(frame: number): boolean { if (!this.context || frame !== this.frame) return false; this.ready = 0; ++this.capture; return true }
  beginCapture(frame: number): CaptureTicket | null {
    return this.mode === 'capture' && this.ready === frame && this.frame === frame && this.context ? { frame, capture: ++this.capture } : null
  }
  current(ticket: CaptureTicket): boolean { return Boolean(this.context && this.mode === 'capture' && ticket.frame === this.frame && this.ready === this.frame && ticket.capture === this.capture) }
  cancelCapture() { ++this.capture }
  dispose() { this.context = null; ++this.frame; this.ready = 0; ++this.capture }
}

/** Draws only PDF.js's raster canvas, never the DOM, highlights or tool overlays. */
export async function capturePdfRaster(source: HTMLCanvasElement, rect: NormalizedRect, current: () => boolean, createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')): Promise<Uint8Array | null> {
  const crop = rasterCrop(rect, source), target = createCanvas()
  let width = crop.width, height = crop.height
  try {
    for (let pass = 0; pass < 8; pass++) {
      if (!current()) return null
      target.width = width; target.height = height
      const context = target.getContext('2d')
      if (!context) throw new Error('The PDF capture canvas could not be created.')
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
      context.drawImage(source, crop.sourceX, crop.sourceY, crop.sourceWidth, crop.sourceHeight, 0, 0, width, height)
      const blob = await new Promise<Blob>((resolve, reject) => target.toBlob(value => value ? resolve(value) : reject(new Error('The PDF selection could not be encoded as PNG.')), 'image/png'))
      if (!current()) return null
      if (blob.size <= PDF_CAPTURE_BYTE_LIMIT) {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        return current() ? bytes : null
      }
      const scale = Math.min(.8, Math.sqrt(PDF_CAPTURE_BYTE_LIMIT / blob.size) * .9)
      const smallerWidth = Math.max(1, Math.floor(width * scale)), smallerHeight = Math.max(1, Math.floor(height * scale))
      if (smallerWidth === width && smallerHeight === height) break
      width = smallerWidth; height = smallerHeight
    }
    throw new Error('This selection could not fit the 10 MiB image limit. Select a smaller area.')
  } finally { target.width = 0; target.height = 0 }
}

import type { CanvasImageSource, PdfCaptureInput } from '../shared/types'
import { object } from './validation'
import { inspectCanvasImage, validateCanvasAssetId, validateCanvasPaperId } from './canvasValidation'

export type NativeCanvasDecode = (bytes: Uint8Array) => { width: number; height: number } | null
const fields = (value: Record<string, unknown>, allowed: string[]) => { if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid canvas source fields') }
export function validateCanvasSource(value: unknown): asserts value is CanvasImageSource {
  object(value); fields(value, ['page', 'rect'])
  if (!Number.isSafeInteger(value.page) || (value.page as number) < 1 || (value.page as number) > 100000) throw new Error('Invalid capture source page')
  object(value.rect); fields(value.rect, ['x', 'y', 'width', 'height'])
  for (const name of ['x', 'y', 'width', 'height']) if (typeof value.rect[name] !== 'number' || !Number.isFinite(value.rect[name]) || (value.rect[name] as number) < 0 || (value.rect[name] as number) > 1) throw new Error('Invalid capture source rectangle')
  if ((value.rect.width as number) <= 0 || (value.rect.height as number) <= 0 || (value.rect.x as number) + (value.rect.width as number) > 1 + 1e-9 || (value.rect.y as number) + (value.rect.height as number) > 1 + 1e-9) throw new Error('Invalid capture source rectangle bounds')
}
export function validatePdfCaptureInput(value: unknown): asserts value is PdfCaptureInput {
  object(value); fields(value, ['page', 'rect', 'bytes']); validateCanvasSource({ page: value.page, rect: value.rect })
  if (!(value.bytes instanceof Uint8Array) || inspectCanvasImage(value.bytes).mimeType !== 'image/png') throw new Error('PDF captures must contain a bounded PNG image')
}
export function validateCanvasSourceRecord(value: unknown, paperId: string, assetId: string): asserts value is CanvasImageSource & { paperId: string; assetId: string } {
  object(value); fields(value, ['paperId', 'assetId', 'page', 'rect']); validateCanvasPaperId(value.paperId); validateCanvasAssetId(value.assetId)
  if (value.paperId !== paperId || value.assetId !== assetId) throw new Error('Invalid capture source ownership')
  validateCanvasSource({ page: value.page, rect: value.rect })
}
export function validateCanvasNativeDecode(bytes: Uint8Array, decode?: NativeCanvasDecode): void {
  if (!decode) return
  const info = inspectCanvasImage(bytes)
  let decoded: ReturnType<NativeCanvasDecode>
  try { decoded = decode(bytes) } catch { decoded = null }
  if (!decoded || decoded.width !== info.width || decoded.height !== info.height) throw new Error('The capture image could not be decoded with valid dimensions')
}

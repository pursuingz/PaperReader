import type { CanvasDocument, CanvasImageAsset } from '../shared/types'
import { object, validId } from './validation'

export const canvasColors = ['#334155', '#ed6376', '#4b8f82'] as const
export const canvasImageLimit = 10 * 1024 * 1024
export function validateCanvasPaperId(value: unknown): asserts value is string {
  validId(value)
  if (['constructor', '__proto__', 'prototype'].includes(value.toLowerCase())) throw new Error('Invalid canvas identifier')
}
export function validateCanvasAssetId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error('Invalid canvas asset identifier')
}
function fields(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid canvas fields') }
function finite(value: unknown, min: number, max: number): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid canvas geometry') }
function color(value: unknown) { if (!canvasColors.includes(value as typeof canvasColors[number])) throw new Error('Invalid canvas color') }
export function validateCanvasDocument(value: unknown): asserts value is CanvasDocument {
  object(value); fields(value, ['version', 'width', 'height', 'objects'])
  if (value.version !== 1 || value.width !== 1000 || value.height !== 1200 || !Array.isArray(value.objects) || value.objects.length > 500) throw new Error('Invalid canvas document or object limit')
  const ids = new Set<string>(); let textCount = 0, pointCount = 0
  for (const item of value.objects) {
    object(item); validateCanvasPaperId(item.id)
    if (ids.has(item.id)) throw new Error('Invalid duplicate canvas identifier'); ids.add(item.id)
    if (item.type === 'stroke') {
      fields(item, ['id', 'type', 'points', 'color', 'strokeWidth']); color(item.color); finite(item.strokeWidth, 1, 20)
      if (!Array.isArray(item.points) || item.points.length < 2 || item.points.length > 10000) throw new Error('Invalid canvas stroke points or point limit')
      pointCount += item.points.length; if (pointCount > 200000) throw new Error('Canvas point limit exceeded')
      for (const point of item.points) { object(point); fields(point, ['x', 'y']); finite(point.x, 0, 1000); finite(point.y, 0, 1200) }
    } else if (item.type === 'text' || item.type === 'image') {
      fields(item, item.type === 'text' ? ['id', 'type', 'x', 'y', 'width', 'height', 'text', 'color', 'fontSize'] : ['id', 'type', 'x', 'y', 'width', 'height', 'assetId'])
      finite(item.x, 0, 1000); finite(item.y, 0, 1200); finite(item.width, Number.MIN_VALUE, 1000); finite(item.height, Number.MIN_VALUE, 1200)
      if (item.x + item.width > 1000 || item.y + item.height > 1200) throw new Error('Canvas object extends beyond the page')
      if (item.type === 'text') {
        if (typeof item.text !== 'string' || item.text.length > 100000) throw new Error('Invalid canvas text or text limit')
        textCount += item.text.length; if (textCount > 500000) throw new Error('Canvas text limit exceeded')
        color(item.color); finite(item.fontSize, 12, 80)
      } else validateCanvasAssetId(item.assetId)
    } else throw new Error('Invalid canvas object type')
  }
}
export function validateCanvasImageInfo(value: unknown): asserts value is Omit<CanvasImageAsset, 'assetId'> {
  object(value); fields(value, ['mimeType', 'width', 'height'])
  if (!['image/png', 'image/jpeg'].includes(value.mimeType as string) || !Number.isInteger(value.width) || !Number.isInteger(value.height)) throw new Error('Invalid canvas image information')
  if ((value.width as number) < 1 || (value.width as number) > 4096 || (value.height as number) < 1 || (value.height as number) > 4096) throw new Error('Canvas image dimensions must be 1–4096 pixels')
  if ((value.width as number) * (value.height as number) > 16000000) throw new Error('Canvas image pixel limit exceeded')
}
export function validateCanvasImageAsset(value: unknown): asserts value is CanvasImageAsset {
  object(value); fields(value, ['assetId', 'mimeType', 'width', 'height']); validateCanvasAssetId(value.assetId)
  validateCanvasImageInfo({ mimeType: value.mimeType, width: value.width, height: value.height })
}
/** Inspect only local bytes. Native image decoding is independently required by the picker. */
export function inspectCanvasImage(bytes: Uint8Array): Omit<CanvasImageAsset, 'assetId'> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12 || bytes.byteLength > canvasImageLimit) throw new Error('Canvas image is empty, invalid or larger than 10 MiB')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0, height = 0, mimeType: 'image/png' | 'image/jpeg'
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    mimeType = 'image/png'; let position = 8, header = false, image = false, ended = false, chunks = 0
    while (position + 12 <= bytes.length && ++chunks <= 10000) {
      const length = view.getUint32(position), end = position + 12 + length
      if (end > bytes.length) throw new Error('Truncated PNG image')
      const kind = String.fromCharCode(...bytes.subarray(position + 4, position + 8))
      if (!header) {
        if (kind !== 'IHDR' || length !== 13) throw new Error('Invalid PNG image header')
        width = view.getUint32(position + 8); height = view.getUint32(position + 12)
        const depth = bytes[position + 16], mode = bytes[position + 17]
        const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
        if (!depths[mode]?.includes(depth) || bytes[position + 18] !== 0 || bytes[position + 19] !== 0 || bytes[position + 20] > 1) throw new Error('Invalid PNG image encoding')
        validateCanvasImageInfo({ mimeType, width, height }); header = true
      } else if (kind === 'IHDR') throw new Error('Invalid duplicate PNG header')
      if (kind === 'IDAT' && length > 0) image = true
      if (kind === 'IEND') { if (length !== 0 || end !== bytes.length) throw new Error('Invalid PNG image ending'); ended = true; break }
      position = end
    }
    if (!header || !image || !ended) throw new Error('Incomplete PNG image')
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    mimeType = 'image/jpeg'; let position = 2, scanned = false
    while (position < bytes.length) {
      if (bytes[position++] !== 0xff) throw new Error('Invalid JPEG image marker')
      while (bytes[position] === 0xff) position++
      const marker = bytes[position++]
      if (marker === undefined || marker === 0xd9 || marker === 0x00 || marker === 0xd8) throw new Error('Incomplete JPEG image')
      if (marker >= 0xd0 && marker <= 0xd7 || marker === 0x01) continue
      if (position + 2 > bytes.length) throw new Error('Truncated JPEG image')
      const length = view.getUint16(position), end = position + length
      if (length < 2 || end > bytes.length) throw new Error('Truncated JPEG image segment')
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 11 || bytes[position + 7] < 1 || bytes[position + 7] > 4 || length !== 8 + 3 * bytes[position + 7]) throw new Error('Invalid JPEG image dimensions')
        height = view.getUint16(position + 3); width = view.getUint16(position + 5); validateCanvasImageInfo({ mimeType, width, height })
      }
      if (marker === 0xda) { scanned = true; if (!width || !height || length < 6 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new Error('Incomplete JPEG image data'); break }
      position = end
    }
    if (!scanned) throw new Error('Incomplete JPEG image')
  } else throw new Error('Choose a PNG or JPEG image; SVG and other formats are not supported')
  const information = { mimeType, width, height }; validateCanvasImageInfo(information); return information
}

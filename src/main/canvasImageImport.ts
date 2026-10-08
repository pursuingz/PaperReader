import { readFile, stat } from 'node:fs/promises'
import type { CanvasImageAsset } from '../shared/types'
import { inspectCanvasImage } from './canvasValidation'

/** Validate dimensions before handing a user-picked file to the native decoder. */
export async function prepareCanvasImage(
  path: string,
  decode: (bytes: Uint8Array) => { width: number; height: number } | null
): Promise<{ bytes: Uint8Array; info: Omit<CanvasImageAsset, 'assetId'> }> {
  const details = await stat(path).catch(() => { throw new Error('The chosen image file is unavailable. Choose it again.') })
  if (!details.isFile()) throw new Error('Choose a PNG or JPEG image file.')
  if (details.size > 10 * 1024 * 1024) throw new Error('Canvas images support up to 10 MiB.')
  const bytes = new Uint8Array(await readFile(path).catch(() => { throw new Error('The chosen image file could not be read. Choose it again.') }))
  const info = inspectCanvasImage(bytes)
  let pixels: { width: number; height: number } | null
  try { pixels = decode(bytes) } catch { pixels = null }
  if (!pixels || pixels.width !== info.width || pixels.height !== info.height) {
    throw new Error('The image could not be decoded with valid dimensions. Choose another PNG or JPEG.')
  }
  return { bytes, info }
}

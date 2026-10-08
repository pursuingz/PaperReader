import { realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { NoteExportResult } from '../shared/types'
import { inspectCanvasImage } from './canvasValidation'
import { validateCanvasNativeDecode, type NativeCanvasDecode } from './canvasCaptureValidation'
import { readingExportFileName } from './readingExport'
import type { ChooseCanvasPngPath } from './canvasPngExport'
export const mindMapPngFileName = (title: string) => readingExportFileName(title).replace(/-reading-notes\.md$/, '-mind-map.png')
function within(root: string, candidate: string) { const path = relative(root, candidate); return path === '' || path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path) }
export async function saveMindMapPngExport(bytes: Uint8Array, suggestedName: string, dataRoot: string, choosePath: ChooseCanvasPngPath, nativeDecode?: NativeCanvasDecode): Promise<NoteExportResult> {
  const info = inspectCanvasImage(bytes)
  if (info.mimeType !== 'image/png') throw new Error('Mind map export requires PNG bytes')
  const snapshot = new Uint8Array(bytes); validateCanvasNativeDecode(snapshot, nativeDecode)
  const selection = await choosePath(suggestedName)
  if (selection.canceled || !selection.filePath) return { canceled: true }
  const filePath = selection.filePath
  if (!isAbsolute(filePath) || extname(filePath).toLowerCase() !== '.png' || /[<>:"|?*\u0000-\u001f]/.test(basename(filePath)) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(basename(filePath))) throw new Error('Choose a new file at an absolute path ending in .png')
  const destination = resolve(filePath), root = resolve(dataRoot)
  if (within(root, destination)) throw new Error('Choose a PNG destination outside internal application data')
  let actualParent: string, actualRoot: string
  try { [actualParent, actualRoot] = await Promise.all([realpath(dirname(destination)), realpath(root)]) } catch { throw new Error('The PNG could not be saved. Choose an existing writable folder.') }
  if (within(actualRoot, resolve(actualParent, basename(destination)))) throw new Error('Choose a PNG destination outside internal application data')
  try { await writeFile(destination, snapshot, { flag: 'wx', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('This file already exists. Choose a new PNG name to preserve it.'); throw new Error('The PNG could not be saved. Choose a writable folder and a new file name.') }
  return { canceled: false, fileName: basename(destination) }
}

import { realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import type { CanvasExportOptions, NotebookPage } from '../shared/notebookTypes'
import type { NoteExportResult } from '../shared/types'
import { canvasExportPlan } from '../shared/canvasViewport'
import { inspectCanvasImage } from './canvasValidation'
import { validateCanvasNativeDecode, type NativeCanvasDecode } from './canvasCaptureValidation'
import type { ChooseCanvasPngPath } from './canvasPngExport'
import { validateCanvasNotebook } from './notebookValidation'

function within(root: string, candidate: string): boolean { const path = relative(root, candidate); return path === '' || path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path) }
function validatePage(page: NotebookPage): void {
  validateCanvasNotebook({ version: 1, surface: 'infinite', paperId: page?.diagram?.paperId, activePageId: page?.id, pages: [page] })
  const targets = { base: new Set(page.objects.filter(item => item.type !== 'stroke').map(item => item.id)), shape: new Set(page.diagram.shapes.map(item => item.id)) }
  for (const connection of page.diagram.connections) for (const endpoint of [connection.from, connection.to]) if (!targets[endpoint.domain].has(endpoint.objectId)) throw new Error('Canvas export has a missing connection endpoint. Restore or remove the invalid connection before exporting.')
}
export async function saveInfiniteNotebookExport(images: Uint8Array[], suggestedName: string, dataRoot: string, page: NotebookPage, options: CanvasExportOptions, choosePath: ChooseCanvasPngPath, nativeDecode?: NativeCanvasDecode): Promise<NoteExportResult> {
  const plan = canvasExportPlan(options), format = options.format
  validatePage(page)
  if (!Array.isArray(images) || images.length !== plan.length) throw new Error('Canvas export tile count does not match the selected region')
  let totalBytes = 0
  for (const image of images) {
    if (!(image instanceof Uint8Array)) throw new Error('Canvas export tiles must contain PNG image bytes')
    totalBytes += image.byteLength
    if (totalBytes > 64 * 1024 * 1024) throw new Error('Canvas export exceeds the 64 MiB total PNG input limit')
  }
  const snapshots = images.map((image, index) => {
    const snapshot = new Uint8Array(image), info = inspectCanvasImage(snapshot), expected = plan[index]
    if (info.mimeType !== 'image/png' || info.width !== expected.width || info.height !== expected.height) throw new Error(`Canvas export PNG tile ${index + 1} must have dimensions ${expected.width}×${expected.height}`)
    validateCanvasNativeDecode(snapshot, nativeDecode)
    return snapshot
  })
  let output: Uint8Array
  if (format === 'png') output = snapshots[0]
  else {
    const document = await PDFDocument.create()
    for (const [index, snapshot] of snapshots.entries()) {
      let image
      try { image = await document.embedPng(snapshot) } catch { throw new Error(`Canvas PNG tile ${index + 1} could not be decoded for PDF export`) }
      const { width, height } = plan[index].region, outputPage = document.addPage([width, height])
      outputPage.drawImage(image, { x: 0, y: 0, width, height })
    }
    output = await document.save()
  }
  const selection = await choosePath(suggestedName)
  if (selection.canceled || !selection.filePath) return { canceled: true }
  const filePath = selection.filePath, extension = `.${format}`
  if (!isAbsolute(filePath) || extname(filePath).toLowerCase() !== extension || /[<>:"|?*\u0000-\u001f]/.test(basename(filePath)) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(basename(filePath))) throw new Error(`Choose a new file at an absolute path ending in ${extension}`)
  const destination = resolve(filePath), root = resolve(dataRoot)
  if (within(root, destination)) throw new Error('Choose a Canvas export destination outside internal application data')
  let actualParent: string, actualRoot: string
  try { [actualParent, actualRoot] = await Promise.all([realpath(dirname(destination)), realpath(root)]) } catch { throw new Error('The Canvas export could not be saved. Choose an existing writable folder.') }
  if (within(actualRoot, resolve(actualParent, basename(destination)))) throw new Error('Choose a Canvas export destination outside internal application data')
  try { await writeFile(destination, output, { flag: 'wx', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`This file already exists. Choose a new ${format.toUpperCase()} name to preserve it.`); throw new Error('The Canvas export could not be saved. Choose a writable folder and a new file name.') }
  return { canceled: false, fileName: basename(destination) }
}

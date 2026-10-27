import { colorRgb, highlightColorHex } from '../shared/colors'
import { realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  BlendMode, LineCapStyle, LineJoinStyle, PDFDocument, PDFHexString,
  appendBezierCurve, clip, closePath, concatTransformationMatrix, endPath, fill, lineTo, moveTo,
  popGraphicsState, pushGraphicsState, rectangle, rgb, setFillingRgbColor, setLineCap,
  setLineJoin, setLineWidth, setStrokingRgbColor, stroke,
} from 'pdf-lib'
import type { PDFPage, PDFOperator } from 'pdf-lib'
import type { Highlight, NormalizedRect, NoteExportResult, PdfInk, PdfInkStroke, ReadingMarks } from '../shared/types'
import type { PaperStore } from './storage'
import { validId, validateMarks } from './validation'
import { validatePdfInk } from './workflowValidation'
import { readingExportFileName } from './readingExport'

type Matrix = [number, number, number, number, number, number]
type Bounds = { left: number; bottom: number; right: number; top: number }
type ChoosePdfPath = (suggestedName: string) => Promise<{ canceled: boolean; filePath?: string }>

function bounds(box: { x: number; y: number; width: number; height: number }): Bounds {
  const values = [box.x, box.y, box.width, box.height, box.x + box.width, box.y + box.height]
  if (values.some(value => !Number.isFinite(value))) throw new Error('The PDF has invalid page geometry and cannot be exported.')
  return { left: Math.min(box.x, box.x + box.width), bottom: Math.min(box.y, box.y + box.height), right: Math.max(box.x, box.x + box.width), top: Math.max(box.y, box.y + box.height) }
}
function viewport(page: PDFPage): { view: Bounds; matrix: Matrix } {
  const media = bounds(page.getMediaBox()), crop = bounds(page.getCropBox())
  if (media.right <= media.left || media.top <= media.bottom) throw new Error('The PDF has an empty page and cannot be exported.')
  const intersection = { left: Math.max(media.left, crop.left), bottom: Math.max(media.bottom, crop.bottom), right: Math.min(media.right, crop.right), top: Math.min(media.top, crop.top) }
  // PDF.js falls back to MediaBox when CropBox has no positive intersection.
  const view = intersection.right > intersection.left && intersection.top > intersection.bottom ? intersection : media
  const { left, bottom, right, top } = view, width = right - left, height = top - bottom
  const rawRotation = page.getRotation().angle
  if (!Number.isFinite(rawRotation)) throw new Error('The PDF has invalid page rotation and cannot be exported.')
  const rotation = rawRotation % 90 === 0 ? ((rawRotation % 360) + 360) % 360 : 0
  const matrix: Matrix = rotation === 90 ? [0, height, width, 0, left, bottom]
    : rotation === 180 ? [-width, 0, 0, height, right, bottom]
      : rotation === 270 ? [0, -height, -width, 0, right, top]
        : [width, 0, 0, -height, left, top]
  return { view, matrix }
}
function transformedRect(rect: NormalizedRect, matrix: Matrix): Bounds {
  const [a, b, c, d, e, f] = matrix
  const points = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]
    .map(([x, y]) => [a * x + c * y + e, b * x + d * y + f])
  return { left: Math.min(...points.map(point => point[0])), bottom: Math.min(...points.map(point => point[1])), right: Math.max(...points.map(point => point[0])), top: Math.max(...points.map(point => point[1])) }
}
function colorComponents(hex: string): [number, number, number] {
  return [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number]
}
function commentIcon(mark: Highlight, matrix: Matrix): NormalizedRect {
  const visualWidth = Math.hypot(matrix[0], matrix[1]), visualHeight = Math.hypot(matrix[2], matrix[3])
  const width = Math.min(1, 18 / visualWidth), height = Math.min(1, 18 / visualHeight)
  const gapX = 4 / visualWidth, gapY = 4 / visualHeight, first = mark.rects[0]
  const left = Math.min(...mark.rects.map(rect => rect.x)), right = Math.max(...mark.rects.map(rect => rect.x + rect.width))
  const top = Math.min(...mark.rects.map(rect => rect.y)), bottom = Math.max(...mark.rects.map(rect => rect.y + rect.height))
  const clampX = (x: number) => Math.max(0, Math.min(1 - width, x))
  const clampY = (y: number) => Math.max(0, Math.min(1 - height, y))
  const centeredY = clampY(first.y + first.height / 2 - height / 2)
  // Keep the note icon beside the selected block instead of covering its first words.
  const candidates = [
    { x: left - gapX - width, y: centeredY },
    { x: clampX(first.x), y: top - gapY - height },
    { x: right + gapX, y: centeredY },
    { x: clampX(first.x), y: bottom + gapY },
  ]
  const position = candidates.find(point => point.x >= 0 && point.y >= 0 && point.x + width <= 1 && point.y + height <= 1)
    ?? { x: clampX(left - gapX - width), y: centeredY }
  return { ...position, width, height }
}
function addHighlight(document: PDFDocument, page: PDFPage, mark: Highlight, matrix: Matrix): void {
  const color = colorRgb(highlightColorHex(mark.color))
  for (const rect of mark.rects) {
    const box = transformedRect(rect, matrix)
    page.drawRectangle({ x: box.left, y: box.bottom, width: box.right - box.left, height: box.top - box.bottom, color: rgb(...color), opacity: .4, blendMode: BlendMode.Multiply })
  }
  if (mark.comment.trim()) {
    const box = transformedRect(commentIcon(mark, matrix), matrix)
    const annotation = document.context.obj({
      Type: 'Annot', Subtype: 'Text', P: page.ref,
      Rect: [box.left, box.bottom, box.right, box.top],
      Contents: PDFHexString.fromText(mark.comment), T: PDFHexString.fromText('Paper Reader'),
      NM: PDFHexString.fromText(`paper-reader-${mark.id}`), Name: 'Note', C: color, F: 4, Open: false,
    })
    page.node.addAnnot(document.context.register(annotation))
  }
}
function dotOperators(x: number, y: number, radius: number): PDFOperator[] {
  // A zero-length PDF path is inconsistently rendered. A filled circle keeps pen taps visible.
  const k = radius * .5522847498307936
  return [moveTo(x + radius, y), appendBezierCurve(x + radius, y + k, x + k, y + radius, x, y + radius),
    appendBezierCurve(x - k, y + radius, x - radius, y + k, x - radius, y),
    appendBezierCurve(x - radius, y - k, x - k, y - radius, x, y - radius),
    appendBezierCurve(x + k, y - radius, x + radius, y - k, x + radius, y), closePath(), fill()]
}
function addInk(page: PDFPage, ink: PdfInkStroke, matrix: Matrix, view: Bounds): void {
  const color = colorComponents(ink.color), first = ink.points[0]
  const dot = ink.points.every(point => point.x === first.x && point.y === first.y)
  // Match the renderer's square SVG viewBox with preserveAspectRatio="none": the
  // entire stroke (including width/caps) is transformed, not just its endpoints.
  page.pushOperators(pushGraphicsState(), rectangle(view.left, view.bottom, view.right - view.left, view.top - view.bottom), clip(), endPath(),
    concatTransformationMatrix(...matrix), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round), setLineWidth(ink.width),
    setStrokingRgbColor(...color), setFillingRgbColor(...color),
    ...(dot ? dotOperators(first.x, first.y, ink.width / 2) : [moveTo(first.x, first.y), ...ink.points.slice(1).map(point => lineTo(point.x, point.y)), stroke()]),
    popGraphicsState())
}

export async function buildAnnotatedPdf(bytes: Uint8Array, marks: ReadingMarks, ink: PdfInk): Promise<Uint8Array> {
  validateMarks(marks); validatePdfInk(ink)
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 200 * 1024 * 1024) throw new Error('The PDF is missing or exceeds the 200 MB export limit.')
  let document: PDFDocument
  try { document = await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false }) }
  catch (error) {
    if (error instanceof Error && /encrypt/i.test(error.message)) throw new Error('Encrypted PDFs cannot be exported. Import an unencrypted copy first.')
    throw new Error('The PDF could not be read for export. The original and saved annotations were preserved.')
  }
  const pages = document.getPages()
  if (!pages.length) throw new Error('The PDF has no pages to export.')
  // Validate every mark before creating any output; never silently omit annotations.
  for (const mark of [...marks.highlights, ...ink.strokes]) if (mark.page > pages.length) throw new Error(`An annotation refers to missing PDF page ${mark.page}. Export was stopped.`)
  const views = pages.map(viewport)
  for (const mark of marks.highlights) addHighlight(document, pages[mark.page - 1], mark, views[mark.page - 1].matrix)
  for (const mark of ink.strokes) addInk(pages[mark.page - 1], mark, views[mark.page - 1].matrix, views[mark.page - 1].view)
  return document.save({ addDefaultPage: false, updateFieldAppearances: false })
}

function within(directory: string, candidate: string): boolean {
  const path = relative(directory, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}
async function validateDestination(filePath: string, storeRoot: string): Promise<string> {
  if (!isAbsolute(filePath) || extname(filePath).toLowerCase() !== '.pdf' || /[<>:"|?*\u0000-\u001f]/.test(basename(filePath)) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(basename(filePath))) {
    throw new Error('Choose a new file at an absolute path ending in .pdf to export the annotated copy.')
  }
  const destination = resolve(filePath), root = resolve(storeRoot)
  if (within(root, destination)) throw new Error('Choose a destination outside internal application data.')
  let actualParent: string, actualRoot: string
  try { [actualParent, actualRoot] = await Promise.all([realpath(dirname(destination)), realpath(root)]) }
  catch { throw new Error('The PDF could not be saved. Choose an existing writable folder and try again.') }
  // Resolve existing parents so a junction/symlink into app data is also rejected.
  if (within(actualRoot, resolve(actualParent, basename(destination)))) throw new Error('Choose a destination outside internal application data.')
  return destination
}
export async function exportAnnotatedPdf(store: PaperStore, paperId: string, choosePath: ChoosePdfPath): Promise<NoteExportResult> {
  validId(paperId)
  await store.flush()
  const paper = (await store.list()).find(item => item.id === paperId && !item.isDemo)
  if (!paper) throw new Error('Paper not found. Import a local PDF first.')
  const [bytes, marks, ink, metadata] = await Promise.all([store.readPdf(paperId), store.loadMarks(paperId), store.loadPdfInk(paperId), store.loadLibraryMetadata()])
  const title = metadata[paperId]?.title ?? basename(paper.fileName).replace(/\.pdf$/i, '')
  const defaultName = readingExportFileName(title).replace(/-reading-notes\.md$/, '-annotated.pdf')
  const selection = await choosePath(defaultName)
  if (selection.canceled || !selection.filePath) return { canceled: true }
  const destination = await validateDestination(selection.filePath, store.root)
  const output = await buildAnnotatedPdf(bytes, marks, ink)
  try { await writeFile(destination, output, { flag: 'wx', mode: 0o600 }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('This file already exists. Choose a new file name to preserve existing PDFs.')
    throw new Error('The annotated PDF could not be saved. Choose a writable folder and a new file name, then try again.')
  }
  return { canceled: false, fileName: basename(destination) }
}

import { isHexColor } from '../shared/colors'
import type { CanvasNotebook, NotebookPage, RichTextDocument } from '../shared/notebookTypes'
import { object, text } from './validation'
import { canvasColors, validateCanvasAssetId, validateCanvasPaperId } from './canvasValidation'
import { diagramColors, validateMindMapDocument } from './diagramValidation'

export const notebookFileLimit = 16 * 1024 * 1024
const fields = (value: Record<string, unknown>, allowed: string[]) => { if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid notebook fields') }
function number(value: unknown, min: number, max: number): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid notebook geometry') }
function integer(value: unknown, min: number, max: number): asserts value is number { number(value, min, max); if (!Number.isSafeInteger(value)) throw new Error('Invalid notebook page/dimension') }
function color(value: unknown) { if (!isHexColor(value)) throw new Error('Invalid notebook color') }
function richColor(value: unknown) { if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error('Invalid rich text color') }
function timestamp(value: unknown) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Invalid notebook source timestamp') }
interface Budget { text: number; points: number; rectangles: number; blocks: number; runs: number; objects: number }
function addText(value: unknown, max: number, budget: Budget): asserts value is string { text(value, max); budget.text += value.length; if (budget.text > 500000) throw new Error('Notebook text limit exceeded') }
function richText(value: unknown, plain: string, budget: Budget): asserts value is RichTextDocument {
  object(value); fields(value, ['blocks'])
  if (!Array.isArray(value.blocks) || !value.blocks.length || value.blocks.length > 2000 || (budget.blocks += value.blocks.length) > 10000) throw new Error('Rich text block limit exceeded')
  const lines: string[] = []
  for (const block of value.blocks) {
    object(block); fields(block, ['kind', 'runs'])
    if (!['paragraph', 'heading', 'bullet', 'number'].includes(block.kind as string) || !Array.isArray(block.runs) || block.runs.length > 10000 || (budget.runs += block.runs.length) > 20000) throw new Error('Invalid rich text block/run limit')
    let line = ''
    for (const run of block.runs) {
      object(run); fields(run, ['text', 'bold', 'italic', 'underline', 'color', 'highlight']); text(run.text, 100000); line += run.text
      if (line.length > 100000) throw new Error('Rich text length limit exceeded')
      for (const mark of ['bold', 'italic', 'underline']) if (run[mark] !== undefined && typeof run[mark] !== 'boolean') throw new Error('Invalid rich text format')
      if (run.color !== undefined) richColor(run.color); if (run.highlight !== undefined) richColor(run.highlight)
    }
    lines.push(line)
  }
  if (lines.join('\n') !== plain) throw new Error('Rich text and extracted plain text must match')
}
function box(value: Record<string, unknown>, width: number, height: number, infinite = false) {
  if (infinite) {
    number(value.x, -10000000, 10000000); number(value.y, -10000000, 10000000); number(value.width, Number.MIN_VALUE, 10000000); number(value.height, Number.MIN_VALUE, 10000000)
    if ((value.x as number) + (value.width as number) > 10000000 || (value.y as number) + (value.height as number) > 10000000 || (value.x as number) + (value.width as number) <= (value.x as number) || (value.y as number) + (value.height as number) <= (value.y as number)) throw new Error('Notebook world geometry exceeds bounds or precision')
    return
  }
  number(value.x, 0, width); number(value.y, 0, height); number(value.width, Number.MIN_VALUE, width); number(value.height, Number.MIN_VALUE, height)
  if (value.x + value.width > width || value.y + value.height > height) throw new Error('Notebook object geometry extends outside page')
}
function point(value: unknown, width: number, height: number, infinite = false) { object(value); fields(value, ['x', 'y']); number(value.x, infinite ? -10000000 : 0, infinite ? 10000000 : width); number(value.y, infinite ? -10000000 : 0, infinite ? 10000000 : height) }
function rectangles(value: unknown, budget: Budget) {
  if (!Array.isArray(value) || !value.length || value.length > 1000 || (budget.rectangles += value.length) > 20000) throw new Error('Notebook quote rectangle limit exceeded')
  for (const rect of value) { object(rect); fields(rect, ['x', 'y', 'width', 'height']); number(rect.x, 0, 1); number(rect.y, 0, 1); number(rect.width, Number.MIN_VALUE, 1); number(rect.height, Number.MIN_VALUE, 1); if (rect.x + rect.width > 1 + 1e-6 || rect.y + rect.height > 1 + 1e-6) throw new Error('Invalid quote rectangle outside PDF page') }
}
function source(value: unknown, paperId: string, quote: boolean, budget: Budget) {
  object(value); fields(value, quote ? ['paperId', 'highlightId', 'page', 'rects', 'importedAt'] : ['paperId', 'importedAt']); validateCanvasPaperId(value.paperId)
  if (value.paperId !== paperId) throw new Error('Invalid notebook source ownership'); timestamp(value.importedAt)
  if (quote) { validateCanvasPaperId(value.highlightId); integer(value.page, 1, 100000); rectangles(value.rects, budget) }
}
function diagram(value: unknown, paperId: string, width: number, height: number, identity: (value: Record<string, unknown>) => void, infinite = false): number {
  object(value); fields(value, ['version', 'paperId', 'shapes', 'arrows', 'connections'])
  if (value.version !== 1 || value.paperId !== paperId || !Array.isArray(value.shapes) || !Array.isArray(value.arrows) || !Array.isArray(value.connections)) throw new Error('Invalid notebook diagram ownership/version')
  const appearance = (item: Record<string, unknown>) => { identity(item); color(item.color); number(item.lineWidth, 1, 12) }
  for (const shape of value.shapes) { object(shape); fields(shape, ['id', 'kind', 'x', 'y', 'width', 'height', 'fill', 'color', 'lineWidth']); appearance(shape); if (!['rectangle', 'circle'].includes(shape.kind as string) || !(isHexColor(shape.fill) || shape.fill === 'transparent')) throw new Error('Invalid notebook diagram shape'); box(shape, width, height, infinite); number(shape.width, 20, infinite ? 10000000 : width); number(shape.height, 20, infinite ? 10000000 : height); if (shape.kind === 'circle' && shape.width !== shape.height) throw new Error('Invalid notebook circle geometry') }
  for (const arrow of value.arrows) { object(arrow); fields(arrow, ['id', 'start', 'end', 'color', 'lineWidth']); appearance(arrow); point(arrow.start, width, height, infinite); point(arrow.end, width, height, infinite) }
  const endpoint = (item: unknown) => { object(item); fields(item, ['domain', 'objectId', 'anchor']); validateCanvasPaperId(item.objectId); if (!['base', 'shape'].includes(item.domain as string) || !['auto', 'top', 'right', 'bottom', 'left'].includes(item.anchor as string)) throw new Error('Invalid notebook diagram endpoint') }
  for (const connection of value.connections) { object(connection); fields(connection, ['id', 'from', 'to', 'color', 'lineWidth']); appearance(connection); endpoint(connection.from); endpoint(connection.to) }
  return value.shapes.length + value.arrows.length + value.connections.length
}
export function validateCanvasNotebook(value: unknown, paperId?: string): asserts value is CanvasNotebook {
  object(value); fields(value, ['version', 'surface', 'paperId', 'activePageId', 'pages']); validateCanvasPaperId(value.paperId); validateCanvasPaperId(value.activePageId)
  if (value.version !== 1 || paperId !== undefined && value.paperId !== paperId) throw new Error('Invalid notebook paper ownership/version')
  if (value.surface !== undefined && value.surface !== 'infinite') throw new Error('Invalid notebook surface')
  const infinite = value.surface === 'infinite'
  if (!Array.isArray(value.pages) || !value.pages.length || value.pages.length > 50) throw new Error('Invalid notebook page limit')
  const pageIds = new Set<string>(), objectIds = new Set<string>(), budget: Budget = { text: 0, points: 0, rectangles: 0, blocks: 0, runs: 0, objects: 0 }
  const identity = (item: Record<string, unknown>) => { validateCanvasPaperId(item.id); if (objectIds.has(item.id)) throw new Error('Duplicate notebook object identifier'); objectIds.add(item.id) }
  for (const page of value.pages) {
    object(page); fields(page, infinite ? ['id', 'name', 'width', 'height', 'objects', 'diagram', 'viewport'] : ['id', 'name', 'width', 'height', 'objects', 'diagram']); validateCanvasPaperId(page.id)
    if (pageIds.has(page.id)) throw new Error('Duplicate notebook page identifier'); pageIds.add(page.id)
    text(page.name, 120); if (!page.name.trim()) throw new Error('Invalid notebook page name'); integer(page.width, 256, 4096); integer(page.height, 256, 4096)
    if (page.viewport !== undefined) { object(page.viewport); fields(page.viewport, ['x', 'y', 'zoom']); number(page.viewport.x, -10000000, 10000000); number(page.viewport.y, -10000000, 10000000); number(page.viewport.zoom, .000001, 4) }
    if (!Array.isArray(page.objects) || page.objects.length > 500) throw new Error('Notebook page object limit exceeded')
    const diagramCount = diagram(page.diagram, value.paperId, page.width, page.height, identity, infinite), count = page.objects.length + diagramCount
    if (count > 500 || (budget.objects += count) > 5000) throw new Error('Notebook object limit exceeded')
    for (const item of page.objects) {
      object(item); identity(item)
      if (item.type === 'stroke') {
        fields(item, ['id', 'type', 'points', 'color', 'strokeWidth']); color(item.color); number(item.strokeWidth, 1, 20)
        if (!Array.isArray(item.points) || item.points.length < 2 || item.points.length > 10000 || (budget.points += item.points.length) > 200000) throw new Error('Notebook stroke point limit exceeded')
        for (const coordinate of item.points) point(coordinate, page.width, page.height, infinite)
      } else if (item.type === 'text') {
        fields(item, ['id', 'type', 'x', 'y', 'width', 'height', 'text', 'color', 'fontSize', 'richText']); box(item, page.width, page.height, infinite); color(item.color); number(item.fontSize, 12, 80); addText(item.text, 100000, budget)
        if (item.richText !== undefined) richText(item.richText, item.text, budget)
      } else if (item.type === 'image') {
        fields(item, ['id', 'type', 'x', 'y', 'width', 'height', 'assetId']); box(item, page.width, page.height, infinite); validateCanvasAssetId(item.assetId)
      } else if (item.type === 'quote') {
        fields(item, ['id', 'type', 'x', 'y', 'width', 'height', 'quote', 'comment', 'fontSize', 'source']); box(item, page.width, page.height, infinite); number(item.fontSize, 12, 80); addText(item.quote, 20000, budget); addText(item.comment, 20000, budget); source(item.source, value.paperId, true, budget)
      } else if (item.type === 'mindmap') {
        fields(item, ['id', 'type', 'x', 'y', 'width', 'height', 'nodes', 'source']); box(item, page.width, page.height, infinite); source(item.source, value.paperId, false, budget)
        if (!Array.isArray(item.nodes) || !item.nodes.length) throw new Error('Notebook mind map group must contain a root node')
        validateMindMapDocument({ version: 1, paperId: value.paperId, nodes: item.nodes }, value.paperId)
        for (const node of item.nodes as Array<{ id: string; text: string }>) { identity(node); addText(node.text, 500, budget) }
      } else throw new Error('Invalid notebook object type')
    }
  }
  if (!pageIds.has(value.activePageId)) throw new Error('Invalid notebook active page')
}
/** Shared by renderer raster and the privileged export validator. Flooring keeps both caps strict. */
export function notebookPngSize(page: Pick<NotebookPage, 'width' | 'height'>): { width: number; height: number; scale: number } {
  integer(page.width, 256, 4096); integer(page.height, 256, 4096)
  const scale = Math.min(2, 4096 / Math.max(page.width, page.height), Math.sqrt(16000000 / (page.width * page.height)))
  return { width: Math.floor(page.width * scale), height: Math.floor(page.height * scale), scale }
}





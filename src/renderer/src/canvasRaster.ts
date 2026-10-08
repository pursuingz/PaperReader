import type { CanvasDocument, CanvasImageData, CanvasTextObject } from '../../shared/types'
import { canvasImageLimit, validateCanvasDocument, validateCanvasImageInfo } from '../../main/canvasValidation'
import type { CanvasDiagram, MindMapDocument } from '../../shared/diagramTypes'
import { validateCanvasDiagram } from '../../main/diagramValidation'
import { arrowHead, connectionGeometry } from './diagramModel'
import { layoutMindMap } from './mindMapModel'

export interface DecodedCanvasImage { image: CanvasImageSource; width: number; height: number; close?: () => void }
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
/** Only visible lines are measured; combining marks and emoji stay together. */
export function wrapCanvasText(text: string, width: number, measure: (text: string) => number, maximumLines: number): string[] {
  if (!text || width <= 0 || maximumLines <= 0) return []
  const lines: string[] = []; let line = ''
  for (const { segment } of segmenter.segment(text.replace(/\r\n?/g, '\n'))) {
    if (segment === '\n') { lines.push(line); line = ''; if (lines.length >= maximumLines) return lines; continue }
    if (line && measure(line + segment) > width) { lines.push(line); line = ''; if (lines.length >= maximumLines) return lines }
    line += segment
  }
  if (lines.length < maximumLines) lines.push(line)
  return lines
}
function drawText(context: CanvasRenderingContext2D, object: CanvasTextObject) {
  context.fillStyle = '#fffbf2'; context.fillRect(object.x, object.y, object.width, object.height)
  context.save()
  try {
    context.beginPath(); context.rect(object.x, object.y, object.width, object.height); context.clip()
    context.font = `${object.fontSize}px Georgia, "Segoe UI", serif`; context.fillStyle = object.color; context.textBaseline = 'top'
    const lineHeight = object.fontSize * 1.5, lines = wrapCanvasText(object.text, object.width - 24, text => context.measureText(text).width, Math.max(0, Math.ceil((object.height - 12) / lineHeight)))
    lines.forEach((line, index) => context.fillText(line, object.x + 12, object.y + 12 + object.fontSize * 0.25 + index * lineHeight))
  } finally { context.restore() }
}
/** Draw the immutable model, never a DOM screenshot or the scrollable viewport. */
export async function drawCanvasModel(context: CanvasRenderingContext2D, document: CanvasDocument, loadImage: (assetId: string) => Promise<DecodedCanvasImage>, diagram?: CanvasDiagram): Promise<void> {
  validateCanvasDocument(document); if (diagram) validateCanvasDiagram(diagram); context.save()
  try {
    context.scale(2, 2); context.fillStyle = '#fffdf8'; context.fillRect(0, 0, 1000, 1200)
    context.fillStyle = '#e9e6df'; context.beginPath()
    for (let y = 2; y < 1200; y += 24) for (let x = 2; x < 1000; x += 24) { context.moveTo(x + 1, y); context.arc(x, y, 1, 0, Math.PI * 2) }
    context.fill()
    for (const object of document.objects) {
      if (object.type === 'text') { drawText(context, object); continue }
      if (object.type === 'image') {
        const decoded = await loadImage(object.assetId)
        try {
          if (!Number.isInteger(decoded.width) || !Number.isInteger(decoded.height) || decoded.width < 1 || decoded.height < 1 || decoded.width > 4096 || decoded.height > 4096) throw new Error('Canvas image could not be decoded for export')
          const scale = Math.min(object.width / decoded.width, object.height / decoded.height), width = decoded.width * scale, height = decoded.height * scale
          context.drawImage(decoded.image, object.x + (object.width - width) / 2, object.y + (object.height - height) / 2, width, height)
        } finally { decoded.close?.() }
        continue
      }
      context.strokeStyle = object.color; context.fillStyle = object.color; context.lineWidth = object.strokeWidth; context.lineCap = 'round'; context.lineJoin = 'round'; context.beginPath()
      const first = object.points[0]
      if (object.points.every(point => point.x === first.x && point.y === first.y)) { context.arc(first.x, first.y, object.strokeWidth / 2, 0, Math.PI * 2); context.fill() }
      else { context.moveTo(first.x, first.y); for (const point of object.points.slice(1)) context.lineTo(point.x, point.y); context.stroke() }
    }
    if (diagram) drawDiagramModel(context, diagram, document)
  } finally { context.restore() }
}

export async function rasterCanvasPng(paperId: string, model: CanvasDocument, readImage: (paperId: string, assetId: string) => Promise<CanvasImageData>, diagram?: CanvasDiagram): Promise<Uint8Array> {
  if (diagram) validateCanvasDiagram(diagram, paperId)
  const canvas = document.createElement('canvas'); canvas.width = 2000; canvas.height = 2400
  const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas PNG rendering is unavailable')
  await document.fonts.ready
  await drawCanvasModel(context, model, async assetId => {
    const resource = await readImage(paperId, assetId)
    if (resource.assetId !== assetId) throw new Error('Canvas image ownership changed; export was stopped')
    validateCanvasImageInfo({ mimeType: resource.mimeType, width: resource.width, height: resource.height })
    if (!(resource.bytes instanceof Uint8Array) || resource.bytes.length > canvasImageLimit) throw new Error('Canvas image bytes are unavailable or too large')
    let bitmap: ImageBitmap
    try { bitmap = await createImageBitmap(new Blob([new Uint8Array(resource.bytes).buffer], { type: resource.mimeType })) } catch { throw new Error('A saved Canvas image could not be decoded. Retry or remove its object before exporting.') }
    if (bitmap.width !== resource.width || bitmap.height !== resource.height) { bitmap.close(); throw new Error('A saved Canvas image has inconsistent dimensions; export was stopped') }
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
  }, diagram)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Canvas PNG encoding failed')), 'image/png'))
  if (blob.size > canvasImageLimit) throw new Error('Canvas PNG exceeds the 10 MiB export limit. Reduce large image content before retrying.')
  return new Uint8Array(await blob.arrayBuffer())
}
function drawLine(context: CanvasRenderingContext2D, start: { x: number; y: number }, end: { x: number; y: number }, color: string, lineWidth: number) {
  context.strokeStyle = color; context.lineWidth = lineWidth; context.lineCap = 'round'; context.lineJoin = 'round'; context.beginPath(); context.moveTo(start.x, start.y); context.lineTo(end.x, end.y)
  const [first, second] = arrowHead(start, end, lineWidth); context.moveTo(first.x, first.y); context.lineTo(end.x, end.y); context.lineTo(second.x, second.y); context.stroke()
}
export function drawDiagramModel(context: CanvasRenderingContext2D, diagram: CanvasDiagram, base: CanvasDocument) {
  validateCanvasDiagram(diagram)
  for (const shape of diagram.shapes) {
    context.beginPath(); if (shape.kind === 'circle') context.ellipse(shape.x + shape.width / 2, shape.y + shape.height / 2, shape.width / 2, shape.height / 2, 0, 0, Math.PI * 2); else context.rect(shape.x, shape.y, shape.width, shape.height)
    context.fillStyle = shape.fill; context.fill(); context.strokeStyle = shape.color; context.lineWidth = shape.lineWidth; context.stroke()
  }
  for (const arrow of diagram.arrows) drawLine(context, arrow.start, arrow.end, arrow.color, arrow.lineWidth)
  for (const connection of diagram.connections) { const line = connectionGeometry(connection, diagram, base); if (line) drawLine(context, line.start, line.end, connection.color, connection.lineWidth) }
}
export function drawMindMapModel(context: CanvasRenderingContext2D, model: MindMapDocument) {
  const layout = layoutMindMap(model); context.save()
  try {
    context.fillStyle = '#fffdf8'; context.fillRect(0, 0, layout.width, layout.height)
    context.strokeStyle = '#4b8f82'; context.lineWidth = 2
    for (const edge of layout.edges) { context.beginPath(); context.moveTo(edge.start.x, edge.start.y); context.lineTo(edge.end.x, edge.end.y); context.stroke() }
    for (const node of layout.nodes) {
      context.beginPath(); context.rect(node.x, node.y, node.width, node.height); context.fillStyle = '#fffbf2'; context.fill(); context.strokeStyle = '#4b8f82'; context.stroke()
      context.font = '16px "Cascadia Mono", Consolas, monospace'; context.fillStyle = '#334155'; context.textBaseline = 'top'
      node.lines.forEach((line, index) => context.fillText(line, node.x + 12, node.y + 12 + index * 22))
    }
  } finally { context.restore() }
  return { width: layout.width, height: layout.height }
}
export async function rasterMindMapPng(model: MindMapDocument): Promise<Uint8Array> {
  const layout = layoutMindMap(model), canvas = document.createElement('canvas'); canvas.width = layout.width; canvas.height = layout.height
  const context = canvas.getContext('2d'); if (!context) throw new Error('Mind map PNG rendering is unavailable')
  await document.fonts.ready; drawMindMapModel(context, model)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Mind map PNG encoding failed')), 'image/png'))
  if (blob.size > canvasImageLimit) throw new Error('Mind map PNG exceeds the 10 MiB export limit')
  return new Uint8Array(await blob.arrayBuffer())
}

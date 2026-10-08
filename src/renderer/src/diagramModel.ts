import type { CanvasDiagram, DiagramConnection, DiagramEndpoint } from '../../shared/diagramTypes'
import type { CanvasDocument } from '../../shared/types'
import type { CanvasPoint, CanvasRect } from './canvasWorkspace'
import { validateCanvasDiagram } from '../../main/diagramValidation'
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
export function moveDiagramItem(document: CanvasDiagram, id: string, dx: number, dy: number): CanvasDiagram {
  const result = { ...document, shapes: document.shapes.map(shape => shape.id === id ? { ...shape, x: clamp(shape.x + dx, 0, 1000 - shape.width), y: clamp(shape.y + dy, 0, 1200 - shape.height) } : shape), arrows: document.arrows.map(arrow => {
    if (arrow.id !== id) return arrow
    const x = clamp(dx, -Math.min(arrow.start.x, arrow.end.x), 1000 - Math.max(arrow.start.x, arrow.end.x)), y = clamp(dy, -Math.min(arrow.start.y, arrow.end.y), 1200 - Math.max(arrow.start.y, arrow.end.y))
    return { ...arrow, start: { x: arrow.start.x + x, y: arrow.start.y + y }, end: { x: arrow.end.x + x, y: arrow.end.y + y } }
  }) }
  validateCanvasDiagram(result); return result
}
export function resizeDiagramShape(document: CanvasDiagram, id: string, width: number, height: number): CanvasDiagram {
  const result = { ...document, shapes: document.shapes.map(shape => { if (shape.id !== id) return shape; const circleSize = clamp(Math.min(width, height), 20, Math.min(1000 - shape.x, 1200 - shape.y)); return { ...shape, width: shape.kind === 'circle' ? circleSize : clamp(width, 20, 1000 - shape.x), height: shape.kind === 'circle' ? circleSize : clamp(height, 20, 1200 - shape.y) } }) }
  validateCanvasDiagram(result); return result
}
function target(endpoint: DiagramEndpoint, diagram: CanvasDiagram, base: CanvasDocument): (CanvasRect & { kind?: 'rectangle' | 'circle' }) | undefined {
  if (endpoint.domain === 'shape') return diagram.shapes.find(shape => shape.id === endpoint.objectId)
  const object = base.objects.find(object => object.id === endpoint.objectId)
  return object && object.type !== 'stroke' ? object : undefined
}
function anchor(rect: CanvasRect & { kind?: string }, name: DiagramEndpoint['anchor'], toward: CanvasPoint): CanvasPoint {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  if (name === 'top') return { x: center.x, y: rect.y }
  if (name === 'right') return { x: rect.x + rect.width, y: center.y }
  if (name === 'bottom') return { x: center.x, y: rect.y + rect.height }
  if (name === 'left') return { x: rect.x, y: center.y }
  const dx = toward.x - center.x, dy = toward.y - center.y
  if (dx === 0 && dy === 0) return { x: rect.x + rect.width, y: center.y }
  const ratio = rect.kind === 'circle' ? 1 / Math.sqrt((dx / (rect.width / 2)) ** 2 + (dy / (rect.height / 2)) ** 2) : 1 / Math.max(Math.abs(dx) / (rect.width / 2), Math.abs(dy) / (rect.height / 2))
  return { x: center.x + dx * ratio, y: center.y + dy * ratio }
}
export function connectionGeometry(connection: DiagramConnection, diagram: CanvasDiagram, base: CanvasDocument): { start: CanvasPoint; end: CanvasPoint } | null {
  const from = target(connection.from, diagram, base), to = target(connection.to, diagram, base)
  if (!from || !to) return null
  return { start: anchor(from, connection.from.anchor, { x: to.x + to.width / 2, y: to.y + to.height / 2 }), end: anchor(to, connection.to.anchor, { x: from.x + from.width / 2, y: from.y + from.height / 2 }) }
}
export function arrowHead(start: CanvasPoint, end: CanvasPoint, lineWidth: number): [CanvasPoint, CanvasPoint] {
  const angle = Math.atan2(end.y - start.y, end.x - start.x), size = Math.max(10, lineWidth * 4)
  return [{ x: end.x - size * Math.cos(angle - Math.PI / 6), y: end.y - size * Math.sin(angle - Math.PI / 6) }, { x: end.x - size * Math.cos(angle + Math.PI / 6), y: end.y - size * Math.sin(angle + Math.PI / 6) }]
}

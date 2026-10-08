import type { CanvasDiagram, MindMapDocument } from '../shared/diagramTypes'
import { object } from './validation'
import { canvasColors, validateCanvasPaperId } from './canvasValidation'
import { computeMindMapLayout } from './mindMapGeometry'
export const diagramFileLimit = 1024 * 1024
export const diagramColors = [...canvasColors, '#fffbf2', '#ffffff', 'transparent'] as const
function fields(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid diagram/map fields') }
function number(value: unknown, min: number, max: number): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid diagram geometry') }
function point(value: unknown) { object(value); fields(value, ['x', 'y']); number(value.x, 0, 1000); number(value.y, 0, 1200) }
function appearance(value: Record<string, unknown>) { if (!canvasColors.includes(value.color as typeof canvasColors[number])) throw new Error('Invalid diagram color'); number(value.lineWidth, 1, 12) }
function endpoint(value: unknown) { object(value); fields(value, ['domain', 'objectId', 'anchor']); validateCanvasPaperId(value.objectId); if (!['base', 'shape'].includes(value.domain as string) || !['auto', 'top', 'right', 'bottom', 'left'].includes(value.anchor as string)) throw new Error('Invalid diagram endpoint') }
export function emptyDiagram(paperId: string): CanvasDiagram { return { version: 1, paperId, shapes: [], arrows: [], connections: [] } }
export function emptyMindMap(paperId: string): MindMapDocument { return { version: 1, paperId, nodes: [] } }
export function validateCanvasDiagram(value: unknown, paperId?: string): asserts value is CanvasDiagram {
  object(value); fields(value, ['version', 'paperId', 'shapes', 'arrows', 'connections']); validateCanvasPaperId(value.paperId)
  if (value.version !== 1 || paperId !== undefined && value.paperId !== paperId) throw new Error('Invalid diagram ownership/version')
  if (!Array.isArray(value.shapes) || !Array.isArray(value.arrows) || !Array.isArray(value.connections) || value.shapes.length + value.arrows.length + value.connections.length > 500) throw new Error('Diagram object limit exceeded')
  const ids = new Set<string>()
  const identity = (item: Record<string, unknown>) => { validateCanvasPaperId(item.id); if (ids.has(item.id)) throw new Error('Duplicate diagram identifier'); ids.add(item.id); appearance(item) }
  for (const item of value.shapes) {
    object(item); fields(item, ['id', 'kind', 'x', 'y', 'width', 'height', 'fill', 'color', 'lineWidth']); identity(item)
    if (!['rectangle', 'circle'].includes(item.kind as string) || !diagramColors.includes(item.fill as typeof diagramColors[number])) throw new Error('Invalid diagram shape')
    number(item.x, 0, 1000); number(item.y, 0, 1200); number(item.width, 20, 1000); number(item.height, 20, 1200)
    if (item.kind === 'circle' && item.width !== item.height) throw new Error('Diagram circle geometry requires equal width and height')
    if (item.x + item.width > 1000 || item.y + item.height > 1200) throw new Error('Diagram geometry extends outside canvas')
  }
  for (const item of value.arrows) { object(item); fields(item, ['id', 'start', 'end', 'color', 'lineWidth']); identity(item); point(item.start); point(item.end) }
  for (const item of value.connections) { object(item); fields(item, ['id', 'from', 'to', 'color', 'lineWidth']); identity(item); endpoint(item.from); endpoint(item.to) }
}
export function validateMindMapDocument(value: unknown, paperId?: string): asserts value is MindMapDocument {
  object(value); fields(value, ['version', 'paperId', 'nodes']); validateCanvasPaperId(value.paperId)
  if (value.version !== 1 || paperId !== undefined && value.paperId !== paperId || !Array.isArray(value.nodes) || value.nodes.length > 100) throw new Error('Invalid mind map ownership/version/node limit')
  const nodes = new Map<string, { parentId: string | null; order: number }>(), orders = new Map<string, Set<number>>(); let textLength = 0
  for (const item of value.nodes) {
    object(item); fields(item, ['id', 'text', 'parentId', 'order']); validateCanvasPaperId(item.id)
    if (nodes.has(item.id)) throw new Error('Duplicate mind map node'); if (item.parentId !== null) validateCanvasPaperId(item.parentId)
    if (typeof item.text !== 'string' || item.text.length > 500 || (textLength += item.text.length) > 25000 || !Number.isInteger(item.order) || (item.order as number) < 0 || (item.order as number) > 99) throw new Error('Invalid mind map text/order limit')
    nodes.set(item.id, { parentId: item.parentId as string | null, order: item.order as number })
    const parent = item.parentId === null ? '' : item.parentId as string, siblings = orders.get(parent) ?? new Set<number>()
    if (siblings.has(item.order as number)) throw new Error('Duplicate mind map sibling order'); siblings.add(item.order as number); orders.set(parent, siblings)
  }
  if (!nodes.size) return
  for (const group of orders.values()) if ([...group].some(order => order >= group.size)) throw new Error('Mind map sibling orders must be consecutive from zero')
  if ([...nodes.values()].filter(node => node.parentId === null).length !== 1) throw new Error('Mind map must be one rooted tree')
  for (const [id, node] of nodes) {
    if (node.parentId === null && node.order !== 0) throw new Error('Invalid mind map root order')
    const visited = new Set([id]); let parent = node.parentId, depth = 1
    while (parent !== null) { if (visited.has(parent)) throw new Error('Mind map cycle rejected'); visited.add(parent); const ancestor = nodes.get(parent); if (!ancestor) throw new Error('Mind map parent is missing'); parent = ancestor.parentId; if (++depth > 12) throw new Error('Mind map depth limit is 12') }
  }
  computeMindMapLayout(value as unknown as MindMapDocument)
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { connectionGeometry, moveDiagramItem, resizeDiagramShape } from './diagramModel'
import { addMapNode, reparentMapNode, reorderMapNode, removeMapSubtree, layoutMindMap } from './mindMapModel'
import type { CanvasDiagram, MindMapDocument } from '../../shared/diagramTypes'
import type { CanvasDocument } from '../../shared/types'

const diagram = (): CanvasDiagram => ({ version: 1, paperId: 'p', shapes: [{ id: 'box', kind: 'rectangle', x: 400, y: 100, width: 100, height: 100, fill: '#fffbf2', color: '#334155', lineWidth: 3 }], arrows: [{ id: 'a', start: { x: 40, y: 30 }, end: { x: 150, y: 90 }, color: '#334155', lineWidth: 3 }], connections: [{ id: 'c', from: { domain: 'base', objectId: 'text', anchor: 'auto' }, to: { domain: 'shape', objectId: 'box', anchor: 'auto' }, color: '#334155', lineWidth: 3 }] })
const base = (): CanvasDocument => ({ version: 1, width: 1000, height: 1200, objects: [{ id: 'text', type: 'text', x: 100, y: 100, width: 100, height: 100, text: '', fontSize: 24, color: '#334155' }] })
test('connections follow edge geometry and retain dangling records until base undo restores endpoints', () => {
  const d = diagram(), b = base(), c = d.connections[0]
  assert.deepEqual(connectionGeometry(c, d, b), { start: { x: 200, y: 150 }, end: { x: 400, y: 150 } })
  const moved = moveDiagramItem(d, 'box', 100, 0)
  assert.deepEqual(connectionGeometry(c, moved, b)?.end, { x: 500, y: 150 })
  assert.equal(connectionGeometry(c, d, { ...b, objects: [] }), null); assert.equal(d.connections.length, 1)
  assert.deepEqual(connectionGeometry(c, d, b)?.start, { x: 200, y: 150 })
  assert.equal(connectionGeometry({ ...c, from: { ...c.from, objectId: 'ink' } }, d, { ...b, objects: [{ id: 'ink', type: 'stroke', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], color: '#334155', strokeWidth: 4 }] }), null)
})
test('shape resize and arrow move stay within the complete canvas and preserve arrow direction', () => {
  const d = diagram(), resized = resizeDiagramShape(d, 'box', 900, 2000), moved = moveDiagramItem(d, 'a', -1000, 1300)
  assert.deepEqual([resized.shapes[0].width, resized.shapes[0].height], [600, 1100]); assert.deepEqual(moved.arrows[0].start, { x: 0, y: 1140 }); assert.deepEqual(moved.arrows[0].end, { x: 110, y: 1200 })
})
const map = (): MindMapDocument => ({ version: 1, paperId: 'p', nodes: [{ id: 'r', text: 'Root', parentId: null, order: 0 }, { id: 'a', text: 'A', parentId: 'r', order: 0 }, { id: 'b', text: 'B', parentId: 'r', order: 1 }, { id: 'c', text: 'C', parentId: 'a', order: 0 }] })
test('map child/sibling/reparent/reorder/subtree operations preserve a connected acyclic ordered tree', () => {
  const first = addMapNode(map(), 'a', 'sibling', 'd'), reordered = reorderMapNode(first, 'd', -1)
  assert.equal(first.nodes.find(n => n.id === 'd')?.parentId, 'r'); assert.equal(reordered.nodes.find(n => n.id === 'd')?.order, 0)
  assert.throws(() => reparentMapNode(first, 'a', 'c'), /cycle|descendant/i); assert.throws(() => reparentMapNode(first, 'r', 'a'), /root/i)
  const moved = reparentMapNode(first, 'c', 'b'); assert.equal(moved.nodes.find(n => n.id === 'c')?.parentId, 'b')
  assert.deepEqual(removeMapSubtree(first, 'a').nodes.map(n => n.id).sort(), ['b', 'd', 'r']); assert.throws(() => removeMapSubtree(first, 'r'), /root/i)
})
test('mind-map layout includes every node, all text and links, refusing full-map overflow', () => {
  const value = map(); value.nodes[1].text = '中文🙂'.repeat(30)
  const layout = layoutMindMap(value); assert.equal(layout.nodes.length, 4); assert.equal(layout.edges.length, 3)
  assert.equal(layout.nodes.find(n => n.id === 'a')?.lines.join('').replace(/\n/g, ''), value.nodes[1].text)
  for (const node of layout.nodes) assert.ok(node.x >= 0 && node.y >= 0 && node.x + node.width <= layout.width && node.y + node.height <= layout.height)
  assert.throws(() => layoutMindMap({ ...value, nodes: [value.nodes[0], ...Array.from({ length: 50 }, (_, i) => ({ id: `wide${i}`, text: 'Leaf', parentId: 'r', order: i }))] }), /layout|4096|limit|large/i)
})

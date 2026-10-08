import test from 'node:test'
import assert from 'node:assert/strict'
import { DiagramSession } from './diagramSession'
import { MindMapSession } from './mindMapSession'
import type { CanvasDiagram, MindMapDocument } from '../../shared/diagramTypes'

const empty = (paperId: string): CanvasDiagram => ({ version: 1, paperId, shapes: [], arrows: [], connections: [] })
test('diagram gestures form one independent undo frame and snapshots save safely', async () => {
  let saved: CanvasDiagram | undefined
  const session = new DiagramSession({ loadCanvasDiagram: async id => empty(id), saveCanvasDiagram: async (_id, value) => { saved = value } })
  await session.open('p'); const id = session.addShape('rectangle')!; session.beginMove(id, { x: 80, y: 80 }); session.moveTo({ x: 180, y: 180 }); session.moveTo({ x: 280, y: 280 }); session.finish()
  assert.equal(session.document.shapes[0].x, 280); session.undo(); assert.equal(session.document.shapes[0].x, 80); session.redo(); assert.equal(session.document.shapes[0].x, 280)
  await session.flush(); assert.equal(saved?.shapes[0].x, 280); assert.equal(session.status, 'Saved locally')
})
test('sidecar failure locks only its own editing and failed save keeps undo/edit content', async () => {
  let fail = true
  const session = new DiagramSession({ loadCanvasDiagram: async id => { if (id === 'bad') throw new Error('damaged'); return empty(id) }, saveCanvasDiagram: async () => { if (fail) throw new Error('disk full') } })
  await assert.rejects(session.open('bad')); assert.equal(session.ready, false); assert.equal(session.addShape('circle'), null)
  await session.open('p'); session.addShape('circle'); await assert.rejects(session.flush(), /disk full/); assert.equal(session.document.shapes.length, 1); assert.equal(session.canUndo, true)
  fail = false; await session.flush(); assert.equal(session.status, 'Saved locally')
})
test('late loads and queued saves cannot replace another paper and navigation refuses unsaved failure', async () => {
  let resolveOld!: (value: CanvasDiagram) => void, fail = true
  const session = new DiagramSession({ loadCanvasDiagram: id => id === 'old' ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve(empty(id)), saveCanvasDiagram: async () => { if (fail) throw new Error('disk full') } })
  const old = session.open('old'); await session.open('new'); resolveOld(empty('old')); await old; assert.equal(session.paperId, 'new')
  session.addShape('rectangle'); await assert.rejects(session.open('other'), /disk full/); assert.equal(session.paperId, 'new'); assert.equal(session.document.shapes.length, 1)
  fail = false; await session.open('other'); assert.equal(session.document.shapes.length, 0)
})
test('mind-map session supports independent tree undo and read-only load failure recovery', async () => {
  let saved: MindMapDocument | undefined
  const session = new MindMapSession({ loadMindMap: async paperId => ({ version: 1, paperId, nodes: [] }), saveMindMap: async (_id, value) => { saved = value } })
  await session.open('p'); const root = session.addRoot()!, child = session.addNode(root, 'child')!; session.editText(child, 'Result'); session.finish(); session.undo(); assert.equal(session.document.nodes.find(n => n.id === child)?.text, 'New idea'); session.redo()
  await session.flush(); assert.equal(saved?.nodes.find(n => n.id === child)?.text, 'Result'); session.remove(child); assert.equal(session.document.nodes.length, 1); session.undo(); assert.equal(session.document.nodes.length, 2)
})
test('property edits never mutate earlier diagram undo snapshots', async () => {
  const session = new DiagramSession({ loadCanvasDiagram: async id => empty(id), saveCanvasDiagram: async () => undefined })
  await session.open('p'); const id = session.addShape('rectangle')!, before = session.document
  session.updateItem(id, { width: 400, x: 900 }); assert.equal(before.shapes[0].x, 80); assert.equal(before.shapes[0].width, 180)
  session.undo(); assert.equal(session.document.shapes[0].x, 80); assert.equal(session.document.shapes[0].width, 180)
})
test('arrow property input is snapshotted and caller mutation cannot alter saved/undo geometry', async () => {
  const session = new DiagramSession({ loadCanvasDiagram: async id => empty(id), saveCanvasDiagram: async () => undefined })
  await session.open('p'); const id = session.addArrow()!, point = { x: 500, y: 600 }
  session.updateItem(id, { end: point }); point.x = 999
  assert.equal(session.document.arrows[0].end.x, 500); session.undo(); assert.equal(session.document.arrows[0].end.x, 320)
})
test('rejected map overflow keeps the complete original tree and existing undo history', async () => {
  const session = new MindMapSession({ loadMindMap: async paperId => ({ version: 1, paperId, nodes: [{ id: 'r', text: 'Paper', parentId: null, order: 0 }, ...Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, text: 'Leaf', parentId: 'r', order: i }))] }), saveMindMap: async () => undefined })
  await session.open('p'); const before = session.document
  assert.throws(() => session.editText('n0', 'Long text '.repeat(50)), /layout|limit/); assert.equal(session.document, before); assert.equal(session.canUndo, false)
  assert.throws(() => session.reparent('r', 'n0'), /root/); assert.equal(session.document, before)
})
test('circle creation and drag resize preserve circular geometry and fit inside canvas bounds', async () => {
  const session = new DiagramSession({ loadCanvasDiagram: async id => empty(id), saveCanvasDiagram: async () => undefined })
  await session.open('p'); const id = session.addShape('circle')!, shape = session.document.shapes[0]
  assert.equal(shape.width, shape.height); session.beginResize(id, { x: 240, y: 240 }); session.resizeTo({ x: 440, y: 240 }); session.finish()
  assert.equal(session.document.shapes[0].width, session.document.shapes[0].height); assert.ok(session.document.shapes[0].width > shape.width)
  session.updateItem(id, { width: 2000, height: 2000 }); assert.equal(session.document.shapes[0].width, session.document.shapes[0].height); assert.ok(session.document.shapes[0].y + session.document.shapes[0].height <= 1200)
})

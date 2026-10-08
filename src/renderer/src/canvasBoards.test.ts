import test from 'node:test'
import assert from 'node:assert/strict'
import { CanvasBoards } from './canvasBoards'
import type { DesktopAPI } from '../../shared/types'
function api() { return { loadCanvas: async () => ({ version: 1, width: 1000, height: 1200, objects: [] }), saveCanvas: async () => undefined, loadCanvasDiagram: async (paperId: string) => ({ version: 1, paperId, shapes: [], arrows: [], connections: [] }), saveCanvasDiagram: async () => undefined, loadMindMap: async (paperId: string) => ({ version: 1, paperId, nodes: [] }), saveMindMap: async () => undefined, exportCanvasPng: async () => ({ canceled: false }), exportMindMapPng: async () => ({ canceled: false }) } as unknown as DesktopAPI }
test('one pointer owner prevents base and diagram gestures from editing concurrently', async () => {
  const boards = new CanvasBoards(api()); await boards.open('p')
  const shape = boards.diagram.addShape('rectangle')!
  assert.equal(boards.beginDiagram('move', shape, { x: 80, y: 80 }), true)
  assert.equal(boards.beginBase('draw', { x: 100, y: 100 }), false); assert.equal(boards.base.document.objects.length, 0)
  boards.finish(); assert.equal(boards.beginBase('draw', { x: 100, y: 100 }), true)
  assert.equal(boards.beginDiagram('resize', shape, { x: 80, y: 80 }), false); boards.finish()
  boards.diagram.undo(); assert.equal(boards.base.document.objects.length, 1)
})
test('complete export flushes all domains, snapshots diagram/map and locks editing in the selected board', async () => {
  const service = api(), boards = new CanvasBoards(service); await boards.open('p'); const id = boards.diagram.addShape('circle')!, root = boards.map.addRoot()!
  let release!: () => void
  const pending = boards.exportPng(async (_id, _base, diagram) => { assert.equal(diagram.shapes[0].id, id); assert.equal(boards.diagram.addShape('rectangle'), null); await new Promise<void>(resolve => { release = resolve }); return new Uint8Array([1]) }, async () => new Uint8Array([2]))
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(boards.exporting, true); assert.equal(boards.base.addText(), null); assert.equal(boards.map.addNode(root, 'child'), null); release(); assert.deepEqual(await pending, new Uint8Array([1]))
  await boards.setBoardMode('mind-map'); const mapBytes = await boards.exportPng(async () => { throw new Error('Wrong raster') }, async document => { assert.equal(document.nodes.length, 1); return new Uint8Array([2]) }); assert.deepEqual(mapBytes, new Uint8Array([2]))
})
test('save failure prevents mode/paper change and complete PNG rendering while preserving all edits', async () => {
  const service = api(), boards = new CanvasBoards(service); await boards.open('p'); boards.diagram.addShape('circle'); service.saveCanvasDiagram = async () => { throw new Error('disk full') }
  await assert.rejects(boards.setBoardMode('mind-map'), /disk full/); assert.equal(boards.boardMode, 'canvas')
  await assert.rejects(boards.open('other'), /disk full/); assert.equal(boards.base.paperId, 'p')
  let rastered = false; await assert.rejects(boards.exportPng(async () => { rastered = true; return new Uint8Array() }, async () => new Uint8Array()), /disk full/); assert.equal(rastered, false); assert.equal(boards.exporting, false); assert.equal(boards.diagram.document.shapes.length, 1)
})
test('a damaged diagram locks canvas export but leaves independent mind-map editing/export available', async () => {
  const service = api(); service.loadCanvasDiagram = async () => { throw new Error('damaged diagram') }
  const boards = new CanvasBoards(service); await assert.rejects(boards.open('p'), /damaged diagram/)
  assert.equal(boards.base.ready, true); assert.equal(boards.diagram.ready, false); assert.equal(boards.map.ready, true)
  await assert.rejects(boards.exportPng(async () => new Uint8Array(), async () => new Uint8Array()), /successfully|protected/)
  boards.map.addRoot(); await boards.setBoardMode('mind-map'); assert.deepEqual(await boards.exportPng(async () => new Uint8Array(), async () => new Uint8Array([2])), new Uint8Array([2]))
})
test('closing a board during PNG raster rejects the stale export rather than returning bytes', async () => {
  const boards = new CanvasBoards(api()); await boards.open('p'); let release!: () => void
  const pending = boards.exportPng(async () => { await new Promise<void>(resolve => { release = resolve }); return new Uint8Array([1]) }, async () => new Uint8Array())
  await new Promise(resolve => setTimeout(resolve, 0)); boards.dispose(); release(); await assert.rejects(pending, /closed|changed|cancel/i)
})
test('a later paper open supersedes a slow earlier board load in every editing domain',async()=>{
  const service=api(),load=service.loadCanvasDiagram
  let release!:()=>void,started!:()=>void
  const blocked=new Promise<void>(resolve=>release=resolve),began=new Promise<void>(resolve=>started=resolve)
  service.loadCanvasDiagram=async id=>{if(id==='A'){started();await blocked}return load(id)}
  const boards=new CanvasBoards(service),first=boards.open('A');await began
  const second=boards.open('B');await second
  assert.equal(boards.base.paperId,'B');assert.equal(boards.diagram.paperId,'B');assert.equal(boards.map.paperId,'B')
  release();await first
  assert.equal(boards.diagram.document.paperId,'B');assert.equal(boards.map.document.paperId,'B');assert.equal(boards.transitioning,false)
  const shape=boards.diagram.addShape('rectangle');assert.ok(shape);await boards.flush();assert.equal(boards.diagram.document.paperId,'B')
})

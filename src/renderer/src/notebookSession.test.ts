import test from 'node:test'
import assert from 'node:assert/strict'
import type { CanvasNotebook } from '../../shared/notebookTypes'
import type { Highlight, CanvasImageData, ReadingMarks } from '../../shared/types'
import type { MindMapDocument } from '../../shared/diagramTypes'

const modulePromise = import('./notebookSession').catch(() => ({ NotebookSession: undefined, NotebookAutosave: undefined }))
const page = (id = 'page-a', paperId = 'paper-a') => ({ id, name: 'Page 1', width: 1000, height: 1200, objects: [], diagram: { version: 1 as const, paperId, shapes: [], arrows: [], connections: [] } })
const book = (id = 'paper-a'): CanvasNotebook => ({ version: 1, paperId: id, activePageId: 'page-a', pages: [page('page-a', id)] })
const highlight: Highlight = { id: 'highlight-a', page: 3, quote: 'Original evidence', comment: 'Original thought', color: 'yellow', rects: [{ x: .1, y: .2, width: .3, height: .04 }], createdAt: '2026-10-08T12:00:00.000Z' }
const map: MindMapDocument = { version: 1, paperId: 'paper-a', nodes: [{ id: 'root-a', text: 'Root', parentId: null, order: 0 }, { id: 'child-a', text: 'Child', parentId: 'root-a', order: 0 }] }
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function fixture() {
  const module = await modulePromise
  assert.equal(typeof module.NotebookSession, 'function', 'NotebookSession feature is missing')
  const saves: CanvasNotebook[] = []
  const api = { loadCanvasNotebook: async (id: string) => book(id), saveCanvasNotebook: async (_id: string, value: CanvasNotebook) => { saves.push(structuredClone(value)) }, readCanvasHighlight: async () => structuredClone(highlight), loadMindMap: async () => structuredClone(map), loadMarks: async (): Promise<ReadingMarks> => ({ highlights: [], strokes: [] }), importCanvasImage: async () => null, saveCanvasCapture: async () => ({ assetId: '00000000-0000-4000-8000-000000000001', mimeType: 'image/png' as const, width: 200, height: 100 }), readCanvasImage: async (): Promise<CanvasImageData> => ({ assetId: '00000000-0000-4000-8000-000000000001', mimeType: 'image/png', width: 200, height: 100, bytes: new Uint8Array([1]) }) }
  const session = new module.NotebookSession!(api, () => undefined, () => 'blob:test', () => undefined, async () => new Uint8Array([1]))
  await session.open('paper-a')
  return { session, api, saves }
}
test('pages have independent contents, sizes and ordered names; duplicating remaps objects', async () => {
  const { session } = await fixture()
  const id = session.addText(); session.editText(id, 'first page'); session.finish()
  const second = await session.addPage('Second', 1600, 900)
  session.addText(); await session.switchPage('page-a')
  assert.equal(session.activePage!.objects.length, 1)
  const copy = await session.duplicatePage()
  assert.equal(session.activePage!.objects[0].type, 'text')
  assert.notEqual(session.activePage!.objects[0].id, id)
  session.renamePage(copy, 'Copied'); session.reorderPage(copy, -1)
  assert.deepEqual(session.document.pages.map(p => p.name), ['Page 1', 'Copied', 'Second'])
  assert.equal(session.document.pages.find(p => p.id === second)!.width, 1600)
})
test('page shrink refuses objects and arrow endpoints outside the new page without changing the old model', async () => {
  const { session } = await fixture()
  const id = session.addText(); session.updateObject(id, { x: 580, y: 50 })
  const before = structuredClone(session.document)
  assert.throws(() => session.resizePage(600, 1200), /outside|bounds|fit|overflow/i)
  assert.deepEqual(session.document, before)
  session.removeSelected(); const arrow = session.addArrow(); session.updateDiagram(arrow, { start: { x: 100, y: 100 }, end: { x: 900, y: 100 } })
  assert.throws(() => session.resizePage(600, 1200), /outside|bounds|fit|overflow/i)
})
test('a drag is one undo boundary and text resize preserves its font size', async () => {
  const { session } = await fixture(); const id = session.addText()
  session.beginMove(id, { x: 80, y: 80 }); session.moveTo({ x: 130, y: 130 }); session.moveTo({ x: 180, y: 180 }); session.finish()
  assert.equal((session.activePage!.objects[0] as { x: number }).x, 180)
  session.undo(); assert.equal((session.activePage!.objects[0] as { x: number }).x, 80)
  session.redo(); session.beginResize(id, { x: 580, y: 400 }); session.resizeTo({ x: 680, y: 600 }); session.finish()
  const object = session.activePage!.objects[0]
  assert.equal(object.type, 'text')
  if (object.type !== 'text') throw Error('text required')
  assert.equal(object.fontSize, 24); assert.equal(object.width, 500); assert.equal(object.height, 420)
})
test('highlight imports persist independent source and comment copies; repeated imports keep independent IDs', async () => {
  const { session, saves } = await fixture()
  await session.importHighlight('highlight-a'); const first = session.activePage!.objects[0]
  assert.equal(first.type, 'quote')
  if (first.type !== 'quote') throw Error('quote required')
  assert.equal(first.quote, 'Original evidence'); assert.equal(first.source.page, 3)
  session.updateObject(first.id, { comment: 'Canvas thought' }); session.finish(); await session.flush()
  assert.equal(highlight.comment, 'Original thought'); assert.equal((saves.at(-1)!.pages[0].objects[0] as { comment: string }).comment, 'Canvas thought')
  await session.importHighlight('highlight-a')
  assert.equal(session.activePage!.objects.length, 2); assert.notEqual(session.activePage!.objects[1].id, first.id)
})
test('pending highlight import refuses a page switch rather than inserting on either page', async () => {
  const { session, api } = await fixture(); const pending = deferred<Highlight>()
  api.readCanvasHighlight = () => pending.promise
  const importing = session.importHighlight('highlight-a'); await new Promise(resolve => setTimeout(resolve, 0))
  await session.addPage('Second')
  pending.resolve(structuredClone(highlight))
  await assert.rejects(importing, /changed|cancel|page/i)
  assert.equal(session.document.pages.reduce((sum, p) => sum + p.objects.length, 0), 0)
})
test('pending capture from a previous paper never creates a ghost object in the new paper', async () => {
  const { session, api } = await fixture(); const pending = deferred<{ assetId: string; mimeType: 'image/png'; width: number; height: number }>()
  api.saveCanvasCapture = () => pending.promise
  const importing = session.captureImage({ page: 1, rect: { x: .1, y: .1, width: .2, height: .2 }, bytes: new Uint8Array([1]) })
  await new Promise(resolve => setTimeout(resolve, 0)); await session.open('paper-b'); pending.resolve({ assetId: '00000000-0000-4000-8000-000000000001', mimeType: 'image/png', width: 200, height: 100 })
  await assert.rejects(importing, /changed|cancel/i)
  assert.equal(session.paperId, 'paper-b'); assert.equal(session.activePage!.objects.length, 0)
})
test('map imports preserve every relationship with new IDs and refuse unreadable clipped imports', async () => {
  const { session, api } = await fixture()
  await session.importMindMap(); const imported = session.activePage!.objects[0]
  assert.equal(imported.type, 'mindmap')
  if (imported.type !== 'mindmap') throw Error('map required')
  assert.equal(imported.nodes.length, 2); assert.notEqual(imported.nodes[0].id, 'root-a'); assert.equal(imported.nodes[1].parentId, imported.nodes[0].id)
  session.editMapNode(imported.id, imported.nodes[1].id, 'Copied child'); session.finish()
  assert.equal(map.nodes[1].text, 'Child')
  await session.addPage('Small', 256, 256)
  const before = structuredClone(session.document)
  await assert.rejects(session.importMindMap(), /space|size|fit|enlarge/i)
  assert.deepEqual(session.document, before)
  api.loadMindMap = async () => ({ ...map, paperId: 'paper-b' })
  await assert.rejects(session.importMindMap(), /paper|ownership/i)
})
test('legacy ink explicitly copies into its own page without mutating source strokes', async () => {
  const { session, api } = await fixture()
  const marks = { highlights: [], strokes: [{ id: 'old-stroke', points: [{ x: .1, y: .2 }, { x: .4, y: .5 }], color: '#334155', width: .004 }] }
  api.loadMarks = async () => marks
  await session.importLegacyInk()
  assert.equal(session.document.pages.length, 2)
  const copied = session.activePage!.objects[0]
  assert.equal(copied.type, 'stroke')
  if (copied.type !== 'stroke') throw Error('stroke required')
  assert.deepEqual(copied.points, [{ x: 100, y: 240 }, { x: 400, y: 600 }]); assert.notEqual(copied.id, 'old-stroke')
  assert.equal(marks.strokes[0].id, 'old-stroke')
})
test('failed saves retain edits and prevent switching pages until retry succeeds', async () => {
  const { session, api } = await fixture(); session.addText(); const before = structuredClone(session.document)
  api.saveCanvasNotebook = async () => { throw Error('Disk unavailable') }
  await assert.rejects(session.addPage('Second'), /Disk/)
  assert.deepEqual(session.document, before); assert.match(session.status, /failed/i)
})
test('autosave never closes a held gesture and saves it only after completion', async () => {
  const { session, saves } = await fixture(); const module = await modulePromise
  assert.equal(typeof module.NotebookAutosave, 'function')
  const autosave = new module.NotebookAutosave!(session, 10)
  try { const id = session.addText(); autosave.schedule(); session.beginMove(id, { x: 80, y: 80 }); await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(saves.length, 0); assert.equal(session.editing, true); session.moveTo({ x: 120, y: 120 }); session.finish(); autosave.schedule(); await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(saves.length, 1) } finally { autosave.stop() }
})



test('duplicated pages preserve independent quote comments and remap map nodes and connected endpoints', async () => {
  const { session } = await fixture()
  await session.importHighlight('highlight-a')
  const quote = session.activePage!.objects[0]
  session.updateObject(quote.id, { comment: 'Copied independent thought' })
  await session.importMindMap()
  const mapObject = session.activePage!.objects[1]
  const shape = session.addShape('rectangle')
  session.addConnection({ domain: 'base', objectId: quote.id, anchor: 'right' }, { domain: 'shape', objectId: shape, anchor: 'left' })
  await session.duplicatePage()
  const copy = session.activePage!
  assert.equal((copy.objects[0] as { comment:string }).comment, 'Copied independent thought')
  assert.notEqual(copy.objects[0].id, quote.id)
  assert.equal(copy.diagram.connections[0].from.objectId, copy.objects[0].id)
  assert.equal(copy.diagram.connections[0].to.objectId, copy.diagram.shapes[0].id)
  assert.equal(mapObject.type, 'mindmap')
  const copiedMap = copy.objects[1]
  if(mapObject.type !== 'mindmap' || copiedMap.type !== 'mindmap') throw Error('map expected')
  assert.notEqual(copiedMap.nodes[0].id,mapObject.nodes[0].id)
  assert.equal(copiedMap.nodes[1].parentId,copiedMap.nodes[0].id)
})


test('two source imports cannot overlap or accept drawing while an import is pending', async () => {
  const {session,api}=await fixture(); const pending=deferred<Highlight>();api.readCanvasHighlight=()=>pending.promise
  const importing=session.importHighlight('highlight-a');await new Promise(resolve=>setTimeout(resolve,0))
  await assert.rejects(session.importMindMap(),/import|busy|wait/i)
  assert.throws(()=>session.beginStroke({x:30,y:30}),/import|busy|wait/i)
  pending.resolve(structuredClone(highlight));await importing
  assert.equal(session.activePage!.objects.length,1)
})
test('a page command waiting for save cannot add a page after navigation to another paper begins', async () => {
  const {session,api}=await fixture();session.addText();const pending=deferred<void>()
  api.saveCanvasNotebook=async()=>pending.promise
  const adding=session.addPage('Old paper page').then(()=>null,error=>error)
  await new Promise(resolve=>setTimeout(resolve,0))
  const opening=session.open('paper-b');pending.resolve();await opening
  const error=await adding;assert.ok(error instanceof Error);assert.match(error.message,/changed|cancel/i)
  assert.equal(session.paperId,'paper-b');assert.equal(session.document.pages.length,1);assert.equal(session.activePage!.objects.length,0)
})
test('a page duplicate waiting for save cannot duplicate the newly opened paper', async () => {
  const {session,api}=await fixture();session.addText();const pending=deferred<void>()
  api.saveCanvasNotebook=async()=>pending.promise
  const duplicating=session.duplicatePage().then(()=>null,error=>error)
  await new Promise(resolve=>setTimeout(resolve,0));const opening=session.open('paper-b');pending.resolve();await opening
  const error=await duplicating;assert.ok(error instanceof Error);assert.match(error.message,/changed|cancel/i)
  assert.equal(session.document.pages.length,1)
})


test('page command remains busy through its final save and blocks overlapping page commands or edits',async()=>{
  const {session,api}=await fixture(),pending=deferred<void>()
  api.saveCanvasNotebook=async()=>pending.promise
  const adding=session.addPage('Second')
  await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(session.busy,true)
  await assert.rejects(session.duplicatePage(),/busy|wait|page command/i)
  assert.throws(()=>session.addText(),/busy|wait|page command/i)
  pending.resolve();await adding
  assert.equal(session.busy,false);assert.equal(session.document.pages.length,2)
})
test('finish commits active rich DOM state before saving and releases its editor registration',async()=>{
  const {session,saves}=await fixture(),id=session.addText()
  const release=session.registerEditorCommit(()=>session.editText(id,'IME still visible'))
  await session.flush()
  assert.equal((saves.at(-1)!.pages[0].objects[0] as {text:string}).text,'IME still visible')
  release();session.editText(id,'Updated');session.finish()
  assert.equal((session.activePage!.objects[0] as {text:string}).text,'Updated')
})
test('invalid active editor content blocks flush and paper navigation without losing current model',async()=>{
  const {session,saves}=await fixture();session.addText()
  const before=structuredClone(session.document)
  const release=session.registerEditorCommit(()=>{throw Error('Visible text cannot be normalized')})
  await assert.rejects(session.flush(),/normalized/)
  await assert.rejects(session.open('paper-b'),/normalized/)
  assert.equal(saves.length,0);assert.equal(session.paperId,'paper-a');assert.deepEqual(session.document,before)
  release();await session.flush();assert.equal(saves.length,1)
})


test('page shrinking includes the visible stroke radius rather than its centerline only',async()=>{
  const {session}=await fixture()
  session.setStrokeWidth(20);session.beginStroke({x:600,y:100});session.strokeTo({x:640,y:100});session.finish()
  const before=structuredClone(session.document)
  assert.throws(()=>session.resizePage(640,1200),/outside|bounds|fit|overflow/i)
  assert.deepEqual(session.document,before)
})


test('PNG preparation reserves busy state before a slow prerequisite save',async()=>{
  const {session,api}=await fixture();session.addText();const pending=deferred<void>();api.saveCanvasNotebook=()=>pending.promise
  const exporting=session.exportPng();await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(session.busy,true);assert.equal(session.exporting,true)
  await assert.rejects(session.exportPng(),/export|wait/i)
  await assert.rejects(session.addPage(),/export|wait/i)
  pending.resolve();assert.deepEqual(await exporting,new Uint8Array([1]));assert.equal(session.busy,false)
})
test('capture final save cancels its completion if paper navigation begins during that save',async()=>{
  const {session,api}=await fixture(),pending=deferred<void>();api.saveCanvasNotebook=()=>pending.promise
  const importing=session.captureImage({page:1,rect:{x:.1,y:.1,width:.2,height:.2},bytes:new Uint8Array([1])}).then(()=>null,error=>error)
  await new Promise(resolve=>setTimeout(resolve,0));const opening=session.open('paper-b');pending.resolve();await opening
  const error=await importing;assert.ok(error instanceof Error);assert.match(error.message,/changed|cancel/i)
  assert.equal(session.paperId,'paper-b');assert.equal(session.activePage!.objects.length,0)
})
test('legacy ink final save cancels old completion without changing a newly opened paper status',async()=>{
  const {session,api}=await fixture(),pending=deferred<void>()
  api.loadMarks=async()=>({highlights:[],strokes:[{id:'old',points:[{x:.1,y:.1},{x:.2,y:.2}],color:'#334155',width:.004}]})
  api.saveCanvasNotebook=()=>pending.promise
  const importing=session.importLegacyInk().then(()=>null,error=>error)
  await new Promise(resolve=>setTimeout(resolve,0));const opening=session.open('paper-b');pending.resolve();await opening
  const error=await importing;assert.ok(error instanceof Error);assert.match(error.message,/changed|cancel/i)
  assert.equal(session.document.pages.length,1);assert.equal(session.status,'Saved locally')
})


test('idle rich text autosaves snapshots while retaining a single text-edit undo boundary',async()=>{
  const {session,saves}=await fixture(),module=await modulePromise,id=session.addText()
  const autosave=new module.NotebookAutosave!(session,10)
  try{
    session.editText(id,'First typed text');autosave.schedule()
    await new Promise(resolve=>setTimeout(resolve,35))
    assert.equal(saves.length,1);assert.equal(session.editing,true)
    session.editText(id,'Second typed text');autosave.schedule()
    await new Promise(resolve=>setTimeout(resolve,35))
    assert.equal(saves.length,2);assert.equal(session.editing,true)
    session.finish();session.undo()
    assert.equal((session.activePage!.objects[0] as {text:string}).text,'')
  }finally{autosave.stop()}
})


test('adding a new object preserves text committed from the active editor during the command',async()=>{
  const {session}=await fixture(),first=session.addText()
  const release=session.registerEditorCommit(()=>session.editText(first,'Visible unfinished IME'))
  const second=session.addText()
  assert.notEqual(first,second);assert.equal((session.activePage!.objects[0] as {text:string}).text,'Visible unfinished IME')
  release()
})
test('object geometry changes preserve the active editor commit and use the latest text',async()=>{
  const {session}=await fixture(),id=session.addText()
  const release=session.registerEditorCommit(()=>session.editText(id,'Pending DOM text'))
  session.updateObject(id,{width:500})
  const object=session.activePage!.objects[0]
  assert.equal((object as {text:string}).text,'Pending DOM text');assert.equal((object as {width:number}).width,500)
  release()
})


test('delete page saves a candidate before publish, selects neighbours and undo restores page contents and view', async () => {
  for (const index of [0, 1, 2]) {
    const { session, api } = await fixture()
    session.document.surface = 'infinite'
    session.addText(); session.setViewport({ x: -300, y: -120, zoom: 2 })
    await session.addPage('Second'); await session.addPage('Third')
    await session.switchPage(session.document.pages[index].id)
    const original = structuredClone(session.document), sourceId = session.activePage!.id
    api.saveCanvasNotebook = async (_paperId, candidate) => {
      if (candidate.pages.length === 2) assert.equal(session.document.pages.length, 3)
    }
    assert.equal(typeof session.deletePage, 'function', 'Transactional board deletion is missing')
    await session.deletePage()
    assert.equal(session.document.pages.length, 2)
    assert.equal(session.activePage!.id, original.pages[index === 2 ? 1 : index + 1].id)
    session.undo(); assert.deepEqual(session.document, original)
    session.redo(); assert.equal(session.document.pages.length, 2)
    assert.ok(!session.document.pages.some(page => page.id === sourceId))
  }
})
test('delete page refuses the only board and failed source or candidate saves preserve selected content', async () => {
  const { session, api } = await fixture()
  assert.equal(typeof session.deletePage, 'function')
  await assert.rejects(session.deletePage(), /one|last|remain/i)
  await session.addPage('Second'); const id = session.addText(); session.select(id)
  const original = structuredClone(session.document)
  api.saveCanvasNotebook = async () => { throw Error('Source save failed') }
  await assert.rejects(session.deletePage(), /Source save failed/)
  assert.deepEqual(session.document, original); assert.equal(session.selectedId, id)
  api.saveCanvasNotebook = async (_paperId, value) => { if (value.pages.length === 1) throw Error('Candidate save failed') }
  await assert.rejects(session.deletePage(), /Candidate save failed/)
  assert.deepEqual(session.document, original); assert.equal(session.selectedId, id)
  api.saveCanvasNotebook = async () => undefined
  await session.deletePage(); assert.equal(session.document.pages.length, 1)
})
test('owned evidence image inserts at a world point, retains provenance and is one undo boundary', async () => {
  const { session, api } = await fixture(); session.document.surface = 'infinite'
  session.setViewport({ x: -500, y: -300, zoom: 2 }); await session.flush()
  const source = { page: 4, rect: { x: .1, y: .2, width: .3, height: .4 } }
  api.readCanvasImage = async () => ({ assetId: '00000000-0000-4000-8000-000000000001', mimeType: 'image/png', width: 200, height: 100, bytes: new Uint8Array([1]), source })
  assert.equal(typeof session.addOwnedImage, 'function', 'Owned image drop insertion is missing')
  await session.addOwnedImage('00000000-0000-4000-8000-000000000001', { x: -250, y: -180 })
  const image = session.activePage!.objects[0]
  assert.equal(image.type, 'image'); if (image.type !== 'image') throw Error('Image expected')
  assert.equal(image.x, -250); assert.equal(image.y, -180)
  assert.deepEqual(session.assets[image.assetId].source, source)
  session.undo(); assert.equal(session.activePage!.objects.length, 0)
  session.redo(); assert.equal(session.activePage!.objects.length, 1)
})
test('owned image drop rejects mismatched resource ownership and stale paper or page without ghosts', async () => {
  const { session, api } = await fixture()
  assert.equal(typeof session.addOwnedImage, 'function')
  api.readCanvasImage = async () => ({ assetId: '00000000-0000-4000-8000-000000000002', mimeType: 'image/png', width: 200, height: 100, bytes: new Uint8Array([1]) })
  await assert.rejects(session.addOwnedImage('00000000-0000-4000-8000-000000000001'), /ownership|identity/i)
  assert.equal(session.activePage!.objects.length, 0)
  const pending = deferred<CanvasImageData>(); api.readCanvasImage = () => pending.promise
  const dropping = session.addOwnedImage('00000000-0000-4000-8000-000000000001')
  await new Promise(resolve => setTimeout(resolve, 0)); await session.open('paper-b')
  pending.resolve({ assetId: '00000000-0000-4000-8000-000000000001', mimeType: 'image/png', width: 200, height: 100, bytes: new Uint8Array([1]) })
  await assert.rejects(dropping, /changed|cancel/i); assert.equal(session.activePage!.objects.length, 0)
})

test('delete page guards its pending candidate save and cannot publish over a new paper', async () => {
  const { session, api } = await fixture(); await session.addPage('Second')
  const pending = deferred<void>(); api.saveCanvasNotebook = () => pending.promise
  const deleting = session.deletePage(); await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(session.busy, true)
  await assert.rejects(session.deletePage(), /wait|command/i)
  assert.throws(()=>session.removeSelected(), /wait|command/i)
  const opening = session.open('paper-b'); pending.resolve(); await opening
  await assert.rejects(deleting, /changed|cancel/i)
  assert.equal(session.paperId, 'paper-b'); assert.equal(session.document.pages.length, 1); assert.equal(session.status,'Saved locally')
})
test('owned image drop flushes editor first and failed final save retains the image draft and source', async () => {
  const { session, api } = await fixture(), text = session.addText(), assetId = '00000000-0000-4000-8000-000000000001'
  const release = session.registerEditorCommit(()=>session.editText(text,'Visible pending words'))
  let reads = 0; const read = api.readCanvasImage; api.readCanvasImage = async()=>{reads++; return read()}
  api.saveCanvasNotebook = async (_paperId, value)=>{if(value.pages[0].objects.some(object=>object.type==='image'))throw Error('Image save failed')}
  await assert.rejects(session.addOwnedImage(assetId), /Image save failed/)
  assert.equal((session.activePage!.objects[0] as {text:string}).text,'Visible pending words')
  assert.equal(session.activePage!.objects[1].type,'image'); assert.equal(reads,1); assert.equal(session.assets[assetId].url,'blob:test')
  release(); session.undo(); assert.equal(session.activePage!.objects.length,1)
})

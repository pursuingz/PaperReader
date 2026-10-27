import test from 'node:test'
import assert from 'node:assert/strict'
import type { CanvasDocument, CanvasImageAsset, CanvasImageData } from '../../shared/types'
import { CanvasAutosave, CanvasSession, clampCanvasRect, proportionalCanvasRect } from './canvasWorkspace'

const empty = (): CanvasDocument => ({ version: 1, width: 1000, height: 1200, objects: [] })
const asset: CanvasImageAsset = { assetId: '0c1b7a32-e2b8-4589-9975-338d50eeb643', mimeType: 'image/png', width: 400, height: 200 }
const image: CanvasImageData = { ...asset, bytes: new Uint8Array([1, 2, 3]) }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function fixture(load = async (_id: string) => empty()) {
  const saved: Array<{ id: string; value: CanvasDocument }> = []
  const api = { loadCanvas: load, saveCanvas: async (id: string, value: CanvasDocument) => { saved.push({ id, value: structuredClone(value) }) }, importCanvasImage: async (_id: string) => asset as CanvasImageAsset | null, readCanvasImage: async (_id: string, _assetId: string) => image, saveCanvasCapture: async () => asset, exportCanvasPng: async () => ({ canceled: true }) }
  const urls: string[] = [], revoked: string[] = []
  const session = new CanvasSession(api, () => undefined, () => { const url = `blob:owned-${urls.length}`; urls.push(url); return url }, url => revoked.push(url))
  return { saved, api, session, urls, revoked }
}
test('canvas text/history/movement finalize one gesture and flush the latest immutable document', async () => {
  const { session, saved } = fixture(); await session.open('paper-one')
  const id = session.addText(); assert.ok(id); session.editText(id, 'My note')
  session.beginMove(id, { x: 90, y: 90 }); session.moveTo({ x: 400, y: 600 }); session.moveTo({ x: 2000, y: 2000 }); session.finish()
  const moved = session.document.objects[0]; assert.equal(moved.type, 'text'); if (moved.type !== 'text') throw Error('Expected text')
  assert.equal(moved.x + moved.width, 1000); assert.equal(moved.y + moved.height, 1200)
  session.undo(); const restored = session.document.objects[0]; if (restored.type !== 'text') throw Error('Expected text'); assert.equal(restored.x, 80); assert.equal(restored.text, 'My note')
  session.redo(); await session.flush(); assert.equal(saved.length, 1); assert.deepEqual(saved[0], { id: 'paper-one', value: session.document })
  session.editText(id, 'Later note'); assert.equal((saved[0].value.objects[0] as { text: string }).text, 'My note')
})
test('stroke erasure is grouped, undoable and saved when flush interrupts a gesture', async () => {
  const { session, saved } = fixture(); await session.open('paper-one')
  session.beginStroke({ x: 50, y: 50 }); session.strokeTo({ x: 300, y: 50 }); session.finish()
  session.beginStroke({ x: 50, y: 500 }); session.strokeTo({ x: 300, y: 500 }); session.finish()
  session.beginErase({ x: 100, y: 0 }); session.eraseTo({ x: 100, y: 100 }); await session.flush()
  assert.equal(session.document.objects.length, 1); assert.equal(saved[0].value.objects.length, 1)
  session.undo(); assert.equal(session.document.objects.length, 2); session.redo(); assert.equal(session.document.objects.length, 1)
  session.beginStroke({ x: 400, y: 300 }); session.strokeTo({ x: 450, y: 350 }); await session.flush(); assert.equal(saved.at(-1)?.value.objects.length, 2)
})
test('image insertion waits through flush, loads its owned URL and preserves proportional resize', async () => {
  const { session, api, saved } = fixture(), pending = deferred<CanvasImageAsset | null>(); api.importCanvasImage = () => pending.promise
  await session.open('paper-one'); const inserting = session.importImage(), flush = session.flush(); let finished = false; void flush.then(() => { finished = true })
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(finished, false); pending.resolve(asset); await inserting; await flush
  assert.equal(saved.length, 1); const object = session.document.objects[0]; assert.equal(object.type, 'image'); if (object.type !== 'image') throw Error('Expected image')
  assert.equal(object.width / object.height, 2); assert.ok(session.assets[asset.assetId].url)
  session.beginResize(object.id, { x: object.x + object.width, y: object.y + object.height }); session.resizeTo({ x: 2000, y: 2000 }); session.finish()
  const resized = session.document.objects[0]; if (resized.type !== 'image') throw Error('Expected image')
  assert.equal(resized.width / resized.height, 2); assert.ok(resized.x + resized.width <= 1000); assert.ok(resized.y + resized.height <= 1200)
})
test('late load/import responses cannot overwrite another paper and switching revokes owned URLs', async () => {
  const pendingLoad = deferred<CanvasDocument>(), { session, api, revoked } = fixture(id => id === 'slow' ? pendingLoad.promise : Promise.resolve(empty()))
  const opening = session.open('slow'); await session.open('current'); session.addText(); pendingLoad.resolve(empty()); await opening; assert.equal(session.paperId, 'current'); assert.equal(session.document.objects.length, 1)
  const pendingImport = deferred<CanvasImageAsset | null>(); api.importCanvasImage = () => pendingImport.promise
  const importing = session.importImage(); await session.open('third'); pendingImport.resolve(asset); await importing; assert.equal(session.document.objects.length, 0)
  api.importCanvasImage = async () => asset; await session.importImage(); assert.ok(session.assets[asset.assetId].url); await session.open(null); assert.equal(revoked.length, 1)
})
test('failed loads stay read-only and never save an empty document; missing images stay recoverable', async () => {
  const { session, api, saved } = fixture(async () => { throw Error('Damaged canvas') })
  await assert.rejects(session.open('broken'), /Damaged/); assert.equal(session.ready, false); assert.equal(session.addText(), null); await session.flush(); assert.equal(saved.length, 0)
  api.loadCanvas = async () => ({ ...empty(), objects: [{ id: 'image-one', type: 'image', x: 10, y: 10, width: 200, height: 100, assetId: asset.assetId }] })
  api.readCanvasImage = async () => { throw Error('Resource missing') }; await session.open('images'); assert.equal(session.ready, true); assert.equal(session.document.objects.length, 1)
  await new Promise(resolve => setTimeout(resolve, 0)); assert.match(session.assets[asset.assetId].error ?? '', /missing/i)
})
test('rectangle helpers clamp movement and proportional resizing without changing aspect', () => {
  assert.deepEqual(clampCanvasRect({ x: -1, y: 1300, width: 400, height: 200 }), { x: 0, y: 1000, width: 400, height: 200 })
  const result = proportionalCanvasRect({ x: 800, y: 1000, width: 100, height: 50 }, 1000)
  assert.equal(result.width, 200); assert.equal(result.height, 100); assert.equal(result.width / result.height, 2)
})
test('failed saves retain latest edits and retry without mixing late writes into another paper', async () => {
  const { session, api, saved } = fixture(), pending = deferred<void>()
  await session.open('first'); const id = session.addText(); assert.ok(id); session.editText(id, 'Protected draft'); session.finish()
  let fail = true; api.saveCanvas = async (id, document) => { if (fail) throw Error('Disk unavailable'); saved.push({ id, value: structuredClone(document) }) }
  await assert.rejects(session.flush(), /Disk/); assert.match(session.status, /failed/i); assert.equal((session.document.objects[0] as { text: string }).text, 'Protected draft')
  fail = false; await session.flush(); assert.equal(saved[0].id, 'first')
  api.saveCanvas = async (id, document) => { await pending.promise; saved.push({ id, value: structuredClone(document) }) }
  session.editText(id, 'Late first write'); session.finish(); const flushing = session.flush(); await session.open('second'); session.addText(); pending.resolve(); await flushing
  assert.equal(session.paperId, 'second'); assert.equal(session.document.objects.length, 1); assert.equal((saved.at(-1)?.value.objects[0] as { text: string }).text, 'Late first write')
})
test('late failed image read cannot create ghost warnings after object removal, retry revokes replaced URLs', async () => {
  const { session, api, revoked } = fixture(), pending = deferred<CanvasImageData>()
  api.loadCanvas = async () => ({ ...empty(), objects: [{ id: 'image-one', type: 'image', x: 10, y: 10, width: 200, height: 100, assetId: asset.assetId }] })
  api.readCanvasImage = () => pending.promise; await session.open('paper-one'); session.select('image-one'); session.removeSelected(); pending.reject(Error('Resource missing')); await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(session.assets, {})
  api.readCanvasImage = async () => image; api.loadCanvas = async () => empty(); await session.open('another'); await session.importImage(); assert.ok(session.assets[asset.assetId].url)
  await session.retryImage(asset.assetId); assert.equal(revoked.length, 1); assert.ok(session.assets[asset.assetId].url)
})
test('extreme image aspect ratios still insert within the canvas and retain their proportions', async () => {
  const { session, api } = fixture(); await session.open('paper-one')
  api.importCanvasImage = async () => ({ ...asset, width: 4096, height: 1 }); await session.importImage()
  const first = session.document.objects[0]; assert.equal(first.type, 'image'); if (first.type !== 'image') throw Error('Expected image')
  assert.equal(first.width / first.height, 4096); assert.ok(first.width <= 1000 && first.height > 0)
})
test('browser image decode failure revokes its URL, exposes a recoverable placeholder and retains the object', async () => {
  const { session, revoked } = fixture(); await session.open('paper-one'); await session.importImage()
  session.imageUnavailable(asset.assetId); assert.equal(revoked.length, 1); assert.equal(session.document.objects.length, 1); assert.match(session.assets[asset.assetId].error ?? '', /displayed|preserved/i); assert.equal(session.assets[asset.assetId].url, undefined)
  await session.retryImage(asset.assetId); assert.ok(session.assets[asset.assetId].url); assert.equal(session.document.objects.length, 1)
})
function autosaveFixture() {
  const saved: CanvasDocument[] = []
  let autosave: CanvasAutosave | undefined
  const session = new CanvasSession({ loadCanvas: async () => empty(), saveCanvas: async (_id, value) => { saved.push(structuredClone(value)) }, importCanvasImage: async () => asset, readCanvasImage: async () => image, saveCanvasCapture: async () => asset, exportCanvasPng: async () => ({ canceled: true }) }, () => autosave?.schedule(), () => 'blob:autosave-fixture', () => undefined)
  autosave = new CanvasAutosave(session, () => session.flush(), 20)
  return { session, autosave, saved }
}
const longHold = () => new Promise(resolve => setTimeout(resolve, 45))
test('pending autosave cannot finish a long-held move before its first pointer movement', async () => {
  const { session, autosave, saved } = autosaveFixture()
  try {
    await session.open('paper-one'); const id = session.addText(); assert.ok(id)
    session.beginMove(id, { x: 90, y: 90 }); await longHold()
    assert.equal(session.editing, true); assert.equal(saved.length, 0)
    session.moveTo({ x: 390, y: 290 }); session.finish(); await longHold()
    const object = session.document.objects[0]; assert.equal(object.type, 'text'); if (object.type !== 'text') throw Error('Expected text')
    assert.equal(object.x, 380); assert.equal(object.y, 280); assert.equal(saved.length, 1)
  } finally { autosave.stop() }
})
test('pending autosave cannot finish a long-held image resize before pointer movement', async () => {
  const first = autosaveFixture()
  try {
    await first.session.open('paper-one'); await first.session.importImage(); const object = first.session.document.objects[0]
    if (object.type !== 'image') throw Error('Expected image')
    first.session.beginResize(object.id, { x: object.x + object.width, y: object.y + object.height }); await longHold()
    assert.equal(first.session.editing, true); assert.equal(first.saved.length, 0)
    first.session.resizeTo({ x: object.x + object.width + 100, y: object.y + object.height }); first.session.finish(); await longHold()
    const resized = first.session.document.objects[0]; if (resized.type !== 'image') throw Error('Expected image')
    assert.equal(resized.width, object.width + 100); assert.equal(first.saved.length, 1)
  } finally { first.autosave.stop() }
})
test('pending autosave cannot finish a long-held eraser that initially hits no stroke', async () => {
  const second = autosaveFixture()
  try {
    await second.session.open('paper-one'); second.session.beginStroke({ x: 50, y: 600 }); second.session.strokeTo({ x: 300, y: 600 }); second.session.finish()
    second.session.beginErase({ x: 20, y: 20 }); await longHold()
    assert.equal(second.session.editing, true); assert.equal(second.saved.length, 0)
    second.session.eraseTo({ x: 100, y: 650 }); second.session.finish(); await longHold()
    assert.equal(second.session.document.objects.length, 0); assert.equal(second.saved.length, 1)
  } finally { second.autosave.stop() }
})
test('autosave callback rechecks active editing even when its scheduling notification was missed', async () => {
  const { session, saved } = fixture(), autosave = new CanvasAutosave(session, () => session.flush(), 20)
  try {
    await session.open('paper-one'); const id = session.addText(); assert.ok(id); autosave.schedule()
    session.beginMove(id, { x: 90, y: 90 }); await longHold()
    assert.equal(saved.length, 0); assert.equal(session.editing, true)
  } finally { autosave.stop() }
})

test('legacy Canvas pen accepts six-digit custom color while rejecting malformed input', async () => {
  const { session, saved } = fixture(); await session.open('paper-one')
  session.setColor('#123abc'); session.addText(); await session.flush()
  assert.equal((saved[0].value.objects[0] as {color:string}).color, '#123abc')
  session.setColor('red'); assert.equal(session.color, '#123abc')
})

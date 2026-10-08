import test from 'node:test'
import assert from 'node:assert/strict'
import type { CanvasDocument, CanvasImageAsset, CanvasImageData, PdfCaptureInput } from '../../shared/types'
import { CanvasSession } from './canvasWorkspace'

const empty = (): CanvasDocument => ({ version: 1, width: 1000, height: 1200, objects: [] })
const asset: CanvasImageAsset = { assetId: '0c1b7a32-e2b8-4589-9975-338d50eeb643', mimeType: 'image/png', width: 400, height: 200 }
const capture = (): PdfCaptureInput => ({ page: 3, rect: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 }, bytes: new Uint8Array([1, 2, 3]) })
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function fixture() {
  const saved: Array<{ id: string; document: CanvasDocument }> = [], captures: Array<{ id: string; capture: PdfCaptureInput }> = [], exports: Array<{ id: string; bytes: Uint8Array }> = []
  const api = {
    loadCanvas: async (_id: string) => empty(), saveCanvas: async (id: string, document: CanvasDocument) => { saved.push({ id, document: structuredClone(document) }) },
    importCanvasImage: async (_id: string) => asset,
    saveCanvasCapture: async (id: string, value: PdfCaptureInput) => { captures.push({ id, capture: value }); return asset },
    readCanvasImage: async (_id: string, _assetId: string): Promise<CanvasImageData> => ({ ...asset, bytes: capture().bytes, source: { page: 3, rect: capture().rect } }),
    exportCanvasPng: async (id: string, bytes: Uint8Array) => { exports.push({ id, bytes }); return { canceled: false, fileName: 'paper-canvas.png' } }
  }
  const session = new CanvasSession(api, () => undefined, () => 'blob:owned', () => undefined)
  return { api, session, saved, captures, exports }
}
test('capture snapshots bytes/source, flush waits, and restart read exposes source without changing Canvas object schema', async () => {
  const { session, api, saved, captures } = fixture(), gate = deferred<CanvasImageAsset>()
  const saveCapture = api.saveCanvasCapture; api.saveCanvasCapture = async (id, value) => { await saveCapture(id, value); return gate.promise }
  await session.open('paper-a'); const value = capture(), adding = session.captureImage(value); value.bytes.fill(9); value.rect.x = 0.8
  let finished = false; const saving = session.flush().then(() => { finished = true }); await Promise.resolve(); assert.equal(finished, false)
  gate.resolve(asset); await adding; await saving
  assert.deepEqual(captures[0], { id: 'paper-a', capture: capture() }); assert.equal(saved[0].document.objects.length, 1)
  assert.equal(Object.hasOwn(saved[0].document.objects[0], 'source'), false); assert.deepEqual(session.assets[asset.assetId].source, { page: 3, rect: capture().rect })
  session.undo(); await session.flush(); assert.equal(session.document.objects.length, 0)
})
test('late capture cannot attach to the next paper', async () => {
  const { session, api, saved } = fixture(), gate = deferred<CanvasImageAsset>(); api.saveCanvasCapture = async () => gate.promise
  await session.open('paper-a'); const adding = session.captureImage(capture()); await session.open('paper-b'); gate.resolve(asset); await adding; await session.flush()
  assert.equal(session.paperId, 'paper-b'); assert.deepEqual(session.document, empty()); assert.equal(saved.length, 0)
})
test('PNG export locks changes, waits pending capture and save, and uses the complete model without viewport state', async () => {
  const { session, api, saved, exports } = fixture(), captureGate = deferred<CanvasImageAsset>(), rasterGate = deferred<Uint8Array>()
  api.saveCanvasCapture = async () => captureGate.promise; await session.open('paper-a')
  const textId = session.addText()!; session.editText(textId, '中文 reader'); session.updateObject(textId, { y: 900 }); const adding = session.captureImage(capture())
  const snapshots: CanvasDocument[] = [], exportTask = session.exportPng(async (id, document) => { assert.equal(id, 'paper-a'); snapshots.push(document); return rasterGate.promise })
  assert.equal(session.exporting, true); assert.equal(session.addText(), null); session.undo(); session.updateObject(textId, { y: 0 }); assert.equal(session.beginStroke({ x: 0, y: 0 }), false)
  await session.captureImage(capture()); assert.equal(session.document.objects.length, 1)
  captureGate.resolve(asset); await adding; await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(saved.length, 1); assert.equal(snapshots[0].objects.length, 2); assert.equal(snapshots[0].objects[0].type === 'text' && snapshots[0].objects[0].y, 900)
  assert.equal(exports.length, 0); assert.notEqual(snapshots[0], session.document)
  rasterGate.resolve(new Uint8Array([7, 8])); assert.deepEqual(await exportTask, { canceled: false, fileName: 'paper-canvas.png' }); assert.deepEqual(exports, [{ id: 'paper-a', bytes: new Uint8Array([7, 8]) }]); assert.equal(session.exporting, false)
})
test('export failure/cancellation releases lock and a stale export never writes for another paper', async () => {
  const { session, api, exports } = fixture(); await session.open('paper-a'); session.addText()
  await assert.rejects(session.exportPng(async () => { throw new Error('Unavailable image') }), /Unavailable image/); assert.equal(session.exporting, false); assert.equal(exports.length, 0); assert.ok(session.addText())
  api.exportCanvasPng = async () => ({ canceled: true, fileName: '' }); assert.equal((await session.exportPng(async () => new Uint8Array([1]))).canceled, true); assert.equal(session.exporting, false)
  const gate = deferred<Uint8Array>(), exporting = session.exportPng(async () => gate.promise); await new Promise(resolve => setTimeout(resolve, 0)); await session.open('paper-b'); gate.resolve(new Uint8Array([2])); await assert.rejects(exporting, /changed|paper|canceled/i); assert.equal(exports.length, 0); assert.equal(session.paperId, 'paper-b')
})
test('a pending capture or image import failure stops that PNG export and a later export can retry', async () => {
  for (const operation of ['capture', 'image'] as const) {
    const { session, api, exports } = fixture(), gate = deferred<CanvasImageAsset>(); await session.open('paper-a')
    api.saveCanvasCapture = async () => gate.promise; api.importCanvasImage = async () => gate.promise
    const adding = operation === 'capture' ? session.captureImage(capture()) : session.importImage(); const failedAdding = assert.rejects(adding, /Capture write failed/)
    let rasterCalls = 0; const exporting = session.exportPng(async () => { rasterCalls++; return new Uint8Array([1]) })
    const failedExport = assert.rejects(exporting, /Capture write failed/); gate.reject(new Error('Capture write failed')); await failedAdding; await failedExport
    assert.equal(rasterCalls, 0); assert.equal(exports.length, 0); assert.equal(session.exporting, false)
    assert.equal((await session.exportPng(async () => new Uint8Array([2]))).canceled, false); assert.equal(exports.length, 1)
  }
})

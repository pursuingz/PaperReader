import test from 'node:test'
import assert from 'node:assert/strict'
import { FigurePdfSession, SummaryFigureEdits, figureCropFromPointer, figureDialogTabTarget, figurePreviewGeometry, matchingFigureCrop, updateFigureCrop } from './summaryFigureSession'
import type { PaperSourceEntry, SummaryFigures, SummaryFigureCapture } from '../../shared/types'

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const entry: PaperSourceEntry = { id: 'source-1', kind: 'figure', label: 'Figure 1', text: 'Figure 1. Measured data.', pages: [2] }
const manifest = (paperId = 'paper-a'): SummaryFigures => ({ paperId, version: 1, crops: [{ entryId: entry.id, caption: entry.text, page: 2, rect: { x: .1, y: .2, width: .3, height: .4 }, assetId: 'asset-1' }] })
const capture = (): SummaryFigureCapture => ({ entryId: entry.id, caption: entry.text, page: 2, rect: { x: 0, y: 0, width: .5, height: .5 }, bytes: new Uint8Array([1]) })

test('index rebuild cannot attach an old crop to a different caption, kind or page', () => {
  assert.equal(matchingFigureCrop(manifest(), entry, 2)?.assetId, 'asset-1')
  assert.equal(matchingFigureCrop(manifest(), { ...entry, text: 'Figure 1. Another figure.' }, 2), null)
  assert.equal(matchingFigureCrop(manifest(), { ...entry, kind: 'table' }, 2), null)
  assert.equal(matchingFigureCrop(manifest(), entry, 1), null)
})

test('portrait and rotated landscape rasters keep aspect ratio within memory bounds', () => {
  assert.deepEqual(figurePreviewGeometry({ width: 600, height: 800 }), { width: 1350, height: 1800, scale: 2.25 })
  assert.deepEqual(figurePreviewGeometry({ width: 800, height: 600 }), { width: 1600, height: 1200, scale: 2 })
  assert.throws(() => figurePreviewGeometry({ width: 0, height: 200 }), /dimensions/i)
  const enormous = figurePreviewGeometry({ width: 1000000, height: 2000000 })
  assert.ok(enormous.width * enormous.height <= 2880000)
})

test('keyboard crop adjustments remain inside the page and reject non-finite input', () => {
  const moved = updateFigureCrop({ x: .1, y: .2, width: .4, height: .5 }, 'x', 95)!
  assert.equal(moved.x, .95); assert.ok(Math.abs(moved.width - .05) < 1e-12); assert.equal(moved.y, .2); assert.equal(moved.height, .5)
  assert.deepEqual(updateFigureCrop({ x: .1, y: .2, width: .4, height: .5 }, 'width', 100), { x: .1, y: .2, width: .9, height: .5 })
  assert.equal(updateFigureCrop({ x: 0, y: 0, width: 1, height: 1 }, 'x', NaN), null)
  const nearEdge = updateFigureCrop({ x: .997, y: 0, width: .003, height: .5 }, 'width', 50)!
  assert.ok(nearEdge.width > 0 && nearEdge.x + nearEdge.width <= 1, 'A narrow saved region must not grow past the page edge')
})

test('filling left top width height from the default whole-page crop retains the requested start', () => {
  let rect = { x: 0, y: 0, width: 1, height: 1 }
  for (const [field, percent] of [['x', 15], ['y', 20], ['width', 65], ['height', 40]] as const) rect = updateFigureCrop(rect, field, percent)!
  assert.deepEqual(rect, { x: .15, y: .2, width: .65, height: .4 })
  const edge = updateFigureCrop(rect, 'x', 100)!
  assert.ok(edge.x < 1 && edge.width > 0 && edge.x + edge.width <= 1)
})

test('scrolling during a drag uses the current page position with the original normalized start', () => {
  assert.deepEqual(figureCropFromPointer({ x: .1, y: .2 }, { x: 220, y: 130 }, { left: 20, top: 50, width: 400, height: 200 }, 8), { x: .1, y: .2, width: .4, height: .2 })
  assert.deepEqual(figureCropFromPointer({ x: .5, y: .6 }, { x: 20, y: 50 }, { left: 20, top: 50, width: 400, height: 200 }, 8), { x: 0, y: 0, width: .5, height: .6 })
})

test('a pending modal traps Tab even when every form control is disabled', () => {
  assert.equal(figureDialogTabTarget([], 'background', false), 'dialog')
  assert.equal(figureDialogTabTarget(['close', 'save'], 'background', false), 'close')
  assert.equal(figureDialogTabTarget(['close', 'save'], 'save', false), 'close')
  assert.equal(figureDialogTabTarget(['close', 'save'], 'close', true), 'save')
  assert.equal(figureDialogTabTarget(['close', 'save'], 'close', false), null)
})

test('failed manifest load keeps crop saving read-only until explicit successful reload', async () => {
  let fail = true, saves = 0
  const session = new SummaryFigureEdits({ loadSummaryFigures: async id => { if (fail) throw new Error('Damaged manifest'); return manifest(id) }, saveSummaryFigure: async id => { saves++; return manifest(id) }, resetSummaryFigure: async id => manifest(id) })
  await assert.rejects(session.open('paper-a'), /Damaged/)
  await assert.rejects(session.save(capture()), /load/i)
  assert.equal(saves, 0)
  fail = false; await session.open('paper-a'); assert.equal((await session.save(capture()))?.paperId, 'paper-a')
})

test('save snapshots bytes and refuses an overlapping reset', async () => {
  const gate = deferred<SummaryFigures>(), called = deferred<void>(); let saved: SummaryFigureCapture | null = null
  const session = new SummaryFigureEdits({ loadSummaryFigures: async id => manifest(id), saveSummaryFigure: async (_id, input) => { saved = input; called.resolve(); return gate.promise }, resetSummaryFigure: async id => manifest(id) })
  await session.open('paper-a'); const input = capture(), pending = session.save(input); input.bytes[0] = 9; input.rect.width = .9
  await called.promise; await assert.rejects(session.reset(entry.id), /progress/i)
  assert.equal(saved!.bytes[0], 1); assert.equal(saved!.rect.width, .5)
  gate.resolve(manifest()); assert.equal((await pending)?.paperId, 'paper-a'); assert.equal(session.busy, false)
})

test('late load/save cannot publish old-paper data or unlock a new-paper operation', async () => {
  const old = deferred<SummaryFigures>(), newer = deferred<SummaryFigures>()
  const session = new SummaryFigureEdits({ loadSummaryFigures: async id => manifest(id), saveSummaryFigure: (id) => id === 'paper-a' ? old.promise : newer.promise, resetSummaryFigure: async id => manifest(id) })
  await session.open('paper-a'); const first = session.save(capture())
  await session.open('paper-b'); const second = session.save(capture())
  old.resolve(manifest('paper-a')); assert.equal(await first, null); assert.equal(session.busy, true)
  session.close(); newer.resolve(manifest('paper-b')); assert.equal(await second, null)
})

test('PDF opening copies transferred bytes and cancellation ignores late loading tasks', async () => {
  const bytes = new Uint8Array([1, 2]), loaded = deferred<{ numPages: number; getPage(): Promise<{ cleanup(): void }> }>(); let received: Uint8Array | null = null, destroyed = 0
  const session = new FigurePdfSession(async () => bytes, value => { received = value; return { promise: loaded.promise, destroy: async () => { destroyed++ } } })
  const pending = session.open('paper-a'); await Promise.resolve(); assert.notEqual(received, bytes)
  await session.close(); loaded.resolve({ numPages: 2, getPage: async () => ({ cleanup() {} }) }); assert.equal(await pending, null); assert.equal(destroyed, 1)
})

test('switching figures cancels prior render and waits to clean its PDF page', async () => {
  const entered = deferred<void>(), done = deferred<void>(); let cancelled = 0, cleaned = 0
  const doc = { numPages: 3, getPage: async () => ({ cleanup() { cleaned++ } }) }
  const session = new FigurePdfSession(async () => new Uint8Array([1]), () => ({ promise: Promise.resolve(doc), destroy: async () => {} }))
  await session.open('paper-a')
  const old = session.render(1, () => { entered.resolve(); return { promise: done.promise, cancel() { cancelled++ } } })
  await entered.promise
  let drewNew = false
  const newer = session.render(2, () => { drewNew = true; return { promise: Promise.resolve(), cancel() {} } })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(drewNew, false, 'New draw must not reuse a canvas while the cancelled render still owns it')
  assert.equal(cancelled, 1); assert.equal(cleaned, 0)
  done.resolve(); assert.equal(await old, false)
  assert.equal(await newer, true); assert.equal(cleaned, 2)
  await session.close()
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { copySavedSourceToNotebook, finishAndFlushNoteWorkspaces, exportNotebookPage, exportStandaloneMap, switchNoteWorkspace } from './noteWorkspaceIntegration'
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
test('copy awaits source persistence and destination save before switching the tab', async () => {
  const order: string[] = [], source = deferred(), destination = deferred()
  const operation = copySavedSourceToNotebook({ flushSource: async () => { order.push('source-start'); await source.promise; order.push('source-saved') }, copy: async () => { order.push('copy-start'); await destination.promise; order.push('copy-saved') }, isCurrent: () => true, showCanvas: () => { order.push('canvas') } })
  assert.deepEqual(order, ['source-start']); source.resolve(); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, ['source-start','source-saved','copy-start']); destination.resolve(); assert.equal(await operation, true)
  assert.deepEqual(order, ['source-start','source-saved','copy-start','copy-saved','canvas'])
})
test('source and destination failures preserve the source tab and never continue a failed stage', async () => {
  const events: string[] = []
  await assert.rejects(copySavedSourceToNotebook({ flushSource: async () => { throw new Error('source save failed') }, copy: async () => { events.push('copy') }, isCurrent: () => true, showCanvas: () => { events.push('switch') } }), /source save failed/)
  assert.equal(events.length, 0)
  await assert.rejects(copySavedSourceToNotebook({ flushSource: async () => { events.push('saved') }, copy: async () => { throw new Error('notebook save failed') }, isCurrent: () => true, showCanvas: () => { events.push('switch') } }), /notebook save failed/)
  assert.deepEqual(events, ['saved'])
})
test('late saves or imports cannot change another paper or a new visit to the same paper', async () => {
  let current = true, copied = false, switched = false
  assert.equal(await copySavedSourceToNotebook({ flushSource: async () => { current = false }, copy: async () => { copied = true }, isCurrent: () => current, showCanvas: () => { switched = true } }), false)
  assert.equal(copied, false); assert.equal(switched, false)
  current = true
  assert.equal(await copySavedSourceToNotebook({ flushSource: async () => undefined, copy: async () => { current = false }, isCurrent: () => current, showCanvas: () => { switched = true } }), false)
  assert.equal(switched, false)
})
test('all note editors finish and settle pending saves even when one save fails', async () => {
  const pending = deferred(), events: string[] = []
  const failure = finishAndFlushNoteWorkspaces([{ finish: () => { events.push('finish-map') }, flush: async () => { events.push('map-save'); throw new Error('map failed') } }, { finish: () => { events.push('finish-notebook') }, flush: async () => { events.push('notebook-save'); await pending.promise; events.push('notebook-settled') } }])
  const checked = assert.rejects(failure, /map failed/)
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(events, ['finish-map','finish-notebook','map-save','notebook-save'])
  pending.resolve(); await checked; assert.equal(events.at(-1), 'notebook-settled')
})
test('switching a sibling tab waits for all editors and refuses failed or stale transitions', async () => {
  const events: string[] = []
  assert.equal(await switchNoteWorkspace({ flush: async () => { events.push('save') }, isCurrent: () => true, select: () => { events.push('select') } }), true)
  assert.deepEqual(events, ['save','select'])
  await assert.rejects(switchNoteWorkspace({ flush: async () => { throw new Error('save refused') }, isCurrent: () => true, select: () => { events.push('wrong') } }), /save refused/)
  assert.equal(await switchNoteWorkspace({ flush: async () => undefined, isCurrent: () => false, select: () => { events.push('wrong') } }), false)
  assert.deepEqual(events, ['save','select'])
})
test('Canvas PNG always targets the captured notebook page regardless of the map tab', async () => {
  const events: unknown[] = [], bytes = Uint8Array.of(1,2,3)
  const result = await exportNotebookPage({ paperId: 'paper-a', pageId: 'notebook-page-b', flush: async () => { events.push('save') }, raster: async () => { events.push('notebook-raster'); return bytes }, save: async (paperId, pageId, png) => { events.push([paperId,pageId,png]); return { canceled: false } }, isCurrent: () => true })
  assert.deepEqual(events, ['save','notebook-raster',['paper-a','notebook-page-b',bytes]]); assert.equal(result.canceled,false)
})
test('standalone map PNG selects only the map raster and independent export API', async () => {
  const events: unknown[] = [], bytes = Uint8Array.of(9)
  await exportStandaloneMap({ paperId: 'paper-a', flush: async () => { events.push('save') }, selectMap: async () => { events.push('mind-map') }, raster: async () => { events.push('map-raster'); return bytes }, save: async (paperId,png) => { events.push([paperId,png]) }, isCurrent: () => true })
  assert.deepEqual(events,['save','mind-map','map-raster',['paper-a',bytes]])
})
test('an export stops before the Save API if its paper or page changed during raster work', async () => {
  let current = true, saved = false
  await assert.rejects(exportNotebookPage({ paperId: 'a', pageId: 'page', flush: async () => undefined, raster: async () => { current=false; return new Uint8Array() }, save: async () => { saved=true }, isCurrent: () => current }), /changed/)
  assert.equal(saved,false)
})

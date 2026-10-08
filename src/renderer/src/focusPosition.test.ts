import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FocusPositionRestore, type FocusPosition } from './focusPosition'

const anchor: FocusPosition = { paperId: 'paper-a', page: 1, top: .25, left: .1, fullscreen: true }
function fixture() {
  const jobs = new Set<() => void>(), applied: FocusPosition[] = []
  let valid = true
  const restore = new FocusPositionRestore(value => { if (!valid) return false; applied.push(value); return true }, task => { jobs.add(task); return () => { jobs.delete(task) } })
  return { restore, applied, tick: () => { for (const job of [...jobs]) { jobs.delete(job); job() } }, invalidate: () => { valid = false }, validate: () => { valid = true } }
}
test('an old render during save cannot consume the position before native fullscreen confirms', () => {
  const f = fixture(); f.restore.begin(anchor)
  f.restore.rendered(f.restore.generation); f.tick()
  assert.equal(f.applied.length, 0)
  f.restore.confirm(false); f.tick(); assert.equal(f.applied.length, 0)
  f.restore.layout(true); f.restore.confirm(true); f.tick(); assert.equal(f.applied.length, 0)
  f.restore.rendered(f.restore.generation); f.tick()
  assert.deepEqual(f.applied, [anchor]); assert.equal(f.restore.pending, null)
})
test('an intermediate width render cannot restore after a later viewport resize', () => {
  const f = fixture(); f.restore.begin(anchor); f.restore.confirm(true)
  const old = f.restore.generation
  f.restore.rendered(old); f.restore.layout(true); f.restore.rendered(old); f.tick()
  assert.equal(f.applied.length, 0)
  f.restore.rendered(f.restore.generation); f.tick(); assert.equal(f.applied.length, 1)
})
test('a height-only resize waits for stability without requiring another PDF raster', () => {
  const f = fixture(); f.restore.begin(anchor); f.restore.confirm(true)
  f.restore.rendered(f.restore.generation); f.restore.layout(false); f.tick()
  assert.deepEqual(f.applied, [anchor])
})
test('a height-only resize between PDF completion and its animation frame retains that final raster', () => {
  const f = fixture(); f.restore.begin(anchor); f.restore.confirm(true)
  const completedRaster = f.restore.generation
  f.restore.layout(false); f.restore.rendered(completedRaster); f.tick()
  assert.deepEqual(f.applied, [anchor])
})
test('a frame rejected by the current DOM guard retains its position until a valid render', () => {
  const f = fixture(); f.restore.begin(anchor); f.restore.confirm(true); f.invalidate()
  f.restore.rendered(f.restore.generation); f.tick(); assert.equal(f.applied.length, 0)
  assert.deepEqual(f.restore.pending, anchor)
  f.validate(); f.restore.rendered(f.restore.generation); f.tick(); assert.equal(f.applied.length, 1)
})
test('user interaction cancels a pending restore instead of moving them back later', () => {
  const f = fixture(); f.restore.begin(anchor); f.restore.confirm(true)
  f.restore.rendered(f.restore.generation); f.restore.cancel(); f.tick()
  assert.equal(f.applied.length, 0); assert.equal(f.restore.pending, null)
})
test('a reversed fullscreen transition ignores the prior scheduled restoration', () => {
  const f = fixture(); f.restore.begin(anchor); f.restore.confirm(true); f.restore.rendered(f.restore.generation)
  const exit = { ...anchor, fullscreen: false }
  f.restore.begin(exit); f.restore.confirm(true); f.tick(); assert.equal(f.applied.length, 0)
  f.restore.layout(true); f.restore.rendered(f.restore.generation); f.restore.confirm(false); f.tick()
  assert.deepEqual(f.applied, [exit])
})

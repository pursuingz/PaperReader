import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RenderPositionRestore } from './focusPosition'
import type { ReadingLocation } from './readingHistory'

const destination: ReadingLocation & { fullscreen: boolean } = { paperId: 'paper-a', page: 1, view: 'reader', zoom: 100, scrollTop: 120, scrollLeft: 0, fullscreen: false }
function fixture() {
  const jobs = new Set<() => void>(); let top = 0, valid = true
  const restore = new RenderPositionRestore<typeof destination>(value => { if (!valid) return false; top = value.scrollTop; return true }, task => { jobs.add(task); return () => { jobs.delete(task) } })
  return { restore, top: () => top, clamp: () => { top = 0 }, invalidate: () => { valid = false }, validate: () => { valid = true }, tick: () => { for (const job of [...jobs]) { jobs.delete(job); job() } } }
}
test('history retains its absolute target across an intermediate 759px raster and final 754px remount', () => {
  const f = fixture(); f.restore.begin(destination); f.restore.confirm(false)
  f.restore.rendered(f.restore.generation)
  f.restore.layout(true); f.clamp(); f.tick(); assert.equal(f.top(), 0)
  assert.equal(f.restore.pending?.scrollTop, 120)
  f.restore.rendered(f.restore.generation); f.tick(); assert.equal(f.top(), 120); assert.equal(f.restore.pending, null)
})
test('a hidden or incorrectly scaled history page cannot consume its absolute target', () => {
  const f = fixture(); f.restore.begin(destination); f.restore.confirm(false); f.invalidate()
  f.restore.rendered(f.restore.generation); f.tick(); assert.equal(f.top(), 0); assert.equal(f.restore.pending?.scrollTop, 120)
  f.validate(); f.restore.rendered(f.restore.generation); f.tick(); assert.equal(f.top(), 120)
})
test('a new history travel replaces the pending target and cancels the old scheduled write', () => {
  const f = fixture(); f.restore.begin(destination); f.restore.confirm(false); f.restore.rendered(f.restore.generation)
  f.restore.begin({ ...destination, page: 3, zoom: 130, scrollTop: 230 }); f.restore.confirm(false); f.tick(); assert.equal(f.top(), 0)
  f.restore.rendered(f.restore.generation); f.tick(); assert.equal(f.top(), 230)
})

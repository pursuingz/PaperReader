import test from 'node:test'
import assert from 'node:assert/strict'
import { PdfFrameBuffer, type PdfFrame } from './pdfFrameBuffer'

const file = {}
const frame = (id: number, page = 1, width = 600, owner = file): PdfFrame => ({ id, file: owner, page, width, pixelRatio: 1 })
function finish(buffer: PdfFrameBuffer, id: number) {
  buffer.complete(id, 'canvas')
  buffer.complete(id, 'text')
  return buffer.complete(id, 'annotations')
}

test('a page becomes interactive only after canvas, text and even an empty annotation layer finish', () => {
  const buffer = new PdfFrameBuffer(), first = frame(1)
  buffer.request(first)
  assert.equal(buffer.interactive(1), false)
  assert.equal(buffer.complete(1, 'canvas'), false)
  assert.equal(buffer.complete(1, 'annotations'), false)
  assert.equal(buffer.interactive(1), false)
  assert.equal(buffer.complete(1, 'text'), true)
  assert.equal(buffer.interactive(1), true)
  assert.equal(buffer.displayed, first)
  assert.equal(buffer.complete(1, 'text'), false, 'Duplicate completions do not trigger another rendered notification')
})

test('page navigation retains the completed raster and its height until the target is fully ready', () => {
  const buffer = new PdfFrameBuffer(), first = frame(1), next = frame(2, 2)
  buffer.request(first); finish(buffer, 1); buffer.request(next)
  assert.equal(buffer.displayed, first)
  assert.deepEqual(buffer.frames, [first, next])
  assert.equal(buffer.interactive(1), false, 'Old visible PDF links, text selection, ink and captures must be inert')
  assert.equal(buffer.interactive(2), false)
  buffer.complete(2, 'text'); buffer.complete(2, 'annotations')
  assert.equal(buffer.displayed, first)
  assert.equal(buffer.complete(2, 'canvas'), true)
  assert.equal(buffer.displayed, next)
  assert.deepEqual(buffer.frames, [next], 'Promote the already rendered target; do not remount it')
  assert.equal(buffer.interactive(2), true)
})

test('zoom keeps the old page visible while invalidating its capture and waiting for the new raster', () => {
  const buffer = new PdfFrameBuffer(), first = frame(1), zoomed = frame(2, 1, 900)
  buffer.request(first); finish(buffer, 1); buffer.request(zoomed)
  assert.equal(buffer.displayed?.width, 600)
  assert.equal(buffer.interactive(1), false)
  assert.equal(buffer.complete(1, 'canvas'), false)
  finish(buffer, 2)
  assert.equal(buffer.displayed?.width, 900)
  assert.equal(buffer.interactive(2), true)
})

test('rapid page or width changes discard obsolete pending pages and ignore their late completions', () => {
  const buffer = new PdfFrameBuffer(), first = frame(1), abandoned = frame(2, 2), latest = frame(3, 3, 720)
  buffer.request(first); finish(buffer, 1); buffer.request(abandoned)
  buffer.complete(2, 'canvas'); buffer.request(latest)
  assert.deepEqual(buffer.frames, [first, latest], 'Keep at most one completed preview and one current render task')
  assert.equal(finish(buffer, 2), false)
  assert.equal(buffer.displayed, first)
  assert.equal(finish(buffer, 3), true)
  assert.equal(buffer.displayed, latest)
})

test('unrelated parent renders, tool changes and search text updates do not reset raster readiness', () => {
  const buffer = new PdfFrameBuffer(), first = frame(1)
  buffer.request(first); finish(buffer, 1)
  assert.equal(buffer.request({ ...first }), first)
  assert.deepEqual(buffer.frames, [first])
  assert.equal(buffer.interactive(1), true)
  assert.equal(buffer.complete(1, 'canvas'), false)
})

test('a failed target preserves an inert previous preview and cannot be revived by a late ready event', () => {
  const buffer = new PdfFrameBuffer(), first = frame(1), next = frame(2, 2)
  buffer.request(first); finish(buffer, 1); buffer.request(next)
  assert.equal(buffer.fail(1), false)
  assert.equal(buffer.fail(2), true)
  assert.equal(finish(buffer, 2), false)
  assert.equal(buffer.displayed, first)
  assert.equal(buffer.interactive(1), false)
  assert.equal(buffer.interactive(2), false)
})

test('changing the source never exposes a preview or accepts callbacks from the previous PDF', () => {
  const buffer = new PdfFrameBuffer(), first = frame(1), other = frame(2, 1, 600, {})
  buffer.request(first); finish(buffer, 1); buffer.request(other)
  assert.equal(buffer.displayed, null)
  assert.deepEqual(buffer.frames, [other])
  assert.equal(finish(buffer, 1), false)
  assert.equal(finish(buffer, 2), true)
  assert.equal(buffer.displayed, other)
})


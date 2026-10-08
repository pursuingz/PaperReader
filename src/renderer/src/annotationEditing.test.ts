import test from 'node:test'
import assert from 'node:assert/strict'
import type { Highlight, PdfInkStroke, ReadingMarks } from '../../shared/types'
import { ReadingMarksSession } from './readingFeatures'
import { PdfInkSession } from './readingWorkflow'

const stroke = (id: string, page = 1): PdfInkStroke => ({ id, page, color: '#334155', width: .004, points: [{ x: .1, y: .5 }, { x: .9, y: .5 }] })
const highlight = (id: string): Highlight => ({ id, page: 1, color: 'yellow', quote: id, comment: '', createdAt: '2026-10-01', rects: [{ x: .1, y: .1, width: .2, height: .1 }] })
const marksSession = async (marks: ReadingMarks = { highlights: [highlight('a'), highlight('b')], strokes: [] }) => {
  const session = new ReadingMarksSession({ loadMarks: async () => structuredClone(marks), saveMarks: async () => undefined })
  await session.open('paper'); return session
}

test('highlight color undo preserves later comments and independent ink', async () => {
  const session = await marksSession()
  session.setHighlightColor('a', 'coral')
  session.update({ highlights: session.value.highlights.map(item => ({ ...item, comment: `latest ${item.id}` })), strokes: [stroke('ink')] })
  session.undoHighlight()
  assert.equal(session.value.highlights[0].color, 'yellow')
  assert.deepEqual(session.value.highlights.map(item => item.comment), ['latest a', 'latest b'])
  assert.equal(session.value.strokes[0].id, 'ink')
  session.redoHighlight(); assert.equal(session.value.highlights[0].color, 'coral')
})

test('highlight removal restores order and comments while independent changes remain', async () => {
  const session = await marksSession()
  session.update({ ...session.value, highlights: session.value.highlights.map(item => ({ ...item, comment: item.id })) })
  session.removeHighlight('a')
  session.update({ ...session.value, highlights: session.value.highlights.map(item => ({ ...item, comment: 'new b' })) })
  session.undoHighlight()
  assert.deepEqual(session.value.highlights.map(item => [item.id, item.comment]), [['a', 'a'], ['b', 'new b']])
  session.redoHighlight(); assert.deepEqual(session.value.highlights.map(item => item.id), ['b'])
})

test('Note ink draft flush commits even after its tab unmounts, and undo history survives flushing', async () => {
  const saved: ReadingMarks[] = []
  const session = new ReadingMarksSession({ loadMarks: async () => ({ highlights: [], strokes: [] }), saveMarks: async (_id, marks) => { saved.push(marks) } })
  await session.open('paper')
  assert.equal(session.beginInk('paper', stroke('draft')), true)
  await session.flush()
  assert.equal(saved[0].strokes[0].id, 'draft')
  session.undoInk(); assert.equal(session.value.strokes.length, 0)
  session.redoInk(); assert.equal(session.value.strokes[0].id, 'draft')
  await session.open('other'); assert.equal(session.draft, null); assert.equal(session.canRedoInk(), false)
})

test('Note ink eraser sweep removes several whole strokes in one undo and ignores highlights', async () => {
  const session = await marksSession({ highlights: [highlight('a')], strokes: [stroke('one'), { ...stroke('two'), points: [{ x: .2, y: .7 }, { x: .8, y: .7 }] }] })
  session.beginEraseInk('paper')
  session.eraseInk({ x: .5, y: .3 }, { x: .5, y: .9 }, { width: 1000, height: 1200 })
  session.finishEraseInk()
  assert.equal(session.value.strokes.length, 0)
  session.undoInk()
  assert.deepEqual(session.value.strokes.map(item => item.id), ['one', 'two'])
  assert.equal(session.value.highlights[0].id, 'a')
  session.redoInk(); assert.equal(session.value.strokes.length, 0)
})

test('interleaved PDF erasures undo by page in original order with one gesture per undo', async () => {
  const session = new PdfInkSession({ loadPdfInk: async () => ({ strokes: [stroke('a', 1), stroke('b', 2), stroke('c', 1)] }), savePdfInk: async () => undefined })
  await session.open('paper')
  session.beginErase(1); session.erase({ x: .5, y: .1 }, { x: .5, y: .9 }, { width: 500, height: 700 }); session.finishErase()
  assert.deepEqual(session.value.strokes.map(item => item.id), ['b'])
  session.beginErase(2); session.erase({ x: .5, y: .1 }, { x: .5, y: .9 }, { width: 500, height: 700 }); session.finishErase()
  session.undo(1); session.undo(2)
  assert.deepEqual(session.value.strokes.map(item => item.id), ['a', 'b', 'c'])
  session.redo(1); assert.deepEqual(session.value.strokes.map(item => item.id), ['b'])
})

test('eraser uses rendered pixels at zoom, hits between pointer events and rejects distant strokes', async () => {
  const session = await marksSession({ highlights: [], strokes: [stroke('line')] })
  session.beginEraseInk('paper')
  session.eraseInk({ x: .5, y: .47 }, { x: .5, y: .47 }, { width: 500, height: 500 })
  assert.equal(session.value.strokes.length, 1)
  session.eraseInk({ x: .5, y: .47 }, { x: .5, y: .47 }, { width: 200, height: 200 })
  assert.equal(session.value.strokes.length, 0)
  session.finishEraseInk()
})

test('restoring a removed highlight refuses an oversized result without losing undo', async () => {
  const highlights = Array.from({ length: 100 }, (_, index) => ({ ...highlight(`h-${index}`), comment: 'a'.repeat(19990) }))
  const session = await marksSession({ highlights, strokes: [] })
  session.removeHighlight('h-0')
  session.update({ ...session.value, highlights: session.value.highlights.map(item => ({ ...item, comment: 'b'.repeat(20000) })) })
  assert.throws(() => session.undoHighlight(), /limit/i)
  assert.equal(session.value.highlights.length, 99)
  assert.equal(session.canUndoHighlight(), true)
  session.update({ ...session.value, highlights: session.value.highlights.map(item => ({ ...item, comment: 'shortened' })) })
  session.undoHighlight(); assert.deepEqual(session.value.highlights.map(item => item.id), highlights.map(item => item.id))
})

test('Note ink reserves a dot endpoint so flush cannot fail at the point limit', async () => {
  const strokes = Array.from({ length: 20 }, (_, index) => ({ ...stroke(`existing-${index}`), points: Array.from({ length: index === 19 ? 9999 : 10000 }, () => ({ x: .1, y: .1 })) }))
  const session = await marksSession({ highlights: [], strokes })
  assert.throws(() => session.beginInk('paper', { ...stroke('dot'), points: [{ x: .5, y: .5 }] }), /full/i)
  assert.equal(session.draft, null)
})

test('failed cross-page stroke restore preserves the undo entry for retry', async () => {
  const loaded = Array.from({ length: 1000 }, (_, index) => stroke(`s-${index}`, 1))
  const session = new PdfInkSession({ loadPdfInk: async () => ({ strokes: loaded }), savePdfInk: async () => undefined })
  await session.open('paper'); session.undo(1); session.add(stroke('other-page', 2))
  assert.throws(() => session.redo(1), /full/i)
  assert.equal(session.value.strokes.length, 1000); assert.equal(session.canRedo(1), true)
  session.undo(2); session.redo(1)
  assert.deepEqual(session.value.strokes.map(item => item.id), loaded.map(item => item.id))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizedRects, normalizedPoint, extractAllPages, readReaderPage, ReadingMarksSession } from './readingFeatures'

test('selection coordinates are clipped to the PDF page and survive scaling', () => {
  const result = normalizedRects([{ left: 80, top: 120, width: 80, height: 20 }, { left: 900, top: 120, width: 20, height: 20 }], { left: 100, top: 100, width: 400, height: 600 })
  assert.deepEqual(result, [{ x: 0, y: 1 / 30, width: .15, height: 1 / 30 }])
  assert.deepEqual(normalizedPoint(600, 0, { left: 100, top: 100, width: 400, height: 600 }), { x: 1, y: 0 })
})

test('full-paper extraction includes blank pages and their original page numbers', async () => {
  const pages = await extractAllPages({ numPages: 3, getPage: async page => ({ getTextContent: async () => ({ items: [{ str: ['', 'Alpha', '', 'Omega'][page] }] }) }) }, () => true)
  assert.deepEqual(pages, [{ page: 1, text: 'Alpha' }, { page: 2, text: '' }, { page: 3, text: 'Omega' }])
})

test('extraction stops on cancellation and rejects oversize instead of truncating', async () => {
  let alive = true
  await assert.rejects(extractAllPages({ numPages: 2, getPage: async () => { alive = false; return { getTextContent: async () => ({ items: [{ str: 'text' }] }) } } }, () => alive), /cancel/i)
  await assert.rejects(extractAllPages({ numPages: 201, getPage: async () => { throw new Error('must not extract') } }, () => true), /200/)
  await assert.rejects(extractAllPages({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'x'.repeat(240001) }] }) }) }, () => true), /240,000/)
})

test('unmounted Reader never reads its destroyed document and ignores an in-flight page', async () => {
  const destroyed = { numPages: 2, getPage() { throw new Error('destroyed proxy must not be used') } }
  assert.equal(await readReaderPage(destroyed, 2, () => false), null)
  let alive = true
  const result = await readReaderPage({ numPages: 2, getPage: async () => ({ getTextContent: async () => { alive = false; return { items: [{ str: 'stale text' }] } } }) }, 2, () => alive)
  assert.equal(result, null)
})

test('failed marks loads stay read-only and stale loads cannot overwrite another paper', async () => {
  let resolveA!: (value: { highlights: []; strokes: [] }) => void
  const writes: string[] = []
  const session = new ReadingMarksSession({ loadMarks: id => id === 'a' ? new Promise(resolve => { resolveA = resolve }) : Promise.reject(new Error('corrupt')), saveMarks: async id => { writes.push(id) } })
  const pending = session.open('a')
  await assert.rejects(session.open('b'), /corrupt/)
  resolveA({ highlights: [], strokes: [] }); await pending
  assert.equal(session.id, 'b'); assert.equal(session.ready, false)
  assert.equal(session.update({ highlights: [], strokes: [] }), false)
  await session.flush(); assert.deepEqual(writes, [])
})

test('flush persists the latest marks after an in-flight write and snapshots are isolated', async () => {
  let release!: () => void
  let started!: () => void
  const pendingWrite = new Promise<void>(resolve => { started = resolve })
  const writes: number[] = []
  const session = new ReadingMarksSession({ loadMarks: async () => ({ highlights: [], strokes: [] }), saveMarks: async (_id, marks) => { writes.push(marks.strokes.length); if (writes.length === 1) await new Promise<void>(resolve => { release = resolve; started() }) } })
  await session.open('a')
  session.update({ highlights: [], strokes: [{ id: 's1', points: [{ x: .1, y: .2 }], color: '#334155', width: .003 }] })
  const first = session.flush(); await pendingWrite
  session.update({ highlights: [], strokes: [] })
  const second = session.flush(); release(); await Promise.all([first, second])
  assert.deepEqual(writes, [1, 0])
})

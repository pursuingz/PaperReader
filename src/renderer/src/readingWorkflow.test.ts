import test from 'node:test'
import assert from 'node:assert/strict'
import type { Paper, PaperState, PdfInk, PdfInkStroke } from '../../shared/types'
import { createQuestionSnapshot, withExtractedPages, appendAIResponse, WholePaperReader, PdfInkSession, groupLibrary, flushBeforeExport } from './readingWorkflow'

const paper: Paper = { id: 'a', title: 'Alpha', fileName: 'a.pdf', category: 'Imported', importedAt: '2026-10-01' }
const state: PaperState = { note: 'Private note', lastPage: 3, messages: [{ id: 'm', paperId: 'a', role: 'user', content: 'Earlier conversation', createdAt: '' }, { id: 'demo', paperId: 'a', role: 'assistant', content: 'Sample', createdAt: '', isDemo: true }] }
const input = () => ({ requestId: 'request', paper, state: structuredClone(state), question: 'Why?', pageText: 'Third page', selection: 'A passage' })
const stroke = (id: string, page = 1): PdfInkStroke => ({ id, page, points: [{ x: .1, y: .2 }, { x: .3, y: .4 }], color: '#334155', width: .004 })

test('each context sends only selected sources, and a request keeps its original note and question', () => {
  const source = input()
  const notes = createQuestionSnapshot({ ...source, mode: 'notes' })
  source.state.note = 'Changed while extracting'; source.question = 'Changed question'
  assert.equal(notes.question, 'Why?'); assert.equal(notes.context.note, 'Private note')
  assert.equal(notes.context.pageText, ''); assert.equal(notes.context.selection, undefined); assert.equal(notes.context.pages, undefined); assert.deepEqual(notes.history, [])
  const page = createQuestionSnapshot({ ...input(), mode: 'page' })
  assert.equal(page.context.pageText, 'Third page'); assert.equal(page.context.selection, 'A passage'); assert.equal(page.context.note, undefined)
  assert.deepEqual(page.history, [{ role: 'user', content: 'Earlier conversation' }])
  const full = withExtractedPages(createQuestionSnapshot({ ...input(), mode: 'paper' }), [{ page: 1, text: 'First' }, { page: 2, text: '' }, { page: 3, text: 'Last' }])
  assert.equal(full.context.pageText, ''); assert.equal(full.context.note, undefined); assert.equal(full.context.selection, undefined)
  assert.deepEqual(full.context.pages, [{ page: 1, text: 'First' }, { page: 2, text: '' }, { page: 3, text: 'Last' }])
  assert.equal(createQuestionSnapshot({ ...input(), mode: 'paper-notes' }).context.note, 'Private note')
})

test('organization uses notes only and rejects oversize evidence instead of clipping', () => {
  const request = createQuestionSnapshot({ ...input(), mode: 'paper', action: 'organize-notes' })
  assert.equal(request.context.mode, 'notes'); assert.deepEqual(request.history, []); assert.equal(request.context.pageText, '')
  assert.throws(() => createQuestionSnapshot({ ...input(), mode: 'notes', state: { ...state, note: 'x'.repeat(100001) } }), /100,000/)
  assert.throws(() => createQuestionSnapshot({ ...input(), mode: 'page', pageText: 'x'.repeat(100001) }), /100,000/)
  assert.throws(() => createQuestionSnapshot({ ...input(), mode: 'page', selection: 'x'.repeat(30001) }), /30,000/)
})

test('a selected passage remains usable while current-page extraction has no readable text', () => {
  const request = createQuestionSnapshot({ ...input(), mode: 'page', pageText: '', selection: 'Actual selected evidence' })
  assert.equal(request.context.pageText, '')
  assert.equal(request.context.selection, 'Actual selected evidence')
  assert.throws(() => createQuestionSnapshot({ ...input(), mode: 'page', pageText: '', selection: '' }), /readable text/)
})

test('an AI reply preserves notes edited during the request and labels organization as a suggestion', () => {
  const latest = { ...state, note: 'Latest note' }
  const next = appendAIResponse(latest, 'a', 'Organized response', true, 'response-id')
  assert.equal(next.note, 'Latest note'); assert.equal(state.messages.length, 2)
  assert.match(next.messages.at(-1)!.content, /suggestion/i); assert.match(next.messages.at(-1)!.content, /Organized response/)
})

test('cancelling before file load finishes never creates an extraction task', async () => {
  let release!: (bytes: Uint8Array) => void
  const reader = new WholePaperReader(() => new Promise(resolve => { release = resolve }), () => { throw new Error('must not open after cancel') })
  const job = reader.read('a', () => true)
  await reader.cancel(); release(new Uint8Array([1]))
  await assert.rejects(job, /cancel/i)
})

test('owned extraction task is destroyed on cancellation and cannot return stale pages', async () => {
  let release!: (value: { items: Array<{ str: string }> }) => void
  let started!: () => void
  let destroyed = 0
  const ready = new Promise<void>(resolve => { started = resolve })
  const reader = new WholePaperReader(async () => new Uint8Array([1]), () => ({ promise: Promise.resolve({ numPages: 2, getPage: async () => ({ getTextContent: () => { started(); return new Promise(resolve => { release = resolve }) } }) }), destroy: async () => { destroyed++ } }))
  const job = reader.read('a', () => true); await ready
  await reader.cancel(); release({ items: [{ str: 'stale' }] })
  await assert.rejects(job, /cancel/i); assert.equal(destroyed, 1)
})

test('PDF ink undo and redo are page-local and independent of loaded ink for another paper', async () => {
  const writes: Array<[string, PdfInk]> = []
  const session = new PdfInkSession({ loadPdfInk: async () => ({ strokes: [] }), savePdfInk: async (id, ink) => { writes.push([id, ink]) } })
  await session.open('a'); session.add(stroke('one', 1)); session.add(stroke('two', 2)); session.add(stroke('three', 1))
  session.undo(1); assert.deepEqual(session.value.strokes.map(item => item.id), ['one', 'two'])
  assert.equal(session.canRedo(2), false); session.redo(1)
  await session.flush(); assert.deepEqual(writes[0][1].strokes.map(item => item.id), ['one', 'two', 'three'])
  await session.open('b'); assert.equal(session.canRedo(1), false); assert.equal(session.value.strokes.length, 0)
  session.add(stroke('other', 2)); await session.flush(); assert.equal(writes[1][0], 'b')
})

test('corrupt and stale PDF ink loads cannot enable writes or replace current paper', async () => {
  let release!: (value: PdfInk) => void
  const session = new PdfInkSession({ loadPdfInk: id => id === 'a' ? new Promise(resolve => { release = resolve }) : Promise.reject(new Error('corrupt')), savePdfInk: async () => { throw new Error('must not write') } })
  const old = session.open('a'); await assert.rejects(session.open('b'), /corrupt/)
  release({ strokes: [stroke('old')] }); await old
  assert.equal(session.id, 'b'); assert.equal(session.ready, false); assert.equal(session.add(stroke('new')), false); await session.flush()
})

test('PDF ink saves immutable snapshots and a failed write blocks export until successful retry', async () => {
  let fail = true, exports = 0
  const written: PdfInk[] = []
  const session = new PdfInkSession({ loadPdfInk: async () => ({ strokes: [] }), savePdfInk: async (_id, value) => { if (fail) throw new Error('disk full'); written.push(value) } })
  await session.open('a'); const draft = stroke('one'); session.add(draft); draft.points[0].x = .9
  await assert.rejects(flushBeforeExport([() => session.flush()], async () => { exports++ }), /disk full/)
  assert.equal(exports, 0); fail = false
  await flushBeforeExport([() => session.flush()], async () => { exports++ })
  assert.equal(exports, 1); assert.equal(written[0].strokes[0].points[0].x, .1)
  assert.throws(() => session.add({ ...stroke('invalid'), points: [{ x: 1.1, y: 0 }] }), /coordinate/i)
})

test('category groups follow stable assignments across rename and include unassigned imports', () => {
  const groups = groupLibrary([paper, { ...paper, id: 'b', title: 'Beta' }], { categories: [{ id: 'c', name: 'Renamed topic' }], assignments: { a: 'c' } })
  assert.deepEqual(groups.map(group => [group.name, group.papers.map(item => item.id)]), [['Renamed topic', ['a']], ['Imported / unassigned', ['b']]])
})

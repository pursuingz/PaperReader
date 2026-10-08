import test from 'node:test'
import assert from 'node:assert/strict'
import { LocalSourceIndex } from './sourceIndexSession'
import type { SourceDocument } from './sourceIndex'
import type { PaperSourceIndex } from '../../shared/types'

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const document = (caption: string): SourceDocument => ({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: caption, transform: [12, 0, 0, 12, 50, 700], width: 120, height: 12 }] }) }) })

test('late PDF bytes after cancellation never create a task or save an index', async () => {
  const bytes = deferred<Uint8Array>(), saved: PaperSourceIndex[] = []
  let tasks = 0
  const session = new LocalSourceIndex({ readPaper: () => bytes.promise, saveSourceIndex: async (_id, value) => { saved.push(value) } }, () => { tasks++; return { promise: Promise.resolve(document('Figure 1. Old')), destroy: async () => {} } })
  const old = session.run('old-paper')
  await session.cancel(); bytes.resolve(new Uint8Array([1]))
  assert.equal(await old, null); assert.equal(tasks, 0); assert.deepEqual(saved, [])
})

test('switching papers isolates progress, output cache and task cleanup', async () => {
  const pageText = deferred<{ items: unknown[] }>(), entered = deferred<void>()
  const saved: Array<{ id: string; index: PaperSourceIndex }> = [], progress: string[] = [], destroyed: number[] = []
  let cleaned = false
  const old: SourceDocument = { numPages: 1, getPage: async () => { entered.resolve(); return { getTextContent: () => pageText.promise, cleanup() { cleaned = true } } } }
  const session = new LocalSourceIndex({ readPaper: async id => new Uint8Array([id === 'old-paper' ? 1 : 2]), saveSourceIndex: async (id, index) => { saved.push({ id, index }) } }, bytes => ({ promise: Promise.resolve(bytes[0] === 1 ? old : document('Table 1. New paper')), destroy: async () => { destroyed.push(bytes[0]) } }))
  const first = session.run('old-paper', () => progress.push('old'))
  await entered.promise; await session.cancel()
  const second = await session.run('new-paper', () => progress.push('new'))
  pageText.resolve({ items: [{ str: 'Figure 1. Old paper' }] })
  assert.equal(await first, null)
  assert.equal(second!.paperId, 'new-paper'); assert.deepEqual(progress, ['new'])
  assert.deepEqual(saved.map(value => value.id), ['new-paper']); assert.equal(saved[0].index.entries[0].text, 'Table 1. New paper')
  assert.equal(cleaned, true); assert.deepEqual(destroyed.sort(), [1, 2])
})

test('cache save failures are surfaced and a new run can retry after resource destruction', async () => {
  let saves = 0, destroyed = 0
  const session = new LocalSourceIndex({ readPaper: async () => new Uint8Array([1]), saveSourceIndex: async () => { if (++saves === 1) throw new Error('Cache write failed') } }, () => ({ promise: Promise.resolve(document('Figure 1. Local evidence')), destroy: async () => { destroyed++ } }))
  await assert.rejects(session.run('paper-1'), /Cache write failed/)
  assert.equal(destroyed, 1)
  assert.equal((await session.run('paper-1'))!.entries.length, 1)
  assert.equal(destroyed, 2)
})

test('cancellation during a dispatched cache save does not expose stale results or duplicate destroy', async () => {
  const saving = deferred<void>(), entered = deferred<void>()
  let destroyed = 0
  const session = new LocalSourceIndex({ readPaper: async () => new Uint8Array([1]), saveSourceIndex: async () => { entered.resolve(); await saving.promise } }, () => ({ promise: Promise.resolve(document('Figure 1. Already extracted')), destroy: async () => { destroyed++ } }))
  const pending = session.run('paper-1'); await entered.promise
  await session.cancel(); saving.resolve()
  assert.equal(await pending, null); assert.equal(destroyed, 1)
})

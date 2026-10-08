import test from 'node:test'
import assert from 'node:assert/strict'
import { LocalTableExtraction } from './tableSession'
import type { PaperTables } from '../../shared/types'
import type { TableDocument } from './tableExtraction'

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const doc: TableDocument = { numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [] }) }) }

test('late PDF bytes after cancellation never create a table task or save', async () => {
  const bytes = deferred<Uint8Array>(), saved: PaperTables[] = []; let tasks = 0
  const session = new LocalTableExtraction({ readPaper: () => bytes.promise, saveTables: async (_id, table) => { saved.push(table) } }, () => { tasks++; return { promise: Promise.resolve(doc), destroy: async () => {} } })
  const old = session.run('paper-old'); await session.cancel(); bytes.resolve(new Uint8Array([1]))
  assert.equal(await old, null); assert.equal(tasks, 0); assert.deepEqual(saved, [])
})

test('cancelled table text and progress cannot appear or save under the next paper', async () => {
  const entered = deferred<void>(), text = deferred<{ items: unknown[] }>(), saved: string[] = [], progress: string[] = [], destroyed: number[] = []
  let cleaned = false
  const old: TableDocument = { numPages: 1, getPage: async () => { entered.resolve(); return { getTextContent: () => text.promise, cleanup() { cleaned = true } } } }
  const session = new LocalTableExtraction({ readPaper: async id => new Uint8Array([id === 'paper-old' ? 1 : 2]), saveTables: async id => { saved.push(id) } }, bytes => ({ promise: Promise.resolve(bytes[0] === 1 ? old : doc), destroy: async () => { destroyed.push(bytes[0]) } }))
  const first = session.run('paper-old', () => progress.push('old')); await entered.promise; await session.cancel()
  const second = await session.run('paper-new', () => progress.push('new')); text.resolve({ items: [{ str: 'Table 1. Old' }] })
  assert.equal(await first, null); assert.equal(second?.paperId, 'paper-new'); assert.deepEqual(saved, ['paper-new']); assert.deepEqual(progress, ['new'])
  assert.equal(cleaned, true); assert.deepEqual(destroyed.sort(), [1, 2])
})

test('table write failures remain visible and resource destruction permits a retry', async () => {
  let saved = 0, destroyed = 0
  const session = new LocalTableExtraction({ readPaper: async () => new Uint8Array([1]), saveTables: async () => { if (++saved === 1) throw new Error('table write failed') } }, () => ({ promise: Promise.resolve(doc), destroy: async () => { destroyed++ } }))
  await assert.rejects(session.run('paper-a'), /table write failed/); assert.equal(destroyed, 1)
  assert.equal((await session.run('paper-a'))?.paperId, 'paper-a'); assert.equal(destroyed, 2)
})

test('cancellation during a dispatched table save cannot expose a late result or destroy twice', async () => {
  const entered = deferred<void>(), saving = deferred<void>(); let destroyed = 0
  const session = new LocalTableExtraction({ readPaper: async () => new Uint8Array([1]), saveTables: async () => { entered.resolve(); await saving.promise } }, () => ({ promise: Promise.resolve(doc), destroy: async () => { destroyed++ } }))
  const run = session.run('paper-old'); await entered.promise; await session.cancel(); saving.resolve()
  assert.equal(await run, null); assert.equal(destroyed, 1)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { ReferencesSession } from './referencesSession'
import type { PaperReferences } from '../../shared/types'
const document = (paperId: string): PaperReferences => ({ paperId, version: 1, sourceRevision: 'a'.repeat(64), sourceCreatedAt: '2026-10-06T12:00:00.000Z', builtAt: '2026-10-06T12:00:00.000Z', sourceLimitReached: false, records: [] })
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed }); return { promise, resolve, reject } }

test('a late load cannot replace the newly selected paper', async () => {
  const a = deferred<PaperReferences | null>()
  const session = new ReferencesSession({ loadReferences: id => id === 'a' ? a.promise : Promise.resolve(document(id)), buildReferences: async id => document(id), verifyReference: async id => document(id) })
  const old = session.load('a')
  assert.equal((await session.load('b'))?.paperId, 'b')
  a.resolve(document('a')); assert.equal(await old, null)
})

test('late verification errors after unmount stay out of the next paper', async () => {
  const result = deferred<PaperReferences>()
  const session = new ReferencesSession({ loadReferences: async id => document(id), buildReferences: async id => document(id), verifyReference: () => result.promise })
  await session.load('a')
  const old = session.verify('a', 'ref-a'); session.cancel(); await session.load('b')
  result.reject(new Error('OLD ERROR')); assert.equal(await old, null)
})

test('overlapping UI operations are refused, current errors propagate and the lock is released', async () => {
  const result = deferred<PaperReferences>()
  const session = new ReferencesSession({ loadReferences: async id => document(id), buildReferences: async id => document(id), verifyReference: () => result.promise })
  await session.load('a')
  const pending = session.verify('a', 'ref-a'), rejected = assert.rejects(pending, /Network failed/)
  await assert.rejects(session.build('a'), /progress|busy/i)
  result.reject(new Error('Network failed')); await rejected
  assert.equal((await session.build('a'))?.paperId, 'a')
})

test('foreign paper responses never replace the current session', async () => {
  const session = new ReferencesSession({ loadReferences: async () => document('other'), buildReferences: async () => document('other'), verifyReference: async () => document('other') })
  await assert.rejects(session.load('a'), /paper|identity/i)
})

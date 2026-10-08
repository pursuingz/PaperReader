import test from 'node:test'
import assert from 'node:assert/strict'
import { RequestHistorySession, allocateRetryIDs, recordForMessage } from './requestHistorySession'
import type { AIRequestHistory, AIRequestOwner } from '../../shared/requestTypes'
const paper: AIRequestOwner = { scope: 'paper', paperId: 'paper-a' }, general: AIRequestOwner = { scope: 'general', conversationId: 'general-a' }
function history(owner: AIRequestOwner): AIRequestHistory { return { version: 1, owner, records: [] } }
function deferred<T>() { let resolve!: (v:T)=>void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
test('scope and epoch reject stale loads and stale errors after same-owner refresh', async () => {
  const first = deferred<AIRequestHistory>(), second = deferred<AIRequestHistory>(); let calls = 0
  const session = new RequestHistorySession({ loadAIRequests: async () => (++calls === 1 ? first.promise : second.promise) })
  const stale = session.open(paper), current = session.open(general)
  second.resolve(history(general)); assert.deepEqual(await current, history(general))
  first.resolve(history(paper)); assert.equal(await stale, null)
  session.close(); assert.equal(session.ready, false)
})
test('foreign history identity protects view and failed load never becomes ready', async () => {
  const session = new RequestHistorySession({ loadAIRequests: async () => history(general) })
  await assert.rejects(session.open(paper), /owner|identity/i); assert.equal(session.ready, false)
})
test('same-owner refresh and close consume stale failures without changing readiness', async () => {
  let reject!: (error:Error)=>void
  const staleFailure = new Promise<AIRequestHistory>((_, fail) => { reject = fail }); let calls = 0
  const session = new RequestHistorySession({ loadAIRequests: async () => ++calls === 1 ? staleFailure : history(paper) })
  const old = session.open(paper); assert.deepEqual(await session.open(paper), history(paper)); assert.equal(session.ready, true)
  reject(new Error('old failure')); assert.equal(await old, null); assert.equal(session.ready, true)
  session.close(); assert.equal(await session.open(null), null); assert.equal(session.ready, false)
})
test('fresh retry UUIDs never reuse original binding and old messages cannot text-match a record', () => {
  const fresh = allocateRetryIDs()
  assert.equal(new Set(Object.values(fresh)).size, 3); for (const id of Object.values(fresh)) assert.match(id, /^[0-9a-f-]{36}$/)
  const saved = history(paper)
  saved.records.push({ ...fresh, snapshotId: 'snapshot', retryOf: null, createdAt: '2026-10-08T00:00:00.000Z', status: 'failed', context: { mode: 'page', action: 'ask', label: 'Page 2', page: 2, selectionCharacters: 4 }, model: 'original-model', userSha256: 'hash', snapshotSha256: 'hash' })
  assert.equal(recordForMessage(saved, fresh.userMessageId), saved.records[0]); assert.equal(recordForMessage(saved, fresh.assistantMessageId), saved.records[0])
  assert.equal(recordForMessage(saved, 'old-message'), undefined)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AIRequestRecord, GeneralAIRequest, GeneralAIResult, GeneralChatState } from '../../shared/types'
import { GeneralChatSession, type GeneralChatAPI } from './generalChatSession'

const date = '2026-10-08T12:00:00.000Z'
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function fixture() {
  let stored: GeneralChatState = { version: 1, conversationId: randomUUID(), messages: [] }, saveFailure = false, loadFailure = false
  const requests: GeneralAIRequest[] = [], responses: ReturnType<typeof deferred<GeneralAIResult>>[] = [], snapshots: GeneralChatState[] = [], cancellations: string[] = []
  const api: GeneralChatAPI = {
    loadGeneralChat: async () => { if (loadFailure) throw new Error('Damaged data'); return structuredClone(stored) },
    saveGeneralChat: async value => { if (saveFailure) throw new Error('Save failed'); snapshots.push(structuredClone(value)); stored = structuredClone(value) },
    askGeneralAI: async request => { requests.push(request); const result = deferred<GeneralAIResult>(); responses.push(result); return result.promise },
    retryAIRequest: async request => { const question = stored.messages.find(message => message.id === request.userMessageId)!; return api.askGeneralAI({ ...request, conversationId: stored.conversationId, question: question.content }) },
    cancelAI: async id => { cancellations.push(id) }
  }
  const notices: string[] = [], session = new GeneralChatSession(api, { hasApiKey: true, onSettings: () => undefined, onNotice: message => notices.push(message) })
  await session.load()
  return { session, api, requests, responses, snapshots, cancellations, notices, stored: () => stored, failSave: (value: boolean) => { saveFailure = value }, failLoad: (value: boolean) => { loadFailure = value } }
}
async function until(condition: () => boolean) { for (let i = 0; i < 30 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 0)); assert.ok(condition(), 'The expected async boundary was not reached') }
function answer(request: GeneralAIRequest, content = 'Complete answer'): GeneralAIResult { return { requestId: request.requestId, conversationId: request.conversationId, content } }

test('general send persists its bound user ID before dispatch and saves only the completed answer', async () => {
  const { session, requests, responses, snapshots, stored } = await fixture()
  session.setDraft('Explain attention'); const sending = session.send(); await until(() => requests.length === 1)
  const request = requests[0]
  assert.deepEqual(Object.keys(request).sort(), ['assistantMessageId', 'conversationId', 'question', 'requestId', 'userMessageId'])
  assert.equal(snapshots[0].messages[0].id, request.userMessageId)
  assert.equal(stored().messages.length, 1)
  session.receiveProgress({ type: 'reset', ...request, attempt: 1 })
  session.receiveProgress({ type: 'delta', ...request, attempt: 1, content: 'Partial' })
  assert.equal(session.getSnapshot().preview?.content, 'Partial')
  assert.equal(stored().messages.length, 1)
  responses[0].resolve(answer(request)); await sending
  assert.equal(stored().messages[1].id, request.assistantMessageId)
  assert.equal(stored().messages[1].content, 'Complete answer')
  assert.equal(session.getSnapshot().preview, null)
  assert.equal(session.getSnapshot().draft, '')
  assert.equal(session.getSnapshot().status, 'Saved locally')
})

test('failed user save retains the draft and cannot reach the provider until manually sent again', async () => {
  const { session, requests, responses, failSave } = await fixture(); failSave(true); session.setDraft('Keep me')
  await session.send()
  assert.equal(requests.length, 0); assert.equal(session.getSnapshot().draft, 'Keep me')
  assert.match(session.getSnapshot().error!, /Save failed/)
  failSave(false); const sending = session.send(); await until(() => requests.length === 1)
  responses[0].resolve(answer(requests[0])); await sending
  assert.equal(session.getSnapshot().state!.messages.filter(message => message.role === 'user').length, 1)
})

test('failed completed-answer save stays unsaved in memory and flush reports failure then recovers', async () => {
  const { session, requests, responses, stored, failSave } = await fixture(); session.setDraft('Question')
  const sending = session.send(); await until(() => requests.length === 1); failSave(true)
  responses[0].resolve(answer(requests[0])); await sending
  assert.equal(stored().messages.length, 1)
  assert.equal(session.getSnapshot().state!.messages[1].content, 'Complete answer')
  assert.match(session.getSnapshot().status, /not saved/i)
  await assert.rejects(session.flush(), /Save failed/)
  failSave(false); await session.flush()
  assert.equal(stored().messages.length, 2); assert.equal(session.getSnapshot().status, 'Saved locally')
})

test('leave synchronously revokes stream identity before cancellation waits and A to paper to A ignores an old final answer', async () => {
  const { session, api, requests, responses } = await fixture(), cancellation = deferred<void>()
  api.cancelAI = async () => cancellation.promise
  session.setDraft('First'); const first = session.send(); await until(() => requests.length === 1)
  session.receiveProgress({ type: 'reset', ...requests[0], attempt: 1 })
  const leaving = session.prepareToLeave()
  session.receiveProgress({ type: 'delta', ...requests[0], attempt: 1, content: 'Stale preview' })
  assert.equal(session.getSnapshot().preview, null)
  responses[0].resolve(answer(requests[0], 'Stale final')); await first
  assert.equal(session.getSnapshot().state!.messages.length, 1)
  cancellation.resolve(); await leaving
  session.setDraft('Second'); const second = session.send(); await until(() => requests.length === 2)
  session.receiveProgress({ type: 'reset', ...requests[0], attempt: 2 })
  session.receiveProgress({ type: 'delta', ...requests[0], attempt: 2, content: 'Late old attempt' })
  assert.equal(session.getSnapshot().preview, null)
  responses[1].resolve(answer(requests[1], 'Current answer')); await second
  assert.deepEqual(session.getSnapshot().state!.messages.map(message => message.content), ['First', 'Second', 'Current answer'])
})

test('stream attempts reset preview without accepting old attempts, wrong owners, duplicates or excessive deltas', async () => {
  const { session, requests, responses } = await fixture(); session.setDraft('Question'); const sending = session.send(); await until(() => requests.length === 1)
  const request = requests[0]
  session.receiveProgress({ type: 'reset', ...request, attempt: 1 })
  session.receiveProgress({ type: 'delta', ...request, attempt: 1, content: 'First' })
  session.receiveProgress({ type: 'reset', ...request, attempt: 2 })
  session.receiveProgress({ type: 'delta', ...request, attempt: 1, content: 'Stale' })
  session.receiveProgress({ type: 'delta', ...request, attempt: 2, conversationId: randomUUID(), content: 'Foreign' })
  session.receiveProgress({ type: 'delta', ...request, attempt: 2, content: 'Second' })
  session.receiveProgress({ type: 'reset', ...request, attempt: 2 })
  session.receiveProgress({ type: 'delta', ...request, attempt: 2, content: 'x'.repeat(200001) })
  assert.equal(session.getSnapshot().preview!.content, 'Second')
  responses[0].resolve(answer(request)); await sending
})

test('cancel and provider failure never persist preview content or create a fake successful assistant', async () => {
  const { session, requests, responses, stored, cancellations } = await fixture(); session.setDraft('Cancel this')
  const sending = session.send(); await until(() => requests.length === 1)
  session.receiveProgress({ type: 'reset', ...requests[0], attempt: 1 })
  session.receiveProgress({ type: 'delta', ...requests[0], attempt: 1, content: 'Incomplete' })
  await session.cancel(); responses[0].reject(new Error('Cancelled')); await sending
  assert.deepEqual(cancellations, [requests[0].requestId]); assert.equal(stored().messages.length, 1)
  session.setDraft('Fail this'); const failing = session.send(); await until(() => requests.length === 2)
  responses[1].reject(new Error('Provider unavailable')); await failing
  assert.equal(stored().messages.length, 2); assert.match(session.getSnapshot().error!, /Provider unavailable/)
})

test('failed load blocks sending and preserves draft until explicit retry succeeds', async () => {
  const { session, requests, failLoad } = await fixture(); failLoad(true); await session.load(); session.setDraft('Draft survives')
  await session.send()
  assert.equal(requests.length, 0); assert.equal(session.getSnapshot().ready, false)
  assert.match(session.getSnapshot().error!, /Damaged data/)
  failLoad(false); await session.retryLoad()
  assert.equal(session.getSnapshot().ready, true); assert.equal(session.getSnapshot().draft, 'Draft survives')
})

test('foreign final request owner and incomplete answer are rejected without saving an assistant', async () => {
  for (const invalid of ['owner', 'empty', 'large']) {
    const { session, requests, responses, stored } = await fixture(); session.setDraft('Question'); const sending = session.send(); await until(() => requests.length === 1)
    const result = answer(requests[0]); if (invalid === 'owner') result.conversationId = randomUUID(); else result.content = invalid === 'empty' ? '' : 'x'.repeat(200001)
    responses[0].resolve(result); await sending
    assert.equal(stored().messages.length, 1); assert.ok(session.getSnapshot().error)
  }
})

test('exact general retry binds fresh message IDs, retains original answer and leaves unsent draft intact', async () => {
  const { session, requests, responses } = await fixture(); session.setDraft('Original question'); const initial = session.send(); await until(() => requests.length === 1)
  responses[0].resolve(answer(requests[0], 'Original answer')); await initial
  const original = requests[0], record: AIRequestRecord = { ...original, snapshotId: randomUUID(), snapshotSha256: 'b'.repeat(64), retryOf: null, status: 'completed', context: { label: 'General chat', mode: 'general', action: 'ask', page: null, selectionCharacters: 0 }, model: 'original-model', userSha256: 'a'.repeat(64), createdAt: date }
  session.setDraft('Unsent separate draft'); const retrying = session.retryRequest(record); await until(() => requests.length === 2)
  const replay = requests[1]; assert.notEqual(replay.userMessageId, original.userMessageId); assert.notEqual(replay.assistantMessageId, original.assistantMessageId); assert.notEqual(replay.requestId, original.requestId)
  assert.equal(replay.question, 'Original question'); assert.equal(session.getSnapshot().draft, 'Unsent separate draft')
  responses[1].resolve(answer(replay, 'Retry answer')); await retrying
  assert.deepEqual(session.getSnapshot().state!.messages.map(message => message.content), ['Original question', 'Original answer', 'Original question', 'Retry answer'])
  assert.equal(session.getSnapshot().draft, 'Unsent separate draft')
})

test('missing key and oversized question fail before saving or dispatching and repeated send cannot overlap', async () => {
  const { session, requests, responses, snapshots } = await fixture(); let settings = 0
  session.setOptions({ hasApiKey: false, onSettings: () => { settings++ }, onNotice: () => undefined }); session.setDraft('Need a key'); await session.send()
  assert.equal(settings, 1); assert.equal(requests.length, 0); assert.equal(snapshots.length, 0)
  session.setOptions({ hasApiKey: true, onSettings: () => undefined, onNotice: () => undefined }); session.setDraft('x'.repeat(16001)); await session.send()
  assert.equal(requests.length, 0); assert.match(session.getSnapshot().error!, /16,000|16000|long|limit/i)
  session.setDraft('One question'); const sending = session.send(); await until(() => requests.length === 1); await session.send()
  assert.equal(requests.length, 1); responses[0].resolve(answer(requests[0])); await sending
})

test('successful general response reports a request-history warning while still saving its complete answer', async () => {
  const { session, requests, responses, notices, stored } = await fixture()
  session.setDraft('Question'); const sending = session.send(); await until(() => requests.length === 1)
  responses[0].resolve({ ...answer(requests[0]), historyWarning: 'Answer received; request history status could not be saved.' }); await sending
  assert.deepEqual(notices, ['Answer received; request history status could not be saved.'])
  assert.equal(stored().messages[1].content, 'Complete answer'); assert.equal(session.getSnapshot().status, 'Saved locally')
  session.setDraft('Next'); const cancelled = session.send(); await until(() => requests.length === 2); await session.cancel()
  responses[1].resolve({ ...answer(requests[1]), historyWarning: 'Stale warning' }); await cancelled
  assert.equal(notices.length, 1)
})

test('navigation blocks new general sends and exact retries while leave waits for a delayed save', async () => {
  const { session, api, requests, responses, failSave } = await fixture()
  session.setDraft('Original'); const originalSend = session.send(); await until(() => requests.length === 1)
  failSave(true); responses[0].resolve(answer(requests[0])); await originalSend
  const record: AIRequestRecord = { ...requests[0], snapshotId: randomUUID(), snapshotSha256: 'b'.repeat(64), userSha256: 'a'.repeat(64), status: 'failed', retryOf: null, model: 'original-model', createdAt: date, context: { label: 'General chat', mode: 'general', action: 'ask', page: null, selectionCharacters: 0 } }
  failSave(false); const delayed = deferred<void>(), save = api.saveGeneralChat; let waiting = false, blocked = true
  api.saveGeneralChat = async value => { waiting = true; await delayed.promise; await save(value) }
  session.setOptions({ hasApiKey: true, onSettings: () => undefined, onNotice: () => undefined, isBlocked: () => blocked })
  const leaving = session.prepareToLeave(); await until(() => waiting)
  session.setDraft('Separate unsent draft'); const attempted = session.send(), retryAttempted = session.retryRequest(record)
  assert.equal(session.getSnapshot().busy, false, 'A blocked send cannot claim a new request while navigation is saving')
  assert.equal(requests.length, 1)
  delayed.resolve(); await Promise.all([leaving, attempted, retryAttempted])
  assert.equal(requests.length, 1); assert.equal(session.getSnapshot().state!.messages.length, 2); assert.equal(session.getSnapshot().draft, 'Separate unsent draft')
  blocked = false
})

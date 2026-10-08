import assert from 'node:assert/strict'
import test from 'node:test'
import { acceptsAIResult, continueLatestTransition, deferredPaperStateSave, recoverPaperState } from './stateSafety'
import type { PaperState } from '../../shared/types'

test('a missing PDF does not discard independently recovered notes and messages', async () => {
    const saved = { note: 'Keep this original note', lastPage: 3, messages: [{ id: 'message-a', paperId: 'paper-a', role: 'user' as const, content: 'Original question', createdAt: '2026-10-05T10:00:00Z' }] }
    const [state, pdf] = await Promise.allSettled([Promise.resolve(saved), Promise.reject(new Error('PDF copy missing'))])
    assert.equal(pdf.status, 'rejected')
    assert.deepEqual(recoverPaperState(state), saved)
})

test('a state load failure yields no writable state, even if its PDF succeeds', async () => {
    const [state, pdf] = await Promise.allSettled([Promise.reject<never>(new Error('Unreadable saved state')), Promise.resolve(new Uint8Array([1, 2]))])
    assert.equal(pdf.status, 'fulfilled')
    assert.equal(recoverPaperState(state), null)
})

test('switching away and back cannot revive an old cancelled AI response', () => {
    const result = { requestId: 'old-request', paperId: 'paper-a', content: 'Late response' }
    assert.equal(acceptsAIResult('old-request', 'old-request', 'paper-a', result), true)
    // A → B cancels the request. B → A does not restore the old request id.
    assert.equal(acceptsAIResult(null, 'old-request', 'paper-a', result), false)
    assert.equal(acceptsAIResult('new-request', 'old-request', 'paper-a', result), false)
    assert.equal(acceptsAIResult('old-request', 'old-request', 'paper-b', result), false)
})

test('a delayed cancellation cannot let an earlier click flush or replace the latest paper', async () => {
    let token = 0
    let visiblePaper = 'A'
    const flushed: string[] = []
    let releaseCancellation!: () => void
    const delayedCancellation = new Promise<void>(resolve => { releaseCancellation = resolve })
    async function open(paper: string, cancellation: Promise<void>) {
        const ownToken = ++token
        if (!await continueLatestTransition(ownToken, () => token, cancellation)) return
        flushed.push(visiblePaper)
        visiblePaper = paper
    }
    const earlier = open('B', delayedCancellation)
    await open('C', Promise.resolve())
    assert.equal(visiblePaper, 'C')
    releaseCancellation()
    await earlier
    assert.equal(visiblePaper, 'C')
    assert.deepEqual(flushed, ['A'])
})

test('delayed note autosave preserves a question and AI answer saved before its timer fires', async () => {
    const initial: PaperState = { note: 'First note edit', lastPage: 1, messages: [] }
    let current = { paper: { id: 'paper-a' }, loaded: true, state: initial }
    let saved: PaperState = structuredClone(initial)
    const persist = async (_id: string, value: PaperState) => { saved = structuredClone(value) }
    const fireTimer = deferredPaperStateSave('paper-a', () => current, persist)
    current = { ...current, state: { note: 'Latest note while waiting', lastPage: 2, messages: [
        { id: 'question', paperId: 'paper-a', role: 'user', content: 'Recent question', createdAt: '' },
        { id: 'answer', paperId: 'paper-a', role: 'assistant', content: 'Recent answer', createdAt: '' }
    ] } }
    await persist('paper-a', current.state)
    await fireTimer()
    assert.equal(saved.note, 'Latest note while waiting')
    assert.equal(saved.lastPage, 2)
    assert.deepEqual(saved.messages.map(message => message.content), ['Recent question', 'Recent answer'])
})

test('a delayed note timer cannot save a different paper or an unavailable state', async () => {
    const state: PaperState = { note: 'Sensitive note B', lastPage: 1, messages: [] }
    let current = { paper: { id: 'paper-a' }, loaded: true, state }
    const persisted: string[] = []
    const fireTimer = deferredPaperStateSave('paper-a', () => current, async id => { persisted.push(id) })
    current = { ...current, paper: { id: 'paper-b' } }
    await fireTimer()
    current = { ...current, paper: { id: 'paper-a' }, loaded: false }
    await fireTimer()
    assert.deepEqual(persisted, [])
})

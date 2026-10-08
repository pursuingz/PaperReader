import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ChatMessage } from '../../shared/types'
import { CONVERSATION_QUERY_LIMIT, CONVERSATION_SCAN_CHUNK, searchConversation, selectConversationMatch } from './conversationSearch'

const message = (id: string, content: string, role: ChatMessage['role'] = 'assistant', paperId = 'paper-a'): ChatMessage => ({ id, paperId, role, content, createdAt: '2026-10-06T10:00:00Z' })
const search = (messages: ChatMessage[], query: string, extras: Partial<Parameters<typeof searchConversation>[0]> = {}) => searchConversation({ paperId: 'paper-a', messages, query, signal: new AbortController().signal, yieldControl: async () => {}, ...extras })

test('conversation search matches literal English text case-insensitively and counts messages, not occurrences', async () => {
  const result = await search([message('question', 'What is the MODEL?', 'user'), message('answer', 'A model is a MODEL.'), message('other', 'No matching word')], 'model')
  assert.equal(result.paperId, 'paper-a')
  assert.equal(result.query, 'model')
  assert.equal(result.searchedMessages, 3)
  assert.deepEqual(result.matches.map(item => [item.messageId, item.role]), [['question', 'user'], ['answer', 'assistant']])
  assert.equal(result.matches[1].index, 2)
})

test('Chinese, supplementary Unicode and Unicode simple case folds preserve original offsets', async () => {
  assert.equal((await search([message('cn', '前文：论文方法与实验结果。')], '方法')).matches[0].index, 5)
  assert.equal((await search([message('emoji', '🧪 Experimental evidence')], '🧪')).matches[0].index, 0)
  assert.equal((await search([message('sigma', 'Final sigma: ς'), message('kelvin', 'K temperature')], 'Σ')).matches[0].messageId, 'sigma')
  assert.equal((await search([message('kelvin', 'K temperature')], 'k')).matches[0].index, 0)
})

test('regex punctuation remains literal, including brackets, plus, wildcard and backslash', async () => {
  const text = 'Use a+b? [x]. (test) $ and C:\\papers\\draft.'
  for (const query of ['a+b?', '[x].', '(test) $', 'C:\\papers\\draft']) {
    const result = await search([message('literal', text), message('not-regex', 'aaaaab xz test end')], query)
    assert.deepEqual(result.matches.map(item => item.messageId), ['literal'])
  }
})

test('snippets come from the matching part of long messages without modifying source Markdown', async () => {
  const content = 'prefix '.repeat(25000) + '**NEAR_THE_END** evidence\nwith a second line. ' + 'tail '.repeat(80)
  const input = [message('long', content)], before = structuredClone(input)
  const result = await search(input, 'NEAR_THE_END')
  assert.equal(result.matches[0].index, content.indexOf('NEAR_THE_END'))
  assert.match(result.matches[0].snippet, /NEAR_THE_END/)
  assert.ok(result.matches[0].snippet.startsWith('…'))
  assert.ok(result.matches[0].snippet.length < 360)
  assert.ok(!result.matches[0].snippet.includes('\n'))
  assert.deepEqual(input, before)
})

test('a literal match spanning a scan chunk boundary is not missed', async () => {
  const query = 'Boundary-' + '界'.repeat(185)
  const content = 'x'.repeat(CONVERSATION_SCAN_CHUNK - 3) + query + ' end'
  const result = await search([message('boundary', content)], query)
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].index, CONVERSATION_SCAN_CHUNK - 3)
})

test('long conversations yield repeatedly and scan the final message without silent truncation', async () => {
  let yields = 0
  const content = 'x'.repeat(200000)
  const messages = Array.from({ length: 40 }, (_, index) => message(`message-${index}`, content))
  messages.push(message('final', 'Final searchable evidence'))
  const result = await search(messages, 'searchable', { yieldControl: async () => { yields++ } })
  assert.equal(result.searchedMessages, 41)
  assert.deepEqual(result.matches.map(item => item.messageId), ['final'])
  assert.ok(yields > 40)
})

test('empty input and no matches have exact empty results; oversized queries fail rather than truncate', async () => {
  assert.deepEqual((await search([], 'query')).matches, [])
  assert.equal((await search([message('one', 'Text')], ' \n ')).searchedMessages, 0)
  const none = await search([message('one', 'Text')], 'absent')
  assert.equal(none.matches.length, 0)
  assert.equal(none.searchedMessages, 1)
  await assert.rejects(search([], 'x'.repeat(CONVERSATION_QUERY_LIMIT + 1)), /200|limit|long/i)
  assert.equal((await search([message('boundary', 'x'.repeat(CONVERSATION_QUERY_LIMIT))], 'x'.repeat(CONVERSATION_QUERY_LIMIT))).matches.length, 1)
})

test('messages from other papers cannot appear in results or searched-message counts', async () => {
  const result = await search([message('a', 'Local match'), message('b', 'Other match', 'assistant', 'paper-b')], 'match')
  assert.equal(result.searchedMessages, 1)
  assert.deepEqual(result.matches.map(item => item.messageId), ['a'])
})

test('a pre-cancelled search never schedules or returns partial results', async () => {
  const controller = new AbortController(); controller.abort()
  let scheduled = false
  await assert.rejects(search([message('one', 'Text')], 'Text', { signal: controller.signal, yieldControl: async () => { scheduled = true } }), { name: 'AbortError' })
  assert.equal(scheduled, false)
})

test('cancellation during a pending scheduler settles without waiting for the scheduler', { timeout: 1500 }, async () => {
  const controller = new AbortController()
  let entered!: () => void
  const scheduled = new Promise<void>(resolve => { entered = resolve })
  const pending = search([message('one', 'Text')], 'Text', { signal: controller.signal, yieldControl: () => { entered(); return new Promise(() => {}) } })
  await scheduled; controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('cancellation between slices discards an already-found match', async () => {
  const controller = new AbortController(); let slices = 0
  const input = [message('found', 'needle'), ...Array.from({ length: 80 }, (_, index) => message(`long-${index}`, 'x'.repeat(200000)))]
  await assert.rejects(search(input, 'needle', { signal: controller.signal, yieldControl: async () => { if (++slices === 2) controller.abort() } }), { name: 'AbortError' })
  assert.equal(slices, 2)
})

test('result selection preserves an existing message, wraps navigation and handles removed matches', async () => {
  const { matches } = await search([message('first', 'Match'), message('last', 'Match')], 'match')
  assert.equal(selectConversationMatch(matches, 'last', 0)?.messageId, 'last')
  assert.equal(selectConversationMatch(matches, 'last', 1)?.messageId, 'first')
  assert.equal(selectConversationMatch(matches, 'first', -1)?.messageId, 'last')
  assert.equal(selectConversationMatch(matches, 'removed', 0)?.messageId, 'first')
  assert.equal(selectConversationMatch([], 'removed', 1), null)
})

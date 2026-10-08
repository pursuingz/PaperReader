import type { ChatMessage } from '../../shared/types'

export const CONVERSATION_QUERY_LIMIT = 200
export const CONVERSATION_SCAN_CHUNK = 16_384
export interface ConversationMatch { messageId: string; role: ChatMessage['role']; snippet: string; index: number }
export interface ConversationSearchResult { paperId: string; query: string; matches: ConversationMatch[]; searchedMessages: number }
export interface ConversationSearchInput { paperId: string; messages: readonly ChatMessage[]; query: string; signal: AbortSignal; yieldControl?(): Promise<void> }
const SLICE_CHARACTERS = 65_536
const SLICE_MESSAGES = 32
const abortError = () => new DOMException('Conversation search cancelled.', 'AbortError')
function check(signal: AbortSignal): void { if (signal.aborted) throw abortError() }
const defaultYield = () => new Promise<void>(resolve => setTimeout(resolve, 0))

async function yieldSlice(signal: AbortSignal, schedule: () => Promise<void>): Promise<void> {
  check(signal)
  await new Promise<void>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(abortError()) }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(schedule).then(() => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(abortError()); else resolve()
    }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
  check(signal)
}

function snippet(content: string, index: number, length: number): string {
  let start = Math.max(0, index - 48), end = Math.min(content.length, index + length + 80)
  // Do not split surrogate pairs at snippet boundaries.
  if (start > 0 && /[\uDC00-\uDFFF]/.test(content[start])) start--
  if (end < content.length && /[\uDC00-\uDFFF]/.test(content[end])) end++
  return (start ? '…' : '') + content.slice(start, end).replace(/\s+/gu, ' ') + (end < content.length ? '…' : '')
}

/** Scan immutable completed-message snapshots without retaining a second full-text index. */
export async function searchConversation(input: ConversationSearchInput): Promise<ConversationSearchResult> {
  const { paperId, messages, query, signal } = input
  check(signal)
  if (query.length > CONVERSATION_QUERY_LIMIT) throw new Error('Conversation search supports up to 200 characters.')
  const result: ConversationSearchResult = { paperId, query, matches: [], searchedMessages: 0 }
  if (!query.trim() || !messages.length) return result
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu')
  const schedule = input.yieldControl ?? defaultYield
  let scannedCharacters = 0, visitedMessages = 0
  await yieldSlice(signal, schedule)
  for (const message of messages) {
    check(signal)
    if (++visitedMessages >= SLICE_MESSAGES) { await yieldSlice(signal, schedule); visitedMessages = 0; scannedCharacters = 0 }
    if (message.paperId !== paperId) continue
    result.searchedMessages++
    for (let offset = 0; offset < message.content.length; offset += CONVERSATION_SCAN_CHUNK) {
      check(signal)
      const end = Math.min(message.content.length, offset + CONVERSATION_SCAN_CHUNK + query.length - 1)
      const window = message.content.slice(offset, end), match = pattern.exec(window)
      scannedCharacters += window.length
      if (match) {
        const index = offset + match.index
        result.matches.push({ messageId: message.id, role: message.role, index, snippet: snippet(message.content, index, match[0].length) })
        break
      }
      if (scannedCharacters >= SLICE_CHARACTERS) { await yieldSlice(signal, schedule); scannedCharacters = 0; visitedMessages = 0 }
    }
    if (scannedCharacters >= SLICE_CHARACTERS) { await yieldSlice(signal, schedule); scannedCharacters = 0; visitedMessages = 0 }
  }
  check(signal)
  return result
}

export function selectConversationMatch(matches: readonly ConversationMatch[], messageId: string | null, direction: -1 | 0 | 1): ConversationMatch | null {
  if (!matches.length) return null
  const current = matches.findIndex(match => match.messageId === messageId)
  if (current < 0) return direction === -1 ? matches[matches.length - 1] : matches[0]
  return matches[(current + direction + matches.length) % matches.length]
}

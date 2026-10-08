import type { AIRequestHistory, AIRequestOwner, AIRequestRecord } from '../../shared/requestTypes'
import type { DesktopAPI } from '../../shared/types'
export function requestHistoryOwnerKey(owner: AIRequestOwner | null) { return !owner ? '' : owner.scope === 'paper' ? `paper:${owner.paperId}` : `general:${owner.conversationId}` }
export function allocateRetryIDs() { return { requestId: crypto.randomUUID(), userMessageId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID() } }
export function recordForMessage(history: AIRequestHistory | null, messageId: string): AIRequestRecord | undefined { return history?.records.find(record => record.userMessageId === messageId || record.assistantMessageId === messageId) }
/** Epoch advances for each load, including refresh of the same owner. No sending occurs here. */
export class RequestHistorySession {
  private epoch = 0
  private owner: AIRequestOwner | null = null
  ready = false
  constructor(private readonly api: Pick<DesktopAPI, 'loadAIRequests'>) {}
  async open(owner: AIRequestOwner | null): Promise<AIRequestHistory | null> {
    const epoch = ++this.epoch; this.owner = owner ? structuredClone(owner) : null; this.ready = false
    if (!owner) return null
    const scope = structuredClone(owner), key = requestHistoryOwnerKey(scope)
    const current = () => this.epoch === epoch && requestHistoryOwnerKey(this.owner) === key
    try {
      const history = await this.api.loadAIRequests(scope)
      if (!current()) return null
      if (history.version !== 1 || requestHistoryOwnerKey(history.owner) !== key) throw new Error('Request history owner identity does not match this conversation')
      this.ready = true; return history
    } catch (error) { if (!current()) return null; throw error }
  }
  close() { this.epoch++; this.owner = null; this.ready = false }
}

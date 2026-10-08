import type { GeneralAIRequest, GeneralChatState } from '../shared/types'

export const GENERAL_CHAT_LIMITS = { messages: 1000, question: 16000, answer: 200000, characters: 2000000, bytes: 12 * 1024 * 1024 } as const
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid general chat data')
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid general chat fields')
}
export function generalChatId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Invalid general chat identifier')
}
function content(value: unknown, maximum: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('Invalid or excessive general chat text')
}
export function validateGeneralChatState(value: unknown): asserts value is GeneralChatState {
  object(value); fields(value, ['version', 'conversationId', 'messages']); generalChatId(value.conversationId)
  if (value.version !== 1 || !Array.isArray(value.messages) || value.messages.length > GENERAL_CHAT_LIMITS.messages) throw new Error('General chat message limit or version is invalid')
  const ids = new Set<string>(); let characters = 0
  for (const message of value.messages) {
    object(message); fields(message, ['id', 'role', 'content', 'createdAt']); generalChatId(message.id)
    if (ids.has(message.id) || !['user', 'assistant'].includes(message.role as string)) throw new Error('Duplicate or invalid general chat message')
    ids.add(message.id); content(message.content, message.role === 'user' ? GENERAL_CHAT_LIMITS.question : GENERAL_CHAT_LIMITS.answer)
    characters += message.content.length
    if (typeof message.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(message.createdAt) || !Number.isFinite(Date.parse(message.createdAt)) || new Date(message.createdAt).toISOString() !== message.createdAt) throw new Error('Invalid general chat date')
  }
  if (characters > GENERAL_CHAT_LIMITS.characters) throw new Error('Aggregate general chat history limit exceeded')
}
/** General requests cannot carry a paper, history, provider URL or renderer-selected context. */
export function validateGeneralAIRequest(value: unknown): asserts value is GeneralAIRequest {
  object(value); fields(value, ['requestId', 'conversationId', 'userMessageId', 'assistantMessageId', 'question'])
  for (const id of [value.requestId, value.conversationId, value.userMessageId, value.assistantMessageId]) generalChatId(id)
  if (new Set([value.requestId, value.userMessageId, value.assistantMessageId]).size !== 3) throw new Error('General request message identifiers must be distinct')
  content(value.question, GENERAL_CHAT_LIMITS.question)
}

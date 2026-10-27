import type {AgentTaskStatus} from './agentTypes'
import type { AIImageReference, ChatNotesSnapshot } from './aiSourceTypes'
import type { NoteOrganizationRecipe } from './noteOrganizationTypes'
import type { AIContextMode, AIRequest, AIResult } from './types'
export type AIRequestOwner = { scope: 'paper'; paperId: string } | { scope: 'general'; conversationId: string }
export interface LegacyEffectiveAIRequest {
  version: 1
  promptVersion: 'paper-v1' | 'general-v1'
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  thinking: { type: 'disabled' }
  stream: boolean
  tokenBudgets: [4096, 8192]
  maxCharacters: number
}
export interface EffectiveAIRequestV2 extends Omit<LegacyEffectiveAIRequest,'version'|'promptVersion'> { version:2; promptVersion:'paper-v2'|'organization-v2'; paperId:string; images:AIImageReference[]; notesSnapshot?:ChatNotesSnapshot; recipe?:NoteOrganizationRecipe }
export type EffectiveAIRequest=LegacyEffectiveAIRequest|EffectiveAIRequestV2
export interface AIRequestContext { images?:AIImageReference[]; notesSelection?:ChatNotesSnapshot['selection']; label: string; mode: AIContextMode | 'general'; action: 'ask' | 'organize-notes'; page: number | null; selectionCharacters: number }
export interface AIRequestRecord {
  requestId: string; snapshotId: string; userMessageId: string; assistantMessageId: string; retryOf: string | null; createdAt: string
  status: 'pending' | 'response-ready' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  context: AIRequestContext; model: string; snapshotSha256: string; userSha256: string; answerSha256?: string
}
export interface AIRequestHistory { version: 1; owner: AIRequestOwner; records: AIRequestRecord[] }
export interface RecordedAIRequest { request: AIRequest; userMessageId: string; assistantMessageId: string }
export interface RetryAIRequest { owner: AIRequestOwner; originalRequestId: string; requestId: string; userMessageId: string; assistantMessageId: string }
export interface GeneralChatMessage { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }
export interface GeneralChatState { version: 1; conversationId: string; messages: GeneralChatMessage[] }
export interface GeneralAIRequest { requestId: string; conversationId: string; userMessageId: string; assistantMessageId: string; question: string }
export interface GeneralAIResult { requestId: string; conversationId: string; content: string; historyWarning?: string; agentTaskId?:string; agentStatus?:AgentTaskStatus }
export type GeneralAIProgress =
  | { requestId: string; conversationId: string; attempt: 1 | 2; type: 'reset' }
  | { requestId: string; conversationId: string; attempt: 1 | 2; type: 'delta'; content: string }
export type AIReplayResult = AIResult | GeneralAIResult

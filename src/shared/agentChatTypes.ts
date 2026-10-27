import type { AgentOwner, AgentReceipt, AgentSelection, AgentStep, AgentTaskStatus } from './agentTypes'

export interface AgentChatBinding { requestId: string; userMessageId: string; assistantMessageId: string }
export interface AgentSourcePolicy { mode: 'page' | 'paper' | 'notes' | 'paper-notes' | 'library' | 'general'; paperId?: string; page?: number }
export interface AgentChatTurn extends AgentChatBinding {
 version: 1
 taskId: string
 owner: AgentOwner
 model?: string
 answerReplayOf?: string
 status: AgentTaskStatus
 execution: number
 decision: number
 answer: string
 steps: AgentStep[]
 receipts: AgentReceipt[]
 selection?: AgentSelection[]
 error?: string
 createdAt: string
 updatedAt: string
}
export interface AgentProviderProgress { type: 'content'; delta: string }
export interface AgentChatProgress {
 owner: AgentOwner
 taskId: string
 requestId: string
 execution: number
 decision: number
 sequence: number
 type: 'reset' | 'content' | 'done'
 delta?: string
}
export interface AgentChatPreview { taskId: string; requestId: string; execution: number; decision: number; sequence: number; content: string; finished?: boolean }
export interface AgentChatAPI {
 loadAgentChatTurns(owner: AgentOwner): Promise<AgentChatTurn[]>
 onAgentChatTurn(listener: (turn: AgentChatTurn) => void): () => void
 onAgentChatProgress(listener: (event: AgentChatProgress) => void): () => void
}

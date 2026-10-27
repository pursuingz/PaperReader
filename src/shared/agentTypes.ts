import type { AIImageReference } from './aiSourceTypes'
import type { AgentChatBinding, AgentSourcePolicy } from './agentChatTypes'
export type AgentOwner = { kind: 'paper' | 'general'; id: string }
export type AgentOperation = 'read' | 'scan' | 'search' | 'import' | 'classify' | 'reclassify' | 'summary' | 'new-notes' | 'append-notes' | 'organize-notes' | 'export'
export type AgentExportContent = 'original' | 'annotated' | 'canvas' | 'mind-map' | 'reading-draft' | 'text' | 'summary' | 'reading-record'
export interface AgentExportSpec { content: AgentExportContent; format: 'pdf' | 'png' | 'md'; draftId?: string; boardIds?: string[]; area?: 'all' | 'viewport' | 'region' }
export interface AgentBudget { decisionTurns: number; toolCalls: number; searchResults: number; targets: number; activeMilliseconds: number }
export interface AgentScope { paperIds: string[]; library: boolean; folderToken?: string }
export interface AgentRunInput {
  clientRequestId?: string
  chatTurn?: AgentChatBinding
  sourcePolicy?: AgentSourcePolicy
  model?: string
  answerReplayOf?: string
  owner: AgentOwner; instruction: string; scope: AgentScope; language: 'zh' | 'en'; network: boolean
  allowedOperations: AgentOperation[]; outputs: AgentExportSpec[]; budget?: Partial<AgentBudget>
  context?: string; images?: AIImageReference[]; history?: Array<{ role: 'user' | 'assistant'; content: string }>
}
export type AgentTaskStatus = 'queued' | 'running' | 'waiting-selection' | 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'interrupted'
export interface AgentToolCall { id: string; name: string; arguments: string }
export interface AgentMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>; tool_call_id?: string }
export interface AgentToolDefinition { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface AgentDecision { content: string; calls: AgentToolCall[]; usage?: { inputTokens: number; outputTokens: number } }
export interface AgentReceipt { paperId?: string; kind: string; title: string; detail?: string; id?: string; fileName?: string; language?: 'zh' | 'en'; status: 'succeeded' | 'already-exists' | 'unavailable' | 'needs-review'; usage?: { calls: number; inputCharacters?: number; outputCharacters?: number } }
export interface AgentSelection { id: string; title: string; reason: string; candidateId?: string; paperId?: string }
export interface AgentToolResult { value: unknown; receipts?: AgentReceipt[]; selection?: AgentSelection[] }
export interface AgentStep { id: string; callId: string; tool: string; arguments: Record<string, unknown>; status: 'running' | 'succeeded' | 'failed' | 'cancelled'; startedAt: string; finishedAt?: string; result?: AgentToolResult; error?: string }
export interface AgentTask {
  version: 1; id: string; input: AgentRunInput; budget: AgentBudget; status: AgentTaskStatus; createdAt: string; updatedAt: string
  execution: number; consumed: { decisionTurns: number; toolCalls: number; generationCalls: number; activeMilliseconds: number; inputTokens?: number; outputTokens?: number }
  steps: AgentStep[]; messages: AgentMessage[]; answer: string; receipts: AgentReceipt[]; selection?: AgentSelection[]; error?: string
  resolvedPaperIds?: string[]
  pendingCalls?: AgentToolCall[]
}
export interface AgentReanswerInput { taskId: string; owner: AgentOwner; chatTurn: AgentChatBinding }
export interface AgentContinueInput { taskId: string; owner: AgentOwner; selectionId?: string }
export interface GeneratedReadingDraft { version: 1; id: string; paperId: string; taskId: string; revision: number; language: 'zh' | 'en'; title: string; markdown: string; createdAt: string; model?: string }
export interface LiteratureIdentity { title?: string; authors?: string[]; year?: number; doi?: string; arxivId?: string }
export interface LiteratureCandidate extends LiteratureIdentity { id: string; provider: 'arxiv' | 'crossref'; title: string; authors: string[]; sourceUrl: string; pdfUrls: string[]; abstract?: string; version?: string; assessment: 'consistent' | 'uncertain' | 'conflict'; reasons: string[] }
export interface LiteratureImportReceipt { paperId: string; status: 'imported' | 'already-in-library' | 'version'; title: string; sha256: string; relatedPaperIds?: string[] }
export interface AgentLibraryPaper { id: string; title: string; authors?: string; year?: number | null; category?: string; abstract?: string; doi?: string; arxivId?: string }
export interface AgentPaperSnapshot { paperId: string; title: string; pages?: Array<{ page: number; text: string }>; note?: string; noteRevision?: string; metadata?: AgentLibraryPaper }
export interface AgentCapabilities {
  listPapers(): Promise<AgentLibraryPaper[]>
  readPaper(paperId: string, kind: 'metadata' | 'pages' | 'notes', signal: AbortSignal): Promise<AgentPaperSnapshot>
  scanFolder(folderToken: string, signal: AbortSignal): Promise<AgentToolResult>
  importScanned(tokens: string[], signal: AbortSignal): Promise<AgentToolResult>
  listCategories(): Promise<Array<{ id: string; name: string }>>
  createCategory(name: string): Promise<{ id: string; name: string }>
  assignCategory(paperId: string, categoryId: string, reclassify: boolean, signal: AbortSignal): Promise<void>
  generateSummary(paperId: string, language: 'zh' | 'en', signal: AbortSignal, model?: string): Promise<AgentReceipt>
  generateReadingNotes(paperId: string, language: 'zh' | 'en', signal: AbortSignal, model?: string): Promise<{ markdown: string; model?: string; usage?: AgentReceipt['usage'] }>
  organizeNotes(paperId: string, signal: AbortSignal, taskId?: string, model?: string): Promise<AgentReceipt>
  readText(paperId: string, signal?: AbortSignal): Promise<{ text: string; revision: string }>
  appendText(paperId: string, markdown: string, expectedRevision: string, signal?: AbortSignal): Promise<void>
  exportContent(paperId: string, spec: AgentExportSpec, signal: AbortSignal): Promise<AgentReceipt>
}
export interface ReferenceAcquisition { version: 1; sourcePaperId: string; referenceId: string; status: 'searching' | 'waiting-selection' | 'downloading' | 'importing' | 'imported' | 'already-in-library' | 'unavailable' | 'failed'; candidates: LiteratureCandidate[]; importedPaperId?: string; receipt?: LiteratureImportReceipt; error?: string; updatedAt: string }

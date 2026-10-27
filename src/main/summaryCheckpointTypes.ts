import type { PdfTextPage, SummaryLanguage } from '../shared/types'
import type { SummaryJobPhase } from '../shared/summaryJobTypes'
export interface SummaryCheckpointInput {
  paperId: string
  pages: PdfTextPage[]
  language: SummaryLanguage
  model: string
  recipeFingerprint: string
  pdfSha256: string
  totalBatches: number
}
export interface SummaryStageIdentity {
  key: string
  phase: SummaryJobPhase
  batchIndex?: number
  inputHash: string
}
export interface SummaryStageRuntime {
  readonly checkpointId: string
  get(identity: SummaryStageIdentity): Promise<unknown | undefined>
  put(identity: SummaryStageIdentity, value: unknown, signal?: AbortSignal): Promise<void>
  consume(identity: SummaryStageIdentity, payloadCharacters: number, signal?: AbortSignal): Promise<void>
  phase(phase: SummaryJobPhase, signal?: AbortSignal): Promise<void>
  end(state: 'failed' | 'interrupted' | 'completed', safeCode?: string): Promise<void>
}
export interface SummaryCheckpointExpected {
  model: string
  language: SummaryLanguage
  recipeFingerprint: string
  pdfSha256: string
}

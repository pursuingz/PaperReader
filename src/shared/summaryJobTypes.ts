import type { SummaryLanguage } from './types'
export type SummaryJobPhase = 'extract' | 'synthesize' | 'review' | 'rewrite' | 'verify' | 'complete'
export interface SummaryJobStatus {
  version: 1
  paperId: string
  checkpointId: string
  model: string
  language: SummaryLanguage
  state: 'running' | 'interrupted' | 'failed' | 'completed'
  phase: SummaryJobPhase
  completedStages: number
  completedBatches: number
  totalBatches: number
  canResume: boolean
  incompatibleReason?: 'model' | 'language' | 'recipe' | 'source' | 'damaged' | 'budget'
  updatedAt: string
  executions: number
  warnings?: string[]
  consumed: { calls: number; characters: number; activeMs: number }
}
export interface SummaryResumeRequest { requestId: string; paperId: string; checkpointId: string }
export interface SummaryJobQuery { paperId: string; language: SummaryLanguage }

export interface SummaryDraftPreview {
 paperId: string
 checkpointId: string
 language: SummaryLanguage
 model: string
 markdown: string
 missingSections: string[]
 warnings: string[]
 updatedAt: string
}

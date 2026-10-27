import type { PaperSourceEntry } from './types'

export interface SourceEvidenceEdit {
  source: PaperSourceEntry
  caption?: string
  hidden: boolean
}
export interface SourceEvidenceEdits {
  version: 1
  paperId: string
  edits: SourceEvidenceEdit[]
}
export interface SourceEvidenceCaptionInput { entry: PaperSourceEntry; caption: string }
export interface SourceEvidenceHiddenInput { entry: PaperSourceEntry; hidden: boolean }
export interface SourceEvidenceEditsAPI {
  loadSourceEvidenceEdits(paperId: string): Promise<SourceEvidenceEdits>
  saveSourceEvidenceCaption(paperId: string, input: SourceEvidenceCaptionInput): Promise<SourceEvidenceEdits>
  setSourceEvidenceHidden(paperId: string, input: SourceEvidenceHiddenInput): Promise<SourceEvidenceEdits>
}

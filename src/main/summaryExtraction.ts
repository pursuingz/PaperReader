import type { SummaryEvidence, SummaryEvidenceField } from './summaryEvidence'
import { SummaryValidationError } from './summaryErrors'
import { prepareSummarySourceSelections, type SummarySourceSpan } from './summarySourceSpans'
import { validateAdoptedSummaryFacts } from './summaryFacts'
import { SUMMARY_POLICY } from './summaryPolicy'

export interface PendingSummaryFact {
  id: string
  field: SummaryEvidenceField
  importance: 'core' | 'supporting'
  claim?: string
  proposedContent: string
  sourceIds: string[]
  quotes: { page: number; text: string }[]
  pages: number[]
  issueCode: 'NUMBER_MISMATCH' | 'UNIT_MISMATCH' | 'BUDGET'
}
function contentConflict(error: unknown): error is SummaryValidationError & { code: 'NUMBER_MISMATCH' | 'UNIT_MISMATCH' } {
  return error instanceof SummaryValidationError && (error.code === 'NUMBER_MISMATCH' || error.code === 'UNIT_MISMATCH') && /^evidence\[\d+\]\.content$/.test(error.location)
}
export function parseSummaryExtraction(value: unknown, spans: readonly SummarySourceSpan[], prefix: string): { accepted: SummaryEvidence[]; pending: PendingSummaryFact[] } {
  const records = prepareSummarySourceSelections(value, spans, prefix)
  const accepted: SummaryEvidence[] = [], pending: PendingSummaryFact[] = []
  for (const [index, note] of records.entries()) {
    let issueCode: PendingSummaryFact['issueCode'] | undefined
    if (note.content.length > SUMMARY_POLICY.targetFactCharacters || note.sourceIds!.length > SUMMARY_POLICY.targetFactSources) issueCode = 'BUDGET'
    else {
      try { validateAdoptedSummaryFacts(note.content, note.quotes, `evidence[${index}].content`) }
      catch (error) { if (!contentConflict(error)) throw error; issueCode = error.code }
    }
    if (!issueCode) accepted.push(note)
    else pending.push({ id: `${prefix}-p${index + 1}`, field: note.field, importance: note.importance ?? 'core',
      ...(note.claim === undefined ? {} : { claim: note.claim }), proposedContent: note.content,
      sourceIds: [...note.sourceIds!], quotes: note.quotes.map(quote => ({ ...quote })), pages: [...note.pages], issueCode })
  }
  return { accepted, pending }
}

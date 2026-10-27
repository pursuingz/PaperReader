import { SummaryValidationError } from './summaryErrors'
import type { SummaryEvidence } from './summaryEvidence'
import { SUMMARY_POLICY, assertSummaryBudget } from './summaryPolicy'
import { normalizedSummaryTaskCharacters } from './summaryPayload'
import type { PendingSummaryFact } from './summaryExtraction'
import type { SummaryRepairIssue } from './summaryArgument'
import type { SummarySourceSpan } from './summarySourceSpans'
export interface PendingResolution { pendingId: string; status: 'corrected' | 'omitted'; evidenceIds: string[]; reason: string }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
export function parsePendingResolutions(value: unknown, pending: readonly PendingSummaryFact[], additions: SummaryEvidence[]): PendingResolution[] {
  const fail = (record = pending[0]): never => { throw new SummaryValidationError(record?.issueCode ?? 'SCHEMA', 'evidence[0].content') }
  if (!Array.isArray(value) || value.length !== pending.length) return fail()
  const seen = new Set<string>()
  return value.map((item: unknown) => {
    if (!object(item) || Object.keys(item).sort().join(',') !== 'evidenceIds,pendingId,reason,status' || typeof item.pendingId !== 'string' || seen.has(item.pendingId) || !['corrected', 'omitted'].includes(item.status as string) || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 600 || !Array.isArray(item.evidenceIds) || item.evidenceIds.length > SUMMARY_POLICY.maxBatchRecords || new Set(item.evidenceIds).size !== item.evidenceIds.length || item.evidenceIds.some(id => typeof id !== 'string')) return fail()
    const source = pending.find(record => record.id === item.pendingId)
    if (!source) return fail()
    seen.add(source.id)
    const ids = item.evidenceIds as string[]
    if (item.status === 'omitted') {
      if (source.importance !== 'supporting' || ids.length) return fail(source)
    } else {
      const corrected = ids.map(id => additions.find(note => note.id === id))
      if (!ids.length || corrected.some(note => !note || note.field !== source.field || note.content.length > SUMMARY_POLICY.targetFactCharacters || note.quotes.length > SUMMARY_POLICY.targetFactSources || !(note.sourceIds ? note.sourceIds.some(id => source.sourceIds.includes(id)) : note.quotes.some(quote => source.quotes.some(original => quote.page === original.page && quote.text === original.text))) || (source.importance === 'core' && note.importance === 'supporting'))) return fail(source)
      if (source.issueCode === 'BUDGET' && source.sourceIds.some(id => !corrected.some(note => note!.sourceIds?.includes(id)))) return fail(source)
    }
    return { pendingId: source.id, status: item.status as PendingResolution['status'], evidenceIds: ids, reason: item.reason.trim() }
  })
}
const section: Record<string, string> = { keywords: 'keywords', problem: 'background', gap: 'background', approach: 'methods', experiment: 'results', claim: 'results', limits: 'limitations' }
export function pendingRepairIssues(pending: readonly PendingSummaryFact[], resolutions: readonly PendingResolution[]): SummaryRepairIssue[] {
  return pending.map(record => {
    const resolution = resolutions.find(item => item.pendingId === record.id)!
    return { id: `pending-${record.id}`, kind: 'core-omission', severity: record.importance, sectionId: section[record.field], description: resolution.status === 'corrected' ? 'Incorporate the newly source-validated correction, preserving its actual quantities, objects and conditions. Do not use the rejected proposal.' : 'Omit the entire unconfirmed supporting detail and explicitly state this limited scope without retaining an unsupported qualitative assertion.', sourceIds: record.sourceIds, evidenceIds: resolution.evidenceIds }
  })
}
export const pendingReviewInstructions = 'Some extraction proposals failed local numerical/unit validation or exceeded editorial atomicity targets and are isolated in pendingEvidence. They are UNCONFIRMED proposals, never validated scientific evidence. Review their owned original sourceSpans/the single normalized sourceSpans registry and its textSourceId aliases. Return the usual issues and evidence plus pendingResolutions:[{pendingId,status:"corrected|omitted|unresolved",evidenceIds:["rv-1"],reason:"Source-supported correction or whole-fact omission reason"}]. Resolve EVERY known pendingId exactly once; never invent an identity. Corrected must reference newly returned evidence records in array order rv-1,rv-2; every corrected fact is strictly source/quantity validated again, must retain at least one exact original pending source identity/quote; for a BUDGET structural proposal the mapped corrected facts together must retain EVERY original source ID, with no truncated content, dropped assumptions, quantities or source relationships, each corrected record must be atomic (content<=3000, sourceIds<=6) and must correct the original claim rather than substitute another same-field fact, must keep the same field and keep core importance for a core proposal. Use only known source IDs from the independent windows or pendingSourceSpans. Never copy a rejected value merely to satisfy the schema. Omitted is permitted only for an explicitly supporting whole fact, with a nonempty reason; core/default-core unresolved proposals stop publication. All corrections share this single review/rewrite cycle, not one request per fact. Do not place the rejected proposal into the draft or argument outline.'
export function validateSummaryTaskEvidenceBudget(evidence: SummaryEvidence[], pending: readonly PendingSummaryFact[], sourceSpans?: readonly SummarySourceSpan[]): void {
  assertSummaryBudget(evidence.length + pending.length, SUMMARY_POLICY.maxTaskRecords, 'records')
  assertSummaryBudget(normalizedSummaryTaskCharacters(evidence, pending, sourceSpans), SUMMARY_POLICY.maxNormalizedTaskCharacters, 'normalized-characters')
}

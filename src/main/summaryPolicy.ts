import { SummaryValidationError, type SummaryBudgetMetric } from './summaryErrors'
import type { SummaryEvidenceField } from './summaryEvidence'

export const SUMMARY_POLICY = Object.freeze({
 chunkCharacters: 24_000, targetSpanCharacters: 600, maxSpanCharacters: 3000, maxSourceSpansPerBatch: 512,
 targetFactCharacters: 3000, targetFactSources: 6, targetBatchRecords: 24,
 maxProposalCharacters: 12_000, maxProposalSources: 32, maxBatchRecords: 64,
 maxTaskRecords: 160, maxNormalizedTaskCharacters: 180_000,
 maxResponseCharacters: 60_000, maxProviderEnvelopeCharacters: 128_000,
 maxInputPages: 200, maxInputCharacters: 240_000, requestTimeoutMs: 90_000,
 executionTimeoutMs: 480_000, maxExecutionPayloadCharacters: 2_000_000, maxStageAttempts: 2
})
export function assertSummaryBudget(observed: number, limit: number, metric: SummaryBudgetMetric, location = 'evidence', recoverable = false): void {
 if (observed > limit) throw new SummaryValidationError('BUDGET', location, undefined, { observed, limit, metric, recoverable })
}
export interface SummaryExtractionTargetInput { batchIndex: number; batchCount: number; usedRecords: number; fields?: readonly SummaryEvidenceField[] }
export function summaryExtractionTargets(input: SummaryExtractionTargetInput) {
 const remainingTaskRecords = Math.max(0, SUMMARY_POLICY.maxTaskRecords - input.usedRecords)
 const remainingBatches = Math.max(1, input.batchCount - input.batchIndex)
 const targetRecords = Math.min(SUMMARY_POLICY.targetBatchRecords, Math.max(remainingTaskRecords ? 1 : 0, Math.floor(remainingTaskRecords / remainingBatches)))
 const weights: Record<SummaryEvidenceField, number> = { keywords: 1, problem: 1, gap: 1, approach: 3, experiment: 3, claim: 3, limits: 2 }
 const fields = [...new Set(input.fields ?? Object.keys(weights) as SummaryEvidenceField[])]
 const totalWeight = fields.reduce((sum, field) => sum + weights[field], 0)
 const roleTargets = fields.map(field => ({ field, targetRecords: totalWeight ? Math.floor(targetRecords * weights[field] / totalWeight) : 0 }))
 const allocationOrder = [...roleTargets].sort((a, b) => (targetRecords * weights[b.field] / totalWeight % 1) - (targetRecords * weights[a.field] / totalWeight % 1) || weights[b.field] - weights[a.field])
 const unallocated = targetRecords - roleTargets.reduce((sum, role) => sum + role.targetRecords, 0)
 for (let index = 0; index < unallocated && allocationOrder.length; index++) allocationOrder[index % allocationOrder.length].targetRecords++
 return { targetRecords, targetContentCharacters: SUMMARY_POLICY.targetFactCharacters, targetSourceRefs: SUMMARY_POLICY.targetFactSources,
  remainingTaskRecords, hardBatchRecords: SUMMARY_POLICY.maxBatchRecords, hardContentCharacters: SUMMARY_POLICY.maxProposalCharacters, hardSourceRefs: SUMMARY_POLICY.maxProposalSources,
  roleTargets }
}
export function summaryExtractionInstructions(targets: ReturnType<typeof summaryExtractionTargets>): string {
 return 'Extract scientific argument units, not every sentence. Return exactly {"evidence":[{"field":"approach","content":"A supported factual statement with meaningful conditions","sourceIds":["owned-source-id"],"importance":"core","claim":"Short factual claim label"}]}. Allowed fields: keywords, problem, gap, approach, experiment, claim, limits. importance and claim are optional; central problems/gaps, distinctive mechanisms, principal contributions, decisive support, required conditions and important limits are core. Secondary background/details are supporting. Use chapterNavigation and editorialTargets to allocate the remaining task capacity; reserve room for methods, results/theory and limitations rather than repeated introduction. Role targets are writing guidance, never a reason to omit a core fact or invent an experiment. Preserve technical terms, formulas, values, units, uncertainty, ranges, vector order and complete conditions. Use only exact supplied sourceSpans IDs; selectable:false entries are context only. Resolve textSourceId aliases within the same registry. Never return quote/page fields. Aim for one complete argument unit with at most ' + targets.targetContentCharacters + ' content characters and ' + targets.targetSourceRefs + ' unique sources, and around ' + targets.targetRecords + ' records in this batch. These are editorial targets: split an overfull argument into source-backed atomic records while retaining all essential conditions, source relationships and core importance. Never truncate text or sources or downgrade a core fact to fit a target. Hard bounds per response: ' + targets.hardBatchRecords + ' records, ' + targets.hardContentCharacters + ' characters and ' + targets.hardSourceRefs + ' unique sources per proposal. At most ' + targets.remainingTaskRecords + ' task record slots remain. Unknown fields may be omitted; never infer unseen images. Theoretical, systems, conceptual and survey work uses its actual support rather than fabricated experiments.'
}

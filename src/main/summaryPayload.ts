import { createHash } from 'node:crypto'
import type { SummaryEvidence } from './summaryEvidence'
import type { PendingSummaryFact } from './summaryExtraction'
import type { SummarySourceSpan } from './summarySourceSpans'
import { SummaryValidationError } from './summaryErrors'
import { summaryFactContext } from './summaryFacts'
import { summaryNormalizeQuote } from './summarySourceAtoms'

type Quote = { page: number; text: string }
export interface SummaryPayloadSource {
 id: string; page: number; start?: number; end?: number; section?: string; text?: string; textSourceId?: string; selectable: boolean
}
const fail = (): never => { throw new SummaryValidationError('SOURCE_ID_INVALID', 'evidence') }
const physicalOrder = (a: SummarySourceSpan, b: SummarySourceSpan) => a.page - b.page || a.start - b.start || a.end - b.end || a.id.localeCompare(b.id)
const sameQuote = (a: Quote, b: Quote) => a.page === b.page && a.text === b.text
function aliasSources(sources: Array<Omit<SummaryPayloadSource, 'selectable'>>): SummaryPayloadSource[] {
 const textOwners = new Map<string, string>()
 return sources.map(source => {
  if (source.text === undefined) return fail()
  const { text, ...owner } = source
  const prior = textOwners.get(text)
  if (!prior) textOwners.set(text, source.id)
  return { ...owner, ...(prior ? { textSourceId: prior } : { text }), selectable: summaryNormalizeQuote(text).length >= 4 }
 })
}
function legacyId(quote: Quote): string {
 return 'legacy-' + createHash('sha256').update(JSON.stringify([quote.page, quote.text])).digest('hex').slice(0, 32)
}
export function packSummaryContext(evidence: readonly SummaryEvidence[], pending: readonly PendingSummaryFact[], sourceSpans: readonly SummarySourceSpan[]) {
 const registry = new Map<string, SummarySourceSpan>()
 for (const span of sourceSpans) {
  if (!span || typeof span.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(span.id) || !Number.isInteger(span.page) || span.page < 1 || typeof span.text !== 'string' || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end - span.start !== span.text.length || typeof span.section !== 'string') return fail()
  const old = registry.get(span.id)
  if (old && (old.page !== span.page || old.start !== span.start || old.end !== span.end || old.text !== span.text || old.section !== span.section)) return fail()
  registry.set(span.id, { ...span })
 }
 const originals: Array<Omit<SummaryPayloadSource, 'selectable'>> = [...registry.values()].sort(physicalOrder).map(({ id, page, start, end, text, section }) => ({ id, page, start, end, text, section }))
 const legacy = new Map<string, Omit<SummaryPayloadSource, 'selectable'>>()
 const references = (record: { sourceIds?: string[]; quotes: Quote[] }): string[] => {
  if (record.sourceIds !== undefined) {
   if (!record.sourceIds.length || new Set(record.sourceIds).size !== record.sourceIds.length) return fail()
   const selected = record.sourceIds.map(id => registry.get(id))
   if (selected.some(span => !span)) return fail()
   const quotes = (selected as SummarySourceSpan[]).sort(physicalOrder).map(span => ({ page: span.page, text: span.text }))
   if (quotes.length !== record.quotes.length || quotes.some((quote, index) => !sameQuote(quote, record.quotes[index]))) return fail()
   return [...record.sourceIds]
  }
  return record.quotes.map(quote => {
   const matching = originals.filter(span => span.page === quote.page && span.text === quote.text)
   if (matching.length === 1) return matching[0].id
   const id = legacyId(quote)
   if (registry.has(id)) return fail()
   legacy.set(id, { id, page: quote.page, text: quote.text, section: 'Legacy exact source quote' })
   return id
  })
 }
 const packedEvidence = evidence.map(note => { const { quotes, ...body } = note; return { ...body, sourceIds: references(note) } })
 const packedPending = pending.map(note => { const { quotes, ...body } = note; return { ...body, sourceIds: references(note) } })
 const factContexts = evidence.map((note, index) => {
  const context = summaryFactContext(note.content, note.quotes)
  const ids = packedEvidence[index].sourceIds
  const contextIds = note.sourceIds ? ids.map(id => registry.get(id)!).sort(physicalOrder).map(span => span.id) : ids
  return { evidenceId: note.id, adopted: context.adopted, mathReviewRequired: context.mathReviewRequired, semanticReviewRequired: context.semanticReviewRequired,
   sources: context.sources.map(({ text, page, ...facts }, sourceIndex) => ({ sourceId: contextIds[sourceIndex], ...facts })) }
 })
 return { sourceSpans: aliasSources([...originals, ...[...legacy.values()].sort((a, b) => a.id.localeCompare(b.id))]), evidence: packedEvidence, pending: packedPending, factContexts }
}
export function normalizedSummaryTaskCharacters(evidence: readonly SummaryEvidence[], pending: readonly PendingSummaryFact[] = [], sourceSpans?: readonly SummarySourceSpan[]): number {
 if (sourceSpans !== undefined) {
  const packed = packSummaryContext(evidence, pending, sourceSpans)
  return JSON.stringify({ evidence: packed.evidence, pending: packed.pending, sourceSpans: packed.sourceSpans }).length
 }
 const sources = new Map<string, { id: string; page: number; text: string }>()
 const normalize = (note: SummaryEvidence | PendingSummaryFact) => {
  const { quotes, ...body } = note
  const quoteRefs = quotes.map(quote => {
   const id = legacyId(quote)
   sources.set(id, { id, page: quote.page, text: quote.text })
   return id
  })
  return { ...body, quoteRefs }
 }
 const records = { evidence: evidence.map(normalize), pending: pending.map(normalize) }
 return JSON.stringify({ ...records, sourceSpans: aliasSources([...sources.values()]) }).length
}

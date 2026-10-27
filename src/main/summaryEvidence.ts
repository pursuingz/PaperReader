import type { PdfTextPage, SummarySection } from '../shared/types'
import { SummaryValidationError, type SummaryIssueCode } from './summaryErrors'
import { summaryFactContext, validateAdoptedSummaryFacts } from './summaryFacts'
import { summaryHeadingPattern as heading, summaryNormalizeQuote as normalize, summaryProtectedRanges, safeSummaryBoundary } from './summarySourceAtoms'
import { SUMMARY_POLICY, assertSummaryBudget } from './summaryPolicy'
import { normalizedSummaryTaskCharacters } from './summaryPayload'
export { summaryNumericFacts as numericFacts } from './summarySourceAtoms'


export const SUMMARY_CHUNK_CHARACTERS = SUMMARY_POLICY.chunkCharacters
export const SUMMARY_EVIDENCE_FIELDS = ['keywords', 'problem', 'gap', 'approach', 'experiment', 'claim', 'limits'] as const
export type SummaryEvidenceField = typeof SUMMARY_EVIDENCE_FIELDS[number]
export interface SummarySourceFragment extends PdfTextPage { section: string; start: number; end: number }
export interface SummaryEvidence { sourceIds?: string[]; importance?: 'core' | 'supporting'; claim?: string; id: string; field: SummaryEvidenceField; content: string; pages: number[]; quotes: Array<{ page: number; text: string }> }
export interface SummaryCoverage { field: SummaryEvidenceField; status: 'supported' | 'unknown'; sectionId: string; evidenceIds: string[] }
const sectionFor: Record<SummaryEvidenceField, string[]> = { keywords: ['keywords'], problem: ['background'], gap: ['background'], approach: ['methods'], experiment: ['methods', 'results'], claim: ['results'], limits: ['limitations'] }
const unknown = /\b(?:unavailable|unknown|not (?:provided|reported|specified|available)|insufficient|no (?:supplied|explicit|available|supported) evidence)\b|(?:未(?:提供|报告|说明|明确)|不(?:足|详)|无法确定|未知|缺少|无明确证据)/i
const failure = (code: SummaryIssueCode = 'SCHEMA', location = 'response') => new SummaryValidationError(code, location)
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function fragments(pages: PdfTextPage[]): SummarySourceFragment[] {
  const result: SummarySourceFragment[] = []; let section = 'Unlabelled source'
  for (const page of pages) {
    if (!page.text.trim()) continue
    let start = 0
    for (const match of page.text.matchAll(/[^\r\n]+(?:\r?\n|$)/g)) {
      const line = match[0].trim()
      if (line.length <= 160 && heading.test(line)) {
        if (match.index! > start) result.push({ page: page.page, text: page.text.slice(start, match.index), start, end: match.index!, section })
        start = match.index!; section = line
      }
    }
    if (start < page.text.length) result.push({ page: page.page, text: page.text.slice(start), start, end: page.text.length, section })
  }
  return result
}
function boundary(text: string, capacity: number): number {
  if (text.length <= capacity) return text.length
  let end = capacity
  const floor = Math.floor(capacity / 2)
  const candidates = [...text.slice(0, capacity).matchAll(/\n\s*\n|\n|[.!?。！？](?:\s+|$)/g)]
  const preferred = candidates.filter(match => match.index! + match[0].length >= floor).at(-1)
  if (preferred) end = preferred.index! + preferred[0].length
  else {
    const space = text.lastIndexOf(' ', capacity - 1)
    if (space >= floor) end = space + 1
  }
  if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--
  return safeSummaryBoundary(text, end)
}
export function splitSummarySource(pages: PdfTextPage[]): SummarySourceFragment[][] {
  const chunks: SummarySourceFragment[][] = []; let chunk: SummarySourceFragment[] = []; let size = 0
  for (const source of fragments(pages)) {
    let offset = 0
    if (size && source.text.length > SUMMARY_CHUNK_CHARACTERS - size) { chunks.push(chunk); chunk = []; size = 0 }
    while (offset < source.text.length) {
      const end = offset + boundary(source.text.slice(offset), SUMMARY_CHUNK_CHARACTERS - size)
      if (end === offset) { if (chunk.length) chunks.push(chunk); chunk = []; size = 0; continue }
      chunk.push({ ...source, text: source.text.slice(offset, end), start: source.start + offset, end: source.start + end }); size += end - offset; offset = end
      if (offset < source.text.length || size === SUMMARY_CHUNK_CHARACTERS) { chunks.push(chunk); chunk = []; size = 0 }
    }
  }
  if (chunk.length) chunks.push(chunk)
  return chunks
}
export function parseSummaryEvidence(value: unknown, pages: PdfTextPage[], prefix: string): SummaryEvidence[] {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.evidence)) throw failure('SCHEMA', 'evidence')
  assertSummaryBudget(value.evidence.length, SUMMARY_POLICY.maxBatchRecords, 'records')
  const evidence = value.evidence.map((item: unknown, index: number): SummaryEvidence => {
    const path = `evidence[${index}]`
    if (!isRecord(item) || Object.keys(item).some(key => !['content', 'field', 'quotes', 'importance', 'claim'].includes(key)) || !SUMMARY_EVIDENCE_FIELDS.includes(item.field as SummaryEvidenceField)) throw failure('SCHEMA', path)
    if (item.importance !== undefined && !['core', 'supporting'].includes(item.importance as string) || item.claim !== undefined && (typeof item.claim !== 'string' || !item.claim.trim() || item.claim.length > 300)) throw failure('SCHEMA', path)
    if (typeof item.content !== 'string' || !item.content.trim()) throw failure('SCHEMA', `${path}.content`)
    if (!Array.isArray(item.quotes) || !item.quotes.length) throw failure('SCHEMA', `${path}.quotes`)
    const quotes = item.quotes.map((quote: unknown, quoteIndex: number) => {
      const quotePath = `${path}.quotes[${quoteIndex}]`
      if (!isRecord(quote) || Object.keys(quote).sort().join(',') !== 'page,text') throw failure('SCHEMA', quotePath)
      if (!Number.isInteger(quote.page)) throw failure('SCHEMA', `${quotePath}.page`)
      if (!pages.some(page => page.page === quote.page && page.text.trim())) throw failure('PAGE_OUT_OF_SCOPE', `${quotePath}.page`)
      if (typeof quote.text !== 'string' || normalize(quote.text).length < 4) throw failure('SCHEMA', `${quotePath}.text`)
      if (!pages.some(page => page.page === quote.page && normalize(page.text).includes(normalize(quote.text as string)))) throw failure('QUOTE_NOT_IN_SOURCE', quotePath)
      return { page: quote.page as number, text: quote.text }
    })
    return { id: `${prefix}-${index + 1}`, field: item.field as SummaryEvidenceField, content: item.content, pages: [...new Set(quotes.map(quote => quote.page))].sort((a, b) => a - b), quotes,
      ...(item.importance === undefined ? {} : { importance: item.importance as 'core' | 'supporting' }), ...(typeof item.claim === 'string' ? { claim: item.claim.trim() } : {}) }
  })
  for (const [index, note] of evidence.entries()) {
    const path = `evidence[${index}]`
    assertSummaryBudget(note.content.length, SUMMARY_POLICY.targetFactCharacters, 'characters', `${path}.content`, true)
    assertSummaryBudget(note.quotes.length, SUMMARY_POLICY.targetFactSources, 'references', `${path}.quotes`, true)
    for (const [quoteIndex, quote] of note.quotes.entries()) assertSummaryBudget(quote.text.length, SUMMARY_POLICY.maxSpanCharacters, 'characters', `${path}.quotes[${quoteIndex}].text`)
  }
  assertSummaryBudget(normalizedSummaryTaskCharacters(evidence), SUMMARY_POLICY.maxNormalizedTaskCharacters, 'normalized-characters')
  for (const [index, note] of evidence.entries()) validateAdoptedSummaryFacts(note.content, note.quotes, `evidence[${index}].content`)
  return evidence
}

export function sourceSupportedFields(pages: PdfTextPage[]): SummaryEvidenceField[] {
  const source = pages.map(page => page.text).join('\n')
  const indicators: Partial<Record<SummaryEvidenceField, RegExp>> = {
    problem: /\b(?:introduction|problem|we address|aim|objective)\b|引言|问题|目标/i,
    gap: /\b(?:fail(?:s|ure)?|lack(?:s|ing)?|limited|limitation|challenge|however|unlike|gap)\b|不足|缺乏|然而|挑战/i,
    approach: /\b(?:methods?|approach|we (?:propose|optimize|introduce)|algorithm)\b|方法|算法/i,
    experiment: /\b(?:experiments?|evaluation|dataset|benchmark|baseline|ablation)\b|实验|数据集|消融/i,
    claim: /\b(?:results?|outperform|improv(?:e|es|ement)|achiev(?:e|es)|versus)\b|结果|优于|提升/i,
    limits: /\b(?:limitations?|future work|degrades?|failure cases?)\b|局限|未来工作|退化/i
  }
  return SUMMARY_EVIDENCE_FIELDS.filter(field => indicators[field]?.test(source))
}
export function selectSummaryRepairSource(pages: PdfTextPage[], fields: SummaryEvidenceField[], evidence: SummaryEvidence[]): SummarySourceFragment[] {
  const source = fragments(pages); const selected: SummarySourceFragment[] = []; const budget = Math.floor(SUMMARY_CHUNK_CHARACTERS / Math.max(1, fields.length))
  const patterns: Record<SummaryEvidenceField, RegExp> = { keywords: /abstract|introduction|摘要|引言/i, problem: /introduction|problem|objective|引言|问题/i, gap: /fail|lack|limitation|however|gap|不足|然而|挑战/i, approach: /method|approach|algorithm|方法|算法/i, experiment: /experiment|dataset|evaluation|benchmark|baseline|实验|数据集/i, claim: /result|outperform|improv|achiev|versus|结果|提升/i, limits: /limitation|future work|degrad|failure|局限|未来/i }
  for (const field of fields) {
    const relevantPages = new Set(evidence.filter(item => item.field === field).flatMap(item => item.pages))
    const ranked = source.map(fragment => ({ fragment, score: (patterns[field].test(fragment.section) ? 4 : 0) + (patterns[field].test(fragment.text) ? 2 : 0) + (relevantPages.has(fragment.page) ? 1 : 0) })).sort((a, b) => b.score - a.score)
    let remaining = budget
    for (const { fragment, score } of ranked) {
      if (!score || remaining <= 0) break
      let start = 0
      if (fragment.text.length > remaining) { const match = patterns[field].exec(fragment.text); start = Math.max(0, (match?.index ?? 0) - Math.floor(remaining / 4)) }
      const cut = summaryProtectedRanges(fragment.text).find(range => range.start < start && start < range.end)
      if (cut) start = cut.start
      const end = safeSummaryBoundary(fragment.text, Math.min(fragment.text.length, start + remaining))
      if (end <= start) throw failure('BUDGET')
      const text = fragment.text.slice(start, end)
      if (!selected.some(item => item.page === fragment.page && item.start === fragment.start + start && item.end === fragment.start + end)) selected.push({ ...fragment, text, start: fragment.start + start, end: fragment.start + end })
      remaining -= text.length
    }
  }
  return selected
}
export function parseSummaryCoverage(value: unknown, sections: SummarySection[], evidence: SummaryEvidence[]): { coverage: SummaryCoverage[]; missing: SummaryEvidenceField[] } {
  if (!Array.isArray(value) || value.length !== SUMMARY_EVIDENCE_FIELDS.length) throw failure('SCHEMA', 'coverage')
  const seen = new Set<string>(); const missing: SummaryEvidenceField[] = []
  const coverage = value.map((item: unknown, index: number) => {
    const path = `coverage[${index}]`
    if (!isRecord(item)) throw failure('SCHEMA', path)
    const field = item.field as SummaryEvidenceField
    if (Object.keys(item).sort().join(',') !== 'evidenceIds,field,sectionId,status' || !SUMMARY_EVIDENCE_FIELDS.includes(field) || seen.has(field) || !['supported', 'unknown'].includes(item.status as string) || typeof item.sectionId !== 'string' || !sectionFor[field].includes(item.sectionId) || !Array.isArray(item.evidenceIds) || new Set(item.evidenceIds).size !== item.evidenceIds.length || item.evidenceIds.some(id => typeof id !== 'string')) throw failure('SCHEMA', path)
    if (item.evidenceIds.length > 160) throw failure('BUDGET', `${path}.evidenceIds`)
    seen.add(field)
    const evidenceIds = item.evidenceIds
    const available = evidence.filter(note => note.field === field); const section = sections.find(section => section.id === item.sectionId)
    if (!section) throw failure('SCHEMA', 'sections')
    const linked = evidenceIds.map(id => evidence.find(note => note.id === id && note.field === field))
    if (linked.some(note => !note)) throw failure('SCHEMA', `${path}.evidenceIds`)
    if (item.status === 'supported' && (!linked.length || !available.length)) throw failure('SCHEMA', path)
    if (item.status === 'unknown' && evidenceIds.length) throw failure('SCHEMA', `${path}.evidenceIds`)
    const core = available.filter(note => note.importance !== 'supporting')
    const adopted = summaryFactContext(section.content, []).adopted
    if (core.length && (item.status !== 'supported' || core.some(note => !evidenceIds.includes(note.id)) || !linked.length || core.some(note => {
      const facts = summaryFactContext(note.content, []).adopted
      return facts.numbers.some(number => !adopted.numbers.includes(number)) || facts.measurements.some(measure => !adopted.measurements.includes(measure)) || summaryFactContext(note.content, [{ page: note.pages[0], text: section.content }]).mathReviewRequired.length > 0
    }))) missing.push(field)
    if (linked.some(note => note!.pages.some(page => !section.pages.includes(page))) && !missing.includes(field)) missing.push(field)
    if (!available.length && (item.status !== 'unknown' || !unknown.test(section.content))) missing.push(field)
    return item as unknown as SummaryCoverage
  })
  for (const [index, section] of sections.entries()) {
    const path = `sections[${index}]`
    const linked = section.id === 'overview' ? evidence : coverage.filter(item => item.sectionId === section.id).flatMap(item => item.evidenceIds.map(id => evidence.find(note => note.id === id)!))
    const allowed = new Set(linked.flatMap(note => note.pages))
    if (section.pages.some(page => !allowed.has(page))) throw failure('PAGE_OUT_OF_SCOPE', `${path}.pages`)
    validateAdoptedSummaryFacts(section.content, linked.map(note => ({ page: note.pages[0], text: note.content })), `${path}.content`)
  }
  return { coverage, missing }
}
export function validateSummaryEvidenceBudget(evidence: SummaryEvidence[]): void {
  assertSummaryBudget(evidence.length, SUMMARY_POLICY.maxTaskRecords, 'records')
  assertSummaryBudget(normalizedSummaryTaskCharacters(evidence), SUMMARY_POLICY.maxNormalizedTaskCharacters, 'normalized-characters')
}



import { SUMMARY_CHUNK_CHARACTERS, SUMMARY_EVIDENCE_FIELDS, type SummaryEvidence, type SummarySourceFragment } from './summaryEvidence'
import { SummaryValidationError, type SummaryIssueCode } from './summaryErrors'
import { summaryProtectedRanges, summaryNormalizeQuote } from './summarySourceAtoms'
import { validateAdoptedSummaryFacts } from './summaryFacts'
import { SUMMARY_POLICY, assertSummaryBudget } from './summaryPolicy'
import { normalizedSummaryTaskCharacters } from './summaryPayload'

export interface SummarySourceSpan extends SummarySourceFragment { id: string }
const TARGET_SPAN_CHARACTERS = SUMMARY_POLICY.targetSpanCharacters
const MAX_SPAN_CHARACTERS = SUMMARY_POLICY.maxSpanCharacters
const MAX_SOURCE_SPANS = SUMMARY_POLICY.maxSourceSpansPerBatch
function fail(code: SummaryIssueCode, location = 'response'): never { throw new SummaryValidationError(code, location) }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
function checkPrefix(prefix: string): void { if (typeof prefix !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(prefix)) fail('SCHEMA') }
function checkFragment(source: SummarySourceFragment): void {
  if (!source || !Number.isInteger(source.page) || source.page < 1 || source.page > 200 || typeof source.text !== 'string' || typeof source.section !== 'string' || source.section.length > 160 || !Number.isInteger(source.start) || source.start < 0 || !Number.isInteger(source.end) || source.end - source.start !== source.text.length || source.end > 240_000) fail('SCHEMA')
}
function physicalOrder(a: SummarySourceFragment, b: SummarySourceFragment): number { return a.page - b.page || a.start - b.start || a.end - b.end }
function boundaries(text: string): { sentences: number[]; clauses: number[]; words: number[] } {
  const result = { sentences: [] as number[], clauses: [] as number[], words: [] as number[] }
  const ranges = summaryProtectedRanges(text); let rangeIndex = 0
  const safe = (position: number): boolean => {
    while (ranges[rangeIndex] && ranges[rangeIndex].end <= position) rangeIndex++
    const range = ranges[rangeIndex]
    return !range || position <= range.start || position >= range.end
  }
  for (let index = 0; index < text.length; index++) {
    const character = text[index]; const next = text[index + 1]
    if (/\s/u.test(character)) {
      if ((!next || !/\s/u.test(next)) && safe(index + 1)) result.words.push(index + 1)
      continue
    }
    const terminal = /[.!?。！？]/u.test(character) && (!next || /\s/u.test(next) || /[。！？]/u.test(character))
    const clause = /[;；，]/u.test(character) || /[,:：]/u.test(character) && (!next || /\s/u.test(next))
    if (!terminal && !clause) continue
    if (character === '.' && /(?:\b(?:Eq|Eqs|Fig|Figs|Sec|Secs|Ref|Refs|Dr|Prof|vs)|\bet al|\be\.g|\bi\.e)$/i.test(text.slice(Math.max(0, index - 16), index))) continue
    let end = index + 1
    while (end < text.length && /\s/u.test(text[end])) end++
    if (safe(end)) (terminal ? result.sentences : result.clauses).push(end)
  }
  return result
}
function splitFragment(source: SummarySourceFragment): Array<{ start: number; end: number }> {
  if (!source.text.length) return []
  const points = boundaries(source.text); const result: Array<{ start: number; end: number }> = []
  let start = 0
  while (start < source.text.length) {
    const target = start + TARGET_SPAN_CHARACTERS; const maximum = start + MAX_SPAN_CHARACTERS
    let end = points.sentences.find(position => position > start && position <= target)
    if (end === undefined && source.text.length <= target) end = source.text.length
    if (end === undefined) end = points.clauses.filter(position => position > start && position <= target).at(-1)
    if (end === undefined) end = points.words.filter(position => position > start && position <= target).at(-1)
    if (end === undefined) end = [...points.sentences, ...points.clauses, ...points.words, source.text.length].filter(position => position > target && position <= maximum).sort((a, b) => a - b)[0]
    if (end === undefined || end <= start || end - start > MAX_SPAN_CHARACTERS) fail('BUDGET')
    result.push({ start, end }); start = end
  }
  return result
}
export function createSummarySourceSpans(source: SummarySourceFragment[], prefix: string): SummarySourceSpan[] {
  checkPrefix(prefix)
  if (!Array.isArray(source)) fail('SCHEMA')
  let characters = 0
  for (const fragment of source) { checkFragment(fragment); characters += fragment.text.length; if (characters > SUMMARY_CHUNK_CHARACTERS) fail('BUDGET') }
  const spans: SummarySourceSpan[] = []
  for (const fragment of [...source].sort(physicalOrder)) {
    for (const part of splitFragment(fragment)) {
      if (spans.length >= MAX_SOURCE_SPANS) fail('BUDGET')
      spans.push(Object.freeze({ ...fragment, id: `${prefix}-s${spans.length + 1}`, text: fragment.text.slice(part.start, part.end), start: fragment.start + part.start, end: fragment.start + part.end }))
    }
  }
  return Object.freeze(spans) as SummarySourceSpan[]
}
export function prepareSummarySourceSelections(value: unknown, spans: readonly SummarySourceSpan[], prefix: string): SummaryEvidence[] {
  checkPrefix(prefix)
  if (!Array.isArray(spans)) fail('SCHEMA')
  assertSummaryBudget(spans.length, SUMMARY_POLICY.maxSourceSpansPerBatch, 'source-spans')
  const registry = new Map<string, SummarySourceSpan>()
  for (const span of spans) {
    checkFragment(span)
    if (typeof span.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(span.id) || registry.has(span.id)) fail('SCHEMA')
    registry.set(span.id, span)
  }
  if (!record(value) || Object.keys(value).length !== 1 || !Array.isArray(value.evidence)) fail('SCHEMA', 'evidence')
  assertSummaryBudget(value.evidence.length, SUMMARY_POLICY.maxBatchRecords, 'records')
  const evidence = value.evidence.map((item: unknown, index: number): SummaryEvidence => {
    const path = `evidence[${index}]`
    if (!record(item) || Object.keys(item).some(key => !['content', 'field', 'sourceIds', 'importance', 'claim'].includes(key)) || !SUMMARY_EVIDENCE_FIELDS.includes(item.field as typeof SUMMARY_EVIDENCE_FIELDS[number])) fail('SCHEMA', path)
    if (item.importance !== undefined && !['core', 'supporting'].includes(item.importance as string) || item.claim !== undefined && (typeof item.claim !== 'string' || !item.claim.trim() || item.claim.length > 300)) fail('SCHEMA', path)
    if (typeof item.content !== 'string' || !item.content.trim() || !Array.isArray(item.sourceIds) || item.sourceIds.some(id => typeof id !== 'string')) fail('SCHEMA', path)
    if (!item.sourceIds.length || new Set(item.sourceIds).size !== item.sourceIds.length) fail('SOURCE_ID_INVALID', `${path}.sourceIds`)
    const selected = item.sourceIds.map(id => registry.get(id as string))
    const missing = selected.findIndex(span => !span)
    if (missing >= 0) fail('SOURCE_ID_INVALID', `${path}.sourceIds[${missing}]`)
    const quotes = (selected as SummarySourceSpan[]).sort(physicalOrder).map(span => {
      if (summaryNormalizeQuote(span.text).length < 4) fail('SCHEMA', path)
      return { page: span.page, text: span.text }
    })
    return { id: `${prefix}-${index + 1}`, field: item.field as SummaryEvidence['field'], content: item.content,
      sourceIds: [...item.sourceIds] as string[], quotes, pages: [...new Set(quotes.map(quote => quote.page))].sort((a, b) => a - b),
      ...(item.importance === undefined ? {} : { importance: item.importance as 'core' | 'supporting' }),
      ...(typeof item.claim === 'string' ? { claim: item.claim.trim() } : {}) }
  })
  for (const [index, note] of evidence.entries()) {
    const path = `evidence[${index}]`
    assertSummaryBudget(note.content.length, SUMMARY_POLICY.maxProposalCharacters, 'characters', `${path}.content`)
    assertSummaryBudget(note.sourceIds!.length, SUMMARY_POLICY.maxProposalSources, 'references', `${path}.sourceIds`)
  }
  for (const span of registry.values()) assertSummaryBudget(span.text.length, SUMMARY_POLICY.maxSpanCharacters, 'characters')
  const selectedIds = new Set(evidence.flatMap(note => note.sourceIds!))
  assertSummaryBudget(normalizedSummaryTaskCharacters(evidence, [], [...registry.values()].filter(span => selectedIds.has(span.id))), SUMMARY_POLICY.maxNormalizedTaskCharacters, 'normalized-characters')
  return evidence
}
export function parseSummarySourceSelections(value: unknown, spans: readonly SummarySourceSpan[], prefix: string): SummaryEvidence[] {
  const evidence = prepareSummarySourceSelections(value, spans, prefix)
  for (const [index, note] of evidence.entries()) {
    const path = `evidence[${index}]`
    assertSummaryBudget(note.content.length, SUMMARY_POLICY.targetFactCharacters, 'characters', `${path}.content`, true)
    assertSummaryBudget(note.sourceIds!.length, SUMMARY_POLICY.targetFactSources, 'references', `${path}.sourceIds`, true)
  }
  for (const [index, note] of evidence.entries()) validateAdoptedSummaryFacts(note.content, note.quotes, `evidence[${index}].content`)
  return evidence
}

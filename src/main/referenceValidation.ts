import type { PaperReference, PaperReferences, ReferenceCandidate } from '../shared/types'
import { sourcePaperId } from './sourceIndexValidation'
import { parseReferenceFields, normalizeDoi } from './referenceParser'
import { assessReferenceCandidate, verificationStatus } from './referenceVerification'

function fields(value: unknown, allowed: string[], required = allowed): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Invalid reference object')
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid reference fields')
}
function text(value: unknown, maximum: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('Invalid reference text')
}
function date(value: unknown) {
  text(value, 30)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid reference date')
}
function authorList(value: unknown, limit: number) {
  if (!Array.isArray(value) || value.length > 30) throw new Error('Invalid reference authors')
  for (const author of value) text(author, limit)
}
function bibliographic(value: unknown, candidate = false): asserts value is Record<string, unknown> {
  const allowed = ['title', 'authors', 'year', 'venue', 'doi', ...(candidate ? ['assessment', 'reasons'] : [])]
  fields(value, allowed, candidate ? ['doi', 'title', 'authors', 'assessment', 'reasons'] : [])
  if (value.title !== undefined) text(value.title, 2000)
  if (value.venue !== undefined) text(value.venue, 500)
  if (value.authors !== undefined) authorList(value.authors, candidate ? 250 : 200)
  if (value.year !== undefined && (!Number.isInteger(value.year) || (value.year as number) < 1000 || (value.year as number) > 2200)) throw new Error('Invalid reference year')
  if (value.doi !== undefined && (typeof value.doi !== 'string' || normalizeDoi(value.doi) !== value.doi)) throw new Error('Invalid reference DOI')
}
export function validateReferences(value: unknown, paperId: string): asserts value is PaperReferences {
  sourcePaperId(paperId)
  fields(value, ['paperId', 'version', 'sourceRevision', 'sourceCreatedAt', 'builtAt', 'sourceLimitReached', 'records'])
  if (value.paperId !== paperId || value.version !== 1) throw new Error('Invalid reference identity or version')
  if (typeof value.sourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceRevision)) throw new Error('Invalid reference source revision')
  date(value.sourceCreatedAt); date(value.builtAt)
  if (typeof value.sourceLimitReached !== 'boolean' || !Array.isArray(value.records) || value.records.length > 1000) throw new Error('Invalid reference records or source limit')
  const ids = new Set<string>()
  let characters = 0
  for (const item of value.records) {
    fields(item, ['id', 'sourceEntryId', 'rawText', 'pages', 'segmentation', 'fields', 'verification'])
    sourcePaperId(item.id); sourcePaperId(item.sourceEntryId)
    if (ids.has(item.id)) throw new Error('Duplicate reference identifier')
    ids.add(item.id); text(item.rawText, 16000); characters += item.rawText.length
    const pages = item.pages
    if (!Array.isArray(pages) || !pages.length || pages.length > 200 || pages.some((page, index) => !Number.isSafeInteger(page) || page < 1 || page > 100000 || (index > 0 && page <= pages[index - 1]))) throw new Error('Invalid reference source pages')
    if (!['entry', 'unsegmented'].includes(item.segmentation as string)) throw new Error('Invalid reference segmentation')
    bibliographic(item.fields)
    const parsed = item.segmentation === 'entry' ? parseReferenceFields(item.rawText) : {}
    if (JSON.stringify(item.fields) !== JSON.stringify(parsed)) throw new Error('Reference fields do not match original text')
    if (item.verification !== null) {
      if (item.segmentation !== 'entry') throw new Error('Unsegmented references cannot be matched')
      fields(item.verification, ['provider', 'checkedAt', 'method', 'status', 'candidates'])
      const result = item.verification
      if (result.provider !== 'crossref' || result.method !== (parsed.doi ? 'doi' : 'bibliographic')) throw new Error('Invalid reference verification provider or method')
      date(result.checkedAt)
      if (!Array.isArray(result.candidates) || result.candidates.length > 3) throw new Error('Invalid reference candidates')
      const dois = new Set<string>()
      for (const candidate of result.candidates) {
        bibliographic(candidate, true)
        if (dois.has(candidate.doi as string)) throw new Error('Duplicate reference candidate DOI')
        dois.add(candidate.doi as string)
        if (!Array.isArray(candidate.reasons) || candidate.reasons.length > 8) throw new Error('Invalid reference match reasons')
        for (const reason of candidate.reasons) text(reason, 300)
        const { assessment: _assessment, reasons: _reasons, ...metadata } = candidate
        const assessed = assessReferenceCandidate(item as unknown as PaperReference, metadata as unknown as Omit<ReferenceCandidate, 'assessment' | 'reasons'>)
        if (candidate.assessment !== assessed.assessment || JSON.stringify(candidate.reasons) !== JSON.stringify(assessed.reasons)) throw new Error('Reference candidate assessment does not match original text')
      }
      if (result.status !== verificationStatus(result.candidates as ReferenceCandidate[])) throw new Error('Invalid reference match status')
    }
  }
  if (characters > 240000 || JSON.stringify(value).length > 2_000_000) throw new Error('Reference storage limit exceeded')
}

import { createHash } from 'node:crypto'
import type { PaperReference, PaperSourceIndex, ReferenceFields } from '../shared/types'

export function normalizeDoi(value: string): string | undefined {
  let text = value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi\s*:\s*/i, '').replace(/[.,;:]+$/, '')
  while (text.endsWith(')') && (text.match(/\)/g)?.length ?? 0) > (text.match(/\(/g)?.length ?? 0)) text = text.slice(0, -1)
  text = text.replace(/[.,;:]+$/, '')
  return text.length <= 300 && /^10\.\d{4,9}\/[A-Z0-9._;()/:+-]+$/i.test(text) ? text.toLowerCase() : undefined
}

function authorNames(value: string): string[] | undefined {
  const authors = value.trim().replace(/[.,;]+$/, '').split(/\s*;\s*|\s+(?:and|&)\s+/i).map(name => name.trim().replace(/[,;]+$/, '')).filter(Boolean)
  return authors.length && authors.length <= 30 && authors.every(name => name.length <= 200 && /[\p{L}]/u.test(name) && !/\d/.test(name)) ? authors : undefined
}
function sentences(value: string): string[] {
  // Initials are not sentence boundaries. Preserve their punctuation in displayed fields.
  return value.replace(/\b([A-Z])\.(?=\s|,|$)/g, '$1\uE000').split(/[.。]\s*/).map(part => part.replace(/\uE000/g, '.').trim()).filter(Boolean)
}
export function parseReferenceFields(rawText: string): ReferenceFields {
  const fields: ReferenceFields = {}
  const text = rawText.replace(/^\s*(?:\[\d+\]\s*|\d+[.)]\s+)/, '').replace(/\s+/g, ' ').trim()
  const dois = [...new Set((text.match(/10\.\d{4,9}\/[A-Z0-9._;()/:+-]+/gi) ?? []).map(normalizeDoi).filter((doi): doi is string => Boolean(doi)))]
  if (dois.length === 1) fields.doi = dois[0]
  const body = text.replace(/(?:https?:\/\/(?:dx\.)?doi\.org\/|doi\s*:\s*)?10\.\d{4,9}\/[A-Z0-9._;()/:+-]+/gi, '').trim()
  const years = [...new Set((body.match(/\b(?:18|19|20)\d{2}\b/g) ?? []).map(Number))]
  if (years.length === 1) fields.year = years[0]
  const authorYear = /^(.*?)\(\s*((?:18|19|20)\d{2})[a-z]?\s*\)\.?\s+(.+)$/i.exec(body)
  let authors: string | undefined, title: string | undefined, venue: string | undefined
  if (authorYear) {
    authors = authorYear[1]; [title, venue] = sentences(authorYear[3])
  } else {
    const quoted = /^(.*?)\s*[“"]([^”"]{4,2000})[”"]\s*[,.;]?\s*(.*)$/.exec(body)
    if (quoted) { authors = quoted[1]; title = quoted[2]; venue = sentences(quoted[3])[0] }
    else {
      const parts = sentences(body)
      if (parts.length >= 2) { [authors, title, venue] = parts }
    }
  }
  const names = authors && authorNames(authors)
  if (names && title && title.length >= 4 && title.length <= 2000 && /[\p{L}]/u.test(title) && !/^https?:|^doi\s*:/i.test(title)) {
    fields.authors = names
    fields.title = title.replace(/\[(?:J|C|M|R|D|EB\/OL)\]$/i, '').trim()
    if (venue && venue.length <= 500 && /[\p{L}]/u.test(venue)) fields.venue = venue
  }
  return fields
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const referenceSources = (source: PaperSourceIndex) => source.entries.filter(entry => entry.kind === 'reference' || entry.kind === 'reference-section')
export function sourceRevision(source: PaperSourceIndex): string {
  return digest({ paperId: source.paperId, extractorVersion: source.extractorVersion, pageCount: source.pageCount, indexedPages: source.indexedPages, textlessPages: source.textlessPages, failedPages: source.failedPages, limitReached: source.limitReached, entries: referenceSources(source) })
}
export function buildReferenceRecords(source: PaperSourceIndex): PaperReference[] {
  return referenceSources(source).map(entry => ({ id: `reference-${digest({ id: entry.id, text: entry.text, pages: entry.pages }).slice(0, 32)}`, sourceEntryId: entry.id, rawText: entry.text, pages: [...entry.pages], segmentation: entry.kind === 'reference' ? 'entry' : 'unsegmented', fields: entry.kind === 'reference' ? parseReferenceFields(entry.text) : {}, verification: null }))
}

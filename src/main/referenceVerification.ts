import type { PaperReference, ReferenceCandidate, ReferenceVerification } from '../shared/types'
import { normalizeDoi } from './referenceParser'

const MAX_RESPONSE_BYTES = 1024 * 1024
class CrossrefError extends Error {}
const normalized = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const cleanText = (value: unknown, maximum: number) => typeof value === 'string' && value.trim() && value.length <= maximum && !/[\u0000-\u001f]/.test(value) ? value.trim() : undefined
function authorIdentity(value: string) {
  const name = value.replace(/\bet\s+al\.?/gi, '').trim()
  if (name.includes(',')) { const [family, ...given] = name.split(','); return { family: normalized(family), given: normalized(given.join(' ')).split(' ').filter(Boolean) } }
  const tokens = normalized(name).split(' ').filter(Boolean)
  return { family: tokens.at(-1) ?? '', given: tokens.slice(0, -1) }
}
function compareAuthor(localName: string, remoteNames: string[]): 'consistent' | 'uncertain' | 'conflict' {
  const local = authorIdentity(localName), sameFamily = remoteNames.map(authorIdentity).filter(remote => remote.family === local.family)
  if (!local.family || !sameFamily.length) return 'conflict'
  if (!local.given.length) return 'consistent'
  let incomplete = false
  for (const remote of sameFamily) {
    let contradicts = false, missing = false
    for (const [index, given] of local.given.entries()) {
      const other = remote.given[index]
      if (!other) { missing = true; continue }
      if (given.length === 1 || other.length === 1 ? given[0] !== other[0] : given !== other) contradicts = true
    }
    if (!contradicts && !missing) return 'consistent'
    if (!contradicts) incomplete = true
  }
  return incomplete ? 'uncertain' : 'conflict'
}

export function assessReferenceCandidate(record: PaperReference, metadata: Omit<ReferenceCandidate, 'assessment' | 'reasons'>): ReferenceCandidate {
  const reasons: string[] = [], fields = record.fields
  let conflict = false, uncertain = false
  const conflicting = (reason: string) => { conflict = true; reasons.push(reason) }
  const missing = (reason: string) => { uncertain = true; reasons.push(reason) }
  if (fields.doi && fields.doi !== metadata.doi) conflicting('DOI differs from the original citation.')
  if (!fields.title) missing('The original title could not be parsed reliably.')
  else if (normalized(fields.title) !== normalized(metadata.title)) conflicting('Title differs from the original citation.')
  if (fields.year !== undefined) {
    if (metadata.year === undefined) missing('Crossref did not provide a publication year.')
    else if (fields.year !== metadata.year) conflicting('Publication year differs from the original citation.')
  }
  if (fields.authors?.length) {
    if (!metadata.authors.length) missing('Crossref did not provide authors.')
    else {
      const local = fields.authors.filter(author => !/^et\s+al\.?$/i.test(author.trim()))
      const agreements = local.map(author => compareAuthor(author, metadata.authors))
      if (agreements.includes('conflict')) conflicting('Available author names or initials differ from the original citation.')
      else if (agreements.includes('uncertain')) missing('Crossref author names are incomplete for comparison.')
    }
  }
  if (!fields.year && !fields.authors?.length) missing('The original citation lacks author/year evidence for a safe match.')
  if (!reasons.length) reasons.push('Title and available author/year/DOI metadata agree; scientific claims are not checked.')
  return { ...metadata, assessment: conflict ? 'conflict' : uncertain ? 'uncertain' : 'consistent', reasons }
}
export function verificationStatus(candidates: ReferenceCandidate[]): ReferenceVerification['status'] {
  if (!candidates.length) return 'not-found'
  const matches = candidates.filter(candidate => candidate.assessment === 'consistent').length
  if (matches > 1 || candidates.some(candidate => candidate.assessment === 'uncertain')) return 'ambiguous'
  if (matches === 1) return 'matched'
  return 'conflict'
}
function metadata(value: unknown): Omit<ReferenceCandidate, 'assessment' | 'reasons'> {
  if (!object(value) || typeof value.DOI !== 'string' || !Array.isArray(value.title)) throw new CrossrefError('Crossref returned invalid metadata format.')
  const doi = normalizeDoi(value.DOI), title = cleanText(value.title[0], 2000)
  if (!doi || !title) throw new CrossrefError('Crossref returned invalid DOI or title metadata.')
  const authors: string[] = []
  if (value.author !== undefined) {
    if (!Array.isArray(value.author) || value.author.length > 5000) throw new CrossrefError('Crossref returned invalid author metadata.')
    for (const author of value.author.slice(0, 30)) {
      if (!object(author)) throw new CrossrefError('Crossref returned invalid author metadata.')
      const family = cleanText(author.family, 120), given = cleanText(author.given, 120), organization = cleanText(author.name, 200)
      const name = family ? [given, family].filter(Boolean).join(' ') : organization
      if (name && name.length <= 250) authors.push(name)
    }
  }
  let year: number | undefined
  for (const key of ['published', 'published-print', 'published-online', 'issued']) {
    const date = value[key]
    if (object(date) && Array.isArray(date['date-parts']) && Array.isArray(date['date-parts'][0])) {
      const candidate = date['date-parts'][0][0]
      if (Number.isInteger(candidate) && candidate >= 1000 && candidate <= 2200) { year = candidate; break }
    }
  }
  const venue = Array.isArray(value['container-title']) ? cleanText(value['container-title'][0], 500) : undefined
  return { doi, title, authors, ...(year === undefined ? {} : { year }), ...(venue ? { venue } : {}) }
}
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) { await response.body?.cancel().catch(() => undefined); throw new CrossrefError('Crossref response exceeds the 1 MB limit.') }
  if (!response.body) throw new CrossrefError('Crossref returned an empty response.')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  const aborted = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', aborted, { once: true })
  try {
    while (true) {
      if (signal.aborted) throw new CrossrefError('Reference verification cancelled.')
      const next = await reader.read()
      if (signal.aborted) throw new CrossrefError('Reference verification cancelled.')
      if (next.done) break
      length += next.value.byteLength
      if (length > MAX_RESPONSE_BYTES) { await reader.cancel().catch(() => undefined); throw new CrossrefError('Crossref response exceeds the 1 MB limit.') }
      chunks.push(next.value)
    }
  } finally { signal.removeEventListener('abort', aborted); reader.releaseLock() }
  const bytes = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new CrossrefError('Crossref returned an invalid JSON response.') }
}
export async function lookupReference(record: PaperReference, fetcher: typeof fetch, signal: AbortSignal): Promise<ReferenceVerification> {
  if (record.segmentation !== 'entry') throw new CrossrefError('Select an individual reference; this section has uncertain segmentation.')
  if (!record.rawText.trim() || record.rawText.length > 8000) throw new CrossrefError('Reference text exceeds the 8000 character lookup limit.')
  if (signal.aborted) throw new CrossrefError('Reference verification cancelled.')
  const timeout = AbortSignal.timeout(15_000), combined = AbortSignal.any([signal, timeout])
  const method = record.fields.doi ? 'doi' : 'bibliographic'
  const url = method === 'doi' ? `https://api.crossref.org/works/${encodeURIComponent(record.fields.doi!)}` : `https://api.crossref.org/works?${new URLSearchParams({ 'query.bibliographic': record.rawText, rows: '3' })}`
  try {
    const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', credentials: 'omit', signal: combined })
    if (combined.aborted) throw new CrossrefError('Reference verification cancelled.')
    if (response.status === 404) { await response.body?.cancel().catch(() => undefined); return { provider: 'crossref', checkedAt: new Date().toISOString(), method, status: 'not-found', candidates: [] } }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      if (response.status === 429) throw new CrossrefError('Crossref rate limit reached (HTTP 429). Wait before verifying again; no automatic retry was sent.')
      throw new CrossrefError(`Crossref lookup failed (HTTP ${response.status}). Try again later.`)
    }
    const value = await boundedJson(response, combined)
    if (!object(value) || value.status !== 'ok' || !object(value.message)) throw new CrossrefError('Crossref returned invalid response format.')
    if (method === 'bibliographic' && !Array.isArray(value.message.items)) throw new CrossrefError('Crossref returned invalid candidate format.')
    const items = method === 'doi' ? [value.message] : (value.message.items as unknown[]).slice(0, 3)
    const seen = new Set<string>(), candidates: ReferenceCandidate[] = []
    for (const item of items) {
      const candidate = assessReferenceCandidate(record, metadata(item))
      if (!seen.has(candidate.doi)) { seen.add(candidate.doi); candidates.push(candidate) }
    }
    if (combined.aborted) throw new CrossrefError('Reference verification cancelled.')
    return { provider: 'crossref', checkedAt: new Date().toISOString(), method, status: verificationStatus(candidates), candidates }
  } catch (error) {
    if (signal.aborted) throw new CrossrefError('Reference verification cancelled.')
    if (timeout.aborted) throw new CrossrefError('Crossref timed out after 15 seconds. Try again later.')
    if (error instanceof CrossrefError) throw error
    throw new CrossrefError('Cannot reach Crossref. Check your connection and try again; previous results are unchanged.')
  }
}

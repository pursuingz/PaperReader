export interface SearchDocument {
  numPages: number
  getPage(page: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string } | object> }>; cleanup?(): unknown }>
}
export interface PdfSearchResult {
  query: string
  matches: Array<{ page: number; snippet: string }>
  totalPages: number
  scannedPages: number
  blankPages: number[]
  failedPages: number[]
  complete: boolean
  limit?: 'pages' | 'characters'
}
/** Search-controller lifetime, not result-panel lifetime: each completion navigates once. */
export class SearchResultNavigation {
  private visited: PdfSearchResult | null = null
  takeInitialPage(result: PdfSearchResult | null): number | null {
    if (!result || result === this.visited) return null
    this.visited = result
    return result.matches[0]?.page ?? null
  }
  reset() { this.visited = null }
}
export const SEARCH_LIMITS = { maxPages: 2000, maxCharacters: 20_000_000 }
export const normalizeSearchQuery = (query: string) => query.replace(/\s+/g, ' ').trim()
const escapedPattern = (query: string) => query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** React-PDF consumes the result as HTML; both matching and surrounding text are escaped. */
export function highlightSearchText(text: string, query: string): string {
  const normalized = normalizeSearchQuery(query)
  if (!normalized) return escapeHtml(text)
  const pattern = new RegExp(escapedPattern(normalized).replace(/ /g, '\\s+'), 'giu')
  let html = '', offset = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index!
    html += escapeHtml(text.slice(offset, index)) + `<mark class="pdf-search-hit">${escapeHtml(match[0])}</mark>`
    offset = index + match[0].length
  }
  return html + escapeHtml(text.slice(offset))
}

export function parsePageInput(input: string, pageCount: number): number {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('The PDF page count is not ready.')
  const value = input.trim()
  const page = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(page) || page < 1 || page > pageCount) throw new Error(`Enter a whole page number from 1 to ${pageCount}.`)
  return page
}

export async function searchPdfText(document: SearchDocument, rawQuery: string, current: () => boolean, progress?: (page: number, total: number) => void, limits = SEARCH_LIMITS): Promise<PdfSearchResult> {
  const query = normalizeSearchQuery(rawQuery)
  if (!query) throw new Error('Enter text to search in this PDF.')
  if (query.length > 200) throw new Error('Search supports up to 200 characters.')
  const check = () => { if (!current()) throw new Error('PDF search cancelled.') }
  check()
  const result: PdfSearchResult = { query, matches: [], totalPages: document.numPages, scannedPages: 0, blankPages: [], failedPages: [], complete: true }
  let characters = 0
  const pattern = new RegExp(escapedPattern(query), 'iu')
  const lastPage = Math.min(document.numPages, limits.maxPages)
  for (let number = 1; number <= lastPage; number++) {
    check()
    let page: Awaited<ReturnType<SearchDocument['getPage']>> | undefined
    try {
      page = await document.getPage(number); check()
      const content = await page.getTextContent(); check()
      const fragments: string[] = []
      let pageCharacters = 0
      for (const item of content.items) {
        if (!('str' in item) || typeof item.str !== 'string') continue
        pageCharacters += item.str.length + 1
        if (characters + pageCharacters > limits.maxCharacters) break
        fragments.push(item.str)
      }
      if (characters + pageCharacters > limits.maxCharacters) { result.limit = 'characters'; break }
      characters += pageCharacters
      const text = normalizeSearchQuery(fragments.join(' '))
      result.scannedPages++
      if (!text) result.blankPages.push(number)
      const match = pattern.exec(text)
      if (match) {
        const start = Math.max(0, match.index - 65), end = Math.min(text.length, match.index + match[0].length + 100)
        result.matches.push({ page: number, snippet: `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}` })
      }
    } catch (error) {
      check()
      result.failedPages.push(number)
    } finally { page?.cleanup?.() }
    check(); progress?.(number, document.numPages)
  }
  if (!result.limit && document.numPages > limits.maxPages) result.limit = 'pages'
  result.complete = !result.limit && result.failedPages.length === 0
  check()
  return result
}

type SearchTask = { promise: Promise<SearchDocument>; destroy(): Promise<void> }
/** Owns an isolated extraction task, including byte-read and destruction races. */
export class LocalPdfSearch {
  private epoch = 0
  private active: { task: SearchTask | null; destroyed: boolean } | null = null
  constructor(private readPaper: (id: string) => Promise<Uint8Array>, private createTask: (bytes: Uint8Array) => SearchTask) {}
  private async destroy(job: { task: SearchTask | null; destroyed: boolean }) {
    if (!job.task || job.destroyed) return
    job.destroyed = true
    await job.task.destroy().catch(() => undefined)
  }
  async cancel() {
    ++this.epoch
    const job = this.active; this.active = null
    if (job) await this.destroy(job)
  }
  async run(paperId: string, query: string, progress?: (page: number, total: number) => void): Promise<PdfSearchResult> {
    if (this.active) throw new Error('PDF search is already running.')
    const epoch = ++this.epoch, job = { task: null as SearchTask | null, destroyed: false }
    this.active = job
    const current = () => this.epoch === epoch && this.active === job
    const check = () => { if (!current()) throw new Error('PDF search cancelled.') }
    try {
      const bytes = await this.readPaper(paperId); check()
      job.task = this.createTask(new Uint8Array(bytes))
      const document = await job.task.promise; check()
      return await searchPdfText(document, query, current, progress)
    } finally {
      if (this.active === job) this.active = null
      await this.destroy(job)
    }
  }
}

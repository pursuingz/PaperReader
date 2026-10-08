import type { PaperSourceEntry, PaperSourceIndex } from '../../shared/types'

export interface SourceLine { text: string; page: number; x: number; y: number; height: number }
export interface SourceDocument {
  numPages: number
  getPage(page: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup?(): unknown }>
}
export const SOURCE_INDEX_LIMITS = { maxPages: 200, maxCharacters: 240000 }
const clean = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

/** Rebuild local text lines from baseline geometry rather than joining an entire page. */
export function positionedTextLines(items: unknown[], page: number): SourceLine[] {
  const fragments: Array<SourceLine & { width: number }> = []
  for (const [index, value] of items.entries()) {
    if (!value || typeof value !== 'object' || !('str' in value) || typeof value.str !== 'string' || !clean(value.str).trim()) continue
    const item = value as { str: string; transform?: number[]; width?: number; height?: number }
    const matrix = item.transform
    const positioned = Array.isArray(matrix) && matrix.length >= 6 && matrix.every(Number.isFinite)
    const height = typeof item.height === 'number' && Number.isFinite(item.height) && item.height > 0 ? item.height : positioned ? Math.max(1, Math.hypot(matrix![2], matrix![3])) : 12
    fragments.push({ text: clean(item.str), page, x: positioned ? matrix![4] : 0, y: positioned ? matrix![5] : -index * 16, height, width: typeof item.width === 'number' && Number.isFinite(item.width) && item.width >= 0 ? item.width : item.str.length * height / 2 })
  }
  fragments.sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: typeof fragments[] = []
  for (const part of fragments) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(row[0].y - part.y) <= Math.max(2, Math.min(row[0].height, part.height) * .35)) row.push(part)
    else rows.push([part])
  }
  // A short line exposes a column's gutter even when a longer line above nearly fills it.
  // Count starts by row before merging, so stable right-column text cannot become a caption suffix.
  const startsByRow = new Map<number, number>(), wideGutters = new Set<number>()
  const bucket = (x: number) => Math.round(x / 6)
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x)
    const seen = new Set<number>()
    for (let index = 0; index < row.length; index++) {
      const part = row[index], key = bucket(part.x)
      seen.add(key)
      if (index > 0 && part.x - row[0].x > 160 && part.x - (row[index - 1].x + row[index - 1].width) > Math.max(40, part.height * 3)) wideGutters.add(key)
    }
    for (const key of seen) startsByRow.set(key, (startsByRow.get(key) ?? 0) + 1)
  }
  const stableColumnStarts = new Set([...wideGutters].filter(key => (startsByRow.get(key) ?? 0) >= 2))
  const lines: SourceLine[] = []
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x)
    let current: SourceLine | null = null, right = 0
    for (const part of row) {
      const gap = part.x - right
      if (!current || gap > Math.max(40, part.height * 3) || stableColumnStarts.has(bucket(part.x)) && part.x - current.x > 160) { current = { text: part.text, page, x: part.x, y: part.y, height: part.height }; lines.push(current) }
      else {
        const separator = gap > Math.max(.5, part.height * .12) && !/\s$/.test(current.text) && !/^\s|^[,.;:!?，。；：！？)]/.test(part.text) ? ' ' : ''
        current.text += separator + part.text
      }
      right = Math.max(right, part.x + part.width)
    }
  }
  for (const line of lines) line.text = line.text.trim()
  // A wide inter-column gap creates separate reading columns. Layout-dependent candidates remain labelled as such.
  const starts = [...new Set(lines.map(value => value.x))].sort((a, b) => a - b), columns: number[] = []
  for (const start of starts) if (!columns.length || start - columns[columns.length - 1] > 160) columns.push(start)
  const column = (x: number) => { let index = columns.length - 1; while (index > 0 && columns[index] > x) index--; return index }
  return lines.sort((a, b) => column(a.x) - column(b.x) || b.y - a.y || a.x - b.x)
}

const referenceHeading = (text: string) => /^(?:\d+[.\s]+)?(?:references|bibliography|literature cited|参考文献)\s*[:：]?$/i.test(text.trim())
const endingHeading = (text: string) => /^(?:(?:\d+(?:\.\d+)*\.?\s+)?(?:appendix(?:\s+[A-Z\d]+)?|appendices|supplementary (?:material|information)|acknowledg(?:e)?ments?|author contributions?|supporting information)|附录(?:\s*\w+)?|致谢)\s*[:：]?$/i.test(text.trim())
const sectionHeading = (text: string) => /^(?:\d+(?:\.\d+)*\.?\s+)?(?:introduction|background|methods?|results?|discussion|conclusions?|limitations?)\s*[:：]?$/i.test(text.trim()) || endingHeading(text)
function caption(text: string): { kind: 'figure' | 'table'; label: string } | null {
  const english = /^(Figure|Fig\.?|Table)\s+(S?\d+(?:[.-]\d+)*|[IVX]+)(?=$|[\s.:：)\-])/i.exec(text)
  if (english) {
    const rest = text.slice(english[0].length)
    if (/^\s+(?:shows?|illustrates?|is|are|was|were|presents?|demonstrates?|depicts?|summarizes?|compares?|provides?|describes?|contains?|reports?|can|has|have)\b/i.test(rest)) return null
    return { kind: /^table$/i.test(english[1]) ? 'table' : 'figure', label: english[0] }
  }
  const chinese = /^([图表])\s*(?:[A-Z]?\d+(?:[.-]\d+)*|[一二三四五六七八九十百零〇]+)(?=$|[\s.:：、)\-\u4e00-\u9fff])/.exec(text)
  if (chinese && /^\s*(?:所示|显示|表明|展示|说明|比较|给出)/.test(text.slice(chinese[0].length))) return null
  return chinese ? { kind: chinese[1] === '图' ? 'figure' : 'table', label: chinese[0] } : null
}
const referenceNumber = (text: string) => { const found = /^(?:\[(\d{1,4})\]|(\d{1,4})[.)])\s*\S/.exec(text); return found ? Number(found[1] ?? found[2]) : null }
function boundedSlice(text: string, length: number) { const end = /[\uD800-\uDBFF]/.test(text[length - 1] ?? '') ? length - 1 : length; return text.slice(0, Math.max(0, end)) }

export function buildSourceEntries(lines: SourceLine[]): { entries: PaperSourceEntry[]; limitReached: boolean } {
  const entries: PaperSourceEntry[] = []
  let limitReached = false, characters = 0
  function emit(kind: PaperSourceEntry['kind'], label: string, source: SourceLine[]) {
    if (entries.length >= 1000 || characters >= 240000) { limitReached = true; return }
    const allowed = Math.min(16000, 240000 - characters)
    let text = '', pages: number[] = []
    for (const line of source) {
      const next = (text ? '\n' : '') + line.text
      if (text.length + next.length > allowed) {
        const fragment = boundedSlice(next, allowed - text.length)
        if (fragment.trim()) { text += fragment; pages.push(line.page) }
        limitReached = true; break
      }
      text += next; pages.push(line.page)
    }
    if (!text.trim()) return
    characters += text.length
    entries.push({ id: `source-${entries.length + 1}`, kind, label: label.slice(0, 160), text, pages: [...new Set(pages)].sort((a, b) => a - b) })
  }
  function references(source: SourceLine[]) {
    const content = source.filter(value => !referenceHeading(value.text))
    if (!content.length) return
    let previous = 0, reliable = referenceNumber(content[0].text) !== null
    for (const line of content) {
      const number = referenceNumber(line.text)
      if (number !== null) { if (previous && number !== previous + 1) reliable = false; previous = number }
    }
    if (!reliable) { emit('reference-section', 'Reference section · original text', source); return }
    let current: SourceLine[] = [], number = 0
    for (const line of content) {
      const next = referenceNumber(line.text)
      if (next !== null) { if (current.length) emit('reference', `[${number}]`, current); current = []; number = next }
      current.push(line)
    }
    if (current.length) emit('reference', `[${number}]`, current)
  }
  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    if (referenceHeading(line.text)) {
      const source = [line]; index++
      while (index < lines.length && !endingHeading(lines[index].text)) source.push(lines[index++])
      references(source); continue
    }
    const candidate = caption(line.text)
    if (!candidate) { index++; continue }
    const source = [line]; index++
    while (index < lines.length) {
      const next = lines[index], previous = source[source.length - 1]
      if (next.page !== line.page || caption(next.text) || referenceHeading(next.text) || sectionHeading(next.text) || Math.abs(next.x - line.x) > Math.max(24, line.height * 3) || previous.y - next.y > Math.max(24, line.height * 2.2) || next.y > previous.y + line.height) break
      source.push(next); index++
    }
    emit(candidate.kind, candidate.label, source)
  }
  return { entries, limitReached }
}

export async function extractSourceIndex(document: SourceDocument, paperId: string, current: () => boolean, progress?: (page: number, total: number) => void, limits = SOURCE_INDEX_LIMITS): Promise<PaperSourceIndex> {
  if (!Number.isSafeInteger(document.numPages) || document.numPages < 1 || document.numPages > 100000) throw new Error('Invalid source PDF page count.')
  const check = () => { if (!current()) throw new Error('Source indexing cancelled.') }
  const result: PaperSourceIndex = { paperId, extractorVersion: 1, createdAt: new Date().toISOString(), pageCount: document.numPages, indexedPages: [], textlessPages: [], failedPages: [], limitReached: document.numPages > limits.maxPages, entries: [] }
  const lines: SourceLine[] = []
  let characters = 0
  for (let number = 1; number <= Math.min(document.numPages, limits.maxPages); number++) {
    check()
    let page: Awaited<ReturnType<SourceDocument['getPage']>> | undefined
    try {
      page = await document.getPage(number); check()
      const content = await page.getTextContent(); check()
      let length = 0
      for (const item of content.items) {
        if (item && typeof item === 'object' && 'str' in item && typeof item.str === 'string') length += item.str.length + 1
        if (characters + length > limits.maxCharacters) break
      }
      if (characters + length > limits.maxCharacters) { result.limitReached = true; break }
      characters += length
      const extracted = positionedTextLines(content.items, number)
      if (extracted.length) { result.indexedPages.push(number); lines.push(...extracted) }
      else result.textlessPages.push(number)
    } catch { check(); result.failedPages.push(number) }
    finally { try { page?.cleanup?.() } catch { /* Extraction evidence remains valid if a PDF resource is already released. */ } }
    check(); progress?.(number, document.numPages)
  }
  check()
  const candidates = buildSourceEntries(lines)
  result.entries = candidates.entries; result.limitReached ||= candidates.limitReached
  return result
}

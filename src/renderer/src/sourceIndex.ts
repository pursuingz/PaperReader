import type { PaperSourceEntry, PaperSourceIndex } from '../../shared/types'
import { canonicalEvidenceKey, compatibleCaption } from '../../shared/evidenceIdentity'

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
  for (const row of rows) for (const part of row) if (caption(part.text) && part.x - row[0].x > 80) stableColumnStarts.add(bucket(part.x))
  const lines: SourceLine[] = []
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x)
    let current: SourceLine | null = null, right = 0
    for (const part of row) {
      const gap = part.x - right
      if (!current || gap > Math.max(40, part.height * 3) || stableColumnStarts.has(bucket(part.x)) && part.x - current.x > 80) { current = { text: part.text, page, x: part.x, y: part.y, height: part.height }; lines.push(current) }
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
  for (const start of starts) if (!columns.length || start - columns[columns.length - 1] > 140) columns.push(start)
  const column = (x: number) => { let index = columns.length - 1; while (index > 0 && columns[index] > x) index--; return index }
  return lines.sort((a, b) => column(a.x) - column(b.x) || b.y - a.y || a.x - b.x)
}

const referenceHeading = (text: string) => /^(?:\d+[.\s]+)?(?:references|bibliography|literature cited|参考文献)\s*[:：]?$/i.test(text.trim())
const endingHeading = (text: string) => /^(?:[-–—]\s*)?supplementary(?:\s+(?:material|information))?(?:\s*[-–—])?$/i.test(text.trim()) || /^(?:(?:\d+(?:\.\d+)*\.?\s+)?(?:appendix(?:\s+[A-Z\d]+)?|appendices|supplementary (?:material|information)|acknowledg(?:e)?ments?|author contributions?|supporting information)|附录(?:\s*\w+)?|致谢)\s*[:：]?$/i.test(text.trim())
const alphabeticHeading = (text:string)=>/^(?:[A-Z](?:\.\d+)*\.?\s+)[A-Z][^.!?]{2,100}$/.test(text.trim())
const sectionHeading = (text: string) => /^(?:\d+(?:\.\d+)*\.?\s+)?(?:introduction|background|methods?|results?|discussion|conclusions?|limitations?)\s*[:：]?$/i.test(text.trim()) || endingHeading(text)
function caption(text: string): { kind: 'figure' | 'table'; label: string } | null {
  const english = /^(Figure|Fig\.?|Table)\s+(S?\d+(?:[.-]\d+)*|[IVX]+)(?=$|[\s.:：)\-])/i.exec(text)
  if (english) {
    const rest = text.slice(english[0].length)
    if (/^\s*(?:\([a-z]\)\s*)?(?:shows?|illustrates?|is|are|was|were|presents?|demonstrates?|depicts?|summarizes?|compares?|provides?|describes?|contains?|reports?|can|has|have)\b/i.test(rest)) return null
    return { kind: /^table$/i.test(english[1]) ? 'table' : 'figure', label: english[0] }
  }
  const chinese = /^([图表])\s*(?:[A-Z]?\d+(?:[.-]\d+)*|[一二三四五六七八九十百零〇]+)(?=$|[\s.:：、)\-\u4e00-\u9fff])/.exec(text)
  if (chinese && /^\s*(?:所示|显示|表明|展示|说明|比较|给出)/.test(text.slice(chinese[0].length))) return null
  return chinese ? { kind: chinese[1] === '图' ? 'figure' : 'table', label: chinese[0] } : null
}
const referenceNumber = (text: string) => { const found = /^(?:\[(\d{1,4})\]\s*|(\d{1,4})[.)]\s+)\S/.exec(text); return found ? Number(found[1] ?? found[2]) : null }
const referenceStyle = (text: string) => /^\[\d+\]/.test(text) ? 'bracket' : /^\d+[.)]\s+/.test(text) ? 'plain' : null
function boundedSlice(text: string, length: number) { const end = /[\uD800-\uDBFF]/.test(text[length - 1] ?? '') ? length - 1 : length; return text.slice(0, Math.max(0, end)) }

export function buildSourceEntries(input: SourceLine[]): { entries: PaperSourceEntry[]; limitReached: boolean; issues: NonNullable<PaperSourceIndex['issues']> } {
  const lines = input.filter(line => !(line.text.trim() === String(line.page) && line.y < line.height * 6 && line.x > 150 && !input.some(other=>other!==line&&other.page===line.page&&Math.abs(other.y-line.y)<line.height*2)))
  const issues: NonNullable<PaperSourceIndex['issues']> = []
  const entries: PaperSourceEntry[] = []
  const captionPages = new Set(lines.filter(line => caption(line.text)).map(line => line.page))
  let limitReached = false, characters = 0
  function emit(kind: PaperSourceEntry['kind'], label: string, source: SourceLine[]) {
    if (entries.length >= 1000 || characters >= 240000) { limitReached = true; const kind=entries.length>=1000?'candidate-limit':'character-limit'; if(!issues.some(i=>i.kind===kind))issues.push({kind}); return }
    const allowed = Math.min(16000, 240000 - characters)
    let text = '', pages: number[] = []
    for (const line of source) {
      const next = (text ? '\n' : '') + line.text
      if (text.length + next.length > allowed) {
        const fragment = boundedSlice(next, allowed - text.length)
        if (fragment.trim()) { text += fragment; pages.push(line.page) }
        issues.push({kind:'entry-truncated',entryId:`source-${entries.length+1}`}); if(allowed===240000-characters){limitReached=true;if(!issues.some(issue=>issue.kind==='character-limit'))issues.push({kind:'character-limit'})} break
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
    const first = referenceNumber(content[0].text), style = referenceStyle(content[0].text)
    if (first === null) { emit('reference-section', 'Reference section · original text', source); return }
    let current: SourceLine[] = [], number = 0, reliable = true, previous = first - 1
    const flush=()=>{if(current.length)emit(reliable?'reference':'reference-section',reliable?`[${number}]`:'Reference fragment · original text',current)}
    for (const line of content) {
      const next = referenceNumber(line.text)
      if (next !== null && referenceStyle(line.text) === style) {
        flush(); reliable = next === previous + 1; current=[]; number=next; previous=next
      }
      current.push(line)
    }
    flush()
  }
  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    if (referenceHeading(line.text)) {
      const source = [line], upperReferenceColumns: number[] = [], referenceHeights: number[] = []; index++
      while (index < lines.length) {
        const next = lines[index], number = referenceNumber(next.text)
        // Column reading order can place earlier table cells after the heading.
        // Keep explicit citations in a continuing right column, including their indent.
        if (next.page === line.page && next.y > line.y + line.height * .5) {
          if (number !== null) upperReferenceColumns.push(next.x)
          else if (!upperReferenceColumns.some(x => Math.abs(next.x - x) <= Math.max(40, next.height * 4))) { index++; continue }
        }
        // Captions are always a new source record, even after an unfamiliar appendix title.
        if (endingHeading(next.text) || caption(next.text)) break
        if (number !== null && source.some(v=>referenceNumber(v.text)!==null) && referenceStyle(next.text) !== referenceStyle(source.find(v=>referenceNumber(v.text)!==null)!.text)) break
        const heights = [...referenceHeights].sort((a, b) => a - b)
        const bodyHeight = heights[Math.floor(heights.length / 2)]
        // Typography is corroborated by a following caption, rather than a brittle title list.
        // Unnumbered bibliographies remain intact when this boundary cannot be established.
        const previousLine=source.at(-1)!
        const alphabeticSection=alphabeticHeading(next.text)&&bodyHeight&&(next.page>previousLine.page||previousLine.y-next.y>bodyHeight*2.2)
        const distinctVisualHeading = (captionPages.has(next.page)||alphabeticSection) && referenceHeights.length > 0
          && bodyHeight && next.height >= bodyHeight * 1.15 && number === null && !referenceHeading(next.text)
          && next.text.length <= 100 && next.text.trim().split(/\s+/).length <= 12
          && /^[A-Za-z\u3400-\u9fff]/.test(next.text.trim()) && !/[.!?;,，。；：]$/.test(next.text.trim())
        if (distinctVisualHeading) break
        if (number !== null && referenceHeights.length < 64 && Number.isFinite(next.height) && next.height > 0) referenceHeights.push(next.height)
        source.push(next); index++
      }
      references(source); continue
    }
    const candidate = caption(line.text)
    const dottedMention=candidate && /^\.\s+[A-Z][a-z]+ing\b/.test(line.text.slice(candidate.label.length)) && lines.some(other=>other!==line&&caption(other.text)&&canonicalEvidenceKey(caption(other.text)!.label)===canonicalEvidenceKey(candidate.label)&&/^\s*[:：]/.test(other.text.slice(caption(other.text)!.label.length)))
    if (!candidate || dottedMention) { index++; continue }
    const source = [line]; index++
    while (index < lines.length) {
      const next = lines[index], previous = source[source.length - 1]
      if (next.page !== line.page || caption(next.text) || referenceHeading(next.text) || sectionHeading(next.text) || Math.abs(next.x - line.x) > Math.max(24, line.height * 3) || next.height > line.height * 1.12 || previous.y - next.y > Math.max(15, line.height * 1.65) || next.y > previous.y + line.height) break
      source.push(next); index++
    }
    emit(candidate.kind, candidate.label, source)
  }
  return { entries, limitReached, issues }
}

export async function extractSourceIndex(document: SourceDocument, paperId: string, current: () => boolean, progress?: (page: number, total: number) => void, limits = SOURCE_INDEX_LIMITS): Promise<PaperSourceIndex> {
  if (!Number.isSafeInteger(document.numPages) || document.numPages < 1 || document.numPages > 100000) throw new Error('Invalid source PDF page count.')
  const check = () => { if (!current()) throw new Error('Source indexing cancelled.') }
  const result: PaperSourceIndex = { paperId, extractorVersion: 2, createdAt: new Date().toISOString(), pageCount: document.numPages, indexedPages: [], textlessPages: [], failedPages: [], limitReached: document.numPages > limits.maxPages, entries: [], issues: document.numPages > limits.maxPages ? [{kind:'page-limit'}] : [] }
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
      if (characters + length > limits.maxCharacters) { result.limitReached = true; result.issues!.push({kind:'character-limit'}); break }
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
  result.entries = candidates.entries; result.limitReached ||= candidates.limitReached; result.issues!.push(...candidates.issues)
  return result
}

export function reconcileSourceEntries(index: PaperSourceIndex, previous?: PaperSourceIndex): PaperSourceIndex {
 if(!previous||previous.paperId!==index.paperId)return index
 const identity=(entry:PaperSourceEntry)=>JSON.stringify([entry.kind,entry.pages,entry.kind==='figure'||entry.kind==='table'?canonicalEvidenceKey(entry.label,entry.kind):[entry.label,entry.text]])
 const oldGroups=new Map<string,PaperSourceEntry[]>(),newGroups=new Map<string,PaperSourceEntry[]>()
 for(const [entries,groups] of [[previous.entries,oldGroups],[index.entries,newGroups]] as const)for(const entry of entries){const key=identity(entry);groups.set(key,[...(groups.get(key)??[]),entry])}
 const matched=new Map<PaperSourceEntry,string>(),used=new Set<string>()
 for(const entry of index.entries){const key=identity(entry),old=(oldGroups.get(key)??[]).filter(candidate=>entry.kind==='figure'||entry.kind==='table'?compatibleCaption(candidate.text,entry.text):candidate.text===entry.text)
  if(old.length===1&&(newGroups.get(key)??[]).filter(candidate=>candidate.kind==='figure'||candidate.kind==='table'?compatibleCaption(candidate.text,old[0].text):candidate.text===old[0].text).length===1){matched.set(entry,old[0].id);used.add(old[0].id)}}
 const reserved=new Set([...previous.entries.map(e=>e.id),...used]),remap=new Map<string,string>();let sequence=1
 const entries=index.entries.map(entry=>{let id=matched.get(entry);if(!id){while(reserved.has(`source-${sequence}`))sequence++;id=`source-${sequence++}`;reserved.add(id)}remap.set(entry.id,id);return{...entry,id}})
 return{...index,entries,...(index.issues?{issues:index.issues.map(issue=>issue.entryId?{...issue,entryId:remap.get(issue.entryId)??issue.entryId}:issue)}:{})}
}

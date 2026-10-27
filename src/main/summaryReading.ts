import type { PdfTextPage } from '../shared/types'

export const SUMMARY_DIRECT_CHARACTERS = 24000
export const SUMMARY_CHUNK_CHARACTERS = 24000
const OVERLAP_CHARACTERS = 600
export interface SummaryReadingPart { page: number; text: string; start: number; end: number }
export interface SummaryReadingChunk { index: number; parts: SummaryReadingPart[] }

function safeEnd(text: string, end: number): number {
  return end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end]) ? end - 1 : end
}
function safeStart(text: string, start: number): number {
  return start > 0 && start < text.length && /[\uD800-\uDBFF]/.test(text[start - 1]) && /[\uDC00-\uDFFF]/.test(text[start]) ? start + 1 : start
}
function chunkEnd(text: string, start: number): number {
  const maximum = Math.min(text.length, start + SUMMARY_CHUNK_CHARACTERS)
  if (maximum === text.length) return maximum
  const lower = start + Math.floor(SUMMARY_CHUNK_CHARACTERS * 0.65)
  const window = text.slice(lower - 1, maximum)
  const heading = /^(?:#{1,6}\s+)?(?:\d+(?:\.\d+)*[.)]?\s+[^\r\n]{1,140}|(?:abstract|introduction|background|methods?|results?|discussion|conclusions?|limitations?|references|摘要|引言|背景|方法|结果|讨论|结论|局限性)\s*[:：]?)\r?$/gim
  let boundary = 0
  for (const match of window.matchAll(heading)) boundary = lower - 1 + match.index
  if (boundary >= lower) return safeEnd(text, boundary)
  for (const match of window.matchAll(/\r?\n(?:[ \t]*\r?\n)+/g)) boundary = lower - 1 + match.index + match[0].length
  return safeEnd(text, boundary >= lower ? boundary : maximum)
}

export function buildSummaryReadingChunks(pages: readonly PdfTextPage[]): SummaryReadingChunk[] {
  const text = pages.map(page => page.text).join('')
  const ranges = pages.map(page => ({ page: page.page, text: page.text, start: 0, end: 0 }))
  let offset = 0
  for (const range of ranges) { range.start = offset; offset += range.text.length; range.end = offset }
  const chunks: SummaryReadingChunk[] = []
  let start = 0
  while (start < text.length) {
    const end = chunkEnd(text, start)
    const parts = ranges.filter(range => range.end > start && range.start < end).map(range => {
      const from = Math.max(0, start - range.start), to = Math.min(range.text.length, end - range.start)
      return { page: range.page, text: range.text.slice(from, to), start: from, end: to }
    })
    chunks.push({ index: chunks.length, parts })
    if (end === text.length) break
    start = safeStart(text, Math.max(start + 1, end - OVERLAP_CHARACTERS))
  }
  return chunks
}

type AnchorKind = 'abstract' | 'introduction' | 'contribution' | 'conclusion' | 'result' | 'caption'
interface AnchorRange { page: number; start: number; end: number; kind: AnchorKind }
const anchorKinds: AnchorKind[] = ['abstract', 'introduction', 'contribution', 'conclusion', 'result', 'caption']
function paperHeading(line: string): string {
  return line.trim().replace(/^#{1,6}\s+/, '').replace(/^(?:\d+(?:\.\d+)*[.)、．]?|[IVXLC]+[.)]|[一二三四五六七八九十]+[、.)．])\s*/i, '').replace(/^\*\*(.*?)\*\*$/, '$1').trim()
}
function anchorKind(line: string): AnchorKind | undefined {
  const heading = paperHeading(line)
  if (/^(?:abstract|摘要)(?:\s*[:：].*)?$/i.test(heading)) return 'abstract'
  if (/^(?:introduction|引言|绪论)(?:\s*(?:and|与).{0,60})?\s*[:：]?$/i.test(heading)) return 'introduction'
  if (/(?:our|main|key) contributions?|contributions? (?:are|include)|主要贡献|本文.{0,8}贡献|我们的贡献|贡献如下/i.test(heading)) return 'contribution'
  if (/^(?:conclusions?|concluding remarks|总结|结论)(?:\s*(?:and|与).{0,60})?\s*[:：]?$/i.test(heading)) return 'conclusion'
  if (/^(?:(?:experimental|empirical|evaluation|theoretical|main)\s+)?(?:results?|experiments? and results?|evaluation|实验结果|主要结果|结果|实验与结果)(?:\s*(?:and|与).{0,60})?\s*[:：]?$/i.test(heading)) return 'result'
  if (/^(?:(?:fig(?:ure)?s?\.?|tables?)\s*[A-Z]?\d+|[图表]\s*\d+)/i.test(heading)) return 'caption'
}
function isSectionLine(line: string): boolean {
  if (line.trim().length > 180) return false
  return Boolean(anchorKind(line)) || /^(?:\s*#{1,6}\s+|\s*\d+(?:\.\d+)*[.)]?\s+\S)/.test(line) || /^(?:methods?|materials? and methods?|discussion|limitations?|references|bibliography|appendix|方法|讨论|局限性|参考文献|附录)\s*[:：]?$/i.test(paperHeading(line))
}

export function selectSummaryAnchors(pages: readonly PdfTextPage[], maxCharacters = SUMMARY_DIRECT_CHARACTERS): PdfTextPage[] {
  if (!Number.isFinite(maxCharacters)) throw new Error('Invalid Summary anchor character limit')
  const budget = Math.min(SUMMARY_DIRECT_CHARACTERS, Math.max(0, Math.floor(maxCharacters)))
  if (!budget) return []
  const byPage = new Map(pages.map(page => [page.page, page.text]))
  const candidates: AnchorRange[] = []
  for (const page of pages) {
    const lines: Array<{ text: string; start: number }> = []
    for (const match of page.text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
      if (!match[0]) break
      lines.push({ text: match[0].replace(/[\r\n]+$/, ''), start: match.index })
    }
    const nextSections: number[] = []
    let nextSection = page.text.length
    for (let index = lines.length - 1; index >= 0; index--) {
      nextSections[index] = nextSection
      if (isSectionLine(lines[index].text)) nextSection = lines[index].start
    }
    for (const [index, line] of lines.entries()) {
      const kind = anchorKind(line.text)
      if (!kind) continue
      const end = Math.min(nextSections[index], line.start + (kind === 'caption' ? 1800 : 6000))
      if (end > line.start) candidates.push({ page: page.page, start: line.start, end: safeEnd(page.text, end), kind })
    }
  }
  if (!candidates.length) {
    const nonempty = pages.filter(page => page.text.length)
    for (const page of [nonempty[0], nonempty.at(-1)]) if (page) candidates.push({ page: page.page, start: 0, end: safeEnd(page.text, Math.min(page.text.length, 6000)), kind: 'abstract' })
  }
  const primary = anchorKinds.flatMap(kind => candidates.find(candidate => candidate.kind === kind) ?? [])
  const ordered = [...primary, ...candidates.filter(candidate => !primary.includes(candidate))]
  const selected: AnchorRange[] = []
  let used = 0
  function add(candidate: AnchorRange, allowance: number): void {
    const source = byPage.get(candidate.page)!
    let ranges = [{ start: candidate.start, end: candidate.end }]
    for (const existing of selected.filter(item => item.page === candidate.page)) ranges = ranges.flatMap(range => {
      if (existing.end <= range.start || existing.start >= range.end) return [range]
      return [{ start: range.start, end: Math.min(existing.start, range.end) }, { start: Math.max(existing.end, range.start), end: range.end }].filter(item => item.end > item.start)
    })
    for (const range of ranges) {
      const end = safeEnd(source, Math.min(range.end, range.start + allowance, range.start + budget - used))
      if (end <= range.start) continue
      selected.push({ ...candidate, start: range.start, end })
      used += end - range.start; allowance -= end - range.start
      if (!allowance || used >= budget) break
    }
  }
  primary.forEach((candidate, index) => add(candidate, Math.floor((budget - used) / (primary.length - index))))
  for (const candidate of ordered) { if (used >= budget) break; add(candidate, budget - used) }
  const merged: AnchorRange[] = []
  for (const range of selected.sort((a, b) => a.page - b.page || a.start - b.start)) {
    const previous = merged.at(-1)
    if (previous && previous.page === range.page && previous.end >= range.start) previous.end = Math.max(previous.end, range.end)
    else merged.push({ ...range })
  }
  return merged.map(range => ({ page: range.page, text: byPage.get(range.page)!.slice(range.start, range.end) }))
}


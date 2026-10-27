import type { SummaryLanguage, SummarySection } from '../shared/types'

export interface ParsedSummaryMarkdown { sections: SummarySection[]; missing: string[]; warnings: string[]; complete: boolean }
export const SUMMARY_MARKDOWN_SECTION_IDS = ['keywords', 'overview', 'background', 'methods', 'results', 'limitations'] as const
const titles = {
  en: ['Keywords', 'Overview', 'Background', 'Methods', 'Results', 'Limitations'],
  zh: ['关键词', '概览', '背景', '方法', '结果', '局限']
} as const
const aliases = [
  ['keywords', 'key words', 'key terms', '关键词', '关键字'],
  ['overview', 'summary', 'abstract', 'research overview', 'paper overview', 'overview and contributions', '概览', '概述', '摘要', '研究概览', '研究概述', '论文概述', '研究主线'],
  ['background', 'background and motivation', 'research background', 'problem and motivation', 'problem and background', 'motivation', 'introduction', '背景', '研究背景', '背景与动机', '研究问题与背景', '问题与动机', '问题背景'],
  ['methods', 'method', 'methodology', 'approach', 'proposed method', 'method and mechanism', 'methods and mechanism', '方法', '研究方法', '方法与机制', '方法机制', '技术路线'],
  ['results', 'result', 'main results', 'results and discussion', 'findings', 'key findings', 'experiments and results', 'evaluation', '理论结果', '结果', '主要结果', '实验结果', '结果与讨论', '主要发现'],
  ['limitations', 'limitation', 'limitations and future work', 'limitations and outlook', 'limitations and discussion', 'boundaries and limitations', '局限', '局限性', '研究局限', '局限与展望', '局限性与未来工作', '局限与未来工作', '局限性与展望']
]
const normalized = (value: string) => value.toLowerCase().replace(/[\s:：,，.。;；&／/()（）\-–—]+/g, '')
const aliasMap = new Map(aliases.flatMap((names, index) => names.map(name => [normalized(name), SUMMARY_MARKDOWN_SECTION_IDS[index]] as const)))
type SectionId = typeof SUMMARY_MARKDOWN_SECTION_IDS[number]
interface Heading { id: SectionId; body: string }
function identifyHeading(value: string): Heading | null {
  if (/^\s*(?:[-+*]\s+|[>|])/.test(value)) return null
  let text = value.trim().replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').trim()
  text = text.replace(/^(?:\(\d+\)|（[一二三四五六七八九十\d]+）|(?:\d+(?:\.\d+)*|[IVXLC]+|[一二三四五六七八九十]+)[.)、．:：]?)\s+/i, '')
  const bold = text.match(/^(\*\*|__)(.+?)\1\s*(.*)$/)
  let body = ''
  if (bold) { text = bold[2]; body = bold[3].replace(/^\s*[:：]\s*/, '') }
  text = text.replace(/^(?:\(\d+\)|（[一二三四五六七八九十\d]+）|(?:\d+(?:\.\d+)*|[IVXLC]+|[一二三四五六七八九十]+)[.)、．:：])\s*/i, '').replace(/^\d+(?:\.\d+)*\s+/, '')
  const direct = aliasMap.get(normalized(text))
  if (direct) return { id: direct, body }
  const bilingual = text.split(/\s*[/|（()）]\s*/).filter(Boolean).map(part => aliasMap.get(normalized(part)))
  if (bilingual.length > 1 && bilingual.every(id => id && id === bilingual[0])) return { id: bilingual[0]!, body }
  const inline = text.match(/^(.{1,80}?)\s*[:：]\s*(.+)$/)
  const id = inline && aliasMap.get(normalized(inline[1]))
  return id ? { id, body: [inline![2], body].filter(Boolean).join(' ') } : null
}
function unwrap(markdown: string): string {
  const trimmed = markdown.trim()
  const first = trimmed.match(/^(`{3,}|~{3,})(?:markdown|md|text)?[ \t]*\r?\n/i)
  if (!first) return markdown
  const lines = trimmed.split(/\r?\n/)
  const closing = lines.findIndex((line, index) => {
    const marker = line.trim()
    return index > 0 && marker.length >= first[1].length && [...marker].every(character => character === first[1][0])
  })
  if (closing === lines.length - 1) return lines.slice(1, -1).join('\n')
  return markdown
}
function displayMathEnd(line: string): string | null {
  const text = line.trim()
  if (text.startsWith('$$') && !text.slice(2).includes('$$')) return '$$'
  if (text.startsWith('\\[') && !text.slice(2).includes('\\]')) return '\\]'
  return null
}
function outsideCode(markdown: string): string {
  let fence: { character: string; length: number } | null = null, mathEnd: string | null = null
  return markdown.split(/\r?\n/).map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null
      return ''
    }
    if (mathEnd) { if (line.includes(mathEnd)) mathEnd = null; return '' }
    if (marker) { fence = { character: marker[1][0], length: marker[1].length }; return '' }
    mathEnd = displayMathEnd(line)
    if (mathEnd) return ''
    return line.replace(/`[^`]*`/g, '').replace(/\$\$.*?\$\$/g, '').replace(/\\\[.*?\\\]/g, '')
  }).join('\n')
}
function sourcePages(content: string, allowed: ReadonlySet<number>, warnings: Set<string>): number[] {
  const pages = new Set<number>(), text = outsideCode(content)
  const numbers = String.raw`\d{1,9}(?:\s*(?:[-–—,，、&]|\band\b|\bto\b|至)\s*\d{1,9})*`
  const expressions = [new RegExp(String.raw`\b(?:PDF\s+)?(?:pages?\.?|pp?\.)\s*[:：]?\s*(${numbers})`, 'gi'), new RegExp(String.raw`第\s*(${numbers})\s*页|(?:页码|页面|页)\s*[:：]?\s*(${numbers})`, 'g')]
  function add(number: number): void {
    if (allowed.has(number)) pages.add(number)
    else warnings.add(`Unknown PDF page reference: ${number}`)
  }
  for (const expression of expressions) for (const match of text.matchAll(expression)) {
    const reference = match[1] ?? match[2]
    const tokens = [...reference.matchAll(/\d{1,9}|[-–—至]|\bto\b/gi)].map(token => token[0].toLowerCase())
    for (let index = 0; index < tokens.length; index++) {
      if (!/^\d+$/.test(tokens[index])) continue
      const first = Number(tokens[index])
      if (index + 2 < tokens.length && /^(?:[-–—至]|to)$/.test(tokens[index + 1])) {
        const last = Number(tokens[index + 2]); index += 2
        if (last < first) { warnings.add(`Invalid PDF page range: ${first}-${last}`); continue }
        const valid = [...allowed].filter(page => page >= first && page <= last)
        valid.forEach(page => pages.add(page))
        if (last - first + 1 !== valid.length) warnings.add(`Unknown PDF page reference in range: ${first}-${last}`)
      } else add(first)
    }
  }
  return [...pages].sort((a, b) => a - b)
}

export function parseSummaryMarkdown(markdown: string, language: SummaryLanguage, allowedPages: ReadonlySet<number>): ParsedSummaryMarkdown {
  if (typeof markdown !== 'string' || markdown.length > 60000) throw new Error('Summary Markdown exceeds the 60000 character output limit')
  const bodies = new Map<SectionId, string[]>(), preamble: string[] = [], warnings = new Set<string>()
  let current: SectionId | null = null, fence: { character: string; length: number } | null = null, mathEnd: string | null = null
  for (const line of unwrap(markdown).split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (fence) {
      ;(current ? bodies.get(current)! : preamble).push(line)
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null
      continue
    }
    if (mathEnd) {
      ;(current ? bodies.get(current)! : preamble).push(line)
      if (line.includes(mathEnd)) mathEnd = null
      continue
    }
    if (marker) { fence = { character: marker[1][0], length: marker[1].length }; (current ? bodies.get(current)! : preamble).push(line); continue }
    mathEnd = displayMathEnd(line)
    if (mathEnd) { (current ? bodies.get(current)! : preamble).push(line); continue }
    const heading = identifyHeading(line)
    if (heading) {
      current = heading.id
      const body = bodies.get(current)
      if (body) body.push('')
      else bodies.set(current, [])
      if (heading.body) bodies.get(current)!.push(heading.body)
    } else (current ? bodies.get(current)! : preamble).push(line)
  }
  const lead = preamble.join('\n').trim()
  if (lead) sourcePages(lead, allowedPages, warnings)
  if (lead && bodies.size) {
    const destination = bodies.has('overview') ? 'overview' : bodies.keys().next().value!
    bodies.get(destination)!.unshift(lead, '')
    warnings.add(`Unlabelled preamble retained in ${destination}`)
  }
  const sections = SUMMARY_MARKDOWN_SECTION_IDS.flatMap((id, index) => bodies.has(id) ? [{ id, title: titles[language][index], content: bodies.get(id)!.join('\n').trim(), pages: [] as number[] }] : [])
  if (sections.reduce((sum, section) => sum + section.content.length, 0) > 60000) throw new Error('Summary content exceeds the 60000 character output limit')
  for (const section of sections) section.pages = sourcePages(section.content, allowedPages, warnings)
  const missing = SUMMARY_MARKDOWN_SECTION_IDS.filter(id => !sections.find(section => section.id === id)?.content.trim())
  return { sections, missing, warnings: [...warnings], complete: missing.length === 0 }
}




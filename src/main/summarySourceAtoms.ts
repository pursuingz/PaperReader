import { SummaryValidationError } from './summaryErrors'

export const summaryHeadingPattern = /^(?:(?:\d+(?:\.\d+)*\.?|[IVX]+\.)\s+)?(?:abstract|introduction|background|related work|method(?:s|ology)?|approach|implementation|experiments?(?: and results)?|experimental (?:setup|results|evaluation)|evaluation|results?(?: and discussion)?|discussion|limitations?(?: and future work)?|conclusions?|references|appendix|摘要|引言|背景|相关工作|方法|实验(?:和结果)?|结果|讨论|局限(?:性)?|结论)(?:\s*[:：].*)?$/i
export const summaryPrintedText = (value: string) => value.replace(/[ﬀﬁﬂ]/g, character => ({ 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl' })[character]!).replace(/\u00ad/g, '')
export const summaryNormalizeQuote = (value: string) => summaryPrintedText(value).replace(/\s+/g, ' ').trim()
const summaryScalarPattern = /(?<![A-Za-z0-9])[-+−]?(?:\d+(?:[.,]\d+)*|\.\d+)(?:e[-+]?\d+)?(?:\s*%)?/giu
function scientificBody(content: string): string {
  return content.split(/\r?\n/).map(line => {
    const unmarked = line.replace(/^\s{0,3}#{1,6}\s+/, '')
    if (summaryHeadingPattern.test(unmarked.trim())) return unmarked.replace(/^\s*(?:\d+(?:\.\d+)*\.?|[IVX]+\.)\s+/, '')
    return line.replace(/^\s*\d+[.)]\s+/, '')
  }).join('\n')
}
const unitAliases: Record<string, string> = {
  秒: 's', 毫秒: 'ms', 微秒: 'μs', 纳秒: 'ns', 米: 'm', 毫米: 'mm', 厘米: 'cm', 微米: 'μm', 纳米: 'nm', 千米: 'km',
  克: 'g', 毫克: 'mg', 微克: 'μg', 纳克: 'ng', 千克: 'kg', 公斤: 'kg', 升: 'L', 毫升: 'mL', 微升: 'μL',
  kelvin: 'K', 开尔文: 'K', celsius: '°C', 摄氏度: '°C', fahrenheit: '°F', 华氏度: '°F', percent: '%'
}
for (const [prefix, symbol] of [['', ''], ['nano', 'n'], ['micro', 'μ'], ['milli', 'm'], ['centi', 'c'], ['deci', 'd'], ['kilo', 'k']]) {
  for (const [words, unit] of [['gram,grams', 'g'], ['meter,meters,metre,metres', 'm'], ['second,seconds', 's'], ['liter,liters,litre,litres', 'L']]) {
    for (const word of words.split(',')) unitAliases[prefix + word] = symbol + unit
  }
}
const aliasPattern = new RegExp(`(?<![A-Za-z])(?:${Object.keys(unitAliases).sort((a, b) => b.length - a.length).map(alias => alias === 'percent' ? 'percent(?![\\s\\p{Pd}\\p{Cf}]+points?\\b)' : alias).join('|')})(?![A-Za-z])`, 'giu')
function canonicalQuantities(content: string): string {
  return scientificBody(summaryPrintedText(content)).replace(/−/g, '-').replace(/µ/g, 'μ').replace(aliasPattern, alias => unitAliases[alias.toLowerCase()])
}
export function summaryNumericFacts(content: string): string[] {
  const intervalNumber = '[-+−]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][-+]?\\d+)?'
  const intervalPattern = new RegExp(`(\\[|\\()\\s*(${intervalNumber}(?:\\s*[,;]\\s*${intervalNumber})+)\\s*(\\]|\\))`, 'g')
  const intervals: string[] = []
  const body = canonicalQuantities(content).replace(intervalPattern, (_match, left: string, values: string, right: string) => {
    const members = values.split(/[,;]/).map(value => value.trim().replace(/−/g, '-'))
    intervals.push(`${left}${members.join(',')}${right}`)
    return members.join(' ')
  })
  const numbers = [...body.matchAll(summaryScalarPattern)].map(match => match[0].replace(/\s/g, '').replace(/−/g, '-'))
  return [...new Set([...numbers, ...intervals])]
}
const quantityNumber = '[-+−]?(?:\\d+(?:[.,]\\d+)*|\\.\\d+)(?:[eE][-+]?\\d+)?'
const symbolUnit = '(?:[yzafpnμµumcdhkMGTPEZY]?(?:mol|Hz|Pa|Wb|eV|ohm|bit|g|m|s|A|K|N|J|W|C|V|F|Ω|S|T|H|L|l|B))'
const wordUnit = '(?:(?:nano|micro|milli|centi|deci|kilo)?(?:grams?|met(?:ers?|res?)|seconds?|lit(?:ers?|res?))|[Kk]elvin|[Cc]elsius|[Ff]ahrenheit|percent(?:age)?(?:\\s+points?)?|ppm|ppb|ppt|fps|dB|[GMT]?FLOPs|bytes?|bits?)'
const quantityUnit = `(?:°\\s*[CFK]|℃|℉|%|‰|${wordUnit}|${symbolUnit})`
const quantityPattern = new RegExp(`(?<![A-Za-z0-9])${quantityNumber}\\s*${quantityUnit}(?:[²³]|\\^[-+−]?\\d+)?(?:\\s*[/·]\\s*${quantityUnit}(?:[²³]|\\^[-+−]?\\d+)?)*(?![A-Za-z])`, 'g')
export function summaryMeasurements(content: string): string[] {
  return [...new Set([...canonicalQuantities(content).matchAll(quantityPattern)].map(match => match[0].replace(/\s/g, '').replace(/−/g, '-').replace(/µ/g, 'μ')))]
}

export interface SummarySourceRange { start: number; end: number }
interface MappedText { text: string; starts: number[]; ends: number[] }
function mappedScientificText(source: string): MappedText {
  let text = ''; const starts: number[] = []; const ends: number[] = []
  for (let index = 0; index < source.length;) {
    const character = String.fromCodePoint(source.codePointAt(index)!)
    const normalized = summaryPrintedText(character).replace(/−/g, '-').replace(/µ/g, 'μ')
    text += normalized
    for (let offset = 0; offset < normalized.length; offset++) { starts.push(index); ends.push(index + character.length) }
    index += character.length
  }
  const result: MappedText = { text: '', starts: [], ends: [] }; let cursor = 0
  const unchanged = (end: number) => { result.text += text.slice(cursor, end); for (let index = cursor; index < end; index++) { result.starts.push(starts[index]); result.ends.push(ends[index]) }; cursor = end }
  for (const match of text.matchAll(aliasPattern)) {
    unchanged(match.index)
    const replacement = unitAliases[match[0].toLowerCase()]
    result.text += replacement
    for (let index = 0; index < replacement.length; index++) { result.starts.push(starts[match.index]); result.ends.push(ends[match.index + match[0].length - 1]) }
    cursor = match.index + match[0].length
  }
  unchanged(text.length)
  return result
}
function mergeRanges(ranges: SummarySourceRange[]): SummarySourceRange[] {
  ranges.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: SummarySourceRange[] = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range.start < previous.end) previous.end = Math.max(previous.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}
function codeRanges(text: string): SummarySourceRange[] {
  const ranges: SummarySourceRange[] = []; let fence: { start: number; marker: string; length: number } | undefined
  for (const match of text.matchAll(/^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/gm)) {
    const marker = match[1]
    if (!fence) fence = { start: match.index, marker: marker[0], length: marker.length }
    else if (marker[0] === fence.marker && marker.length >= fence.length && new RegExp(`^ {0,3}${fence.marker}{${fence.length},}\\s*$`).test(match[0])) { ranges.push({ start: fence.start, end: match.index + match[0].length }); fence = undefined }
  }
  if (fence) ranges.push({ start: fence.start, end: text.length })
  let index = 0
  while (index < text.length) {
    const block = ranges.find(range => range.start <= index && index < range.end)
    if (block) { index = block.end; continue }
    if (text[index] !== '`') { index++; continue }
    let length = 1
    while (text[index + length] === '`') length++
    const delimiter = '`'.repeat(length); const end = text.indexOf(delimiter, index + length)
    if (end < 0) { index += length; continue }
    ranges.push({ start: index, end: end + length }); index = end + length
  }
  return mergeRanges(ranges)
}
export function summaryProtectedRanges(source: string): SummarySourceRange[] {
  if (typeof source !== 'string') throw new SummaryValidationError('SCHEMA')
  if (!source.length) return []
  const mapped = mappedScientificText(source); const text = mapped.text
  const ranges: SummarySourceRange[] = []
  const add = (start: number, end: number) => { if (end > start) ranges.push({ start: mapped.starts[start], end: mapped.ends[end - 1] }) }
  const protectedUnits = quantityUnit.replace('(?:\\s+points?)?', '(?:[\\s\\p{Pd}\\p{Cf}]+points?)?')
  const protectedQuantity = new RegExp(`(?<![A-Za-z0-9])${quantityNumber}\\s*${protectedUnits}(?:[²³]|\\s*\\^\\s*[-+−]?\\d+)?(?:\\s*[/·]\\s*${protectedUnits}(?:[²³]|\\s*\\^\\s*[-+−]?\\d+)?)*(?![A-Za-z])`, 'gu')
  const genericCount = new RegExp(`(?<![A-Za-z0-9])${quantityNumber}\\s*\\p{L}[\\p{L}\\p{N}_]{0,31}`, 'gu')
  for (const pattern of [quantityPattern, protectedQuantity, summaryScalarPattern, genericCount]) for (const match of text.matchAll(pattern)) add(match.index, match.index + match[0].length)
  const codes = codeRanges(text)
  for (const range of codes) add(range.start, range.end)
  const insideCode = (position: number) => codes.some(range => range.start <= position && position < range.end)
  for (const match of text.matchAll(/\$\$[\s\S]*?\$\$|\$[^$]*?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g)) if (!insideCode(match.index)) add(match.index, match.index + match[0].length)
  const stack: number[] = []
  for (let index = 0; index < text.length; index++) {
    if (insideCode(index)) continue
    if (/[\[({]/.test(text[index])) stack.push(index)
    else if (/[\])}]/.test(text[index]) && stack.length) add(stack.pop()!, index + 1)
  }
  for (let index = 0; index < source.length - 1; index++) if (/[\uD800-\uDBFF]/.test(source[index]) && /[\uDC00-\uDFFF]/.test(source[index + 1])) { ranges.push({ start: index, end: index + 2 }); index++ }
  return mergeRanges(ranges)
}
export function safeSummaryBoundary(text: string, candidate: number): number {
  if (typeof text !== 'string' || !Number.isInteger(candidate) || candidate > text.length) throw new SummaryValidationError('SCHEMA')
  if (candidate <= 0) throw new SummaryValidationError('BUDGET')
  const atom = summaryProtectedRanges(text).find(range => range.start < candidate && candidate < range.end)
  const safe = atom ? atom.start : candidate
  if (safe <= 0) throw new SummaryValidationError('BUDGET')
  return safe
}


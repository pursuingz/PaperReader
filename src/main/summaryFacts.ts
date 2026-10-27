import { SummaryValidationError } from './summaryErrors'
import { summaryMeasurements, summaryNumericFacts, summaryPrintedText } from './summarySourceAtoms'

export interface SummaryFactValues { numbers: string[]; measurements: string[]; math: string[]; uncertainMeasurements: string[] }
export interface SummaryFactContext {
  adopted: SummaryFactValues
  sources: Array<SummaryFactValues & { page: number; text: string; navigation: string[] }>
  mathReviewRequired: string[]
  semanticReviewRequired: true
}
type Quote = { page: number; text: string }
const number = '[-+−]?(?:\\d+(?:[.,]\\d+)*|\\.\\d+)(?:[eE][-+−]?\\d+)?'
const canonicalAtom = (value: string) => summaryPrintedText(value).replace(/−/g, '-').replace(/\s/g, '')
// Only explicit navigation labels are exempt. Bare brackets can be vectors/intervals.
const navigationPattern = /\b(?:references?|citations?|refs?|equations?|eqs?|figures?|figs?|tables?|sections?|secs?|chapters?|appendix)\.?\s*(?:\[\s*\d+(?:\s*[,;–-]\s*\d+)*\s*\]|\(\s*\d+(?:\.\d+)*\s*\)|\d+(?:\.\d+)*(?:[a-z])?)(?![\d\p{L}])/giu
const citationPattern = /\b(?:(?:prior|previous|related)\s+(?:work|studies|research)|et\s+al\.)\s*\[\s*\d+(?:\s*[,;–-]\s*\d+)*\s*\]/giu
const mathPattern = /\$\$[\s\S]*?\$\$|\$[^$\r\n]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g
function unwrapMath(value: string): string { return value.startsWith('$$') || value.startsWith('\\') ? value.slice(2, -2) : value.slice(1, -1) }
function inspect(text: string): SummaryFactValues & { navigation: string[]; body: string } {
  const navigation: string[] = []; const math: string[] = []
  let body = text.replace(mathPattern, value => { math.push(value); return unwrapMath(value) })
  for (const pattern of [navigationPattern, citationPattern]) body = body.replace(pattern, value => { navigation.push(value); return ' '.repeat(value.length) })
  // Symbols inside an actual formula are not automatically physical units. Pure
  // wrapped quantities retain unit checks; adding $...$ must not hide 100 kg.
  const uncertainMeasurements: string[] = []
  let measurementBody = text.replace(mathPattern, value => {
    const expression = unwrapMath(value).trim()
    const measures = summaryMeasurements(expression)
    const isQuantity = measures.length === 1 && new RegExp(`^${number}\\s*[\\p{L}°%‰µμ][\\p{L}\\s°%‰µμ/·²³^0-9−+-]*$`, 'u').test(expression)
    if (isQuantity) return expression
    const symbolic = measures.filter(measure => new RegExp(`^${number}[NSKCVAmst]$`, 'u').test(measure))
    uncertainMeasurements.push(...symbolic)
    return expression
  })
  for (const pattern of [navigationPattern, citationPattern]) measurementBody = measurementBody.replace(pattern, value => ' '.repeat(value.length))
  const candidates = summaryMeasurements(measurementBody)
  const mathematical = /\b(?:formula|equation|summation|integral|coefficient|symbol(?:ic)?|upper index|lower index)\b|公式|求和|符号/.test(text.toLowerCase())
  const physical = /\b(?:force|newtons?|time|seconds?|duration|temperature|kelvin|celsius|voltage|current|amperes?|joules?|mass|length|distance|measured|measurement|experimental)\b|测量|温度|时间/.test(text.toLowerCase())
  const ambiguous = mathematical && !physical ? candidates.filter(value => new RegExp(`^${number}[NSKCVAmst]$`, 'u').test(value)) : []
  uncertainMeasurements.push(...ambiguous)
  return { numbers: summaryNumericFacts(body), measurements: candidates.filter(value => !ambiguous.includes(value)), uncertainMeasurements: [...new Set(uncertainMeasurements)], math, navigation, body }
}
function navigationKeys(value: string): string[] {
  const word = value.toLowerCase()
  const kind = /^(?:equation|eq)/.test(word) ? 'equation' : /^(?:figure|fig)/.test(word) ? 'figure' : /^table/.test(word) ? 'table' : /^(?:section|sec)/.test(word) ? 'section' : /^chapter/.test(word) ? 'chapter' : /^appendix/.test(word) ? 'appendix' : 'reference'
  return summaryNumericFacts(value).map(value => `${kind}:${value}`)
}
function mathPresent(formula: string, quotes: ReadonlyArray<Quote>): boolean {
  const expression = canonicalAtom(unwrapMath(formula))
  if (!expression) return false
  // Only literal source membership after layout normalization, never equivalence.
  const escaped = Array.from(expression, character => '^$.*+?()[]{}|\\'.includes(character) ? `\\${character}` : character).join('\\s*')
  const pattern = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'u')
  return quotes.some(quote => pattern.test(summaryPrintedText(quote.text.replace(mathPattern, value => ` ${unwrapMath(value)} `)).replace(/−/g, '-')))
}
/** Source context for semantic review, never a claim that numerical matching proves meaning. */
export function summaryFactContext(content: string, quotes: ReadonlyArray<Quote>): SummaryFactContext {
  const adopted = inspect(content)
  return { adopted: { numbers: adopted.numbers, measurements: adopted.measurements, math: adopted.math, uncertainMeasurements: adopted.uncertainMeasurements }, sources: quotes.map(quote => {
    const value = inspect(quote.text)
    return { page: quote.page, text: quote.text, numbers: value.numbers, measurements: value.measurements, uncertainMeasurements: value.uncertainMeasurements, math: value.math, navigation: value.navigation }
  }), mathReviewRequired: adopted.math.filter(formula => !mathPresent(formula, quotes)), semanticReviewRequired: true }
}
function leadingNumber(value: string): string { return new RegExp(`^${number}`, 'u').exec(value)?.[0].replace(/−/g, '-') ?? '' }
const scalar = (value: string) => !/^[[(]/.test(value)
function sameNumber(a: string, b: string): boolean { return a.replace(/%$/, '') === b.replace(/%$/, '') }
function groups(body: string) {
  const result = summaryNumericFacts(body).filter(value => !scalar(value)).map(value => ({ value, numbers: summaryNumericFacts(value).filter(scalar), interval: true }))
  for (const match of body.matchAll(new RegExp(`${number}\\s*(?:±|\\+\\s*[/−-]\\s*)\\s*${number}`, 'gu'))) result.push({ value: match[0], numbers: summaryNumericFacts(match[0]), interval: false })
  return result
}
function context(text: string) {
  const value = inspect(text), atoms = groups(value.body)
  const freeNumbers = value.numbers.filter(scalar).filter(n => !value.measurements.some(measure => sameNumber(n, leadingNumber(measure))) && !atoms.some(atom => atom.numbers.includes(n)))
  const conditions = [...value.body.matchAll(/\b(?:under|with|at|using|for)\s+[^,;!?\n]{0,60}/giu)].flatMap(match => summaryNumericFacts(match[0]))
  if (/\b(?:versus|compared (?:with|to)|rather than)\b/i.test(value.body)) conditions.push(...value.numbers)
  return { ...value, atoms, freeNumbers, conditions }
}
/** Validate quantities actually adopted, not every number in the selected source windows. */
export function validateAdoptedSummaryFacts(content: string, quotes: ReadonlyArray<Quote>, location = 'response'): void {
  const adopted = inspect(content); const adoptedGroups = groups(adopted.body)
  const sources = quotes.map(quote => inspect(quote.text))
  const contexts = quotes.flatMap(quote => quote.text.split(/(?<=[.!?。！？])\s+|\n\s*\n/u)).map(context)
  const fail = (code: 'NUMBER_MISMATCH' | 'UNIT_MISMATCH') => { throw new SummaryValidationError(code, location) }
  const numbers = new Set(sources.flatMap(source => source.numbers))
  const measurements = new Set(sources.flatMap(source => source.measurements))
  if (adopted.numbers.some(value => !numbers.has(value))) fail('NUMBER_MISMATCH')
  if (adopted.measurements.some(value => !measurements.has(value))) fail('UNIT_MISMATCH')
  const navigation = new Set(sources.flatMap(source => source.navigation.flatMap(navigationKeys)))
  if (adopted.navigation.some(value => navigationKeys(value).some(key => !navigation.has(key)))) fail('NUMBER_MISMATCH')
  const sameGroup = (a: ReturnType<typeof groups>[number], b: ReturnType<typeof groups>[number]) => canonicalAtom(a.value) === canonicalAtom(b.value)
  const groupSupported = (group: ReturnType<typeof groups>[number]) => contexts.some(source => source.atoms.some(atom => sameGroup(atom, group)))
  for (const group of adoptedGroups) if (!groupSupported(group)) fail('NUMBER_MISMATCH')
  for (const measure of adopted.measurements) {
    // A single complete candidate must support a measured value and its numeric
    // qualifiers. Equal values in other objects do not add unrelated conditions.
    const candidates = contexts.filter(source => source.measurements.includes(measure))
    if (!candidates.some(source => source.conditions.every(n => adopted.numbers.includes(n)) && source.atoms.filter(atom => atom.numbers.some(n => sameNumber(n, leadingNumber(measure)))).every(atom => adoptedGroups.some(group => sameGroup(atom, group))))) fail('NUMBER_MISMATCH')
  }
  for (const value of adopted.numbers.filter(scalar)) {
    if (contexts.some(source => source.freeNumbers.includes(value))) continue
    if (adoptedGroups.some(group => group.numbers.includes(value) && groupSupported(group))) continue
    if (adopted.measurements.some(measure => sameNumber(value, leadingNumber(measure)))) continue
    // Do not detach a number from its sole unit/uncertainty/vector source.
    if ([...measurements].some(measure => sameNumber(value, leadingNumber(measure)))) fail('UNIT_MISMATCH')
    fail('NUMBER_MISMATCH')
  }
}

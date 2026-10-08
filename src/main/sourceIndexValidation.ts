import type { PaperSourceIndex } from '../shared/types'
import { object, validId } from './validation'

export function sourcePaperId(value: unknown): asserts value is string {
  validId(value)
  if (['constructor', '__proto__', 'prototype', 'demo-workspace'].includes(value)) throw new Error('Invalid source paper identifier')
}
function boundedText(value: unknown, maximum: number, empty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('Invalid source text')
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid source index fields')
}
function pages(value: unknown, maximum: number): number[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error('Invalid source page coverage')
  let previous = 0
  for (const page of value) {
    if (!Number.isSafeInteger(page) || page <= previous || page > maximum) throw new Error('Invalid source page coverage')
    previous = page
  }
  return value as number[]
}
export function validateSourceIndex(value: unknown, paperId: string): asserts value is PaperSourceIndex {
  sourcePaperId(paperId); object(value)
  fields(value, ['paperId', 'extractorVersion', 'createdAt', 'pageCount', 'indexedPages', 'textlessPages', 'failedPages', 'limitReached', 'entries'])
  if (value.paperId !== paperId || value.extractorVersion !== 1) throw new Error('Invalid source index identity or extractor version')
  boundedText(value.createdAt, 40)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Invalid source index date')
  const count = value.pageCount
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > 100000) throw new Error('Invalid source page count')
  if (typeof value.limitReached !== 'boolean') throw new Error('Invalid source index limit flag')
  const readable = pages(value.indexedPages, Math.min(count, 200)), blank = pages(value.textlessPages, Math.min(count, 200)), failed = pages(value.failedPages, Math.min(count, 200))
  const attempted = [...readable, ...blank, ...failed].sort((a, b) => a - b)
  if (attempted.length > 200 || attempted.some((page, index) => page !== index + 1) || (!value.limitReached && attempted.length !== count)) throw new Error('Invalid or incomplete source page coverage')
  if (!Array.isArray(value.entries) || value.entries.length > 1000) throw new Error('Invalid source index entries')
  const ids = new Set<string>(), indexed = new Set(readable)
  let characters = 0
  for (const entry of value.entries) {
    object(entry); fields(entry, ['id', 'kind', 'label', 'text', 'pages']); sourcePaperId(entry.id)
    if (ids.has(entry.id) || !['figure', 'table', 'reference', 'reference-section'].includes(entry.kind as string)) throw new Error('Invalid or duplicate source entry')
    ids.add(entry.id); boundedText(entry.label, 160); boundedText(entry.text, 16000)
    characters += entry.text.length
    const sourcePages = pages(entry.pages, count)
    if (!sourcePages.length || sourcePages.some(page => !indexed.has(page))) throw new Error('Source entries must cite indexed readable pages')
  }
  if (characters > 240000) throw new Error('Source index text limit exceeded')
}

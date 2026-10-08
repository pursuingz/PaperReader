import type { PaperTable, PaperTables } from '../shared/types'
import { object } from './validation'
import { sourcePaperId } from './sourceIndexValidation'

function fields(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid table fields') }
function text(value: unknown, maximum: number, empty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > maximum || !empty && !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('Invalid or excessive table text')
}
function coverage(value: unknown, maximum: number): number[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error('Invalid table page coverage')
  let previous = 0
  for (const page of value) { if (!Number.isSafeInteger(page) || page <= previous || page > maximum) throw new Error('Invalid table page coverage'); previous = page }
  return value as number[]
}
export function validatePaperTable(value: unknown): asserts value is PaperTable {
  object(value); fields(value, ['id', 'label', 'page', 'columns', 'rows', 'notes', 'rawText', 'status', 'reason'])
  sourcePaperId(value.id); text(value.label, 160); text(value.rawText, 16000)
  if (!Number.isSafeInteger(value.page) || (value.page as number) < 1 || (value.page as number) > 100000 || !['candidate', 'unsupported'].includes(value.status as string)) throw new Error('Invalid table source page or status')
  if (value.reason !== undefined) text(value.reason, 1000)
  if (!Array.isArray(value.columns) || value.columns.length > 32 || !Array.isArray(value.rows) || value.rows.length > 200 || !Array.isArray(value.notes) || value.notes.length > 32) throw new Error('Table grid or notes limit exceeded')
  const ids = new Set<string>()
  for (const column of value.columns) {
    object(column); fields(column, ['id', 'header', 'unit']); sourcePaperId(column.id); text(column.header, 500)
    if (ids.has(column.id)) throw new Error('Duplicate table column identifier'); ids.add(column.id)
    if (column.unit !== null) { text(column.unit, 80); if (!column.header.includes(column.unit)) throw new Error('Table units must be present in the original header') }
    if (!value.rawText.includes(column.header)) throw new Error('Table header must be retained in original text')
  }
  for (const row of value.rows) {
    if (!Array.isArray(row) || row.length !== value.columns.length) throw new Error('Invalid rectangular table grid')
    for (const cell of row) { object(cell); fields(cell, ['raw']); text(cell.raw, 2000); if (!value.rawText.includes(cell.raw)) throw new Error('Table values must be retained in original text') }
  }
  for (const note of value.notes) { text(note, 2000); if (!value.rawText.includes(note)) throw new Error('Table notes must be retained in original text') }
  if (value.status === 'unsupported' && (value.columns.length || value.rows.length || typeof value.reason !== 'string' || !value.reason.trim())) throw new Error('Unsupported tables must state a reason and cannot contain invented cells')
  if (value.status === 'candidate' && (value.columns.length < 2 || !value.rows.length)) throw new Error('Table candidates must contain headers and source rows')
}
export function validatePaperTables(value: unknown, paperId: string): asserts value is PaperTables {
  sourcePaperId(paperId); object(value); fields(value, ['paperId', 'extractorVersion', 'createdAt', 'pageCount', 'indexedPages', 'textlessPages', 'failedPages', 'limitReached', 'tables'])
  if (value.paperId !== paperId || value.extractorVersion !== 1) throw new Error('Invalid table paper identity or extractor version')
  text(value.createdAt, 40)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Invalid table date')
  if (!Number.isSafeInteger(value.pageCount) || (value.pageCount as number) < 1 || (value.pageCount as number) > 100000 || typeof value.limitReached !== 'boolean') throw new Error('Invalid table coverage metadata')
  const maximum = Math.min(value.pageCount as number, 200), readable = coverage(value.indexedPages, maximum), blank = coverage(value.textlessPages, maximum), failed = coverage(value.failedPages, maximum)
  const attempted = [...readable, ...blank, ...failed].sort((a, b) => a - b)
  if (attempted.length > 200 || attempted.some((page, index) => page !== index + 1) || !value.limitReached && attempted.length !== value.pageCount) throw new Error('Invalid or incomplete table page coverage')
  if (!Array.isArray(value.tables) || value.tables.length > 200) throw new Error('Table count limit exceeded')
  const ids = new Set<string>(); let characters = 0, cells = 0
  for (const table of value.tables) {
    validatePaperTable(table)
    if (ids.has(table.id) || !readable.includes(table.page)) throw new Error('Duplicate table or unindexed source page')
    ids.add(table.id); characters += table.rawText.length; cells += table.rows.length * table.columns.length
  }
  if (characters > 240000 || cells > 20000) throw new Error('Aggregate table limit exceeded')
}

import { realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { NoteExportResult, PaperTable } from '../shared/types'
import { readingExportFileName } from './readingExport'
import { validatePaperTable } from './tableValidation'

export type ChooseTableCsvPath = (suggestedName: string) => Promise<{ canceled: boolean; filePath?: string }>
const numberLiteral = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
function field(raw: string): string {
  const trimmed = raw.trim(), guarded = /^[=+@-]/.test(raw.trimStart()) && !numberLiteral.test(trimmed) ? "'" + raw : raw
  return '"' + guarded.replace(/"/g, '""') + '"'
}
export function formatTableCsv(table: PaperTable): string {
  validatePaperTable(table)
  if (table.status !== 'candidate') throw new Error('Unsupported tables cannot be exported as a structured CSV')
  return '\ufeff' + [table.columns.map(column => column.header), ...table.rows.map(row => row.map(cell => cell.raw))].map(row => row.map(field).join(',')).join('\r\n') + '\r\n'
}
export const tableCsvFileName = (title: string, label: string) => readingExportFileName(`${title} ${label}`).replace(/-reading-notes\.md$/, '-table.csv')
function within(root: string, path: string) { const part = relative(root, path); return part === '' || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part) }
export async function saveTableCsvExport(table: PaperTable, suggestedName: string, dataRoot: string, choosePath: ChooseTableCsvPath): Promise<NoteExportResult> {
  const content = formatTableCsv(structuredClone(table)), selection = await choosePath(suggestedName)
  if (selection.canceled || !selection.filePath) return { canceled: true }
  const filePath = selection.filePath
  if (!isAbsolute(filePath) || extname(filePath).toLowerCase() !== '.csv' || /[<>:"|?*\u0000-\u001f]/.test(basename(filePath)) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(basename(filePath))) throw new Error('Choose a new file at an absolute path ending in .csv')
  const destination = resolve(filePath), root = resolve(dataRoot)
  if (within(root, destination)) throw new Error('Choose a CSV destination outside internal application data')
  let parent: string, actualRoot: string
  try { [parent, actualRoot] = await Promise.all([realpath(dirname(destination)), realpath(root)]) } catch { throw new Error('The CSV could not be saved. Choose an existing writable folder.') }
  if (within(actualRoot, resolve(parent, basename(destination)))) throw new Error('Choose a CSV destination outside internal application data')
  try { await writeFile(destination, content, { flag: 'wx', encoding: 'utf8', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('This file already exists. Choose a new CSV name to preserve it.'); throw new Error('The CSV could not be saved. Choose a writable folder and a new file name.') }
  return { canceled: false, fileName: basename(destination) }
}

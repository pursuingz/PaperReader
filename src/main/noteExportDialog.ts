import type { NoteExportResult } from '../shared/types'
import { writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'

export type ChooseMarkdownPath = (suggestedName: string) => Promise<{ canceled: boolean; filePath?: string }>

export async function saveMarkdownExport(content: string, suggestedName: string, choosePath: ChooseMarkdownPath): Promise<NoteExportResult> {
  const selection = await choosePath(suggestedName)
  if (selection.canceled || !selection.filePath) return { canceled: true }
  if (!isAbsolute(selection.filePath) || extname(selection.filePath).toLowerCase() !== '.md') {
    throw new Error('Choose a file ending in .md to export your reading notes.')
  }
  try { await writeFile(selection.filePath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('This Markdown file already exists. Choose a new file name to preserve existing notes.')
    throw new Error('The Markdown file could not be saved. Choose a writable folder and try again.')
  }
  return { canceled: false, fileName: basename(selection.filePath) }
}

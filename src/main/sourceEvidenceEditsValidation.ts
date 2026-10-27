import type { PaperSourceEntry } from '../shared/types'
import type { SourceEvidenceEdits, SourceEvidenceCaptionInput, SourceEvidenceHiddenInput } from '../shared/sourceEvidenceEditsTypes'
import { object } from './validation'
import { sourcePaperId } from './sourceIndexValidation'

export const sourceEvidenceEditsLimits = { caption: 16000, entries: 1000, totalSource: 240000, totalCaption: 240000, bytes: 2 * 1024 * 1024 }
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw Error('Invalid source evidence edit fields')
}
function text(value: unknown, maximum: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error('Invalid source evidence caption text')
}
export function validateEvidenceEditSource(value: unknown): asserts value is PaperSourceEntry {
  object(value); fields(value, ['id', 'kind', 'label', 'text', 'pages']); sourcePaperId(value.id)
  if (value.kind !== 'figure' && value.kind !== 'table') throw Error('Only figure and table source entries may be edited')
  text(value.label, 160); text(value.text, 16000)
  if (!Array.isArray(value.pages) || !value.pages.length || value.pages.length > 200 || value.pages.some((page, index, all) => !Number.isSafeInteger(page) || page < 1 || page > 100000 || index > 0 && page <= all[index - 1])) throw Error('Invalid source evidence pages')
}
export function validateEvidenceCaptionInput(value: unknown): asserts value is SourceEvidenceCaptionInput {
  object(value); fields(value, ['entry', 'caption']); validateEvidenceEditSource(value.entry); text(value.caption, sourceEvidenceEditsLimits.caption)
}
export function validateEvidenceHiddenInput(value: unknown): asserts value is SourceEvidenceHiddenInput {
  object(value); fields(value, ['entry', 'hidden']); validateEvidenceEditSource(value.entry)
  if (typeof value.hidden !== 'boolean') throw Error('Invalid source evidence hidden flag')
}
export function validateSourceEvidenceEdits(value: unknown, paperId: string): asserts value is SourceEvidenceEdits {
  sourcePaperId(paperId); object(value); fields(value, ['version', 'paperId', 'edits'])
  if (value.version !== 1 || value.paperId !== paperId) throw Error('Invalid source evidence edit owner or identity')
  if (!Array.isArray(value.edits) || value.edits.length > sourceEvidenceEditsLimits.entries) throw Error('Source evidence edit entry limit exceeded')
  const ids = new Set<string>(); let sourceTotal = 0, captionTotal = 0
  for (const edit of value.edits) {
    object(edit); fields(edit, ['source', 'caption', 'hidden']); validateEvidenceEditSource(edit.source)
    if (ids.has(edit.source.id)) throw Error('Duplicate source evidence edit identity')
    ids.add(edit.source.id); sourceTotal += edit.source.text.length
    if (typeof edit.hidden !== 'boolean') throw Error('Invalid source evidence hidden flag')
    if (edit.caption !== undefined) { text(edit.caption, sourceEvidenceEditsLimits.caption); captionTotal += edit.caption.length }
  }
  if (sourceTotal > sourceEvidenceEditsLimits.totalSource || captionTotal > sourceEvidenceEditsLimits.totalCaption) throw Error('Source evidence edit text limit exceeded')
}

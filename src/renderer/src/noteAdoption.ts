import type { ChatMessage } from '../../shared/types'

export const NOTE_CHARACTER_LIMIT = 2_000_000
export type NoteAdoptionMode = 'append' | 'replace'
export interface NoteAdoptionUndo { paperId: string; before: string; after: string }

const ORGANIZATION_PREFIX = '## Suggested note organization\n\nYour original note is unchanged. Review this AI suggestion before copying any part.\n\n'

/** Call only for complete ChatMessage entries; streaming previews are separate. */
export function extractNoteProposal(message: ChatMessage): string | null {
  if (message.role !== 'assistant' || message.isDemo || !message.content.startsWith(ORGANIZATION_PREFIX)) return null
  const body = message.content.slice(ORGANIZATION_PREFIX.length)
  return body.trim() ? body : null
}

export function assertReviewPaper(reviewedPaperId: string, currentPaperId: string | null): void {
  if (!reviewedPaperId || reviewedPaperId !== currentPaperId) throw new Error('The current paper changed. Open the suggestion again in its original paper.')
}

/** Preserve exact input text; compare against the note captured when review opened. */
export function prepareAdoption(reviewedNote: string, proposedNote: string, currentNote: string, mode: NoteAdoptionMode): string {
  if (mode !== 'append' && mode !== 'replace') throw new Error('Choose an append or replace action.')
  if (reviewedNote !== currentNote) throw new Error('Your note changed after this review opened. Close and review the suggestion again before applying it.')
  if (!proposedNote.trim()) throw new Error('Keep some text in the suggested note before applying it.')
  const additionalLength = mode === 'append' && currentNote ? currentNote.length + 2 : 0
  if (additionalLength + proposedNote.length > NOTE_CHARACTER_LIMIT) throw new Error('The resulting note exceeds the 2,000,000 character limit. Shorten the suggestion before applying it.')
  return mode === 'append' && currentNote ? currentNote + '\n\n' + proposedNote : proposedNote
}

export function canUndoAdoption(undo: NoteAdoptionUndo | null, currentPaperId: string | null, currentNote: string): boolean {
  return Boolean(undo && undo.paperId && undo.paperId === currentPaperId && undo.after === currentNote && undo.before.length <= NOTE_CHARACTER_LIMIT)
}

export function undoAdoption(undo: NoteAdoptionUndo | null, currentPaperId: string | null, currentNote: string): string {
  if (!undo) throw new Error('No note adoption is available to undo in this session.')
  assertReviewPaper(undo.paperId, currentPaperId)
  if (!canUndoAdoption(undo, currentPaperId, currentNote)) throw new Error('Your note changed after adoption. Undo is unavailable to protect your later edits.')
  return undo.before
}

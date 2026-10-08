import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PaperState } from '../../shared/types'
import { validateState } from '../../main/validation'
import { appendAIResponse } from './readingWorkflow'
import { assertReviewPaper, canUndoAdoption, extractNoteProposal, NOTE_CHARACTER_LIMIT, prepareAdoption, undoAdoption, type NoteAdoptionUndo } from './noteAdoption'

const current: PaperState = { note: 'My original note', lastPage: 4, messages: [] }
const generated = appendAIResponse(current, 'paper-a', '## Suggested headings\n\nKeep uncertainty.', true, 'answer-a').messages[0]

test('only completed non-demo assistant organization messages offer a proposal', () => {
  assert.equal(extractNoteProposal(generated), '## Suggested headings\n\nKeep uncertainty.')
  for (const message of [
    { ...generated, isDemo: true },
    { ...generated, role: 'user' as const },
    { ...generated, content: 'An ordinary answer without an organization wrapper.' },
    { ...generated, content: '> ' + generated.content },
    { ...generated, content: 'Quoted suggestion:\n' + generated.content },
    { ...generated, content: '## Suggested note organization\n\nAlmost the wrapper, but not an organization result.' }
  ]) assert.equal(extractNoteProposal(message), null)
})

test('proposal extraction preserves editable body text and ignores empty wrapped suggestions', () => {
  const body = '\n  ## 中文想法\n\n* Keep literal Markdown.\n'
  const message = appendAIResponse(current, 'paper-a', body, true, 'answer-b').messages[0]
  assert.equal(extractNoteProposal(message), body)
  const empty = appendAIResponse(current, 'paper-a', ' \n\t', true, 'answer-empty').messages[0]
  assert.equal(extractNoteProposal(empty), null)
})

test('append preserves the current note exactly and accepts an edited part of the proposal', () => {
  const reviewed = 'My existing paragraph.\n'
  const edited = '## Only the useful part\n\nKeep this claim qualified.\n'
  assert.equal(prepareAdoption(reviewed, edited, reviewed, 'append'), reviewed + '\n\n' + edited)
  assert.equal(prepareAdoption('', edited, '', 'append'), edited)
})

test('replace is explicit and preserves edited proposal whitespace', () => {
  assert.equal(prepareAdoption('Old note', '\nNew **note**\n', 'Old note', 'replace'), '\nNew **note**\n')
  assert.throws(() => prepareAdoption('Old note', 'New note', 'Old note', 'unexpected' as 'append'), /mode|action/i)
})

test('review compares the note at review time and refuses edits made while the dialog was open', () => {
  assert.equal(prepareAdoption('Latest note at review', 'Proposal from an older generation', 'Latest note at review', 'append'), 'Latest note at review\n\nProposal from an older generation')
  for (const mode of ['append', 'replace'] as const) {
    assert.throws(() => prepareAdoption('Reviewed note', 'Proposal', 'Edited after review opened', mode), /changed|review/i)
  }
})

test('adoption rejects blank proposals and prevents changes to a switched paper', () => {
  for (const blank of ['', ' ', '\n\t']) assert.throws(() => prepareAdoption('Current', blank, 'Current', 'replace'), /empty|text|blank/i)
  assert.doesNotThrow(() => assertReviewPaper('paper-a', 'paper-a'))
  for (const id of ['paper-b', null, '']) assert.throws(() => assertReviewPaper('paper-a', id), /paper|document/i)
  assert.throws(() => assertReviewPaper('', ''), /paper|document/i)
})

test('the resulting note uses the existing two-million-character storage bound', () => {
  assert.equal(NOTE_CHARACTER_LIMIT, 2_000_000)
  const maximum = 'x'.repeat(NOTE_CHARACTER_LIMIT)
  const note = prepareAdoption('Old', maximum, 'Old', 'replace')
  assert.equal(note.length, NOTE_CHARACTER_LIMIT)
  validateState({ ...current, note }, 'paper-a')
  assert.throws(() => prepareAdoption('Old', maximum + 'x', 'Old', 'replace'), /2,?000,?000|limit|long/i)
  const appended = prepareAdoption('A', 'x'.repeat(NOTE_CHARACTER_LIMIT - 3), 'A', 'append')
  assert.equal(appended.length, NOTE_CHARACTER_LIMIT)
  validateState({ ...current, note: appended }, 'paper-a')
  assert.throws(() => prepareAdoption('A', 'x'.repeat(NOTE_CHARACTER_LIMIT - 2), 'A', 'append'), /2,?000,?000|limit|long/i)
})

test('adoption changes only note text and keeps unrelated chat and page state', () => {
  const state = { ...current, messages: [generated] }
  const next = { ...state, note: prepareAdoption(state.note, 'Selected new part', state.note, 'append') }
  assert.equal(next.lastPage, 4)
  assert.equal(next.messages, state.messages)
  assert.equal(state.note, 'My original note')
})

test('guarded session undo restores the exact pre-adoption note only while its result is current', () => {
  const undo: NoteAdoptionUndo = { paperId: 'paper-a', before: 'Original\n', after: 'Original\n\n\nAdopted suggestion' }
  assert.equal(canUndoAdoption(undo, 'paper-a', undo.after), true)
  assert.equal(undoAdoption(undo, 'paper-a', undo.after), undo.before)
  for (const [paperId, note] of [['paper-b', undo.after], ['paper-a', undo.after + '\nMy later edit'], ['paper-a', undo.before]] as const) {
    assert.equal(canUndoAdoption(undo, paperId, note), false)
    assert.throws(() => undoAdoption(undo, paperId, note), /changed|paper|undo/i)
  }
  assert.equal(canUndoAdoption(null, 'paper-a', undo.after), false)
  assert.throws(() => undoAdoption(null, 'paper-a', undo.after), /undo|available/i)
})

test('undo handles replacing a formerly empty note without losing later changes', () => {
  const undo: NoteAdoptionUndo = { paperId: 'paper-a', before: '', after: 'New note' }
  assert.equal(undoAdoption(undo, 'paper-a', 'New note'), '')
  assert.equal(canUndoAdoption(undo, null, 'New note'), false)
})

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Replace, Sparkles, X } from 'lucide-react'
import { NOTE_CHARACTER_LIMIT, type NoteAdoptionMode } from '../noteAdoption'
import { buildNoteDifference } from './noteDifference'
import './noteSuggestionReview.css'

export interface NoteSuggestionReviewProps {
  paperId: string
  originalNote: string
  proposal: string
  disabled: boolean
  onApply(editedProposal: string, mode: NoteAdoptionMode): void | Promise<void>
  onClose(): void
}

export default function NoteSuggestionReview({ paperId, originalNote, proposal, disabled, onApply, onClose }: NoteSuggestionReviewProps) {
  const titleId = useId(), descriptionId = useId()
  const [edited, setEdited] = useState(proposal)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  const operation = useRef(0), applying = useRef(false)
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    editor.current?.focus()
    return () => { ++operation.current; if (previousFocus?.isConnected) previousFocus.focus() }
  }, [])
  useEffect(() => {
    ++operation.current; applying.current = false
    setEdited(proposal); setError(''); setPending(false)
  }, [paperId, originalNote, proposal])
  const difference = useMemo(() => buildNoteDifference(originalNote, edited), [originalNote, edited])
  const locked = disabled || pending
  const hasText = Boolean(edited.trim())
  const appendLength = edited.length + (originalNote ? originalNote.length + 2 : 0)
  const canAppend = hasText && appendLength <= NOTE_CHARACTER_LIMIT
  const canReplace = hasText && edited.length <= NOTE_CHARACTER_LIMIT

  async function apply(mode: NoteAdoptionMode) {
    if (disabled || applying.current || !(mode === 'append' ? canAppend : canReplace)) return
    applying.current = true; setPending(true); setError('')
    const token = ++operation.current
    try { await onApply(edited, mode) }
    catch (failure) { if (operation.current === token) setError(failure instanceof Error ? failure.message : 'The suggestion could not be applied. Please try again.') }
    finally { if (operation.current === token) { applying.current = false; setPending(false) } }
  }

  function handleKey(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      if (!locked) onClose()
      return
    }
    if (event.key !== 'Tab') return
    const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), [tabindex="0"]')
    if (!elements?.length) { event.preventDefault(); return }
    const first = elements[0], last = elements[elements.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return <div className="note-review-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !locked) onClose() }}>
    <div ref={dialog} className="note-review-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={pending} onKeyDown={handleKey}>
      <header className="note-review-header">
        <div><span className="note-review-eyebrow"><Sparkles size={13}/>YOUR NOTE, YOUR CHOICE</span><h2 id={titleId}>Review note suggestion</h2></div>
        <button type="button" className="icon-button" aria-label="Close note suggestion" disabled={locked} onClick={onClose}><X size={18}/></button>
      </header>
      <p id={descriptionId} className="note-review-description">Compare with your note as it is now. Edit the suggestion to keep only what you want, then choose how to apply it.</p>
      <form className="note-review-form" onSubmit={event => { event.preventDefault(); void apply('append') }}>
        <div className="note-review-columns">
          <label className="note-review-pane"><span className="note-review-pane-heading"><strong>Current note</strong><small>{originalNote.length.toLocaleString()} characters</small></span><span className="note-review-pane-hint">Snapshot taken when this review opened</span><textarea aria-label="Current note" readOnly value={originalNote} placeholder="Your current note is empty." spellCheck={false}/></label>
          <label className="note-review-pane proposed"><span className="note-review-pane-heading"><strong>Suggested note</strong><small>{edited.length.toLocaleString()} characters</small></span><span className="note-review-pane-hint">Edit this proposal before applying it</span><textarea ref={editor} aria-label="Suggested note" disabled={locked} value={edited} onChange={event => { setEdited(event.target.value); setError('') }} spellCheck={false}/></label>
        </div>
        <details className="note-review-differences" open>
          <summary>Changes from current note <span>{difference.changed ? `${difference.removedLines.toLocaleString()} removed / ${difference.addedLines.toLocaleString()} added lines` : 'No text changes'}</span></summary>
          <p className="note-review-diff-hint">Removed (−) and added (+) text includes moves. Review meaning and qualifiers before applying. Both full notes remain editable or readable above.</p>
          {difference.changed && <div className="note-review-diff-lines" role="region" aria-label="Note line differences" tabIndex={0}>
            {difference.rows.map((row, index) => <div key={index} className={`note-review-diff-line ${row.kind}`} data-change={row.kind}>
              <span className="note-review-diff-number" aria-label={row.kind === 'added' ? 'Suggested line' : 'Current line'}>{row.kind === 'added' ? row.proposedLine : row.originalLine}</span>
              <span className="note-review-diff-sign" aria-hidden="true">{row.kind === 'removed' ? '−' : row.kind === 'added' ? '+' : ' '}</span>
              <span className="note-review-diff-text">{row.text || ' '}</span>
            </div>)}
          </div>}
          {difference.truncated && <p className="note-review-diff-limited" role="status">Preview limited to 160 lines and 24,000 characters; long lines are shortened here. Compare the complete notes above for remaining changes.</p>}
        </details>
        <div className="note-review-feedback">
          {error ? <p role="alert">{error}</p> : edited.length > NOTE_CHARACTER_LIMIT ? <p role="status">The suggestion exceeds the 2,000,000 character note limit. Shorten it before applying.</p> : hasText && !canAppend ? <p role="status">Appending would exceed the note limit. Shorten the suggestion, or replace the note.</p> : <p>Append keeps your current note and adds the edited suggestion below it. Replace uses only the edited suggestion.</p>}
        </div>
        <footer className="note-review-footer">
          <span>{pending ? 'Applying your selection…' : 'Your note changes only after you apply.'}</span>
          <button type="button" className="note-review-replace" aria-label="Replace note" disabled={locked || !canReplace} onClick={() => void apply('replace')}><Replace size={14}/>Replace note</button>
          <button type="submit" className="note-review-append" aria-label="Append to note" disabled={locked || !canAppend}><ArrowDownToLine size={15}/>{pending ? 'Applying…' : 'Append to note'}</button>
        </footer>
      </form>
    </div>
  </div>
}

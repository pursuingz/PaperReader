import { useEffect, useRef, useState } from 'react'
import { BookOpen, X } from 'lucide-react'
import type { Paper, PaperMetadata } from '../../../shared/types'
import { paperInformationInput } from '../libraryMetadata'

interface Props { paper: Paper; onSave(paperId: string, input: PaperMetadata): Promise<void>; onClose(): void }
export default function PaperInformationEditor({ paper, onSave, onClose }: Props) {
  const [title, setTitle] = useState(paper.title), [authors, setAuthors] = useState(paper.authors ?? ''), [year, setYear] = useState(paper.year == null ? '' : String(paper.year))
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const dialog = useRef<HTMLFormElement>(null), savingRef = useRef(false), closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!savingRef.current) closeRef.current(); return }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])
      if (!controls.length) { event.preventDefault(); dialog.current?.focus(); return }
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus() }
  }, [])
  const save = async () => {
    if (savingRef.current) return
    setError('')
    try {
      const input = paperInformationInput(title, authors, year)
      savingRef.current = true; setSaving(true)
      await onSave(paper.id, input)
      onClose()
    } catch (failure) { setError(String(failure instanceof Error ? failure.message : failure)) }
    finally { savingRef.current = false; setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !savingRef.current) onClose() }}>
    <form ref={dialog} tabIndex={-1} className="paper-information-editor" role="dialog" aria-modal="true" aria-labelledby="paper-information-title" onSubmit={event => { event.preventDefault(); void save() }}>
      <div className="paper-information-top"><span><BookOpen size={21}/></span><button type="button" className="icon-button" aria-label="Close paper information" disabled={saving} onClick={onClose}><X size={18}/></button></div>
      <h2 id="paper-information-title">Paper information</h2>
      <p>Correct these details for your library and AI reading context.</p>
      <label>Title<input aria-label="Paper title" value={title} maxLength={300} disabled={saving} onChange={event => setTitle(event.target.value)}/></label>
      <label>Authors <small>Optional · free text</small><input aria-label="Paper authors" placeholder="Author One; Author Two" value={authors} maxLength={1000} disabled={saving} onChange={event => setAuthors(event.target.value)}/></label>
      <label>Publication year <small>Optional</small><input aria-label="Publication year" inputMode="numeric" placeholder="2026" value={year} maxLength={4} disabled={saving} onChange={event => setYear(event.target.value)}/></label>
      <p className="paper-information-file">Imported file: <span>{paper.fileName}</span></p>
      {error && <p className="paper-information-error" role="alert">{error}</p>}
      <div className="paper-information-buttons"><button type="button" className="secondary-button" aria-label="Cancel paper information" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="primary-button" aria-label="Save paper information" disabled={saving}>{saving ? 'Saving…' : 'Save information'}</button></div>
    </form>
  </div>
}

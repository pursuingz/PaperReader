import { Check, Download, Sparkles, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import type { ReadingMarks } from '../../../shared/types'
import { EVIDENCE_DRAG_MIME } from '../evidenceDrag'
import HighlightList, { type HighlightListProps } from './HighlightList'
import MarkdownNoteEditor from './MarkdownNoteEditor'

export type NoteTab = 'text' | 'highlights' | 'mind-map' | 'canvas'
interface Props {
  paperId: string; note: string; placeholder: string; noteReady: boolean; noteStatus: string
  marks: ReadingMarks; marksReady: boolean; marksStatus: string; tab: NoteTab
  onTab(tab: NoteTab): void; onNote(note: string): void; onMarks(marks: ReadingMarks): void
  onPage(page: number): void; onSave(): void; onNotice(message: string): void
  onOrganize(): void; onExport(): void; organizing: boolean; exporting: boolean; exportReady: boolean
  registerNoteCommit?(commit: () => Promise<void>): () => void
  undoAdoption?: { enabled: boolean; onUndo(): void }
  canvas?: ReactNode; canvasReady?: boolean; canvasStatus?: string; canvasCount?: number
  mindMap?: ReactNode; mindMapReady?: boolean; mindMapStatus?: string; mindMapCount?: number
  onAddHighlightToCanvas?(id: string): void; canvasImportReady?: boolean; canvasImporting?: boolean
  highlightEditing: Pick<HighlightListProps, 'onColor' | 'onRemove' | 'onUndo' | 'onRedo' | 'canUndo' | 'canRedo'>
}
export default function ReadingNotes(props: Props) {
  const { note, marks, tab, noteReady, marksReady } = props
  const mounted = useRef(true)
  const currentPaper = useRef(props.paperId)
  currentPaper.current = props.paperId
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const commitNote = useRef<(() => Promise<void>) | null>(null)
  const registerCommit = useCallback((commit: () => Promise<void>) => {
    commitNote.current = commit
    const release = props.registerNoteCommit?.(commit)
    return () => { if (commitNote.current === commit) commitNote.current = null; release?.() }
  }, [props.registerNoteCommit])
  const afterCommit = (action: () => void) => {
    const paper = props.paperId
    void (commitNote.current?.() ?? Promise.resolve()).then(() => { if (mounted.current && currentPaper.current === paper) action() }).catch(() => { if (mounted.current && currentPaper.current === paper) props.onNotice('Finish the current note edit and try again.') })
  }
  const status = tab === 'text' ? props.noteStatus : tab === 'highlights' ? props.marksStatus : tab === 'mind-map' ? props.mindMapStatus : props.canvasStatus
  const ready = tab === 'text' ? noteReady : tab === 'highlights' ? marksReady : tab === 'mind-map' ? props.mindMapReady : props.canvasReady
  return <>
    <div className="note-subtabs canvas-note-subtabs" role="tablist" aria-label="Note type">{(['text', 'highlights', 'mind-map', 'canvas'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => afterCommit(() => props.onTab(value))} onDragEnter={event => {
      if (value !== 'canvas' || !event.dataTransfer.types.includes(EVIDENCE_DRAG_MIME)) return
      event.preventDefault()
      if (tab !== 'canvas') afterCommit(() => props.onTab('canvas'))
    }} onDragOver={event => { if (value === 'canvas' && event.dataTransfer.types.includes(EVIDENCE_DRAG_MIME)) event.preventDefault() }}>{value === 'text' ? 'Text' : value === 'highlights' ? 'Highlights' : value === 'mind-map' ? 'Mind map' : 'Canvas'}{value === 'highlights' && marks.highlights.length > 0 && <span>{marks.highlights.length}</span>}</button>)}</div>
    {(tab === 'text' || tab === 'highlights') && <div className="note-workflow-actions"><button aria-label="Organize with AI" disabled={!noteReady || !note.trim() || props.organizing || props.exporting} onClick={() => afterCommit(props.onOrganize)}><Sparkles size={12}/>Organize with AI</button><button aria-label="Export reading notes" disabled={!props.exportReady || props.exporting} onClick={() => afterCommit(props.onExport)}><Download size={12}/>{props.exporting ? 'Exporting…' : 'Export .md'}</button></div>}
    {tab === 'text' && props.undoAdoption && <div className="note-adoption-undo"><button aria-label="Undo note adoption" disabled={!noteReady || !props.undoAdoption.enabled} onClick={() => afterCommit(props.undoAdoption!.onUndo)}><Undo2 size={12}/>Undo adoption</button><small>{props.undoAdoption.enabled ? 'Available until you edit this note or leave the paper.' : 'Later edits are kept; undo is unavailable.'}</small></div>}
    {tab === 'text' ? <MarkdownNoteEditor key={props.paperId} value={note} disabled={!noteReady} placeholder={props.placeholder} onChange={props.onNote} onSave={props.onSave} registerCommit={registerCommit}/> : tab === 'canvas' ? props.canvas : tab === 'mind-map' ? props.mindMap : <HighlightList ready={marksReady} highlights={marks.highlights} onPage={props.onPage} {...props.highlightEditing} onAddToCanvas={props.onAddHighlightToCanvas} canvasReady={props.canvasImportReady} copyingToCanvas={props.canvasImporting} onComment={(id, comment) => props.onMarks({ ...marks, highlights: marks.highlights.map(item => item.id === id ? { ...item, comment } : item) })}/>}
    {tab !== 'canvas' && <div className="note-footer"><span><Check size={13}/>{status}</span><button disabled={!ready || props.canvasImporting} onClick={() => afterCommit(props.onSave)}>Save now</button></div>}
  </>
}

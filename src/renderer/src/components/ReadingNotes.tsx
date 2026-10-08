import { Check, Download, Sparkles, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ReadingMarks } from '../../../shared/types'
import InkPad, { type InkPadProps } from './InkPad'
import HighlightList, { type HighlightListProps } from './HighlightList'

export type NoteTab = 'text' | 'ink' | 'highlights' | 'canvas'
interface Props {
  paperId: string; note: string; placeholder: string; noteReady: boolean; noteStatus: string
  marks: ReadingMarks; marksReady: boolean; marksStatus: string; tab: NoteTab
  onTab(tab: NoteTab): void; onNote(note: string): void; onMarks(marks: ReadingMarks): void
  onPage(page: number): void; onSave(): void; onNotice(message: string): void
  onOrganize(): void; onExport(): void; organizing: boolean; exporting: boolean; exportReady: boolean
  undoAdoption?: { enabled: boolean; onUndo(): void }
  canvas?: ReactNode; canvasReady?: boolean; canvasStatus?: string; canvasCount?: number
  ink: Omit<InkPadProps, 'strokes' | 'disabled'>
  highlightEditing: Pick<HighlightListProps, 'onColor' | 'onRemove' | 'onUndo' | 'onRedo' | 'canUndo' | 'canRedo'>
}
export default function ReadingNotes(props: Props) {
  const { note, marks, tab, noteReady, marksReady } = props
  return <>
    <div className="note-heading"><div><span className="eyebrow">YOUR THINKING SPACE</span><h3>Reading notes</h3></div><span className="note-count">{tab === 'text' ? `${note.length} chars` : tab === 'highlights' ? `${marks.highlights.length} saved` : tab === 'canvas' ? `${props.canvasCount ?? 0} objects` : `${marks.strokes.length} strokes`}</span></div>
    <div className="note-subtabs" role="tablist" aria-label="Note type">{(['text', 'ink', 'highlights', 'canvas'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => props.onTab(value)}>{value === 'text' ? 'Text' : value === 'ink' ? 'Ink' : value === 'canvas' ? 'Canvas' : 'Highlights'}{value === 'highlights' && marks.highlights.length > 0 && <span>{marks.highlights.length}</span>}</button>)}</div>
    <div className="note-workflow-actions"><button aria-label="Organize with AI" disabled={!noteReady || !note.trim() || props.organizing || props.exporting} onClick={props.onOrganize}><Sparkles size={12}/>Organize with AI</button><button aria-label="Export reading notes" disabled={!props.exportReady || props.exporting} onClick={props.onExport}><Download size={12}/>{props.exporting ? 'Exporting…' : 'Export .md'}</button><small>Organize sends only text notes. Your original stays unchanged.<br/>Export includes text, highlights and summary; drawings stay local.</small></div>
    {tab === 'text' && props.undoAdoption && <div className="note-adoption-undo"><button aria-label="Undo note adoption" disabled={!noteReady || !props.undoAdoption.enabled} onClick={props.undoAdoption.onUndo}><Undo2 size={12}/>Undo adoption</button><small>{props.undoAdoption.enabled ? 'Available until you edit this note or leave the paper.' : 'Later edits are kept; undo is unavailable.'}</small></div>}
    {tab === 'text' ? <textarea className="note-editor" disabled={!noteReady} aria-label="Paper notes" placeholder={props.placeholder} value={note} onChange={event => props.onNote(event.target.value)} onBlur={props.onSave}/> : tab === 'ink' ? <InkPad key={props.paperId} disabled={!marksReady} strokes={marks.strokes} {...props.ink}/> : tab === 'canvas' ? props.canvas : <HighlightList ready={marksReady} highlights={marks.highlights} onPage={props.onPage} {...props.highlightEditing} onComment={(id, comment) => props.onMarks({ ...marks, highlights: marks.highlights.map(item => item.id === id ? { ...item, comment } : item) })}/>}
    <div className="note-footer"><span><Check size={13}/>{tab === 'text' ? props.noteStatus : tab === 'canvas' ? props.canvasStatus : props.marksStatus}</span><button disabled={tab === 'text' ? !noteReady : tab === 'canvas' ? !props.canvasReady : !marksReady} onClick={props.onSave}>Save now</button></div>
  </>
}

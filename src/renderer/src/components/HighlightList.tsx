import { highlightColorHex } from '../../../shared/colors'
import ColorPicker from './ColorPicker'
import { Highlighter, Plus, Redo2, Trash2, Undo2 } from 'lucide-react'
import type { Highlight } from '../../../shared/types'
import '../annotation-tools.css'

export interface HighlightListProps {
  highlights: Highlight[]; ready: boolean; onPage(page: number): void; onComment(id: string, comment: string): void
  onColor(id: string, color: Highlight['color']): void; onRemove(id: string): void
  onUndo(): void; onRedo(): void; canUndo: boolean; canRedo: boolean
  onAddToCanvas?(id: string): void; canvasReady?: boolean; copyingToCanvas?: boolean
}
export default function HighlightList({ highlights, ready, onPage, onComment, onColor, onRemove, onUndo, onRedo, canUndo, canRedo, onAddToCanvas, canvasReady = false, copyingToCanvas = false }: HighlightListProps) {
  return <div className="highlights-list"><div className="highlight-history"><span>Highlight edits</span><button className="icon-button" aria-label="Undo highlight edit" disabled={!ready || !canUndo} onClick={onUndo}><Undo2 size={15}/></button><button className="icon-button" aria-label="Redo highlight edit" disabled={!ready || !canRedo} onClick={onRedo}><Redo2 size={15}/></button></div>
    {highlights.length === 0 ? <div className="marks-empty"><Highlighter size={23}/><h4>Keep the lines that matter.</h4><p>Select text in the PDF, then choose Highlight below. Add a comment here whenever an idea follows.</p>{!ready && <small>Saved marks must load before editing.</small>}</div> : highlights.map(item => <article className="highlight-card" key={item.id}>
      <div className="highlight-card-top"><span className="highlight-swatch" style={{background:highlightColorHex(item.color)}}/><button onClick={() => onPage(item.page)} aria-label={`Highlight: open page ${item.page}`}>Page {item.page}</button><small>{new Date(item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</small></div>
      <blockquote>{item.quote}</blockquote><textarea disabled={!ready} aria-label={`Comment on highlight from page ${item.page}`} placeholder="Add a thought…" maxLength={20000} value={item.comment} onChange={event => onComment(item.id, event.target.value)}/>
      <div className="highlight-editing">{onAddToCanvas && <button type="button" className="highlight-add-canvas" disabled={!ready || !canvasReady || copyingToCanvas} aria-busy={copyingToCanvas} aria-label={`Add highlight from page ${item.page} to Canvas`} onClick={() => onAddToCanvas(item.id)}><Plus size={13} aria-hidden="true"/>{copyingToCanvas ? 'Copying…' : 'Add to Canvas'}</button>}<ColorPicker label="Highlight color" value={item.color} disabled={!ready} onChange={color=>onColor(item.id,color as Highlight['color'])}/><button className="highlight-remove" disabled={!ready} aria-label={`Remove highlight from page ${item.page}`} onClick={() => onRemove(item.id)}><Trash2 size={12}/>Remove</button></div>
    </article>)}
  </div>
}

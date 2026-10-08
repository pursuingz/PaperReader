import { Highlighter, Redo2, Trash2, Undo2 } from 'lucide-react'
import type { Highlight } from '../../../shared/types'
import '../annotation-tools.css'

export interface HighlightListProps {
  highlights: Highlight[]; ready: boolean; onPage(page: number): void; onComment(id: string, comment: string): void
  onColor(id: string, color: Highlight['color']): void; onRemove(id: string): void
  onUndo(): void; onRedo(): void; canUndo: boolean; canRedo: boolean
}
export default function HighlightList({ highlights, ready, onPage, onComment, onColor, onRemove, onUndo, onRedo, canUndo, canRedo }: HighlightListProps) {
  return <div className="highlights-list"><div className="highlight-history"><span>Highlight edits</span><button className="icon-button" aria-label="Undo highlight edit" disabled={!ready || !canUndo} onClick={onUndo}><Undo2 size={15}/></button><button className="icon-button" aria-label="Redo highlight edit" disabled={!ready || !canRedo} onClick={onRedo}><Redo2 size={15}/></button></div>
    {highlights.length === 0 ? <div className="marks-empty"><Highlighter size={23}/><h4>Keep the lines that matter.</h4><p>Select text in the PDF, then choose Highlight below. Add a comment here whenever an idea follows.</p>{!ready && <small>Saved marks must load before editing.</small>}</div> : highlights.map(item => <article className="highlight-card" key={item.id}>
      <div className="highlight-card-top"><span className={`highlight-swatch highlight-${item.color}`}/><button onClick={() => onPage(item.page)} aria-label={`Highlight: open page ${item.page}`}>Page {item.page}</button><small>{new Date(item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</small></div>
      <blockquote>{item.quote}</blockquote><textarea disabled={!ready} aria-label={`Comment on highlight from page ${item.page}`} placeholder="Add a thought…" maxLength={20000} value={item.comment} onChange={event => onComment(item.id, event.target.value)}/>
      <div className="highlight-editing"><div className="highlight-color-choices">{(['yellow', 'coral', 'mint'] as const).map(color => <button key={color} className={`highlight-swatch highlight-${color} ${item.color === color ? 'selected' : ''}`} disabled={!ready} aria-label={`${color[0].toUpperCase() + color.slice(1)} highlight color`} aria-pressed={item.color === color} onClick={() => onColor(item.id, color)}/>)}</div><button className="highlight-remove" disabled={!ready} aria-label={`Remove highlight from page ${item.page}`} onClick={() => onRemove(item.id)}><Trash2 size={12}/>Remove</button></div>
    </article>)}
  </div>
}

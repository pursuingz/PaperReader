import { FileText, RefreshCw, Sparkles, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { PaperSummary } from '../../../shared/types'
import MarkdownContent from './MarkdownContent'

interface Props {
  summary: PaperSummary | null; ready: boolean; busy: boolean; status: string
  onGenerate(): void; onCancel(): void; onRetry(): void; onPage(page: number): void
  sources?: ReactNode
}
export default function PaperSummaryView({ summary, ready, busy, status, onGenerate, onCancel, onRetry, onPage, sources }: Props) {
  return <div className="live-summary">
    <div className="summary-heading"><div><span className="eyebrow">THE BIG PICTURE</span><h2>A paper, at a glance.</h2></div><span className="ai-summary-badge"><Sparkles size={11}/>AI GENERATED</span></div>
    <div className="summary-controls"><p>Generate sends the extracted full-paper text to DeepSeek. Long papers may use several requests; a cut-off response gets one automatic retry. Up to 200 pages / 240,000 characters; image-only pages need OCR.</p>
      {busy ? <button className="secondary-button" onClick={onCancel}><X size={14}/>Cancel summary</button> : <button className="primary-button" disabled={!ready} onClick={onGenerate}>{summary ? <RefreshCw size={13}/> : <Sparkles size={13}/>} {summary ? 'Regenerate summary' : 'Generate summary'}</button>}
    </div>
    {status && <div className="summary-job-status" role="status">{busy && <span className="loading-dot"/>}{status}{!ready && status.startsWith('Saved summary unavailable') && <button className="text-action" onClick={onRetry}>Retry summary load</button>}</div>}
    {summary ? <>
      <div className="summary-provenance"><span>{summary.model}</span><time dateTime={summary.createdAt}>{new Date(summary.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time><strong>{summary.coveredPages.length} / {summary.pageCount} pages with text</strong></div>
      {summary.missingPages.length > 0 && <div className="summary-missing"><strong>No readable text:</strong><span>{summary.missingPages.map(page => <button key={page} onClick={() => onPage(page)} aria-label={`Open textless page ${page}`}>p. {page}</button>)}</span></div>}
      <p className="summary-caution">AI-generated interpretation. Page links locate cited evidence; verify the claims against the original.</p>
      <div className="summary-cards live-summary-cards">{summary.sections.map((section, index) => <article className={`summary-card card-${index}`} key={section.id} data-section={section.id}>
        <h3><span>{['⌘', '▤', '☼', '⚙', '▥', '◇'][index]}</span>{section.title}</h3><MarkdownContent content={section.content}/>
        {section.pages.length > 0 && <div className="source-pages"><span>Source</span>{section.pages.map(page => <button key={page} onClick={() => onPage(page)} aria-label={`${section.title}: open page ${page}`}>p. {page}</button>)}</div>}
      </article>)}</div>
    </> : !busy && ready && <div className="summary-intro"><FileText size={30}/><h3>The whole argument, in one place.</h3><p>Keywords, overview, background, methods, results and limitations — with page links back to your paper.</p></div>}
    {sources}
  </div>
}

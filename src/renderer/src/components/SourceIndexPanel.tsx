import { useEffect, useMemo, useRef, useState } from 'react'
import { FileSearch, List, RefreshCw, X } from 'lucide-react'
import { pdfjs } from 'react-pdf'
import type { DesktopAPI, PaperSourceIndex } from '../../../shared/types'
import { LocalSourceIndex } from '../sourceIndexSession'
import './sourceIndexPanel.css'
import SummaryFigureGallery from './SummaryFigureGallery'
import StructuredTablesPanel from './StructuredTablesPanel'
import ReferencesPanel from './ReferencesPanel'

export interface SourceIndexPanelProps { api: DesktopAPI; paperId: string; disabled?: boolean; onPage(page: number): void }
interface View { id: string; index: PaperSourceIndex | null; loading: boolean; busy: boolean; cacheFailed: boolean; status: string; error: string }
const initial = (id: string): View => ({ id, index: null, loading: true, busy: false, cacheFailed: false, status: 'Loading saved source index…', error: '' })

/** Original PDF text sits outside the six AI summary cards and works without a provider key. */
export default function SourceIndexPanel({ api, paperId, disabled = false, onPage }: SourceIndexPanelProps) {
  const [view, setView] = useState<View>(() => initial(paperId))
  const epoch = useRef(0), currentPaper = useRef(paperId), running = useRef(false)
  currentPaper.current = paperId
  const session = useMemo(() => new LocalSourceIndex(api, bytes => pdfjs.getDocument({ data: bytes })), [api])
  useEffect(() => {
    const token = ++epoch.current
    running.current = false
    setView(initial(paperId)); void session.cancel()
    void api.loadSourceIndex(paperId).then(index => {
      if (epoch.current === token) setView({ ...initial(paperId), index, loading: false, status: '' })
    }).catch(error => {
      if (epoch.current === token) setView({ ...initial(paperId), loading: false, cacheFailed: true, status: '', error: `Saved source index unavailable. Rebuild this derived index to try again. ${error instanceof Error ? error.message : String(error)}` })
    })
    return () => { ++epoch.current; void session.cancel() }
  }, [api, paperId, session])
  const state = view.id === paperId ? view : initial(paperId)
  async function build() {
    if (disabled || running.current || state.busy || state.loading) return
    running.current = true
    const token = ++epoch.current, id = paperId
    setView(previous => ({ ...previous, busy: true, error: '', status: 'Opening the local PDF…' }))
    const alive = () => token === epoch.current && currentPaper.current === id
    try {
      const index = await session.run(id, (page, total) => { if (alive()) setView(previous => ({ ...previous, status: `Reading original text: page ${page} of ${total}…` })) })
      if (index && alive()) setView(previous => ({ ...previous, index, cacheFailed: false, status: 'Source index saved locally.' }))
    } catch (error) { if (alive()) setView(previous => ({ ...previous, status: '', error: error instanceof Error ? error.message : String(error) })) }
    finally { if (alive()) { running.current = false; setView(previous => ({ ...previous, busy: false })) } }
  }
  async function cancel() {
    const token = ++epoch.current, id = paperId
    setView(previous => ({ ...previous, status: 'Cancelling source indexing…' }))
    await session.cancel()
    if (token === epoch.current && currentPaper.current === id) { running.current = false; setView(previous => ({ ...previous, busy: false, status: 'Indexing cancelled. A completed index may already have been saved.' })) }
  }
  const index = state.index
  const attempted = index ? index.indexedPages.length + index.textlessPages.length + index.failedPages.length : 0
  const groups = [
    { name: 'Figure captions', kinds: ['figure'], empty: 'No figure-caption candidates found in the indexed text.' },
    { name: 'Table captions', kinds: ['table'], empty: 'No table-caption candidates found in the indexed text.' },
    { name: 'References', kinds: ['reference', 'reference-section'], empty: 'No reference-section candidates found in the indexed text.' }
  ]
  return <section className="source-index-panel" role="region" aria-label="Paper source index">
    <header className="source-index-heading"><div><span className="source-index-eyebrow"><List size={12}/>ORIGINAL PDF TEXT</span><h3>Paper sources</h3></div><span className="source-index-local">Local extraction</span></header>
    <p className="source-index-description">Explore original figures, experimental tables and references. Local extraction keeps the source pages; crop figure images, extract table cells, or explicitly check a reference against Crossref. No AI summary or API key is required.</p>
    <div className="source-index-controls">{state.busy ? <button type="button" onClick={() => void cancel()} aria-label="Cancel source indexing"><X size={13}/>Cancel source indexing</button> : <button type="button" disabled={disabled || state.loading} onClick={() => void build()} aria-label={index || state.cacheFailed ? 'Rebuild source index' : 'Index paper sources'}>{index || state.cacheFailed ? <RefreshCw size={13}/> : <FileSearch size={13}/>}{index || state.cacheFailed ? 'Rebuild source index' : 'Index paper sources'}</button>}<small>No API key or AI summary required.</small></div>
    {state.status && <p className="source-index-status" role="status">{state.status}</p>}
    {state.error && <p className="source-index-error" role="alert">{state.error}</p>}
    {index && <>
      <div className="source-index-coverage"><strong>{index.indexedPages.length} / {index.pageCount} pages with readable text</strong><span>{attempted} pages attempted · {index.entries.length} candidates</span></div>
      {(index.limitReached || index.failedPages.length > 0 || attempted < index.pageCount) && <p className="source-index-partial">Partial source index.{index.limitReached && ' A scan or candidate limit was reached; some source text may be omitted.'}{index.failedPages.length > 0 && ` ${index.failedPages.length} pages could not be read.`}{attempted < index.pageCount && ` ${index.pageCount - attempted} pages were not indexed.`}</p>}
      {index.textlessPages.length > 0 && <p className="source-index-pages">No readable text (OCR is not included): {index.textlessPages.map(page => <button key={page} disabled={disabled} onClick={() => onPage(page)} aria-label={`Source textless page ${page}`}>p. {page}</button>)}</p>}
      {index.failedPages.length > 0 && <p className="source-index-pages">Could not read: {index.failedPages.map(page => <button key={page} disabled={disabled} onClick={() => onPage(page)} aria-label={`Source failed page ${page}`}>p. {page}</button>)}</p>}
      <div className="summary-evidence-modules">
        <SummaryFigureGallery api={api} paperId={paperId} entries={index.entries.filter(entry => entry.kind === 'figure')} disabled={disabled || state.busy} onPage={onPage}/>
        <StructuredTablesPanel api={api} paperId={paperId} index={index} disabled={disabled || state.busy} onPage={onPage}/>
        <ReferencesPanel api={api} paperId={paperId} index={index} disabled={disabled || state.busy} onPage={onPage}/>
      </div>
      <details className="source-index-raw"><summary>Original caption and reference index</summary>
      <div className="source-index-groups">{groups.map(group => {
        const entries = index.entries.filter(entry => group.kinds.includes(entry.kind))
        return <details key={group.name} className="source-index-group" open={entries.length > 0}><summary>{group.name}<span>{entries.length}</span></summary>{entries.length ? entries.map(entry => <article className="source-index-entry" key={entry.id}><div className="source-index-entry-title"><strong>{entry.label}</strong><span>{entry.kind === 'reference-section' ? 'Original section · uncertain segmentation' : 'Candidate'}</span></div><p className="source-index-original">{entry.text}</p><div className="source-index-entry-pages"><span>Source</span>{entry.pages.map(page => <button key={page} disabled={disabled} aria-label={`${entry.label}: source page ${page}`} onClick={() => onPage(page)}>p. {page}</button>)}</div></article>) : <p className="source-index-empty">{group.empty}</p>}</details>
      })}</div>
      </details>
    </>}
    <p className="source-index-limits">Source index reads up to 200 pages / 240,000 text characters. Layouts and captions may be incomplete. Figure crops are selected manually; table candidates need checking against the original. OCR, automatic precise figure cropping and visual chart interpretation are not included.</p>
  </section>
}

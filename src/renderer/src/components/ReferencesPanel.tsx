import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, RefreshCw, SearchCheck } from 'lucide-react'
import type { DesktopAPI, PaperReferences, PaperSourceIndex, ReferenceVerification } from '../../../shared/types'
import { ReferencesSession } from '../referencesSession'
import './referencesPanel.css'

export interface ReferencesPanelProps { api: DesktopAPI; paperId: string; index: PaperSourceIndex | null; disabled?: boolean; onPage(page: number): void }
interface View { id: string; document: PaperReferences | null; loading: boolean; busy: string; failedLoad: boolean; status: string; error: string }
const initial = (id: string): View => ({ id, document: null, loading: true, busy: '', failedLoad: false, status: '', error: '' })
const statusLabel = (value: ReferenceVerification['status'] | undefined) => ({ matched: 'Metadata matched', ambiguous: 'Ambiguous metadata', conflict: 'Metadata conflict', 'not-found': 'No record found', unverified: 'Not checked' })[value ?? 'unverified']

export default function ReferencesPanel({ api, paperId, index, disabled = false, onPage }: ReferencesPanelProps) {
  const session = useMemo(() => new ReferencesSession(api), [api])
  const [view, setView] = useState<View>(() => initial(paperId)), [visibleCount, setVisibleCount] = useState(20)
  const epoch = useRef(0), currentPaper = useRef(paperId), running = useRef(false)
  currentPaper.current = paperId
  useEffect(() => {
    const token = ++epoch.current
    running.current = false; setView(initial(paperId)); setVisibleCount(20)
    void session.load(paperId).then(document => {
      if (token === epoch.current) setView({ ...initial(paperId), document, loading: false })
    }).catch(error => {
      if (token === epoch.current) setView({ ...initial(paperId), loading: false, failedLoad: true, error: `Saved references unavailable. Existing files were preserved. Rebuild this derived list to try again. ${error instanceof Error ? error.message : String(error)}` })
    })
    return () => { ++epoch.current; session.cancel() }
  }, [paperId, session])
  const state = view.id === paperId ? view : initial(paperId), document = state.document
  const stale = Boolean(document && (!index || document.sourceCreatedAt !== index.createdAt))
  const locked = disabled || state.loading || Boolean(state.busy)
  async function execute(referenceId?: string) {
    if (disabled || state.loading || running.current || !index || (referenceId && (stale || state.failedLoad))) return
    running.current = true
    const token = ++epoch.current, id = paperId
    const alive = () => token === epoch.current && currentPaper.current === id
    setView(previous => ({ ...previous, busy: referenceId ?? 'build', error: '', status: referenceId ? 'Checking this reference with Crossref…' : 'Parsing indexed references locally…' }))
    try {
      const next = referenceId ? await session.verify(id, referenceId) : await session.build(id)
      if (next && alive()) {
        setView(previous => ({ ...previous, document: next, failedLoad: false, status: referenceId ? 'Crossref comparison saved locally. Review the original citation and metadata below.' : 'Reference candidates parsed and saved locally. No remote request was sent.' }))
        if (!referenceId) setVisibleCount(20)
      }
    } catch (error) {
      if (alive()) setView(previous => ({ ...previous, status: '', error: error instanceof Error ? error.message : String(error) }))
    } finally {
      if (alive()) { running.current = false; setView(previous => ({ ...previous, busy: '' })) }
    }
  }
  const records = document?.records ?? []
  return <section className="references-panel" role="region" aria-label="Structured references">
    <header className="references-heading"><div><span className="references-eyebrow"><BookOpen size={12}/>BIBLIOGRAPHY</span><h3>Structured references</h3></div><span className="references-local">Parsed locally</span></header>
    <p className="references-description">Original citations stay separate from parsed fields. Verify with Crossref sends only that reference’s DOI or citation text to Crossref. It does not send your paper, notes or API key. Matching metadata does not verify scientific claims.</p>
    <div className="references-controls"><button type="button" disabled={locked || !index} onClick={() => void execute()} aria-label={document || state.failedLoad ? 'Rebuild references' : 'Parse references'}><RefreshCw size={13}/>{document || state.failedLoad ? 'Rebuild references' : 'Parse references'}</button><small>{state.loading ? 'Loading saved references…' : 'Local parsing needs no API key.'}</small></div>
    {!index && <p className="references-status">Index paper sources first to parse the original references.</p>}
    {state.status && <p className="references-status" role="status">{state.status}</p>}
    {state.error && <p className="references-error" role="alert">{state.error}</p>}
    {stale && <p className="references-warning">The source index changed. Rebuild references before a new Crossref check; earlier results remain attached to their original text.</p>}
    {document?.sourceLimitReached && <p className="references-warning">The source index reached a scan/text limit. This bibliography may be incomplete.</p>}
    {document && !records.length && <p className="references-empty">No reference candidates were found in the indexed text. Check the PDF source pages.</p>}
    <div className="references-list">{records.slice(0, visibleCount).map((record, offset) => <article className="reference-card" key={record.id} data-reference-id={record.id}>
      <div className="reference-card-heading"><strong>Reference {offset + 1}</strong><span className={`reference-status reference-status-${record.verification?.status ?? 'unverified'}`}>{statusLabel(record.verification?.status)}</span></div>
      {record.segmentation === 'unsegmented' ? <p className="references-warning">Original section · uncertain segmentation. This section cannot be sent as a single citation.</p> : <>
        <dl className="reference-fields">
          <dt>Title</dt><dd>{record.fields.title ?? 'Not reliably parsed'}</dd>
          <dt>Authors</dt><dd>{record.fields.authors?.join('; ') ?? 'Not reliably parsed'}</dd>
          <dt>Year</dt><dd>{record.fields.year ?? 'Not reliably parsed'}</dd>
          {record.fields.venue && <><dt>Venue</dt><dd>{record.fields.venue}</dd></>}
          {record.fields.doi && <><dt>DOI</dt><dd>{record.fields.doi}</dd></>}
        </dl>
        <p className="reference-fields-hint">Parsed fields are candidates. Missing or uncertain fields are left blank rather than invented.</p>
      </>}
      <details className="reference-original"><summary>Original citation</summary><p>{record.rawText}</p></details>
      <div className="reference-actions"><div className="reference-pages"><span>Source</span>{record.pages.map(page => <button type="button" key={page} disabled={disabled} onClick={() => onPage(page)} aria-label={`Reference ${record.id}: source page ${page}`}>p. {page}</button>)}</div><button type="button" disabled={locked || stale || state.failedLoad || record.segmentation !== 'entry' || record.rawText.length > 8000} onClick={() => void execute(record.id)} aria-label={`Verify reference ${record.id}`}><SearchCheck size={13}/>{state.busy === record.id ? 'Checking…' : 'Verify with Crossref'}</button></div>
      {record.rawText.length > 8000 && <p className="references-warning">This citation exceeds the 8,000-character remote lookup limit. Its original text remains local.</p>}
      {record.verification && <div className="reference-verification"><small>Crossref · {record.verification.method === 'doi' ? 'DOI lookup' : 'Bibliographic search'} · {new Date(record.verification.checkedAt).toLocaleString()}</small>
        {record.verification.status === 'not-found' && <p>No Crossref record was found for this lookup. This does not prove that the reference is invalid.</p>}
        {record.verification.candidates.map(candidate => <details className="reference-candidate" key={candidate.doi} open={record.verification?.status === 'conflict'}><summary>{candidate.assessment === 'consistent' ? 'Consistent metadata' : candidate.assessment === 'conflict' ? 'Conflicting metadata' : 'Incomplete comparison'} · {candidate.title}</summary><dl className="reference-fields"><dt>Title</dt><dd>{candidate.title}</dd><dt>Authors</dt><dd>{candidate.authors.join('; ') || 'Not supplied'}</dd><dt>Year</dt><dd>{candidate.year ?? 'Not supplied'}</dd>{candidate.venue && <><dt>Venue</dt><dd>{candidate.venue}</dd></>}<dt>DOI</dt><dd>{candidate.doi}</dd></dl><ul>{candidate.reasons.map((reason, number) => <li key={number}>{reason}</li>)}</ul></details>)}
      </div>}
    </article>)}</div>
    {records.length > visibleCount && <button className="references-more" type="button" onClick={() => setVisibleCount(count => count + 20)}>Show more references ({visibleCount} / {records.length})</button>}
  </section>
}

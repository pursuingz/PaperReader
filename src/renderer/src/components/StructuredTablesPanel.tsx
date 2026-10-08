import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, RefreshCw, Table2, X } from 'lucide-react'
import { pdfjs } from 'react-pdf'
import type { DesktopAPI, PaperSourceIndex, PaperTables } from '../../../shared/types'
import { LocalTableExtraction } from '../tableSession'
import './structuredTablesPanel.css'

export interface StructuredTablesPanelProps { api: DesktopAPI; paperId: string; index: PaperSourceIndex; disabled?: boolean; onPage(page: number): void }
interface View { id: string; tables: PaperTables | null; loading: boolean; busy: boolean; exporting: string | null; failed: boolean; status: string; error: string }
const initial = (id: string): View => ({ id, tables: null, loading: true, busy: false, exporting: null, failed: false, status: 'Loading saved tables…', error: '' })
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Experimental values are local PDF strings, separate from the AI summary. */
export default function StructuredTablesPanel({ api, paperId, index, disabled = false, onPage }: StructuredTablesPanelProps) {
  const [view, setView] = useState<View>(() => initial(paperId))
  const epoch = useRef(0), currentPaper = useRef(paperId), running = useRef(false), exporting = useRef(false)
  currentPaper.current = paperId
  const session = useMemo(() => new LocalTableExtraction(api, bytes => pdfjs.getDocument({ data: bytes })), [api])
  useEffect(() => {
    void load()
    return () => { ++epoch.current; void session.cancel() }
  }, [api, paperId, session])
  const state = view.id === paperId ? view : initial(paperId)
  async function load() {
    const token = ++epoch.current, id = paperId; running.current = false; exporting.current = false
    setView(initial(id)); await session.cancel()
    try {
      const tables = await api.loadTables(id)
      if (token === epoch.current && id === currentPaper.current) setView({ ...initial(id), tables, loading: false, status: '' })
    } catch (error) {
      if (token === epoch.current && id === currentPaper.current) setView({ ...initial(id), loading: false, failed: true, status: '', error: `Saved tables unavailable. Retry loading or explicitly re-extract this derived cache. ${message(error)}` })
    }
  }
  async function build() {
    if (disabled || running.current || exporting.current || state.loading) return
    running.current = true; const token = ++epoch.current, id = paperId
    const alive = () => token === epoch.current && id === currentPaper.current
    setView(previous => ({ ...previous, busy: true, error: '', status: 'Opening the local PDF for tables…' }))
    try {
      const tables = await session.run(id, (page, total) => { if (alive()) setView(previous => ({ ...previous, status: `Reading table text: page ${page} of ${total}…` })) })
      if (tables && alive()) setView(previous => ({ ...previous, tables, failed: false, status: 'Table candidates saved locally.' }))
    } catch (error) { if (alive()) setView(previous => ({ ...previous, status: '', error: message(error) })) }
    finally { if (alive()) { running.current = false; setView(previous => ({ ...previous, busy: false })) } }
  }
  async function cancel() {
    const token = ++epoch.current, id = paperId
    setView(previous => ({ ...previous, status: 'Cancelling table extraction…' })); await session.cancel()
    if (token === epoch.current && id === currentPaper.current) { running.current = false; setView(previous => ({ ...previous, busy: false, status: 'Table extraction cancelled. A completed cache save may already have finished.' })) }
  }
  async function exportCsv(tableId: string) {
    if (disabled || running.current || exporting.current || state.loading || state.failed) return
    exporting.current = true; const token = epoch.current, id = paperId
    setView(previous => ({ ...previous, exporting: tableId, error: '', status: 'Choose a new CSV file name…' }))
    try {
      const result = await api.exportTableCsv(id, tableId)
      if (token === epoch.current && id === currentPaper.current) setView(previous => ({ ...previous, status: result.canceled ? 'CSV export cancelled.' : `CSV saved: ${result.fileName ?? 'new file'}` }))
    } catch (error) { if (token === epoch.current && id === currentPaper.current) setView(previous => ({ ...previous, status: '', error: message(error) })) }
    finally { if (token === epoch.current && id === currentPaper.current) { exporting.current = false; setView(previous => ({ ...previous, exporting: null })) } }
  }
  const tables = state.tables, locked = disabled || state.busy || !!state.exporting || state.loading
  const attempted = tables ? tables.indexedPages.length + tables.textlessPages.length + tables.failedPages.length : 0
  const candidates = tables?.tables.filter(table => table.status === 'candidate').length ?? 0
  return <section className="structured-tables-panel" role="region" aria-label="Structured experimental tables">
    <header className="structured-tables-heading"><div><span className="structured-tables-eyebrow"><Table2 size={12}/>EXPERIMENTAL DATA</span><h3>Values, with their source.</h3></div><span className="structured-tables-local">Local PDF text</span></header>
    <p className="structured-tables-description">Reconstruct aligned text tables from the PDF. Column labels, explicit units and values remain source strings. Check each candidate against its linked page.</p>
    <div className="structured-tables-controls">
      {state.busy ? <button type="button" aria-label="Cancel table extraction" onClick={() => void cancel()}><X size={13}/>Cancel extraction</button> : <button type="button" disabled={disabled || state.loading || !!state.exporting} aria-label={tables || state.failed ? 'Re-extract experiment tables' : 'Extract experiment tables'} onClick={() => void build()}><RefreshCw size={13}/>{tables || state.failed ? 'Re-extract tables' : 'Extract tables'}</button>}
      {state.failed && <button type="button" disabled={locked} aria-label="Retry table load" onClick={() => void load()}>Retry load</button>}
      <small>{index.entries.filter(entry => entry.kind === 'table').length} caption candidates in the source index · extraction scans all bounded pages</small>
    </div>
    {state.status && <p className="structured-tables-status" role="status">{state.status}</p>}
    {state.error && <p className="structured-tables-error" role="alert">{state.error}</p>}
    {tables && <>
      <div className="structured-tables-coverage"><strong>{tables.indexedPages.length} / {tables.pageCount} pages with readable text</strong><span>{attempted} pages attempted · {candidates} table candidates · {tables.tables.length - candidates} unsupported</span></div>
      {(tables.limitReached || tables.failedPages.length > 0 || attempted < tables.pageCount) && <p className="structured-tables-partial">Partial extraction.{tables.limitReached && ' A scan or table limit was reached.'}{tables.failedPages.length > 0 && ` ${tables.failedPages.length} pages could not be read.`}{attempted < tables.pageCount && ` ${tables.pageCount - attempted} pages were not indexed.`}</p>}
      {tables.textlessPages.length > 0 && <p className="structured-tables-textless">No readable text; image tables need OCR: {tables.textlessPages.map(page => <button key={page} disabled={locked} onClick={() => onPage(page)}>p. {page}</button>)}</p>}
      {!tables.tables.length && <p className="structured-tables-empty">No labelled table candidates found in the scanned text. Tables may still exist as images or in unsupported layouts.</p>}
      <div className="structured-tables-list">{tables.tables.map((table, index) => <details className="structured-table-card" key={table.id} open={index === 0}>
        <summary><strong>{table.label}</strong><span>{table.status === 'candidate' ? `${table.rows.length} rows · ${table.columns.length} columns · candidate` : 'Unsupported layout'}</span></summary>
        <div className="structured-table-content">
          <div className="structured-table-actions"><button disabled={locked} onClick={() => onPage(table.page)} aria-label={`${table.label}: source page ${table.page}`}>Source p. {table.page}</button>{table.status === 'candidate' && <button disabled={locked || state.failed} aria-label={`Export ${table.label} CSV`} onClick={() => void exportCsv(table.id)}><Download size={12}/>{state.exporting === table.id ? 'Exporting…' : 'Export CSV'}</button>}</div>
          {table.status === 'unsupported' ? <p className="structured-tables-partial">{table.reason}</p> : <>
            <div className="structured-table-scroll" tabIndex={0} role="region" aria-label={`${table.label} data grid`}><table><caption className="structured-table-sr">{table.label} · source page {table.page} · extraction candidate</caption><thead><tr>{table.columns.map(column => <th key={column.id} scope="col">{column.header}{column.unit && <small>Unit: {column.unit}</small>}</th>)}</tr></thead><tbody>{table.rows.slice(0, 100).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => columnIndex === 0 ? <th key={columnIndex} scope="row">{cell.raw}</th> : <td key={columnIndex}>{cell.raw}</td>)}</tr>)}</tbody></table></div>
            {table.rows.length > 100 && <p className="structured-tables-textless">Showing 100 of {table.rows.length} rows. CSV includes all {table.rows.length} extracted rows.</p>}
            {table.notes.map((note, noteIndex) => <p className="structured-table-note" key={noteIndex}>{note}</p>)}
          </>}
          <details className="structured-table-original"><summary>Original PDF text</summary><pre>{table.rawText}</pre></details>
        </div>
      </details>)}</div>
    </>}
    <p className="structured-tables-limits">Up to 200 pages / 240,000 text characters. Top-caption tables with one aligned header row are supported. Merged, multirow, cross-page and image tables may be unsupported. CSV keeps raw values; formula-like text gets a protective apostrophe. Import numeric columns as text to keep their displayed precision.</p>
  </section>
}

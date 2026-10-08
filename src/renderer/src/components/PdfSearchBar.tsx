import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { PdfSearchController } from '../usePdfSearch'
import { parsePageInput } from '../pdfSearch'
import '../pdfSearch.css'

export interface PdfSearchBarProps {
  search: PdfSearchController
  disabled?: boolean
  onNavigate(page: number): void
  focusToken?: number
  onClose?(): void
}

export default function PdfSearchBar({ search, disabled = false, onNavigate, focusToken = 0, onClose }: PdfSearchBarProps) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (focusToken && !disabled && !search.busy) { input.current?.focus(); input.current?.select() } }, [focusToken, disabled, search.busy])
  const { result } = search
  const matches = result?.matches ?? []
  const activeIndex = matches.findIndex(match => match.page === search.selectedPage)
  const navigation = useRef({ disabled, onNavigate, takeInitialPage: search.takeInitialPage })
  navigation.current = { disabled, onNavigate, takeInitialPage: search.takeInitialPage }
  useEffect(() => {
    if (navigation.current.disabled) return
    const page = navigation.current.takeInitialPage()
    if (page !== null) navigation.current.onNavigate(page)
  }, [result, disabled])
  function navigate(page: number) { if (!disabled) { search.selectPage(page); onNavigate(page) } }
  function move(delta: number) {
    if (!matches.length) return
    navigate(matches[(activeIndex + delta + matches.length) % matches.length].page)
  }
  return <section className="pdf-search" aria-label="Local PDF search">
    <form className="pdf-search-form" onSubmit={event => { event.preventDefault(); if (!disabled) void search.search() }}>
      <Search size={13}/>
      <input ref={input} aria-label="Search PDF text" placeholder="Find in this paper…" value={search.query} maxLength={200} disabled={disabled || search.busy} onChange={event => search.setQuery(event.target.value)}/>
      {search.busy ? <button type="button" className="pdf-search-submit" aria-label="Cancel PDF search" onClick={() => { void search.cancel() }}>Cancel</button> : <button className="pdf-search-submit" type="submit" aria-label="Search this PDF" disabled={disabled || !search.query.trim()}>Find</button>}
      <button type="button" className="icon-button" aria-label="Previous PDF search result" title="Previous matching page" disabled={disabled || !matches.length} onClick={() => move(-1)}><ChevronUp size={14}/></button>
      <button type="button" className="icon-button" aria-label="Next PDF search result" title="Next matching page" disabled={disabled || !matches.length} onClick={() => move(1)}><ChevronDown size={14}/></button>
      <button type="button" className="icon-button" aria-label="Clear PDF search" title="Clear search" disabled={!search.query && !search.status} onClick={search.clear}><X size={13}/></button>
      {onClose && <button type="button" className="icon-button" aria-label="Close PDF search" title="Close · Escape" onClick={onClose}><X size={13}/></button>}
    </form>
    <div className="pdf-search-status" role="status">{search.status || 'Local text search · no AI request'}</div>
    {result && <>
      {!result.complete && <p className="pdf-search-coverage">Partial coverage.{result.limit === 'pages' ? ' The 2,000-page search limit was reached.' : result.limit === 'characters' ? ' The 20 million character limit was reached; the next page was not searched.' : ''}{result.failedPages.length > 0 ? ` Could not read ${result.failedPages.length} ${result.failedPages.length === 1 ? 'page' : 'pages'}: ${result.failedPages.slice(0, 12).join(', ')}${result.failedPages.length > 12 ? '…' : ''}.` : ''}</p>}
      {result.blankPages.length > 0 && <p className="pdf-search-coverage">{result.blankPages.length} {result.blankPages.length === 1 ? 'page has' : 'pages have'} no extractable text. Image-only content needs OCR and was not searched.</p>}
      {matches.length > 0 && <ol className="pdf-search-results" aria-label="PDF matching pages">{matches.map(match => <li key={match.page}><button type="button" className={search.selectedPage === match.page ? 'selected' : ''} aria-label={`Search result page ${match.page}`} aria-current={search.selectedPage === match.page ? 'page' : undefined} disabled={disabled} onClick={() => navigate(match.page)}><strong>p. {match.page}</strong><span>{match.snippet}</span></button></li>)}</ol>}
    </>}
  </section>
}

export function PageEntry({ page, pageCount, disabled = false, onNavigate }: { page: number; pageCount: number; disabled?: boolean; onNavigate(page: number): void }) {
  const [value, setValue] = useState(String(page))
  const [error, setError] = useState('')
  const errorId = useId()
  useEffect(() => { setValue(String(page)); setError('') }, [page, pageCount])
  function submit(event: FormEvent) {
    event.preventDefault()
    if (disabled) return
    try { const next = parsePageInput(value, pageCount); onNavigate(next); setValue(String(next)); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Enter a valid page number.') }
  }
  return <form className="pdf-page-entry" onSubmit={submit}>
    <input aria-label="PDF page number" aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error)} title="Enter a page number and press Enter" inputMode="numeric" value={value} disabled={disabled} onChange={event => { setValue(event.target.value); setError('') }} onKeyDown={event => { if (event.key === 'Escape') { setValue(String(page)); setError('') } }}/>
    <span>/ {pageCount}</span>
    <button type="submit" className="pdf-page-go" aria-label="Go to PDF page" disabled={disabled}>Go</button>
    {error && <span className="pdf-page-error" role="alert" id={errorId}>{error}</span>}
  </form>
}

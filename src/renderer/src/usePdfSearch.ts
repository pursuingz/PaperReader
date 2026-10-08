import { useEffect, useMemo, useRef, useState } from 'react'
import { pdfjs } from 'react-pdf'
import type { DesktopAPI } from '../../shared/types'
import { LocalPdfSearch, SearchResultNavigation, normalizeSearchQuery, type PdfSearchResult } from './pdfSearch'

export interface PdfSearchController {
  query: string
  setQuery(query: string): void
  busy: boolean
  status: string
  result: PdfSearchResult | null
  highlightQuery: string
  selectedPage: number | null
  search(): Promise<void>
  cancel(): Promise<void>
  clear(): void
  selectPage(page: number): void
  takeInitialPage(): number | null
}

export default function usePdfSearch(api: Pick<DesktopAPI, 'readPaper'>, paperId: string | null): PdfSearchController {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [result, setResult] = useState<PdfSearchResult | null>(null)
  const [selectedPage, setSelectedPage] = useState<number | null>(null)
  const engine = useMemo(() => new LocalPdfSearch(id => api.readPaper(id), bytes => pdfjs.getDocument({ data: bytes })), [api])
  const identity = useRef(paperId)
  const generation = useRef(0)
  const running = useRef(false)
  const navigation = useRef(new SearchResultNavigation())
  identity.current = paperId
  useEffect(() => {
    ++generation.current
    running.current = false
    navigation.current.reset()
    setQuery(''); setBusy(false); setStatus(''); setResult(null); setSelectedPage(null)
    return () => { ++generation.current; void engine.cancel() }
  }, [engine, paperId])

  async function search() {
    if (!paperId || identity.current !== paperId || running.current) return
    const normalized = normalizeSearchQuery(query)
    if (!normalized) { setStatus('Enter text to search in this PDF.'); return }
    const id = paperId, token = ++generation.current
    running.current = true
    const current = () => identity.current === id && generation.current === token
    setBusy(true); setStatus('Opening PDF for local search…'); setResult(null); setSelectedPage(null)
    try {
      const found = await engine.run(id, normalized, (page, total) => { if (current()) setStatus(`Searching page ${page} of ${total} locally…`) })
      if (!current()) return
      setResult(found); setSelectedPage(found.matches[0]?.page ?? null)
      setStatus(`${found.matches.length} matching ${found.matches.length === 1 ? 'page' : 'pages'} · ${found.scannedPages} of ${found.totalPages} pages searched.`)
    } catch (error) {
      if (current()) setStatus(error instanceof Error ? error.message : 'PDF search failed. Try again.')
    } finally { if (current()) { running.current = false; setBusy(false) } }
  }
  async function cancel() {
    ++generation.current
    running.current = false
    navigation.current.reset()
    setBusy(false); setStatus('PDF search cancelled.'); setResult(null); setSelectedPage(null)
    await engine.cancel()
  }
  function clear() {
    ++generation.current
    running.current = false
    navigation.current.reset()
    void engine.cancel()
    setQuery(''); setBusy(false); setStatus(''); setResult(null); setSelectedPage(null)
  }
  return { query, setQuery, busy, status, result, highlightQuery: result?.query ?? '', selectedPage, search, cancel, clear,
    takeInitialPage: () => navigation.current.takeInitialPage(result),
    selectPage: page => { if (result?.matches.some(match => match.page === page)) setSelectedPage(page) } }
}

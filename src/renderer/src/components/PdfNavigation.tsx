import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, List, Grid2X2, X } from 'lucide-react'
import { pdfjs } from 'react-pdf'
import type { DesktopAPI } from '../../../shared/types'
import usePdfNavigation from '../usePdfNavigation'
import { ThumbnailQueue, queueThumbnail, thumbnailBatch, thumbnailGeometry, type NavigationOutlineNode } from '../pdfNavigation'
import '../pdfNavigation.css'

export interface PdfNavigationProps {
  api: Pick<DesktopAPI, 'readPaper'>
  paperId: string
  page: number
  disabled?: boolean
  onNavigate(page: number): void
  onClose(): void
}

interface OutlineProps {
  nodes: NavigationOutlineNode[]
  disabled: boolean
  activeId: string | null
  onSelect(node: NavigationOutlineNode): void
}
function OutlineList({ nodes, disabled, activeId, onSelect }: OutlineProps) {
  function destination(node: NavigationOutlineNode) {
    return node.destination ? <button type="button" className="pdf-outline-destination" aria-label={`Go to section ${node.title}`} aria-current={activeId === node.id ? 'page' : undefined} disabled={disabled} onClick={() => onSelect(node)}>{node.title}</button> : <span className="pdf-outline-unavailable">{node.title}<small>{node.external ? '(external link)' : '(no page target)'}</small></span>
  }
  return <ul className="pdf-outline-list">{nodes.map(node => <li key={node.id}>{node.children.length ? <details>
    <summary>{node.title}</summary>
    {node.destination && <div className="pdf-outline-parent-target">{destination(node)}</div>}
    <OutlineList nodes={node.children} disabled={disabled} activeId={activeId} onSelect={onSelect}/>
  </details> : destination(node)}</li>)}</ul>
}

interface ThumbnailProps {
  document: pdfjs.PDFDocumentProxy
  queue: ThumbnailQueue
  page: number
  selected: boolean
  disabled: boolean
  onNavigate(page: number): void
}
function Thumbnail({ document, queue, page: number, selected, disabled, onNavigate }: ThumbnailProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => {
    let alive = true
    const target = canvas.current
    if (!target) return
    setStatus('loading')
    const job = queueThumbnail(queue, () => document.getPage(number), pdfPage => {
      const size = thumbnailGeometry(pdfPage.getViewport({ scale: 1 }), window.devicePixelRatio)
      const viewport = pdfPage.getViewport({ scale: size.scale * size.pixelRatio })
      target.width = Math.ceil(viewport.width)
      target.height = Math.ceil(viewport.height)
      target.style.width = `${size.width}px`
      target.style.height = `${size.height}px`
      return pdfPage.render({ canvas: target, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE })
    })
    void job.promise.then(rendered => { if (alive && rendered) setStatus('ready') }).catch(() => { if (alive) setStatus('failed') })
    return () => {
      alive = false
      job.cancel()
      // The render promise settles before the queue releases its slot or page resources.
    }
  }, [document, queue, number])
  return <button type="button" className={`pdf-thumbnail ${selected ? 'selected' : ''}`} aria-label={`Go to PDF page ${number}`} aria-current={selected ? 'page' : undefined} disabled={disabled} onClick={() => onNavigate(number)}>
    <span className="pdf-thumbnail-preview"><canvas ref={canvas} className="pdf-thumbnail-canvas" aria-hidden="true" hidden={status !== 'ready'}/>{status !== 'ready' && <span className="pdf-thumbnail-placeholder">{status === 'failed' ? 'Preview unavailable' : 'Loading…'}</span>}</span>
    <span className="pdf-thumbnail-label">Page {number}</span>
  </button>
}

function Thumbnails({ document, page, disabled, onNavigate }: Omit<ThumbnailProps, 'queue' | 'selected'>) {
  const [cursor, setCursor] = useState(page)
  const [resource, setResource] = useState<{ document: pdfjs.PDFDocumentProxy; queue: ThumbnailQueue } | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const queue = new ThumbnailQueue()
    setResource({ document, queue })
    return () => queue.close()
  }, [document])
  useEffect(() => { setCursor(page) }, [document, page])
  const range = thumbnailBatch(cursor, document.numPages)
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }) }, [range.start])
  const queue = resource?.document === document ? resource.queue : null
  return <div className="pdf-thumbnails">
    <div className="pdf-thumbnail-controls">
      <button type="button" className="icon-button" aria-label="Previous thumbnail pages" disabled={disabled || range.start <= 1} onClick={() => setCursor(range.start - 1)}><ChevronLeft size={15}/></button>
      <span className="pdf-thumbnail-range" role="status">{range.start}–{range.end} / {document.numPages}</span>
      <button type="button" className="icon-button" aria-label="Next thumbnail pages" disabled={disabled || range.end >= document.numPages} onClick={() => setCursor(range.end + 1)}><ChevronRight size={15}/></button>
    </div>
    <div ref={scroll} className="pdf-thumbnail-scroll" aria-label="PDF page previews">{queue && range.pages.map(number => <Thumbnail key={number} document={document} queue={queue} page={number} selected={number === page} disabled={disabled} onNavigate={onNavigate}/>)}</div>
  </div>
}

export default function PdfNavigation({ api, paperId, page, disabled = false, onNavigate, onClose }: PdfNavigationProps) {
  const navigation = usePdfNavigation(api, paperId)
  const [mode, setMode] = useState<'outline' | 'thumbnails'>('outline')
  const [status, setStatus] = useState('')
  const [activeSection, setActiveSection] = useState<{ id: string; page: number } | null>(null)
  const action = useRef(0)
  const latest = useRef({ paperId, disabled, onNavigate })
  latest.current = { paperId, disabled, onNavigate }
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeButton.current?.focus(); return () => { ++action.current } }, [])
  useEffect(() => { ++action.current; setStatus(''); setActiveSection(null) }, [paperId, disabled])
  function close() {
    ++action.current
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-controls="pdf-navigation"]')
    onClose()
    trigger?.focus()
  }
  async function selectSection(node: NavigationOutlineNode) {
    if (disabled || !navigation.document || !navigation.isCurrent(navigation.document)) return
    const token = ++action.current
    const current = () => token === action.current && latest.current.paperId === paperId && !latest.current.disabled
    setStatus(`Finding ${node.title}…`)
    try {
      const target = await navigation.resolve(node.destination)
      if (!current()) return
      if (target === null) { setStatus('This section has no valid local page target.'); return }
      setActiveSection({ id: node.id, page: target })
      setStatus(`Opened page ${target}.`)
      latest.current.onNavigate(target)
    } catch (error) {
      if (current()) setStatus(error instanceof Error ? `Could not open section: ${error.message}` : 'Could not open this section.')
    }
  }
  function selectPage(target: number) {
    if (disabled || !navigation.document || !navigation.isCurrent(navigation.document)) return
    ++action.current
    setStatus(`Opened page ${target}.`)
    onNavigate(target)
  }
  return <aside id="pdf-navigation" className="pdf-navigation" aria-label="PDF contents" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close() } }}>
    <div className="pdf-navigation-heading"><strong>Contents</strong><button ref={closeButton} type="button" className="icon-button" aria-label="Close PDF contents" onClick={close}><X size={15}/></button></div>
    <div className="pdf-navigation-modes" aria-label="PDF navigation view">
      <button type="button" aria-label="PDF outline" aria-pressed={mode === 'outline'} onClick={() => { ++action.current; setMode('outline'); setStatus('') }}><List size={13}/>Outline</button>
      <button type="button" aria-label="PDF thumbnails" aria-pressed={mode === 'thumbnails'} onClick={() => { ++action.current; setMode('thumbnails'); setStatus('') }}><Grid2X2 size={13}/>Pages</button>
    </div>
    {navigation.loading ? <p className="pdf-navigation-empty" role="status">Opening local PDF…</p> : navigation.error ? <div className="pdf-navigation-empty"><p role="alert">{navigation.error}</p><button type="button" onClick={navigation.retry}>Retry PDF contents</button></div> : mode === 'outline' ? <div className="pdf-outline">
      {navigation.outlineLoading ? <p className="pdf-navigation-empty" role="status">Reading PDF outline…</p> : navigation.outlineError ? <p className="pdf-navigation-empty" role="status">{navigation.outlineError}</p> : navigation.outline.length ? <OutlineList nodes={navigation.outline} disabled={disabled} activeId={activeSection?.page === page ? activeSection.id : null} onSelect={node => { void selectSection(node) }}/> : <p className="pdf-navigation-empty">This PDF has no outline. Use Pages to browse its thumbnails.</p>}
      {navigation.outlineLimited && <p className="pdf-navigation-empty">This large outline is limited to 5,000 entries and 32 levels. All pages remain available under Pages.</p>}
    </div> : navigation.document && <Thumbnails document={navigation.document} page={page} disabled={disabled} onNavigate={selectPage}/>}
    <p className="pdf-navigation-status" role="status">{status || 'Local PDF navigation'}</p>
  </aside>
}

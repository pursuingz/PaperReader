import { useEffect, useMemo, useRef, useState } from 'react'
import { Crop, ExternalLink, Image, RotateCcw } from 'lucide-react'
import { pdfjs } from 'react-pdf'
import type { DesktopAPI, NormalizedRect, PaperSourceEntry, SummaryFigures } from '../../../shared/types'
import { FigurePdfSession, SummaryFigureEdits, figurePreviewGeometry, matchingFigureCrop } from '../summaryFigureSession'
import SummaryFigureCropEditor from './SummaryFigureCropEditor'
import './summaryFigureGallery.css'

export interface SummaryFigureGalleryProps { api: DesktopAPI; paperId: string; entries: PaperSourceEntry[]; disabled?: boolean; onPage(page: number): void }
type ManifestState = { paperId: string; value: SummaryFigures | null; loading: boolean; error: string }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Caption candidates select real source pages. Only an explicit user crop becomes an isolated figure image. */
export default function SummaryFigureGallery({ api, paperId, entries, disabled = false, onPage }: SummaryFigureGalleryProps) {
  const figures = entries.filter(entry => entry.kind === 'figure')
  const [choice, setChoice] = useState({ id: '', page: 0 }), [revision, setRevision] = useState(0), [pdfRevision, setPdfRevision] = useState(0)
  const entry = figures.find(value => value.id === choice.id) ?? figures[0]
  const page = entry?.pages.includes(choice.page) ? choice.page : entry?.pages[0] ?? 1
  const [manifest, setManifest] = useState<ManifestState>({ paperId, value: null, loading: true, error: '' })
  const state = manifest.paperId === paperId ? manifest : { paperId, value: null, loading: true, error: '' }
  const crop = entry ? matchingFigureCrop(state.value, entry, page) : null
  const [visible, setVisible] = useState(false), [opened, setOpened] = useState<{ paperId: string } | null>(null), [raster, setRaster] = useState(''), [pdfError, setPdfError] = useState('')
  const [image, setImage] = useState<{ assetId: string; url: string } | null>(null), [imageError, setImageError] = useState('')
  const [editing, setEditing] = useState(false), [saving, setSaving] = useState(false), [status, setStatus] = useState('')
  const host = useRef<HTMLElement>(null), canvas = useRef<HTMLCanvasElement>(null), epoch = useRef(0)
  const identity = `${paperId}:${entry?.id}:${entry?.text}:${page}`
  const latest = useRef({ paperId, identity, disabled }); latest.current = { paperId, identity, disabled }
  const edits = useMemo(() => new SummaryFigureEdits(api), [api])
  const pdf = useMemo(() => new FigurePdfSession<pdfjs.PDFPageProxy>(id => api.readPaper(id), bytes => pdfjs.getDocument({ data: bytes })), [api])
  useEffect(() => {
    const token = ++epoch.current
    setManifest({ paperId, value: null, loading: true, error: '' }); setEditing(false); setSaving(false); setStatus('')
    void edits.open(paperId).then(value => { if (value && epoch.current === token) setManifest({ paperId, value, loading: false, error: '' }) }).catch(error => {
      if (epoch.current === token) setManifest({ paperId, value: null, loading: false, error: `Saved figure crops are unavailable. Editing is protected until Retry succeeds. ${message(error)}` })
    })
    return () => { ++epoch.current; edits.close() }
  }, [api, paperId, edits, revision])
  useEffect(() => {
    setVisible(false)
    const element = host.current
    if (!element) return
    const observer = new IntersectionObserver(records => { if (records.some(record => record.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: '180px' })
    observer.observe(element); return () => observer.disconnect()
  }, [paperId, Boolean(figures.length)])
  useEffect(() => {
    if (!visible || !figures.length) return
    let alive = true
    setOpened(null); setRaster(''); setPdfError('')
    void pdf.open(paperId).then(document => { if (document && alive) setOpened({ paperId }) }).catch(error => { if (alive) setPdfError(message(error)) })
    return () => { alive = false; void pdf.close() }
  }, [pdf, paperId, visible, Boolean(figures.length), pdfRevision])
  useEffect(() => {
    setEditing(false); setRaster(''); setPdfError('')
    const target = canvas.current
    if (!target || opened?.paperId !== paperId) return
    let alive = true
    void pdf.render(page, source => {
      const geometry = figurePreviewGeometry(source.getViewport({ scale: 1 })), viewport = source.getViewport({ scale: geometry.scale })
      target.width = geometry.width; target.height = geometry.height
      return source.render({ canvas: target, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE })
    }).then(ready => { if (ready && alive && latest.current.identity === identity) setRaster(identity) }).catch(error => { if (alive) setPdfError(message(error)) })
    return () => { alive = false; pdf.cancelRender() }
  }, [pdf, opened, paperId, page, identity])
  useEffect(() => {
    setImage(null); setImageError('')
    if (!crop) return
    let alive = true, url = ''
    void api.readCanvasImage(paperId, crop.assetId).then(value => {
      if (!alive || latest.current.identity !== identity) return
      url = URL.createObjectURL(new Blob([new Uint8Array(value.bytes)], { type: value.mimeType })); setImage({ assetId: crop.assetId, url })
    }).catch(error => { if (alive) setImageError(message(error)) })
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [api, paperId, identity, crop?.assetId])
  useEffect(() => { if (disabled) setEditing(false) }, [disabled])
  if (!entry) return null
  const ready = raster === identity, writable = !disabled && !state.loading && !state.error && edits.ready && !saving
  async function save(rect: NormalizedRect, bytes: Uint8Array): Promise<boolean> {
    if (!writable || !entry || latest.current.identity !== identity) return false
    const token = epoch.current
    setSaving(true); setStatus('')
    try {
      const value = await edits.save({ entryId: entry.id, caption: entry.text, page, rect, bytes })
      if (value && token === epoch.current && latest.current.identity === identity) { setManifest({ paperId, value, loading: false, error: '' }); setStatus('Manual crop saved locally.'); return true }
      return false
    } finally { if (token === epoch.current) setSaving(false) }
  }
  async function reset() {
    if (!writable || !entry) return
    const token = epoch.current; setSaving(true); setStatus('')
    try {
      const value = await edits.reset(entry.id)
      if (value && token === epoch.current) { setManifest({ paperId, value, loading: false, error: '' }); setStatus('Full source page restored. Saved image resources were retained.') }
    } catch (error) { if (token === epoch.current) setStatus(`Reset failed. ${message(error)}`) }
    finally { if (token === epoch.current) setSaving(false) }
  }
  return <section ref={host} className="summary-figure-gallery" aria-label="Original figure images">
    <div className="summary-figure-toolbar"><span className="summary-figure-eyebrow"><Image size={12}/>ORIGINAL PDF IMAGES</span><span className={`summary-figure-kind ${crop ? 'cropped' : ''}`}>{crop ? 'Manual crop' : 'Page preview'}</span></div>
    <div className="summary-figure-picker"><label>Figure<select aria-label="Figure to preview" value={entry.id} disabled={disabled || saving} onChange={event => setChoice({ id: event.target.value, page: 0 })}>{figures.map(value => <option key={value.id} value={value.id}>{value.label} · p. {value.pages.join(', ')}</option>)}</select></label>{entry.pages.length > 1 && <label>Source page<select aria-label="Figure preview page" value={page} disabled={disabled || saving} onChange={event => setChoice({ id: entry.id, page: Number(event.target.value) })}>{entry.pages.map(number => <option key={number} value={number}>{number}</option>)}</select></label>}</div>
    <div className="summary-figure-stage" aria-busy={crop ? !image && !imageError : !ready && !pdfError}>
      <canvas ref={canvas} aria-label={`Original PDF page ${page} preview`} hidden={Boolean(crop) || !ready}/>
      {crop && image?.assetId === crop.assetId && <img src={image.url} alt={`${entry.label}, manual crop from original PDF page ${page}`} onError={() => setImageError('The saved figure image could not be displayed.')}/>}
      {crop ? imageError ? <p role="alert">{imageError}</p> : !image && <p role="status">Loading saved crop…</p> : !ready && <p role={pdfError ? 'alert' : 'status'}>{pdfError || 'Preparing source page preview…'}</p>}
    </div>
    <p className="summary-figure-caption">{entry.text}</p>
    <p className="summary-figure-scope">{crop ? 'User-selected region of the source page. Check the caption and surrounding text in Reader.' : 'Whole source page; the figure boundary has not been detected. Crop manually to isolate the figure.'}</p>
    <div className="summary-figure-actions"><button type="button" aria-label={`Open figure source page ${page}`} disabled={disabled || saving} onClick={() => onPage(page)}><ExternalLink size={12}/>Source p. {page}</button><button type="button" aria-label="Crop figure preview" disabled={!writable || !ready} onClick={() => setEditing(true)}><Crop size={12}/>{crop ? 'Edit crop' : 'Crop figure'}</button>{crop && <button type="button" aria-label="Reset figure to page preview" disabled={!writable} onClick={() => void reset()}><RotateCcw size={12}/>Reset to page</button>}</div>
    {pdfError && <button type="button" disabled={disabled || saving} onClick={() => setPdfRevision(value => value + 1)}>Retry figure preview</button>}
    {state.loading && <p role="status" className="summary-figure-status">Loading saved figures…</p>}
    {state.error && <div className="summary-figure-error" role="alert"><p>{state.error}</p><button type="button" disabled={disabled || saving} onClick={() => setRevision(value => value + 1)}>Retry saved figures</button></div>}
    {status && <p className="summary-figure-status" role="status">{status}</p>}
    {editing && ready && !disabled && !state.loading && !state.error && canvas.current && <SummaryFigureCropEditor key={identity} source={canvas.current} label={entry.label} page={page} initial={crop?.rect ?? null} onSave={save} onClose={() => setEditing(false)}/>}
  </section>
}

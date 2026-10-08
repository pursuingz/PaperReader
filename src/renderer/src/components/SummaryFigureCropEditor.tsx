import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, Crop, X } from 'lucide-react'
import type { NormalizedRect } from '../../../shared/types'
import { capturePdfRaster, type Point } from '../pdfInteraction'
import { figureCropFromPointer, figureDialogTabTarget, updateFigureCrop } from '../summaryFigureSession'

interface Props {
  source: HTMLCanvasElement
  label: string
  page: number
  initial: NormalizedRect | null
  onSave(rect: NormalizedRect, bytes: Uint8Array): Promise<boolean>
  onClose(): void
}
const wholePage: NormalizedRect = { x: 0, y: 0, width: 1, height: 1 }

/** The editor copies an already-completed PDF raster; no annotations or application UI enter the image. */
export default function SummaryFigureCropEditor({ source, label, page, initial, onSave, onClose }: Props) {
  const title = useId(), dialog = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), area = useRef<HTMLDivElement>(null)
  const mounted = useRef(false), saving = useRef(false), gesture = useRef<{ id: number; start: Point } | null>(null)
  const [rect, setRect] = useState<NormalizedRect | null>(initial), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const callbacks = useRef({ onSave, onClose }); callbacks.current = { onSave, onClose }
  function release() {
    const current = gesture.current; gesture.current = null
    if (current && area.current?.hasPointerCapture(current.id)) area.current.releasePointerCapture(current.id)
  }
  useEffect(() => {
    mounted.current = true
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target = canvas.current
    if (target && source.width && source.height) {
      target.width = source.width; target.height = source.height
      const context = target.getContext('2d')
      if (context) { context.drawImage(source, 0, 0); setReady(true) }
      else setError('The source image could not be opened. Close and retry.')
    }
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { mounted.current = false; release(); if (target) { target.width = 0; target.height = 0 } if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [source])
  useEffect(() => { if (busy) dialog.current?.focus({ preventScroll: true }) }, [busy])
  function down(event: PointerEvent<HTMLDivElement>) {
    if (!ready || saving.current || event.button !== 0 || gesture.current) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    gesture.current = { id: event.pointerId, start: { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height } }
    setRect(null); setError(''); event.currentTarget.setPointerCapture(event.pointerId)
  }
  function move(event: PointerEvent<HTMLDivElement>, finish = false) {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    event.preventDefault()
    const next = figureCropFromPointer(active.start, { x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), finish ? 8 : .01)
    setRect(next)
    if (finish) { release(); if (!next) setError('Drag an area at least 8 × 8 pixels, or enter crop percentages below.') }
  }
  function lost(event: PointerEvent<HTMLDivElement>) { if (gesture.current?.id === event.pointerId) { release(); setRect(null) } }
  async function save() {
    if (!ready || !rect || !canvas.current || saving.current) return
    saving.current = true; setBusy(true); setError('')
    const snapshot = { ...rect }
    try {
      const bytes = await capturePdfRaster(canvas.current, snapshot, () => mounted.current)
      if (bytes && mounted.current && await callbacks.current.onSave(snapshot, bytes) && mounted.current) callbacks.current.onClose()
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'The figure could not be saved. Please retry.') }
    finally { if (mounted.current) { saving.current = false; setBusy(false) } }
  }
  return createPortal(<div className="summary-figure-backdrop" onMouseDown={event => { if (event.currentTarget === event.target && !saving.current) onClose() }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={title} aria-busy={busy} className="summary-figure-editor" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!saving.current) { if (gesture.current) { release(); setRect(null) } else onClose() } }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])
      const target = figureDialogTabTarget(controls, document.activeElement instanceof HTMLElement ? document.activeElement : null, event.shiftKey)
      if (target) { event.preventDefault(); (target === 'dialog' ? dialog.current : target)?.focus({ preventScroll: true }) }
    }}>
      <header><div><span className="summary-figure-eyebrow"><Crop size={12}/>ORIGINAL PDF · PAGE {page}</span><h2 id={title}>Crop figure preview</h2></div><button type="button" className="icon-button" aria-label="Close figure crop" disabled={busy} onClick={onClose}><X size={18}/></button></header>
      <p className="summary-figure-editor-hint">{label} · Drag around the figure, or enter percentages below. The saved image will be labelled Manual crop.</p>
      <div className="summary-figure-editor-body"><div ref={area} className="summary-figure-crop-area" aria-label="Figure crop area" role="region" style={{ aspectRatio: `${source.width} / ${source.height}` }} onPointerDown={down} onPointerMove={event => move(event)} onPointerUp={event => move(event, true)} onPointerCancel={lost} onLostPointerCapture={lost}>
        <canvas ref={canvas} aria-label={`Original PDF page ${page} for cropping`}/>
        {rect && <div className="summary-figure-crop-rect" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}/>}
      </div></div>
      <div className="summary-figure-crop-inputs">{(['x', 'y', 'width', 'height'] as const).map(field => <label key={field}>{field === 'x' ? 'Left' : field === 'y' ? 'Top' : field === 'width' ? 'Width' : 'Height'} %<input type="number" aria-label={`Figure crop ${field} percent`} min={field === 'width' || field === 'height' ? 1 : 0} max={field === 'width' || field === 'height' ? 100 : 99} step="1" disabled={busy || !ready} value={Number(((rect ?? wholePage)[field] * 100).toFixed(2))} onChange={event => { const next = updateFigureCrop(rect ?? wholePage, field, event.currentTarget.valueAsNumber); if (next) { setRect(next); setError('') } }}/></label>)}<button type="button" disabled={busy || !ready} onClick={() => setRect({ ...wholePage })}>Use full page</button></div>
      <p className={`summary-figure-editor-status ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error || (rect ? 'Crop is local. Original PDF and Canvas objects remain unchanged.' : 'Choose a region to enable saving.')}</p>
      <footer><button type="button" disabled={busy} onClick={onClose}>Cancel crop</button><button type="button" className="primary" aria-label="Save figure crop" disabled={busy || !ready || !rect} onClick={() => void save()}><Check size={14}/>{busy ? 'Saving…' : 'Save figure crop'}</button></footer>
    </div>
  </div>, document.body)
}

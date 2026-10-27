import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, Crop, X, MessageCircle, Copy, Download } from 'lucide-react'
import type { NormalizedRect, PdfCaptureAction } from '../../../shared/types'
import { captureRect, panScroll, shouldDismissPdfCapture, type PdfInteractionMode, type Point } from '../pdfInteraction'
import { positionSelectionToolbar } from '../selectionMenu'
import './pdf-interaction.css'

interface Props {
  mode: Exclude<PdfInteractionMode, 'read'>
  page: number
  ready: boolean
  scrollElement?: HTMLElement | null
  onConfirm(rect: NormalizedRect, action?:PdfCaptureAction): Promise<boolean>
  onCancel(): void
}
type Gesture = { id: number; start: Point; bounds: DOMRect; pan?: Point & { left: number; top: number } }

/** Mounted only for explicit Hand/Capture modes; Read retains the native text layer. */
export default function PdfInteractionLayer({ mode, page, ready, scrollElement, onConfirm, onCancel }: Props) {
  const element = useRef<HTMLDivElement>(null), controls = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null), mounted = useRef(false), adding = useRef(false)
  const [rect, setRect] = useState<NormalizedRect | null>(null)
  const [dragging, setDragging] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const callbacks = useRef({ onCancel, onConfirm }); callbacks.current = { onCancel, onConfirm }
  const activeRect = useRef(rect); activeRect.current = rect

  function release() {
    const active = gesture.current; gesture.current = null
    if (active && element.current?.hasPointerCapture(active.id)) element.current.releasePointerCapture(active.id)
  }
  function cancel() { release(); callbacks.current.onCancel(); setRect(null); setDragging(false); setError('') }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; release(); callbacks.current.onCancel() }
  }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      const visibleModal = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).some(dialog => dialog.getClientRects().length > 0 && getComputedStyle(dialog).visibility !== 'hidden')
      if (!shouldDismissPdfCapture(event, Boolean(gesture.current || activeRect.current), visibleModal)) return
      event.preventDefault(); event.stopImmediatePropagation()
      if (!adding.current) cancel()
    }
    document.addEventListener('keydown', escape, true)
    return () => document.removeEventListener('keydown', escape, true)
  }, [])
  useLayoutEffect(() => {
    if (!rect || dragging) { setPosition(null); return }
    const update = () => {
      const bounds = element.current?.getBoundingClientRect()
      if (!bounds) return
      const left = bounds.left + rect.x * bounds.width, top = bounds.top + rect.y * bounds.height
      const size = controls.current?.getBoundingClientRect()
      setPosition(positionSelectionToolbar({ left, top, right: left + rect.width * bounds.width, bottom: top + rect.height * bounds.height }, { width: size?.width || 290, height: size?.height || 45 }, { width: innerWidth, height: innerHeight }))
    }
    update(); window.addEventListener('scroll', update, true); window.addEventListener('resize', update)
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update) }
  }, [rect, dragging, busy, error, Boolean(position)])
  useEffect(() => {
    const scroll = () => { if (mode === 'capture' && gesture.current) cancel() }
    scrollElement?.addEventListener('scroll', scroll)
    return () => scrollElement?.removeEventListener('scroll', scroll)
  }, [mode, scrollElement])

  function down(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || gesture.current || adding.current || mode === 'capture' && !ready || mode === 'hand' && !scrollElement) return
    event.preventDefault(); event.stopPropagation()
    const bounds = event.currentTarget.getBoundingClientRect()
    const active: Gesture = { id: event.pointerId, start: { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, bounds }
    if (mode === 'hand') active.pan = { x: event.clientX, y: event.clientY, left: scrollElement!.scrollLeft, top: scrollElement!.scrollTop }
    gesture.current = active; setRect(null); setError(''); setDragging(true); callbacks.current.onCancel()
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    event.preventDefault(); event.stopPropagation()
    if (active.pan && scrollElement) {
      const position = panScroll(active.pan, { x: event.clientX, y: event.clientY }, scrollElement)
      scrollElement.scrollLeft = position.left; scrollElement.scrollTop = position.top
    } else setRect(captureRect(active.start, { x: event.clientX - active.bounds.left, y: event.clientY - active.bounds.top }, active.bounds, .01))
  }
  function finish(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    event.preventDefault(); event.stopPropagation()
    if (mode === 'capture') {
      const chosen = captureRect(active.start, { x: event.clientX - active.bounds.left, y: event.clientY - active.bounds.top }, active.bounds)
      setRect(chosen); setError(chosen ? '' : 'Drag an area at least 8 × 8 pixels.')
    }
    release(); setDragging(false)
  }
  function lost(event: PointerEvent<HTMLDivElement>) { if (gesture.current?.id === event.pointerId) cancel() }
  async function confirm(action:PdfCaptureAction='canvas') {
    if (!rect || !ready || adding.current) return
    adding.current = true; setBusy(true); setError('')
    try { const accepted = await callbacks.current.onConfirm({ ...rect },action); if (mounted.current && accepted && (action==='canvas'||action==='chat')) setRect(null) }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'The PDF region could not be added. Retry the capture.') }
    finally { if (mounted.current) { adding.current = false; setBusy(false) } }
  }
  return <>
    <div ref={element} className={`pdf-interaction-layer ${mode} ${dragging ? 'dragging' : ''} ${!ready && mode === 'capture' ? 'waiting' : ''}`} role="region" aria-label={mode === 'capture' ? 'PDF capture area' : 'PDF hand tool'} aria-busy={busy}
      onPointerDown={down} onPointerMove={move} onPointerUp={finish} onPointerCancel={lost} onLostPointerCapture={lost}
      onMouseDown={event => { event.preventDefault(); event.stopPropagation() }} onMouseUp={event => { event.preventDefault(); event.stopPropagation() }}>
      {mode === 'capture' && <div className="pdf-capture-hint"><Crop size={13}/>{ready ? 'Drag a region from this PDF page' : 'Waiting for the page to finish rendering…'}</div>}
      {rect && <div className="pdf-capture-selection" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}/>}
      {!rect && error && <div className="pdf-capture-error" role="status">{error}</div>}
    </div>
    {rect && !dragging && position && createPortal(<div ref={controls} className="pdf-capture-confirm" role="toolbar" aria-label="PDF capture actions" style={position} onMouseDown={event => { event.preventDefault(); event.stopPropagation() }} onMouseUp={event => event.stopPropagation()}>
      <span>Page {page}</span><button type="button" aria-label="Add PDF capture to Canvas" disabled={!ready || busy} onClick={() => void confirm('canvas')}><Check size={13}/>{busy ? 'Adding…' : 'Add to Canvas'}</button><button type="button" aria-label="Add PDF capture to Chat" disabled={!ready||busy} onClick={()=>void confirm('chat')}><MessageCircle size={13}/>Add to Chat</button><button type="button" aria-label="Copy PDF capture image" disabled={!ready||busy} onClick={()=>void confirm('copy')}><Copy size={13}/>Copy</button><button type="button" aria-label="Save PDF capture image" disabled={!ready||busy} onClick={()=>void confirm('save')}><Download size={13}/>Save PNG</button><button type="button" aria-label="Cancel PDF capture" disabled={busy} onClick={cancel}><X size={13}/>Cancel</button>
      {error && <p role="alert">{error}</p>}
    </div>, document.body)}
  </>
}

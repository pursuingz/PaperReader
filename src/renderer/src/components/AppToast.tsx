import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import './appToast.css'

export type ToastTone = 'success' | 'info' | 'warning'
export interface ToastMessage { id: number; message: string; tone: ToastTone }
interface Props { toast: ToastMessage | null; onDismiss(id: number): void }

/** One feedback surface; interaction dialogs and field errors keep their own context. */
export default function AppToast({ toast, onDismiss }: Props) {
  const card = useRef<HTMLDivElement>(null), dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  useEffect(() => {
    if (!toast || toast.tone === 'warning') return
    let remaining = 4000, started = 0, timer: ReturnType<typeof setTimeout> | undefined
    let hovered = false, focused = false
    const stop = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; remaining = Math.max(0, remaining - (performance.now() - started)) } }
    const resume = () => { if (hovered || focused || timer !== undefined) return; started = performance.now(); timer = setTimeout(() => { timer = undefined; dismiss.current(toast.id) }, remaining) }
    const enter = () => { hovered = true; stop() }, leave = () => { hovered = false; resume() }
    const focus = () => { focused = true; stop() }
    const blur = (event: FocusEvent) => { if (event.relatedTarget instanceof Node && card.current?.contains(event.relatedTarget)) return; focused = false; resume() }
    const node = card.current
    hovered = Boolean(node?.matches(':hover')); focused = Boolean(node?.contains(document.activeElement))
    node?.addEventListener('mouseenter', enter); node?.addEventListener('mouseleave', leave)
    node?.addEventListener('focusin', focus); node?.addEventListener('focusout', blur)
    resume()
    return () => { stop(); node?.removeEventListener('mouseenter', enter); node?.removeEventListener('mouseleave', leave); node?.removeEventListener('focusin', focus); node?.removeEventListener('focusout', blur) }
  }, [toast?.id])
  if (!toast) return null
  const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'warning' ? TriangleAlert : Info
  return createPortal(<div className="app-toast-layer"><div ref={card} className={`app-toast app-toast-${toast.tone}`} role={toast.tone === 'warning' ? 'alert' : 'status'} aria-atomic="true"><Icon className="app-toast-symbol" size={18}/><span className="app-toast-message">{toast.message}</span><button type="button" className="app-toast-close" aria-label="Dismiss notice" onClick={() => onDismiss(toast.id)}><X size={15}/></button></div></div>, document.body)
}

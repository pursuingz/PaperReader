import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlignLeft, Highlighter, Languages, Sparkles, X } from 'lucide-react'
import { isCurrentSelection, positionSelectionToolbar, type SelectionAction, type SelectionSnapshot } from '../selectionMenu'
import './selection-toolbar.css'

export interface SelectionToolbarProps {
  selection: SelectionSnapshot | null
  onAction(action: SelectionAction, selection: SelectionSnapshot): void
  onDismiss(): void
  disabled?: boolean
  canHighlight?: boolean
}

/** Captures no PDF/API state: the parent validates this snapshot when handling actions. */
export default function SelectionToolbar({ selection, onAction, onDismiss, disabled = false, canHighlight = true }: SelectionToolbarProps) {
  const element = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onAction, onDismiss })
  callbacks.current = { onAction, onDismiss }
  const [size, setSize] = useState({ width: 390, height: 45 })
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const valid = selection && isCurrentSelection(selection, selection.paperId, selection.page)
  const position = valid ? positionSelectionToolbar(selection.rect, size, viewport) : null
  useLayoutEffect(() => {
    if (!selection) return
    setViewport({ width: window.innerWidth, height: window.innerHeight })
    const node = element.current
    if (!node) return
    const measure = () => {
      const rect = node.getBoundingClientRect()
      setSize(previous => previous.width === rect.width && previous.height === rect.height ? previous : { width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [selection])
  useEffect(() => {
    if (!selection) return
    const inside = (target: EventTarget | null) => target instanceof Node && Boolean(element.current?.contains(target))
    const outside = (event: PointerEvent) => { if (!inside(event.target)) callbacks.current.onDismiss() }
    const scroll = (event: Event) => { if (!inside(event.target)) callbacks.current.onDismiss() }
    const resize = () => callbacks.current.onDismiss()
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); callbacks.current.onDismiss() }
      else if (event.altKey && event.key === 'Enter') {
        event.preventDefault()
        element.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
      }
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', key)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', key)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
    }
  }, [selection])
  if (!selection || !position) return null
  function action(value: SelectionAction) {
    if (disabled || !selection || value === 'highlight' && !canHighlight) return
    callbacks.current.onAction(value, selection)
    callbacks.current.onDismiss()
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(element.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0 || !buttons.length) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next].focus({ preventScroll: true })
  }
  return createPortal(<div ref={element} className="selection-toolbar" role="toolbar" aria-label="Selected text actions" aria-keyshortcuts="Alt+Enter" data-placement={position.placement} style={{ left: position.left, top: position.top }} onPointerDown={event => event.preventDefault()} onMouseDown={event => event.preventDefault()} onKeyDown={navigate}>
    <button type="button" className="selection-explain" aria-label="Explain selection" title="Explain selected text · Alt+Enter to focus actions" disabled={disabled} onClick={() => action('explain')}><Sparkles size={13}/><span>Explain</span></button>
    <button type="button" aria-label="Translate selection" title="Translate selected text" disabled={disabled} onClick={() => action('translate')}><Languages size={13}/><span>Translate</span></button>
    <button type="button" aria-label="Summarize selection" title="Summarize selected text" disabled={disabled} onClick={() => action('summarize')}><AlignLeft size={13}/><span>Summarize</span></button>
    <span className="selection-toolbar-divider" aria-hidden="true"/>
    <button type="button" className="selection-highlight" aria-label="Highlight selection" title={canHighlight ? 'Save a highlight' : 'Highlighting is unavailable until saved marks load'} disabled={disabled || !canHighlight} onClick={() => action('highlight')}><Highlighter size={13}/><span>Highlight</span></button>
    <button type="button" className="selection-toolbar-dismiss" aria-label="Dismiss selection actions" title="Dismiss · Escape" onClick={() => callbacks.current.onDismiss()}><X size={12}/></button>
  </div>, document.body)
}

import { useEffect, useRef, useState } from 'react'
import type { DesktopAPI, DesktopMenuName } from '../../../shared/types'
import '../desktopMenus.css'

export interface DesktopMenuBarProps {
  api: Pick<DesktopAPI, 'openDesktopMenu'>
  disabled?: boolean
  onNotice?(message: string): void
}

const names: Array<{ name: DesktopMenuName; label: string }> = [
  { name: 'file', label: 'File' }, { name: 'edit', label: 'Edit' },
  { name: 'view', label: 'View' }, { name: 'help', label: 'Help' }
]

export default function DesktopMenuBar({ api, disabled = false, onNotice }: DesktopMenuBarProps) {
  const [active, setActive] = useState<DesktopMenuName | null>(null)
  const opening = useRef(false)
  const mounted = useRef(true)
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  async function open(name: DesktopMenuName, button: HTMLButtonElement) {
    if (disabled || opening.current) return
    opening.current = true
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const bounds = button.getBoundingClientRect()
    setActive(name)
    try { await api.openDesktopMenu(name, Math.max(0, Math.round(bounds.left)), Math.max(0, Math.round(bounds.bottom))) }
    catch { if (mounted.current) onNotice?.('The desktop menu could not be opened. Try again.') }
    finally {
      opening.current = false
      if (mounted.current) {
        setActive(null)
        // A menu command may have opened a modal. Preserve its deliberate focus.
        if (!document.querySelector('[role="dialog"][aria-modal="true"]') &&
          (document.activeElement === previousFocus || document.activeElement === document.body || document.activeElement === button)) {
          (previousFocus?.isConnected ? previousFocus : button).focus({ preventScroll: true })
        }
      }
    }
  }

  return <nav className="desktop-menu-bar" aria-label="Application menus">
    {names.map(({ name, label }, index) => <button key={name} ref={element => { buttons.current[index] = element }} type="button" aria-label={`${label} menu`} aria-haspopup="menu" aria-expanded={active === name} disabled={disabled} className={active === name ? 'active' : ''} onPointerDown={event => { if (event.button === 0) event.preventDefault() }} onClick={event => { void open(name, event.currentTarget) }} onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const next = (index + (event.key === 'ArrowLeft' ? -1 : 1) + names.length) % names.length
        buttons.current[next]?.focus()
      } else if (event.key === 'ArrowDown') { event.preventDefault(); void open(name, event.currentTarget) }
    }}>{label}</button>)}
  </nav>
}

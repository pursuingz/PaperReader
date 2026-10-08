import type { DesktopCommand } from '../../shared/types'

export interface DesktopKey { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; repeat?: boolean; defaultPrevented?: boolean; isComposing?: boolean }
export interface DesktopKeyContext {
  busy: boolean; hasPaper: boolean; hasRealPaper: boolean; hasModal: boolean; settingsOpen: boolean; helpOpen: boolean
  childEscapeLayer: boolean; selectionOpen: boolean; searchOpen: boolean; navigationOpen: boolean
  interactionMode: 'read' | 'hand' | 'capture'; focusMode: boolean; editingText: boolean
}
export type DesktopKeyAction = DesktopCommand | 'dismiss-settings' | 'dismiss-help' | 'dismiss-selection' | 'dismiss-search' | 'dismiss-navigation'
/** A native page-scroll key should cancel a delayed fullscreen anchor without consuming the key. */
export function isReadingScrollKey(event: DesktopKey, editingText: boolean): boolean {
  return !editingText && !event.defaultPrevented && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
}
/** Leaves native text shortcuts and child modal/gesture Escape handlers untouched. */
export function resolveDesktopKey(event: DesktopKey, state: DesktopKeyContext): DesktopKeyAction | null {
  if (event.defaultPrevented || event.repeat || event.isComposing) return null
  if (event.key === 'Escape') {
    if (state.settingsOpen) return 'dismiss-settings'
    if (state.helpOpen) return 'dismiss-help'
    if (state.hasModal || state.childEscapeLayer || state.busy) return null
    if (state.selectionOpen) return 'dismiss-selection'
    if (state.searchOpen) return 'dismiss-search'
    if (state.navigationOpen) return 'dismiss-navigation'
    if (state.interactionMode !== 'read') return 'read-mode'
    return state.focusMode ? 'toggle-focus' : null
  }
  if (state.hasModal || state.busy || event.shiftKey) return null
  const command = event.ctrlKey || event.metaKey
  if (command && !event.altKey) {
    if (event.key.toLowerCase() === 'o') return 'import'
    if (event.key.toLowerCase() === 'f' && state.hasRealPaper) return 'find'
    if (event.key.toLowerCase() === 's' && state.hasPaper) return 'save'
  }
  if (!command && !event.altKey && event.key === 'F11' && state.hasPaper) return 'toggle-focus'
  if (!command && event.altKey && !state.editingText) {
    if (event.key === 'ArrowLeft') return 'back'
    if (event.key === 'ArrowRight') return 'forward'
  }
  return null
}

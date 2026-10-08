import { Menu } from 'electron'
import type { BrowserWindow } from 'electron'
import type { DesktopCommand, DesktopMenuName, DesktopMenuState } from '../shared/types'
import { createDesktopMenuTemplates, desktopCommandEnabled, validateDesktopMenuName, validateDesktopMenuState } from './desktopMenuModel'

export interface DesktopMenus {
  update(state: unknown): void
  popup(name: DesktopMenuName, x: number, y: number): Promise<void>
  close(): void
  dispose(): void
}

/** Each popup is scoped to its owning window; commands still use renderer save/load guards. */
export function createDesktopMenus(owner: BrowserWindow, dispatch: (command: DesktopCommand) => void, factory: Pick<typeof Menu, 'buildFromTemplate'> = Menu): DesktopMenus {
  let state: DesktopMenuState = { hasPaper: false, hasRealPaper: false, busy: true, canBack: false, canForward: false, focusMode: false, rightOpen: true, canvasReady: false, readerView: 'reader' }
  let disposed = false
  let active: { name: DesktopMenuName; menu: Menu; finish(): void } | null = null

  const send = (command: DesktopCommand) => {
    if (!disposed && !owner.isDestroyed() && desktopCommandEnabled(command, state)) dispatch(command)
  }
  function close() {
    const previous = active
    if (!previous) return
    try { if (!owner.isDestroyed()) previous.menu.closePopup(owner) }
    finally { previous.finish() }
  }
  function dispose() {
    if (disposed) return
    disposed = true
    close()
    owner.removeListener('closed', dispose)
  }
  owner.once('closed', dispose)

  return {
    update(value) {
      const next = validateDesktopMenuState(value)
      if (disposed) return
      const changed = (Object.keys(next) as Array<keyof DesktopMenuState>).some(key => next[key] !== state[key])
      state = next
      // Native callbacks capture the menu's original state. Reopen from fresh state.
      if (changed) close()
    },
    async popup(input, x, y) {
      const name = validateDesktopMenuName(input)
      if (disposed || owner.isDestroyed()) throw new Error('Desktop menu window is unavailable')
      close()
      const menu = factory.buildFromTemplate(createDesktopMenuTemplates(state, send)[name])
      await new Promise<void>((resolve, reject) => {
        const current = { name, menu, finish: () => { if (active === current) active = null; resolve() } }
        active = current
        try { menu.popup({ window: owner, x, y, callback: current.finish }) }
        catch (error) { if (active === current) active = null; reject(error) }
      })
    },
    close,
    dispose
  }
}

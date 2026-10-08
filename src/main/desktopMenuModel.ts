import type { MenuItemConstructorOptions } from 'electron'
import type { DesktopCommand, DesktopMenuName, DesktopMenuState } from '../shared/types'

export function validateDesktopMenuName(value: unknown): DesktopMenuName {
  if (value !== 'file' && value !== 'edit' && value !== 'view' && value !== 'help') throw new Error('Invalid desktop menu name')
  return value
}

export function validateDesktopMenuState(value: unknown): DesktopMenuState {
  const booleanKeys = ['hasPaper', 'hasRealPaper', 'busy', 'canBack', 'canForward', 'focusMode', 'rightOpen', 'canvasReady'] as const
  const optionalBooleanKeys = ['notesReady', 'notesExportReady', 'pdfExportReady', 'canvasExportReady'] as const
  const allowedKeys = new Set<string>([...booleanKeys, ...optionalBooleanKeys, 'readerView'])
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowedKeys.has(key))) throw new Error('Invalid desktop menu state')
  const record = value as Record<string, unknown>
  if (booleanKeys.some(key => !Object.hasOwn(record, key) || typeof record[key] !== 'boolean') ||
    optionalBooleanKeys.some(key => Object.hasOwn(record, key) && typeof record[key] !== 'boolean') ||
    !Object.hasOwn(record, 'readerView') || (record.readerView !== 'reader' && record.readerView !== 'summary')) throw new Error('Invalid desktop menu state')
  return { ...record } as unknown as DesktopMenuState
}

export function desktopCommandEnabled(command: DesktopCommand, state: DesktopMenuState): boolean {
  if (state.busy) return false
  const paper = state.hasPaper
  const pdf = paper && state.hasRealPaper
  const reader = state.readerView === 'reader'
  switch (command) {
    case 'import': case 'settings': case 'help': case 'about': case 'close': return true
    case 'back': return state.canBack
    case 'forward': return state.canForward
    case 'home': case 'reader': case 'summary': case 'toggle-assistant': return paper
    case 'save': return paper && state.notesReady !== false
    case 'toggle-focus': return paper && (reader || state.focusMode)
    case 'export-notes': return pdf && state.notesExportReady !== false
    case 'export-pdf': return pdf && state.pdfExportReady !== false
    case 'export-canvas': return pdf && state.canvasReady && state.canvasExportReady !== false
    case 'zoom-in': case 'zoom-out': case 'zoom-reset': return paper && reader
    case 'find': return pdf
    case 'capture-mode': return pdf && reader && state.canvasReady
    case 'read-mode': case 'pan-mode': return pdf && reader
    default: return false
  }
}

export function createDesktopMenuTemplates(input: DesktopMenuState, dispatch: (command: DesktopCommand) => void): Record<DesktopMenuName, MenuItemConstructorOptions[]> {
  const state = validateDesktopMenuState(input)
  const separator: MenuItemConstructorOptions = { type: 'separator' }
  const command = (id: DesktopCommand, label: string, checked?: boolean): MenuItemConstructorOptions => ({
    id, label, enabled: desktopCommandEnabled(id, state),
    ...(checked === undefined ? {} : { type: 'checkbox', checked }),
    click: () => { if (desktopCommandEnabled(id, state)) dispatch(id) }
  })
  return {
    file: [
      command('import', 'Import PDF…    Ctrl+O'), command('save', 'Save current paper    Ctrl+S'), separator,
      command('export-notes', 'Export reading notes…'), command('export-pdf', 'Export annotated PDF…'), command('export-canvas', 'Export Canvas PNG…'), separator,
      command('home', 'Back to Welcome'), command('settings', 'Settings…'), separator, command('close', 'Close Paper Reader')
    ],
    edit: [{ role: 'undo' }, { role: 'redo' }, separator, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, separator, { role: 'selectAll' }],
    view: [
      command('reader', 'Reader', state.readerView === 'reader'), command('summary', 'Summary', state.readerView === 'summary'), separator,
      command('find', 'Find in PDF    Ctrl+F'), command('read-mode', 'Select text'), command('pan-mode', 'Hand tool'), command('capture-mode', 'Capture PDF region'), separator,
      command('toggle-assistant', 'Assistant panel', state.rightOpen), command('toggle-focus', 'Reading focus    F11', state.focusMode), separator,
      command('zoom-in', 'Zoom in'), command('zoom-out', 'Zoom out'), command('zoom-reset', 'Reset zoom'), separator,
      command('back', 'Back    Alt+Left'), command('forward', 'Forward    Alt+Right')
    ],
    help: [command('help', 'Reading guide'), command('about', 'About Paper Reader')]
  }
}

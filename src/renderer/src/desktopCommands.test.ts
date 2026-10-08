import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isReadingScrollKey, resolveDesktopKey, type DesktopKeyContext } from './desktopCommands'

const context: DesktopKeyContext = { busy: false, hasPaper: true, hasRealPaper: true, hasModal: false, settingsOpen: false, helpOpen: false, childEscapeLayer: false, selectionOpen: false, searchOpen: false, navigationOpen: false, interactionMode: 'read', focusMode: false, editingText: false }
test('shortcuts map to existing guarded application commands', () => {
  assert.equal(resolveDesktopKey({ key: 'o', ctrlKey: true }, context), 'import')
  assert.equal(resolveDesktopKey({ key: 'F', ctrlKey: true }, context), 'find')
  assert.equal(resolveDesktopKey({ key: 's', ctrlKey: true }, context), 'save')
  assert.equal(resolveDesktopKey({ key: 'F11' }, context), 'toggle-focus')
  assert.equal(resolveDesktopKey({ key: 'ArrowLeft', altKey: true }, context), 'back')
  assert.equal(resolveDesktopKey({ key: 'ArrowRight', altKey: true }, context), 'forward')
})
test('repeats, consumed events, composition and wrong modifier combinations do nothing', () => {
  for (const flags of [{ repeat: true }, { defaultPrevented: true }, { isComposing: true }, { shiftKey: true }, { altKey: true }]) assert.equal(resolveDesktopKey({ key: 'o', ctrlKey: true, ...flags }, context), null)
  assert.equal(resolveDesktopKey({ key: 'ArrowLeft', altKey: true }, { ...context, editingText: true }), null)
  assert.equal(resolveDesktopKey({ key: 'z', ctrlKey: true }, context), null)
})
test('no-paper and busy states disable unsupported shortcuts', () => {
  assert.equal(resolveDesktopKey({ key: 'o', ctrlKey: true }, { ...context, hasPaper: false, hasRealPaper: false }), 'import')
  assert.equal(resolveDesktopKey({ key: 'f', ctrlKey: true }, { ...context, hasRealPaper: false }), null)
  assert.equal(resolveDesktopKey({ key: 's', ctrlKey: true }, { ...context, hasPaper: false }), null)
  assert.equal(resolveDesktopKey({ key: 'o', ctrlKey: true }, { ...context, busy: true }), null)
})
test('Escape consumes one application layer before focus', () => {
  const layered = { ...context, focusMode: true, navigationOpen: true, searchOpen: true, selectionOpen: true }
  assert.equal(resolveDesktopKey({ key: 'Escape' }, { ...layered, settingsOpen: true, hasModal: true }), 'dismiss-settings')
  assert.equal(resolveDesktopKey({ key: 'Escape' }, { ...layered, helpOpen: true, hasModal: true }), 'dismiss-help')
  assert.equal(resolveDesktopKey({ key: 'Escape' }, { ...layered, hasModal: true }), null)
  assert.equal(resolveDesktopKey({ key: 'Escape' }, { ...layered, childEscapeLayer: true }), null)
  assert.equal(resolveDesktopKey({ key: 'Escape' }, layered), 'dismiss-selection')
  assert.equal(resolveDesktopKey({ key: 'Escape' }, { ...layered, selectionOpen: false }), 'dismiss-search')
  assert.equal(resolveDesktopKey({ key: 'Escape' }, { ...layered, selectionOpen: false, searchOpen: false }), 'dismiss-navigation')
  assert.equal(resolveDesktopKey({ key: 'Escape' }, { ...context, interactionMode: 'capture', focusMode: true }), 'read-mode')
  assert.equal(resolveDesktopKey({ key: 'Escape' }, { ...context, focusMode: true }), 'toggle-focus')
})
test('modal dialogs suppress global shortcuts and busy Escape cannot change views', () => {
  assert.equal(resolveDesktopKey({ key: 'F11' }, { ...context, hasModal: true }), null)
  assert.equal(resolveDesktopKey({ key: 'o', ctrlKey: true }, { ...context, hasModal: true }), null)
  assert.equal(resolveDesktopKey({ key: 'Escape' }, { ...context, busy: true, focusMode: true }), null)
})
test('native keyboard scrolling cancels delayed position restoration while text editing does not', () => {
  for (const key of ['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', ' ']) assert.equal(isReadingScrollKey({ key }, false), true)
  assert.equal(isReadingScrollKey({ key: 'PageDown' }, true), false)
  assert.equal(isReadingScrollKey({ key: 'ArrowLeft', altKey: true }, false), false)
  assert.equal(isReadingScrollKey({ key: 'Home', ctrlKey: true }, false), false)
  assert.equal(isReadingScrollKey({ key: ' ', defaultPrevented: true }, false), false)
  assert.equal(isReadingScrollKey({ key: 'ArrowDown', isComposing: true }, false), false)
  assert.equal(isReadingScrollKey({ key: ' ', shiftKey: true }, false), true)
  assert.equal(isReadingScrollKey({ key: 'F11' }, false), false)
})

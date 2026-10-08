import test from 'node:test'
import assert from 'node:assert/strict'
import { isCurrentSelection, positionSelectionToolbar, type SelectionSnapshot } from './selectionMenu'

const selection: SelectionSnapshot = { paperId: 'paper-a', page: 3, text: 'Selected passage', rect: { left: 100, top: 120, right: 240, bottom: 150 } }

test('selection actions require the exact current paper/page and valid text geometry', () => {
  assert.equal(isCurrentSelection(selection, 'paper-a', 3), true)
  assert.equal(isCurrentSelection(selection, 'paper-b', 3), false)
  assert.equal(isCurrentSelection(selection, 'paper-a', 4), false)
  assert.equal(isCurrentSelection(null, 'paper-a', 3), false)
  assert.equal(isCurrentSelection(selection, null, 3), false)
  for (const text of ['', ' \n\t ', 'x'.repeat(30001)]) assert.equal(isCurrentSelection({ ...selection, text }, 'paper-a', 3), false)
  assert.equal(isCurrentSelection({ ...selection, page: 1.5 }, 'paper-a', 1.5), false)
  assert.equal(isCurrentSelection({ ...selection, rect: { ...selection.rect, right: Number.NaN } }, 'paper-a', 3), false)
})

test('the menu prefers above the selection, centered and clear of its text', () => {
  assert.deepEqual(positionSelectionToolbar({ left: 200, top: 150, right: 400, bottom: 170 }, { width: 300, height: 40 }, { width: 900, height: 700 }), { left: 150, top: 100, placement: 'above' })
})

test('a selection at the top opens below, and left/right edges keep every action in the viewport', () => {
  assert.deepEqual(positionSelectionToolbar({ left: 0, top: 5, right: 80, bottom: 25 }, { width: 300, height: 40 }, { width: 900, height: 700 }), { left: 10, top: 35, placement: 'below' })
  assert.equal(positionSelectionToolbar({ left: 890, top: 200, right: 960, bottom: 220 }, { width: 300, height: 40 }, { width: 900, height: 700 })?.left, 590)
})

test('tall selections and narrow windows clamp menu bounds without changing the captured selection', () => {
  const rect = { left: -10, top: -30, right: 340, bottom: 500 }
  const captured = { ...rect }
  const result = positionSelectionToolbar(rect, { width: 400, height: 80 }, { width: 320, height: 240 })!
  assert.ok(result.left >= 10 && result.left + 300 <= 310)
  assert.ok(result.top >= 10 && result.top + 80 <= 230)
  assert.deepEqual(rect, captured)
})

test('offscreen, collapsed and non-finite rectangles never create a floating menu', () => {
  const size = { width: 300, height: 40 }, viewport = { width: 900, height: 700 }
  for (const rect of [
    { left: 0, top: -50, right: 20, bottom: -20 },
    { left: 901, top: 10, right: 910, bottom: 30 },
    { left: 20, top: 30, right: 20, bottom: 50 },
    { left: 10, top: Infinity, right: 20, bottom: Infinity },
    { left: 50, top: 10, right: 20, bottom: 30 }
  ]) assert.equal(positionSelectionToolbar(rect, size, viewport), null)
  assert.equal(positionSelectionToolbar(selection.rect, size, { width: 0, height: 700 }), null)
})

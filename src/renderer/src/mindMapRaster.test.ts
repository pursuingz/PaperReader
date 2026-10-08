import test from 'node:test'
import assert from 'node:assert/strict'
import { drawMindMapModel } from './canvasRaster'
import type { MindMapDocument } from '../../shared/diagramTypes'
test('full map raster renders all Unicode lines and branch endpoints without viewport cropping', () => {
  const calls: Array<{ name: string; args: unknown[] }> = [], context = Object.fromEntries(['save', 'restore', 'fillRect', 'beginPath', 'rect', 'stroke', 'fill', 'moveTo', 'lineTo', 'fillText'].map(name => [name, (...args: unknown[]) => calls.push({ name, args })])) as unknown as CanvasRenderingContext2D
  const value: MindMapDocument = { version: 1, paperId: 'p', nodes: [{ id: 'r', text: 'Root', parentId: null, order: 0 }, { id: 'c', text: '中文🙂'.repeat(30), parentId: 'r', order: 0 }] }
  const bounds = drawMindMapModel(context, value)
  assert.ok(bounds.width > 500 && bounds.height > 250); assert.equal(calls.filter(call => call.name === 'rect').length, 2)
  assert.equal(calls.filter(call => call.name === 'fillText').map(call => call.args[0]).join(''), `Root${value.nodes[1].text}`)
  assert.equal(calls.filter(call => call.name === 'lineTo').length, 1)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import type { CanvasDocument } from '../../shared/types'
import type { CanvasDiagram } from '../../shared/diagramTypes'
import { drawCanvasModel, wrapCanvasText } from './canvasRaster'

test('Unicode text wrapping preserves graphemes/newlines and bounds work to the clipped text area', () => {
  assert.deepEqual(wrapCanvasText('中文🙂e\u0301\nsecond', 4, value => [...value].length, 20), ['中文🙂', 'e\u0301', 'seco', 'nd'])
  assert.deepEqual(wrapCanvasText('a\n\n中', 10, value => value.length, 5), ['a', '', '中'])
  let measured = 0; assert.equal(wrapCanvasText('中'.repeat(100000), 4, value => { measured++; return value.length }, 2).length, 2); assert.ok(measured < 15)
})
const assetId = '0c1b7a32-e2b8-4589-9975-338d50eeb643'
const model = (): CanvasDocument => ({ version: 1, width: 1000, height: 1200, objects: [
  { id: 'lower-text', type: 'text', x: 40, y: 950, width: 150, height: 100, text: '中文🙂wrapped text', color: '#334155', fontSize: 24 },
  { id: 'owned-image', type: 'image', x: 500, y: 800, width: 300, height: 150, assetId },
  { id: 'ink', type: 'stroke', color: '#ed6376', strokeWidth: 4, points: [{ x: 40, y: 1150 }, { x: 900, y: 1150 }] }
] })
function context() {
  const calls: Array<{ name: string; args: unknown[] }> = []
  const ctx = Object.fromEntries(['save', 'restore', 'scale', 'fillRect', 'beginPath', 'arc', 'fill', 'rect', 'clip', 'fillText', 'drawImage', 'moveTo', 'lineTo', 'stroke'].map(name => [name, (...args: unknown[]) => calls.push({ name, args })])) as unknown as CanvasRenderingContext2D
  ctx.measureText = value => ({ width: [...value].length * 12 }) as TextMetrics
  return { ctx, calls }
}
test('raster draws the full fixed model at 2x in object order, clips text, and releases owned decoded images', async () => {
  const { ctx, calls } = context(), decoded = { image: {} as CanvasImageSource, width: 400, height: 200, close: () => { closed++ } }; let closed = 0
  await drawCanvasModel(ctx, model(), async requested => { assert.equal(requested, assetId); return decoded })
  assert.deepEqual(calls.find(value => value.name === 'scale')?.args, [2, 2]); assert.deepEqual(calls.find(value => value.name === 'fillRect')?.args, [0, 0, 1000, 1200])
  const clip = calls.find(value => value.name === 'rect'); assert.deepEqual(clip?.args, [40, 950, 150, 100])
  const textAt = calls.findIndex(value => value.name === 'fillText'), imageAt = calls.findIndex(value => value.name === 'drawImage'), inkAt = calls.findIndex(value => value.name === 'moveTo' && value.args[0] === 40 && value.args[1] === 1150)
  assert.ok(textAt < imageAt && imageAt < inkAt); assert.equal(calls[imageAt].args[2], 800); assert.deepEqual(calls[inkAt].args, [40, 1150]); assert.equal(closed, 1)
  assert.equal(calls.filter(value => value.name === 'stroke').length, 1); assert.equal(calls.filter(value => value.name === 'drawImage').length, 1)
})
test('raster refuses missing/undecoded owned images and restores context rather than exporting an incomplete image', async () => {
  const first = context(); await assert.rejects(drawCanvasModel(first.ctx, model(), async () => { throw new Error('Owned image missing') }), /Owned image missing/); assert.equal(first.calls.at(-1)?.name, 'restore')
  const second = context(); await assert.rejects(drawCanvasModel(second.ctx, model(), async () => ({ image: {} as CanvasImageSource, width: 0, height: 200 })), /image|decode/i)
  assert.equal(second.calls.some(value => value.name === 'drawImage'), false)
})
test('single-point ink remains visible in PNG and blank saved text exports no editor placeholder', async () => {
  const { ctx, calls } = context(), document = model(); document.objects = [
    { ...document.objects[0], text: '' } as CanvasDocument['objects'][number],
    { id: 'dot', type: 'stroke', color: '#334155', strokeWidth: 4, points: [{ x: 700, y: 1100 }, { x: 700, y: 1100 }] }
  ]
  await drawCanvasModel(ctx, document, async () => { throw new Error('No image expected') }); assert.equal(calls.some(value => value.name === 'fillText'), false); assert.ok(calls.some(value => value.name === 'arc' && value.args[0] === 700 && value.args[1] === 1100 && value.args[2] === 2))
})
test('complete canvas raster draws saved diagram geometry and connected base edges after existing objects', async () => {
  const { ctx, calls } = context(), base = model(), diagram: CanvasDiagram = { version: 1, paperId: 'p', shapes: [{ id: 'box', kind: 'rectangle', x: 300, y: 950, width: 100, height: 100, fill: '#fffbf2', color: '#334155', lineWidth: 3 }], arrows: [{ id: 'arrow', start: { x: 30, y: 30 }, end: { x: 300, y: 30 }, color: '#334155', lineWidth: 3 }], connections: [{ id: 'link', from: { domain: 'base', objectId: 'lower-text', anchor: 'right' }, to: { domain: 'shape', objectId: 'box', anchor: 'left' }, color: '#334155', lineWidth: 3 }] }
  await drawCanvasModel(ctx, base, async () => ({ image: {} as CanvasImageSource, width: 400, height: 200 }), diagram)
  assert.ok(calls.some(call => call.name === 'rect' && call.args[0] === 300 && call.args[1] === 950))
  assert.ok(calls.some(call => call.name === 'moveTo' && call.args[0] === 190 && call.args[1] === 1000))
  assert.ok(calls.some(call => call.name === 'lineTo' && call.args[0] === 300 && call.args[1] === 1000))
  assert.ok(calls.some(call => call.name === 'lineTo' && call.args[0] === 300 && call.args[1] === 30))
})

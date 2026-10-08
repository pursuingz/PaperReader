import test from 'node:test'
import assert from 'node:assert/strict'
import { captureRect, rasterCrop, panScroll, PdfRenderLifecycle, capturePdfRaster, shouldDismissPdfCapture } from './pdfInteraction'

test('Escape preserves a capture underneath a modal and consumes only the visible active selection', () => {
  const escape = { key: 'Escape', defaultPrevented: false }
  assert.equal(shouldDismissPdfCapture(escape, true, true), false, 'Help/settings/expanded Canvas has precedence over a background capture')
  assert.equal(shouldDismissPdfCapture(escape, true, false), true, 'After the modal closes, Escape cancels the capture')
  assert.equal(shouldDismissPdfCapture({ ...escape, defaultPrevented: true }, true, false), false)
  assert.equal(shouldDismissPdfCapture(escape, false, false), false, 'No capture leaves Escape for tool/focus')
  assert.equal(shouldDismissPdfCapture({ ...escape, key: 'Enter' }, true, false), false)
})

test('reverse and edge-crossing drags produce clipped normalized capture geometry', () => {
  assert.deepEqual(captureRect({ x: 180, y: 240 }, { x: 40, y: 60 }, { width: 200, height: 300 }), { x: .2, y: .2, width: .7, height: .6 })
  assert.deepEqual(captureRect({ x: -10, y: 50 }, { x: 240, y: 350 }, { width: 200, height: 300 }), { x: 0, y: 1 / 6, width: 1, height: 5 / 6 })
})

test('a capture needs eight visible CSS pixels in both dimensions, independent of device DPI', () => {
  assert.equal(captureRect({ x: 0, y: 0 }, { x: 7, y: 50 }, { width: 200, height: 300 }), null)
  assert.equal(captureRect({ x: -100, y: 0 }, { x: 7, y: 50 }, { width: 200, height: 300 }), null)
  assert.ok(captureRect({ x: 0, y: 0 }, { x: 8, y: 8 }, { width: 200, height: 300 }))
  assert.equal(captureRect({ x: NaN, y: 0 }, { x: 80, y: 50 }, { width: 200, height: 300 }), null)
})

test('crop pixels use the actual rotated/high-DPI canvas, not CSS coordinates or assumed page orientation', () => {
  const crop = rasterCrop({ x: .1, y: .2, width: .5, height: .4 }, { width: 2400, height: 1600 })
  assert.deepEqual(crop, { sourceX: 240, sourceY: 320, sourceWidth: 1200, sourceHeight: 640, width: 1200, height: 640 })
  const huge = rasterCrop({ x: 0, y: 0, width: 1, height: 1 }, { width: 10000, height: 10000 })
  assert.equal(huge.width, 4000); assert.equal(huge.height, 4000)
  const wide = rasterCrop({ x: 0, y: 0, width: 1, height: 1 }, { width: 20000, height: 1000 })
  assert.equal(wide.width, 4096); assert.ok(Math.abs(wide.width / wide.height - 20) < .1)
  assert.throws(() => rasterCrop({ x: .8, y: 0, width: .3, height: 1 }, { width: 100, height: 100 }), /rectangle/i)
})

test('hand panning translates drag distance to bounded scroll offsets', () => {
  const start = { x: 120, y: 100, left: 70, top: 90 }
  const area = { scrollWidth: 900, scrollHeight: 1200, clientWidth: 500, clientHeight: 600 }
  assert.deepEqual(panScroll(start, { x: 150, y: 50 }, area), { left: 40, top: 140 })
  assert.deepEqual(panScroll(start, { x: -900, y: -900 }, area), { left: 400, top: 600 })
  assert.deepEqual(panScroll(start, { x: 900, y: 900 }, area), { left: 0, top: 0 })
})

test('only a matching file/page/width raster completion enables capture and stale jobs are invalidated', () => {
  const lifecycle = new PdfRenderLifecycle(), a = {}, b = {}
  const first = lifecycle.update(a, 1, 600, 'capture')
  assert.equal(lifecycle.beginCapture(first), null)
  assert.equal(lifecycle.rendered(first), true)
  const ticket = lifecycle.beginCapture(first)!
  assert.ok(lifecycle.current(ticket))
  const zoom = lifecycle.update(a, 1, 900, 'capture')
  assert.equal(lifecycle.current(ticket), false); assert.equal(lifecycle.rendered(first), false)
  assert.equal(lifecycle.beginCapture(zoom), null)
  lifecycle.rendered(zoom)
  const zoomTicket = lifecycle.beginCapture(zoom)!
  lifecycle.update(a, 1, 900, 'hand')
  assert.equal(lifecycle.current(zoomTicket), false)
  lifecycle.update(a, 1, 900, 'capture')
  assert.ok(lifecycle.beginCapture(zoom), 'Changing tools does not require re-rendering an already ready page')
  const sharper = lifecycle.update(a, 1, 900, 'capture', 2)
  assert.equal(lifecycle.beginCapture(sharper), null, 'A new device pixel ratio requires its own completed raster')
  assert.equal(lifecycle.rendered(zoom), false)
  const page = lifecycle.update(a, 2, 900, 'capture')
  assert.equal(lifecycle.rendered(zoom), false)
  const other = lifecycle.update(b, 2, 900, 'capture')
  assert.equal(lifecycle.rendered(page), false)
  lifecycle.rendered(other); const otherTicket = lifecycle.beginCapture(other)!
  lifecycle.dispose(); assert.equal(lifecycle.current(otherTicket), false); assert.equal(lifecycle.rendered(other), false)
})

test('new capture attempts and explicit cancellation invalidate an earlier encoded result', () => {
  const lifecycle = new PdfRenderLifecycle(), frame = lifecycle.update({}, 1, 600, 'capture')
  lifecycle.rendered(frame)
  const older = lifecycle.beginCapture(frame)!, newer = lifecycle.beginCapture(frame)!
  assert.equal(lifecycle.current(older), false); assert.ok(lifecycle.current(newer))
  lifecycle.cancelCapture(); assert.equal(lifecycle.current(newer), false)
  assert.equal(lifecycle.failed(frame - 1), false)
  const current = lifecycle.beginCapture(frame)!
  assert.equal(lifecycle.failed(frame), true)
  assert.equal(lifecycle.current(current), false); assert.equal(lifecycle.beginCapture(frame), null)
})

test('capture rasterization draws only the source PDF canvas with bounded high-DPI crop coordinates', async () => {
  const source = { width: 2400, height: 1600 } as HTMLCanvasElement
  const draws: unknown[][] = []
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args: unknown[]) => draws.push(args) }), toBlob: (callback: BlobCallback) => callback(new Blob(['encoded-png'])) } as unknown as HTMLCanvasElement
  const bytes = await capturePdfRaster(source, { x: .1, y: .2, width: .5, height: .4 }, () => true, () => canvas)
  assert.equal(new TextDecoder().decode(bytes!), 'encoded-png')
  assert.deepEqual(draws[0], [source, 240, 320, 1200, 640, 0, 0, 1200, 640])
  assert.equal(canvas.width, 0); assert.equal(canvas.height, 0)
})

test('large encoded PNGs are downsampled again, and cancellation before encoding completes yields no capture', async () => {
  let pass = 0
  const sizes: number[][] = []
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob: (callback: BlobCallback) => { sizes.push([canvas.width, canvas.height]); callback(new Blob([new Uint8Array(++pass === 1 ? 12 * 1024 * 1024 : 20)])) } } as unknown as HTMLCanvasElement
  assert.equal((await capturePdfRaster({ width: 2000, height: 2000 } as HTMLCanvasElement, { x: 0, y: 0, width: 1, height: 1 }, () => true, () => canvas))?.length, 20)
  assert.equal(sizes.length, 2); assert.ok(sizes[1][0] < sizes[0][0] && sizes[1][1] < sizes[0][1])
  let alive = true
  canvas.toBlob = callback => { alive = false; callback(new Blob(['late data'])) }
  assert.equal(await capturePdfRaster({ width: 100, height: 100 } as HTMLCanvasElement, { x: 0, y: 0, width: 1, height: 1 }, () => alive, () => canvas), null)
})

test('encoding failure is explicit and cancellation before rendering draws nothing', async () => {
  let draws = 0
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() { draws++ } }), toBlob: (callback: BlobCallback) => callback(null) } as unknown as HTMLCanvasElement
  const source = { width: 100, height: 100 } as HTMLCanvasElement, rect = { x: 0, y: 0, width: 1, height: 1 }
  assert.equal(await capturePdfRaster(source, rect, () => false, () => canvas), null)
  assert.equal(draws, 0)
  await assert.rejects(capturePdfRaster(source, rect, () => true, () => canvas), /encoded as PNG/)
  assert.equal(canvas.width, 0); assert.equal(canvas.height, 0)
})

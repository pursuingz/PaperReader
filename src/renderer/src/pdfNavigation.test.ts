import test from 'node:test'
import assert from 'node:assert/strict'
import { LocalPdfNavigation, normalizeOutline, resolveLocalDestination, thumbnailBatch, thumbnailGeometry, ThumbnailQueue, queueThumbnail, type NavigationDocument } from './pdfNavigation'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const basicDocument = (pages = 20): NavigationDocument => ({
  numPages: pages,
  getDestination: async name => name === 'chapter' ? [{ num: 7, gen: 0 }, { name: 'XYZ' }] : null,
  getPageIndex: async () => 6
})

test('local named, numeric and reference destinations produce one-based valid pages', async () => {
  const document = basicDocument()
  assert.equal(await resolveLocalDestination(document, 'chapter'), 7)
  assert.equal(await resolveLocalDestination(document, [0, { name: 'Fit' }]), 1)
  assert.equal(await resolveLocalDestination(document, [19, { name: 'Fit' }]), 20)
  assert.equal(await resolveLocalDestination(document, [{ num: 7, gen: 0 }, { name: 'Fit' }]), 7)
})

test('missing and malformed destinations never become a valid page', async () => {
  for (const destination of [null, undefined, '', 'missing', [], [-1], [20], [1.2], [NaN], [{ num: 0, gen: 0 }], [{ num: 1, gen: -1 }], ['javascript:alert(1)'], { url: 'https://example.test' }]) {
    assert.equal(await resolveLocalDestination(basicDocument(), destination), null)
  }
  assert.equal(await resolveLocalDestination({ ...basicDocument(), getPageIndex: async () => 100 }, [{ num: 1, gen: 0 }]), null)
})

test('outline preserves nested sections and does not execute external destinations', () => {
  const result = normalizeOutline([{ title: '<b>Chapter</b>', dest: [0], items: [
    { title: 'Nested', dest: 'chapter', items: [] },
    { title: 'Website', dest: [1], url: 'https://example.test', items: [] },
    { title: '', dest: null, items: [] }
  ] }])
  assert.equal(result.items[0].title, '<b>Chapter</b>')
  assert.equal(result.items[0].children[0].destination, 'chapter')
  assert.equal(result.items[0].children[1].destination, null)
  assert.equal(result.items[0].children[1].external, true)
  assert.equal(result.items[0].children[2].title, 'Untitled section')
  assert.equal(result.limited, false)
  assert.deepEqual(normalizeOutline(null).items, [])
})

test('outline traversal is bounded for cyclic or excessive nested entries', () => {
  const node: { title: string; items: unknown[] } = { title: 'Loop', items: [] }
  node.items.push(node)
  const result = normalizeOutline([node])
  assert.equal(result.limited, true)
  const broad = normalizeOutline(Array.from({ length: 6000 }, (_, i) => ({ title: String(i), items: [] })))
  assert.equal(broad.items.length, 5000)
  assert.equal(broad.limited, true)
})

test('thumbnail batches include the last page while never allocating more than eight slots', () => {
  assert.deepEqual(thumbnailBatch(1, 2000).pages, [1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual(thumbnailBatch(2000, 2000).pages, [1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000])
  assert.deepEqual(thumbnailBatch(1999, 1999).pages, [1993, 1994, 1995, 1996, 1997, 1998, 1999])
  assert.equal(thumbnailBatch(9999, 20).end, 20)
  assert.deepEqual(thumbnailBatch(1, 0).pages, [])
})

test('thumbnail geometry preserves portrait and rotated landscape aspect ratios within pixel bounds', () => {
  const portrait = thumbnailGeometry({ width: 600, height: 900 }, 3)
  assert.equal(portrait.height, 156)
  assert.equal(portrait.width, 104)
  assert.equal(portrait.pixelRatio, 2)
  const landscape = thumbnailGeometry({ width: 900, height: 600 }, 1)
  assert.equal(landscape.width, 120)
  assert.equal(landscape.height, 80)
  assert.throws(() => thumbnailGeometry({ width: Infinity, height: 900 }, 1), /dimensions/)
})

test('switching papers while bytes are pending never opens the old document and releases each owned task once', async () => {
  const old = deferred<Uint8Array>()
  const created: number[] = [], destroyed: number[] = []
  const session = new LocalPdfNavigation(id => id === 'old' ? old.promise : Promise.resolve(new Uint8Array([2])), bytes => {
    created.push(bytes[0])
    return { promise: Promise.resolve(basicDocument()), destroy: async () => { destroyed.push(bytes[0]) } }
  })
  const stale = session.open('old')
  const fresh = await session.open('new')
  old.resolve(new Uint8Array([1]))
  assert.equal(await stale, null)
  assert.equal(fresh?.numPages, 20)
  assert.deepEqual(created, [2])
  await session.cancel(); await session.cancel()
  assert.deepEqual(destroyed, [2])
})

test('cancelled task resolution cannot restore its proxy; a fresh task can open immediately', async () => {
  const old = deferred<NavigationDocument>()
  let created = 0, destroyed = 0
  const session = new LocalPdfNavigation(async () => new Uint8Array([1]), () => ({
    promise: ++created === 1 ? old.promise : Promise.resolve(basicDocument(3)),
    destroy: async () => { destroyed++ }
  }))
  const pending = session.open('a')
  await Promise.resolve()
  await session.cancel()
  const fresh = await session.open('b')
  old.resolve(basicDocument(100))
  assert.equal(await pending, null)
  assert.equal(fresh?.numPages, 3)
  assert.equal(session.isCurrent(fresh!), true)
  await session.cancel()
  assert.equal(destroyed, 2)
})

test('input bytes are copied so navigation loading cannot detach another consumers buffer', async () => {
  const bytes = new Uint8Array([1, 2, 3])
  const session = new LocalPdfNavigation(async () => bytes, input => {
    assert.notEqual(input.buffer, bytes.buffer)
    input[0] = 9
    return { promise: Promise.resolve(basicDocument()), destroy: async () => {} }
  })
  assert.equal((await session.open('paper'))?.numPages, 20)
  assert.equal(bytes[0], 1)
  await session.cancel()
})

test('a later outline click wins; navigation resolution after paper switch is ignored', async () => {
  const slow = deferred<unknown[] | null>()
  const session = new LocalPdfNavigation(async () => new Uint8Array([1]), () => ({
    promise: Promise.resolve({ ...basicDocument(), getDestination: () => slow.promise }), destroy: async () => {}
  }))
  await session.open('paper')
  const first = session.resolve('slow')
  assert.equal(await session.resolve([4]), 5)
  slow.resolve([0])
  assert.equal(await first, null)
  const stale = session.resolve([5])
  await session.cancel()
  assert.equal(await stale, null)
})

test('a cancelled named destination never requests a page reference from its destroyed proxy', async () => {
  const slow = deferred<unknown[] | null>()
  let referenceReads = 0
  const session = new LocalPdfNavigation(async () => new Uint8Array([1]), () => ({
    promise: Promise.resolve({ ...basicDocument(), getDestination: () => slow.promise, getPageIndex: async () => { referenceReads++; return 3 } }), destroy: async () => {}
  }))
  await session.open('paper')
  const pending = session.resolve('chapter')
  await session.cancel()
  slow.resolve([{ num: 10, gen: 0 }])
  assert.equal(await pending, null)
  assert.equal(referenceReads, 0)
})

test('thumbnail queue allows two concurrent renders and starts a waiting page after a slot completes', async () => {
  const queue = new ThumbnailQueue()
  const releases = Array.from({ length: 8 }, () => deferred<number>())
  const began: number[] = []
  let active = 0, peak = 0
  const work = releases.map((release, index) => queue.run(async () => {
    began.push(index); active++; peak = Math.max(peak, active)
    const result = await release.promise
    active--; return result
  }))
  await Promise.resolve()
  assert.deepEqual(began, [0, 1])
  releases[0].resolve(0); await work[0]; await Promise.resolve()
  assert.deepEqual(began, [0, 1, 2])
  releases.forEach((release, index) => release.resolve(index))
  assert.deepEqual(await Promise.all(work), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.equal(peak, 2)
  queue.close()
})

test('closing a thumbnail queue rejects pending work without starting more page renders', async () => {
  const queue = new ThumbnailQueue()
  const release = deferred<number>()
  let started = 0
  const running = [queue.run(() => { started++; return release.promise }), queue.run(() => { started++; return release.promise })]
  await Promise.resolve()
  const pending = queue.run(async () => { started++; return 3 })
  const rejected = assert.rejects(pending, /cancelled/)
  queue.close(); release.resolve(1)
  await rejected; await Promise.all(running)
  assert.equal(started, 2)
  await assert.rejects(queue.run(async () => 4), /cancelled/)
})

test('cancellation while loading a thumbnail prevents drawing a stale page and releases the page', async () => {
  const queue = new ThumbnailQueue()
  const loading = deferred<{ cleanup(): void }>()
  let drawn = 0, cleaned = 0
  const job = queueThumbnail(queue, () => loading.promise, () => {
    drawn++; return { promise: Promise.resolve(), cancel() {} }
  })
  await Promise.resolve()
  job.cancel()
  loading.resolve({ cleanup() { cleaned++ } })
  assert.equal(await job.promise, false)
  assert.equal(drawn, 0)
  assert.equal(cleaned, 1)
  queue.close()
})

test('an active thumbnail render is cancelled once and its page is cleaned only after render settles', async () => {
  const queue = new ThumbnailQueue()
  const drawing = deferred<void>(), began = deferred<void>()
  let cancelled = 0, cleaned = 0
  const job = queueThumbnail(queue, async () => ({ cleanup() { cleaned++ } }), () => {
    began.resolve(); return { promise: drawing.promise, cancel() { cancelled++ } }
  })
  await began.promise
  job.cancel(); job.cancel()
  assert.equal(cancelled, 1)
  assert.equal(cleaned, 0)
  drawing.resolve()
  assert.equal(await job.promise, false)
  assert.equal(cleaned, 1)
  queue.close()
})

test('failed thumbnail rendering releases its resources and does not block a subsequent thumbnail', async () => {
  const queue = new ThumbnailQueue()
  let cleaned = 0
  const fail = queueThumbnail(queue, async () => ({ cleanup() { cleaned++ } }), () => ({ promise: Promise.reject(new Error('broken page')), cancel() {} }))
  await assert.rejects(fail.promise, /broken page/)
  const next = queueThumbnail(queue, async () => ({ cleanup() { cleaned++ } }), () => ({ promise: Promise.resolve(), cancel() {} }))
  assert.equal(await next.promise, true)
  assert.equal(cleaned, 2)
  queue.close()
})

test('failed navigation loading releases only its task and can be retried', async () => {
  let attempt = 0, destroyed = 0
  const session = new LocalPdfNavigation(async () => new Uint8Array([1]), () => ({
    promise: ++attempt === 1 ? Promise.reject(new Error('broken PDF')) : Promise.resolve(basicDocument()),
    destroy: async () => { destroyed++ }
  }))
  await assert.rejects(session.open('paper'), /broken PDF/)
  assert.equal(destroyed, 1)
  const document = await session.open('paper')
  assert.equal(document?.numPages, 20)
  assert.equal(session.isCurrent(document), true)
  await session.cancel()
  assert.equal(destroyed, 2)
})

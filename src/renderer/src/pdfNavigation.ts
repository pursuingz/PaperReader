export interface NavigationDocument {
  numPages: number
  getDestination(name: string): Promise<unknown[] | null>
  getPageIndex(ref: { num: number; gen: number }): Promise<number>
}
export interface NavigationOutlineNode {
  id: string
  title: string
  destination: string | unknown[] | null
  external: boolean
  children: NavigationOutlineNode[]
}

/** Outline titles remain ordinary text; only local destinations enter navigation. */
export function normalizeOutline(input: unknown): { items: NavigationOutlineNode[]; limited: boolean } {
  let count = 0, limited = false
  const ancestors = new Set<object>()
  function visit(value: unknown, depth: number, prefix: string): NavigationOutlineNode[] {
    if (!Array.isArray(value)) return []
    if (depth >= 32) { limited ||= value.length > 0; return [] }
    const result: NavigationOutlineNode[] = []
    for (let index = 0; index < value.length; index++) {
      if (count >= 5000) { limited = true; break }
      const item = value[index]
      if (!item || typeof item !== 'object') continue
      if (ancestors.has(item)) { limited = true; continue }
      count++
      const id = `${prefix}${index}`
      const external = Boolean(item.url || item.unsafeUrl || item.action)
      const destination = !external && ((typeof item.dest === 'string' && item.dest.length > 0) || Array.isArray(item.dest)) ? item.dest : null
      ancestors.add(item)
      const children = visit(item.items, depth + 1, `${id}.`)
      ancestors.delete(item)
      result.push({ id, title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'Untitled section', destination, external, children })
    }
    return result
  }
  const items = visit(input, 0, '')
  return { items, limited }
}

/** PDF destinations contain a zero-based page index or an indirect page reference. */
export async function resolveLocalDestination(document: NavigationDocument, destination: unknown, current: () => boolean = () => true): Promise<number | null> {
  if (!current() || !Number.isSafeInteger(document.numPages) || document.numPages < 1) return null
  const explicit = typeof destination === 'string' && destination.length > 0 ? await document.getDestination(destination) : destination
  if (!current() || !Array.isArray(explicit) || !explicit.length) return null
  const reference: unknown = explicit[0]
  let index: number
  if (typeof reference === 'number') index = reference
  else if (reference && typeof reference === 'object' && 'num' in reference && 'gen' in reference &&
    typeof reference.num === 'number' && Number.isSafeInteger(reference.num) && reference.num > 0 &&
    typeof reference.gen === 'number' && Number.isSafeInteger(reference.gen) && reference.gen >= 0) {
    index = await document.getPageIndex({ num: reference.num, gen: reference.gen })
  } else return null
  return current() && Number.isSafeInteger(index) && index >= 0 && index < document.numPages ? index + 1 : null
}

export const THUMBNAIL_BATCH_SIZE = 8
export function thumbnailBatch(page: number, count: number): { start: number; end: number; pages: number[] } {
  if (!Number.isSafeInteger(count) || count < 1) return { start: 1, end: 0, pages: [] }
  const safePage = Math.max(1, Math.min(count, Number.isSafeInteger(page) ? page : 1))
  const start = Math.floor((safePage - 1) / THUMBNAIL_BATCH_SIZE) * THUMBNAIL_BATCH_SIZE + 1
  const end = Math.min(count, start + THUMBNAIL_BATCH_SIZE - 1)
  return { start, end, pages: Array.from({ length: end - start + 1 }, (_, index) => start + index) }
}

export function thumbnailGeometry(viewport: { width: number; height: number }, ratio: number) {
  if (![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid PDF page dimensions.')
  const scale = Math.min(120 / viewport.width, 156 / viewport.height)
  const pixelRatio = Number.isFinite(ratio) ? Math.max(1, Math.min(2, ratio)) : 1
  return { width: viewport.width * scale, height: viewport.height * scale, scale, pixelRatio }
}

type NavigationTask<T> = { promise: Promise<T>; destroy(): Promise<void> }
type NavigationJob<T> = { task: NavigationTask<T> | null; document: T | null; destroyed: boolean }

/** Owns its task independently of Reader, including late byte/proxy and click races. */
export class LocalPdfNavigation<T extends NavigationDocument> {
  private active: NavigationJob<T> | null = null
  private click = 0
  constructor(private read: (id: string) => Promise<Uint8Array>, private create: (data: Uint8Array) => NavigationTask<T>) {}
  private async destroy(job: NavigationJob<T>) {
    if (!job.task || job.destroyed) return
    job.destroyed = true
    await job.task.destroy().catch(() => undefined)
  }
  async open(id: string): Promise<T | null> {
    void this.cancel()
    const job: NavigationJob<T> = { task: null, document: null, destroyed: false }
    this.active = job
    try {
      const bytes = await this.read(id)
      if (this.active !== job) return null
      job.task = this.create(new Uint8Array(bytes))
      const document = await job.task.promise
      if (this.active !== job) { await this.destroy(job); return null }
      job.document = document
      return document
    } catch (error) {
      if (this.active !== job) return null
      this.active = null
      await this.destroy(job)
      throw error
    }
  }
  async cancel() {
    ++this.click
    const old = this.active
    this.active = null
    if (old) await this.destroy(old)
  }
  isCurrent(document: T | null) { return document !== null && this.active?.document === document }
  async resolve(destination: unknown): Promise<number | null> {
    const document = this.active?.document, click = ++this.click
    if (!document) return null
    try {
      const page = await resolveLocalDestination(document, destination, () => this.isCurrent(document) && click === this.click)
      return this.isCurrent(document) && click === this.click ? page : null
    } catch (error) {
      if (!this.isCurrent(document) || click !== this.click) return null
      throw error
    }
  }
}

/** A shared queue keeps simultaneous page rasterization bounded within navigation. */
export class ThumbnailQueue {
  private active = 0
  private closed = false
  private pending: Array<{ start(): void; reject(reason: Error): void }> = []
  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Thumbnail rendering cancelled.'))
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ reject, start: () => {
        this.active++
        const finish = () => { this.active--; this.drain() }
        Promise.resolve().then(work).then(value => { finish(); resolve(value) }, error => { finish(); reject(error) })
      } })
      this.drain()
    })
  }
  private drain() {
    while (!this.closed && this.active < 2 && this.pending.length) this.pending.shift()!.start()
  }
  close() {
    this.closed = true
    for (const item of this.pending.splice(0)) item.reject(new Error('Thumbnail rendering cancelled.'))
  }
}

/** Cancellation guards both getPage and render; cleanup waits until rendering settles. */
export function queueThumbnail<Page extends { cleanup(): unknown }>(queue: ThumbnailQueue, load: () => Promise<Page>, draw: (page: Page) => { promise: Promise<unknown>; cancel(): void }) {
  let cancelled = false
  let render: ReturnType<typeof draw> | null = null
  const promise = queue.run(async () => {
    if (cancelled) return false
    let page: Page | null = null
    try {
      page = await load()
      if (cancelled) return false
      render = draw(page)
      await render.promise
      return !cancelled
    } finally { page?.cleanup() }
  })
  return { promise, cancel() { if (cancelled) return; cancelled = true; render?.cancel() } }
}

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { PaperSourceIndex } from '../shared/types'
import type { PaperStore } from './storage'
import { sourcePaperId, validateSourceIndex } from './sourceIndexValidation'

/** Derived data owns a separate queue; existing paper state and summary formats stay untouched. */
export class SourceIndexStore {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly store: PaperStore) {}
  async flush(): Promise<void> { await this.tail }
  private async requirePaper(id: string) {
    sourcePaperId(id)
    if (!(await this.store.list()).some(paper => paper.id === id && !paper.isDemo)) throw new Error('Source paper not found. Import a real PDF first.')
  }
  async load(paperId: string): Promise<PaperSourceIndex | null> {
    sourcePaperId(paperId); await this.tail; await this.requirePaper(paperId)
    try { return await this.store.readJson<PaperSourceIndex>(join(this.store.root, 'papers', paperId, 'source-index.json'), value => validateSourceIndex(value, paperId)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  async save(paperId: string, index: unknown): Promise<void> {
    validateSourceIndex(index, paperId)
    const snapshot = structuredClone(index)
    const operation = this.tail.then(async () => {
      await this.requirePaper(paperId)
      const directory = join(this.store.root, 'papers', paperId)
      await mkdir(directory, { recursive: true })
      // An explicit rebuild can replace a damaged derived cache; atomicJson retains its bytes as a backup.
      await this.store.atomicJson(join(directory, 'source-index.json'), snapshot)
    })
    this.tail = operation.catch(() => undefined)
    await operation
  }
}

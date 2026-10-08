import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { PaperTables } from '../shared/types'
import type { PaperStore } from './storage'
import { sourcePaperId } from './sourceIndexValidation'
import { validatePaperTables } from './tableValidation'

/** Additive derived cache; use a separate queue without entering PaperStore's serial writer. */
export class TableStore {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly store: PaperStore) {}
  async flush(): Promise<void> { await this.tail }
  private async requirePaper(id: string) {
    sourcePaperId(id)
    if (!(await this.store.list()).some(paper => paper.id === id && !paper.isDemo)) throw new Error('Table paper not found. Import a real PDF first.')
  }
  async load(paperId: string): Promise<PaperTables | null> {
    sourcePaperId(paperId); await this.tail; await this.requirePaper(paperId)
    try { return await this.store.readJson<PaperTables>(join(this.store.root, 'papers', paperId, 'tables.json'), value => validatePaperTables(value, paperId)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  async save(paperId: string, input: unknown): Promise<void> {
    validatePaperTables(input, paperId); const snapshot = structuredClone(input)
    const operation = this.tail.then(async () => {
      await this.requirePaper(paperId)
      const directory = join(this.store.root, 'papers', paperId); await mkdir(directory, { recursive: true })
      await this.store.atomicJson(join(directory, 'tables.json'), snapshot)
    })
    this.tail = operation.catch(() => undefined); await operation
  }
}

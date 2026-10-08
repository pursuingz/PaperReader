import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { PaperReferences } from '../shared/types'
import type { PaperStore } from './storage'
import type { SourceIndexStore } from './sourceIndexStore'
import { sourcePaperId } from './sourceIndexValidation'
import { buildReferenceRecords, sourceRevision } from './referenceParser'
import { validateReferences } from './referenceValidation'
import { lookupReference } from './referenceVerification'

export class ReferenceStore {
  private tail: Promise<unknown> = Promise.resolve()
  private active: { controller: AbortController; done?: Promise<PaperReferences> } | null = null
  private nextLookup = 0
  constructor(private readonly store: PaperStore, private readonly sources: Pick<SourceIndexStore, 'load'>, private readonly fetcher: typeof fetch = fetch) {}
  async flush(): Promise<void> { await this.active?.done?.catch(() => undefined); await this.tail }
  cancelAll(): void { this.active?.controller.abort() }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(operation); this.tail = pending.catch(() => undefined); return pending
  }
  private async requirePaper(paperId: string) {
    sourcePaperId(paperId)
    if (!(await this.store.list()).some(paper => paper.id === paperId && !paper.isDemo)) throw new Error('Reference paper not found. Import a real PDF first.')
  }
  private file(paperId: string) { return join(this.store.root, 'papers', paperId, 'references.json') }
  private async read(paperId: string): Promise<PaperReferences | null> {
    try { return await this.store.readJson<PaperReferences>(this.file(paperId), value => validateReferences(value, paperId)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  private async write(value: PaperReferences, signal?: AbortSignal): Promise<PaperReferences> {
    validateReferences(value, value.paperId)
    const snapshot = structuredClone(value)
    await mkdir(join(this.store.root, 'papers', value.paperId), { recursive: true })
    await this.store.atomicJson(this.file(value.paperId), snapshot, signal)
    return structuredClone(snapshot)
  }
  async load(paperId: string): Promise<PaperReferences | null> {
    sourcePaperId(paperId); await this.tail; await this.requirePaper(paperId)
    return this.read(paperId)
  }
  async build(paperId: string): Promise<PaperReferences> {
    sourcePaperId(paperId)
    return this.serial(async () => {
      await this.requirePaper(paperId)
      const source = await this.sources.load(paperId)
      if (!source) throw new Error('Index paper sources before parsing references.')
      let previous: PaperReferences | null = null
      try { previous = await this.read(paperId) }
      catch (error) {
        // Rebuilding is explicit and this is derived data. atomicJson retains damaged bytes.
        if (!(error instanceof Error) || !/Local data is damaged/.test(error.message)) throw error
      }
      const records = buildReferenceRecords(source)
      for (const record of records) {
        const old = previous?.records.find(item => item.id === record.id && item.rawText === record.rawText && JSON.stringify(item.pages) === JSON.stringify(record.pages) && JSON.stringify(item.fields) === JSON.stringify(record.fields))
        if (old) record.verification = old.verification
      }
      return this.write({ paperId, version: 1, sourceRevision: sourceRevision(source), sourceCreatedAt: source.createdAt, builtAt: new Date().toISOString(), sourceLimitReached: source.limitReached, records })
    })
  }
  async verify(paperId: string, referenceId: string): Promise<PaperReferences> {
    sourcePaperId(paperId); sourcePaperId(referenceId)
    if (this.active) throw new Error('Reference verification is already in progress. Wait for it to finish.')
    const job: NonNullable<ReferenceStore['active']> = { controller: new AbortController() }
    this.active = job
    const check = () => { if (job.controller.signal.aborted) throw new Error('Reference verification cancelled.') }
    job.done = (async () => {
      const saved = await this.load(paperId); check()
      if (!saved) throw new Error('Parse references before verifying an individual citation.')
      const record = saved.records.find(item => item.id === referenceId)
      if (!record) throw new Error('Reference not found in this paper.')
      const source = await this.sources.load(paperId); check()
      if (!source || sourceRevision(source) !== saved.sourceRevision) throw new Error('Original source index changed. Rebuild references before verifying.')
      if (Date.now() < this.nextLookup) throw new Error('Wait at least one second between Crossref lookups.')
      this.nextLookup = Date.now() + 1000
      const verification = await lookupReference(record, this.fetcher, job.controller.signal); check()
      return this.serial(async () => {
        check()
        await this.requirePaper(paperId)
        const latest = await this.read(paperId), currentSource = await this.sources.load(paperId); check()
        if (!latest || latest.sourceRevision !== saved.sourceRevision || !currentSource || sourceRevision(currentSource) !== saved.sourceRevision) throw new Error('Original source index changed during lookup. Rebuild references and verify again.')
        const target = latest.records.find(item => item.id === referenceId)
        if (!target || target.rawText !== record.rawText || JSON.stringify(target.pages) !== JSON.stringify(record.pages)) throw new Error('Reference changed during lookup. Rebuild references and verify again.')
        target.verification = verification
        return this.write(latest, job.controller.signal)
      })
    })().finally(() => { if (this.active === job) this.active = null })
    return job.done
  }
}

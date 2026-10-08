import type { DesktopAPI, PaperSourceIndex } from '../../shared/types'
import { extractSourceIndex, type SourceDocument } from './sourceIndex'

type SourceTask = { promise: Promise<SourceDocument>; destroy(): Promise<void> }
type SourceJob = { task: SourceTask | null; destruction: Promise<void> | null }

/** Each run owns fresh bytes and a PDF task; no Reader/Summary/navigation proxy is borrowed. */
export class LocalSourceIndex {
  private active: SourceJob | null = null
  constructor(private api: Pick<DesktopAPI, 'readPaper' | 'saveSourceIndex'>, private createTask: (data: Uint8Array) => SourceTask) {}
  private destroy(job: SourceJob): Promise<void> {
    if (!job.task) return Promise.resolve()
    return job.destruction ??= job.task.destroy().catch(() => undefined)
  }
  async cancel(): Promise<void> {
    const job = this.active; this.active = null
    if (job) await this.destroy(job)
  }
  async run(paperId: string, progress?: (page: number, total: number) => void): Promise<PaperSourceIndex | null> {
    if (this.active) throw new Error('Source indexing is already in progress.')
    const job: SourceJob = { task: null, destruction: null }
    this.active = job
    const current = () => this.active === job
    try {
      const bytes = await this.api.readPaper(paperId)
      if (!current()) return null
      job.task = this.createTask(new Uint8Array(bytes))
      const document = await job.task.promise
      if (!current()) return null
      const value = await extractSourceIndex(document, paperId, current, (page, total) => { if (current()) progress?.(page, total) })
      if (!current()) return null
      // IPC saves the completed immutable index under its original paper identity. Once dispatched,
      // an atomic cache save may finish even if the user cancels; it must never surface in another paper.
      await this.api.saveSourceIndex(paperId, value)
      return current() ? value : null
    } catch (error) { if (!current()) return null; throw error }
    finally { if (current()) this.active = null; await this.destroy(job) }
  }
}

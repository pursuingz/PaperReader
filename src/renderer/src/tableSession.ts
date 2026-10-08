import type { DesktopAPI, PaperTables } from '../../shared/types'
import { extractPaperTables, type TableDocument } from './tableExtraction'

type Task = { promise: Promise<TableDocument>; destroy(): Promise<void> }
type Job = { task: Task | null; destruction: Promise<void> | null }

/** Own fresh PDF bytes/tasks rather than borrowing the Reader or Summary proxy. */
export class LocalTableExtraction {
  private active: Job | null = null
  constructor(private api: Pick<DesktopAPI, 'readPaper' | 'saveTables'>, private createTask: (bytes: Uint8Array) => Task) {}
  private destroy(job: Job): Promise<void> { if (!job.task) return Promise.resolve(); return job.destruction ??= job.task.destroy().catch(() => undefined) }
  async cancel(): Promise<void> { const job = this.active; this.active = null; if (job) await this.destroy(job) }
  async run(paperId: string, progress?: (page: number, total: number) => void): Promise<PaperTables | null> {
    if (this.active) throw new Error('Table extraction is already in progress.')
    const job: Job = { task: null, destruction: null }; this.active = job
    const current = () => this.active === job
    try {
      const bytes = await this.api.readPaper(paperId); if (!current()) return null
      job.task = this.createTask(new Uint8Array(bytes)); const document = await job.task.promise; if (!current()) return null
      const value = await extractPaperTables(document, paperId, current, (page, total) => { if (current()) progress?.(page, total) })
      if (!current()) return null
      await this.api.saveTables(paperId, value); return current() ? value : null
    } catch (error) { if (!current()) return null; throw error }
    finally { if (current()) this.active = null; await this.destroy(job) }
  }
}

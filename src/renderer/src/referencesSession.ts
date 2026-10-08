import type { DesktopAPI, PaperReferences } from '../../shared/types'
export class ReferencesSession {
  private epoch = 0
  private paperId: string | null = null
  private busy = false
  constructor(private api: Pick<DesktopAPI, 'loadReferences' | 'buildReferences' | 'verifyReference'>) {}
  async load(paperId: string): Promise<PaperReferences | null> {
    this.cancel(); this.paperId = paperId
    return this.run(paperId, () => this.api.loadReferences(paperId))
  }
  async build(paperId: string): Promise<PaperReferences | null> { return this.run(paperId, () => this.api.buildReferences(paperId)) }
  async verify(paperId: string, referenceId: string): Promise<PaperReferences | null> { return this.run(paperId, () => this.api.verifyReference(paperId, referenceId)) }
  cancel(): void { this.epoch++; this.paperId = null; this.busy = false }
  private async run(paperId: string, operation: () => Promise<PaperReferences | null>): Promise<PaperReferences | null> {
    if (paperId !== this.paperId) throw new Error('Reference paper changed. Select the current paper again.')
    if (this.busy) throw new Error('A reference operation is already in progress.')
    this.busy = true
    const token = this.epoch, current = () => token === this.epoch && this.paperId === paperId
    try {
      const value = await operation()
      if (!current()) return null
      if (value && value.paperId !== paperId) throw new Error('Reference response has a different paper identity.')
      return value
    } catch (error) { if (!current()) return null; throw error }
    finally { if (current()) this.busy = false }
  }
}

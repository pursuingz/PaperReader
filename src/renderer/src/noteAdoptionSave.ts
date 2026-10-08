/** Closing/switching/exporting must capture state after adoption settles. */
export class NoteAdoptionSaveGate {
  private pending: Promise<void> | null = null
  async run(operation: () => Promise<void>): Promise<void> {
    if (this.pending) throw new Error('A note suggestion is already being saved.')
    const task = Promise.resolve().then(operation)
    this.pending = task
    try { await task }
    finally { if (this.pending === task) this.pending = null }
  }
  async settle(): Promise<void> { await this.pending?.catch(() => undefined) }
}

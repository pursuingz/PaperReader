/** Owns loading, native picking and the final write as one file operation. */
export class FileOperationGate {
  private active: Promise<unknown> | null = null
  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active) return Promise.reject(new Error('Finish the current file operation before opening another file dialog.'))
    const result = Promise.resolve().then(operation).finally(() => { if (this.active === result) this.active = null })
    this.active = result
    return result
  }
  async flush(): Promise<void> { await this.active?.catch(() => undefined) }
}

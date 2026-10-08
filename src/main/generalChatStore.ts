import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { GeneralChatState } from '../shared/types'
import type { PaperStore } from './storage'
import { GENERAL_CHAT_LIMITS, validateGeneralChatState } from './generalChatValidation'

/** One independently queued root conversation. Damaged originals are never made writable defaults. */
export class GeneralChatStore {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly papers: PaperStore) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation); this.tail = next.catch(() => undefined); return next
  }
  async flush(): Promise<void> { await this.tail }
  private async readStored(): Promise<GeneralChatState> {
    const path = join(this.papers.root, 'general-chat.json')
    let handle
    try { handle = await open(path, 'r') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      let names: string[] = []
      try { names = await readdir(this.papers.root) }
      catch (directoryError) { if ((directoryError as NodeJS.ErrnoException).code !== 'ENOENT') throw directoryError }
      if (names.some(name => name.startsWith('general-chat.json.backup-') || name.startsWith('general-chat.json.tmp-'))) throw new Error('General chat primary is missing. Retained recovery files were preserved; a new conversation cannot replace them.')
      const initial: GeneralChatState = { version: 1, conversationId: randomUUID(), messages: [] }
      await mkdir(this.papers.root, { recursive: true }); await this.papers.atomicJson(path, initial)
      return initial
    }
    try {
      const metadata = await handle.stat()
      if (!metadata.isFile() || metadata.size > GENERAL_CHAT_LIMITS.bytes) throw new Error('General chat file limit exceeded')
      // Read at most the limit even if another process grows the file after stat.
      const bytes = Buffer.alloc(metadata.size + 1)
      let length = 0
      while (length < bytes.length) { const result = await handle.read(bytes, length, bytes.length - length, null); if (!result.bytesRead) break; length += result.bytesRead }
      if (length > metadata.size) throw new Error('General chat file changed during reading')
      const value: unknown = JSON.parse(bytes.subarray(0, length).toString('utf8')); validateGeneralChatState(value)
      return value
    } catch { throw new Error('General chat data is damaged or exceeds its limit. Existing files were preserved for recovery.') }
    finally { await handle.close() }
  }
  load(): Promise<GeneralChatState> { return this.serial(() => this.readStored()) }
  async save(input: unknown): Promise<void> {
    validateGeneralChatState(input); const snapshot = structuredClone(input)
    await this.serial(async () => {
      const current = await this.readStored()
      if (snapshot.conversationId !== current.conversationId) throw new Error('General chat conversation identity does not match the saved conversation')
      if (Buffer.byteLength(JSON.stringify(snapshot, null, 2), 'utf8') > GENERAL_CHAT_LIMITS.bytes) throw new Error('General chat file limit exceeded')
      await this.papers.atomicJson(join(this.papers.root, 'general-chat.json'), snapshot)
    })
  }
}

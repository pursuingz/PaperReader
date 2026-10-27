import { lstat, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { PaperStore } from './storage'
import type { SourceIndexStore } from './sourceIndexStore'
import type { PaperSourceEntry } from '../shared/types'
import type { SourceEvidenceEdits, SourceEvidenceEdit } from '../shared/sourceEvidenceEditsTypes'
import { sourcePaperId } from './sourceIndexValidation'
import { resolveEvidenceSource, sameEvidenceSource } from '../shared/sourceEvidenceEditsIdentity'
import { sourceEvidenceEditsLimits, validateEvidenceCaptionInput, validateEvidenceHiddenInput, validateSourceEvidenceEdits } from './sourceEvidenceEditsValidation'

const fileName = 'source-evidence-edits.json'
export class SourceEvidenceEditsStore {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private papers: PaperStore, private sources: SourceIndexStore) {}
  async flush(): Promise<void> { await this.tail }
  private serial<T>(operation: () => Promise<T>): Promise<T> { const task = this.tail.then(operation); this.tail = task.catch(() => undefined); return task }
  private async directory(paperId: string): Promise<string> {
    sourcePaperId(paperId)
    if (!(await this.papers.list()).some(paper => paper.id === paperId && !paper.isDemo)) throw Error('Source evidence paper not found. Import a local PDF first.')
    const directory = join(this.papers.root, 'papers', paperId)
    for (const path of [join(this.papers.root, 'papers'), directory]) { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Source evidence directory is invalid; data remains protected.') }
    return directory
  }
  private async requireSources(paperId: string, value: SourceEvidenceEdits): Promise<PaperSourceEntry[]> {
    const index = await this.sources.load(paperId)
    if (!index) throw Error('Source evidence index is unavailable; existing edits remain protected.')
    const resolved: PaperSourceEntry[] = []
    for (const edit of value.edits) {
      const actual = resolveEvidenceSource(edit.source, index.entries)
      if (!actual || resolved.some(previous => resolveEvidenceSource(actual, [previous]) !== null)) throw Error('Source evidence edits are stale or ambiguous; existing data remains protected and read-only. Reload the original source index.')
      resolved.push(actual)
    }
    return index.entries
  }
  private async read(directory: string, paperId: string): Promise<SourceEvidenceEdits> {
    let value: unknown
    try {
      const path = join(directory, fileName), info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.size > sourceEvidenceEditsLimits.bytes) throw Error('Invalid source evidence edit file size or type')
      const handle = await open(path, 'r')
      try {
        const opened = await handle.stat()
        if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev || opened.size > sourceEvidenceEditsLimits.bytes) throw Error('Source evidence edit file changed while opening')
        const buffer = Buffer.alloc(sourceEvidenceEditsLimits.bytes + 1); let length = 0
        while (length < buffer.length) { const result = await handle.read(buffer, length, buffer.length - length, length); if (!result.bytesRead) break; length += result.bytesRead }
        if (length > sourceEvidenceEditsLimits.bytes) throw Error('Source evidence edit byte limit exceeded')
        value = JSON.parse(buffer.subarray(0, length).toString('utf8'))
      } finally { await handle.close() }
      validateSourceEvidenceEdits(value, paperId)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error(`Source evidence edits are damaged or invalid; original bytes remain protected and read-only. ${error instanceof Error ? error.message : 'Read failed'}`)
      const files = await readdir(directory)
      if (files.some(name => name.startsWith(`${fileName}.backup-`) || name.startsWith(`${fileName}.tmp-`))) throw Error('Source evidence edit primary is missing. Retained recovery files are protected; recover before editing.')
      return { version: 1, paperId, edits: [] }
    }
    if (value.edits.length) await this.requireSources(paperId, value)
    return value
  }
  async load(paperId: string): Promise<SourceEvidenceEdits> { sourcePaperId(paperId); await this.tail; return this.read(await this.directory(paperId), paperId) }
  private async mutate(paperId: string, entry: PaperSourceEntry, changes: Partial<Pick<SourceEvidenceEdit, 'caption' | 'hidden'>>): Promise<SourceEvidenceEdits> {
    return this.serial(async () => {
      const directory = await this.directory(paperId), current = await this.read(directory, paperId), entries = await this.requireSources(paperId, current), actual = entries.find(source => source.id === entry.id)
      if (!actual || !sameEvidenceSource(actual, entry)) throw Error('The original source entry, caption or pages changed. Reload sources before saving edits.')
      const previous = current.edits.find(edit => { const resolved = resolveEvidenceSource(edit.source, entries); return resolved !== null && resolveEvidenceSource(actual, [resolved]) !== null })
      const edit: SourceEvidenceEdit = { ...previous, source: structuredClone(actual), hidden: previous?.hidden ?? false, ...changes }
      const value: SourceEvidenceEdits = { version: 1, paperId, edits: [...current.edits.filter(item => item !== previous), edit] }
      validateSourceEvidenceEdits(value, paperId)
      if (Buffer.byteLength(JSON.stringify(value, null, 2), 'utf8') > sourceEvidenceEditsLimits.bytes) throw Error('Source evidence edit byte limit exceeded')
      const latest = await this.requireSources(paperId, value), rechecked = latest.find(source => source.id === actual.id)
      if (!rechecked || !sameEvidenceSource(rechecked, actual)) throw Error('The original source entry changed while saving. Existing edits remain protected.')
      await this.papers.atomicJson(join(directory, fileName), value)
      return value
    })
  }
  async saveCaption(paperId: string, input: unknown): Promise<SourceEvidenceEdits> {
    sourcePaperId(paperId); validateEvidenceCaptionInput(input); const snapshot = structuredClone(input)
    return this.mutate(paperId, snapshot.entry, { caption: snapshot.caption })
  }
  async setHidden(paperId: string, input: unknown): Promise<SourceEvidenceEdits> {
    sourcePaperId(paperId); validateEvidenceHiddenInput(input); const snapshot = structuredClone(input)
    return this.mutate(paperId, snapshot.entry, { hidden: snapshot.hidden })
  }
}

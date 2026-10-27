import { lstat, mkdir, open, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { AIRequestContext, AIRequestHistory, AIRequestOwner, AIRequestRecord, EffectiveAIRequest } from '../shared/requestTypes'
import type { PaperStore } from './storage'
import { REQUEST_MANIFEST_LIMIT, REQUEST_RECORD_LIMIT, REQUEST_SCOPE_LIMIT, REQUEST_SNAPSHOT_LIMIT, requestOwnerKey, requestUUID, validateEffectiveContext, validateEffectiveAIRequest, validateRequestContext, validateRequestHistory, validateRequestOwner } from './requestHistoryValidation'

type SavedMessage = { id: string; role: string; content: string; isDemo?: boolean }
type BeginInput = { requestId: string; userMessageId: string; assistantMessageId: string; payload: EffectiveAIRequest; context: AIRequestContext; expectedUserContent: string; retryOf?: string }
const sha = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error('Request cancelled') }

/** Read a bounded file without backup fallback: a corrupt primary remains protected. */
async function boundedBytes(path: string, limit: number, label: string): Promise<Buffer> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error(`${label} is invalid or exceeds its size limit`)
  const file = await open(path, 'r')
  try {
    const size = await file.stat()
    if (!size.isFile() || size.size > limit) throw new Error(`${label} exceeds its size limit`)
    const buffer = Buffer.alloc(Math.min(limit + 1, size.size + 1)); let offset = 0
    while (offset < buffer.length) { const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset); if (!bytesRead) break; offset += bytesRead }
    if (offset > limit || offset !== size.size) throw new Error(`${label} changed while reading or exceeds its size limit`)
    return buffer.subarray(0, offset)
  } finally { await file.close() }
}
async function safeDirectory(path: string) {
  try { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid request storage directory') }
  catch (error) { if (!missing(error)) throw error }
}

export class RequestHistoryStore {
  private tail: Promise<unknown> = Promise.resolve()
  private active = new Set<string>()
  constructor(private readonly papers: PaperStore, private readonly readMessages: (owner: AIRequestOwner) => Promise<readonly SavedMessage[]>) {}
  async flush(): Promise<void> { await this.tail }
  private serial<T>(operation: () => Promise<T>): Promise<T> { const next = this.tail.then(operation); this.tail = next.catch(() => undefined); return next }
  private activeKey(owner: AIRequestOwner, id: string) { return `${requestOwnerKey(owner)}:${id}` }
  private async directory(owner: AIRequestOwner) {
    validateRequestOwner(owner)
    if (owner.scope === 'paper' && !(await this.papers.list()).some(paper => paper.id === owner.paperId && !paper.isDemo)) throw new Error('Paper not found. Import a local PDF first.')
    const parent = join(this.papers.root, owner.scope === 'paper' ? 'papers' : 'general-ai')
    const directory = join(parent, owner.scope === 'paper' ? owner.paperId : owner.conversationId)
    await safeDirectory(parent); await safeDirectory(directory); await safeDirectory(join(directory, 'ai-request-snapshots'))
    return directory
  }
  private async readHistory(directory: string, owner: AIRequestOwner): Promise<AIRequestHistory> {
    try {
      const bytes = await boundedBytes(join(directory, 'ai-requests.json'), REQUEST_MANIFEST_LIMIT, 'Request manifest')
      const value: unknown = JSON.parse(bytes.toString('utf8')); validateRequestHistory(value, owner); return value
    } catch (error) {
      if (missing(error)) {
        let names: string[] = []
        try { names = await readdir(directory) } catch (directoryError) { if (!missing(directoryError)) throw directoryError }
        if (names.some(name => name.startsWith('ai-requests.json.backup-') || name.startsWith('ai-requests.json.tmp-'))) throw new Error('Request manifest primary is missing; retained recovery files remain protected')
        return { version: 1, owner: structuredClone(owner), records: [] }
      }
      throw new Error('Request manifest is damaged or exceeds its limit. Existing files remain protected.')
    }
  }
  private async scopeBytes(directory: string) {
    let total = 0, count = 0
    const scan = async (path: string, snapshots: boolean) => {
      let entries: string[]
      try { entries = await readdir(path) } catch (error) { if (missing(error)) return; throw error }
      if (entries.length > 10000) throw new Error('Request storage file count limit exceeded')
      for (const name of entries) {
        if (!snapshots && name !== 'ai-request-snapshots' && !name.startsWith('ai-requests.json')) continue
        if (++count > 10000) throw new Error('Request storage file count limit exceeded')
        const full = join(path, name), info = await lstat(full)
        if (info.isSymbolicLink()) throw new Error('Invalid request storage resource')
        if (!snapshots && name === 'ai-request-snapshots' && info.isDirectory()) { await scan(full, true); continue }
        if (!info.isFile()) throw new Error('Invalid request storage resource')
        total += info.size
        if (total > REQUEST_SCOPE_LIMIT) throw new Error('Request history scope exceeds its 128 MiB quota')
      }
    }
    await scan(directory, false); return total
  }
  private async reserve(directory: string, history: AIRequestHistory, snapshotBytes = 0) {
    validateRequestHistory(history, history.owner)
    const size = Buffer.byteLength(JSON.stringify(history, null, 2))
    if (size > REQUEST_MANIFEST_LIMIT || history.records.length > REQUEST_RECORD_LIMIT) throw new Error('Request manifest size or record limit exceeded')
    let prior = 0
    try { prior = (await lstat(join(directory, 'ai-requests.json'))).size } catch (error) { if (!missing(error)) throw error }
    // Atomic replacement writes a temporary manifest and retains the prior primary as a backup.
    if (await this.scopeBytes(directory) + size + prior + snapshotBytes > REQUEST_SCOPE_LIMIT) throw new Error('Request history scope exceeds its 128 MiB quota; existing records are preserved')
  }
  private async save(directory: string, history: AIRequestHistory, signal?: AbortSignal) {
    cancelled(signal); await this.reserve(directory, history); await mkdir(directory, { recursive: true })
    await this.papers.atomicJson(join(directory, 'ai-requests.json'), history, signal)
  }
  private user(messages: readonly SavedMessage[], record: Pick<AIRequestRecord, 'userMessageId' | 'userSha256'>) {
    const matches = messages.filter(message => message.id === record.userMessageId)
    if (matches.length !== 1 || matches[0].role !== 'user' || matches[0].isDemo || typeof matches[0].content !== 'string' || sha(matches[0].content) !== record.userSha256) throw new Error('Saved user message is missing, duplicated or changed; original request replay is unavailable')
    return matches[0].content
  }
  private async replay(directory: string, history: AIRequestHistory, requestId: string, messages: readonly SavedMessage[]) {
    const record = history.records.find(record => record.requestId === requestId)
    if (!record) throw new Error('Original request not found. Old conversations have no saved request snapshot.')
    const userContent = this.user(messages, record)
    let bytes: Buffer
    try { bytes = await boundedBytes(join(directory, 'ai-request-snapshots', `${record.snapshotId}.json`), REQUEST_SNAPSHOT_LIMIT, 'Request snapshot') }
    catch { throw new Error('Original request snapshot is missing, damaged or exceeds its size limit; existing files were preserved') }
    if (sha(bytes) !== record.snapshotSha256) throw new Error('Original request snapshot hash changed; replay is unavailable')
    let payload: unknown
    try { payload = JSON.parse(bytes.toString('utf8')); validateEffectiveAIRequest(payload) } catch { throw new Error('Original request snapshot is invalid; replay is unavailable') }
    validateEffectiveContext(payload,record.context,history.owner)
    if (payload.model !== record.model || (history.owner.scope === 'general') !== (payload.promptVersion === 'general-v1')) throw new Error('Original snapshot owner or model does not match its record')
    if (record.status === 'pending' && this.active.has(this.activeKey(history.owner, record.requestId))) throw new Error('The original request is still active and pending. Wait or cancel it before retrying.')
    return { record: structuredClone(record), payload, userContent }
  }
  async begin(owner: AIRequestOwner, input: BeginInput, signal?: AbortSignal): Promise<AIRequestRecord> {
    validateRequestOwner(owner); requestUUID(input.requestId); requestUUID(input.userMessageId); requestUUID(input.assistantMessageId)
    if (input.retryOf !== undefined) requestUUID(input.retryOf)
    validateEffectiveAIRequest(input.payload); validateRequestContext(input.context)
    validateEffectiveContext(input.payload,input.context,owner)
    if ((owner.scope === 'general') !== (input.payload.promptVersion === 'general-v1') || (owner.scope === 'general') !== (input.context.mode === 'general')) throw new Error('Request prompt and context do not match owner scope')
    if (typeof input.expectedUserContent !== 'string' || !input.expectedUserContent.trim() || input.expectedUserContent.length > 200000) throw new Error('Invalid expected saved user content')
    const scope = structuredClone(owner), snapshot = structuredClone(input)
    return this.serial(async () => {
      cancelled(signal); const directory = await this.directory(scope), history = await this.readHistory(directory, scope)
      const messages = await this.readMessages(scope), userSha256 = sha(snapshot.expectedUserContent)
      this.user(messages, { userMessageId: snapshot.userMessageId, userSha256 })
      const ids = [snapshot.requestId, snapshot.userMessageId, snapshot.assistantMessageId]
      if (new Set(ids).size !== 3 || history.records.some(record => ids.some(id => [record.requestId, record.userMessageId, record.assistantMessageId].includes(id)))) throw new Error('Request or message identifier is already recorded; duplicate binding refused')
      if (messages.some(message => message.id === snapshot.assistantMessageId)) throw new Error('Reserved assistant identifier is already occupied')
      let snapshotId: string = randomUUID(), body = JSON.stringify(snapshot.payload), snapshotSha256 = sha(body)
      if (snapshot.retryOf) {
        const original = await this.replay(directory, history, snapshot.retryOf, messages)
        if (JSON.stringify(original.payload) !== body || JSON.stringify(original.record.context) !== JSON.stringify(snapshot.context) || original.record.userSha256 !== userSha256) throw new Error('Retry must preserve the original immutable snapshot, context and saved user content')
        snapshotId = original.record.snapshotId; snapshotSha256 = original.record.snapshotSha256; body = ''
      }
      const record: AIRequestRecord = { requestId: snapshot.requestId, snapshotId, userMessageId: snapshot.userMessageId, assistantMessageId: snapshot.assistantMessageId, retryOf: snapshot.retryOf ?? null, createdAt: new Date().toISOString(), status: 'pending', context: snapshot.context, model: snapshot.payload.model, userSha256, snapshotSha256 }
      const next = { ...history, records: [...history.records, record] }
      await this.reserve(directory, next, Buffer.byteLength(body)); cancelled(signal)
      if (body) {
        const snapshots = join(directory, 'ai-request-snapshots'); await mkdir(snapshots, { recursive: true })
        await writeFile(join(snapshots, `${snapshotId}.json`), body, { flag: 'wx', mode: 0o600 })
      }
      await this.save(directory, next, signal)
      this.active.add(this.activeKey(scope, record.requestId)); return structuredClone(record)
    })
  }
  async getReplay(owner: AIRequestOwner, requestId: string) {
    validateRequestOwner(owner); requestUUID(requestId); const scope = structuredClone(owner)
    return this.serial(async () => { const directory = await this.directory(scope), history = await this.readHistory(directory, scope); return this.replay(directory, history, requestId, await this.readMessages(scope)) })
  }
  async markResponseReady(owner: AIRequestOwner, requestId: string, savedAnswer: string): Promise<void> {
    validateRequestOwner(owner); requestUUID(requestId)
    if (typeof savedAnswer !== 'string' || !savedAnswer.trim() || savedAnswer.length > 200000) throw new Error('Invalid saved response content')
    const scope = structuredClone(owner), answerSha256 = sha(savedAnswer)
    await this.serial(async () => {
      const directory = await this.directory(scope), history = await this.readHistory(directory, scope), record = history.records.find(record => record.requestId === requestId)
      if (!record) throw new Error('Request not found')
      if (!this.active.has(this.activeKey(scope, requestId)) || record.status !== 'pending') throw new Error('Request is no longer active or already settled')
      record.status = 'response-ready'; record.answerSha256 = answerSha256
      await this.save(directory, history)
    })
  }
  async settle(owner: AIRequestOwner, requestId: string, status: 'failed' | 'cancelled'): Promise<void> {
    validateRequestOwner(owner); requestUUID(requestId)
    if (!['failed', 'cancelled'].includes(status)) throw new Error('Invalid request terminal status')
    const scope = structuredClone(owner)
    await this.serial(async () => {
      try {
        const directory = await this.directory(scope), history = await this.readHistory(directory, scope), record = history.records.find(record => record.requestId === requestId)
        if (!record) throw new Error('Request not found')
        if (record.status === 'pending' || record.status === 'response-ready') { record.status = status; await this.save(directory, history) }
      } finally { this.active.delete(this.activeKey(scope, requestId)) }
    })
  }
  async reconcile(owner: AIRequestOwner): Promise<AIRequestHistory> {
    validateRequestOwner(owner); const scope = structuredClone(owner)
    return this.serial(async () => {
      const directory = await this.directory(scope), history = await this.readHistory(directory, scope), messages = await this.readMessages(scope)
      let changed = false
      for (const record of history.records) {
        const unfinished = record.status === 'pending' || record.status === 'response-ready'
        const savedResponseRecoverable = ['interrupted', 'failed', 'cancelled'].includes(record.status) && record.answerSha256
        if (!unfinished && !savedResponseRecoverable) continue
        const answers = messages.filter(message => message.id === record.assistantMessageId)
        if (record.answerSha256 && answers.length === 1 && answers[0].role === 'assistant' && !answers[0].isDemo && typeof answers[0].content === 'string' && sha(answers[0].content) === record.answerSha256) {
          try { this.user(messages, record); record.status = 'completed'; changed = true; this.active.delete(this.activeKey(scope, record.requestId)); continue }
          catch { /* A matching answer cannot compensate for a missing or changed bound user. */ }
        }
        if (unfinished && !this.active.has(this.activeKey(scope, record.requestId))) { record.status = 'interrupted'; changed = true }
      }
      if (changed) await this.save(directory, history)
      return structuredClone(history)
    })
  }
  load(owner: AIRequestOwner): Promise<AIRequestHistory> { return this.reconcile(owner) }
}

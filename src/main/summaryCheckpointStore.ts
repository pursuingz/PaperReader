import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, open, opendir, rename } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { SummaryJobPhase, SummaryJobStatus } from '../shared/summaryJobTypes'
import type { SummaryCheckpointExpected, SummaryCheckpointInput, SummaryStageIdentity, SummaryStageRuntime } from './summaryCheckpointTypes'

const LIMITS = { jobs: 32, stages: 64, executions: 32, input: 4 * 1024 * 1024, stage: 512 * 1024, manifest: 128 * 1024, job: 16 * 1024 * 1024, paper: 256 * 1024 * 1024, files: 2048, characters: 2_000_000, activeMs: 8 * 60_000 } as const
const phases: SummaryJobPhase[] = ['extract', 'synthesize', 'review', 'rewrite', 'verify', 'complete']
const states = ['running', 'interrupted', 'failed', 'completed'] as const
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8')
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error('Summary request cancelled') }
function bad(): never { throw new Error('Summary checkpoint is damaged or invalid. Existing files remain protected.') }
class SummaryCheckpointBudgetError extends Error { constructor() { super('Summary checkpoint storage or execution budget limit reached. Existing files remain protected.'); this.name = 'SummaryCheckpointBudgetError' } }
function quota(): never { throw new SummaryCheckpointBudgetError() }
type State = typeof states[number]
type Attempt = { identity: SummaryStageIdentity; attempts: number }
type Execution = { requestId: string; startedAt: string; endedAt: string | null; state: State; calls: number; characters: number; activeMs: number; attempts: Attempt[]; safeCode?: string }
type Stage = { id: string; identity: SummaryStageIdentity; sha256: string; bytes: number; createdAt: string }
type Manifest = { version: 1; paperId: string; checkpointId: string; inputSha256: string; inputFileSha256: string; sourceSha256: string; createdAt: string; updatedAt: string; state: State; phase: SummaryJobPhase; totalBatches: number; stages: Stage[]; executions: Execution[] }
type InputFile = { version: 1; paperId: string; checkpointId: string; input: SummaryCheckpointInput }
type StageFile = { version: 1; paperId: string; checkpointId: string; identity: SummaryStageIdentity; value: unknown }
type Loaded = { manifest: Manifest; input: SummaryCheckpointInput; values: Map<string, unknown> }
type Active = { requestId: string; started: number }
const queues = new Map<string, Promise<unknown>>()
const active = new Map<string, Active>()
const clock = new Map<string, number>()
function object(value: unknown): asserts value is Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) bad() }
function fields(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).some(key => !keys.includes(key)) || keys.filter(key => !['safeCode', 'batchIndex'].includes(key)).some(key => !Object.hasOwn(value, key))) bad() }
function hex(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) bad() }
function paper(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(value) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value)) throw new Error('Invalid summary paper identifier') }
function uuid(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid summary request UUID identifier') }
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) bad() }
function date(value: unknown): asserts value is string { if (typeof value !== 'string' || value.length !== 24 || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) bad() }
function expected(value: unknown): asserts value is SummaryCheckpointExpected {
  object(value); fields(value, ['model', 'language', 'recipeFingerprint', 'pdfSha256'])
  if (typeof value.model !== 'string' || !value.model.trim() || value.model.length > 120 || /[\x00-\x1f\x7f]/.test(value.model) || !['en', 'zh'].includes(value.language as string)) bad()
  hex(value.recipeFingerprint); hex(value.pdfSha256)
}
function input(value: unknown): asserts value is SummaryCheckpointInput {
  object(value); fields(value, ['paperId', 'pages', 'language', 'model', 'recipeFingerprint', 'pdfSha256', 'totalBatches']); paper(value.paperId)
  expected({ model: value.model, language: value.language, recipeFingerprint: value.recipeFingerprint, pdfSha256: value.pdfSha256 })
  if (!Array.isArray(value.pages) || !value.pages.length || value.pages.length > 200) bad()
  let characters = 0
  for (const [index, page] of value.pages.entries()) {
    object(page); fields(page, ['page', 'text'])
    if (page.page !== index + 1 || typeof page.text !== 'string') throw new Error('Invalid summary input pages; every page must be preserved in order')
    characters += page.text.length
  }
  if (characters > 240_000) throw new Error('Summary input character limit exceeded')
  integer(value.totalBatches, 1, LIMITS.stages - 4)
}
function identity(value: unknown, batches: number): asserts value is SummaryStageIdentity {
  object(value); fields(value, ['key', 'phase', 'inputHash', 'batchIndex'])
  if (typeof value.key !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(value.key) || !phases.includes(value.phase as SummaryJobPhase) || value.phase === 'complete') throw new Error('Invalid summary stage identity')
  hex(value.inputHash)
  if (value.batchIndex !== undefined) { integer(value.batchIndex, 0, batches - 1); if (value.phase !== 'extract') bad() }
}
function normalIdentity(value: SummaryStageIdentity): SummaryStageIdentity { return { key: value.key, phase: value.phase, inputHash: value.inputHash, ...(value.batchIndex === undefined ? {} : { batchIndex: value.batchIndex }) } }
function stageId(value: SummaryStageIdentity) { return digest(JSON.stringify(normalIdentity(value))) }
function sourceHash(value: SummaryCheckpointInput) { return digest(JSON.stringify(value.pages)) }
function compatibility(value: SummaryCheckpointInput, wanted: SummaryCheckpointExpected): SummaryJobStatus['incompatibleReason'] | undefined {
  if (value.model !== wanted.model) return 'model'
  if (value.language !== wanted.language) return 'language'
  if (value.recipeFingerprint !== wanted.recipeFingerprint) return 'recipe'
  if (value.pdfSha256 !== wanted.pdfSha256) return 'source'
}
function jsonValue(value: unknown): void {
  object(value)
  // Raw Markdown owns the 60k text budget; JSON backslash/newline escaping is
  // storage representation, bounded separately by the unchanged stage byte cap.
  if (typeof value.markdown === 'string' && Object.keys(value).length === 1) {
    if (!value.markdown.trim() || value.markdown.length > 60000) throw new Error('Summary Markdown stage text limit exceeded')
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > LIMITS.stage - 1024) quota()
    return
  }
  let nodes = 0, characters = 0
  const charge = (amount: number) => { characters += amount; if (characters > 60_000) throw new Error('Summary stage character limit exceeded') }
  const visit = (item: unknown, depth: number) => {
    if (++nodes > 50_000 || depth > 32) throw new Error('Summary stage JSON limit exceeded')
    if (item === null) { charge(4); return }
    if (typeof item === 'boolean') { charge(item ? 4 : 5); return }
    if (typeof item === 'string') { charge(item.length + 2); return }
    if (typeof item === 'number' && Number.isFinite(item)) { charge(String(item).length); return }
    if (Array.isArray(item)) { charge(2); let first = true; for (const child of item) { if (!first) charge(1); first = false; visit(child, depth + 1) }; return }
    if (item && typeof item === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(item))) {
      charge(2); let first = true
      for (const key in item) if (Object.hasOwn(item, key)) { charge(key.length + 3 + Number(!first)); first = false; visit((item as Record<string, unknown>)[key], depth + 1) }
      return
    }
    throw new Error('Invalid summary stage JSON value')
  }
  object(value); visit(value, 0)
  if (JSON.stringify(value).length > 60_000) throw new Error('Summary stage character limit exceeded')
}
function validateManifest(value: unknown, owner: string, id: string): asserts value is Manifest {
  object(value); fields(value, ['version', 'paperId', 'checkpointId', 'inputSha256', 'inputFileSha256', 'sourceSha256', 'createdAt', 'updatedAt', 'state', 'phase', 'totalBatches', 'stages', 'executions'])
  if (value.version !== 1 || value.paperId !== owner || value.checkpointId !== id || !states.includes(value.state as State) || !phases.includes(value.phase as SummaryJobPhase)) bad()
  hex(value.inputSha256); hex(value.inputFileSha256); hex(value.sourceSha256); date(value.createdAt); date(value.updatedAt)
  if (value.updatedAt < value.createdAt || (value.state === 'completed') !== (value.phase === 'complete')) bad()
  integer(value.totalBatches, 1, LIMITS.stages - 4)
  if (!Array.isArray(value.stages) || value.stages.length > LIMITS.stages || !Array.isArray(value.executions) || !value.executions.length || value.executions.length > LIMITS.executions) bad()
  const ids = new Set<string>(), requests = new Set<string>()
  for (const stage of value.stages) {
    object(stage); fields(stage, ['id', 'identity', 'sha256', 'bytes', 'createdAt']); hex(stage.id); hex(stage.sha256); date(stage.createdAt); integer(stage.bytes, 1, LIMITS.stage); identity(stage.identity, value.totalBatches)
    if (stage.id !== stageId(stage.identity) || ids.has(stage.id) || stage.createdAt < value.createdAt || stage.createdAt > value.updatedAt) bad()
    ids.add(stage.id)
  }
  for (const [index, execution] of value.executions.entries()) {
    object(execution); fields(execution, ['requestId', 'startedAt', 'endedAt', 'state', 'calls', 'characters', 'activeMs', 'attempts', 'safeCode'])
    uuid(execution.requestId); date(execution.startedAt)
    if (requests.has(execution.requestId) || !states.includes(execution.state as State) || execution.startedAt < value.createdAt || execution.startedAt > value.updatedAt) bad()
    requests.add(execution.requestId)
    integer(execution.calls, 0, 2 * (value.totalBatches + 4)); integer(execution.characters, 0, LIMITS.characters); integer(execution.activeMs)
    if (!Array.isArray(execution.attempts) || execution.attempts.length > 2 * (value.totalBatches + 4)) bad()
    if (execution.safeCode !== undefined && (typeof execution.safeCode !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(execution.safeCode))) bad()
    if (execution.state === 'running') { if (execution.endedAt !== null || index !== value.executions.length - 1) bad() }
    else { date(execution.endedAt); if (execution.endedAt < execution.startedAt || execution.endedAt > value.updatedAt) bad() }
    if (index === value.executions.length - 1 && execution.state !== value.state) bad()
    const attempts = new Set<string>(); let calls = 0, rewrites = 0
    for (const attempt of execution.attempts) {
      object(attempt); fields(attempt, ['identity', 'attempts']); identity(attempt.identity, value.totalBatches); integer(attempt.attempts, 1, 2)
      const key = stageId(attempt.identity); if (attempts.has(key)) bad(); attempts.add(key); calls += attempt.attempts
      if (attempt.identity.phase === 'rewrite') rewrites++
    }
    if (calls !== execution.calls || rewrites > 1) bad()
  }
  for (const stage of value.stages as Stage[]) if (!(value.executions as Execution[]).some(execution => execution.attempts.some(attempt => stageId(attempt.identity) === stage.id))) bad()
}
async function boundedNames(path: string, limit: number): Promise<string[]> {
  const names: string[] = [], handle = await opendir(path)
  for await (const entry of handle) { if (names.length >= limit) quota(); names.push(entry.name) }
  return names
}
async function directory(path: string, required = false): Promise<boolean> {
  try { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) bad(); return true }
  catch (error) { if (!absent(error) || required) throw error; return false }
}
async function ancestors(path: string) {
  const paths: string[] = []; let current = resolve(path)
  while (true) { paths.push(current); const parent = dirname(current); if (parent === current) break; current = parent }
  for (const part of paths.reverse()) await directory(part)
}
async function bounded(path: string, limit: number): Promise<Buffer> {
  const initial = await lstat(path); if (!initial.isFile() || initial.isSymbolicLink() || initial.size > limit) bad()
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await file.stat(); if (!info.isFile() || info.size > limit || info.dev !== initial.dev || info.ino !== initial.ino) bad()
    const buffer = Buffer.alloc(Math.min(limit + 1, info.size + 1)); let offset = 0
    while (offset < buffer.length) { const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset); if (!bytesRead) break; offset += bytesRead }
    const after = await file.stat()
    if (offset !== info.size || offset > limit || after.size !== info.size || after.mtimeMs !== info.mtimeMs) bad()
    return buffer.subarray(0, offset)
  } finally { await file.close() }
}
async function immutable(path: string, bytes: Buffer) {
  const file = await open(path, 'wx', 0o600)
  try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
}

export class SummaryCheckpointStore {
  private readonly root: string
  private readonly queueKey: string
  constructor(root: string) { this.root = resolve(root); this.queueKey = process.platform === 'win32' ? this.root.toLowerCase() : this.root }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = (queues.get(this.queueKey) ?? Promise.resolve()).then(operation); queues.set(this.queueKey, next.catch(() => undefined)); return next
  }
  private key(paperId: string, id: string) { return `${this.queueKey}:${paperId}:${id}` }
  private timestamp(paperId: string, prior = 0) { const key = `${this.queueKey}:${paperId}`; const time = Math.max(Date.now(), prior + 1, (clock.get(key) ?? 0) + 1); clock.set(key, time); return new Date(time).toISOString() }
  private path(paperId: string, id?: string) { return join(this.root, 'papers', paperId, 'summary-checkpoints', 'v1', ...(id ? [id] : [])) }
  private async base(paperId: string, create = false) {
    paper(paperId); const path = this.path(paperId); await ancestors(path)
    if (create) { await directory(join(this.root, 'papers', paperId), true); await mkdir(path, { recursive: true }); await ancestors(path) }
    return path
  }
  private async jobs(paperId: string): Promise<string[]> {
    const base = await this.base(paperId)
    let names: string[]; try { names = await boundedNames(base, LIMITS.jobs) } catch (error) { if (absent(error)) return []; throw error }
    if (names.length > LIMITS.jobs) quota()
    for (const name of names) { hex(name); await directory(join(base, name), true) }
    return names
  }
  private async bytes(path: string, depth = 0): Promise<{ bytes: number; files: number }> {
    let names: string[]; try { names = await boundedNames(path, LIMITS.files) } catch (error) { if (absent(error)) return { bytes: 0, files: 0 }; throw error }
    if (depth > 2 || names.length > LIMITS.files) quota()
    let total = 0, files = 0
    for (const name of names) {
      const child = join(path, name), info = await lstat(child)
      if (info.isSymbolicLink()) bad()
      if (info.isDirectory()) { if (depth > 0 || name !== 'stages') bad(); const nested = await this.bytes(child, depth + 1); total += nested.bytes; files += nested.files }
      else { if (!info.isFile()) bad(); total += info.size; files++ }
      if (total > LIMITS.job || files > LIMITS.files) quota()
    }
    return { bytes: total, files }
  }
  private async reserve(paperId: string, id: string, extra: number, extraFiles: number) {
    const ids = await this.jobs(paperId); let total = 0, owned = { bytes: 0, files: 0 }
    for (const job of ids) { const amount = await this.bytes(this.path(paperId, job)); total += amount.bytes; if (job === id) owned = amount }
    if (owned.bytes + extra > LIMITS.job || owned.files + extraFiles > LIMITS.files || total + extra > LIMITS.paper) quota()
  }
  private async save(manifest: Manifest, signal?: AbortSignal, newBytes = 0, newFiles = 0) {
    cancelled(signal); validateManifest(manifest, manifest.paperId, manifest.checkpointId)
    const body = encoded(manifest); if (body.length > LIMITS.manifest) quota()
    const path = join(this.path(manifest.paperId, manifest.checkpointId), 'manifest.json')
    let previous = 0
    try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > LIMITS.manifest) bad(); previous = info.size } catch (error) { if (!absent(error)) throw error }
    await this.reserve(manifest.paperId, manifest.checkpointId, body.length + previous + newBytes, 1 + Number(previous > 0) + newFiles)
    cancelled(signal)
    const temporary = `${path}.tmp-${randomUUID()}`
    await immutable(temporary, body)
    if (previous) await copyFile(path, `${path}.backup-${randomUUID()}`, constants.COPYFILE_EXCL)
    cancelled(signal); await rename(temporary, path)
  }
  private async uniqueRequest(paperId: string, ids: string[], requestId: string) {
    for (const id of ids) {
      let value: Manifest
      try { const raw: unknown = JSON.parse((await bounded(join(this.path(paperId, id), 'manifest.json'), LIMITS.manifest)).toString('utf8')); validateManifest(raw, paperId, id); value = raw } catch { continue }
      if (value.executions.some(execution => execution.requestId === requestId)) throw new Error('Summary request identifier is already recorded')
    }
  }
  private async load(paperId: string, id: string): Promise<Loaded> {
    paper(paperId); hex(id); await this.base(paperId); const path = this.path(paperId, id); await ancestors(path); await directory(path, true)
    try {
      await this.bytes(path)
      const value: unknown = JSON.parse((await bounded(join(path, 'manifest.json'), LIMITS.manifest)).toString('utf8')); validateManifest(value, paperId, id)
      const inputBytes = await bounded(join(path, 'input.json'), LIMITS.input)
      if (digest(inputBytes) !== value.inputFileSha256) bad()
      const file: unknown = JSON.parse(inputBytes.toString('utf8')); object(file); fields(file, ['version', 'paperId', 'checkpointId', 'input'])
      if (file.version !== 1 || file.paperId !== paperId || file.checkpointId !== id) bad()
      input(file.input)
      if (file.input.paperId !== paperId || file.input.totalBatches !== value.totalBatches || digest(encoded(file.input)) !== value.inputSha256 || sourceHash(file.input) !== value.sourceSha256) bad()
      const names = await boundedNames(path, LIMITS.files)
      if (names.some(name => name !== 'input.json' && name !== 'stages' && name !== 'manifest.json' && !/^manifest\.json\.(?:tmp|backup)-[0-9a-f-]{36}$/.test(name))) bad()
      const values = new Map<string, unknown>(), stageDirectory = join(path, 'stages')
      await directory(stageDirectory, true)
      const stageNames = await boundedNames(stageDirectory, LIMITS.stages)
      if (stageNames.length !== value.stages.length) bad()
      for (const stage of value.stages) {
        if (!stageNames.includes(`${stage.id}.json`)) bad()
        const bytes = await bounded(join(stageDirectory, `${stage.id}.json`), LIMITS.stage)
        if (bytes.length !== stage.bytes || digest(bytes) !== stage.sha256) bad()
        const file: unknown = JSON.parse(bytes.toString('utf8')); object(file); fields(file, ['version', 'paperId', 'checkpointId', 'identity', 'value'])
        if (file.version !== 1 || file.paperId !== paperId || file.checkpointId !== id) bad()
        identity(file.identity, value.totalBatches)
        if (stageId(file.identity) !== stage.id || JSON.stringify(normalIdentity(file.identity)) !== JSON.stringify(normalIdentity(stage.identity))) bad()
        jsonValue(file.value); values.set(stage.id, file.value)
      }
      return { manifest: value, input: file.input, values }
    } catch (error) { if (error instanceof SummaryCheckpointBudgetError) throw error; return bad() }
  }
  private account(manifest: Manifest, current: Active) { const execution = manifest.executions.at(-1)!; execution.activeMs = Math.max(execution.activeMs, Math.round(performance.now() - current.started)); manifest.updatedAt = this.timestamp(manifest.paperId, Date.parse(manifest.updatedAt)) }
  private async running(paperId: string, id: string, requestId: string) {
    const current = active.get(this.key(paperId, id)); if (!current || current.requestId !== requestId) throw new Error('Summary execution is no longer active or already settled')
    const loaded = await this.load(paperId, id), execution = loaded.manifest.executions.at(-1)!
    if (execution.requestId !== requestId || execution.state !== 'running') bad()
    this.account(loaded.manifest, current)
    return { ...loaded, execution }
  }
  private runtime(paperId: string, id: string, requestId: string): SummaryStageRuntime {
    return {
      checkpointId: id,
      get: async value => { const stage = structuredClone(value); return this.serial(async () => { const loaded = await this.load(paperId, id); identity(stage, loaded.input.totalBatches); return structuredClone(loaded.values.get(stageId(stage))) }) },
      put: async (value, raw, signal) => {
        const stage = structuredClone(value); jsonValue(raw); const snapshot = structuredClone(raw)
        return this.serial(async () => {
          cancelled(signal); const loaded = await this.running(paperId, id, requestId); identity(stage, loaded.input.totalBatches)
          const key = stageId(stage)
          if (loaded.values.has(key)) { if (JSON.stringify(loaded.values.get(key)) !== JSON.stringify(snapshot)) throw new Error('Immutable summary stage cannot be replaced'); return }
          if (!loaded.execution.attempts.some(attempt => stageId(attempt.identity) === key)) throw new Error('Summary stage must consume an attempt before storing a successful result')
          if (loaded.manifest.stages.length >= LIMITS.stages) quota()
          const file: StageFile = { version: 1, paperId, checkpointId: id, identity: stage, value: snapshot }, body = encoded(file)
          if (body.length > LIMITS.stage) quota()
          const record: Stage = { id: key, identity: stage, sha256: digest(body), bytes: body.length, createdAt: loaded.manifest.updatedAt }
          loaded.manifest.stages.push(record)
          const manifestBytes = encoded(loaded.manifest); if (manifestBytes.length > LIMITS.manifest) quota()
          await this.reserve(paperId, id, body.length + 2 * manifestBytes.length, 3); cancelled(signal)
          await immutable(join(this.path(paperId, id), 'stages', `${key}.json`), body)
          await this.save(loaded.manifest, signal)
        })
      },
      consume: async (value, characters, signal) => {
        const stage = structuredClone(value)
        return this.serial(async () => {
          cancelled(signal); const loaded = await this.running(paperId, id, requestId); identity(stage, loaded.input.totalBatches)
          if (!Number.isSafeInteger(characters) || characters < 0) throw new Error('Invalid summary payload character count')
          const key = stageId(stage), execution = loaded.execution
          if (loaded.values.has(key)) throw new Error('Completed summary stage is cached and cannot consume another network call')
          if (loaded.manifest.stages.length >= LIMITS.stages) quota()
          await this.reserve(paperId, id, LIMITS.stage + 4 * LIMITS.manifest, 4); cancelled(signal)
          const attempt = execution.attempts.find(attempt => stageId(attempt.identity) === key)
          if ((attempt?.attempts ?? 0) >= 2 || execution.calls >= 2 * (loaded.input.totalBatches + 4) || execution.characters + characters > LIMITS.characters || execution.activeMs >= LIMITS.activeMs || (stage.phase === 'rewrite' && execution.attempts.some(attempt => attempt.identity.phase === 'rewrite' && stageId(attempt.identity) !== key))) quota()
          if (attempt) attempt.attempts++; else execution.attempts.push({ identity: stage, attempts: 1 })
          execution.calls++; execution.characters += characters; loaded.manifest.phase = stage.phase
          await this.save(loaded.manifest, signal)
        })
      },
      phase: (phase, signal) => this.serial(async () => {
        cancelled(signal); if (!phases.includes(phase) || phase === 'complete') throw new Error('Invalid active summary phase')
        const loaded = await this.running(paperId, id, requestId); loaded.manifest.phase = phase; await this.save(loaded.manifest, signal)
      }),
      end: (state, safeCode) => this.serial(async () => {
        const key = this.key(paperId, id)
        try {
          if (!['failed', 'interrupted', 'completed'].includes(state) || safeCode !== undefined && !/^[A-Z0-9_]{1,64}$/.test(safeCode)) throw new Error('Invalid summary terminal state or safe code')
          const loaded = await this.running(paperId, id, requestId)
          loaded.manifest.state = state; loaded.execution.state = state; loaded.execution.endedAt = loaded.manifest.updatedAt
          if (safeCode) loaded.execution.safeCode = safeCode
          if (state === 'completed') loaded.manifest.phase = 'complete'
          await this.save(loaded.manifest)
        } finally { if (active.get(key)?.requestId === requestId) active.delete(key) }
      })
    }
  }
  async start(value: SummaryCheckpointInput, requestId: string, signal?: AbortSignal): Promise<SummaryStageRuntime> {
    input(value); uuid(requestId); const frozen = structuredClone(value)
    return this.serial(async () => {
      cancelled(signal); const started = performance.now(), base = await this.base(frozen.paperId, true), ids = await this.jobs(frozen.paperId)
      if (ids.length >= LIMITS.jobs) quota()
      await this.uniqueRequest(frozen.paperId, ids, requestId)
      const id = digest(JSON.stringify({ inputSha256: digest(encoded(frozen)), nonce: randomUUID() })), createdAt = this.timestamp(frozen.paperId)
      const file: InputFile = { version: 1, paperId: frozen.paperId, checkpointId: id, input: frozen }, body = encoded(file)
      if (body.length > LIMITS.input) quota()
      const manifest: Manifest = { version: 1, paperId: frozen.paperId, checkpointId: id, inputSha256: digest(encoded(frozen)), inputFileSha256: digest(body), sourceSha256: sourceHash(frozen), createdAt, updatedAt: createdAt, state: 'running', phase: 'extract', totalBatches: frozen.totalBatches, stages: [], executions: [{ requestId, startedAt: createdAt, endedAt: null, state: 'running', calls: 0, characters: 0, activeMs: 0, attempts: [] }] }
      await this.reserve(frozen.paperId, id, body.length + encoded(manifest).length, 2); cancelled(signal)
      const path = join(base, id); await mkdir(path); await mkdir(join(path, 'stages')); await immutable(join(path, 'input.json'), body)
      await this.save(manifest, signal); active.set(this.key(frozen.paperId, id), { requestId, started })
      return this.runtime(frozen.paperId, id, requestId)
    })
  }
  async resume(paperId: string, id: string, wanted: SummaryCheckpointExpected, requestId: string, signal?: AbortSignal): Promise<{ input: SummaryCheckpointInput; runtime: SummaryStageRuntime }> {
    paper(paperId); hex(id); expected(wanted); uuid(requestId); const frozen = structuredClone(wanted)
    return this.serial(async () => {
      cancelled(signal); const started = performance.now(), loaded = await this.load(paperId, id), manifest = loaded.manifest
      const reason = compatibility(loaded.input, frozen); if (reason) throw new Error(`Summary checkpoint is incompatible (${reason}); existing files remain protected`)
      if (manifest.state === 'completed') throw new Error('Summary checkpoint is already completed')
      if (active.has(this.key(paperId, id))) throw new Error('Summary checkpoint is still active and running')
      if (manifest.executions.length >= LIMITS.executions) quota()
      await this.uniqueRequest(paperId, await this.jobs(paperId), requestId)
      const time = this.timestamp(paperId, Date.parse(manifest.updatedAt)), previous = manifest.executions.at(-1)!
      if (previous.state === 'running') { previous.state = 'interrupted'; previous.endedAt = manifest.updatedAt }
      manifest.executions.push({ requestId, startedAt: time, endedAt: null, state: 'running', calls: 0, characters: 0, activeMs: 0, attempts: [] })
      manifest.state = 'running'; manifest.updatedAt = time
      await this.save(manifest, signal); active.set(this.key(paperId, id), { requestId, started })
      return { input: structuredClone(loaded.input), runtime: this.runtime(paperId, id, requestId) }
    })
  }
  private status(loaded: Loaded): SummaryJobStatus {
    const { manifest, input } = loaded, current = active.get(this.key(input.paperId, manifest.checkpointId))
    const live = Boolean(current && current.requestId === manifest.executions.at(-1)!.requestId && manifest.state === 'running')
    return { version: 1, paperId: input.paperId, checkpointId: manifest.checkpointId, model: input.model, language: input.language, state: manifest.state === 'running' && !live ? 'interrupted' : manifest.state, phase: manifest.phase, completedStages: manifest.stages.length, completedBatches: new Set(manifest.stages.filter(stage => stage.identity.phase === 'extract' && stage.identity.batchIndex !== undefined).map(stage => stage.identity.batchIndex)).size, totalBatches: manifest.totalBatches, canResume: manifest.state !== 'completed' && !live, updatedAt: manifest.updatedAt, executions: manifest.executions.length, consumed: { calls: manifest.executions.reduce((sum, execution) => sum + execution.calls, 0), characters: manifest.executions.reduce((sum, execution) => sum + execution.characters, 0), activeMs: manifest.executions.reduce((sum, execution, index) => sum + (live && index === manifest.executions.length - 1 ? Math.max(execution.activeMs, Math.round(performance.now() - current!.started)) : execution.activeMs), 0) } }
  }
  async readDraft(paperId: string, id: string, wanted: SummaryCheckpointExpected): Promise<{ input: SummaryCheckpointInput; markdown: string; updatedAt: string } | null> {
    paper(paperId); hex(id); expected(wanted); const frozen = structuredClone(wanted)
    return this.serial(async () => {
      const loaded = await this.load(paperId, id)
      const reason = compatibility(loaded.input, frozen)
      if (reason) throw new Error(`Summary draft is incompatible (${reason}); existing files remain protected`)
      if (loaded.manifest.state === 'completed') return null
      for (const stage of [...loaded.manifest.stages].reverse()) {
        if (stage.identity.phase !== 'synthesize') continue
        const value = loaded.values.get(stage.id)
        if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'markdown')) continue
        const record = value as Record<string, unknown>
        if (Object.keys(record).join(',') !== 'markdown' || typeof record.markdown !== 'string' || !record.markdown.trim() || record.markdown.length > 60000) bad()
        return { input: structuredClone(loaded.input), markdown: record.markdown, updatedAt: loaded.manifest.updatedAt }
      }
      return null
    })
  }
  async latest(paperId: string, wanted: SummaryCheckpointExpected): Promise<SummaryJobStatus | null> {
    paper(paperId); expected(wanted); const frozen = structuredClone(wanted)
    return this.serial(async () => {
      const candidates: SummaryJobStatus[] = []
      for (const id of await this.jobs(paperId)) {
        try {
          const loaded = await this.load(paperId, id), status = this.status(loaded), reason = compatibility(loaded.input, frozen)
          if (reason) { status.canResume = false; status.incompatibleReason = reason }
          else if (status.canResume) {
            try { if (loaded.manifest.executions.length >= LIMITS.executions || encoded(loaded.manifest).length + 1024 > LIMITS.manifest) quota(); await this.reserve(paperId, id, 2 * (encoded(loaded.manifest).length + 1024), 2) }
            catch { status.canResume = false; status.incompatibleReason = 'budget' }
          }
          candidates.push(status)
        } catch (error) {
          let time = new Date(0).toISOString(), saved: Manifest | undefined
          try {
            const value: unknown = JSON.parse((await bounded(join(this.path(paperId, id), 'manifest.json'), LIMITS.manifest)).toString('utf8'))
            validateManifest(value, paperId, id); saved = value; time = value.updatedAt
          } catch { try { time = (await lstat(join(this.path(paperId, id), 'manifest.json'))).mtime.toISOString() } catch { time = (await lstat(this.path(paperId, id))).mtime.toISOString() } }
          const consumed = { calls: 0, characters: 0, activeMs: 0 }
          for (const execution of saved?.executions ?? []) { consumed.calls += execution.calls; consumed.characters += execution.characters; consumed.activeMs += execution.activeMs }
          candidates.push({ version: 1, paperId, checkpointId: id, model: frozen.model, language: frozen.language, state: saved?.state === 'failed' ? 'failed' : 'interrupted', phase: saved?.phase === 'complete' ? 'verify' : saved?.phase ?? 'extract', completedStages: 0, completedBatches: 0, totalBatches: saved?.totalBatches ?? 0, canResume: false, incompatibleReason: error instanceof SummaryCheckpointBudgetError ? 'budget' : 'damaged', updatedAt: time, executions: saved?.executions.length ?? 0, consumed })
        }
      }
      return candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.checkpointId.localeCompare(a.checkpointId))[0] ?? null
    })
  }
}






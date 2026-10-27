import { spawn } from 'node:child_process'
import path from 'node:path'
import type { LocalSpeechStart, LocalSpeechChunk, LocalSpeechResult } from '../shared/localInputTypes'
import type { LocalInputAssets } from './localInputAssets'
import { cleanLocalSpeechOutput, localSpeechRunnerError, mergeLocalSpeechOverlap } from './localSpeechOutput'

export function encodePcmWave(samples: Int16Array): Buffer {
  if (!samples.length || samples.length > 16000 * 30) throw new Error('Speech audio must be nonempty and at most 30 seconds of mono PCM.')
  const wav = Buffer.alloc(44 + samples.byteLength)
  wav.write('RIFF'); wav.writeUInt32LE(36 + samples.byteLength, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples.byteLength, 40)
  for (let index = 0; index < samples.length; index++) wav.writeInt16LE(samples[index], 44 + index * 2)
  return wav
}
export function runLocalWhisper(runner: string, model: string, audio: Int16Array, language: LocalSpeechStart['language'], signal: AbortSignal): Promise<string> {
  const wave = encodePcmWave(audio)
  const resolvedModel = path.resolve(model)
  return new Promise((resolve, reject) => {
    // A non-'-' output basename enables segment stdout for stdin input in whisper.cpp 1.8.4.
    // No output format is requested, so neither audio nor transcript files are created.
    const child = spawn(path.resolve(runner), ['-m', path.basename(resolvedModel), '-f', '-', '-of', 'speech-memory', '-l', language, '-nt', '-np', '-ng', '-t', '4'], { cwd: path.dirname(resolvedModel), windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], signal, timeout: 30_000 })
    let output = ''; let stderr = ''; let settled = false
    const fail = (error: Error) => { if (!settled) { settled = true; reject(error) } }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (text: string) => { output += text; if (output.length > 16000) { child.kill(); fail(localSpeechRunnerError(stderr, null, 'limit')!) } })
    child.stderr.on('data', (text: string) => { stderr = (stderr + text).slice(-16000) })
    child.on('error', error => fail(localSpeechRunnerError(stderr, null, signal.aborted ? 'cancelled' : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : undefined) ?? new Error('Local speech runner could not start. Check the packaged native files.')))
    child.stdin.on('error', () => {})
    child.on('close', code => {
      if (settled) return
      const error = localSpeechRunnerError(stderr, code, signal.aborted ? 'cancelled' : child.killed ? 'timeout' : undefined)
      if (error) { fail(error); return }
      settled = true
      resolve(cleanLocalSpeechOutput(output))
    })
    child.stdin.end(wave)
  })
}
interface SpeechSession { id: string; language: LocalSpeechStart['language']; next: number; count: number; pieces: Int16Array[]; length: number; unprocessed: number; stride: number; committed: string; preview: string; hadSignal: boolean; failure?: Error; controller: AbortController; busy: boolean; finalizing: boolean }
export class LocalSpeechService {
  private session: SpeechSession | null = null
  constructor(private readonly options: { assets: LocalInputAssets; runnerPath?: string; run?: typeof runLocalWhisper }) {}
  status() { return this.options.assets.status() }
  visionAssets() { return this.options.assets.visionAssets() }
  downloadModel() { return this.options.assets.downloadModel() }
  importModel(source: string) { return this.options.assets.importModel(source) }
  async start(request: LocalSpeechStart): Promise<void> {
    if (!request || typeof request.sessionId !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(request.sessionId) || !['auto', 'zh', 'en'].includes(request.language)) throw new Error('Invalid local speech session.')
    if (this.session) throw new Error('A local speech session is already active.')
    const status = await this.status()
    if (!status.ready) throw new Error(!status.runnerReady ? 'Local speech runner is unavailable. Reinstall the portable application.' : 'Install or import the local multilingual speech model before recording.')
    if (this.session) throw new Error('A local speech session is already active.')
    this.session = { id: request.sessionId, language: request.language, next: 0, count: 0, pieces: [], length: 0, unprocessed: 0, stride: 32000, committed: '', preview: '', hadSignal: false, controller: new AbortController(), busy: false, finalizing: false }
  }
  private owned(sessionId: string): SpeechSession { if (!this.session || this.session.id !== sessionId) throw new Error('Local speech session is no longer active.'); return this.session }
  private async transcribe(session: SpeechSession): Promise<void> {
    if (session.failure) throw session.failure
    if (!session.unprocessed) return
    const pcm = new Int16Array(session.length); let offset = 0; let energy = 0
    for (const piece of session.pieces) { pcm.set(piece, offset); offset += piece.length; for (const x of piece) energy += x * x }
    const started = performance.now()
    try {
      if (Math.sqrt(energy / pcm.length) >= 100) {
        session.hadSignal = true
        const text = await (this.options.run ?? runLocalWhisper)(this.options.runnerPath ?? this.options.assets.runnerPath(), this.options.assets.modelPath(), pcm, session.language, session.controller.signal)
        if (this.session !== session || session.controller.signal.aborted) throw new Error('Local speech session cancelled.')
        if (text.trim()) session.preview = mergeLocalSpeechOverlap(session.committed, text)
      }
      session.unprocessed = 0
      session.stride = Math.max(32000, Math.min(16000 * 6, Math.ceil((performance.now() - started) / 1000 * 1.25) * 16000))
      if (session.length >= 16000 * 12) {
        session.committed = session.preview || session.committed
        session.preview = ''
        session.pieces = [pcm.slice(-16000)]; session.length = 16000
      }
    } catch (error) { session.failure = error instanceof Error ? error : new Error('Local speech runner failed.'); throw session.failure }
  }
  async append(request: LocalSpeechChunk): Promise<LocalSpeechResult> {
    const session = this.owned(request?.sessionId)
    if (session.failure) throw session.failure
    if (session.finalizing || session.busy || request.sequence !== session.next || !Number.isInteger(request.sequence) || !(request.pcm16 instanceof ArrayBuffer) || request.pcm16.byteLength < 2 || request.pcm16.byteLength > 32000 || request.pcm16.byteLength % 2) throw new Error('Invalid, duplicate or overlapping speech chunk.')
    if (session.count + request.pcm16.byteLength / 2 > 16000 * 180) throw new Error('Recording limit reached (3 minutes); stop to keep the transcript.')
    session.busy = true; session.next++; session.count += request.pcm16.byteLength / 2
    session.pieces.push(new Int16Array(request.pcm16.slice(0))); session.length += request.pcm16.byteLength / 2; session.unprocessed += request.pcm16.byteLength / 2
    try { if (session.unprocessed >= session.stride || session.length >= 16000 * 12) await this.transcribe(session); return { sessionId: session.id, text: session.preview || session.committed, final: false } } finally { session.busy = false }
  }
  async finalize(request: { sessionId: string }): Promise<LocalSpeechResult> {
    const session = this.owned(request?.sessionId)
    if (session.finalizing || session.busy) throw new Error('Local speech is still processing a chunk.')
    session.finalizing = true
    try {
      await this.transcribe(session)
      const text = (session.preview || session.committed).trim()
      if (!text) throw new Error(session.hadSignal ? 'No speech was recognized. Try a longer phrase or choose Chinese or English.' : 'No microphone signal detected. Check the microphone device and input volume.')
      return { sessionId: session.id, text, final: true }
    } finally { if (this.session === session) this.session = null }
  }
  async cancel(request: { sessionId: string }): Promise<void> {
    if (!this.session || this.session.id !== request?.sessionId) return
    this.session.controller.abort(); this.session.pieces = []; this.session = null
  }
  cancelAll(): void { this.options.assets.cancelDownload(); this.dispose() }
  dispose(): void { if (this.session) { this.session.controller.abort(); this.session.pieces = []; this.session = null } }
}





import type { LocalInputOwner, LocalSpeechAPI, LocalSpeechResult, SpeechLanguage, VoiceInputState, VoiceSessionCallbacks, VoiceTranscriptFinishOptions } from '../../shared/localInputTypes'
import { MicrophoneCapture, type AudioCapture } from './localAudioCapture'
export function sameInputOwner(a: LocalInputOwner, b: LocalInputOwner): boolean { return sameInputContext(a, b) && a.draftRevision === b.draftRevision }
function sameInputContext(a: LocalInputOwner, b: LocalInputOwner): boolean { return a.conversationId === b.conversationId && a.contextRevision === b.contextRevision }
interface ActiveVoiceSession {
  id: string; owner: LocalInputOwner; capture: AudioCapture; language: SpeechLanguage; queue: Promise<void>; sequence: number; queued: number
  cancelled: boolean; transcript: string; live: boolean; finished: boolean; failure?: Error
}
interface SegmentBoundary {
  session: ActiveVoiceSession; buffer: Int16Array[]; samples: number; stopRequested: boolean; cancelled: boolean; opened: boolean
  interrupted: Promise<void>; interrupt(): void; captureStop?: Promise<void>; error?: string
}
interface CapturedSpeech {
  owner: LocalInputOwner; language: SpeechLanguage; buffer: Int16Array[]; cancelled: boolean
  interrupted: Promise<void>; interrupt(): void
}
const boundaryCancelled = Symbol('voice-boundary-cancelled')
const boundarySampleLimit = 12 * 16000
function microphoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Microphone access was denied. Allow microphone access and try again.'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was found. Connect a microphone and try again.'
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The microphone is unavailable. Check whether another application is using it and try again.'
  return error instanceof Error ? error.message : 'Microphone unavailable.'
}
export class VoiceSession {
  private state: VoiceInputState = { phase: 'idle', transcript: '', level: 0 }
  private active: ActiveVoiceSession | null = null
  private starting: Promise<void> | null = null
  private stopping: Promise<void> | null = null
  private cancelling: Promise<void> | null = null
  private splitting: Promise<void> | null = null
  private boundary: SegmentBoundary | null = null
  private captured: CapturedSpeech | null = null
  private recovering: Promise<void> | null = null
  private epoch = 0
  private intent = 0
  private limitTimer: ReturnType<typeof setTimeout> | null = null
  constructor(private readonly api: LocalSpeechAPI, private readonly callbacks: VoiceSessionCallbacks, private readonly createCapture: () => AudioCapture = () => new MicrophoneCapture()) {}
  get sessionId(): string | null { return this.recording ? this.active?.id ?? null : null }
  get recording(): boolean { return this.state.phase === 'recording' || !!this.boundary && !this.boundary.cancelled && !this.boundary.stopRequested }
  get hasCapturedSpeech(): boolean { return !!this.captured }
  get currentState(): VoiceInputState { return this.state }
  private publish(patch: Partial<VoiceInputState>): void { this.state = { ...this.state, ...patch }; this.callbacks.onState(this.state) }
  private inputBlocked(): boolean { return this.callbacks.isInputBlocked?.() ?? this.callbacks.isBusy() }
  private newSession(capture: AudioCapture, language: SpeechLanguage, owner = this.callbacks.getOwner()): ActiveVoiceSession {
    return { id: crypto.randomUUID(), owner: { ...owner }, capture, language, queue: Promise.resolve(), sequence: 0, queued: 0, cancelled: false, transcript: '', live: !!(this.callbacks.beginTranscript && this.callbacks.previewTranscript && this.callbacks.finishTranscript), finished: false }
  }
  start(language: SpeechLanguage = 'auto'): Promise<void> {
    if (this.captured) { this.publish({ phase: 'error', error: 'Captured speech is kept in memory. Retry or discard captured speech before recording again.' }); return Promise.resolve() }
    if (this.starting) return this.starting
    const intent = this.intent; const cancelling = this.cancelling; const stopping = this.stopping; const splitting = this.splitting; const recovering = this.recovering
    const operation = (async () => {
      if (cancelling) await cancelling
      if (stopping) await stopping
      if (splitting) await splitting
      if (recovering) await recovering
      if (intent !== this.intent || this.captured) return
      await this.startCapture(language)
    })()
    this.starting = operation
    const settled = () => { if (this.starting === operation) this.starting = null }
    void operation.then(settled, settled)
    return operation
  }
  private async startCapture(language: SpeechLanguage): Promise<void> {
    if (this.active || this.inputBlocked()) return
    const epoch = ++this.epoch
    const session = this.newSession(this.createCapture(), language)
    this.active = session
    this.publish({ phase: 'starting', transcript: '', level: 0, error: undefined })
    try {
      if (session.live) this.callbacks.beginTranscript!(session.id, session.owner)
      await this.api.start({ sessionId: session.id, language })
      if (epoch !== this.epoch) { await this.api.cancel({ sessionId: session.id }); return }
      await this.api.enableDevice({ device: 'microphone', enabled: true })
      if (epoch !== this.epoch) { await this.api.enableDevice({ device: 'microphone', enabled: false }); await session.capture.dispose(); return }
      let ended = false
      await session.capture.start(pcm => this.receiveAudio(session.capture, pcm), level => { if (this.active?.capture === session.capture) this.publish({ level }) }, () => { ended = true; if (this.active?.capture === session.capture && this.recording) void this.stop(false) })
      if (epoch !== this.epoch) { await session.capture.dispose(); return }
      this.publish({ phase: 'recording' })
      if (ended) { await this.stopRecording(false); return }
      this.limitTimer = setTimeout(() => { void this.stop(false) }, 180000)
    } catch (error) {
      if (this.active === session) {
        await session.capture.dispose(); await this.api.cancel({ sessionId: session.id }).catch(() => {}); await this.api.enableDevice({ device: 'microphone', enabled: false }).catch(() => {})
        this.active = null; this.publish({ phase: 'error', level: 0, error: microphoneError(error) }); await this.finish(session, session.transcript, false, 'error')
      }
    }
  }
  private receiveAudio(capture: AudioCapture, pcm: Int16Array): void {
    const session = this.active
    if (!session || session.capture !== capture || session.cancelled) return
    const boundary = this.boundary
    if (boundary && !boundary.opened) {
      if (boundary.cancelled) return
      const remaining = boundarySampleLimit - boundary.samples
      if (remaining > 0) { const kept = pcm.slice(0, remaining); boundary.buffer.push(kept); boundary.samples += kept.length }
      if (pcm.length > remaining || boundary.samples === boundarySampleLimit) {
        boundary.stopRequested = true
        boundary.error = 'Recording stopped after 12 seconds waiting for the message to save. The captured speech is kept in the draft; start recording again to continue.'
        this.publish({ error: boundary.error })
        boundary.captureStop ??= Promise.resolve().then(() => capture.stop())
      }
      return
    }
    this.enqueue(session, pcm)
  }
  private enqueue(session: ActiveVoiceSession, pcm: Int16Array): void {
    if (session.cancelled || session.failure) return
    if (++session.queued > 12) { session.queued--; this.publish({ error: 'Local speech is processing slowly. Recording stopped to keep the current transcript.' }); void this.stop(false); return }
    const sequence = session.sequence++
    const buffer = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer
    session.queue = session.queue.then(async () => {
      if (session.cancelled || session.failure) return
      const result = await this.api.append({ sessionId: session.id, sequence, pcm16: buffer })
      if (this.active !== session || session.cancelled) return
      this.checkResult(session, result, false)
      const text = result.text.trim()
      if (text && text !== session.transcript) {
        session.transcript = text
        this.publish({ transcript: text })
        if (session.live) this.callbacks.previewTranscript!(session.id, text, session.owner)
      }
    }).catch(error => {
      if (this.active === session && !session.cancelled) {
        session.failure = error instanceof Error ? error : new Error('Local transcription failed.')
        this.publish({ error: session.failure.message })
        void this.stop(false)
      }
    }).finally(() => { session.queued-- })
  }
  private checkResult(session: Pick<ActiveVoiceSession, 'id'>, result: LocalSpeechResult, final: boolean): void {
    if (!result || result.sessionId !== session.id || result.final !== final || typeof result.text !== 'string') throw new Error('Local transcription returned an invalid session result. Try recording again.')
  }
  private async finish(session: ActiveVoiceSession, text: string, send: boolean, reason: VoiceTranscriptFinishOptions['reason']): Promise<void> {
    if (session.finished) return
    session.finished = true
    const canSend = !!text && send && reason === 'final' && !this.state.error && sameInputOwner(session.owner, this.callbacks.getOwner()) && !this.callbacks.isBusy()
    if (session.live) { await this.callbacks.finishTranscript!(session.id, text, session.owner, { send: canSend, reason }); return }
    const dispatched = text ? canSend ? this.callbacks.sendFinal(text, session.owner) : this.callbacks.appendTranscript(text, session.owner) : undefined
    void Promise.resolve(dispatched).catch(error => { if (!this.active && this.state.transcript === text) this.publish({ error: error instanceof Error ? error.message : 'Transcript finalized; sending could not finish.' }) })
  }
  sendSegment(send: () => Promise<boolean>): Promise<void> {
    if (this.splitting) return this.splitting
    const intent = this.intent; const starting = this.starting; const stopping = this.stopping; const cancelling = this.cancelling
    const operation = (async () => {
      if (starting) await starting
      if (stopping) await stopping
      if (cancelling) await cancelling
      if (intent !== this.intent) return
      const session = this.active
      if (!session || this.state.phase !== 'recording') { await send(); return }
      await this.splitRecording(session, send)
    })()
    this.splitting = operation
    const settled = () => { if (this.splitting === operation) this.splitting = null }
    void operation.then(settled, settled)
    return operation
  }
  private async splitRecording(session: ActiveVoiceSession, send: () => Promise<boolean>): Promise<void> {
    let interrupt!: () => void
    const boundary: SegmentBoundary = { session, buffer: [], samples: 0, stopRequested: false, cancelled: false, opened: false, interrupted: new Promise<void>(resolve => { interrupt = resolve }), interrupt: () => interrupt() }
    const intent = this.intent
    this.publish({ phase: 'finalizing', level: 0, error: undefined })
    session.capture.flush?.()
    if (session.cancelled || this.active !== session) return
    boundary.stopRequested = intent !== this.intent
    this.boundary = boundary
    const wait = <T,>(pending: Promise<T>): Promise<T> => Promise.race([pending, boundary.interrupted.then(() => { throw boundaryCancelled })])
    try {
      let finalized = false
      try {
        await wait(session.queue)
        if (session.failure) throw session.failure
        const result = await wait(this.api.finalize({ sessionId: session.id }))
        if (session.cancelled || this.active !== session) return
        this.checkResult(session, result, true)
        session.transcript = result.text.trim() || session.transcript
        this.publish({ transcript: session.transcript })
        await wait(this.finish(session, session.transcript, false, 'final'))
        finalized = true
      } catch (error) {
        if (error === boundaryCancelled) throw error
        await this.api.cancel({ sessionId: session.id }).catch(() => {})
        boundary.error = error instanceof Error ? error.message : 'Local transcription failed; the current transcript is kept in the draft.'
        this.publish({ error: boundary.error })
        await wait(this.finish(session, session.transcript, false, 'error'))
      }
      if (finalized && !boundary.stopRequested && !this.inputBlocked() && sameInputContext(session.owner, this.callbacks.getOwner())) {
        try {
          if (!await wait(send())) boundary.error ??= 'The message was not saved. Your speech is kept in the draft.'
        } catch (error) {
          if (error === boundaryCancelled) throw error
          boundary.error ??= error instanceof Error ? `The message was not saved: ${error.message}` : 'The message was not saved. Your speech is kept in the draft.'
        }
      }
      await wait(new Promise<void>(resolve => setTimeout(resolve, 0)))
      const continuing = !boundary.stopRequested && !this.inputBlocked() && sameInputContext(session.owner, this.callbacks.getOwner())
      if (!continuing) {
        boundary.stopRequested = true
        boundary.captureStop ??= Promise.resolve().then(() => session.capture.stop())
        await wait(boundary.captureStop)
        await wait(this.api.enableDevice({ device: 'microphone', enabled: false }))
      }
      if (!continuing && !boundary.buffer.length) {
        this.active = null
        if (this.limitTimer) clearTimeout(this.limitTimer); this.limitTimer = null
        await session.capture.dispose()
        this.publish({ phase: 'idle', level: 0, transcript: session.transcript, ...(boundary.error ? { error: boundary.error } : {}) })
        return
      }
      const next = this.newSession(session.capture, session.language, continuing ? this.callbacks.getOwner() : session.owner)
      this.active = next
      if (next.live) this.callbacks.beginTranscript!(next.id, next.owner)
      await wait(this.api.start({ sessionId: next.id, language: next.language }).then(async () => { if (next.cancelled || this.active !== next) await this.api.cancel({ sessionId: next.id }).catch(() => {}) }))
      if (next.cancelled || this.active !== next) return
      const keepRecording = continuing && !boundary.stopRequested && !this.inputBlocked() && sameInputContext(next.owner, this.callbacks.getOwner())
      if (continuing && !keepRecording) {
        boundary.stopRequested = true
        boundary.captureStop ??= Promise.resolve().then(() => session.capture.stop())
        await wait(boundary.captureStop)
        await wait(this.api.enableDevice({ device: 'microphone', enabled: false }))
      }
      boundary.opened = true
      this.publish({ phase: 'recording', transcript: '', error: boundary.error })
      for (const pcm of boundary.buffer) this.enqueue(next, pcm)
      boundary.buffer = []; boundary.samples = 0
      if (!keepRecording) await this.stopRecording(false)
    } catch (error) {
      if (error !== boundaryCancelled) {
        const current = this.active
        const retryAllowed = !boundary.stopRequested && intent === this.intent
        boundary.stopRequested = true
        boundary.captureStop ??= Promise.resolve().then(() => session.capture.stop())
        await boundary.captureStop.catch(() => {})
        if (current && !current.cancelled) {
          await this.api.cancel({ sessionId: current.id }).catch(() => {})
          if (!current.cancelled) await this.finish(current, current.transcript, false, 'error')
          if (this.active === current) this.active = null
        }
        await session.capture.dispose(); await this.api.enableDevice({ device: 'microphone', enabled: false }).catch(() => {})
        if (this.limitTimer) clearTimeout(this.limitTimer); this.limitTimer = null
        if (boundary.cancelled) return
        if (boundary.buffer.length) {
          let interrupt!: () => void
          this.captured = { owner: { ...(current?.owner ?? session.owner) }, language: session.language, buffer: boundary.buffer, cancelled: false, interrupted: new Promise<void>(resolve => { interrupt = resolve }), interrupt: () => interrupt() }
          boundary.buffer = []; boundary.samples = 0
        }
        this.publish({ phase: 'error', level: 0, error: (error instanceof Error ? error.message : 'The speech segment could not be continued.') + (this.captured ? ' Captured speech is kept in memory. Retry or discard captured speech.' : '') })
        if (retryAllowed && intent === this.intent && this.captured) await this.recoverCaptured()
      }
    } finally { if (this.boundary === boundary) this.boundary = null }
  }
  retryCapturedSpeech(): Promise<void> {
    const splitting = this.splitting; const stopping = this.stopping; const cancelling = this.cancelling
    return (async () => { if (splitting) await splitting; if (stopping) await stopping; if (cancelling) await cancelling; await this.recoverCaptured(true) })()
  }
  private recoverCaptured(allowContextChange = false): Promise<void> {
    if (this.recovering) return this.recovering
    const captured = this.captured
    if (!captured) return Promise.resolve()
    const operation = this.transcribeCaptured(captured, allowContextChange)
    this.recovering = operation
    const settled = () => { if (this.recovering === operation) this.recovering = null }
    void operation.then(settled, settled)
    return operation
  }
  private async transcribeCaptured(captured: CapturedSpeech, allowContextChange: boolean): Promise<void> {
    const matchesOwner = () => { const current = this.callbacks.getOwner(); return allowContextChange ? captured.owner.conversationId === current.conversationId : sameInputContext(captured.owner, current) }
    if (this.inputBlocked() || !matchesOwner()) {
      this.publish({ phase: 'error', error: 'Captured speech is kept in its original chat. Close the dialog and return to that chat to retry, or discard captured speech.' })
      return
    }
    const session = { id: crypto.randomUUID() }
    const wait = <T,>(pending: Promise<T>): Promise<T> => Promise.race([pending, captured.interrupted.then(() => { throw boundaryCancelled })])
    this.publish({ phase: 'finalizing', level: 0, error: undefined })
    try {
      await wait(this.api.start({ sessionId: session.id, language: captured.language }).then(async () => { if (captured.cancelled || this.captured !== captured) await this.api.cancel({ sessionId: session.id }).catch(() => {}) }))
      let partial = ''
      for (let sequence = 0; sequence < captured.buffer.length; sequence++) {
        const pcm = captured.buffer[sequence]
        const result = await wait(this.api.append({ sessionId: session.id, sequence, pcm16: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer }))
        this.checkResult(session, result, false); partial = result.text.trim() || partial
      }
      const result = await wait(this.api.finalize({ sessionId: session.id }))
      this.checkResult(session, result, true)
      if (captured.cancelled || this.captured !== captured) return
      if (this.inputBlocked() || !matchesOwner()) throw new Error('The input owner changed. Return to the original chat to retry.')
      const text = result.text.trim() || partial
      if (!text) throw new Error('No speech was detected in the captured audio. Retry or discard captured speech.')
      if (this.callbacks.beginTranscript && this.callbacks.previewTranscript && this.callbacks.finishTranscript) {
        this.callbacks.beginTranscript(session.id, captured.owner)
        await wait(Promise.resolve(this.callbacks.finishTranscript(session.id, text, captured.owner, { send: false, reason: 'final' })))
      } else this.callbacks.appendTranscript(text, captured.owner)
      if (captured.cancelled || this.captured !== captured) return
      this.captured = null
      captured.buffer = []
      this.publish({ phase: 'idle', level: 0, transcript: text, error: undefined })
    } catch (error) {
      await this.api.cancel({ sessionId: session.id }).catch(() => {})
      if (error !== boundaryCancelled && this.captured === captured && !captured.cancelled) this.publish({ phase: 'error', level: 0, error: (error instanceof Error ? error.message : 'Local transcription failed.') + ' Captured speech is kept in memory. Retry or discard captured speech.' })
    }
  }
  discardCapturedSpeech(): Promise<void> { return this.cancel() }
  stop(send = false): Promise<void> {
    ++this.intent
    if (this.boundary) this.boundary.stopRequested = true
    if (this.stopping) return this.stopping
    const starting = this.starting; const splitting = this.splitting
    const operation = (async () => { if (starting) await starting; if (splitting) await splitting; await this.stopRecording(send) })()
    this.stopping = operation
    const settled = () => { if (this.stopping === operation) this.stopping = null }
    void operation.then(settled, settled)
    return operation
  }
  async finishToDraft(): Promise<void> {
    await this.stop(false)
    if (this.captured) await this.retryCapturedSpeech()
    if (this.captured) throw new Error('Captured speech is still waiting. Retry or discard captured speech before leaving this chat.')
  }
  private async stopRecording(send: boolean): Promise<void> {
    const session = this.active
    if (!session || this.state.phase === 'finalizing' || this.state.phase === 'starting') return
    if (this.limitTimer) clearTimeout(this.limitTimer); this.limitTimer = null
    this.publish({ phase: 'finalizing', level: 0 })
    try {
      await session.capture.stop()
      await this.api.enableDevice({ device: 'microphone', enabled: false })
      await session.queue
      if (session.cancelled || this.active !== session) return
      if (session.failure) throw session.failure
      const result = await this.api.finalize({ sessionId: session.id })
      if (session.cancelled || this.active !== session) return
      this.checkResult(session, result, true)
      const text = result.text.trim() || session.transcript
      this.active = null
      this.publish({ phase: 'idle', transcript: text, level: 0, ...(!text && !this.state.error ? { error: 'No speech was detected. Check microphone activity and try again.' } : {}) })
      await this.finish(session, text, send, 'final')
    } catch (error) {
      await this.api.cancel({ sessionId: session.id }).catch(() => {})
      if (this.active === session) { this.active = null; this.publish({ phase: 'error', level: 0, error: error instanceof Error ? error.message : 'Local transcription failed.' }); await this.finish(session, session.transcript, false, 'error') }
    } finally { await session.capture.dispose() }
  }
  cancel(): Promise<void> {
    ++this.intent
    if (this.captured) { this.captured.cancelled = true; this.captured.interrupt(); this.captured.buffer = []; this.captured = null }
    if (this.cancelling) return this.cancelling
    if (this.boundary) { this.boundary.cancelled = true; this.boundary.interrupt() }
    const operation = this.cancelCapture()
    this.cancelling = operation
    const settled = () => { if (this.cancelling === operation) this.cancelling = null }
    void operation.then(settled, settled)
    return operation
  }
  private async cancelCapture(): Promise<void> {
    ++this.epoch
    if (this.limitTimer) clearTimeout(this.limitTimer); this.limitTimer = null
    const session = this.active; this.active = null
    if (session) { session.cancelled = true; await this.finish(session, session.transcript, false, 'cancel'); await session.capture.dispose(); await this.api.cancel({ sessionId: session.id }).catch(() => {}) }
    await this.api.enableDevice({ device: 'microphone', enabled: false }).catch(() => {})
    this.publish({ phase: 'idle', transcript: session?.transcript ?? this.state.transcript, level: 0, error: undefined })
  }
  dispose(): Promise<void> { return this.cancel() }
}



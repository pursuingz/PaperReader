import type { InteractionCommand, LocalSpeechAPI } from '../../shared/localInputTypes'
export function localInputModalActive(root: Pick<Document, 'querySelector'> = document): boolean { return !!root.querySelector('[role="dialog"],[aria-modal="true"]') }
export interface CameraInputState { phase: 'off' | 'loading' | 'active' | 'error'; error?: string }
export class CameraGestureSession {
  private worker: Worker | null = null
  private stream: MediaStream | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private epoch = 0
  private frameToken = 0
  private frameBusy = false
  private pendingFrame: { time: number; token: number } | null = null
  private video: HTMLVideoElement | null = null
  private cancelInit: (() => void) | null = null
  private removeBoundaries: (() => void) | null = null
  constructor(private readonly api: LocalSpeechAPI, private readonly options: { onState(state: CameraInputState): void; onCommand(command: InteractionCommand): void; isRecording(): boolean; getRecordingSessionId?(): string | null; isSuspended(): boolean }) {}
  resetGestures(): void {
    ++this.frameToken
    this.pendingFrame = null
    this.frameBusy = false
    this.worker?.postMessage({ type: 'reset' })
  }
  private suspended(): boolean { return this.options.isSuspended() || localInputModalActive() || document.hidden || !document.hasFocus() }
  private watchBoundaries(): void {
    let modal = localInputModalActive()
    const reset = () => this.resetGestures()
    const observer = new MutationObserver(() => { const active = localInputModalActive(); if (active !== modal) { modal = active; reset() } })
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-modal'] })
    document.addEventListener('visibilitychange', reset)
    window.addEventListener('blur', reset)
    window.addEventListener('focus', reset)
    this.removeBoundaries = () => { observer.disconnect(); document.removeEventListener('visibilitychange', reset); window.removeEventListener('blur', reset); window.removeEventListener('focus', reset) }
  }
  async enable(video: HTMLVideoElement): Promise<void> {
    const requestedEpoch = this.epoch + 1
    await this.disable()
    if (this.epoch !== requestedEpoch) return
    const epoch = ++this.epoch
    this.options.onState({ phase: 'loading' })
    try {
      const assets = await this.api.visionAssets()
      if (epoch !== this.epoch) return
      const worker = new Worker(new URL('./localHand.worker.ts', import.meta.url))
      this.worker = worker
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Local camera inference initialization timed out.')), 30000)
        this.cancelInit = () => { clearTimeout(timeout); reject(new Error('Camera initialization cancelled.')) }
        worker.onerror = () => { clearTimeout(timeout); reject(new Error('Local camera worker could not start.')) }
        worker.onmessage = event => { if (event.data.type === 'ready') { clearTimeout(timeout); resolve() } else if (event.data.type === 'error') { clearTimeout(timeout); reject(new Error(event.data.error)) } }
        worker.postMessage({ type: 'init', assets }, [assets.wasmBinary, assets.handModel])
      })
      if (epoch !== this.epoch) return
      this.cancelInit = null
      await this.api.enableDevice({ device: 'camera', enabled: true })
      if (epoch !== this.epoch) { if (!this.worker) await this.api.enableDevice({ device: 'camera', enabled: false }); return }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false })
      if (epoch !== this.epoch) { stream.getTracks().forEach(track => track.stop()); return }
      this.stream = stream; this.video = video; video.srcObject = stream; video.muted = true; video.playsInline = true
      await video.play()
      if (epoch !== this.epoch) return
      stream.getTracks().forEach(track => { track.onended = () => { if (epoch === this.epoch) void this.fail('Camera disconnected.') } })
      worker.onerror = () => { if (epoch === this.epoch) void this.fail('Local camera worker stopped.') }
      worker.onmessage = event => {
        if (epoch !== this.epoch) return
        if (event.data.type === 'error') { void this.fail(event.data.error); return }
        if (event.data.type !== 'result' || !this.pendingFrame || event.data.time !== this.pendingFrame.time || this.pendingFrame.token !== this.frameToken) return
        this.pendingFrame = null; this.frameBusy = false
        if (this.suspended()) { this.resetGestures(); return }
        if (performance.now() - event.data.time > 500) { this.resetGestures(); return }
        const command = event.data.command as InteractionCommand | null
        if (command === 'stop-voice-and-send' && (!this.options.isRecording() || this.options.getRecordingSessionId && event.data.recordingSessionId !== this.options.getRecordingSessionId())) return
        if (command) this.options.onCommand(command)
      }
      this.watchBoundaries()
      this.options.onState({ phase: 'active' })
      this.timer = setInterval(() => {
        if (this.suspended()) { this.resetGestures(); return }
        if (this.frameBusy || video.readyState < 2 || !video.videoWidth) return
        this.frameBusy = true
        const token = ++this.frameToken
        const time = performance.now()
        void createImageBitmap(video).then(bitmap => {
          if (epoch !== this.epoch || token !== this.frameToken) { bitmap.close(); return }
          if (this.suspended()) { bitmap.close(); this.resetGestures(); return }
          this.pendingFrame = { time, token }
          worker.postMessage({ type: 'frame', bitmap, time, recording: this.options.isRecording(), recordingSessionId: this.options.getRecordingSessionId?.() ?? null }, [bitmap])
        }).catch(() => { if (epoch === this.epoch && token === this.frameToken) this.resetGestures() })
      }, 80)
    } catch (error) { if (epoch === this.epoch) await this.fail(error instanceof Error ? error.message : 'Camera unavailable.') }
  }
  private async fail(error: string): Promise<void> {
    const requestedEpoch = this.epoch + 1
    await this.disable()
    if (this.epoch === requestedEpoch) this.options.onState({ phase: 'error', error })
  }
  async disable(): Promise<void> {
    const epoch = ++this.epoch
    this.cancelInit?.(); this.cancelInit = null
    this.removeBoundaries?.(); this.removeBoundaries = null
    if (this.video) this.video.srcObject = null; this.video = null
    if (this.timer) clearInterval(this.timer); this.timer = null
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop() }); this.stream = null
    this.worker?.postMessage({ type: 'dispose' }); this.worker?.terminate(); this.worker = null
    ++this.frameToken; this.pendingFrame = null; this.frameBusy = false
    await this.api.enableDevice({ device: 'camera', enabled: false }).catch(() => {})
    if (epoch === this.epoch) this.options.onState({ phase: 'off' })
  }
  dispose(): Promise<void> { return this.disable() }
}

export interface AudioCapture {
  start(onAudio: (pcm: Int16Array) => void, onLevel: (level: number) => void, onEnded: () => void): Promise<void>
  flush?(): void
  stop(): Promise<void>
  dispose(): Promise<void>
}
export function floatToPcm(samples: Float32Array): Int16Array {
  return Int16Array.from(samples, sample => Math.round(Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0)) * (sample < 0 ? 32768 : 32767)))
}
export class MicrophoneCapture implements AudioCapture {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private pending: number[] = []
  private onAudio: ((pcm: Int16Array) => void) | null = null
  private disposed = false
  async start(onAudio: (pcm: Int16Array) => void, onLevel: (level: number) => void, onEnded: () => void): Promise<void> {
    if (this.disposed) return
    this.onAudio = onAudio
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false })
    if (this.disposed) { stream.getTracks().forEach(track => track.stop()); return }
    this.stream = stream
    for (const track of stream.getTracks()) track.onended = onEnded
    this.context = new AudioContext({ sampleRate: 16000 })
    await this.context.resume()
    if (this.disposed) { await this.stop(); return }
    this.source = this.context.createMediaStreamSource(stream)
    this.processor = this.context.createScriptProcessor(4096, 1, 1)
    const sampleRate = this.context.sampleRate
    let inputSamples = 0
    let outputSamples = 0
    this.processor.onaudioprocess = event => {
      const input = event.inputBuffer.getChannelData(0)
      let energy = 0
      for (const value of input) energy += value * value
      onLevel(Math.min(1, Math.sqrt(energy / input.length) * 4))
      for (;;) {
        const index = Math.floor(outputSamples * sampleRate / 16000) - inputSamples
        if (index >= input.length) break
        this.pending.push(input[index]); outputSamples++
      }
      inputSamples += input.length
      while (this.pending.length >= 16000) { const samples = this.pending.splice(0, 16000); onAudio(floatToPcm(Float32Array.from(samples))) }
    }
    const silence = this.context.createGain(); silence.gain.value = 0
    this.source.connect(this.processor); this.processor.connect(silence); silence.connect(this.context.destination)
  }
  flush(): void {
    const pending = this.pending; this.pending = []
    if (pending.length && this.onAudio) this.onAudio(floatToPcm(Float32Array.from(pending)))
  }
  async stop(): Promise<void> {
    if (this.processor) { this.processor.onaudioprocess = null; this.processor.disconnect(); this.processor = null }
    this.source?.disconnect(); this.source = null
    if (this.pending.length && this.onAudio) this.onAudio(floatToPcm(Float32Array.from(this.pending)))
    this.pending = []
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop() }); this.stream = null
    const context = this.context; this.context = null
    if (context && context.state !== 'closed') await context.close()
  }
  async dispose(): Promise<void> { this.disposed = true; await this.stop(); this.onAudio = null }
}



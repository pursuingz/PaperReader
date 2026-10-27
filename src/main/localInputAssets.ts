import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { LocalSpeechStatus, LocalVisionAssets } from '../shared/localInputTypes'

export const SPEECH_MODEL = { id: 'whisper-base-multilingual' as const, bytes: 147951465, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin' }
export async function fileHash(file: string): Promise<string> {
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Expected an owned regular asset file.')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
export class LocalInputAssets {
  private downloading = false
  private downloadController: AbortController | null = null
  private error: string | undefined
  constructor(readonly options: { resourceDirectory: string; modelDirectory: string }) {}
  runnerPath(): string { return path.join(this.options.resourceDirectory, 'whisper', 'whisper-cli.exe') }
  modelPath(): string { return path.join(this.options.modelDirectory, 'ggml-base-60ed5bc3.bin') }
  private async validModel(file: string): Promise<boolean> {
    try { const st = await fs.lstat(file); return st.isFile() && !st.isSymbolicLink() && st.size === SPEECH_MODEL.bytes && await fileHash(file) === SPEECH_MODEL.sha256 } catch { return false }
  }
  async visionAssets(): Promise<LocalVisionAssets> {
    const raw = await fs.readFile(path.join(this.options.resourceDirectory, 'prepared.json'), 'utf8')
    if (raw.length > 32000) throw new Error('Invalid local vision manifest.')
    const manifest = JSON.parse(raw.replace(/^\uFEFF/, '')) as { files: { path: string; bytes: number; sha256: string }[] }
    const read = async (relative: string, maxBytes: number): Promise<Buffer> => {
      const record = manifest.files?.find(file => file.path === relative)
      if (!record || !Number.isSafeInteger(record.bytes) || record.bytes < 1 || record.bytes > maxBytes || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error('Local vision asset is not prepared.')
      const target = path.join(this.options.resourceDirectory, relative)
      const stat = await fs.lstat(target)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== record.bytes || await fileHash(target) !== record.sha256) throw new Error('Local vision asset integrity failed.')
      return fs.readFile(target)
    }
    const loader = await read('vision/wasm/vision_wasm_internal.js', 1000000)
    const wasm = await read('vision/wasm/vision_wasm_internal.wasm', 20000000)
    const model = await read('vision/hand_landmarker.task', 8000000)
    return { wasmLoader: loader.toString('utf8'), wasmBinary: Uint8Array.from(wasm).buffer, handModel: Uint8Array.from(model).buffer }
  }
  private async nativeReady(): Promise<boolean> {
    try {
      const raw = await fs.readFile(path.join(this.options.resourceDirectory, 'prepared.json'), 'utf8')
      if (raw.length > 32000) return false
      const manifest = JSON.parse(raw.replace(/^\uFEFF/, '')) as { files: { path: string; bytes: number; sha256: string }[] }
      const names = ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll', 'SDL2.dll']
      for (const name of names) {
        const record = manifest.files.find(file => file.path === `whisper/${name}`)
        if (!record || !Number.isSafeInteger(record.bytes) || record.bytes <= 0 || record.bytes > 100000000 || !/^[a-f0-9]{64}$/.test(record.sha256)) return false
        const file = path.join(this.options.resourceDirectory, 'whisper', name)
        const stat = await fs.lstat(file)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== record.bytes || await fileHash(file) !== record.sha256) return false
      }
      return true
    } catch { return false }
  }
  async status(): Promise<LocalSpeechStatus> {
    const runnerReady = await this.nativeReady()
    const modelReady = await this.validModel(this.modelPath())
    return { runnerReady, modelReady, ready: runnerReady && modelReady, downloading: this.downloading, modelId: SPEECH_MODEL.id, modelBytes: SPEECH_MODEL.bytes, ...(this.error ? { error: this.error } : {}) }
  }
  private async directory(): Promise<void> {
    await fs.mkdir(this.options.modelDirectory, { recursive: true })
    const stat = await fs.lstat(this.options.modelDirectory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Speech model directory must be an owned directory.')
  }
  async importModel(source: string): Promise<LocalSpeechStatus> {
    if (this.downloading) throw new Error('A model operation is already running.')
    this.downloading = true; this.error = undefined
    try {
      if (!await this.validModel(source)) throw new Error('Select the pinned multilingual ggml-base.bin (SHA-256 mismatch).')
      await this.directory()
      if (!await this.validModel(this.modelPath())) await fs.copyFile(source, this.modelPath(), 1)
      this.downloading = false
      return await this.status()
    } finally { this.downloading = false }
  }
  cancelDownload(): void { this.downloadController?.abort() }
  async downloadModel(): Promise<LocalSpeechStatus> {
    if (this.downloading) throw new Error('A model operation is already running.')

    this.downloading = true; this.error = undefined
    const controller = new AbortController(); this.downloadController = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)])
    try {
      if (await this.validModel(this.modelPath())) { this.downloading = false; return await this.status() }
      await this.directory()
      if (signal.aborted) throw new Error('Model download cancelled.')
      const response = await fetch(SPEECH_MODEL.url, { signal, redirect: 'follow' })
      if (!response.ok || !response.body) throw new Error('Official multilingual model download is unavailable. Import the pinned model locally or retry.')
      const part = path.join(this.options.modelDirectory, `download-${randomUUID()}.part`)
      const file = await fs.open(part, 'wx')
      let bytes = 0
      const hash = createHash('sha256')
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          if (signal.aborted) throw new Error('Model download cancelled.')
          bytes += chunk.length
          if (bytes > SPEECH_MODEL.bytes) throw new Error('Model download exceeded its pinned size.')
          hash.update(chunk); await file.write(chunk)
        }
      } finally { await file.close() }
      if (bytes !== SPEECH_MODEL.bytes || hash.digest('hex') !== SPEECH_MODEL.sha256) throw new Error('Model integrity check failed; original model was preserved.')
      await fs.copyFile(part, this.modelPath(), 1)
      this.downloading = false
      return await this.status()
    } catch (error) {
      this.error = controller.signal.aborted ? 'Model download cancelled.' : error instanceof Error ? error.message : 'Model installation failed.'
      throw new Error(this.error)
    } finally { this.downloading = false; if (this.downloadController === controller) this.downloadController = null }
  }
}






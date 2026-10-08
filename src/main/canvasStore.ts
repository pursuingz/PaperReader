import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CanvasDocument, CanvasImageAsset, CanvasImageData, CanvasImageSource } from '../shared/types'
import type { PaperStore } from './storage'
import { canvasImageLimit, inspectCanvasImage, validateCanvasAssetId, validateCanvasDocument, validateCanvasImageAsset, validateCanvasImageInfo, validateCanvasPaperId } from './canvasValidation'
import { validateCanvasNativeDecode, validateCanvasSourceRecord, validatePdfCaptureInput, type NativeCanvasDecode } from './canvasCaptureValidation'

export class CanvasStore {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly papers: PaperStore) {}
  async flush(): Promise<void> { await this.tail }
  private serial<T>(operation: () => Promise<T>): Promise<T> { const task = this.tail.then(operation); this.tail = task.catch(() => undefined); return task }
  private async directory(paperId: string): Promise<string> {
    validateCanvasPaperId(paperId)
    if (!(await this.papers.list()).some(paper => paper.id === paperId && !paper.isDemo)) throw new Error('Paper not found. Import a local PDF first.')
    return join(this.papers.root, 'papers', paperId)
  }
  private async readDocument(directory: string): Promise<CanvasDocument> {
    try { return await this.papers.readJson<CanvasDocument>(join(directory, 'canvas.json'), validateCanvasDocument) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, width: 1000, height: 1200, objects: [] }; throw error }
  }
  async load(paperId: string): Promise<CanvasDocument> { await this.tail; return this.readDocument(await this.directory(paperId)) }
  async save(paperId: string, document: unknown): Promise<void> {
    validateCanvasPaperId(paperId); validateCanvasDocument(document); const snapshot = structuredClone(document)
    await this.serial(async () => {
      const directory = await this.directory(paperId); await this.readDocument(directory)
      for (const object of snapshot.objects) if (object.type === 'image') await this.readOwnedImage(directory, object.assetId, paperId)
      await mkdir(directory, { recursive: true }); await this.papers.atomicJson(join(directory, 'canvas.json'), snapshot)
    })
  }
  async importImage(paperId: string, bytes: Uint8Array, information: Omit<CanvasImageAsset, 'assetId'>): Promise<CanvasImageAsset> {
    validateCanvasPaperId(paperId); validateCanvasImageInfo(information)
    const detected = inspectCanvasImage(bytes)
    if (detected.mimeType !== information.mimeType || detected.width !== information.width || detected.height !== information.height) throw new Error('Canvas image information does not match its bytes')
    const snapshot = new Uint8Array(bytes), info = { ...detected }
    return this.serial(() => this.writeOwnedImage(paperId, snapshot, info))
  }
  async importCapture(paperId: string, input: unknown, nativeDecode?: NativeCanvasDecode): Promise<CanvasImageAsset> {
    validateCanvasPaperId(paperId); validatePdfCaptureInput(input)
    const bytes = new Uint8Array(input.bytes), source = structuredClone({ page: input.page, rect: input.rect }), info = inspectCanvasImage(bytes)
    validateCanvasNativeDecode(bytes, nativeDecode)
    return this.serial(() => this.writeOwnedImage(paperId, bytes, info, source))
  }
  private async writeOwnedImage(paperId: string, bytes: Uint8Array, info: Omit<CanvasImageAsset, 'assetId'>, source?: CanvasImageSource): Promise<CanvasImageAsset> {
    const directory = join(await this.directory(paperId), 'canvas-assets'), asset: CanvasImageAsset = { ...info, assetId: randomUUID() }
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, `${asset.assetId}.${asset.mimeType === 'image/png' ? 'png' : 'jpg'}`), bytes, { flag: 'wx', mode: 0o600 })
    await this.papers.atomicJson(join(directory, `${asset.assetId}.json`), asset)
    if (source) await this.papers.atomicJson(join(directory, `${asset.assetId}.source.json`), { paperId, assetId: asset.assetId, ...source })
    return asset
  }
  private async readOwnedImage(directory: string, assetId: string, paperId: string): Promise<CanvasImageData> {
    validateCanvasAssetId(assetId)
    try {
      const assets = join(directory, 'canvas-assets')
      const asset = await this.papers.readJson<CanvasImageAsset>(join(assets, `${assetId}.json`), value => { validateCanvasImageAsset(value); if (value.assetId !== assetId) throw new Error('Invalid canvas asset ownership') })
      const path = join(assets, `${assetId}.${asset.mimeType === 'image/png' ? 'png' : 'jpg'}`), size = await stat(path)
      if (!size.isFile() || size.size > canvasImageLimit) throw new Error('Canvas image resource is invalid or too large')
      const bytes = new Uint8Array(await readFile(path)), detected = inspectCanvasImage(bytes)
      if (detected.mimeType !== asset.mimeType || detected.width !== asset.width || detected.height !== asset.height) throw new Error('Canvas image resource does not match its information')
      let source: CanvasImageSource | undefined
      try {
        const stored = await this.papers.readJson<CanvasImageSource>(join(assets, `${assetId}.source.json`), value => validateCanvasSourceRecord(value, paperId, assetId))
        source = { page: stored.page, rect: structuredClone(stored.rect) }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      return { ...asset, bytes, ...(source ? { source } : {}) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Canvas image resource is missing. Existing canvas objects were preserved.')
      throw error
    }
  }
  async readImage(paperId: string, assetId: string): Promise<CanvasImageData> { validateCanvasAssetId(assetId); await this.tail; return this.readOwnedImage(await this.directory(paperId), assetId, paperId) }
}

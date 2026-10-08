import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SummaryFigureCapture, SummaryFigureCrop, SummaryFigures } from '../shared/types'
import type { PaperStore } from './storage'
import type { CanvasStore } from './canvasStore'
import type { SourceIndexStore } from './sourceIndexStore'
import type { NativeCanvasDecode } from './canvasCaptureValidation'
import { summaryFigureLimits, validateSummaryFigureCapture, validateSummaryFigureId, validateSummaryFigures } from './summaryFiguresValidation'

/** Manual crops are user data. Damaged primary manifests never become editable defaults. */
export class SummaryFigureStore {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly papers: PaperStore, private readonly canvas: CanvasStore, private readonly sources: SourceIndexStore) {}
  async flush(): Promise<void> { await this.tail }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(operation); this.tail = task.catch(() => undefined); return task
  }
  private async directory(paperId: string): Promise<string> {
    validateSummaryFigureId(paperId)
    if (!(await this.papers.list()).some(paper => paper.id === paperId && !paper.isDemo)) throw new Error('Summary figure paper not found. Import a local PDF first.')
    return join(this.papers.root, 'papers', paperId)
  }
  private async readManifest(directory: string, paperId: string): Promise<SummaryFigures> {
    let bytes: Buffer
    try {
      const path = join(directory, 'summary-figures.json'), size = await stat(path)
      if (!size.isFile() || size.size > summaryFigureLimits.manifestBytes) throw new Error('Invalid summary figure manifest size')
      bytes = await readFile(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { paperId, version: 1, crops: [] }
      throw new Error('Summary figure data is damaged or unreadable. Existing files were preserved; crops are read-only.')
    }
    let value: unknown
    try {
      if (bytes.byteLength > summaryFigureLimits.manifestBytes) throw new Error('Invalid summary figure manifest size')
      value = JSON.parse(bytes.toString('utf8')); validateSummaryFigures(value, paperId)
    } catch { throw new Error('Summary figure data is damaged. Existing files were preserved; crops are read-only.') }
    for (const crop of value.crops) await this.requireOwnedCrop(paperId, crop)
    return value
  }
  private async requireOwnedCrop(paperId: string, crop: SummaryFigureCrop): Promise<void> {
    const asset = await this.canvas.readImage(paperId, crop.assetId), source = asset.source
    if (!source || source.page !== crop.page || (['x', 'y', 'width', 'height'] as const).some(key => source.rect[key] !== crop.rect[key])) {
      throw new Error('Summary figure image source provenance is inconsistent. Existing files were preserved; crops are read-only.')
    }
  }
  private async requireSource(paperId: string, input: SummaryFigureCapture): Promise<void> {
    const index = await this.sources.load(paperId)
    if (!index?.entries.some(entry => entry.kind === 'figure' && entry.id === input.entryId && entry.text === input.caption && entry.pages.includes(input.page))) {
      throw new Error('The original figure caption or source page changed. Reload the source index before saving a crop.')
    }
  }
  async load(paperId: string): Promise<SummaryFigures> {
    validateSummaryFigureId(paperId); await this.tail
    return this.readManifest(await this.directory(paperId), paperId)
  }
  async save(paperId: string, input: unknown, nativeDecode?: NativeCanvasDecode): Promise<SummaryFigures> {
    validateSummaryFigureId(paperId); validateSummaryFigureCapture(input)
    const snapshot = structuredClone(input)
    return this.serial(async () => {
      const directory = await this.directory(paperId), stored = await this.readManifest(directory, paperId)
      await this.requireSource(paperId, snapshot)
      const retained = stored.crops.filter(crop => crop.entryId !== snapshot.entryId)
      if (retained.length >= summaryFigureLimits.crops || retained.reduce((sum, crop) => sum + crop.caption.length, snapshot.caption.length) > summaryFigureLimits.totalCaption) {
        throw new Error('Summary figure crop or caption limit exceeded')
      }
      // Canvas owns the bytes and provenance, but this operation never adds a Canvas object.
      const asset = await this.canvas.importCapture(paperId, { page: snapshot.page, rect: snapshot.rect, bytes: snapshot.bytes }, nativeDecode)
      const crop: SummaryFigureCrop = { entryId: snapshot.entryId, caption: snapshot.caption, page: snapshot.page, rect: snapshot.rect, assetId: asset.assetId }
      await this.requireOwnedCrop(paperId, crop)
      const value: SummaryFigures = { paperId, version: 1, crops: [...retained, crop] }
      validateSummaryFigures(value, paperId)
      // Source indexing has its own queue and may have rebuilt while the image was saved.
      await this.requireSource(paperId, snapshot)
      await this.papers.atomicJson(join(directory, 'summary-figures.json'), value)
      return value
    })
  }
  async reset(paperId: string, entryId: string): Promise<SummaryFigures> {
    validateSummaryFigureId(paperId); validateSummaryFigureId(entryId)
    return this.serial(async () => {
      const directory = await this.directory(paperId), stored = await this.readManifest(directory, paperId)
      const crops = stored.crops.filter(crop => crop.entryId !== entryId)
      if (crops.length === stored.crops.length) return stored
      const value: SummaryFigures = { paperId, version: 1, crops }
      await this.papers.atomicJson(join(directory, 'summary-figures.json'), value)
      return value
    })
  }
}

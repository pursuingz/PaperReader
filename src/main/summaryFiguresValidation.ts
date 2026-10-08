import type { SummaryFigureCapture, SummaryFigures } from '../shared/types'
import { validateCanvasAssetId, validateCanvasPaperId } from './canvasValidation'
import { validateCanvasSource, validatePdfCaptureInput } from './canvasCaptureValidation'
import { object } from './validation'

export const summaryFigureLimits = { crops: 200, caption: 16000, totalCaption: 240000, manifestBytes: 2 * 1024 * 1024 } as const

function fields(value: unknown, required: string[]): asserts value is Record<string, unknown> {
  object(value)
  const prototype = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value)
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
    keys.some(key => typeof key !== 'string' || !required.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid summary figure fields')
}

export function validateSummaryFigureId(value: unknown): asserts value is string {
  validateCanvasPaperId(value)
  if (value.toLowerCase() === 'demo-workspace') throw new Error('Invalid summary figure identifier')
}

function caption(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > summaryFigureLimits.caption ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('Invalid summary figure caption')
}

export function validateSummaryFigureCapture(value: unknown): asserts value is SummaryFigureCapture {
  fields(value, ['entryId', 'caption', 'page', 'rect', 'bytes'])
  validateSummaryFigureId(value.entryId); caption(value.caption)
  validatePdfCaptureInput({ page: value.page, rect: value.rect, bytes: value.bytes })
}

export function validateSummaryFigures(value: unknown, paperId: string): asserts value is SummaryFigures {
  validateSummaryFigureId(paperId)
  fields(value, ['paperId', 'version', 'crops'])
  if (value.paperId !== paperId || value.version !== 1) throw new Error('Invalid summary figure ownership or version')
  if (!Array.isArray(value.crops) || value.crops.length > summaryFigureLimits.crops) throw new Error('Summary figure crop limit exceeded')
  const ids = new Set<string>(); let totalCaption = 0
  for (const crop of value.crops) {
    fields(crop, ['entryId', 'caption', 'page', 'rect', 'assetId'])
    validateSummaryFigureId(crop.entryId); caption(crop.caption); validateCanvasAssetId(crop.assetId)
    if (ids.has(crop.entryId)) throw new Error('Duplicate summary figure entry identifier')
    ids.add(crop.entryId)
    validateCanvasSource({ page: crop.page, rect: crop.rect })
    totalCaption += crop.caption.length
  }
  if (totalCaption > summaryFigureLimits.totalCaption) throw new Error('Summary figure caption limit exceeded')
}

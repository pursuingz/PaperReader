import type { NormalizedRect } from '../../shared/types'
import { validateCanvasAssetId, validateCanvasPaperId } from '../../main/canvasValidation'
export const EVIDENCE_DRAG_MIME = 'application/x-paper-reader-evidence'
export interface EvidenceDragPayload { paperId: string; entryId: string; assetId: string; page: number; rect: NormalizedRect }
let drag: { token: string; payload: EvidenceDragPayload; expires: number } | null = null
export function beginEvidenceDrag(transfer: DataTransfer, payload: EvidenceDragPayload): void {
  endEvidenceDrag()
  validateCanvasPaperId(payload.paperId); validateCanvasPaperId(payload.entryId); validateCanvasAssetId(payload.assetId)
  const rect = payload.rect
  if (!Number.isInteger(payload.page) || payload.page < 1 || payload.page > 100000 || !rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1.000001 || rect.y + rect.height > 1.000001) throw Error('Invalid evidence drag source geometry')
  const token = crypto.randomUUID()
  transfer.clearData(); transfer.setData(EVIDENCE_DRAG_MIME, token); transfer.effectAllowed = 'copy'
  drag = { token, payload: structuredClone(payload), expires: Date.now() + 120000 }
}
export function readEvidenceDrag(transfer: DataTransfer, paperId: string): EvidenceDragPayload | null {
  const value = drag
  if (!value || value.token !== transfer.getData(EVIDENCE_DRAG_MIME)) return null
  drag = null
  if (Date.now() > value.expires || value.payload.paperId !== paperId) return null
  return structuredClone(value.payload)
}
export function endEvidenceDrag(): void { drag = null }

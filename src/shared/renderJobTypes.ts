import type { PdfTextPage } from './types'
import type { NotebookPage, CanvasExportOptions, CanvasRegion } from './notebookTypes'
import type { MindMapDocument } from './diagramTypes'
export type AutomationRenderPayload =
 | { kind:'prepare'; paperId:string }
 | { kind:'extract'; paperId:string }
 | { kind:'canvas-region'; paperId:string; boardId:string; area:'viewport'|'region' }
 | { kind:'append-text'; paperId:string; markdown:string; expectedRevision:string }
 | { kind:'canvas'; paperId:string; page:NotebookPage; options:CanvasExportOptions }
 | { kind:'mind-map'; paperId:string; map:MindMapDocument; format?:'png'|'pdf' }
export type AutomationRenderJob = AutomationRenderPayload & { jobId:string }
export type AutomationRenderResult = { kind:'prepare'|'append-text' } | { kind:'extract'; pages:PdfTextPage[] } | {kind:'canvas-region';region:CanvasRegion|null} | { kind:'canvas'|'mind-map'; images:Uint8Array[] }
export interface AutomationRenderReply { jobId:string; paperId:string; result?:AutomationRenderResult; error?:string }

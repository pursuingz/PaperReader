import type { PdfCaptureInput, NoteExportResult } from '../shared/types'
import { validatePdfCaptureInput, validateCanvasNativeDecode, type NativeCanvasDecode } from './canvasCaptureValidation'
import { saveMindMapPngExport } from './mindMapPngExport'
import type { ChooseCanvasPngPath } from './canvasPngExport'
function freezeCapture(input:PdfCaptureInput,decode:NativeCanvasDecode):PdfCaptureInput {
 validatePdfCaptureInput(input)
 const snapshot={page:input.page,rect:{...input.rect},bytes:new Uint8Array(input.bytes)}
 validateCanvasNativeDecode(snapshot.bytes,decode);return snapshot
}
export function copyPdfCaptureImage(input:PdfCaptureInput,decode:NativeCanvasDecode,write:(bytes:Uint8Array)=>void):void {const snapshot=freezeCapture(input,decode);write(snapshot.bytes)}
export async function savePdfCaptureImage(input:PdfCaptureInput,dataRoot:string,choose:ChooseCanvasPngPath,decode:NativeCanvasDecode):Promise<NoteExportResult>{
 const snapshot=freezeCapture(input,decode)
 // Reuse the bounded native PNG writer; it has no map-specific geometry restriction.
 return saveMindMapPngExport(snapshot.bytes,`paper-reader-page-${snapshot.page}.png`,dataRoot,choose,decode)
}

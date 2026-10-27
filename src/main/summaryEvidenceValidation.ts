import type { SummaryEvidenceCapture, SummaryEvidenceManifest } from '../shared/types'
import { validateCanvasAssetId } from './canvasValidation'
import { validateCanvasSource, validatePdfCaptureInput } from './canvasCaptureValidation'
import { validateSummaryFigureId } from './summaryFiguresValidation'
import { object } from './validation'
export const summaryEvidenceLimits = { crops: 500, caption: 16000, totalCaption: 240000, label: 500, reason: 1000, manifestBytes: 3 * 1024 * 1024 } as const
function fields(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string,unknown> {
 object(value); const prototype=Object.getPrototypeOf(value), keys=Reflect.ownKeys(value)
 if((prototype!==Object.prototype && prototype!==null) || keys.some(key=>typeof key!=='string'||![...required,...optional].includes(key)) || required.some(key=>!Object.hasOwn(value,key))) throw Error('Invalid summary evidence fields')
}
function text(value:unknown,limit:number,name:string) { if(typeof value!=='string'||!value.trim()||value.length>limit||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error(`Invalid evidence ${name}`) }
function properties(value:Record<string,unknown>) {
 validateSummaryFigureId(value.entryId); text(value.caption,summaryEvidenceLimits.caption,'caption'); text(value.label,summaryEvidenceLimits.label,'label')
 if(value.kind!=='figure'&&value.kind!=='table') throw Error('Invalid evidence kind')
 if(value.method!=='automatic'&&value.method!=='manual') throw Error('Invalid evidence method')
 if(value.status!=='ready'&&value.status!=='needs-review') throw Error('Invalid evidence status')
 if(typeof value.confidence!=='number'||!Number.isFinite(value.confidence)||value.confidence<0||value.confidence>1) throw Error('Invalid evidence confidence')
 if(value.method==='automatic'&&value.status==='ready'&&value.confidence<.75) throw Error('Automatic evidence confidence requires review')
 if(value.algorithmVersion!==undefined&&value.algorithmVersion!==2)throw Error('Invalid evidence algorithm version')
 if(value.reason!==undefined) text(value.reason,summaryEvidenceLimits.reason,'reason')
 if(value.status==='needs-review'&&!value.reason) throw Error('Evidence needing review must explain its uncertainty')
 validateCanvasSource({page:value.page,rect:value.rect})
 const rect=value.rect as {width:number;height:number}
 if(value.method==='automatic'&&rect.width*rect.height>=.95) throw Error('A whole-page image cannot be an automatic precise crop')
}
const common=['entryId','kind','caption','label','page','rect','confidence','method','status']
export function validateSummaryEvidenceCapture(value:unknown):asserts value is SummaryEvidenceCapture {
 fields(value,[...common,'bytes'],['reason','algorithmVersion']); properties(value); validatePdfCaptureInput({page:value.page,rect:value.rect,bytes:value.bytes})
}
export function validateSummaryEvidenceManifest(value:unknown,paperId:string):asserts value is SummaryEvidenceManifest {
 validateSummaryFigureId(paperId); fields(value,['version','paperId','crops'])
 if(value.version!==1||value.paperId!==paperId||!Array.isArray(value.crops)||value.crops.length>summaryEvidenceLimits.crops) throw Error('Invalid evidence ownership, version or crop limit')
 const ids=new Set<string>();let length=0
 for(const crop of value.crops) { fields(crop,[...common,'assetId'],['reason','algorithmVersion']);properties(crop);validateCanvasAssetId(crop.assetId)
  if(ids.has(crop.entryId as string)) throw Error('Duplicate evidence entry identifier');ids.add(crop.entryId as string);length+=(crop.caption as string).length
 }
 if(length>summaryEvidenceLimits.totalCaption) throw Error('Summary evidence caption limit exceeded')
}

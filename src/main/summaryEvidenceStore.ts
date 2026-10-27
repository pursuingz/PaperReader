import { lstat, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SummaryEvidenceCapture, SummaryEvidenceCrop, SummaryEvidenceManifest } from '../shared/types'
import type { PaperStore } from './storage'
import type { CanvasStore } from './canvasStore'
import type { SourceIndexStore } from './sourceIndexStore'
import type { SummaryFigureStore } from './summaryFiguresStore'
import type { NativeCanvasDecode } from './canvasCaptureValidation'
import { validateSummaryFigureId } from './summaryFiguresValidation'
import { summaryEvidenceLimits, validateSummaryEvidenceCapture, validateSummaryEvidenceManifest } from './summaryEvidenceValidation'
import { canonicalEvidenceKey } from '../shared/evidenceIdentity'
const fileName='summary-evidence.json'
/** Additive evidence cache. Old manual crops and recoverable primary bytes stay protected. */
export class SummaryEvidenceStore {
 private tail:Promise<unknown>=Promise.resolve()
 constructor(private papers:PaperStore,private canvas:CanvasStore,private sources:SourceIndexStore,private legacyFigures:SummaryFigureStore) {}
 async flush():Promise<void>{await this.tail}
 private serial<T>(operation:()=>Promise<T>):Promise<T>{const task=this.tail.then(operation);this.tail=task.catch(()=>undefined);return task}
 private async directory(paperId:string){validateSummaryFigureId(paperId);if(!(await this.papers.list()).some(p=>p.id===paperId&&!p.isDemo)) throw Error('Summary evidence paper not found. Import a local PDF first.');return join(this.papers.root,'papers',paperId)}
 private async requireOwned(paperId:string,crop:SummaryEvidenceCrop){
  let source
  try { source=(await this.canvas.readImage(paperId,crop.assetId)).source } catch { throw Error('Summary evidence owned image resource is missing or invalid; existing bytes remain read-only.') }
  if(!source||source.page!==crop.page||(['x','y','width','height'] as const).some(k=>source.rect[k]!==crop.rect[k])) throw Error('Summary evidence source provenance is inconsistent; existing data remains read-only.')
 }
 private async read(directory:string,paperId:string):Promise<SummaryEvidenceManifest>{
  try{
   const path=join(directory,fileName),info=await lstat(path)
   if(!info.isFile()||info.isSymbolicLink()||info.size>summaryEvidenceLimits.manifestBytes) throw Error('Invalid evidence manifest size')
   const handle=await open(path,'r');let value:unknown
   try{const bytes=Buffer.alloc(summaryEvidenceLimits.manifestBytes+1);let length=0
    while(length<bytes.length){const read=await handle.read(bytes,length,bytes.length-length,length);if(!read.bytesRead)break;length+=read.bytesRead}
    if(length>summaryEvidenceLimits.manifestBytes)throw Error('Evidence manifest too large');value=JSON.parse(bytes.subarray(0,length).toString('utf8'))
   }finally{await handle.close()}
   validateSummaryEvidenceManifest(value,paperId);for(const c of value.crops)await this.requireOwned(paperId,c);return value
  }catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error(`Summary evidence data is damaged or invalid; original bytes are protected. ${error instanceof Error?error.message:'Read failed'}`)
   const files=await readdir(directory)
   if(files.some(n=>n.startsWith(`${fileName}.backup-`)||n.startsWith(`${fileName}.tmp-`)))throw Error('Evidence primary is missing. Retained recovery files are protected; recover before editing.')
   if(!files.includes('summary-figures.json')&&files.some(n=>n.startsWith('summary-figures.json.backup-')||n.startsWith('summary-figures.json.tmp-')))throw Error('Legacy figure primary is missing. Retained recovery files are protected.')
   const legacy=await this.legacyFigures.load(paperId)
   const index=legacy.crops.length ? await this.sources.load(paperId).catch(()=>null) : null
   // The old file is neither rewritten nor copied until an explicit new save occurs.
   const crops:SummaryEvidenceCrop[]=legacy.crops.map(c=>({...c,kind:'figure',label:(index?.entries.find(e=>e.id===c.entryId&&e.kind==='figure'&&e.text===c.caption&&e.pages.includes(c.page))?.label ?? c.caption.match(/^(?:Figure|Fig\.?|图)\s*[A-Za-z]?\d+(?:[.\-]\d+)*/i)?.[0]??'Figure').slice(0,500),confidence:1,method:'manual',status:'ready'}))
   const value:SummaryEvidenceManifest={paperId,version:1,crops};validateSummaryEvidenceManifest(value,paperId);return value
  }
 }
 private async requireSource(paperId:string,c:SummaryEvidenceCapture){const index=await this.sources.load(paperId)
  if(!index?.entries.some(e=>e.id===c.entryId&&e.kind===c.kind&&e.text===c.caption&&e.label===c.label&&e.pages.includes(c.page)))throw Error('The original evidence caption, label or source page changed. Reload the source index before saving.')
 }
 async load(paperId:string):Promise<SummaryEvidenceManifest>{validateSummaryFigureId(paperId);await this.tail;return this.read(await this.directory(paperId),paperId)}
 async save(paperId:string,input:unknown,nativeDecode?:NativeCanvasDecode):Promise<SummaryEvidenceManifest>{
  validateSummaryFigureId(paperId);validateSummaryEvidenceCapture(input);const snapshot=structuredClone(input)
  return this.serial(async()=>{
   const directory=await this.directory(paperId),stored=await this.read(directory,paperId);await this.requireSource(paperId,snapshot)
   if(snapshot.method==='automatic'&&stored.crops.some(c=>c.method==='manual'&&(c.entryId===snapshot.entryId||c.kind===snapshot.kind&&c.page===snapshot.page&&canonicalEvidenceKey(c.label,c.kind)!==null&&canonicalEvidenceKey(c.label,c.kind)===canonicalEvidenceKey(snapshot.label,snapshot.kind))))return stored
   const retained=stored.crops.filter(c=>c.entryId!==snapshot.entryId)
   if(retained.length>=summaryEvidenceLimits.crops||retained.reduce((n,c)=>n+c.caption.length,snapshot.caption.length)>summaryEvidenceLimits.totalCaption)throw Error('Summary evidence crop or caption limit exceeded')
   const asset=await this.canvas.importCapture(paperId,{page:snapshot.page,rect:snapshot.rect,bytes:snapshot.bytes},nativeDecode)
   const {bytes:_,...metadata}=snapshot,crop:SummaryEvidenceCrop={...metadata,assetId:asset.assetId}
   await this.requireOwned(paperId,crop);const value:SummaryEvidenceManifest={paperId,version:1,crops:[...retained,crop]};validateSummaryEvidenceManifest(value,paperId)
   if(Buffer.byteLength(JSON.stringify(value,null,2),'utf8')>summaryEvidenceLimits.manifestBytes)throw Error('Evidence manifest byte limit exceeded')
   await this.requireSource(paperId,snapshot);await this.papers.atomicJson(join(directory,fileName),value);return value
  })
 }
 async reset(paperId:string,entryId:string):Promise<SummaryEvidenceManifest>{validateSummaryFigureId(paperId);validateSummaryFigureId(entryId)
  return this.serial(async()=>{const directory=await this.directory(paperId),stored=await this.read(directory,paperId),crops=stored.crops.filter(c=>c.entryId!==entryId);if(crops.length===stored.crops.length)return stored;const value:SummaryEvidenceManifest={paperId,version:1,crops};await this.papers.atomicJson(join(directory,fileName),value);return value})
 }
}

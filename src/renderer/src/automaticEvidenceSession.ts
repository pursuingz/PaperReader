import type { PDFPageProxy } from 'pdfjs-dist'
import { canonicalEvidenceKey, compatibleCaption } from '../../shared/evidenceIdentity'
import type { DesktopAPI, NormalizedRect, PaperSourceEntry, SummaryEvidenceCrop, SummaryEvidenceManifest } from '../../shared/types'
import { detectEvidenceCrop, projectEvidenceText, type EvidenceDetection } from './automaticEvidence'
export interface EvidenceDocument { numPages:number; getPage(number:number):Promise<PDFPageProxy> }
interface EvidenceTask {promise:Promise<EvidenceDocument>;destroy():Promise<void>}
interface RasterTask {promise:Promise<unknown>;cancel():void}
interface Job {task:EvidenceTask|null;destruction:Promise<void>|null;raster:RasterTask|null}
type EvidenceAPI=Pick<DesktopAPI,'readPaper'|'loadSummaryEvidence'|'saveSummaryEvidenceCapture'>
export interface EvidencePageResult {entry:PaperSourceEntry;detection:EvidenceDetection;bytes?:Uint8Array}
export type EvidencePageProcessor=(page:PDFPageProxy,entries:PaperSourceEntry[],current:()=>boolean,render:(task:RasterTask|null)=>void)=>Promise<EvidencePageResult[]>
interface EvidenceOptions {processPage?:EvidencePageProcessor;createCanvas?:()=>HTMLCanvasElement}
export function matchingEvidenceCrop(manifest:SummaryEvidenceManifest|null,entry:PaperSourceEntry,page?:number,sources?:PaperSourceEntry[]):SummaryEvidenceCrop|null{
 const valid=(c:SummaryEvidenceCrop)=>c.kind===entry.kind&&entry.pages.includes(c.page)&&(page===undefined||c.page===page)
 const exact=manifest?.crops.filter(c=>valid(c)&&c.entryId===entry.id&&c.caption===entry.text&&(c.method==='manual'||c.label===entry.label))??[]
 if(exact.length===1)return exact[0]
 const key=canonicalEvidenceKey(entry.label,entry.kind)
 const manual=key?manifest?.crops.filter(c=>valid(c)&&c.method==='manual'&&canonicalEvidenceKey(c.label,c.kind)===key&&compatibleCaption(c.caption,entry.text))??[]:[]
 return manual.length===1&&(!sources||sources.filter(source=>source.kind===entry.kind&&source.pages.includes(manual[0].page)&&canonicalEvidenceKey(source.label,source.kind)===key&&compatibleCaption(manual[0].caption,source.text)).length===1)?manual[0]:null
}
/** The job never shares the Reader PDF proxy and cannot deliver results into another paper. */
export class AutomaticEvidenceSession {
 private job:Job|null=null
 private failures=new Map<string,string>()
 get issues():ReadonlyMap<string,string>{return this.failures}
 constructor(private api:EvidenceAPI,private createTask:(bytes:Uint8Array)=>EvidenceTask,private options:EvidenceOptions={}){}
 private destroy(job:Job){return job.task?job.destruction??=job.task.destroy().catch(()=>undefined):Promise.resolve()}
 async cancel():Promise<void>{const job=this.job;this.job=null;if(job){try{job.raster?.cancel()}catch{}await this.destroy(job)}}
 async run(paperId:string,entries:PaperSourceEntry[],progress?:(done:number,total:number)=>void,options:{refreshAutomatic?:boolean}={}):Promise<SummaryEvidenceManifest|null>{
  if(this.job)throw Error('Automatic evidence cropping is already in progress.')
  const job:Job={task:null,destruction:null,raster:null};this.job=job;this.failures=new Map();const current=()=>this.job===job
  try{
   let manifest=await this.api.loadSummaryEvidence(paperId);if(!current())return null
   if(manifest.paperId!==paperId)throw Error('Evidence manifest ownership does not match this paper.')
   const candidates=entries.filter(e=>e.kind==='figure'||e.kind==='table'),pending:PaperSourceEntry[]=[];let captionLength=0
   for(const entry of candidates){
    const matched=matchingEvidenceCrop(manifest,entry,undefined,candidates)
    if(matched&&(matched.method==='manual'||matched.algorithmVersion===2&&!options.refreshAutomatic))continue
    if(manifest.crops.some(c=>c.method==='manual'&&(c.entryId===entry.id||c.kind===entry.kind&&entry.pages.includes(c.page)&&canonicalEvidenceKey(c.label,c.kind)!==null&&canonicalEvidenceKey(c.label,c.kind)===canonicalEvidenceKey(entry.label,entry.kind)))){this.failures.set(entry.id,'A saved manual crop belongs to an earlier source caption. Review it before replacing.');continue}
    captionLength+=entry.text.length
    if(pending.length>=500||captionLength>240000){this.failures.set(entry.id,'Local evidence crop limit reached. Crop this entry manually.');continue}
    if(!Number.isSafeInteger(entry.pages[0])||entry.pages[0]<1||entry.pages[0]>200){this.failures.set(entry.id,'Source page exceeds the 200-page local extraction limit. Crop it manually.');continue}
    pending.push(structuredClone(entry))
   }
   if(!pending.length)return manifest
   const bytes=await this.api.readPaper(paperId);if(!current())return null
   job.task=this.createTask(new Uint8Array(bytes));const pdf=await job.task.promise;if(!current())return null
   if(!Number.isSafeInteger(pdf.numPages)||pdf.numPages<1||pdf.numPages>100000)throw Error('Invalid evidence PDF page count.')
   const pages=[...new Set(pending.map(e=>e.pages[0]))].sort((a,b)=>a-b);let done=0
   const process=this.options.processPage??((...args)=>processEvidencePage(...args,this.options.createCanvas))
   for(const number of pages){
    if(!current())return null;const pageEntries=pending.filter(e=>e.pages[0]===number);let page:PDFPageProxy|undefined,results:EvidencePageResult[]=[]
    try{if(number>pdf.numPages)throw Error('Original source page is unavailable.');page=await pdf.getPage(number);if(!current())return null
     results=await process(page,pageEntries,current,task=>{job.raster=task})
    }catch(error){if(!current())return null;for(const e of pageEntries)this.failures.set(e.id,error instanceof Error?error.message:'Original source page could not be analysed.')}
    finally{job.raster=null;page?.cleanup()}
    if(!current())return null
    for(const e of pageEntries){
     const result=results.find(r=>r.entry.id===e.id)
     if(!result?.detection.rect||!result.bytes){if(!this.failures.has(e.id))this.failures.set(e.id,result?.detection.reason??'No reliable crop was isolated. Review the source page and crop manually.');done++;progress?.(done,pending.length);continue}
     const d=result.detection
     manifest=await this.api.saveSummaryEvidenceCapture(paperId,{entryId:e.id,kind:e.kind as 'figure'|'table',caption:e.text,label:e.label,page:number,rect:d.rect!,bytes:result.bytes,confidence:d.confidence,method:'automatic',algorithmVersion:2,status:d.status,...(d.reason?{reason:d.reason}:{})})
     if(!current())return null;if(manifest.paperId!==paperId)throw Error('Saved evidence ownership does not match this paper.')
     if(d.reason)this.failures.set(e.id,d.reason);done++;progress?.(done,pending.length)
    }
   }return current()?manifest:null
  }catch(error){if(current())throw error;return null}
  finally{if(current())this.job=null;await this.destroy(job)}
 }
}
export function evidenceRasterGeometry(viewport:{width:number;height:number}){
 if(![viewport.width,viewport.height].every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid source page geometry.')
 const scale=Math.min(1800/viewport.width,1800/viewport.height);return{scale,width:Math.max(1,Math.ceil(viewport.width*scale)),height:Math.max(1,Math.ceil(viewport.height*scale))}
}
/** Render original PDF pixels only. No annotations, AI imagery or UI overlays enter captures. */
export async function processEvidencePage(page:PDFPageProxy,entries:PaperSourceEntry[],current:()=>boolean,render:(task:RasterTask|null)=>void,createCanvas:()=>HTMLCanvasElement=()=>document.createElement('canvas')):Promise<EvidencePageResult[]>{
 const original=page.getViewport({scale:1}),geometry=evidenceRasterGeometry(original),viewport=page.getViewport({scale:geometry.scale}),canvas=createCanvas(),results:EvidencePageResult[]=[]
 try{
  canvas.width=geometry.width;canvas.height=geometry.height;const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('Original PDF analysis canvas is unavailable.')
  if(!current())return[];const task=page.render({canvas,canvasContext:context,viewport,background:'#ffffff',annotationMode:0});render(task);await task.promise;render(null);if(!current())return[]
  const content=await page.getTextContent();if(!current())return[]
  const raster={width:canvas.width,height:canvas.height,data:context.getImageData(0,0,canvas.width,canvas.height).data,text:projectEvidenceText(content,viewport)}
  for(const entry of entries){if(!current())return[];const detection=detectEvidenceCrop(raster,entry);const bytes=detection.rect?await renderEvidenceCapture(page,detection.rect,current,render,createCanvas):undefined;if(!current())return[];results.push({entry,detection,...(bytes?{bytes}:{})})}
  return results
 }finally{canvas.width=0;canvas.height=0;render(null)}
}
/** The target is a bounded crop at original PDF scale 2, never a giant intermediate page bitmap. */
export async function renderEvidenceCapture(page:PDFPageProxy,rect:NormalizedRect,current:()=>boolean,render:(task:RasterTask|null)=>void,createCanvas:()=>HTMLCanvasElement=()=>document.createElement('canvas')):Promise<Uint8Array|undefined>{
 const source=page.getViewport({scale:1}),target=createCanvas();let scale=Math.min(2,4094/(source.width*rect.width),4094/(source.height*rect.height),Math.sqrt(15980000/(source.width*source.height*rect.width*rect.height)))
 try{for(let pass=0;pass<8;pass++){
  if(!current())return;const viewport=page.getViewport({scale}),x=Math.floor(viewport.width*rect.x),y=Math.floor(viewport.height*rect.y)
  target.width=Math.max(1,Math.ceil(viewport.width*(rect.x+rect.width))-x);target.height=Math.max(1,Math.ceil(viewport.height*(rect.y+rect.height))-y)
  if(target.width>4096||target.height>4096||target.width*target.height>16000000)throw Error('Original crop dimensions exceed the bounded image limit.')
  const context=target.getContext('2d');if(!context)throw Error('Original PDF crop canvas is unavailable.')
  const task=page.render({canvas:target,canvasContext:context,viewport,transform:[1,0,0,1,-x,-y],background:'#ffffff',annotationMode:0});render(task);await task.promise;render(null);if(!current())return
  const blob=await new Promise<Blob>((resolve,reject)=>target.toBlob(b=>b?resolve(b):reject(Error('Original crop could not be encoded.')),'image/png'));if(!current())return
  if(blob.size<=10*1024*1024){const bytes=new Uint8Array(await blob.arrayBuffer());return current()?bytes:undefined}scale*=Math.min(.8,Math.sqrt(10*1024*1024/blob.size)*.9)
 }throw Error('Original crop exceeds the bounded 10 MiB image limit.')}
 finally{target.width=0;target.height=0;render(null)}
}

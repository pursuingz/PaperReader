import {validateCanvasRegion} from '../shared/canvasViewport'
import { randomUUID } from 'node:crypto'
import type { AutomationRenderJob, AutomationRenderPayload, AutomationRenderReply, AutomationRenderResult } from '../shared/renderJobTypes'
type Pending={job:AutomationRenderJob;resolve(value:AutomationRenderResult):void;reject(error:Error):void;finish():void}
function validateResult(job:AutomationRenderJob,result:AutomationRenderResult|undefined):AutomationRenderResult {
 if(!result||result.kind!==job.kind)throw Error('Invalid renderer result kind')
 if(result.kind==='canvas-region'){if(result.region!==null)validateCanvasRegion(result.region)}
 else if(result.kind==='extract'){
  if(!Array.isArray(result.pages)||!result.pages.length||result.pages.length>200)throw Error('Invalid renderer source coverage')
  let total=0
  for(let i=0;i<result.pages.length;i++){const page=result.pages[i];if(!page||page.page!==i+1||typeof page.text!=='string')throw Error('Invalid renderer source page');total+=page.text.length}
  if(total>240000||!result.pages.some(page=>page.text.trim()))throw Error('Invalid renderer source text limit')
 }else if(result.kind==='canvas'||result.kind==='mind-map'){
  if(!Array.isArray(result.images)||!result.images.length||result.images.length>128)throw Error('Invalid renderer images')
  let total=0;const png=[137,80,78,71,13,10,26,10]
  for(const bytes of result.images){if(!(bytes instanceof Uint8Array)||bytes.length<24||bytes.length>10*1024*1024||png.some((n,i)=>bytes[i]!==n))throw Error('Invalid renderer PNG');total+=bytes.length}
  if(total>64*1024*1024)throw Error('Renderer image limit exceeded')
 }
 return result
}
export class RenderJobBroker {
 private epoch=0
 private tail:Promise<unknown>=Promise.resolve()
 private current:Pending|null=null
 constructor(private readonly send:(job:AutomationRenderJob)=>void,private readonly sendCancel:(jobId:string)=>void,private readonly timeoutMs=90000){}
 run(payload:AutomationRenderPayload,signal?:AbortSignal):Promise<AutomationRenderResult>{
  const epoch=this.epoch
  const execute=()=>new Promise<AutomationRenderResult>((resolve,reject)=>{
   if(epoch!==this.epoch||signal?.aborted){reject(Error('Render job cancelled'));return}
   const job={...structuredClone(payload),jobId:randomUUID()} as AutomationRenderJob
   let settled=false
   const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(this.current?.job.jobId===job.jobId)this.current=null}
   const fail=(error:Error)=>{if(settled)return;finish();reject(error)}
   const abort=()=>{try{this.sendCancel(job.jobId)}catch{};fail(Error('Render job cancelled'))}
   const timer=setTimeout(()=>{try{this.sendCancel(job.jobId)}catch{};fail(Error('Background rendering timed out'))},this.timeoutMs)
   this.current={job,resolve:value=>{if(settled)return;finish();resolve(value)},reject:fail,finish}
   signal?.addEventListener('abort',abort,{once:true})
   try{this.send(job)}catch(error){fail(error instanceof Error?error:Error('Background renderer unavailable'))}
  })
  const result=this.tail.then(execute);this.tail=result.catch(()=>{});return result
 }
 accept(reply:AutomationRenderReply):boolean{
  const entry=this.current
  if(!reply||!entry||reply.jobId!==entry.job.jobId||reply.paperId!==entry.job.paperId)return false
  try{if(reply.error){if(typeof reply.error!=='string')throw Error('Invalid render error');throw Error(reply.error.slice(0,1000))}
   entry.resolve(validateResult(entry.job,reply.result))
  }catch(error){entry.reject(error instanceof Error?error:Error('Invalid render result'))}
  return true
 }
 pendingJob(jobId:string):AutomationRenderJob|null { return this.current?.job.jobId===jobId?structuredClone(this.current.job):null }
 cancelAll():void{this.epoch++;const current=this.current;if(current){try{this.sendCancel(current.job.jobId)}catch{};current.reject(Error('Render job cancelled'))}}
}

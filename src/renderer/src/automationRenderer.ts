import { pdfjs } from 'react-pdf'
import type {CanvasRegion} from '../../shared/notebookTypes'
import type { DesktopAPI } from '../../shared/types'
import type { AutomationRenderJob, AutomationRenderReply, AutomationRenderResult } from '../../shared/renderJobTypes'
import { extractSummaryPages } from './readingFeatures'
import { rasterNotebookRegion } from './notebookRaster'
import { rasterAutomationMap } from './automationMapRaster'
interface RenderBridge {
 onAutomationRenderJob(listener:(job:AutomationRenderJob)=>void):()=>void
 onAutomationRenderCancel(listener:(jobId:string)=>void):()=>void
 finishAutomationRender(reply:AutomationRenderReply):Promise<void>
}
export function installAutomationRenderer(api:DesktopAPI&RenderBridge,prepare:(paperId:string)=>Promise<void>,append:(job:Extract<AutomationRenderJob,{kind:'append-text'}>)=>Promise<void>,region:(job:Extract<AutomationRenderJob,{kind:'canvas-region'}>)=>Promise<CanvasRegion|null>):()=>void {
 let disposed=false,tail:Promise<unknown>=Promise.resolve()
 const cancelled=new Set<string>(),tasks=new Map<string,pdfjs.PDFDocumentLoadingTask>()
 async function execute(job:AutomationRenderJob){
  const alive=()=>!disposed&&!cancelled.has(job.jobId)
  if(!alive())return
  try{
   let result:AutomationRenderResult
   if(job.kind==='prepare'){await prepare(job.paperId);result={kind:'prepare'}}
   else if(job.kind==='append-text'){await append(job);result={kind:'append-text'}}
   else if(job.kind==='canvas-region'){result={kind:'canvas-region',region:await region(job)}}
   else if(job.kind==='extract'){
    const bytes=await api.readPaper(job.paperId);if(!alive())return
    const task=pdfjs.getDocument({data:new Uint8Array(bytes)});tasks.set(job.jobId,task)
    try{const document=await task.promise;result={kind:'extract',pages:await extractSummaryPages(document,alive)}}finally{tasks.delete(job.jobId);await task.destroy().catch(()=>{})}
   }else if(job.kind==='canvas'){result={kind:'canvas',images:await rasterNotebookRegion(job.paperId,job.page,job.options,api.readCanvasImage)}}
   else{result={kind:'mind-map',images:await rasterAutomationMap(job.map,job.format)}}
   if(alive())await api.finishAutomationRender({jobId:job.jobId,paperId:job.paperId,result})
  }catch(error){if(alive())await api.finishAutomationRender({jobId:job.jobId,paperId:job.paperId,error:error instanceof Error?error.message:'Background paper operation failed'}).catch(()=>{})}
  finally{cancelled.delete(job.jobId)}
 }
 const stopJobs=api.onAutomationRenderJob(job=>{if(disposed)return;const next=tail.then(()=>execute(job));tail=next.catch(()=>{})})
 const stopCancel=api.onAutomationRenderCancel(id=>{cancelled.add(id);void tasks.get(id)?.destroy().catch(()=>{})})
 return()=>{disposed=true;stopJobs();stopCancel();for(const task of tasks.values())void task.destroy().catch(()=>{});tasks.clear();cancelled.clear()}
}

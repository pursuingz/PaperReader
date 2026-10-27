import { useRef, useState } from 'react'
import { pdfjs } from 'react-pdf'
import type { DesktopAPI, PaperSummary, SummaryLanguage, SummaryJobStatus, SummaryDraftPreview } from '../../shared/types'
import { extractSummaryPages } from './readingFeatures'
import { summaryText } from './summaryLocale'
import { summaryFailureMessage } from './summaryFeedback'

export default function usePaperSummary(api: DesktopAPI, report: (message: string) => void) {
 const [language,setSelectedLanguage]=useState<SummaryLanguage>('en')
 const selected=useRef<SummaryLanguage>('en');selected.current=language
 const t=(en:string,zh:string)=>summaryText(selected.current,en,zh)
 const [value,setValue]=useState<PaperSummary|null>(null),[job,setJob]=useState<SummaryJobStatus|null>(null)
 const [draft,setDraft]=useState<SummaryDraftPreview|null>(null)
 const jobLoad=useRef(0)
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState('')
 const context=useRef<{id:string|null;epoch:number}>({id:null,epoch:0})
 const active=useRef<{id:string;paperId:string;task:pdfjs.PDFDocumentLoadingTask|null;done:Promise<void>}|null>(null)
 async function refreshJob(id:string,epoch:number,requestedLanguage:SummaryLanguage):Promise<boolean>{
  const sequence=++jobLoad.current
  const [jobResult,draftResult]=await Promise.allSettled([
   api.loadSummaryJob?.({paperId:id,language:requestedLanguage})??Promise.resolve(null),
   api.loadSummaryDraft?.({paperId:id,language:requestedLanguage})??Promise.resolve(null)
  ])
  if(context.current.id===id&&context.current.epoch===epoch&&selected.current===requestedLanguage&&jobLoad.current===sequence){
   setJob(jobResult.status==='fulfilled'?jobResult.value:null)
   setDraft(draftResult.status==='fulfilled'?draftResult.value:null)
  }
  return jobResult.status==='fulfilled'&&draftResult.status==='fulfilled'
 }
 async function open(id:string|null){
  const epoch=context.current.epoch+1
  context.current={id,epoch};setValue(null);setJob(null);setDraft(null);setReady(false);setBusy(false);setStatus(t('Loading saved summary…','正在加载已保存摘要…'))
  if(!id){setStatus('');return}
  try{
   const saved=await api.loadSummary(id);if(context.current.epoch!==epoch)return
   setValue(saved);setReady(true);setStatus('')
   if(!await refreshJob(id,epoch,selected.current)&&context.current.epoch===epoch)setStatus(t('Saved summary loaded. Previous generation progress is unavailable; you can start again.','已加载保存的摘要。上次生成进度暂不可用，可重新开始。'))
  }catch(error){if(context.current.epoch!==epoch)return;setStatus(t('Saved summary unavailable. Retry to protect your previous summary.','已保存摘要暂不可用。请重试，原摘要已保留。'));report(String(error))}
 }
 async function cancel(){
  const request=active.current;if(!request)return
  const epoch=context.current.epoch
  active.current=null;setBusy(true);setStatus(t('Cancelling summary…','正在取消摘要…'))
  await Promise.allSettled([api.cancelAI(request.id),request.task?.destroy()??Promise.resolve()])
  await request.done
  try{
   // The final atomic save may win a race with cancellation: reload actual bytes.
   const saved=await api.loadSummary(request.paperId)
   if(context.current.epoch!==epoch||active.current)return
   setValue(saved);setStatus(t('Summary cancelled. Showing the latest saved result.','摘要已取消，显示最新保存结果。'))
   await refreshJob(request.paperId,epoch,selected.current)
  }catch(error){if(context.current.epoch!==epoch||active.current)return;setReady(false);setStatus(t('Saved summary unavailable. Retry to check the latest saved result.','已保存摘要暂不可用。请重试查看最新保存结果。'));report(String(error))}
  finally{if(context.current.epoch===epoch&&!active.current)setBusy(false)}
 }
 async function generate(id:string,requestedLanguage:SummaryLanguage=language,resumeId?:string){
  if(active.current||context.current.id!==id||resumeId&&!api.resumeSummary)return
  let settle!:()=>void
  const done=new Promise<void>(resolve=>{settle=resolve})
  const epoch=context.current.epoch,request={id:crypto.randomUUID(),paperId:id,task:null as pdfjs.PDFDocumentLoadingTask|null,done}
  active.current=request;setBusy(true);setStatus(t(resumeId?'Continuing from the last saved stage…':'Opening the full paper…',resumeId?'正在从上次保存的阶段继续…':'正在打开全文…'))
  const isCurrent=()=>active.current===request&&context.current.id===id&&context.current.epoch===epoch
  try{
   let summary:PaperSummary
   if(resumeId){summary=await api.resumeSummary!({requestId:request.id,paperId:id,checkpointId:resumeId})}
   else{
    const bytes=await api.readPaper(id);if(!isCurrent())return
    request.task=pdfjs.getDocument({data:new Uint8Array(bytes)})
    const document=await request.task.promise
    const pages=await extractSummaryPages(document,isCurrent,(page,total)=>{if(isCurrent())setStatus(t(`Reading page ${page} of ${total}…`,`正在读取第 ${page} / ${total} 页…`))})
    if(!isCurrent())return
    setStatus(t('DeepSeek is preparing your summary. Reading notes and writing drafts are saved locally.','DeepSeek 正在生成摘要，阅读笔记和写作草稿会保存至本地。'))
    summary=await api.generateSummary({requestId:request.id,paperId:id,pages,language:requestedLanguage})
   }
   if(!isCurrent()||summary.paperId!==id)return
   setValue(summary);setStatus(t('Summary saved locally.','摘要已保存至本地。'))
  }catch(error){if(isCurrent()){
   if(String(error).includes('[SUMMARY_SAVED_CHECKPOINT_UNAVAILABLE]')){
    try{const saved=await api.loadSummary(id);if(isCurrent()){setValue(saved);setStatus(t('Summary saved locally, but generation progress could not be updated.','摘要已保存至本地，但生成进度无法更新。'));report(t('Summary saved; generation progress is unavailable.','摘要已保存，但生成进度不可用。'))}}
    catch{if(isCurrent()){setReady(false);setStatus(t('The summary may have been saved. Reload to check the latest result.','摘要可能已保存，请重新加载查看最新结果。'))}}
    return
   }
   if(String(error).includes('[SUMMARY_DRAFT_AVAILABLE]')){
    const message=t('A writing draft is available below. It could not yet be arranged into all six sections. Your saved summary is preserved.','下方已保留写作草稿，暂未能完整分为六个模块。已保存摘要仍保留。')
    setStatus(message);report(message);return
   }
   const message=summaryFailureMessage(error,value!==null)
   setStatus(message);report(message)
  }}finally{
   try {
   if(isCurrent()){
    const available=await refreshJob(id,epoch,requestedLanguage)
    if(isCurrent()){active.current=null;setBusy(false);if(!available)setStatus(previous=>`${previous} ${t('Generation progress could not be loaded.','无法加载生成进度。')}`)}
   }
   await request.task?.destroy().catch(()=>undefined)
   } finally { settle() }
  }
 }
 function setLanguage(next:SummaryLanguage){
  if(active.current)return
  selected.current=next;setSelectedLanguage(next);setStatus('');setJob(null);setDraft(null)
  if(context.current.id)void refreshJob(context.current.id,context.current.epoch,next)
 }
 async function resume(id:string){if(job?.canResume&&job.paperId===id&&job.language===selected.current)await generate(id,selected.current,job.checkpointId)}
 async function copyDraft(){
  const currentDraft=draft
  if(!currentDraft||currentDraft.paperId!==context.current.id||currentDraft.language!==selected.current)return
  try{await api.copyText(currentDraft.markdown);report(t('Draft copied.','草稿已复制。'))}catch{report(t('The draft could not be copied.','草稿未能复制。'))}
 }
 return {value,job,draft,ready,busy,status,language,setLanguage,open,cancel,generate,resume,copyDraft}
}

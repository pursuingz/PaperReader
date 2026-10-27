import type { AgentReceipt,AgentToolResult } from '../shared/agentTypes'
import type { PaperStore } from './storage'
import { agentId } from './agentStorage'

export interface ScanImportOutcome { token:string; status:'imported'|'already-exists'|'failed'|'needs-review'|'cancelled'; paperId?:string }
export interface ScanImportBatchValue { attempted:number; imported:number; alreadyExists:number; failed:number; needsReview:number; cancelled:number; remaining:number; outcomes:ScanImportOutcome[] }
export async function importScannedPaperBatch(store:Pick<PaperStore,'importScannedPdf'>,tokens:readonly string[],signal:AbortSignal,libraryChanged:()=>void):Promise<AgentToolResult>{
 if(!Array.isArray(tokens)||tokens.length<1||tokens.length>50||new Set(tokens).size!==tokens.length)throw Error('Select between 1 and 50 distinct owned scan tokens')
 const selected=tokens.map(agentId),receipts:AgentReceipt[]=[],value:ScanImportBatchValue={attempted:0,imported:0,alreadyExists:0,failed:0,needsReview:0,cancelled:0,remaining:0,outcomes:[]}
 try{
  for(const [index,token]of selected.entries()){
   if(signal.aborted){const remaining=selected.slice(index);value.cancelled=remaining.length;value.remaining=remaining.length;value.outcomes.push(...remaining.map(token=>({token,status:'cancelled' as const})));receipts.push({kind:'import',title:`${remaining.length} scanned PDF${remaining.length===1?'':'s'} not imported`,status:'unavailable',detail:'Cancelled before these remaining items were attempted. Existing successful imports are preserved.'});break}
   value.attempted++
   try{
    const result=await store.importScannedPdf(token)
    if(result.status==='version-conflict'){value.needsReview++;value.outcomes.push({token,status:'needs-review'});receipts.push({kind:'import',id:token,title:'Scanned PDF version needs review',status:'needs-review',detail:'A distinct version is already in the library. Existing papers were preserved.'});continue}
    if(!result.paper)throw Error('Import did not return a saved paper')
    const paperId=agentId(result.paper.id),duplicate=result.status==='duplicate';if(duplicate)value.alreadyExists++;else value.imported++
    value.outcomes.push({token,status:duplicate?'already-exists':'imported',paperId});receipts.push({kind:'import',id:token,paperId,title:result.paper.title,status:duplicate?'already-exists':'succeeded',detail:result.status})
   }catch{value.failed++;value.outcomes.push({token,status:'failed'});receipts.push({kind:'import',id:token,title:'Scanned PDF could not be imported',status:'unavailable',detail:'The scanned file changed, disappeared or could not be committed. Scan again before retrying; earlier imports are preserved.'})}
  }
 }finally{if(value.attempted){try{libraryChanged()}catch{}}}
 return {value,receipts}
}

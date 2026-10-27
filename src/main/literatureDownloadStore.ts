import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LiteratureCandidate, LiteratureImportReceipt } from '../shared/agentTypes'
import { agentId, ownedAgentPath, serializeAgent, writeAgentJson } from './agentStorage'

interface DownloadStage { version:1; candidateId:string; sourceUrl:string; pdfUrl:string; sha256:string; byteLength:number; status:'importing'|'imported'|'failed'; createdAt:string; updatedAt:string; receipt?:LiteratureImportReceipt }
export class LiteratureDownloadStore {
 constructor(private root:string){}
 async stage(candidate:LiteratureCandidate,pdfUrl:string,bytes:Uint8Array,signal:AbortSignal):Promise<DownloadStage>{
  const id=agentId(candidate.id),sha256=createHash('sha256').update(bytes).digest('hex'),dir=join(this.root,'literature-downloads',id),path=join(dir,sha256+'.pdf')
  return serializeAgent(join(this.root,'literature-downloads')+':quota',async()=>{
   if(signal.aborted)throw Error('Acquisition cancelled');await ownedAgentPath(this.root,path);await mkdir(dir,{recursive:true});await ownedAgentPath(this.root,path)
   let exists=false;try{const stat=await lstat(path);if(!stat.isFile()||stat.size!==bytes.length||stat.size>50_000_000)throw Error('Owned download staging record is damaged');const previous=await readFile(path);if(createHash('sha256').update(previous).digest('hex')!==sha256)throw Error('Owned download staging hash is damaged');exists=true}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
   if(!exists){const base=join(this.root,'literature-downloads');let total=0,count=0;for(const folder of await readdir(base,{withFileTypes:true})){if(!folder.isDirectory()||folder.isSymbolicLink())throw Error('Invalid owned staging directory');for(const file of await readdir(join(base,folder.name),{withFileTypes:true})){if(file.isSymbolicLink())throw Error('Invalid owned staging file');if(file.name.endsWith('.pdf')){total+=(await lstat(join(base,folder.name,file.name))).size;count++}}}if(count>=1000||total+bytes.length>512*1024*1024)throw Error('Public PDF staging quota reached; previous records were preserved');await writeFile(path,bytes,{flag:'wx',mode:0o600})}
   const now=new Date().toISOString(),record:DownloadStage={version:1,candidateId:id,sourceUrl:candidate.sourceUrl,pdfUrl,sha256,byteLength:bytes.length,status:'importing',createdAt:now,updatedAt:now};await writeAgentJson(this.root,join(dir,sha256+'.json'),record);return record
  })
 }
 async finish(record:DownloadStage,receipt?:LiteratureImportReceipt):Promise<void>{record.status=receipt?'imported':'failed';record.updatedAt=new Date().toISOString();if(receipt)record.receipt=structuredClone(receipt);await writeAgentJson(this.root,join(this.root,'literature-downloads',agentId(record.candidateId),record.sha256+'.json'),record)}
}

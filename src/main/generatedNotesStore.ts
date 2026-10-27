import { readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentCapabilities, GeneratedReadingDraft } from '../shared/agentTypes'
import { agentId, ownedAgentPath, readAgentJson, serializeAgent, writeAgentJson } from './agentStorage'
import { boundedText, exact, plain } from './agentValidation'
function validateDraft(v:unknown,paperId:string,id?:string):asserts v is GeneratedReadingDraft{
 exact(v,['version','id','paperId','taskId','revision','language','title','markdown','createdAt','model']);if(v.version!==1||v.paperId!==paperId||(id&&v.id!==id)||!Number.isInteger(v.revision)||(v.revision as number)<1||!['en','zh'].includes(v.language as string))throw Error('Invalid reading draft owner or revision')
 agentId(v.id);agentId(v.taskId);boundedText(v.title,1000);boundedText(v.markdown,200_000);boundedText(v.createdAt,40);if(v.model!==undefined)boundedText(v.model,100)
}
export class GeneratedNotesStore{
 constructor(readonly root:string,private assertPaper:(paperId:string)=>Promise<void>){ }
 private directory(id:string){return join(this.root,'generated-reading-notes',agentId(id))}
 async list(paperId:string):Promise<GeneratedReadingDraft[]>{await this.assertPaper(agentId(paperId));const dir=this.directory(paperId);await ownedAgentPath(this.root,dir);let entries:string[];try{entries=await readdir(dir)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error}if(entries.length>2000)throw Error('Reading draft storage quota reached');const drafts:GeneratedReadingDraft[]=[];for(const name of entries.filter(n=>/^[\w-]+\.json$/.test(n))){const value=await readAgentJson(this.root,join(dir,name),1_000_000);validateDraft(value,paperId);drafts.push(value)}return drafts.sort((a,b)=>a.revision-b.revision)}
 async create(input:Omit<GeneratedReadingDraft,'version'|'id'|'revision'|'createdAt'>):Promise<GeneratedReadingDraft>{
  return serializeAgent(this.directory(input.paperId)+':revision',async()=>{const all=await this.list(input.paperId);if(all.length>=200)throw Error('Reading draft quota reached');const draft:GeneratedReadingDraft={...structuredClone(input),version:1,id:randomUUID(),revision:(all.at(-1)?.revision??0)+1,createdAt:new Date().toISOString()};validateDraft(draft,input.paperId);await mkdir(this.directory(input.paperId),{recursive:true});await writeAgentJson(this.root,join(this.directory(input.paperId),draft.id+'.json'),draft,true);return structuredClone(draft)})
 }
 async read(paperId:string,id:string):Promise<GeneratedReadingDraft>{await this.assertPaper(agentId(paperId));const v=await readAgentJson(this.root,join(this.directory(paperId),agentId(id)+'.json'),1_000_000);if(!v)throw Error('Reading draft not found');try{validateDraft(v,paperId,id)}catch{throw Error('Stored reading draft is invalid; preserved original')}return structuredClone(v)}
 async markdown(paperId:string,id:string):Promise<string>{const d=await this.read(paperId,id);return `# ${d.title.replace(/[\r\n]/g,' ')} — Reading draft ${d.revision}\n\nAI-generated reading notes · ${d.language} · ${d.createdAt}\n\n${d.markdown}\n`}
 async append(paperId:string,id:string,expectedRevision:string,caps:Pick<AgentCapabilities,'readText'|'appendText'>,signal?:AbortSignal):Promise<void>{const cancelled=()=>{if(signal?.aborted)throw Error('Reading draft append cancelled')};cancelled();boundedText(expectedRevision,200);const d=await this.read(paperId,id);cancelled();await serializeAgent(this.directory(paperId)+':append',async()=>{cancelled();const before=await caps.readText(paperId,signal);cancelled();if(!plain(before)||before.revision!==expectedRevision)throw Error('Text revision changed after review; keep the independent draft');await caps.appendText(paperId,d.markdown,expectedRevision,signal)})}
}

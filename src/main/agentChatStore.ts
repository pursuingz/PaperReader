import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentOwner, AgentTask } from '../shared/agentTypes'
import type { AgentChatTurn } from '../shared/agentChatTypes'
import { agentId, ownedAgentPath, readAgentJson, writeAgentJson } from './agentStorage'
import { boundedText, exact, plain, sameAgentOwner, validateAgentOwner, validateAgentTask, validateReceipt, validateSelections } from './agentValidation'

export function validateAgentChatTurn(value: unknown): asserts value is AgentChatTurn {
 exact(value, ['version','taskId','owner','requestId','userMessageId','assistantMessageId','model','answerReplayOf','status','execution','decision','answer','steps','receipts','selection','error','createdAt','updatedAt'])
 if (value.version !== 1) throw Error('Invalid chat turn version')
 validateAgentOwner(value.owner)
 for (const key of ['taskId','requestId','userMessageId','assistantMessageId']) agentId(value[key])
 if (value.userMessageId === value.assistantMessageId) throw Error('Invalid chat turn binding')
 if(value.answerReplayOf!==undefined)agentId(value.answerReplayOf)
 if (value.model !== undefined && (typeof value.model !== 'string' || !/^[\w.-]{1,100}$/.test(value.model))) throw Error('Invalid chat turn model')
 if (!['queued','running','waiting-selection','succeeded','partial','failed','cancelled','interrupted'].includes(value.status as string) || !Number.isInteger(value.execution) || (value.execution as number) < 1 || !Number.isInteger(value.decision) || (value.decision as number) < 0) throw Error('Invalid chat turn state')
 boundedText(value.answer, 200_000, false)
 if (!Array.isArray(value.steps) || value.steps.length > 2000 || !Array.isArray(value.receipts) || value.receipts.length > 2000) throw Error('Invalid chat turn attachments')
 for (const step of value.steps) {
  exact(step,['id','callId','tool','arguments','status','startedAt','finishedAt','result','error']);agentId(step.id);agentId(step.callId);boundedText(step.tool,80)
  if (!plain(step.arguments) || Object.keys(step.arguments).length || !['running','succeeded','failed','cancelled'].includes(step.status as string)) throw Error('Invalid chat turn step')
  boundedText(step.startedAt,40);if(!Number.isFinite(Date.parse(step.startedAt)))throw Error('Invalid chat turn timestamp')
  if(step.finishedAt!==undefined){boundedText(step.finishedAt,40);if(!Number.isFinite(Date.parse(step.finishedAt)))throw Error('Invalid chat turn timestamp')}
  if(step.error!==undefined)boundedText(step.error,2000)
  if(step.result!==undefined){exact(step.result,['value','receipts','selection']);if(step.result.value!==null)throw Error('Invalid chat turn step result');if(step.result.receipts!==undefined){if(!Array.isArray(step.result.receipts)||step.result.receipts.length>100)throw Error('Invalid chat turn receipts');step.result.receipts.forEach(validateReceipt)}if(step.result.selection!==undefined)validateSelections(step.result.selection)}
 }
 value.receipts.forEach(validateReceipt)
 if (value.selection !== undefined) validateSelections(value.selection)
 if (value.error !== undefined) boundedText(value.error, 2000)
 for (const key of ['createdAt','updatedAt']) { boundedText(value[key],40); if (!Number.isFinite(Date.parse(value[key] as string))) throw Error('Invalid chat turn timestamp') }
}

export class AgentChatStore {
 readonly directory: string
 private pending: Promise<unknown> = Promise.resolve()
 private listeners = new Set<(turn: AgentChatTurn) => void>()
 constructor(readonly root: string) { this.directory = join(root,'agent-chat-turns') }
 subscribe(listener: (turn: AgentChatTurn) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
 async flush(): Promise<void> { await this.pending }
 observe(task: AgentTask): Promise<AgentChatTurn | null> {
  const snapshot=structuredClone(task)
  const work=this.pending.catch(()=>{}).then(async()=>{
   validateAgentTask(snapshot)
   const binding=snapshot.input.chatTurn
   if (!binding) return null
   await ownedAgentPath(this.root,this.directory);await mkdir(this.directory,{recursive:true})
   const turn:AgentChatTurn={version:1,taskId:snapshot.id,owner:structuredClone(snapshot.input.owner),...binding,...(snapshot.input.model?{model:snapshot.input.model}:{}),...(snapshot.input.answerReplayOf?{answerReplayOf:snapshot.input.answerReplayOf}:{}),status:snapshot.status,execution:snapshot.execution,decision:snapshot.consumed.decisionTurns,answer:snapshot.answer,steps:snapshot.steps.map(step=>({...step,arguments:{},...(step.result?{result:{value:null,...(step.result.receipts?{receipts:step.result.receipts}:{}),...(step.result.selection?{selection:step.result.selection}:{})}}:{})})),receipts:snapshot.receipts,...(snapshot.selection?{selection:snapshot.selection}:{}),...(snapshot.error?{error:snapshot.error}:{}),createdAt:snapshot.createdAt,updatedAt:snapshot.updatedAt}
   validateAgentChatTurn(turn)
   const file=join(this.directory,agentId(snapshot.id)+'.json'),previous=await readAgentJson(this.root,file)
   if(previous){validateAgentChatTurn(previous);if(previous.taskId!==turn.taskId||!sameAgentOwner(previous.owner,turn.owner)||previous.requestId!==turn.requestId||previous.userMessageId!==turn.userMessageId||previous.assistantMessageId!==turn.assistantMessageId||previous.model!==turn.model||previous.answerReplayOf!==turn.answerReplayOf)throw Error('Chat turn binding is immutable');if(previous.execution>turn.execution||previous.execution===turn.execution&&(previous.decision>turn.decision||previous.steps.length>turn.steps.length||previous.receipts.length>turn.receipts.length||!['running','queued'].includes(previous.status)&&['running','queued'].includes(turn.status)||previous.status==='succeeded'&&turn.status!=='succeeded')||previous.updatedAt>turn.updatedAt)return previous}
   else {
    const entries=await this.readAll();if(entries.length>=1000)throw Error('Chat turn storage quota reached')
    if(entries.some(entry=>sameAgentOwner(entry.owner,turn.owner)&&(entry.requestId===turn.requestId||entry.userMessageId===turn.userMessageId||entry.assistantMessageId===turn.assistantMessageId||entry.userMessageId===turn.assistantMessageId||entry.assistantMessageId===turn.userMessageId)))throw Error('Chat turn messages already belong to another task')
   }
   await writeAgentJson(this.root,file,turn)
   for(const listener of this.listeners){try{listener(structuredClone(turn))}catch{}}
   return structuredClone(turn)
  })
  this.pending=work;return work
 }
 async list(owner: AgentOwner): Promise<AgentChatTurn[]> {
  validateAgentOwner(owner);await this.flush()
  return (await this.readAll()).filter(turn=>sameAgentOwner(turn.owner,owner)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.taskId.localeCompare(b.taskId))
 }
 private async readAll():Promise<AgentChatTurn[]>{
  await ownedAgentPath(this.root,this.directory);let names:string[]
  try{names=await readdir(this.directory)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error}
  const entries=names.filter(name=>/^[\w-]+\.json$/.test(name));if(entries.length>1000)throw Error('Chat turn storage quota exceeded')
  const turns:AgentChatTurn[]=[]
  for(const name of entries){const value=await readAgentJson(this.root,join(this.directory,name));validateAgentChatTurn(value);if(name!==value.taskId+'.json')throw Error('Invalid chat turn file binding');turns.push(value)}
  return turns
 }
}

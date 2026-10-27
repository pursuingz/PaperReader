import type { AgentOwner } from '../../shared/agentTypes'
import type { AgentChatPreview, AgentChatProgress, AgentChatTurn } from '../../shared/agentChatTypes'
export interface AgentChatMessageBase { id:string; role:'user'|'assistant'; content:string; createdAt:string }
const matches=(a:AgentOwner,b:AgentOwner)=>a.kind===b.kind&&a.id===b.id
export function projectAgentChatMessages<T extends AgentChatMessageBase>(messages:T[],turns:AgentChatTurn[],owner:AgentOwner):T[]{
 let result=[...messages]
 for(const turn of [...turns].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.taskId.localeCompare(b.taskId))){
  if(!matches(turn.owner,owner)||turn.userMessageId===turn.assistantMessageId)continue
  const user=result.find(message=>message.id===turn.userMessageId)
  if(!user||user.role!=='user'||result.some(message=>message.id===turn.assistantMessageId&&message.role!=='assistant'))continue
  if(!turn.answer.trim())continue
  const existing=result.find(message=>message.id===turn.assistantMessageId)
  const answer={...user,...existing,id:turn.assistantMessageId,role:'assistant' as const,content:turn.answer,createdAt:existing?.createdAt??turn.createdAt} as T
  result=result.filter(message=>message.id!==turn.assistantMessageId)
  result.splice(result.findIndex(message=>message.id===turn.userMessageId)+1,0,answer)
 }
 return result
}
export function hasAgentTurnActivity(turn:AgentChatTurn):boolean{return turn.steps.length>0||turn.receipts.length>0||Boolean(turn.selection?.length)||['waiting-selection','partial','failed','cancelled','interrupted'].includes(turn.status)}
export function reduceAgentChatProgress(previews:Record<string,AgentChatPreview>,event:AgentChatProgress,turns:AgentChatTurn[],owner:AgentOwner):Record<string,AgentChatPreview>{
 if(!matches(event.owner,owner)||!Number.isInteger(event.execution)||!Number.isInteger(event.decision)||!Number.isInteger(event.sequence)||event.sequence<1)return previews
 const turn=turns.find(value=>value.taskId===event.taskId&&matches(value.owner,owner)&&value.requestId===event.requestId)
 if(!turn||turn.execution!==event.execution||turn.decision!==event.decision||!['running','queued'].includes(turn.status))return previews
 const key=turn.assistantMessageId,previous=previews[key]
 if(previous&&(event.execution<previous.execution||event.execution===previous.execution&&(event.decision<previous.decision||event.decision===previous.decision&&event.sequence<=previous.sequence)))return previews
 if(previous?.finished&&previous.execution===event.execution&&previous.decision===event.decision)return previews
 if(event.type==='done')return {...previews,[key]:{taskId:event.taskId,requestId:event.requestId,execution:event.execution,decision:event.decision,sequence:event.sequence,content:'',finished:true}}
 if(event.type==='content'&&(typeof event.delta!=='string'||!previous||event.execution!==previous.execution||event.decision!==previous.decision))return previews
 if(!['reset','content'].includes(event.type))return previews
 const content=event.type==='reset'?'':previous.content+event.delta
 if(content.length>200_000)return previews
 return {...previews,[key]:{taskId:event.taskId,requestId:event.requestId,execution:event.execution,decision:event.decision,sequence:event.sequence,content}}
}
export function shouldApplyAgentChatTurn(previous:AgentChatTurn|undefined,incoming:AgentChatTurn):boolean{
 if(!previous)return true
 if(previous.execution!==incoming.execution)return incoming.execution>previous.execution
 if(previous.status==='succeeded'&&incoming.status!=='succeeded')return false
 if(previous.decision!==incoming.decision)return incoming.decision>previous.decision
 if(previous.steps.length!==incoming.steps.length)return incoming.steps.length>previous.steps.length
 if(previous.receipts.length!==incoming.receipts.length)return incoming.receipts.length>previous.receipts.length
 if(!['queued','running'].includes(previous.status)&&['queued','running'].includes(incoming.status))return false
 return incoming.updatedAt>=previous.updatedAt
}
export function mergeAgentChatTurns(saved:AgentChatTurn[],incoming:AgentChatTurn[],owner:AgentOwner):AgentChatTurn[]{
 const merged=new Map<string,AgentChatTurn>()
 for(const turn of [...saved,...incoming])if(matches(turn.owner,owner)&&shouldApplyAgentChatTurn(merged.get(turn.taskId),turn))merged.set(turn.taskId,turn)
 return [...merged.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.taskId.localeCompare(b.taskId))
}

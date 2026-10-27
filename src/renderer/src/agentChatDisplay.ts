import type { AgentOwner } from '../../shared/agentTypes'
import type { AgentChatPreview, AgentChatTurn } from '../../shared/agentChatTypes'
import { projectAgentChatMessages, type AgentChatMessageBase } from './agentChatProjection'

export function agentChatPreviewForTurn(turn:AgentChatTurn|undefined,previews:Record<string,AgentChatPreview>):AgentChatPreview|undefined{
 if(!turn||!['queued','running'].includes(turn.status))return
 const preview=previews[turn.assistantMessageId]
 if(!preview||preview.finished||!preview.content||preview.taskId!==turn.taskId||preview.requestId!==turn.requestId||preview.execution!==turn.execution||preview.decision!==turn.decision||!Number.isInteger(preview.sequence)||preview.sequence<1)return
 return preview
}
export function projectAgentChatDisplay<T extends AgentChatMessageBase>(messages:T[],turns:AgentChatTurn[],previews:Record<string,AgentChatPreview>,owner:AgentOwner):T[]{
 const displayTurns=turns.map(turn=>{
  const preview=turn.owner.kind===owner.kind&&turn.owner.id===owner.id?agentChatPreviewForTurn(turn,previews):undefined
  return {...turn,...(preview?{answer:preview.content}:{})}
 })
 return projectAgentChatMessages(messages,displayTurns,owner)
}

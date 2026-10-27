import type {AgentRunInput} from '../shared/agentTypes'
import type {AgentChatBinding} from '../shared/agentChatTypes'
export function validateChatSourceScope(input:AgentRunInput):void{
 const policy=input.sourcePolicy
 if(!policy){if(input.chatTurn)throw Error('New chat turns require a frozen source scope');return}
 if(policy.mode==='library'){
  if(!input.scope.library||input.scope.paperIds.length)throw Error('Library source scope must resolve the library in main')
 }else if(policy.mode==='general'){
  if(input.scope.library||input.scope.paperIds.length||input.scope.folderToken)throw Error('General source scope cannot read local papers implicitly')
 }else if(input.scope.library||input.scope.paperIds.length!==1||input.scope.paperIds[0]!==input.owner.id||input.scope.paperIds[0]!==policy.paperId||input.scope.folderToken){throw Error('Single-paper source scope cannot widen its frozen paper owner')}
}
export function validateSavedChatBinding(input:AgentRunInput,messages:readonly {id:string;role:string;content:string}[],existing:readonly AgentChatBinding[]):void{
 const binding=input.chatTurn;if(!binding)return
 if(input.clientRequestId!==binding.requestId)throw Error('Chat request binding does not match this request')
 const user=messages.find(message=>message.id===binding.userMessageId)
 if(!user||user.role!=='user'||user.content!==input.instruction)throw Error('The chat turn must bind this actual saved user question')
 if(messages.some(message=>message.id===binding.assistantMessageId))throw Error('The assistant message identity is already saved')
 if(existing.some(turn=>turn.requestId===binding.requestId||turn.userMessageId===binding.userMessageId||turn.assistantMessageId===binding.assistantMessageId||turn.userMessageId===binding.assistantMessageId||turn.assistantMessageId===binding.userMessageId))throw Error('These chat messages already belong to another task')
}
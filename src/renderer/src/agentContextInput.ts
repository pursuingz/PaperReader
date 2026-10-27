import type {AIContextMode,AIRequest} from '../../shared/types'
import type {AgentOwner,AgentRunInput} from '../../shared/agentTypes'
import type {AgentChatBinding} from '../../shared/agentChatTypes'
import {agentChatInput} from './agentTaskPresentation'
export type ChatContextChoice=AIContextMode|'library'
export type GeneralContextChoice='general'|'library'
export const CHAT_CONTEXT_CHOICES:readonly ChatContextChoice[]=['page','paper','notes','paper-notes','library']
export interface ScopedAgentChatInput {owner:AgentOwner;question:string;choice:ChatContextChoice|GeneralContextChoice;paperId?:string;page?:number;snapshot?:AIRequest;binding?:AgentChatBinding}
export function buildScopedAgentInput(value:ScopedAgentChatInput):AgentRunInput{
 const library=value.choice==='library',general=value.choice==='general'
 if(!library&&!general&&(value.owner.kind!=='paper'||!value.paperId||value.owner.id!==value.paperId))throw Error('The selected source must belong to this paper owner')
 if(general&&value.owner.kind!=='general')throw Error('General context requires a general chat owner')
 if(value.choice==='page'&&(!Number.isInteger(value.page)||(value.page??0)<1))throw Error('Choose a valid current page')
 const paperIds=library||general?[]:[value.paperId!],base=agentChatInput(value.owner,value.question,paperIds,value.snapshot)
 return {...base,scope:{paperIds,library,...(library?{folderToken:'managed'}:{})},sourcePolicy:library||general?{mode:value.choice as 'library'|'general'}:{mode:value.choice as AIContextMode,paperId:value.paperId!,...(value.choice==='page'?{page:value.page!}:{})},...(library?{context:JSON.stringify({mode:'library',source:'Library metadata first; read only papers needed for the question.'})}:{}),...(general?{context:undefined}:{}),...(value.binding?{clientRequestId:value.binding.requestId,chatTurn:{...value.binding}}:{})}
}
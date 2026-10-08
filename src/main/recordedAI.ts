import type { AIRequestOwner, AIRequestContext, AIRequestRecord, EffectiveAIRequest, RecordedAIRequest, RetryAIRequest, AIResult, GeneralAIRequest, GeneralAIResult, GeneralChatState, AIReplayResult } from '../shared/types'
import { NOTE_ORGANIZATION_PREFIX, ORGANIZE_NOTES_DISPLAY_QUESTION } from '../shared/aiPrompts'
import { object, validateRequest } from './validation'
import { requestFields, requestUUID, requestOwnerKey, validateRequestOwner, validateEffectiveAIRequest } from './requestHistoryValidation'
import { validateGeneralAIRequest } from './generalChatValidation'
import { buildPaperEffectiveRequest, buildGeneralEffectiveRequest, executeEffectiveAI, type EffectiveAIProgress } from './deepseek'

export interface RecordedMessage { id: string; role: 'user'|'assistant'; content: string; isDemo?: boolean }
interface HistoryAccess {
  begin(owner:AIRequestOwner,input:{requestId:string;userMessageId:string;assistantMessageId:string;payload:EffectiveAIRequest;context:AIRequestContext;expectedUserContent:string;retryOf?:string},signal?:AbortSignal):Promise<AIRequestRecord>
  getReplay(owner:AIRequestOwner,id:string):Promise<{record:AIRequestRecord;payload:EffectiveAIRequest;userContent:string}>
  markResponseReady(owner:AIRequestOwner,id:string,savedAnswer:string):Promise<void>
  settle(owner:AIRequestOwner,id:string,status:'failed'|'cancelled'):Promise<void>
}
interface Options { history: HistoryAccess; readMessages(owner:AIRequestOwner):Promise<RecordedMessage[]>; readGeneral():Promise<GeneralChatState>; fetcher?:typeof fetch }
export function validateRecordedAIRequest(value:unknown):asserts value is RecordedAIRequest {
  object(value);requestFields(value,['request','userMessageId','assistantMessageId']);validateRequest(value.request)
  requestUUID(value.request.requestId);requestUUID(value.userMessageId);requestUUID(value.assistantMessageId)
  if(value.userMessageId===value.assistantMessageId)throw new Error('User and assistant message identities must differ')
}
export function validateRetryAIRequest(value:unknown):asserts value is RetryAIRequest {
  object(value);requestFields(value,['owner','originalRequestId','requestId','userMessageId','assistantMessageId']);validateRequestOwner(value.owner)
  for(const name of ['originalRequestId','requestId','userMessageId','assistantMessageId'])requestUUID(value[name])
  if(value.originalRequestId===value.requestId||value.userMessageId===value.assistantMessageId)throw new Error('Retry requires fresh request and message identities')
}
const cancellation=(signal:AbortSignal)=>{if(signal.aborted)throw new Error('Request cancelled')}

/** Canonical body execution is shared; paper/general source construction is not. */
export class RecordedAIService {
  private activeOwners=new Set<string>()
  constructor(private readonly options:Options){}
  async withOwner<T>(owner:AIRequestOwner,operation:()=>Promise<T>):Promise<T>{
    validateRequestOwner(owner);const key=requestOwnerKey(owner)
    if(this.activeOwners.has(key))throw new Error('A request for this conversation is already active. Wait or cancel it first.')
    this.activeOwners.add(key);try{return await operation()}finally{this.activeOwners.delete(key)}
  }
  private async requireMessages(owner:AIRequestOwner,userId:string,assistantId:string,expected:string){
    const messages=await this.options.readMessages(owner),matching=messages.filter(message=>message.id===userId)
    if(messages.length>=1000)throw new Error('Conversation message limit reached; there is no space for a complete assistant answer. Existing messages were preserved.')
    if(matching.length!==1||matching[0].role!=='user'||matching[0].isDemo||matching[0].content!==expected)throw new Error('The saved user message does not match this request')
    if(messages.some(message=>message.id===assistantId))throw new Error('The reserved assistant message is already occupied')
  }
  private async dispatch(owner:AIRequestOwner,input:{requestId:string;userMessageId:string;assistantMessageId:string;payload:EffectiveAIRequest;context:AIRequestContext;expectedUserContent:string;retryOf?:string},key:string,signal:AbortSignal,onProgress?:(value:EffectiveAIProgress)=>void):Promise<{content:string;historyWarning?:string}>{
    if(!key)throw new Error('Open Settings and enter your DeepSeek API key before asking AI.')
    cancellation(signal);validateEffectiveAIRequest(input.payload)
    await this.requireMessages(owner,input.userMessageId,input.assistantMessageId,input.expectedUserContent);cancellation(signal)
    try{
      await this.options.history.begin(owner,input,signal);cancellation(signal)
      const content=await executeEffectiveAI(input.payload,key,signal,this.options.fetcher??fetch,onProgress);cancellation(signal)
      const displayed=input.context.action==='organize-notes'?NOTE_ORGANIZATION_PREFIX+content:content
      try{await this.options.history.markResponseReady(owner,input.requestId,displayed)}catch{
        await this.options.history.settle(owner,input.requestId,'failed').catch(()=>{})
        return {content,historyWarning:'The complete reply is available, but its request history could not be updated. Reload the history to recover its status.'}
      }
      cancellation(signal);return {content}
    }catch(error){await this.options.history.settle(owner,input.requestId,signal.aborted?'cancelled':'failed').catch(()=>{});throw error}
  }
  async askPaper(value:RecordedAIRequest,model:string,key:string,signal:AbortSignal,onProgress?:(value:EffectiveAIProgress)=>void):Promise<AIResult>{
    validateRecordedAIRequest(value)
    const request=structuredClone(value.request),owner:AIRequestOwner={scope:'paper',paperId:request.paperId},mode=request.context.mode??'page'
    const payload=buildPaperEffectiveRequest(request,model,true)
    const context:AIRequestContext={label:request.context.paperTitle.slice(0,500),mode,action:request.action??'ask',page:mode==='page'?request.context.page:null,selectionCharacters:mode==='page'?(request.context.selection?.length??0):0}
    return this.withOwner(owner,async()=>({requestId:request.requestId,paperId:request.paperId,...await this.dispatch(owner,{requestId:request.requestId,userMessageId:value.userMessageId,assistantMessageId:value.assistantMessageId,payload,context,expectedUserContent:request.action==='organize-notes'?ORGANIZE_NOTES_DISPLAY_QUESTION:request.question},key,signal,onProgress)}))
  }
  async askGeneral(value:GeneralAIRequest,model:string,key:string,signal:AbortSignal,onProgress?:(value:EffectiveAIProgress)=>void):Promise<GeneralAIResult>{
    validateGeneralAIRequest(value);const input=structuredClone(value),owner:AIRequestOwner={scope:'general',conversationId:input.conversationId}
    return this.withOwner(owner,async()=>{
      const state=await this.options.readGeneral();cancellation(signal)
      if(state.conversationId!==input.conversationId)throw new Error('The saved general conversation does not match this request')
      const index=state.messages.findIndex(message=>message.id===input.userMessageId)
      if(index<0||state.messages[index].role!=='user'||state.messages[index].content!==input.question.trim())throw new Error('The saved general message does not match this request')
      const payload=buildGeneralEffectiveRequest(input.question,state.messages.slice(0,index),model,true)
      const result=await this.dispatch(owner,{requestId:input.requestId,userMessageId:input.userMessageId,assistantMessageId:input.assistantMessageId,payload,context:{label:'General conversation',mode:'general',action:'ask',page:null,selectionCharacters:0},expectedUserContent:input.question.trim()},key,signal,onProgress)
      return {requestId:input.requestId,conversationId:input.conversationId,...result}
    })
  }
  async retry(value:RetryAIRequest,key:string,signal:AbortSignal,onProgress?:(value:EffectiveAIProgress)=>void):Promise<AIReplayResult>{
    validateRetryAIRequest(value);const input=structuredClone(value)
    return this.withOwner(input.owner,async()=>{
      cancellation(signal);const original=await this.options.history.getReplay(input.owner,input.originalRequestId);cancellation(signal)
      const result=await this.dispatch(input.owner,{requestId:input.requestId,userMessageId:input.userMessageId,assistantMessageId:input.assistantMessageId,payload:original.payload,context:original.record.context,expectedUserContent:original.userContent,retryOf:input.originalRequestId},key,signal,onProgress)
      return input.owner.scope==='paper'?{requestId:input.requestId,paperId:input.owner.paperId,...result}:{requestId:input.requestId,conversationId:input.owner.conversationId,...result}
    })
  }
}

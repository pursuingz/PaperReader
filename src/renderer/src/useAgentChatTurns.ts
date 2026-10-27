import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentOwner } from '../../shared/agentTypes'
import type { AgentChatAPI, AgentChatPreview, AgentChatTurn } from '../../shared/agentChatTypes'
import { reduceAgentChatProgress, mergeAgentChatTurns, shouldApplyAgentChatTurn } from './agentChatProjection'
const matches=(a:AgentOwner,b:AgentOwner)=>a.kind===b.kind&&a.id===b.id
export function useAgentChatTurns(api:Partial<AgentChatAPI>,owner:AgentOwner|null){
 const [turns,setTurns]=useState<AgentChatTurn[]>([]),[previews,setPreviews]=useState<Record<string,AgentChatPreview>>({}),[error,setError]=useState('')
 const current=useRef<AgentChatTurn[]>([]),epoch=useRef(0),live=useRef(new Map<string,AgentChatTurn>()),ownerKey=owner?owner.kind+':'+owner.id:''
 const reload=useCallback(async()=>{
  if(!owner||!api.loadAgentChatTurns)return
  const generation=epoch.current
  try{const saved=await api.loadAgentChatTurns(owner);if(generation!==epoch.current)return;current.current=mergeAgentChatTurns(saved,[...live.current.values()],owner);setTurns(current.current);setError('')}
  catch(e){if(generation===epoch.current)setError(e instanceof Error?e.message:String(e))}
 },[api,ownerKey])
 useEffect(()=>{
  ++epoch.current;current.current=[];live.current=new Map();setTurns([]);setPreviews({});setError('')
  if(!owner)return
  const generation=epoch.current
  const stopTurn=api.onAgentChatTurn?.(turn=>{
   if(generation!==epoch.current||!matches(turn.owner,owner))return
   const previous=current.current.find(t=>t.taskId===turn.taskId)
   if(!shouldApplyAgentChatTurn(previous,turn))return
   live.current.set(turn.taskId,turn);current.current=[...current.current.filter(t=>t.taskId!==turn.taskId),turn];setTurns(current.current)
   if(!['queued','running'].includes(turn.status))setPreviews(old=>{if(!old[turn.assistantMessageId])return old;const next={...old};delete next[turn.assistantMessageId];return next})
  })
  const stopProgress=api.onAgentChatProgress?.(event=>{if(generation!==epoch.current)return;setPreviews(old=>reduceAgentChatProgress(old,event,current.current,owner))})
  void reload()
  return()=>{++epoch.current;stopTurn?.();stopProgress?.()}
 },[api,ownerKey,reload])
 return {turns,previews,error,reload}
}

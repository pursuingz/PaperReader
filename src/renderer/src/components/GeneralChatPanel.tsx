import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { ArrowUp, History, Redo2, MessageCircle, Settings, Square, Sparkles } from 'lucide-react'
import type { AgentChatPreview, AgentChatTurn } from '../../../shared/agentChatTypes'
import type { GeneralChatMessage } from '../../../shared/requestTypes'
import type { GeneralChatWorkspace } from '../useGeneralChat'
import { agentChatPreviewForTurn, projectAgentChatDisplay } from '../agentChatDisplay'
import AgentTurnActivity, { type AgentTurnActivityProps } from './AgentTurnActivity'
import MarkdownContent from './MarkdownContent'
import CopyAnswer from './CopyAnswer'
import RequestRetryButton from './RequestRetryButton'

export interface GeneralChatPanelProps {
 workspace: GeneralChatWorkspace
 onSend?:()=>void|Promise<void>
 model?: string
 onSettings?: () => void
 disabled?: boolean
 inputControls?: ReactNode
 scopeLabel?: string
 turns?: AgentChatTurn[]
 agentPreviews?: Record<string,AgentChatPreview>
 turnActions?: Omit<AgentTurnActivityProps,'turn'|'placement'>
 contextControl?: ReactNode
 onTaskHistory?: () => void
 onReanswer?: (turn:AgentChatTurn) => void
}
const noTurns:AgentChatTurn[]=[],noMessages:GeneralChatMessage[]=[],noPreviews:Record<string,AgentChatPreview>={}
export default function GeneralChatPanel({ workspace, onSend, model, onSettings = workspace.onSettings, disabled = false, inputControls, scopeLabel, turns = noTurns, agentPreviews = noPreviews, turnActions, contextControl, onTaskHistory, onReanswer }: GeneralChatPanelProps) {
  const scroller = useRef<HTMLDivElement>(null), atEnd = useRef(true)
  const baseMessages=workspace.state?.messages??noMessages,ownerId=workspace.state?.conversationId
  const owner=useMemo(()=>ownerId?{kind:'general' as const,id:ownerId}:null,[ownerId])
  const ownedTurns=useMemo(()=>owner?turns.filter(turn=>turn.owner.kind===owner.kind&&turn.owner.id===owner.id):noTurns,[turns,owner])
  const messages=useMemo(()=>owner?projectAgentChatDisplay(baseMessages,ownedTurns,agentPreviews,owner):baseMessages,[baseMessages,ownedTurns,agentPreviews,owner])
  const assistantIds=new Set(messages.filter(message=>message.role==='assistant').map(message=>message.id))
  const legacyPreview=workspace.preview&&!ownedTurns.some(turn=>turn.requestId===workspace.preview!.requestId)?workspace.preview:null
  useEffect(() => { const element = scroller.current; if (element && atEnd.current) element.scrollTop = element.scrollHeight }, [messages, legacyPreview?.content])
  return <section className="general-chat-panel" aria-label="General DeepSeek chat">
    <header className="general-chat-header">
      <div><span className="general-chat-mark"><MessageCircle size={17}/></span><div><h2>A space to ask</h2><p>Questions and library tasks</p></div></div>
      <div>{onTaskHistory&&<button className="icon-button" aria-label="Task history" title="Task history" onClick={onTaskHistory}><History size={15}/></button>}<button className="icon-button" aria-label="Open DeepSeek settings" title="DeepSeek settings" onClick={onSettings}><Settings size={15}/></button></div>
    </header>
    <div className="general-chat-model"><span className={workspace.hasApiKey ? 'connected-dot' : 'offline-dot'}/>{workspace.hasApiKey ? model || 'DeepSeek' : 'Connection needed'}<span>Local conversation</span></div>
    <div className="general-chat-messages" role="log" aria-label="General conversation" aria-live="polite" ref={scroller} onScroll={() => { const element = scroller.current; if (element) atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 70 }}>
      {workspace.ready && !messages.length && <div className="general-chat-empty"><Sparkles size={23}/><h3>Start with a small question.</h3><p>Explore an idea, work through a problem,<br/>or think out loud with DeepSeek.</p><small>This conversation stays separate from your papers.</small></div>}
      {!workspace.ready && !workspace.error && <p className="general-chat-loading" role="status">Loading your conversation…</p>}
      {messages.map(message => {
        const record=workspace.recordForMessage(message.id),turn=ownedTurns.find(value=>message.role==='user'?value.userMessageId===message.id:value.assistantMessageId===message.id),preview=message.role==='assistant'?agentChatPreviewForTurn(turn,agentPreviews):undefined
        return <Fragment key={message.id}><article className={`general-chat-message ${message.role}${preview?' general-chat-preview':''}`} data-message-id={message.id} aria-label={preview?'General response preview':undefined}>
          <div className="general-chat-message-label"><strong>{message.role === 'user' ? 'You' : 'DeepSeek'}</strong>{record?.retryOf && <small>Retried round</small>}{message.role==='assistant'&&turn?.answerReplayOf&&<small title="Answer again using saved sources and results">Saved sources</small>}{preview?<><small>Receiving · not saved</small>{turnActions?.onCancel&&turn&&<button className="icon-button" aria-label="Cancel task response" disabled={turnActions.busy} onClick={()=>turnActions.onCancel?.(turn)}><Square size={11}/></button>}</>:<time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}</div>
          {message.role === 'assistant' ? <MarkdownContent content={message.content}/> : <p className="general-chat-question">{message.content}</p>}
          {(message.role==='assistant'&&!preview||message.role==='user'&&record)&&<div className="general-chat-message-actions">
            {message.role === 'assistant' && !preview && <CopyAnswer content={message.content} copy={workspace.copyText}/>}
            {message.role==='assistant'&&!preview&&turn&&turn.answer.trim()&&!['queued','running'].includes(turn.status)&&onReanswer&&<button className="answer-again-action" aria-label="Answer again" disabled={disabled||workspace.busy||!workspace.ready||workspace.needsSave||!!turnActions?.busy} onClick={()=>onReanswer(turn)} title="Answer again using saved sources and results only"><Redo2 size={12}/>Answer again</button>}
            {message.role === 'user' && record && <RequestRetryButton record={record} messageId={message.id} disabled={disabled || !workspace.ready || workspace.busy || workspace.needsSave || !workspace.historyReady} onRetry={value => { atEnd.current = true; void workspace.retryRequest(value) }}/>}
          </div>}
        </article>{turn&&message.role==='user'&&<><AgentTurnActivity {...turnActions} turn={turn} placement="activity"/>{!assistantIds.has(turn.assistantMessageId)&&<AgentTurnActivity {...turnActions} turn={turn} placement="results"/>}</>}{turn&&message.role==='assistant'&&<AgentTurnActivity {...turnActions} turn={turn} placement="results"/>}</Fragment>
      })}
      {legacyPreview && <article className="general-chat-message assistant general-chat-preview" aria-label="General response preview"><div className="general-chat-message-label"><strong>DeepSeek</strong><small>Receiving · not saved</small></div>{legacyPreview.content ? <MarkdownContent content={legacyPreview.content}/> : <p>Waiting for response…</p>}</article>}
    </div>
    <div className="general-chat-feedback">
      <span role="status">{workspace.status}</span>
      {workspace.error && <p role="alert">{workspace.error}</p>}
      {workspace.error && !workspace.ready && <button aria-label="Retry general chat loading" disabled={disabled} onClick={() => void workspace.retryLoad()}>Retry loading</button>}
      {workspace.needsSave && <button aria-label="Retry saving general chat" disabled={disabled || workspace.busy} onClick={() => void workspace.flush().catch(() => undefined)}>Retry saving</button>}
      {workspace.historyError && <div className="general-chat-history-error"><span>{workspace.historyError}</span><button disabled={disabled || workspace.busy} onClick={() => void workspace.refreshHistory()}>Retry request history</button></div>}
      {!workspace.hasApiKey && <button className="general-chat-connect" onClick={onSettings}>Connect DeepSeek</button>}
    </div>
    {contextControl}
    {scopeLabel&&<div className="agent-inline-scope">{scopeLabel}</div>}
    <form className="general-chat-composer" onSubmit={event => { event.preventDefault(); if (disabled) return; atEnd.current = true; void (onSend?onSend():workspace.send()) }}>
      <textarea aria-label="General chat question" rows={2} placeholder="Ask a question or give your library a task…" value={workspace.draft} disabled={disabled || !workspace.ready} onChange={event => workspace.setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!disabled && workspace.ready && !workspace.busy && workspace.draft.trim()) { atEnd.current = true; void (onSend?onSend():workspace.send()) } } }}/>
      {inputControls}
      {workspace.busy ? <button className="general-chat-cancel" type="button" aria-label="Cancel general response" title="Cancel response" onClick={() => void workspace.cancel().catch(() => undefined)}><Square size={14}/></button> : <button className="general-chat-send" type="submit" aria-label="Send general question" disabled={disabled || !workspace.ready || !workspace.draft.trim()} title="Send question"><ArrowUp size={19}/></button>}
      <small>Enter to send · Shift + Enter for a new line</small>
    </form>
    <p className="general-chat-disclosure">Questions and recent chat are sent to DeepSeek when you send. AI answers may contain errors.</p>
  </section>
}

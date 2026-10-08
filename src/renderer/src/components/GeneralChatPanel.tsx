import { useEffect, useRef } from 'react'
import { ArrowUp, MessageCircle, Settings, Square, Sparkles } from 'lucide-react'
import type { GeneralChatWorkspace } from '../useGeneralChat'
import MarkdownContent from './MarkdownContent'
import CopyAnswer from './CopyAnswer'
import RequestRetryButton from './RequestRetryButton'

export interface GeneralChatPanelProps { workspace: GeneralChatWorkspace; model?: string; onSettings?: () => void; disabled?: boolean }
export default function GeneralChatPanel({ workspace, model, onSettings = workspace.onSettings, disabled = false }: GeneralChatPanelProps) {
  const scroller = useRef<HTMLDivElement>(null), atEnd = useRef(true)
  const messages = workspace.state?.messages ?? []
  useEffect(() => { const element = scroller.current; if (element && atEnd.current) element.scrollTop = element.scrollHeight }, [messages.length, workspace.preview?.content])
  return <section className="general-chat-panel" aria-label="General DeepSeek chat">
    <header className="general-chat-header">
      <div><span className="general-chat-mark"><MessageCircle size={17}/></span><div><h2>A space to ask</h2><p>General chat · No paper context</p></div></div>
      <button className="icon-button" aria-label="Open DeepSeek settings" title="DeepSeek settings" onClick={onSettings}><Settings size={15}/></button>
    </header>
    <div className="general-chat-model"><span className={workspace.hasApiKey ? 'connected-dot' : 'offline-dot'}/>{workspace.hasApiKey ? model || 'DeepSeek' : 'Connection needed'}<span>Local conversation</span></div>
    <div className="general-chat-messages" role="log" aria-label="General conversation" aria-live="polite" ref={scroller} onScroll={() => { const element = scroller.current; if (element) atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 70 }}>
      {workspace.ready && !messages.length && <div className="general-chat-empty"><Sparkles size={23}/><h3>Start with a small question.</h3><p>Explore an idea, work through a problem,<br/>or think out loud with DeepSeek.</p><small>This conversation stays separate from your papers.</small></div>}
      {!workspace.ready && !workspace.error && <p className="general-chat-loading" role="status">Loading your conversation…</p>}
      {messages.map(message => {
        const record = workspace.recordForMessage(message.id)
        return <article key={message.id} className={`general-chat-message ${message.role}`} data-message-id={message.id}>
          <div className="general-chat-message-label"><strong>{message.role === 'user' ? 'You' : 'DeepSeek'}</strong>{record?.retryOf && <small>Retried round</small>}<time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
          {message.role === 'assistant' ? <MarkdownContent content={message.content}/> : <p className="general-chat-question">{message.content}</p>}
          <div className="general-chat-message-actions">
            {message.role === 'assistant' && <CopyAnswer content={message.content} copy={workspace.copyText}/>}
            {message.role === 'user' && (workspace.historyReady ? <RequestRetryButton record={record} messageId={message.id} disabled={disabled || !workspace.ready || workspace.busy || workspace.needsSave} onRetry={value => { atEnd.current = true; void workspace.retryRequest(value) }}/> : <small>{workspace.historyError ? 'Original requests unavailable' : 'Loading original request…'}</small>)}
          </div>
        </article>
      })}
      {workspace.preview && <article className="general-chat-message assistant general-chat-preview" aria-label="General response preview"><div className="general-chat-message-label"><strong>DeepSeek</strong><small>Receiving · not saved</small></div>{workspace.preview.content ? <MarkdownContent content={workspace.preview.content}/> : <p>Waiting for response…</p>}</article>}
    </div>
    <div className="general-chat-feedback">
      <span role="status">{workspace.status}</span>
      {workspace.error && <p role="alert">{workspace.error}</p>}
      {workspace.error && !workspace.ready && <button aria-label="Retry general chat loading" disabled={disabled} onClick={() => void workspace.retryLoad()}>Retry loading</button>}
      {workspace.needsSave && <button aria-label="Retry saving general chat" disabled={disabled || workspace.busy} onClick={() => void workspace.flush().catch(() => undefined)}>Retry saving</button>}
      {workspace.historyError && <div className="general-chat-history-error"><span>{workspace.historyError}</span><button disabled={disabled || workspace.busy} onClick={() => void workspace.refreshHistory()}>Retry request history</button></div>}
      {!workspace.hasApiKey && <button className="general-chat-connect" onClick={onSettings}>Connect DeepSeek</button>}
    </div>
    <form className="general-chat-composer" onSubmit={event => { event.preventDefault(); if (disabled) return; atEnd.current = true; void workspace.send() }}>
      <textarea aria-label="General chat question" rows={2} placeholder="Ask a question, no paper needed…" value={workspace.draft} disabled={disabled || !workspace.ready} onChange={event => workspace.setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!disabled && workspace.ready && !workspace.busy && workspace.draft.trim()) { atEnd.current = true; void workspace.send() } } }}/>
      {workspace.busy ? <button className="general-chat-cancel" type="button" aria-label="Cancel general response" title="Cancel response" onClick={() => void workspace.cancel().catch(() => undefined)}><Square size={14}/></button> : <button className="general-chat-send" type="submit" aria-label="Send general question" disabled={disabled || !workspace.ready || !workspace.draft.trim()} title="Send question"><ArrowUp size={19}/></button>}
      <small>Enter to send · Shift + Enter for a new line</small>
    </form>
    <p className="general-chat-disclosure">Questions and recent chat are sent to DeepSeek when you send. AI answers may contain errors.</p>
  </section>
}

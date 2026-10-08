import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { ChatMessage } from '../../../shared/types'
import { CONVERSATION_QUERY_LIMIT, searchConversation, selectConversationMatch, type ConversationSearchResult } from '../conversationSearch'
import './conversationTools.css'

export interface ConversationSearchProps {
  paperId: string
  messages: ChatMessage[]
  disabled: boolean
  onNavigate(messageId: string): void
  onActiveChange?(active: boolean): void
}
interface SearchSnapshot { paperId: string; query: string; messages: ChatMessage[]; result: ConversationSearchResult | null; error: string }

export default function ConversationSearch({ paperId, messages, disabled, onNavigate, onActiveChange }: ConversationSearchProps) {
  const panelId = useId()
  const [scope, setScope] = useState({ paperId, open: false, query: '' })
  const [snapshot, setSnapshot] = useState<SearchSnapshot | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [submit, setSubmit] = useState(0)
  const selected = useRef<string | null>(null)
  const queryForSelection = useRef('')
  const immediate = useRef(false)
  const callbacks = useRef({ onNavigate, onActiveChange })
  callbacks.current = { onNavigate, onActiveChange }
  const toggle = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null)
  const open = scope.paperId === paperId && scope.open
  const query = scope.paperId === paperId ? scope.query : ''
  const live = useRef({ paperId, messages, query, open, disabled })
  live.current = { paperId, messages, query, open, disabled }
  const currentSnapshot = snapshot?.paperId === paperId && snapshot.query === query && snapshot.messages === messages ? snapshot : null
  const matches = currentSnapshot?.result?.matches ?? []
  const busy = open && !disabled && Boolean(query.trim()) && !currentSnapshot
  const currentIndex = matches.findIndex(match => match.messageId === selectedId)

  useEffect(() => {
    setScope({ paperId, open: false, query: '' }); setSnapshot(null); setSelectedId(null)
    selected.current = null; queryForSelection.current = ''; immediate.current = false
  }, [paperId])
  useEffect(() => {
    callbacks.current.onActiveChange?.(open)
    if (open) input.current?.focus()
    return () => { if (open) callbacks.current.onActiveChange?.(false) }
  }, [open])
  useEffect(() => {
    setSnapshot(null)
    if (!open || disabled || !query.trim()) return
    const controller = new AbortController()
    const delay = immediate.current ? 0 : 180
    immediate.current = false
    const timer = setTimeout(() => {
      void searchConversation({ paperId, messages, query, signal: controller.signal }).then(result => {
        const current = live.current
        if (controller.signal.aborted || !current.open || current.disabled || current.paperId !== paperId || current.messages !== messages || current.query !== query) return
        const previousId = selected.current
        const match = selectConversationMatch(result.matches, previousId, 0)
        const shouldNavigate = match && (match.messageId !== previousId || queryForSelection.current !== query)
        selected.current = match?.messageId ?? null; setSelectedId(selected.current)
        queryForSelection.current = query
        setSnapshot({ paperId, query, messages, result, error: '' })
        if (shouldNavigate) callbacks.current.onNavigate(match.messageId)
      }).catch(error => {
        const current = live.current
        if (!controller.signal.aborted && current.open && !current.disabled && current.paperId === paperId && current.messages === messages && current.query === query) setSnapshot({ paperId, query, messages, result: null, error: error instanceof Error ? error.message : 'Conversation search could not finish. Try again.' })
      })
    }, delay)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, disabled, paperId, messages, query, submit])

  function close() {
    live.current.open = false
    setScope({ paperId, open: false, query: '' }); setSnapshot(null); setSelectedId(null)
    selected.current = null; queryForSelection.current = ''
    toggle.current?.focus()
  }
  function navigate(direction: -1 | 1) {
    if (disabled || busy) return
    const match = selectConversationMatch(matches, selected.current, direction)
    if (!match) return
    selected.current = match.messageId; setSelectedId(match.messageId); callbacks.current.onNavigate(match.messageId)
  }
  const status = disabled ? 'Conversation search is temporarily unavailable.'
    : !query.trim() ? messages.some(message => message.paperId === paperId) ? 'Search questions and completed answers in this paper.' : 'No messages yet. Ask a question to start this conversation.'
      : busy ? 'Searching this conversation…'
        : currentSnapshot?.error || `${matches.length} matching ${matches.length === 1 ? 'message' : 'messages'}${matches.length && currentIndex >= 0 ? ` · ${currentIndex + 1} of ${matches.length}` : ''}`

  return <div className={`conversation-tools${open ? ' expanded' : ''}`} onKeyDown={event => { if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
    <button ref={toggle} type="button" className="conversation-search-toggle" aria-label="Search conversation" aria-expanded={open} aria-controls={panelId} disabled={disabled && !open} onClick={() => { if (open) close(); else setScope({ paperId, open: true, query: '' }) }}><Search size={12}/>Find in chat</button>
    {open && <div id={panelId} className="conversation-search-panel">
      <form className="conversation-search-form" onSubmit={event => { event.preventDefault(); if (disabled) return; if (matches.length && !busy) navigate(1); else { immediate.current = true; setSubmit(value => value + 1) } }}>
        <input ref={input} type="text" aria-label="Conversation search" placeholder="Find a question or answer…" maxLength={CONVERSATION_QUERY_LIMIT} value={query} disabled={disabled} onChange={event => { live.current.query = event.target.value; setScope({ paperId, open: true, query: event.target.value }) }}/>
        <button type="button" aria-label="Previous conversation result" title="Previous result" disabled={disabled || busy || !matches.length} onClick={() => navigate(-1)}><ChevronUp size={14}/></button>
        <button type="button" aria-label="Next conversation result" title="Next result" disabled={disabled || busy || !matches.length} onClick={() => navigate(1)}><ChevronDown size={14}/></button>
        <button type="button" aria-label="Close conversation search" title="Close search" onClick={close}><X size={13}/></button>
      </form>
      <p className="conversation-search-status" role="status">{status}</p>
      {!disabled && matches.length > 0 && <div className="conversation-search-results" aria-label="Conversation matches">{matches.map((match, index) => <button key={match.messageId} type="button" className={`conversation-search-result${match.messageId === selectedId ? ' selected' : ''}`} aria-current={match.messageId === selectedId ? 'true' : undefined} aria-label={`${match.role === 'assistant' ? 'Assistant' : 'You'} conversation result ${index + 1}: ${match.snippet}`} data-message-id={match.messageId} onClick={() => { selected.current = match.messageId; setSelectedId(match.messageId); callbacks.current.onNavigate(match.messageId) }}><strong>{match.role === 'assistant' ? 'Assistant' : 'You'}</strong><span>{match.snippet}</span></button>)}</div>}
    </div>}
  </div>
}

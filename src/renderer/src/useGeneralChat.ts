import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { AIRequestHistory, AIRequestRecord, DesktopAPI } from '../../shared/types'
import { GeneralChatSession, type GeneralChatOptions, type GeneralChatSnapshot } from './generalChatSession'
import { useAIRequestHistory } from './useAIRequestHistory'

export interface GeneralChatWorkspace extends GeneralChatSnapshot {
  hasApiKey: boolean
  needsSave: boolean
  onSettings: () => void
  setDraft: (value: string) => void
  send: () => Promise<void>
  cancel: () => Promise<void>
  flush: () => Promise<void>
  prepareToLeave: () => Promise<void>
  retryLoad: () => Promise<void>
  retryRequest: (record: AIRequestRecord) => Promise<void>
  copyText: (value: string) => Promise<void>
  history: AIRequestHistory | null
  historyReady: boolean
  historyError: string | null
  refreshHistory: () => Promise<void>
  recordForMessage: (messageId: string) => AIRequestRecord | undefined
}

/** Keep this mounted across Welcome/paper changes; the root awaits prepareToLeave before navigation. */
export default function useGeneralChat(api: DesktopAPI, options: GeneralChatOptions): GeneralChatWorkspace {
  const session = useMemo(() => new GeneralChatSession(api, options), [api])
  session.setOptions(options)
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  const requests = useAIRequestHistory(api, snapshot.ready && snapshot.state ? { scope: 'general', conversationId: snapshot.state.conversationId } : null)
  useEffect(() => {
    const unsubscribe = api.onGeneralAIProgress(event => session.receiveProgress(event))
    void session.load()
    return () => { unsubscribe(); void session.prepareToLeave().catch(() => undefined) }
  }, [api, session])
  useEffect(() => { if (snapshot.ready && !snapshot.busy) void requests.refresh() }, [snapshot.ready, snapshot.busy, snapshot.state?.messages.length, requests.refresh])
  return {
    ...snapshot, hasApiKey: options.hasApiKey, needsSave: session.needsSave, onSettings: options.onSettings,
    setDraft: session.setDraft, send: session.send, cancel: session.cancel, flush: () => session.flush(),
    prepareToLeave: session.prepareToLeave, retryLoad: session.retryLoad, retryRequest: session.retryRequest,
    copyText: value => api.copyText(value), history: requests.history, historyReady: requests.ready,
    historyError: requests.error, refreshHistory: requests.refresh, recordForMessage: requests.recordForMessage
  }
}

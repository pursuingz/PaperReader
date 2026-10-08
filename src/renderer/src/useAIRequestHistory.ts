import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AIRequestHistory, AIRequestOwner } from '../../shared/requestTypes'
import type { DesktopAPI } from '../../shared/types'
import { recordForMessage, requestHistoryOwnerKey, RequestHistorySession } from './requestHistorySession'

export function useAIRequestHistory(api: Pick<DesktopAPI, 'loadAIRequests'>, owner: AIRequestOwner | null) {
  const session = useMemo(() => new RequestHistorySession(api), [api])
  const key = requestHistoryOwnerKey(owner), scope = useMemo(() => owner ? structuredClone(owner) : null, [key])
  const latest = useRef({ session, key, scope, epoch: 0 }); latest.current.session = session; latest.current.key = key; latest.current.scope = scope
  const [state, setState] = useState<{ key: string; ready: boolean; history: AIRequestHistory | null; error: string | null }>({ key: '', ready: false, history: null, error: null })
  const refresh = useCallback(async () => {
    const context = latest.current, token = ++context.epoch, currentSession = context.session, currentKey = context.key, currentScope = context.scope
    const current = () => latest.current.epoch === token && latest.current.session === currentSession && latest.current.key === currentKey
    setState({ key: currentKey, ready: false, history: null, error: null })
    try { const history = await currentSession.open(currentScope); if (current()) setState({ key: currentKey, ready: currentSession.ready, history, error: null }) }
    catch (error) { if (current()) setState({ key: currentKey, ready: false, history: null, error: error instanceof Error ? error.message : 'Saved original requests are unavailable.' }) }
  }, [])
  useEffect(() => { void refresh(); return () => { latest.current.epoch++; session.close() } }, [session, key, refresh])
  const shown = state.key === key ? state : { ready: false, history: null, error: null }
  return { ...shown, refresh, recordForMessage: (messageId: string) => recordForMessage(shown.history, messageId) }
}
export default useAIRequestHistory

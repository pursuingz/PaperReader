import type { AIProgress } from '../../shared/types'

export interface StreamPreview { requestId: string; paperId: string; attempt: 1 | 2; content: string }
export interface StreamIdentity { requestId: string | null; paperId: string | null; loaded: boolean }

export function updateStreamPreview(previous: StreamPreview | null, event: AIProgress, active: StreamIdentity): StreamPreview | null {
  if (!active.loaded || !active.requestId || event.requestId !== active.requestId || event.paperId !== active.paperId || ![1, 2].includes(event.attempt)) return previous
  const sameRequest = previous?.requestId === event.requestId && previous.paperId === event.paperId
  if (event.type === 'reset') {
    if (sameRequest && previous.attempt >= event.attempt) return previous
    return { requestId: event.requestId, paperId: event.paperId, attempt: event.attempt, content: '' }
  }
  if (!sameRequest || previous.attempt !== event.attempt || typeof event.content !== 'string' || previous.content.length + event.content.length > 200_000) return previous
  return { ...previous, content: previous.content + event.content }
}

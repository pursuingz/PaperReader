import type { AIRequestRecord } from '../../../shared/requestTypes'
export interface RequestRetryButtonProps { record?: AIRequestRecord; onRetry: (record: AIRequestRecord) => void; disabled?: boolean; messageId?: string }
export default function RequestRetryButton({ record, onRetry, disabled = false, messageId }: RequestRetryButtonProps) {
  if (!record) return <span className="request-retry" data-message-id={messageId}><button type="button" disabled title="This older message has no immutable request snapshot. Reuse its question to compose a new request.">Original request unavailable</button></span>
  const active = record.status === 'pending' || record.status === 'response-ready'
  return <span className="request-retry" data-request-id={record.requestId}>
    <button type="button" aria-label={`Retry original request ${record.requestId}`} disabled={disabled || active} onClick={() => onRetry(record)} title="Append a new round using the saved original model and sources. Your draft is preserved.">Retry original request</button>
    <small>{record.model} · {record.context.label}{record.context.page !== null ? ` · Page ${record.context.page}` : ''}{record.context.selectionCharacters ? ` · ${record.context.selectionCharacters} selected characters` : ''} · {record.status}{record.retryOf ? ' · Retried round' : ''}</small>
  </span>
}

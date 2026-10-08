import { useEffect, useId, useRef } from 'react'
import type { QuestionReuseReview as Review } from '../questionReuse'
import './questionReuseReview.css'

export default function QuestionReuseReview({ review, disabled, error, onReplace, onCancel }: {
  review: Review; disabled: boolean; error: string; onReplace(): void; onCancel(): void
}) {
  const title = useId(), dialog = useRef<HTMLElement>(null), cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancel.current?.focus()
    return () => { if (prior?.isConnected) prior.focus() }
  }, [])
  return <div className="question-reuse-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !disabled) onCancel() }}>
    <section ref={dialog} className="question-reuse-dialog" role="dialog" aria-modal="true" aria-labelledby={title} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); if (!disabled) onCancel() }
      if (event.key !== 'Tab') return
      const items = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
      if (!items?.length) { event.preventDefault(); return }
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus() }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus() }
    }}>
      <span className="eyebrow">CONTINUE A QUESTION</span><h2 id={title}>Keep or replace your draft?</h2>
      <p>Your composer already has an unsent question. Reuse fills it for editing; sending still uses the context you choose below.</p>
      <div className="question-reuse-comparison"><div><strong>Current draft</strong><pre>{review.originalDraft}</pre></div><div><strong>Question to reuse</strong><pre>{review.question}</pre></div></div>
      {error && <p className="question-reuse-error" role="alert">{error}</p>}
      <footer><button ref={cancel} className="secondary-button" aria-label="Cancel question reuse" disabled={disabled} onClick={onCancel}>Keep draft</button><button className="primary-button" aria-label="Replace draft" disabled={disabled} onClick={onReplace}>Replace draft</button></footer>
    </section>
  </div>
}

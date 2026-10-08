import { useRef, useState } from 'react'
import { pdfjs } from 'react-pdf'
import type { DesktopAPI, PaperSummary } from '../../shared/types'
import { extractAllPages } from './readingFeatures'
import { summaryFailureMessage } from './summaryFeedback'

export default function usePaperSummary(api: DesktopAPI, report: (message: string) => void) {
  const [value, setValue] = useState<PaperSummary | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const context = useRef<{ id: string | null; epoch: number }>({ id: null, epoch: 0 })
  const active = useRef<{ id: string; paperId: string; task: pdfjs.PDFDocumentLoadingTask | null } | null>(null)
  async function open(id: string | null) {
    const epoch = context.current.epoch + 1
    context.current = { id, epoch }; setValue(null); setReady(false); setBusy(false); setStatus('Loading saved summary…')
    if (!id) { setStatus(''); return }
    try { const saved = await api.loadSummary(id); if (context.current.epoch !== epoch) return; setValue(saved); setReady(true); setStatus('') }
    catch (error) { if (context.current.epoch !== epoch) return; setStatus('Saved summary unavailable. Retry to protect your previous summary.'); report(String(error)) }
  }
  async function cancel() {
    const request = active.current
    if (!request) return
    const epoch = context.current.epoch
    active.current = null; setBusy(true); setStatus('Cancelling summary…')
    await Promise.allSettled([api.cancelAI(request.id), request.task?.destroy() ?? Promise.resolve()])
    try {
      // A completed atomic save can win the race with Cancel. Show the actual
      // cache rather than promising that an earlier result was preserved.
      const saved = await api.loadSummary(request.paperId)
      if (context.current.epoch !== epoch || active.current) return
      setValue(saved); setStatus('Summary cancelled. Showing the latest saved result.')
    } catch (error) {
      if (context.current.epoch !== epoch || active.current) return
      setReady(false); setStatus('Saved summary unavailable. Retry to check the latest saved result.'); report(String(error))
    } finally { if (context.current.epoch === epoch && !active.current) setBusy(false) }
  }
  async function generate(id: string) {
    if (active.current || context.current.id !== id) return
    const request = { id: crypto.randomUUID(), paperId: id, task: null as pdfjs.PDFDocumentLoadingTask | null }
    active.current = request; setBusy(true); setStatus('Opening the full paper…')
    const isCurrent = () => active.current === request && context.current.id === id
    try {
      // React-PDF transfers bytes and destroys its worker when Reader unmounts.
      // Summary owns a fresh document so extraction is independent of the view.
      const bytes = await api.readPaper(id)
      if (!isCurrent()) return
      request.task = pdfjs.getDocument({ data: new Uint8Array(bytes) })
      const document = await request.task.promise
      const pages = await extractAllPages(document, isCurrent, (page, total) => { if (isCurrent()) setStatus(`Reading page ${page} of ${total}…`) })
      if (!isCurrent()) return
      setStatus('DeepSeek is preparing your summary. A cut-off response will be retried once…')
      const summary = await api.generateSummary({ requestId: request.id, paperId: id, pages })
      if (!isCurrent() || summary.paperId !== id) return
      setValue(summary); setStatus('Summary saved locally.')
    } catch (error) { if (isCurrent()) { const message = summaryFailureMessage(error, value !== null); setStatus(message); report(message) } }
    finally {
      if (isCurrent()) { active.current = null; setBusy(false) }
      await request.task?.destroy().catch(() => undefined)
    }
  }
  return { value, ready, busy, status, open, cancel, generate }
}

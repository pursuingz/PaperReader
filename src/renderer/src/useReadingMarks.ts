import { useEffect, useRef, useState } from 'react'
import type { DesktopAPI, Highlight, InkStroke, ReadingMarks } from '../../shared/types'
import { emptyMarks, ReadingMarksSession } from './readingFeatures'
import type { InkBounds, InkPoint } from './annotationEditing'

export default function useReadingMarks(api: DesktopAPI, report: (message: string) => void) {
  const session = useRef<ReadingMarksSession | null>(null)
  if (!session.current) session.current = new ReadingMarksSession(api)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadEpoch = useRef(0)
  const [value, setValue] = useState<ReadingMarks>(emptyMarks)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('Loading marks…')
  const [draft, setDraft] = useState<InkStroke | null>(null)
  const eraser = useRef<{ paperId: string; previous: InkPoint } | null>(null)
  function stopTimer() { if (timer.current) clearTimeout(timer.current); timer.current = null }
  function changed() {
    setValue(session.current!.value); setDraft(session.current!.draft); setStatus('Saving…'); stopTimer()
    timer.current = setTimeout(() => { timer.current = null; if (!eraser.current && !session.current!.draft) void flush().catch(() => undefined) }, 450)
  }
  function finishInk() { try { if (session.current!.finishInk()) changed() } catch (error) { report(String(error)) } }
  function finishEraseInk() { eraser.current = null; if (session.current!.finishEraseInk()) changed() }
  async function flush() {
    // Finalize in the session even when App has locked pointer controls for export/close.
    session.current!.finishInk(); session.current!.finishEraseInk(); eraser.current = null
    setValue(session.current!.value); setDraft(null)
    stopTimer()
    const store = session.current!, id = store.id
    try { await store.flush(); if (store.id === id && store.ready) setStatus('Saved locally') }
    catch (error) { if (store.id === id) setStatus('Save failed'); report(`Your reading marks could not be saved: ${String(error)}`); throw error }
  }
  async function open(id: string | null) {
    const epoch = ++loadEpoch.current
    stopTimer(); eraser.current = null; setDraft(null); setReady(false); setValue(emptyMarks()); setStatus('Loading marks…')
    const store = session.current!
    try { await store.open(id); if (loadEpoch.current !== epoch) return; setValue(store.value); setReady(store.ready); setStatus('Saved locally') }
    catch (error) { if (loadEpoch.current !== epoch) return; setStatus('Marks unavailable'); report(`Saved highlights and ink could not be loaded. Editing is disabled to protect your marks: ${String(error)}`) }
  }
  function update(next: ReadingMarks) {
    const rectangles = next.highlights.reduce((total, item) => total + item.rects.length, 0)
    const characters = next.highlights.reduce((total, item) => total + item.quote.length + item.comment.length, 0)
    if (rectangles > 20000 || characters > 2000000) { report('This paper has reached the reading marks size limit. Your existing marks are preserved.'); return }
    if (!session.current!.update(next)) return
    changed()
  }
  function beginInk(paperId: string, color: string, point: InkPoint) {
    if (eraser.current) return false
    try {
      const store = session.current!
      if (store.value.strokes.length >= 1000 || store.value.strokes.reduce((count, stroke) => count + stroke.points.length, 0) > 199998) throw new Error('This handwriting pad is full (1,000 strokes / 200,000 points). Existing ink is preserved.')
      if (!store.beginInk(paperId, { id: crypto.randomUUID(), color, points: [point], width: .004 })) return false
      stopTimer(); setDraft(store.draft); return true
    } catch (error) { report(String(error)); return false }
  }
  function inkPoint(point: InkPoint) { if (session.current!.inkPoint(point)) setDraft(session.current!.draft) }
  function beginEraseInk(paperId: string, point: InkPoint, bounds: InkBounds) {
    if (!session.current!.beginEraseInk(paperId)) return false
    eraser.current = { paperId, previous: point }
    if (session.current!.eraseInk(point, point, bounds)) changed()
    return true
  }
  function eraseInkPoint(point: InkPoint, bounds: InkBounds) {
    const gesture = eraser.current
    if (!gesture || session.current!.id !== gesture.paperId) return
    if (session.current!.eraseInk(gesture.previous, point, bounds)) changed()
    gesture.previous = point
  }
  const edit = (action: () => boolean) => { try { if (action()) changed() } catch (error) { report(String(error)) } }
  useEffect(() => () => { stopTimer(); eraser.current = null; void session.current!.flush().catch(() => undefined) }, [])
  return {
    value, ready, status, draft, open, update, flush, current: session,
    beginInk, inkPoint, finishInk, beginEraseInk, eraseInkPoint, finishEraseInk,
    undoInk: () => edit(() => session.current!.undoInk()), redoInk: () => edit(() => session.current!.redoInk()),
    canUndoInk: session.current.canUndoInk(), canRedoInk: session.current.canRedoInk(),
    setHighlightColor: (id: string, color: Highlight['color']) => edit(() => session.current!.setHighlightColor(id, color)),
    removeHighlight: (id: string) => edit(() => session.current!.removeHighlight(id)),
    undoHighlight: () => edit(() => session.current!.undoHighlight()), redoHighlight: () => edit(() => session.current!.redoHighlight()),
    canUndoHighlight: session.current.canUndoHighlight(), canRedoHighlight: session.current.canRedoHighlight()
  }
}

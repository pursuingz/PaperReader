import { useEffect, useRef, useState } from 'react'
import type { DesktopAPI, PdfInkStroke } from '../../shared/types'
import { PdfInkSession } from './readingWorkflow'
import type { InkBounds, InkPoint } from './annotationEditing'

export default function usePdfInk(api: DesktopAPI, report: (message: string) => void) {
  const session = useRef<PdfInkSession | null>(null)
  if (!session.current) session.current = new PdfInkSession(api)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const epoch = useRef(0)
  const active = useRef<{ paperId: string; stroke: PdfInkStroke } | null>(null)
  const eraser = useRef<{ paperId: string; previous: InkPoint } | null>(null)
  const [draft, setDraft] = useState<PdfInkStroke | null>(null)
  const [value, setValue] = useState(session.current.value)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('Loading PDF ink…')
  const stopTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  function changed() {
    setValue(session.current!.value); setStatus('Saving…'); stopTimer()
    timer.current = setTimeout(() => { timer.current = null; if (!eraser.current && !active.current) void flush().catch(() => undefined) }, 450)
  }
  function finish() {
    eraser.current = null
    if (session.current!.finishErase()) changed()
    const drawing = active.current
    active.current = null; setDraft(null)
    if (!drawing || session.current!.id !== drawing.paperId) return
    if (drawing.stroke.points.length === 1) drawing.stroke.points.push({ ...drawing.stroke.points[0] })
    if (session.current!.add(drawing.stroke)) changed()
  }
  async function flush() {
    finish(); stopTimer()
    const store = session.current!, id = store.id
    try { await store.flush(); if (store.id === id && store.ready) setStatus('Saved locally') }
    catch (error) { if (store.id === id) setStatus('Save failed'); report(`PDF ink could not be saved: ${String(error)}`); throw error }
  }
  async function open(id: string | null) {
    const token = ++epoch.current
    stopTimer(); active.current = null; eraser.current = null; setDraft(null); setReady(false); setValue({ strokes: [] }); setStatus('Loading PDF ink…')
    const store = session.current!
    try { await store.open(id); if (token !== epoch.current) return; setReady(store.ready); setValue(store.value); setStatus('Saved locally') }
    catch (error) { if (token !== epoch.current) return; setStatus('PDF ink unavailable'); report(`Saved PDF ink could not be loaded. Drawing is disabled to protect it: ${String(error)}`) }
  }
  function begin(paperId: string, page: number, color: string, point: { x: number; y: number }) {
    const store = session.current!
    if (active.current || eraser.current || store.id !== paperId || !store.ready) return false
    if (store.value.strokes.length >= 1000 || store.value.strokes.reduce((total, stroke) => total + stroke.points.length, 0) > 199998) { report('PDF drawing is full (1,000 strokes / 200,000 points). Existing ink is preserved.'); return false }
    const stroke = { id: crypto.randomUUID(), page, color, points: [point], width: .004 }
    stopTimer(); active.current = { paperId, stroke }; setDraft({ ...stroke }); return true
  }
  function point(point: { x: number; y: number }) {
    const drawing = active.current
    if (!drawing) return
    const points = drawing.stroke.points, previous = points.at(-1)!
    if (Math.hypot(point.x - previous.x, point.y - previous.y) < .0015 || points.length >= 10000 || session.current!.value.strokes.reduce((total, stroke) => total + stroke.points.length, points.length) >= 200000) return
    points.push(point); setDraft({ ...drawing.stroke })
  }
  function beginErase(paperId: string, page: number, point: InkPoint, bounds: InkBounds) {
    const store = session.current!
    if (active.current || eraser.current || store.id !== paperId || !store.beginErase(page)) return false
    eraser.current = { paperId, previous: point }
    if (store.erase(point, point, bounds)) changed()
    return true
  }
  function erasePoint(point: InkPoint, bounds: InkBounds) {
    const gesture = eraser.current
    if (!gesture || session.current!.id !== gesture.paperId) return
    if (session.current!.erase(gesture.previous, point, bounds)) changed()
    gesture.previous = point
  }
  function undo(page: number) { if (active.current || eraser.current) return; try { if (session.current!.undo(page)) changed() } catch (error) { report(String(error)) } }
  function redo(page: number) { if (active.current || eraser.current) return; try { if (session.current!.redo(page)) changed() } catch (error) { report(String(error)) } }
  useEffect(() => () => { stopTimer(); const drawing = active.current; if (drawing && session.current!.id === drawing.paperId) { if (drawing.stroke.points.length === 1) drawing.stroke.points.push({ ...drawing.stroke.points[0] }); session.current!.add(drawing.stroke) } active.current = null; void session.current!.flush().catch(() => undefined) }, [])
  return { value, ready, status, draft, open, flush, begin, point, finish, beginErase, erasePoint, undo, redo, canUndo: (page: number) => session.current!.canUndo(page), canRedo: (page: number) => session.current!.canRedo(page) }
}

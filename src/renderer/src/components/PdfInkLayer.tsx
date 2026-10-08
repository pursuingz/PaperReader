import { useEffect, useRef } from 'react'
import type { PdfInkStroke } from '../../../shared/types'
import { normalizedPoint } from '../readingFeatures'
import type { InkBounds } from '../annotationEditing'

export interface PdfInkLayerProps {
  page: number; strokes: PdfInkStroke[]; draft: PdfInkStroke | null; drawing: boolean; erasing?: boolean
  onBegin(point: { x: number; y: number }, bounds: InkBounds): boolean
  onPoint(point: { x: number; y: number }, bounds: InkBounds): void
  onFinish(): void
}
export default function PdfInkLayer({ page, strokes, draft, drawing, erasing, onBegin, onPoint, onFinish }: PdfInkLayerProps) {
  const pointer = useRef<number | null>(null)
  const finishRef = useRef(onFinish); finishRef.current = onFinish
  // A page or view change completes the stroke against the page where it began.
  useEffect(() => () => { if (pointer.current !== null) { pointer.current = null; finishRef.current() } }, [page])
  useEffect(() => { if (!drawing && pointer.current !== null) { pointer.current = null; onFinish() } }, [drawing, onFinish])
  const finish = (event: React.PointerEvent<SVGSVGElement>) => {
    if (pointer.current !== event.pointerId) return
    pointer.current = null; onFinish()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <svg className={`pdf-ink-layer ${drawing ? 'drawing' : ''} ${erasing ? 'erasing' : ''}`} role="img" aria-label="PDF drawing canvas" viewBox="0 0 1000 1000" preserveAspectRatio="none"
    onPointerDown={event => {
      if (!drawing || pointer.current !== null || event.button !== 0) return
      const bounds = event.currentTarget.getBoundingClientRect()
      const point = normalizedPoint(event.clientX, event.clientY, bounds)
      if (!onBegin(point, bounds)) return
      event.preventDefault(); event.stopPropagation(); pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId)
    }} onPointerMove={event => {
      if (pointer.current !== event.pointerId) return
      event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); onPoint(normalizedPoint(event.clientX, event.clientY, bounds), bounds)
    }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
    {[...strokes.filter(stroke => stroke.page === page), ...(draft?.page === page ? [draft] : [])].map(stroke => <path key={stroke.id} d={stroke.points.map((point, index) => `${index ? 'L' : 'M'}${point.x * 1000},${point.y * 1000}`).join(' ')} fill="none" stroke={stroke.color} strokeWidth={stroke.width * 1000} strokeLinecap="round" strokeLinejoin="round"/>)}
  </svg>
}

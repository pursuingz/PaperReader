import { useEffect, useRef, useState } from 'react'
import { Eraser, PenLine, Redo2, Undo2 } from 'lucide-react'
import type { InkStroke } from '../../../shared/types'
import type { InkBounds, InkPoint } from '../annotationEditing'
import { normalizedPoint } from '../readingFeatures'
import '../annotation-tools.css'

const colors = [{ name: 'Slate', value: '#334155' }, { name: 'Coral', value: '#ed6376' }, { name: 'Mint', value: '#4b8f82' }]
const path = (stroke: InkStroke) => stroke.points.map((point, index) => `${index ? 'L' : 'M'}${point.x * 1000},${point.y * 1200}`).join(' ')
export interface InkPadProps {
  strokes: InkStroke[]; disabled: boolean; draft: InkStroke | null
  onBegin(color: string, point: InkPoint): boolean; onPoint(point: InkPoint): void; onFinish(): void
  onEraseBegin(point: InkPoint, bounds: InkBounds): boolean; onErasePoint(point: InkPoint, bounds: InkBounds): void; onEraseFinish(): void
  onUndo(): void; onRedo(): void; canUndo: boolean; canRedo: boolean
}
export default function InkPad(props: InkPadProps) {
  const { strokes, disabled, draft } = props
  const [color, setColor] = useState(colors[0].value)
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen')
  const pointer = useRef<{ id: number; tool: 'pen' | 'eraser' } | null>(null)
  const latest = useRef(props); latest.current = props
  const complete = () => {
    const active = pointer.current; pointer.current = null
    if (active?.tool === 'pen') latest.current.onFinish()
    if (active?.tool === 'eraser') latest.current.onEraseFinish()
  }
  useEffect(() => complete, [])
  useEffect(() => { if (disabled) complete() }, [disabled])
  const finish = (event: React.PointerEvent<SVGSVGElement>) => {
    if (pointer.current?.id !== event.pointerId) return
    complete()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div className="ink-panel"><div className="ink-toolbar">
    <button className={`ink-tool ${tool === 'pen' ? 'selected' : ''}`} disabled={disabled} aria-label="Draw note ink" aria-pressed={tool === 'pen'} onClick={() => { complete(); setTool('pen') }}><PenLine size={13}/>Pen</button>
    <button className={`ink-tool ${tool === 'eraser' ? 'selected' : ''}`} disabled={disabled} aria-label="Erase note strokes" aria-pressed={tool === 'eraser'} title="Erase whole strokes" onClick={() => { complete(); setTool('eraser') }}><Eraser size={13}/>Eraser</button>
    <div className="ink-colors">{colors.map(item => <button key={item.value} style={{ '--pen-color': item.value } as React.CSSProperties} className={color === item.value && tool === 'pen' ? 'selected' : ''} disabled={disabled} aria-label={`${item.name} pen`} aria-pressed={color === item.value && tool === 'pen'} onClick={() => { complete(); setColor(item.value); setTool('pen') }}/>)}</div>
    <button className="icon-button" aria-label="Undo ink stroke" disabled={disabled || !props.canUndo || !!draft} onClick={props.onUndo}><Undo2 size={15}/></button><button className="icon-button" aria-label="Redo ink stroke" disabled={disabled || !props.canRedo || !!draft} onClick={props.onRedo}><Redo2 size={15}/></button></div>
    <div className="ink-scroll"><svg className={`ink-canvas ${disabled ? 'disabled' : ''} ${tool === 'eraser' ? 'erasing' : ''}`} role="img" aria-label="Handwriting pad" viewBox="0 0 1000 1200" onPointerDown={event => {
      if (disabled || pointer.current || event.button !== 0) return
      const bounds = event.currentTarget.getBoundingClientRect(), point = normalizedPoint(event.clientX, event.clientY, bounds)
      const started = tool === 'pen' ? props.onBegin(color, point) : props.onEraseBegin(point, bounds)
      if (!started) return
      event.preventDefault(); pointer.current = { id: event.pointerId, tool }; event.currentTarget.setPointerCapture(event.pointerId)
    }} onPointerMove={event => {
      const active = pointer.current
      if (!active || active.id !== event.pointerId) return
      const bounds = event.currentTarget.getBoundingClientRect(), point = normalizedPoint(event.clientX, event.clientY, bounds)
      if (active.tool === 'pen') props.onPoint(point)
      else props.onErasePoint(point, bounds)
    }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      {[...strokes, ...(draft ? [draft] : [])].map(stroke => <path key={stroke.id} d={path(stroke)} fill="none" stroke={stroke.color} strokeWidth={stroke.width * 1000} strokeLinecap="round" strokeLinejoin="round"/>)}
    </svg>{strokes.length === 0 && !draft && <div className="ink-hint"><PenLine size={23}/><p>A little room to think by hand.</p><small>Draw with your mouse, pen or touch.</small></div>}</div><div className="ink-caption">{disabled ? 'Saved ink must load before drawing.' : tool === 'eraser' ? 'Eraser removes whole strokes · Undo restores a gesture' : 'One pad per paper · Ink saves automatically'}</div>
  </div>
}

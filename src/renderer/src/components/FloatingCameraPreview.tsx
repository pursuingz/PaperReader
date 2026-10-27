import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Grip, HelpCircle, X } from 'lucide-react'
import type { CameraInputState } from '../localCameraSession'
import { constrainCameraBox, initialCameraBox, moveCameraBox, resizeCameraBox, type CameraBox } from '../cameraGeometry'
import { GestureGuide } from './GestureGuide'
import './FloatingCameraPreview.css'

interface Props {
  open: boolean
  videoRef: RefObject<HTMLVideoElement | null>
  state: CameraInputState
  guideOpen: boolean
  voiceReady: boolean
  suspended: boolean
  onGuideChange(open: boolean): void
  onInteractionChange(active: boolean): void
  onClose(): void
}
const viewport = () => ({ width: Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth), height: window.innerHeight })
export function FloatingCameraPreview(props: Props) {
  const latest = useRef(props); latest.current = props
  const [box, setBox] = useState(() => initialCameraBox(typeof window === 'undefined' ? { width: 1000, height: 700 } : viewport()))
  const [interacting, setInteracting] = useState(false)
  const currentBox = useRef(box); currentBox.current = box
  const interaction = useRef<{ kind: 'move' | 'resize'; box: CameraBox; x: number; y: number; pointerId: number; element: HTMLElement } | null>(null)
  function finishInteraction() {
    const active = interaction.current
    if (!active) return
    interaction.current = null
    if (active.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId)
    setInteracting(false); latest.current.onInteractionChange(false)
  }
  useEffect(() => {
    const resize = () => { finishInteraction(); setBox(value => constrainCameraBox(value, viewport())) }
    const blur = () => finishInteraction()
    window.addEventListener('resize', resize); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('blur', blur); if (interaction.current) latest.current.onInteractionChange(false) }
  }, [])
  useEffect(() => { if (!props.open) finishInteraction(); else setBox(value => constrainCameraBox(value, viewport())) }, [props.open])
  function begin(event: PointerEvent<HTMLElement>, kind: 'move' | 'resize') {
    if (event.button !== 0 || props.guideOpen) return
    event.preventDefault()
    interaction.current = { kind, box: currentBox.current, x: event.clientX, y: event.clientY, pointerId: event.pointerId, element: event.currentTarget }
    event.currentTarget.setPointerCapture(event.pointerId)
    setInteracting(true); props.onInteractionChange(true)
  }
  function move(event: PointerEvent<HTMLElement>) {
    const active = interaction.current
    if (!active || active.pointerId !== event.pointerId) return
    const transform = active.kind === 'move' ? moveCameraBox : resizeCameraBox
    setBox(transform(active.box, event.clientX - active.x, event.clientY - active.y, viewport()))
  }
  const state = props.state.phase === 'loading' ? 'Loading local hand model…' : props.state.phase === 'error' ? 'Camera unavailable' : props.guideOpen || interacting || props.suspended ? 'Gestures paused' : props.state.phase === 'active' ? 'Local hand tracking on' : 'Opening camera…'
  if (typeof document === 'undefined') return null
  return createPortal(<>
    <section className={`floating-camera ${interacting ? 'is-interacting' : ''}`} aria-label="Local camera preview" hidden={!props.open} style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>
      <header className="floating-camera-titlebar">
        <button type="button" className="floating-camera-move" aria-label="Move camera preview" title="Drag to move · arrow keys also move the preview" onPointerDown={event => begin(event, 'move')} onPointerMove={move} onPointerUp={finishInteraction} onPointerCancel={finishInteraction} onLostPointerCapture={finishInteraction} onKeyDown={event => {
          const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
          if (!direction) return
          event.preventDefault(); props.onInteractionChange(true)
          setBox(value => moveCameraBox(value, direction[0] * (event.shiftKey ? 30 : 10), direction[1] * (event.shiftKey ? 30 : 10), viewport()))
          props.onInteractionChange(false)
        }}><Grip size={13}/><Camera size={13}/><span>Camera</span></button>
        <button type="button" className="floating-camera-icon" aria-label="Open gesture guide" title="Gesture guide" onClick={() => props.onGuideChange(true)}><HelpCircle size={15}/></button>
        <button type="button" className="floating-camera-icon" aria-label="Close camera preview" title="Stop camera and hand tracking" onClick={props.onClose}><X size={15}/></button>
      </header>
      <div className="floating-camera-frame"><video ref={props.videoRef} className="floating-camera-video" muted playsInline aria-label="Mirrored camera preview"/>{props.state.error && <p className="floating-camera-error" role="alert">{props.state.error}</p>}</div>
      <footer className="floating-camera-status" role="status"><span className={props.state.phase === 'active' ? 'is-active' : ''}/>{state}</footer>
      <button type="button" className="floating-camera-resize" aria-label="Resize camera preview" title="Drag to resize · arrow keys also resize the preview" onPointerDown={event => begin(event, 'resize')} onPointerMove={move} onPointerUp={finishInteraction} onPointerCancel={finishInteraction} onLostPointerCapture={finishInteraction} onKeyDown={event => {
        const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
        if (!direction) return
        event.preventDefault(); props.onInteractionChange(true)
        setBox(value => resizeCameraBox(value, direction[0] * 10, direction[1] * 10, viewport()))
        props.onInteractionChange(false)
      }}><span/></button>
    </section>
    {props.open && props.guideOpen && <GestureGuide voiceReady={props.voiceReady} onClose={() => props.onGuideChange(false)}/>}
  </>, document.body)
}


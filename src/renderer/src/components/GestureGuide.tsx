import { useEffect, useId, useRef } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Mic, Send, X } from 'lucide-react'

export function GestureGuide({ voiceReady, onClose }: { voiceReady: boolean; onClose(): void }) {
  const dialog = useRef<HTMLElement>(null)
  const title = useId()
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return <div className="camera-guide-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} className="camera-guide" role="dialog" aria-modal="true" aria-labelledby={title} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <header><div><small>LOCAL CAMERA · MIRRORED PREVIEW</small><h2 id={title}>Read with your hands.</h2></div><button type="button" aria-label="Close gesture guide" onClick={onClose}><X size={18}/></button></header>
      <p className="camera-guide-intro">First briefly show your whole open hand upright, then point in the direction you see in the mirrored preview. Page and scroll gestures control the PDF Reader.</p>
      <ol className="camera-guide-actions">
        <li><span><ArrowRight size={18}/></span><div><strong>Previous page</strong><p>Point your index finger right in the preview, tuck your thumb and other fingers, and hold still for about 0.6 seconds.</p></div></li>
        <li><span><ArrowLeft size={18}/></span><div><strong>Next page</strong><p>Point your index finger left in the preview, tuck your thumb and other fingers, and hold still for about 0.6 seconds.</p></div></li>
        <li><span><ArrowUp size={18}/></span><div><strong>Scroll up</strong><p>Point your index finger up, tuck your thumb and other fingers, and hold still for about 0.6 seconds.</p></div></li>
        <li><span><ArrowDown size={18}/></span><div><strong>Scroll down</strong><p>Point your index finger down, tuck your thumb and other fingers, and hold still for about 0.6 seconds.</p></div></li>
        <li><span><Mic size={18}/></span><div><strong>Start recording</strong><p>Back of hand toward the camera. Extend only your thumb visibly away from the side of your hand, fold the other four fingers, and hold for about 0.7 seconds. A slight natural bend at the thumb tip is fine.</p></div></li>
        <li><span><Send size={18}/></span><div><strong>Finish transcription and send</strong><p>While recording, face the back of your hand toward the camera. Extend thumb + index with your thumb visibly away from the side of your hand, fold the other three fingers, and hold for about 1 second. A slight natural bend at the thumb tip is fine. The final local transcript sends once.</p></div></li>
      </ol>
      <div className="camera-guide-notes"><p>Each held pose acts once. Relax your hand for at least 0.25 seconds before repeating; actions have a 0.9-second cooldown. Keep your whole hand in view with steady light and point across the screen, with your finger visible from the side. If pointing down is missed, briefly show your open hand upright to restore tracking, then point down.</p><p>{voiceReady ? 'The local voice model is ready. Use the microphone button to stop to draft without sending.' : 'Prepare the offline voice model in the input controls before using voice gestures. Page and scroll gestures work independently.'}</p><p>Video and hand tracking stay on this device. Gestures pause while any dialog is open or while you move or resize the preview.</p></div>
      <footer><span>Closing this guide resumes gestures.</span><button type="button" className="camera-guide-primary" onClick={onClose}>Start using gestures</button></footer>
    </section>
  </div>
}


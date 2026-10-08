import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { version } from '../../../../package.json'

export default function AppHelpDialog({ mode, onClose }: { mode: 'guide' | 'about'; onClose(): void }) {
  const dialog = useRef<HTMLElement>(null), title = useId()
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} className="app-help-dialog" role="dialog" aria-modal="true" aria-labelledby={title} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]') ?? [])
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <header><h2 id={title}>{mode === 'guide' ? 'Your reading workspace' : 'About Paper Reader'}</h2><button className="icon-button" aria-label="Close help" onClick={onClose}><X size={18}/></button></header>
      {mode === 'guide' ? <>
        <ol><li>Import a local PDF and use Reader to select text, search, draw or move around with Hand.</li><li>Choose Capture, drag a region, then Add to Canvas. Select its image in Canvas to return to the source page.</li><li>Use Note → Canvas for text, images and handwriting. Export PNG saves the complete page at 2000 × 2400.</li><li>Use Summary for AI interpretation and Paper sources for original caption/reference candidates.</li><li>Choose an explicit AI context before sending a question. Text notes are supported; Canvas images and handwriting stay local.</li></ol>
        <p>Canvas also supports shapes, arrows and object connections. Switch to Mind map to edit a node tree and export its complete PNG. Each editing area labels its own undo.</p>
        <p>Home has one separate general DeepSeek conversation without paper context. Retry original request appends a new round using saved original inputs and model, while keeping your draft. Older messages have question reuse only.</p>
        <dl><dt>Ctrl + O</dt><dd>Import a PDF</dd><dt>Ctrl + F</dt><dd>Open and focus PDF search</dd><dt>Ctrl + S</dt><dd>Save current reading edits</dd><dt>F11</dt><dd>Enter or leave Reader focus</dd><dt>Alt + ← / →</dt><dd>Back / forward through this session</dd><dt>Escape</dt><dd>Dismiss one visible layer, then leave focus</dd></dl>
      </> : <><p>Paper Reader · {version}</p><p>A local desktop workspace for PDF reading, notes, diagrams, mind maps and DeepSeek-assisted questions.</p><p>Imported originals stay unchanged. AI requests send the selected text context to DeepSeek. AI answers and extracted source candidates need checking against the paper.</p></>}
      <footer>Local Windows application · Reading history lasts for this session · Exports use new file names</footer>
    </section>
  </div>
}

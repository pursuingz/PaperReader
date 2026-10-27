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
        <ol><li>Import a local PDF and use Reader to select text, search, draw or move around with Hand.</li><li>Choose Capture and drag a PDF region. Add to Canvas keeps its source page; Add to Chat stages a preview in the current paper draft and never sends automatically. Copy writes the image to the clipboard; Save PNG saves a new file. Chat, Copy and Save do not depend on Canvas being ready.</li><li>Use Note → Canvas for rich text, images and handwriting on named infinite boards. Use page for board management, edit for object/brush/view settings, and export for PNG/PDF. Double-click a text box to edit its content; click outside the editor to finish. Pan in any direction, zoom, fit all content or focus a selected object. Export all content, the current view or a selected region as PNG or tiled PDF.</li><li>Use Summary in English or Chinese for AI interpretation. It extracts source evidence, checks declared coverage and makes bounded source rereads before completing the six sections; unavailable evidence stays explicit and failure keeps the saved summary. Source links and checks do not prove complete or correct scientific interpretation. Figure and Table offer local automatic crops and original captions; open a module for large images, source pages and manual correction. Cited papers lists extracted references.</li><li>Choose an explicit AI context before sending. In Notes only or Paper + notes, Note sources selects Text, Highlights, the independent Mind map and Canvas; all four default on. Canvas defaults to the current board, with Selected pages and All pages alternatives. Selected images and handwriting are sent as real image inputs to a supported model such as DeepSeek Flash (deepseek-flash).</li></ol>
        <p>Note has Text, Highlights, Mind map and Canvas. Add a highlight or editable map copy to Canvas. Canvas also supports shapes, arrows and object connections; the separate Mind map supports wheel zoom, blank-area panning and complete PNG export. Old Ink can be imported into Canvas.</p>
        <p>Chat images are limited to 8 unique images, 16 MiB combined and 10 MiB each, with a 4096-pixel side and 16M-pixel maximum. Capture attachments and Canvas tiles share these limits. Selected Note text is limited to 100,000 characters. Editor save, source loading, missing image or scope failures stop the request; reduce sources or boards and retry.</p>
        <p>Organize with AI uses Text only. It conservatively groups and formats source blocks while retaining language, formulas, values, citations and uncertainty. Review the full current note, editable suggestion and line differences before Append or Replace. Moves may appear as removed/added lines; long difference previews are limited. Changed-note conflicts require another review; adoption undo is session-local.</p>
        <p>Home has one separate general DeepSeek conversation without paper context. Retry original request appends a new round using frozen original sources, images and model while keeping your draft. New Text organization requests also retain their processing recipe. Missing or changed original image resources stop replay instead of reading current notes or Canvas. Older saved text snapshots keep their original behavior; messages without snapshots have question reuse only.</p>
        <dl><dt>Ctrl + O</dt><dd>Import a PDF</dd><dt>Ctrl + F</dt><dd>Open and focus PDF search</dd><dt>Ctrl + S</dt><dd>Save current reading edits</dd><dt>F11</dt><dd>Enter or leave Reader focus</dd><dt>Alt + ← / →</dt><dd>Back / forward through this session</dd><dt>Escape</dt><dd>Dismiss one visible layer, then leave focus</dd></dl>
      </> : <><p>Paper Reader · {version}</p><p>A local desktop workspace for PDF reading, notes, diagrams, mind maps and DeepSeek-assisted questions.</p><p>Imported originals stay unchanged. AI requests send the selected text sources and any selected images to DeepSeek. AI answers and extracted source candidates need checking against the paper.</p></>}
      <footer>Local Windows application · Reading history lasts for this session · Exports use new file names</footer>
    </section>
  </div>
}


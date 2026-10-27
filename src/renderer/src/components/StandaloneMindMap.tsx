import { useEffect, useRef, useState } from 'react'
import { Expand, X } from 'lucide-react'
import type { CanvasWorkspace } from '../useCanvasWorkspace'
import MindMapEditor from './MindMapEditor'
import { initialMindMapView } from '../mindMapViewport'
import '../noteCanvas.css'
import '../diagram.css'

interface Props {
  workspace: CanvasWorkspace; disabled?: boolean; onExport?: () => void
  onAddToCanvas?: () => void; canvasReady?: boolean; copyingToCanvas?: boolean
}
export default function StandaloneMindMap(props: Props) {
  const { workspace, disabled } = props
  const [view,setView]=useState(initialMindMapView)
  const [expanded, setExpanded] = useState(false), expandButton = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDivElement>(null)
  const close = useRef<() => void>(() => undefined)
  close.current = () => {
    if (disabled || workspace.exporting) return
    workspace.finish(); void workspace.flush().then(() => setExpanded(false)).catch(() => undefined)
  }
  useEffect(() => { setExpanded(false);setView(initialMindMapView) }, [workspace.paperId])
  useEffect(() => {
    if (!expanded) return
    dialog.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); return }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])
      const first = controls[0], last = controls.at(-1)
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('keydown', keydown, true); expandButton.current?.focus() }
  }, [expanded])
  return <div className="note-canvas standalone-mind-map"><div className="canvas-heading"><span>YOUR LOCAL MIND MAP</span><button ref={expandButton} aria-label="Expand mind map" disabled={disabled || workspace.exporting || expanded} onClick={() => { workspace.finish(); setExpanded(true) }}><Expand size={13}/>Expand</button></div>
    {expanded ? <div className="canvas-expanded-placeholder">Mind map is open in the expanded editor.</div> : <MindMapEditor {...props} view={view} onViewChange={setView}/>}
    {expanded && <div className="modal-backdrop canvas-expanded-backdrop"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Expanded mind map" className="canvas-expanded-dialog"><div className="canvas-expanded-top"><div><strong>Mind map</strong><small>Independent saved map; Add to Canvas creates an editable copy</small></div><button aria-label="Close expanded mind map" disabled={disabled || workspace.exporting} onClick={() => close.current()}><X size={18}/></button></div><MindMapEditor {...props} view={view} onViewChange={setView}/></div></div>}
  </div>
}

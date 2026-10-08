import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Download, Eraser, Expand, ImagePlus, MousePointer2, Pencil, Redo2, Trash2, Type, Undo2, X } from 'lucide-react'
import type { CanvasImageObject, CanvasTextObject } from '../../../shared/types'
import type { CanvasWorkspace } from '../useCanvasWorkspace'
import type { CanvasPoint } from '../canvasWorkspace'
import { canvasColors } from '../../../main/canvasValidation'
import CanvasDiagramTools, { CanvasDiagramLayer } from './CanvasDiagramTools'
import MindMapEditor from './MindMapEditor'
import '../noteCanvas.css'
import '../diagram.css'

interface Props { workspace: CanvasWorkspace; disabled?: boolean; onSourcePage?: (page: number) => void; onExport?: () => void }
function ObjectFields({ object, workspace, disabled }: { object: CanvasTextObject | CanvasImageObject; workspace: CanvasWorkspace; disabled: boolean }) {
  const [x, setX] = useState(String(Math.round(object.x))), [y, setY] = useState(String(Math.round(object.y))), [width, setWidth] = useState(String(Math.round(object.width)))
  useEffect(() => { setX(String(Math.round(object.x))); setY(String(Math.round(object.y))); setWidth(String(Math.round(object.width))) }, [object.id, object.x, object.y, object.width])
  return <div className="canvas-object-fields">
    {object.type === 'text' && <label className="canvas-text-field">Selected text<textarea aria-label="Canvas text" placeholder="Write your reading note…" maxLength={100000} value={object.text} disabled={disabled} onChange={event => workspace.editText(object.id, event.target.value)} onBlur={workspace.finish}/></label>}
    <div className="canvas-coordinate-fields"><label>X<input aria-label="Canvas object X" type="number" min={0} max={1000} value={x} disabled={disabled} onChange={event => setX(event.target.value)}/></label><label>Y<input aria-label="Canvas object Y" type="number" min={0} max={1200} value={y} disabled={disabled} onChange={event => setY(event.target.value)}/></label><button aria-label="Apply canvas object position" disabled={disabled || !x.trim() || !y.trim() || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))} onClick={() => workspace.updateObject(object.id, { x: Number(x), y: Number(y) })}>Move</button>
      {object.type === 'image' ? <><label>Width<input aria-label="Canvas image width" type="number" min={1} max={1000} value={width} disabled={disabled} onChange={event => setWidth(event.target.value)}/></label><button aria-label="Apply canvas image size" disabled={disabled || !width.trim() || !Number.isFinite(Number(width)) || Number(width) < 1} onClick={() => workspace.resizeSelectedWidth(Number(width))}>Resize</button></> : <label>Size<select aria-label="Canvas text size" value={object.fontSize} disabled={disabled} onChange={event => workspace.updateObject(object.id, { fontSize: Number(event.target.value) })}>{[12, 18, 24, 32, 48, 64, 80].map(size => <option key={size} value={size}>{size}</option>)}</select></label>}
    </div>
  </div>
}

function CanvasEditor({ workspace, disabled = false, onSourcePage, onExport }: Props) {
  const svg = useRef<SVGSVGElement>(null), active = useRef<'move' | 'resize' | 'draw' | 'erase' | 'diagram-move' | 'diagram-resize' | 'diagram-end' | null>(null), pointer = useRef<number | null>(null)
  const locked = disabled || !workspace.ready || workspace.exporting, selected = workspace.document.objects.find(object => object.id === workspace.selectedId), missing = Object.values(workspace.assets).some(asset => asset.error)
  const source = selected?.type === 'image' ? workspace.assets[selected.assetId]?.source : undefined
  useEffect(() => () => { workspace.finish(); void workspace.flush().catch(() => undefined) }, [workspace.finish, workspace.flush])
  useEffect(() => { active.current = null; workspace.finish() }, [workspace.paperId, disabled, workspace.finish])
  const point = (event: ReactPointerEvent): CanvasPoint => { const rect = svg.current!.getBoundingClientRect(); return { x: (event.clientX - rect.left) * 1000 / rect.width, y: (event.clientY - rect.top) * 1200 / rect.height } }
  const capture = (event: ReactPointerEvent, kind: typeof active.current) => { active.current = kind; pointer.current = event.pointerId; svg.current?.setPointerCapture(event.pointerId); event.preventDefault() }
  const start = (event: ReactPointerEvent) => {
    if (locked || event.button !== 0 || active.current) return
    if (workspace.mode === 'draw' && workspace.beginStroke(point(event))) capture(event, 'draw')
    else if (workspace.mode === 'erase' && workspace.beginErase(point(event))) capture(event, 'erase')
    else if (workspace.mode === 'select') workspace.select(null)
  }
  const move = (event: ReactPointerEvent) => {
    if (disabled || workspace.exporting || !active.current || event.pointerId !== pointer.current) return
    const at = point(event)
    if (active.current === 'move') workspace.moveTo(at)
    else if (active.current === 'resize') workspace.resizeTo(at)
    else if (active.current === 'draw') workspace.strokeTo(at)
    else if (active.current === 'erase') workspace.eraseTo(at)
    else if (active.current === 'diagram-move') workspace.moveDiagramTo(at)
    else if (active.current === 'diagram-resize') workspace.resizeDiagramTo(at)
    else workspace.diagramArrowEndTo(at)
  }
  const finish = (event?: ReactPointerEvent) => { if (event && pointer.current !== null && event.pointerId !== pointer.current) return; active.current = null; pointer.current = null; workspace.finish(); if (event && svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId) }
  const diagramStart = (event: ReactPointerEvent, id: string, kind: 'move' | 'resize' | 'start' | 'end') => {
    if (disabled || workspace.exporting || !workspace.diagramReady || active.current || event.button !== 0) return
    const started = kind === 'move' ? workspace.beginDiagramMove(id, point(event)) : kind === 'resize' ? workspace.beginDiagramResize(id, point(event)) : workspace.beginDiagramArrowEnd(id, kind, point(event))
    if (started) capture(event, kind === 'move' ? 'diagram-move' : kind === 'resize' ? 'diagram-resize' : 'diagram-end')
  }
  const objectStart = (event: ReactPointerEvent, id: string, type: string) => {
    if (locked || workspace.mode !== 'select' || event.button !== 0 || active.current) return
    event.stopPropagation()
    if (type === 'stroke') { workspace.select(id); return }
    if (workspace.beginMove(id, point(event))) capture(event, 'move')
  }
  return <section className="canvas-editor" aria-label="Canvas workspace" onKeyDown={event => {
    if (disabled || workspace.exporting || event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); workspace.editingDomain === 'diagram' ? workspace.removeDiagram() : workspace.removeSelected() }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (workspace.editingDomain === 'diagram') event.shiftKey ? workspace.redoDiagram() : workspace.undoDiagram(); else event.shiftKey ? workspace.redo() : workspace.undo() }
  }}>
    <div className="canvas-tools">
      <button aria-label="Add canvas text" title="Add text" disabled={locked} onClick={workspace.addText}><Type size={15}/><span>Text</span></button><button aria-label="Insert canvas image" title="Insert PNG/JPEG image" disabled={locked} onClick={() => void workspace.importImage()}><ImagePlus size={15}/><span>Image</span></button>
      <button aria-label="Select canvas object" title="Select or move an object" aria-pressed={workspace.mode === 'select'} disabled={locked} onClick={() => workspace.setMode('select')}><MousePointer2 size={15}/></button><button aria-label="Draw on canvas" title="Draw" aria-pressed={workspace.mode === 'draw'} disabled={locked} onClick={() => workspace.setMode('draw')}><Pencil size={15}/></button><button aria-label="Erase canvas strokes" title="Erase whole strokes" aria-pressed={workspace.mode === 'erase'} disabled={locked} onClick={() => workspace.setMode('erase')}><Eraser size={15}/></button>
      <span className="canvas-colors">{canvasColors.map((color, index) => <button key={color} style={{ background: color }} aria-label={`${['Slate', 'Coral', 'Mint'][index]} canvas pen`} title={`${['Slate', 'Coral', 'Mint'][index]} pen`} aria-pressed={workspace.color === color} disabled={locked} onClick={() => { workspace.setColor(color); if (selected?.type === 'text') workspace.updateObject(selected.id, { color }) }}/>)}</span>
      <button aria-label="Undo canvas edit" title="Undo" disabled={locked || !workspace.canUndo} onClick={workspace.undo}><Undo2 size={15}/></button><button aria-label="Redo canvas edit" title="Redo" disabled={locked || !workspace.canRedo} onClick={workspace.redo}><Redo2 size={15}/></button><button aria-label="Remove canvas object" title="Remove selected object" disabled={locked || !selected} onClick={workspace.removeSelected}><Trash2 size={15}/></button>
      <button aria-label="Export canvas PNG" title="Export the complete 2000×2400 canvas including diagrams" disabled={locked || !workspace.diagramReady} onClick={() => { if (onExport) onExport(); else void workspace.exportPng().catch(() => undefined) }}><Download size={15}/><span>{workspace.exporting ? 'Exporting…' : 'PNG'}</span></button>
    </div>
    <div className="canvas-object-picker"><label>OBJECT<select aria-label="Canvas object list" value={workspace.selectedId ?? ''} disabled={locked} onChange={event => workspace.select(event.target.value || null)}><option value="">No selection</option>{workspace.document.objects.map((object, index) => <option key={object.id} value={object.id}>{object.type === 'text' ? object.text.trim().slice(0, 36) || 'Empty text' : object.type === 'image' ? 'Image' : 'Pen stroke'} · {index + 1}</option>)}</select></label><small>{workspace.document.objects.length} / 500 objects</small></div>
    {selected && selected.type !== 'stroke' && <ObjectFields key={selected.id} object={selected} workspace={workspace} disabled={locked}/>}
    {source && <div className="canvas-capture-source"><span>Captured from PDF · page {source.page}</span><button aria-label={`Open capture source page ${source.page}`} disabled={locked || !onSourcePage} onClick={() => onSourcePage?.(source.page)}>Open source page</button></div>}
    <CanvasDiagramTools workspace={workspace} disabled={disabled}/>
    {missing && <p className="canvas-resource-warning" role="alert">Some saved images are unavailable. Missing or damaged resources can block saving edits. Retry the image or explicitly remove its object; saved files are retained.</p>}
    {selected?.type === 'image' && workspace.assets[selected.assetId]?.error && <div className="canvas-image-error"><span>{workspace.assets[selected.assetId].error}</span><button aria-label="Retry canvas image" onClick={() => void workspace.retryImage(selected.assetId)}>Retry image</button></div>}
    {!workspace.ready && <p className="canvas-unavailable">{workspace.status}{workspace.paperId && <button aria-label="Retry canvas load" onClick={() => void workspace.open(workspace.paperId)}>Retry Canvas</button>}</p>}
    <div className="canvas-page-scroll" tabIndex={0} aria-label="Canvas page viewport"><svg ref={svg} className={`canvas-page canvas-mode-${workspace.mode}`} aria-label="Canvas page" role="group" viewBox="0 0 1000 1200" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { if (active.current) finish() }}>
      <defs><pattern id="canvas-dot-pattern" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#e9e6df"/></pattern></defs><rect width="1000" height="1200" fill="#fffdf8"/><rect width="1000" height="1200" fill="url(#canvas-dot-pattern)" pointerEvents="none"/>
      {workspace.document.objects.map(object => <g key={object.id} data-canvas-object-id={object.id} data-canvas-object-type={object.type} role="button" aria-label={object.type === 'text' ? 'Canvas text object' : object.type === 'image' ? 'Canvas image object' : 'Canvas stroke'} aria-pressed={workspace.selectedId === object.id} tabIndex={locked ? -1 : 0} onPointerDown={event => objectStart(event, object.id, object.type)} onKeyDown={event => {
        if (locked) return
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); workspace.select(object.id) }
        else if (object.type !== 'stroke' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); workspace.select(object.id); const step = event.shiftKey ? 1 : 10; workspace.updateObject(object.id, { x: object.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y: object.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) }) }
      }}>
        {object.type === 'stroke' ? <polyline points={object.points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={object.color} strokeWidth={object.strokeWidth} strokeLinecap="round" strokeLinejoin="round"/> : object.type === 'text' ? <><rect x={object.x} y={object.y} width={object.width} height={object.height} fill="#fffbf2"/><foreignObject x={object.x} y={object.y} width={object.width} height={object.height}><div className="canvas-text-object" style={{ fontSize: object.fontSize, color: object.color }}>{object.text || 'Write your note…'}</div></foreignObject></> : workspace.assets[object.assetId]?.url ? <image x={object.x} y={object.y} width={object.width} height={object.height} href={workspace.assets[object.assetId].url} preserveAspectRatio="xMidYMid meet" onError={() => workspace.imageUnavailable(object.assetId)}/> : <><rect x={object.x} y={object.y} width={object.width} height={object.height} fill="#eef1f4"/><foreignObject x={object.x} y={object.y} width={object.width} height={object.height}><div className="canvas-image-placeholder">{workspace.assets[object.assetId]?.error ? 'Image unavailable' : 'Loading image…'}</div></foreignObject></>}
        {workspace.selectedId === object.id && object.type !== 'stroke' && <><rect x={object.x} y={object.y} width={object.width} height={object.height} fill="none" stroke="#ed6376" strokeWidth="3" strokeDasharray="8 5" pointerEvents="none"/>{object.type === 'image' && <rect role="button" aria-label="Resize canvas image" x={object.x + object.width - 12} y={object.y + object.height - 12} width="24" height="24" fill="#ed6376" stroke="#fff" strokeWidth="3" className="canvas-resize-handle" onPointerDown={event => { if (locked) return; event.stopPropagation(); if (workspace.beginResize(object.id, point(event))) capture(event, 'resize') }}/>}</>}
      </g>)}
      <CanvasDiagramLayer workspace={workspace} disabled={disabled} onStart={diagramStart}/>
    </svg></div>
    <div className="canvas-status" role="status" aria-label="Canvas save status"><span>{workspace.exporting ? 'Exporting complete canvas…' : workspace.status}</span><button aria-label="Save canvas now" disabled={locked} onClick={() => void workspace.flush().catch(() => undefined)}>Save now</button></div>
    <p className="canvas-scope-note">Canvas stays local. PNG exports the complete page with text, images, drawings and diagrams. Base Canvas and diagram tools have separate undo. AI context and Markdown export include text notes; Canvas content is excluded.</p>
  </section>
}
function BoardEditor(props: Props) {
  const { workspace, disabled } = props
  return <><div className="canvas-board-switch" role="group" aria-label="Canvas board mode"><button aria-label="Show canvas board" aria-pressed={workspace.boardMode === 'canvas'} disabled={disabled || workspace.exporting} onClick={() => void workspace.setBoardMode('canvas')}>Canvas</button><button aria-label="Show mind map board" aria-pressed={workspace.boardMode === 'mind-map'} disabled={disabled || workspace.exporting} onClick={() => void workspace.setBoardMode('mind-map')}>Mind map</button></div>{workspace.boardMode === 'mind-map' ? <MindMapEditor workspace={workspace} disabled={disabled} onExport={props.onExport}/> : <CanvasEditor {...props}/>}</>
}

export default function NoteCanvas({ workspace, disabled, onSourcePage, onExport }: Props) {
  const [expanded, setExpanded] = useState(false), expandButton = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDivElement>(null), close = useRef<() => void>(() => undefined)
  close.current = () => { workspace.finish(); void workspace.flush().then(() => setExpanded(false)).catch(() => undefined) }
  useEffect(() => {
    if (!expanded) return
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])
      const first = controls[0], last = controls.at(-1)
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); expandButton.current?.focus() }
  }, [expanded])
  return <div className="note-canvas"><div className="canvas-heading"><span>YOUR LOCAL CANVAS</span><button ref={expandButton} aria-label="Expand canvas" disabled={disabled || expanded} onClick={() => { workspace.finish(); setExpanded(true) }}><Expand size={13}/>Expand</button></div>
    {expanded ? <div className="canvas-expanded-placeholder">Canvas is open in the expanded editor.</div> : <BoardEditor workspace={workspace} disabled={disabled} onSourcePage={onSourcePage} onExport={onExport}/>}
    {expanded && <div className="modal-backdrop canvas-expanded-backdrop"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Expanded canvas" className="canvas-expanded-dialog"><div className="canvas-expanded-top"><div><strong>Reading canvas</strong><small>Text, images, diagrams and an independent Mind map</small></div><button aria-label="Close expanded canvas" onClick={() => close.current()}><X size={18}/></button></div><BoardEditor workspace={workspace} disabled={disabled} onSourcePage={onSourcePage} onExport={onExport}/></div></div>}
  </div>
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DesktopAPI, PdfCaptureInput } from '../../shared/types'
import type { DiagramArrow, DiagramConnection, DiagramEndpoint, DiagramShape } from '../../shared/diagramTypes'
import type { CanvasExportOptions, CanvasViewport, RichTextDocument } from '../../shared/notebookTypes'
import { NotebookAutosave, NotebookSession, type NotebookObjectPatch, type NotebookPoint } from './notebookSession'

export default function useNotebookWorkspace(api: DesktopAPI, onNotice: (message: string) => void) {
  const [, render] = useState(0), mounted = useRef(true), notice = useRef(onNotice), autosave = useRef<NotebookAutosave | null>(null), session = useRef<NotebookSession | null>(null)
  notice.current = onNotice
  if (!session.current) {
    session.current = new NotebookSession(api, () => { if (mounted.current) { render(value => value + 1); autosave.current?.schedule() } })
    autosave.current = new NotebookAutosave(session.current)
  }
  const commands = useMemo(() => {
    const current = session.current!, report = (error: unknown) => notice.current(error instanceof Error ? error.message : String(error))
    const safe = <T,>(operation: () => T, fallback: T): T => { try { return operation() } catch (error) { report(error); return fallback } }
    const strict = <T,>(operation: () => T): T => { try { return operation() } catch (error) { report(error); throw error } }
    const asyncSafe = async <T,>(operation: () => Promise<T>): Promise<T> => { autosave.current!.stop(); try { return await operation() } catch (error) { report(error); throw error } }
    return {
      open: async (id: string | null) => { autosave.current!.stop(); try { await current.open(id) } catch (error) { report(error) } },
      finish: () => strict(() => current.finish()), registerEditorCommit: (commit: () => void) => current.registerEditorCommit(commit), flush: () => asyncSafe(() => current.flush()), exportPng: () => asyncSafe(() => current.exportPng()), exportRegion: (options:CanvasExportOptions) => asyncSafe(() => current.exportRegion(options)), setViewport: (viewport:CanvasViewport) => safe(() => current.setViewport(viewport),undefined),
      captureImage: (capture: PdfCaptureInput) => asyncSafe(() => current.captureImage(capture)),
      importHighlight: (id: string) => asyncSafe(() => current.importHighlight(id)), importMindMap: () => asyncSafe(() => current.importMindMap()), importLegacyInk: () => asyncSafe(() => current.importLegacyInk()),
      addOwnedImage: (assetId: string, point?: NotebookPoint) => asyncSafe(() => current.addOwnedImage(assetId, point)),
      importImage: () => asyncSafe(() => current.importImage()),
      deletePage: () => asyncSafe(() => current.deletePage()),
      switchPage: (id: string) => asyncSafe(() => current.switchPage(id)), addPage: (name?: string, width?: number, height?: number) => asyncSafe(() => current.addPage(name,width,height)), duplicatePage: () => asyncSafe(() => current.duplicatePage()),
      renamePage: (id: string, name: string) => safe(() => current.renamePage(id,name),undefined), reorderPage: (id: string,direction:-1|1) => safe(() => current.reorderPage(id,direction),undefined), resizePage: (width:number,height:number) => safe(() => current.resizePage(width,height),undefined),
      select: (id:string|null) => current.select(id), setMode: (mode:'select'|'draw'|'erase') => current.setMode(mode),setColor:(color:string)=>safe(()=>current.setColor(color),undefined),setStrokeWidth:(width:number)=>safe(()=>current.setStrokeWidth(width),undefined),
      addText:()=>safe(()=>current.addText(),null),updateObject:(id:string,patch:NotebookObjectPatch)=>safe(()=>current.updateObject(id,patch),undefined),editText:(id:string,text:string)=>safe(()=>current.editText(id,text),undefined),editRichText:(id:string,value:RichTextDocument)=>strict(()=>current.editRichText(id,value)),fitText:(id:string)=>safe(()=>current.fitText(id),undefined),editMapNode:(id:string,nodeId:string,text:string)=>safe(()=>current.editMapNode(id,nodeId,text),undefined),
      removeSelected:()=>safe(()=>current.removeSelected(),undefined),undo:()=>safe(()=>current.undo(),undefined),redo:()=>safe(()=>current.redo(),undefined),
      beginMove:(id:string,at:NotebookPoint)=>safe(()=>current.beginMove(id,at),false),moveTo:(at:NotebookPoint)=>safe(()=>current.moveTo(at),undefined),beginResize:(id:string,at:NotebookPoint)=>safe(()=>current.beginResize(id,at),false),resizeTo:(at:NotebookPoint)=>safe(()=>current.resizeTo(at),undefined),
      beginStroke:(at:NotebookPoint)=>safe(()=>current.beginStroke(at),false),strokeTo:(at:NotebookPoint)=>safe(()=>current.strokeTo(at),undefined),beginErase:(at:NotebookPoint)=>safe(()=>current.beginErase(at),false),eraseTo:(at:NotebookPoint)=>safe(()=>current.eraseTo(at),undefined),
      addShape:(kind:'rectangle'|'circle')=>safe(()=>current.addShape(kind),null),addArrow:()=>safe(()=>current.addArrow(),null),addConnection:(from:DiagramEndpoint,to:DiagramEndpoint)=>safe(()=>current.addConnection(from,to),null),updateDiagram:(id:string,patch:Partial<DiagramShape&DiagramArrow&DiagramConnection>)=>safe(()=>current.updateDiagram(id,patch),undefined),beginDiagram:(id:string,at:NotebookPoint,kind:'move'|'resize'|'start'|'end')=>safe(()=>current.beginDiagram(id,at,kind),false),diagramTo:(at:NotebookPoint)=>safe(()=>current.diagramTo(at),undefined),
      retryImage:(id:string)=>asyncSafe(()=>current.retryImage(id)),imageUnavailable:(id:string)=>current.imageUnavailable(id)
    }
  }, [])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; autosave.current?.stop(); session.current?.finish(); void session.current?.flush().then(() => session.current?.dispose()).catch(() => undefined) } },[])
  const current = session.current!
  return { ...commands,paperId:current.paperId,ready:current.ready,exporting:current.exporting,importing:current.importing,busy:current.busy,status:current.status,document:current.document,activePage:current.activePage,viewport:current.viewport,selectedId:current.selectedId,mode:current.mode,color:current.color,strokeWidth:current.strokeWidth,assets:current.assets,canUndo:current.canUndo,canRedo:current.canRedo,editing:current.editing,legacyInkCount:current.legacyInkCount }
}
export type NotebookWorkspace = ReturnType<typeof useNotebookWorkspace>



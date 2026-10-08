import { useEffect, useMemo, useRef, useState } from 'react'
import type { DesktopAPI, PdfCaptureInput } from '../../shared/types'
import type { DiagramArrow, DiagramConnection, DiagramEndpoint, DiagramShape } from '../../shared/diagramTypes'
import type { CanvasPoint, CanvasRect } from './canvasWorkspace'
import { rasterCanvasPng, rasterMindMapPng } from './canvasRaster'
import { CanvasBoards } from './canvasBoards'

export default function useCanvasWorkspace(api: DesktopAPI, onNotice: (message: string) => void) {
  const [, render] = useState(0), mounted = useRef(true), notice = useRef(onNotice), timer = useRef<ReturnType<typeof setTimeout> | null>(null), boards = useRef<CanvasBoards | null>(null)
  notice.current = onNotice
  const stopTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  const save = async () => {
    stopTimer()
    try { await boards.current!.flush() }
    catch (error) { notice.current(`Canvas or Mind map could not be saved. Changes remain in this session: ${String(error)}`); throw error }
  }
  const schedule = () => {
    stopTimer(); const current = boards.current
    if (!current || !current.dirty || current.editing || current.exporting || current.transitioning) return
    timer.current = setTimeout(() => { timer.current = null; void save().catch(() => undefined) }, 500)
  }
  if (!boards.current) boards.current = new CanvasBoards(api, () => {
    if (!mounted.current) return
    render(value => value + 1); schedule()
  })
  const commands = useMemo(() => {
    const all = boards.current!, current = all.base, diagram = all.diagram, map = all.map, safe = <T,>(operation: () => T, fallback: T): T => { try { return operation() } catch (error) { notice.current(String(error)); return fallback } }
    const baseEdit = <T,>(operation: () => T, fallback: T) => safe(() => { all.chooseDomain('base'); return operation() }, fallback)
    const diagramEdit = <T,>(operation: () => T, fallback: T) => safe(() => { all.chooseDomain('diagram'); return operation() }, fallback)
    return {
      open: async (id: string | null) => { stopTimer(); try { await all.open(id) } catch (error) { notice.current(`A saved board could not be loaded. Its editing is disabled to protect it: ${String(error)}`) } },
      finish: () => all.finish(), flush: save,
      setBoardMode: async (mode: 'canvas' | 'mind-map') => { stopTimer(); try { await all.setBoardMode(mode) } catch (error) { notice.current(`Board switch stopped; changes were kept: ${String(error)}`) } },
      addText: () => baseEdit(() => current.addText(), null), editText: (id: string, text: string) => safe(() => current.editText(id, text), undefined),
      updateObject: (id: string, patch: Partial<CanvasRect & { text: string; fontSize: number; color: string }>) => safe(() => current.updateObject(id, patch), undefined),
      importImage: async () => { try { all.chooseDomain('base'); await current.importImage() } catch (error) { notice.current(`Image could not be added to Canvas: ${String(error)}`) } },
      captureImage: async (capture: PdfCaptureInput) => { try { await all.setBoardMode('canvas'); all.chooseDomain('base'); await current.captureImage(capture) } catch (error) { notice.current(`PDF capture could not be added to Canvas: ${String(error)}`); throw error } },
      exportPng: async () => { stopTimer(); try { return await all.exportPng((id, document, diagram) => rasterCanvasPng(id, document, (paperId, assetId) => api.readCanvasImage(paperId, assetId), diagram), rasterMindMapPng) } catch (error) { notice.current(`Board PNG could not be exported: ${String(error)}`); throw error } },
      isExporting: () => all.exporting,
      retryImage: (assetId: string) => current.retryImage(assetId), imageUnavailable: (assetId: string) => current.imageUnavailable(assetId), select: (id: string | null) => baseEdit(() => current.select(id), undefined),
      setMode: (mode: 'select' | 'draw' | 'erase') => baseEdit(() => current.setMode(mode), undefined), setColor: (color: string) => current.setColor(color),
      removeSelected: () => safe(() => current.removeSelected(), undefined), undo: () => safe(() => current.undo(), undefined), redo: () => safe(() => current.redo(), undefined),
      resizeSelectedWidth: (width: number) => safe(() => current.resizeSelectedWidth(width), undefined),
      beginMove: (id: string, point: CanvasPoint) => safe(() => all.beginBase('move', point, id), false), moveTo: (point: CanvasPoint) => safe(() => current.moveTo(point), undefined),
      beginResize: (id: string, point: CanvasPoint) => safe(() => all.beginBase('resize', point, id), false), resizeTo: (point: CanvasPoint) => safe(() => current.resizeTo(point), undefined),
      beginStroke: (point: CanvasPoint) => safe(() => all.beginBase('draw', point), false), strokeTo: (point: CanvasPoint) => safe(() => current.strokeTo(point), undefined),
      beginErase: (point: CanvasPoint) => safe(() => all.beginBase('erase', point), false), eraseTo: (point: CanvasPoint) => safe(() => current.eraseTo(point), undefined),
      addShape: (kind: DiagramShape['kind']) => diagramEdit(() => diagram.addShape(kind), null), addArrow: () => diagramEdit(() => diagram.addArrow(), null),
      addConnection: (from: DiagramEndpoint, to: DiagramEndpoint) => diagramEdit(() => diagram.addConnection(from, to), null),
      selectDiagram: (id: string | null) => diagramEdit(() => diagram.select(id), undefined), updateDiagramItem: (id: string, patch: Partial<DiagramShape & DiagramArrow & DiagramConnection>) => safe(() => diagram.updateItem(id, patch), undefined),
      undoDiagram: () => safe(() => { all.finish(); diagram.undo() }, undefined), redoDiagram: () => safe(() => { all.finish(); diagram.redo() }, undefined), removeDiagram: () => safe(() => diagram.removeSelected(), undefined),
      beginDiagramMove: (id: string, point: CanvasPoint) => safe(() => all.beginDiagram('move', id, point), false), moveDiagramTo: (point: CanvasPoint) => safe(() => diagram.moveTo(point), undefined),
      beginDiagramResize: (id: string, point: CanvasPoint) => safe(() => all.beginDiagram('resize', id, point), false), resizeDiagramTo: (point: CanvasPoint) => safe(() => diagram.resizeTo(point), undefined),
      beginDiagramArrowEnd: (id: string, end: 'start' | 'end', point: CanvasPoint) => safe(() => all.beginDiagram(end, id, point), false), diagramArrowEndTo: (point: CanvasPoint) => safe(() => diagram.arrowEndTo(point), undefined),
      retryDiagram: () => safe(() => diagram.open(current.paperId).catch(error => notice.current(String(error))), Promise.resolve()), retryMap: () => safe(() => map.open(current.paperId).catch(error => notice.current(String(error))), Promise.resolve()),
      selectMapNode: (id: string | null) => map.select(id), addMapRoot: () => safe(() => map.addRoot(), null), addMapNode: (id: string, relationship: 'child' | 'sibling') => safe(() => map.addNode(id, relationship), null),
      editMapText: (id: string, text: string) => safe(() => map.editText(id, text), undefined), reparentMapNode: (id: string, parent: string) => safe(() => map.reparent(id, parent), undefined), reorderMapNode: (id: string, direction: -1 | 1) => safe(() => map.reorder(id, direction), undefined), removeMapNode: (id: string) => safe(() => map.remove(id), undefined),
      undoMap: () => safe(() => map.undo(), undefined), redoMap: () => safe(() => map.redo(), undefined)
    }
  }, [])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopTimer(); void boards.current!.flush().catch(error => notice.current(`Board save failed while closing: ${String(error)}`)).finally(() => boards.current!.dispose()) } }, [])
  const all = boards.current, current = all.base, diagram = all.diagram, map = all.map
  return { ...commands, paperId: current.paperId, ready: current.ready, exporting: all.exporting || all.transitioning, status: current.status, document: current.document, selectedId: current.selectedId, mode: current.mode, color: current.color, assets: current.assets, canUndo: current.canUndo, canRedo: current.canRedo, boardMode: all.boardMode, editingDomain: all.editingDomain, diagram: diagram.document, diagramReady: diagram.ready, diagramStatus: diagram.status, diagramSelectedId: diagram.selectedId, canUndoDiagram: diagram.canUndo, canRedoDiagram: diagram.canRedo, mindMap: map.document, mapReady: map.ready, mapStatus: map.status, mapSelectedId: map.selectedId, canUndoMap: map.canUndo, canRedoMap: map.canRedo }
}
export type CanvasWorkspace = ReturnType<typeof useCanvasWorkspace>

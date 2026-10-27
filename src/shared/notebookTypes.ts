import type { CanvasObject, Highlight } from './types'
import type { CanvasDiagram, MindMapNode } from './diagramTypes'

export interface RichTextRun { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string; highlight?: string }
export interface RichTextBlock { kind: 'paragraph' | 'heading' | 'bullet' | 'number'; runs: RichTextRun[] }
export interface RichTextDocument { blocks: RichTextBlock[] }
export interface NotebookTextObject { id: string; type: 'text'; x: number; y: number; width: number; height: number; text: string; color: string; fontSize: number; richText?: RichTextDocument }
export interface NotebookQuoteObject { id: string; type: 'quote'; x: number; y: number; width: number; height: number; quote: string; comment: string; fontSize: number; source: { paperId: string; highlightId: string; page: number; rects: Highlight['rects']; importedAt: string } }
export interface NotebookMapObject { id: string; type: 'mindmap'; x: number; y: number; width: number; height: number; nodes: MindMapNode[]; source: { paperId: string; importedAt: string } }
export type NotebookObject = Exclude<CanvasObject, { type: 'text' }> | NotebookTextObject | NotebookQuoteObject | NotebookMapObject
export interface CanvasRegion { x: number; y: number; width: number; height: number }
export interface CanvasViewport { x: number; y: number; zoom: number }
export interface CanvasExportOptions { format: 'png' | 'pdf'; scope: 'all' | 'viewport' | 'selection'; region: CanvasRegion }
export interface NotebookPage { id: string; name: string; width: number; height: number; objects: NotebookObject[]; diagram: CanvasDiagram; viewport?: CanvasViewport }
export interface CanvasNotebook { version: 1; surface?: 'infinite'; paperId: string; activePageId: string; pages: NotebookPage[] }

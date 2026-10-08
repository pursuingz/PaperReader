export interface DiagramShape { id: string; kind: 'rectangle' | 'circle'; x: number; y: number; width: number; height: number; fill: string; color: string; lineWidth: number }
export interface DiagramArrow { id: string; start: { x: number; y: number }; end: { x: number; y: number }; color: string; lineWidth: number }
export interface DiagramEndpoint { objectId: string; domain: 'base' | 'shape'; anchor: 'auto' | 'top' | 'right' | 'bottom' | 'left' }
export interface DiagramConnection { id: string; from: DiagramEndpoint; to: DiagramEndpoint; color: string; lineWidth: number }
export interface CanvasDiagram { version: 1; paperId: string; shapes: DiagramShape[]; arrows: DiagramArrow[]; connections: DiagramConnection[] }
export interface MindMapNode { id: string; text: string; parentId: string | null; order: number }
export interface MindMapDocument { version: 1; paperId: string; nodes: MindMapNode[] }

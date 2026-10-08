import type { MindMapDocument } from '../shared/diagramTypes'
export interface MindMapLayoutNode { id: string; x: number; y: number; width: number; height: number; lines: string[] }
export interface MindMapLayout { width: number; height: number; nodes: MindMapLayoutNode[]; edges: Array<{ from: string; to: string; start: { x: number; y: number }; end: { x: number; y: number } }> }
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
export function wrapMindMapText(text: string): string[] {
  const lines: string[] = []; let line = '', units = 0
  for (const { segment } of segmenter.segment(text.replace(/\r\n?/g, '\n'))) {
    if (segment === '\n') { lines.push(line); line = ''; units = 0; continue }
    const cost = /^[\x20-\x7e]+$/.test(segment) ? segment.length : 2
    if (line && units + cost > 20) { lines.push(line); line = ''; units = 0 }
    line += segment; units += cost
  }
  lines.push(line); return lines
}
/** A complete deterministic tree layout. A rejected edit never drops off-screen nodes. */
export function computeMindMapLayout(document: MindMapDocument): MindMapLayout {
  if (!document.nodes.length) return { width: 600, height: 300, nodes: [], edges: [] }
  const children = (id: string) => document.nodes.filter(node => node.parentId === id).sort((a, b) => a.order - b.order)
  const lines = new Map(document.nodes.map(node => [node.id, wrapMindMapText(node.text)])), heights = new Map(document.nodes.map(node => [node.id, Math.max(70, lines.get(node.id)!.length * 22 + 24)])), spans = new Map<string, number>()
  const span = (id: string): number => { const descendants = children(id), height = Math.max(heights.get(id)!, descendants.reduce((sum, node) => sum + span(node.id), 0) + Math.max(0, descendants.length - 1) * 24); spans.set(id, height); return height }
  const root = document.nodes.find(node => node.parentId === null)!
  const height = span(root.id) + 64, nodes: MindMapLayoutNode[] = []
  const place = (id: string, depth: number, top: number) => {
    const nodeHeight = heights.get(id)!, total = spans.get(id)!, x = 32 + depth * 280
    nodes.push({ id, x, y: top + (total - nodeHeight) / 2, width: 240, height: nodeHeight, lines: lines.get(id)! })
    const descendants = children(id), childHeight = descendants.reduce((sum, node) => sum + spans.get(node.id)!, 0) + Math.max(0, descendants.length - 1) * 24
    let cursor = top + (total - childHeight) / 2
    for (const node of descendants) { place(node.id, depth + 1, cursor); cursor += spans.get(node.id)! + 24 }
  }
  place(root.id, 0, 32)
  const width = Math.max(...nodes.map(node => node.x + node.width)) + 32
  if (width > 4096 || height > 4096 || width * height > 16000000) throw new Error('Mind map layout exceeds the complete 4096×4096 / 16 million pixel limit. Reduce depth, text or branches.')
  const positions = new Map(nodes.map(node => [node.id, node]))
  const edges = document.nodes.filter(node => node.parentId !== null).map(node => { const from = positions.get(node.parentId!)!, to = positions.get(node.id)!; return { from: from.id, to: to.id, start: { x: from.x + from.width, y: from.y + from.height / 2 }, end: { x: to.x, y: to.y + to.height / 2 } } })
  return { width: Math.ceil(width), height: Math.ceil(height), nodes, edges }
}

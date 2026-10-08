import type { MindMapDocument } from '../../shared/diagramTypes'
import { validateMindMapDocument } from '../../main/diagramValidation'
import { computeMindMapLayout } from '../../main/mindMapGeometry'
export { wrapMindMapText } from '../../main/mindMapGeometry'
export function layoutMindMap(document: MindMapDocument) { validateMindMapDocument(document); return computeMindMapLayout(document) }
function checked(document: MindMapDocument) { validateMindMapDocument(document); return document }
function normalize(document: MindMapDocument): MindMapDocument {
  const groups = new Map<string | null, typeof document.nodes>()
  for (const node of document.nodes) { const group = groups.get(node.parentId) ?? []; group.push(node); groups.set(node.parentId, group) }
  const orders = new Map<string, number>(); for (const group of groups.values()) group.sort((a, b) => a.order - b.order).forEach((node, index) => orders.set(node.id, index))
  return { ...document, nodes: document.nodes.map(node => ({ ...node, order: orders.get(node.id)! })) }
}
export function addMapNode(document: MindMapDocument, selectedId: string, relationship: 'child' | 'sibling', id: string): MindMapDocument {
  const selected = document.nodes.find(node => node.id === selectedId); if (!selected) throw new Error('Select a mind map node first')
  if (relationship === 'sibling' && selected.parentId === null) throw new Error('The root cannot have a sibling')
  const parentId = relationship === 'child' ? selectedId : selected.parentId, siblings = document.nodes.filter(node => node.parentId === parentId), order = relationship === 'child' ? siblings.length : selected.order + 1
  return checked({ ...document, nodes: [...document.nodes.map(node => node.parentId === parentId && node.order >= order ? { ...node, order: node.order + 1 } : node), { id, text: 'New idea', parentId, order }] })
}
export function reparentMapNode(document: MindMapDocument, id: string, parentId: string): MindMapDocument {
  const selected = document.nodes.find(node => node.id === id)
  if (!selected || selected.parentId === null) throw new Error('The mind map root cannot be reparented')
  if (!document.nodes.some(node => node.id === parentId)) throw new Error('Mind map parent is missing')
  if (selected.parentId === parentId) return document
  let ancestor: string | null = parentId
  while (ancestor) { if (ancestor === id) throw new Error('Reparenting to a descendant would create a cycle'); ancestor = document.nodes.find(node => node.id === ancestor)?.parentId ?? null }
  return checked(normalize({ ...document, nodes: document.nodes.map(node => node.id === id ? { ...node, parentId, order: document.nodes.filter(node => node.parentId === parentId).length } : node) }))
}
export function reorderMapNode(document: MindMapDocument, id: string, direction: -1 | 1): MindMapDocument {
  const selected = document.nodes.find(node => node.id === id); if (!selected) throw new Error('Mind map node is missing')
  const sibling = document.nodes.find(node => node.parentId === selected.parentId && node.order === selected.order + direction)
  if (!sibling) return document
  return checked({ ...document, nodes: document.nodes.map(node => node.id === selected.id ? { ...node, order: sibling.order } : node.id === sibling.id ? { ...node, order: selected.order } : node) })
}
export function removeMapSubtree(document: MindMapDocument, id: string): MindMapDocument {
  const selected = document.nodes.find(node => node.id === id); if (!selected) return document; if (selected.parentId === null) throw new Error('Keep the root; edit its text or remove a branch instead')
  const removed = new Set([id]); let changed = true
  while (changed) { changed = false; for (const node of document.nodes) if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) { removed.add(node.id); changed = true } }
  return checked(normalize({ ...document, nodes: document.nodes.filter(node => !removed.has(node.id)) }))
}

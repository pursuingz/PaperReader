import type { DesktopAPI } from '../../shared/types'
import type { MindMapDocument } from '../../shared/diagramTypes'
import { emptyMindMap, validateMindMapDocument } from '../../main/diagramValidation'
import { SidecarSession } from './diagramSession'
import { addMapNode, reparentMapNode, reorderMapNode, removeMapSubtree } from './mindMapModel'
type API = Pick<DesktopAPI, 'loadMindMap' | 'saveMindMap'>
export class MindMapSession extends SidecarSession<MindMapDocument> {
  constructor(api: API, notify?: () => void) { super(id => api.loadMindMap(id), (id, value) => api.saveMindMap(id, value), emptyMindMap, validateMindMapDocument, notify) }
  addRoot(): string | null { if (!this.ready || this.exporting || this.document.nodes.length) return null; const id = crypto.randomUUID(); this.commit({ ...this.document, nodes: [{ id, text: 'Paper ideas', parentId: null, order: 0 }] }); this.selectedId = id; this.notify(); return id }
  addNode(id: string, relationship: 'child' | 'sibling'): string | null { if (!this.ready || this.exporting) return null; const next = crypto.randomUUID(); this.commit(addMapNode(this.document, id, relationship, next)); this.selectedId = next; this.notify(); return next }
  editText(id: string, text: string) { if (!this.ready || this.exporting || !this.document.nodes.some(node => node.id === id && node.text !== text)) return; const next = { ...this.document, nodes: this.document.nodes.map(node => node.id === id ? { ...node, text } : node) }; validateMindMapDocument(next); if (this.gesture?.kind !== 'text' || this.gesture.id !== id) { this.finish(); this.gesture = { before: this.document, id, kind: 'text' } }; this.update(next) }
  reparent(id: string, parentId: string) { if (this.ready && !this.exporting) this.commit(reparentMapNode(this.document, id, parentId)) }
  reorder(id: string, direction: -1 | 1) { if (this.ready && !this.exporting) this.commit(reorderMapNode(this.document, id, direction)) }
  remove(id: string) { if (!this.ready || this.exporting) return; this.commit(removeMapSubtree(this.document, id)); this.selectedId = null; this.notify() }
}

export type SelectionAction = 'explain' | 'translate' | 'summarize' | 'highlight'
export interface SelectionRect { left: number; top: number; right: number; bottom: number }
export interface SelectionSnapshot { paperId: string; page: number; text: string; rect: SelectionRect }
interface Size { width: number; height: number }
const validRect = (rect: SelectionRect) => [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) && rect.right > rect.left && rect.bottom > rect.top

/** Validate the captured context immediately before applying or sending an action. */
export function isCurrentSelection(selection: SelectionSnapshot | null, paperId: string | null, page: number): selection is SelectionSnapshot {
  return Boolean(selection && paperId && selection.paperId === paperId && Number.isSafeInteger(selection.page) && selection.page > 0 && selection.page === page && selection.text.trim() && selection.text.length <= 30000 && validRect(selection.rect))
}

/** Fixed-position coordinates use the visible part of the browser selection rectangle. */
export function positionSelectionToolbar(rect: SelectionRect, toolbar: Size, viewport: Size, margin = 10): { left: number; top: number; placement: 'above' | 'below' } | null {
  if (!validRect(rect) || ![toolbar.width, toolbar.height, viewport.width, viewport.height, margin].every(Number.isFinite) || margin < 0 || toolbar.width <= 0 || toolbar.height <= 0 || viewport.width <= margin * 2 || viewport.height <= margin * 2) return null
  if (rect.right <= 0 || rect.left >= viewport.width || rect.bottom <= 0 || rect.top >= viewport.height) return null
  const width = Math.min(toolbar.width, viewport.width - margin * 2)
  const height = Math.min(toolbar.height, viewport.height - margin * 2)
  const visibleLeft = Math.max(0, rect.left), visibleRight = Math.min(viewport.width, rect.right)
  const visibleTop = Math.max(0, rect.top), visibleBottom = Math.min(viewport.height, rect.bottom)
  const left = Math.max(margin, Math.min(viewport.width - margin - width, (visibleLeft + visibleRight - width) / 2))
  const above = visibleTop - margin - height
  const placement = above >= margin ? 'above' : 'below'
  const top = Math.max(margin, Math.min(viewport.height - margin - height, placement === 'above' ? above : visibleBottom + margin))
  return { left, top, placement }
}

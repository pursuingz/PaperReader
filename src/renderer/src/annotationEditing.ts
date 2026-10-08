import type { InkStroke } from '../../shared/types'

export type InkPoint = { x: number; y: number }
export type InkBounds = { width: number; height: number }
const distanceToSegment = (p: InkPoint, a: InkPoint, b: InkPoint) => {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}
const cross = (a: InkPoint, b: InkPoint, c: InkPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
function segmentDistance(a: InkPoint, b: InkPoint, c: InkPoint, d: InkPoint) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b)
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return 0
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b))
}

/** Swept CSS-pixel hit testing catches fast drags as well as stationary taps. */
export function hitStroke(stroke: InkStroke, from: InkPoint, to: InkPoint, bounds: InkBounds, radius = 10, viewAspect = 1) {
  if (!(bounds.width > 0 && bounds.height > 0) || !stroke.points.length) return false
  const pixel = (p: InkPoint) => ({ x: p.x * bounds.width, y: p.y * bounds.height })
  const a = pixel(from), b = pixel(to)
  // SVG strokes transform with the page/pad; the larger axis conservatively includes their visible edge.
  const reach = radius + stroke.width * Math.max(bounds.width, bounds.height / viewAspect) / 2
  return stroke.points.some((point, index) => segmentDistance(a, b, pixel(point), pixel(stroke.points[Math.max(0, index - 1)])) <= reach)
}

export function validateInk(strokes: InkStroke[]) {
  if (strokes.length > 1000 || strokes.some(stroke => stroke.points.length > 10000) || strokes.reduce((count, stroke) => count + stroke.points.length, 0) > 200000) throw new Error('Drawing is full (1,000 strokes / 200,000 points). Existing ink is preserved.')
  for (const stroke of strokes) if (!stroke.points.length || stroke.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) throw new Error('Ink coordinates must remain within their original page or pad.')
}

type StrokeEdit<T> = { added: T[]; removed: T[] }
/** Immutable stroke objects, stable ranks and per-surface histories avoid cross-page reorder. */
export class StrokeHistory<T extends InkStroke> {
  value: T[] = []
  private ranks = new Map<string, number>()
  private nextRank = 0
  private past = new Map<number, StrokeEdit<T>[]>()
  private future = new Map<number, StrokeEdit<T>[]>()
  private erasing: { page: number; removed: T[] } | null = null
  constructor(private pageOf: (stroke: T) => number, private aspect = 1) {}
  reset(strokes: T[]) {
    this.value = structuredClone(strokes); this.ranks.clear(); this.nextRank = 0; this.past.clear(); this.future.clear(); this.erasing = null
    for (const stroke of this.value) { this.ranks.set(stroke.id, this.nextRank++); this.record(this.pageOf(stroke), { added: [stroke], removed: [] }) }
  }
  private record(page: number, edit: StrokeEdit<T>) {
    const history = this.past.get(page) ?? []
    history.push(edit); this.past.set(page, history); this.future.delete(page)
  }
  add(stroke: T) {
    this.finishErase()
    if (this.value.some(item => item.id === stroke.id)) return false
    validateInk([...this.value, stroke])
    const copy = structuredClone(stroke)
    this.ranks.set(copy.id, this.nextRank++); this.value = [...this.value, copy]
    this.record(this.pageOf(copy), { added: [copy], removed: [] }); return true
  }
  beginErase(page: number) { if (this.erasing) return false; this.erasing = { page, removed: [] }; return true }
  erase(from: InkPoint, to: InkPoint, bounds: InkBounds) {
    if (!this.erasing) return false
    const erased = this.value.filter(stroke => this.pageOf(stroke) === this.erasing!.page && hitStroke(stroke, from, to, bounds, 10, this.aspect))
    if (!erased.length) return false
    this.erasing.removed.push(...erased)
    const ids = new Set(erased.map(stroke => stroke.id)); this.value = this.value.filter(stroke => !ids.has(stroke.id)); return true
  }
  finishErase() {
    const gesture = this.erasing; this.erasing = null
    if (!gesture?.removed.length) return false
    this.record(gesture.page, { added: [], removed: gesture.removed }); return true
  }
  canUndo(page: number) { return !this.erasing && Boolean(this.past.get(page)?.length) }
  canRedo(page: number) { return !this.erasing && Boolean(this.future.get(page)?.length) }
  private apply(edit: StrokeEdit<T>, backwards: boolean) {
    const remove = new Set((backwards ? edit.added : edit.removed).map(stroke => stroke.id))
    const added = backwards ? edit.removed : edit.added
    const next = [...this.value.filter(stroke => !remove.has(stroke.id)), ...added].sort((a, b) => this.ranks.get(a.id)! - this.ranks.get(b.id)!)
    validateInk(next); this.value = next
  }
  undo(page: number) {
    if (!this.canUndo(page)) return false
    const history = this.past.get(page)!, edit = history.at(-1)!
    this.apply(edit, true); history.pop(); this.future.set(page, [...this.future.get(page) ?? [], edit]); return true
  }
  redo(page: number) {
    if (!this.canRedo(page)) return false
    const history = this.future.get(page)!, edit = history.at(-1)!
    this.apply(edit, false); history.pop(); this.past.set(page, [...this.past.get(page) ?? [], edit]); return true
  }
}

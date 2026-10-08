export interface ReadingLocation {
  paperId: string | null
  page: number
  view: 'reader' | 'summary'
  zoom: number
  scrollTop: number
  scrollLeft: number
}
export type HistoryDirection = 'back' | 'forward'

const welcome = (): ReadingLocation => ({ paperId: null, page: 1, view: 'reader', zoom: 100, scrollTop: 0, scrollLeft: 0 })
const sameVisit = (left: ReadingLocation, right: ReadingLocation) => left.paperId === right.paperId && left.page === right.page && left.view === right.view
function snapshot(value: ReadingLocation): ReadingLocation {
  if (!value || typeof value !== 'object' ||
    !(value.paperId === null || (typeof value.paperId === 'string' && value.paperId.trim().length > 0)) ||
    !Number.isSafeInteger(value.page) || value.page < 1 || (value.view !== 'reader' && value.view !== 'summary') ||
    !Number.isFinite(value.zoom) || value.zoom <= 0 ||
    !Number.isFinite(value.scrollTop) || value.scrollTop < 0 || !Number.isFinite(value.scrollLeft) || value.scrollLeft < 0) throw new Error('Invalid reading history location')
  return { paperId: value.paperId, page: value.page, view: value.view, zoom: value.zoom, scrollTop: value.scrollTop, scrollLeft: value.scrollLeft }
}

/** Session-only navigation. The caller commits a traversal after saving/loading succeeds. */
export class ReadingHistory {
  private entries: ReadingLocation[]
  private cursor = 0

  constructor(initial: ReadingLocation = welcome()) { this.entries = [snapshot(initial)] }
  get current(): ReadingLocation { return { ...this.entries[this.cursor] } }
  get length(): number { return this.entries.length }
  get canBack(): boolean { return this.cursor > 0 }
  get canForward(): boolean { return this.cursor < this.entries.length - 1 }
  update(position: ReadingLocation): void {
    const next = snapshot(position)
    if (!sameVisit(this.entries[this.cursor], next)) throw new Error('Use visit to change the reading history location')
    this.entries[this.cursor] = next
  }
  visit(position: ReadingLocation): void {
    const next = snapshot(position)
    if (sameVisit(this.entries[this.cursor], next)) { this.entries[this.cursor] = next; return }
    this.entries = [...this.entries.slice(0, this.cursor + 1), next].slice(-100)
    this.cursor = this.entries.length - 1
  }
  peek(direction: HistoryDirection): ReadingLocation | null {
    if (direction !== 'back' && direction !== 'forward') throw new Error('Invalid reading history direction')
    const target = this.cursor + (direction === 'back' ? -1 : 1)
    return target < 0 || target >= this.entries.length ? null : { ...this.entries[target] }
  }
  commit(direction: HistoryDirection): ReadingLocation | null {
    const position = this.peek(direction)
    if (!position) return null
    this.cursor += direction === 'back' ? -1 : 1
    return position
  }
}

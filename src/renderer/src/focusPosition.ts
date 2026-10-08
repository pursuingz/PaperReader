export interface FocusPosition {
  paperId: string
  page: number
  top: number
  left: number
  fullscreen: boolean
}
type Schedule = (task: () => void) => () => void
const afterLayout: Schedule = task => { const timer = setTimeout(task, 120); return () => clearTimeout(timer) }

/** Retain a reading position across native/layout changes until its final raster settles. */
export class RenderPositionRestore<T extends { fullscreen: boolean }> {
  private anchor: T | null = null
  private confirmed = false
  private ready = false
  private version = 0
  private stop: (() => void) | null = null
  constructor(private apply: (value: T) => boolean, private schedule: Schedule = afterLayout) {}
  get generation() { return this.version }
  get pending(): T | null { return this.anchor ? { ...this.anchor } : null }
  begin(value: T) {
    this.cancel(); this.anchor = { ...value }; this.confirmed = false; this.ready = false
  }
  confirm(fullscreen: boolean) {
    if (!this.anchor || this.anchor.fullscreen !== fullscreen) return
    this.confirmed = true; this.queue()
  }
  layout(widthChanged: boolean) {
    if (widthChanged) { ++this.version; this.ready = false }
    this.queue()
  }
  rendered(generation: number) {
    if (!this.anchor || generation !== this.version) return
    this.ready = true; this.queue()
  }
  cancel() {
    this.stop?.(); this.stop = null; this.anchor = null; this.confirmed = false; this.ready = false
  }
  private queue() {
    this.stop?.(); this.stop = null
    if (!this.anchor || !this.confirmed || !this.ready) return
    const generation = this.version, anchor = this.anchor
    this.stop = this.schedule(() => {
      this.stop = null
      if (this.anchor === anchor && this.confirmed && this.ready && this.version === generation && this.apply({ ...anchor })) this.cancel()
    })
  }
}
export class FocusPositionRestore extends RenderPositionRestore<FocusPosition> {}

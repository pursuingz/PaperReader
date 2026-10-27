export interface PdfFrame {
  id: number
  file: object | undefined
  page: number
  width: number
  pixelRatio: number
}
export type PdfFramePart = 'canvas' | 'text' | 'annotations'

/** Retain one completed preview while exactly one target frame renders. */
export class PdfFrameBuffer {
  private target: PdfFrame | null = null
  private parts = new Set<PdfFramePart>()
  private failed = false
  displayed: PdfFrame | null = null

  request(frame: PdfFrame): PdfFrame {
    if (this.target?.id === frame.id) return this.target
    if (this.displayed?.file !== frame.file) this.displayed = null
    this.target = frame
    this.parts.clear()
    this.failed = false
    return frame
  }

  get frames(): PdfFrame[] {
    if (!this.target) return []
    return this.displayed && this.displayed.id !== this.target.id ? [this.displayed, this.target] : [this.target]
  }

  complete(id: number, part: PdfFramePart): boolean {
    if (!this.target || id !== this.target.id || this.failed || this.displayed === this.target) return false
    this.parts.add(part)
    if (this.parts.size !== 3) return false
    this.displayed = this.target
    return true
  }

  fail(id: number): boolean {
    if (id !== this.target?.id || this.failed) return false
    this.failed = true
    this.parts.clear()
    return true
  }

  interactive(id: number): boolean {
    return Boolean(!this.failed && this.target?.id === id && this.displayed === this.target)
  }
}


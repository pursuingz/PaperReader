import { NOTE_CHARACTER_LIMIT } from '../noteAdoption'

/** Holds the exact stored source until an actual editing transaction changes it. */
export class MarkdownNoteState {
  private visualDirty = false
  private composing = false
  private compositionWaiters: Array<() => void> = []
  constructor(public value: string, private changed: (value: string) => void) {}
  captureVisual(value: string): boolean {
    if (!this.visualDirty || this.composing) return false
    this.visualDirty = false
    this.publish(value)
    return true
  }
  markVisualChange(): void { this.visualDirty = true }
  captureSource(value: string): boolean {
    if (value.length > NOTE_CHARACTER_LIMIT) return false
    this.visualDirty = false
    this.publish(value)
    return true
  }
  acceptExternal(value: string): boolean {
    if (value === this.value) return false
    this.value = value
    this.visualDirty = false
    return true
  }
  beginComposition(): void { this.composing = true }
  endComposition(): void {
    this.composing = false
    for (const resolve of this.compositionWaiters.splice(0)) resolve()
  }
  waitForComposition(): Promise<void> {
    return this.composing ? new Promise(resolve => this.compositionWaiters.push(resolve)) : Promise.resolve()
  }
  private publish(value: string): void {
    if (value === this.value) return
    this.value = value
    this.changed(value)
  }
}

/** Conservatively use source editing for constructs the visual schema cannot retain. */
export function visualMarkdownIssue(source: string): string | null {
  if (source.length > 200_000) return 'This long note uses Source mode to keep editing responsive.'
  if (/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.test(source)) return 'Front matter is preserved in Source mode.'
  let fence: { marker: string; length: number } | undefined
  const text = source.split(/\r?\n/).map(line => {
    const match = line.match(/^\s*(?:>\s*)?(`{3,}|~{3,})/)
    if (match) {
      if (!fence) fence = { marker: match[1][0], length: match[1].length }
      else if (match[1][0] === fence.marker && match[1].length >= fence.length) fence = undefined
      return ''
    }
    if (fence || /^(?: {4}|\t)/.test(line)) return ''
    return line.replace(/(`+)[\s\S]*?\1/g, '').replace(/\\\\/g, '').replace(/\\!/g, '')
  }).join('\n')
  if (/!\[|<\/?[A-Za-z][^>]*>|<!--|<!DOCTYPE/i.test(text)) return 'Images and raw HTML are preserved in Source mode; remote assets stay blocked.'
  if (/^\s{0,3}\[[^\]]+\]:|\[\^[^\]]+\]/m.test(text)) return 'Reference definitions and footnotes are preserved in Source mode.'
  if (/^\s*:::/m.test(text) || /\\[([]/.test(text)) return 'This extended Markdown syntax is preserved in Source mode.'
  return null
}

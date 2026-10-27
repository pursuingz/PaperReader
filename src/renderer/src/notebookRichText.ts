import { COLOR_PRESETS } from '../../shared/colors'
import type { RichTextBlock, RichTextDocument, RichTextRun } from '../../shared/notebookTypes'

export const notebookTextColors = COLOR_PRESETS.map(color => color.value)
export const notebookHighlights = COLOR_PRESETS.map(color => color.value)
const hex = /^#[0-9a-f]{6}$/i
const kinds = ['paragraph', 'heading', 'bullet', 'number'] as const
export const plainRichText = (text: string): RichTextDocument => ({ blocks: text.replace(/\r\n?/g, '\n').split('\n').map(text => ({ kind: 'paragraph', runs: [{ text }] })) })
export const richTextPlain = (value: RichTextDocument): string => value.blocks.map(block => block.runs.map(run => run.text).join('')).join('\n')
export function normalizeRichText(value: unknown): RichTextDocument {
  if (!value || typeof value !== 'object' || !('blocks' in value) || !Array.isArray(value.blocks) || !value.blocks.length || value.blocks.length > 2000) throw Error('Invalid rich text blocks')
  const blocks: RichTextBlock[] = value.blocks.map(raw => {
    if (!raw || typeof raw !== 'object' || !kinds.includes(raw.kind) || !Array.isArray(raw.runs) || raw.runs.length > 10000) throw Error('Invalid rich text block')
    const runs: RichTextRun[] = raw.runs.map((part: unknown) => {
      if (!part || typeof part !== 'object' || !('text' in part) || typeof part.text !== 'string') throw Error('Invalid rich text run')
      const input = part as Record<string, unknown>, run: RichTextRun = { text: part.text }
      for (const key of ['bold', 'italic', 'underline'] as const) if (typeof input[key] === 'boolean' && input[key]) run[key] = true
      for (const key of ['color', 'highlight'] as const) if (typeof input[key] === 'string' && hex.test(input[key])) run[key] = input[key].toLowerCase()
      return run
    })
    return { kind: raw.kind, runs: runs.length ? runs : [{ text: '' }] }
  })
  if (richTextPlain({ blocks }).length > 100000) throw Error('Rich text exceeds the 100,000 character limit')
  return { blocks }
}
export function markRichText(value: RichTextDocument, from: number, to: number, mark: Partial<Omit<RichTextRun, 'text'>>): RichTextDocument {
  let offset = 0
  const blocks = value.blocks.map(block => {
    const runs: RichTextRun[] = []
    for (const run of block.runs) {
      const start = Math.max(0, from - offset), end = Math.min(run.text.length, to - offset)
      if (start < end) {
        if (start > 0) runs.push({ ...run, text: run.text.slice(0, start) })
        runs.push({ ...run, ...mark, text: run.text.slice(start, end) })
        if (end < run.text.length) runs.push({ ...run, text: run.text.slice(end) })
      } else runs.push({ ...run })
      offset += run.text.length
    }
    offset++
    return { ...block, runs }
  })
  return normalizeRichText({ blocks })
}
export interface RichFragment extends RichTextRun { x: number; width: number; fontSize: number; marker?: boolean }
export interface RichLine { y: number; height: number; fragments: RichFragment[] }
export type RichMeasure = (text: string, run: RichTextRun, fontSize: number) => number
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
export function layoutRichText(value: RichTextDocument, fontSize: number, width: number, measure: RichMeasure): { lines: RichLine[]; height: number; overflowWidth: boolean } {
  const lines: RichLine[] = []; let y = 0, numbering = 0, overflowWidth = false
  for (const block of value.blocks) {
    const size = block.kind === 'heading' ? fontSize * 1.25 : fontSize, height = size * 1.5
    const marker = block.kind === 'bullet' ? '• ' : block.kind === 'number' ? String(++numbering) + '. ' : ''
    if (block.kind !== 'number') numbering = 0
    const markerRun: RichTextRun = { text: marker }, indent = marker ? measure(marker, markerRun, size) : 0
    let line: RichLine = { y, height, fragments: [] }, x = indent
    if (marker) line.fragments.push({ ...markerRun, x: 0, width: indent, fontSize: size, marker: true })
    const push = () => { lines.push(line); y += height; line = { y, height, fragments: [] }; x = indent }
    for (const raw of block.runs) {
      const run = { ...raw, ...(block.kind === 'heading' ? { bold: true } : {}) }
      for (const { segment } of segmenter.segment(raw.text.replace(/\r\n?/g, '\n'))) {
        if (segment === '\n') { push(); continue }
        const measured = measure(segment, run, size)
        if (x > indent && x + measured > width) push()
        if (x + measured > width) overflowWidth = true
        const previous = line.fragments.at(-1)
        const same = previous && !previous.marker && previous.bold === run.bold && previous.italic === run.italic && previous.underline === run.underline && previous.color === run.color && previous.highlight === run.highlight
        if (same) { previous.text += segment; previous.width += measured }
        else line.fragments.push({ ...run, text: segment, x, width: measured, fontSize: size })
        x += measured
      }
    }
    push(); y += fontSize * .25
  }
  return { lines, height: y, overflowWidth }
}
export const richFont = (run: RichTextRun, size: number) => `${run.italic ? 'italic ' : ''}${run.bold ? 'bold ' : ''}${size}px Georgia, "Segoe UI", serif`
let measurement: CanvasRenderingContext2D | null = null
export function measureNotebookText(text: string, run: RichTextRun, size: number): number {
  if (typeof document !== 'undefined') {
    measurement ??= document.createElement('canvas').getContext('2d')
    if (measurement) { measurement.font = richFont(run, size); return measurement.measureText(text).width }
  }
  return Array.from(text).reduce((sum, char) => sum + (/^[\x20-\x7e]$/.test(char) ? size * .62 : size), 0)
}
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
export function richTextHtml(value: RichTextDocument): string {
  return value.blocks.map(block => {
    const tag = block.kind === 'heading' ? 'h2' : 'div', attribute = block.kind === 'bullet' || block.kind === 'number' ? ` data-kind="${block.kind}"` : ''
    return `<${tag}${attribute}>${block.runs.map(run => {
      const style = [run.bold && 'font-weight:bold', run.italic && 'font-style:italic', run.underline && 'text-decoration:underline', run.color && `color:${run.color}`, run.highlight && `background-color:${run.highlight}`].filter(Boolean).join(';')
      return `<span${style ? ` style="${style}"` : ''}>${escape(run.text).replace(/\n/g, '<br>')}</span>`
    }).join('') || '<br>'}</${tag}>`
  }).join('')
}
function domColor(value: string): string | undefined {
  if (hex.test(value)) return value.toLowerCase()
  const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(value)
  return rgb && rgb.slice(1).every(n => Number(n) <= 255) ? '#' + rgb.slice(1).map(n => Number(n).toString(16).padStart(2, '0')).join('') : undefined
}
/** Build only typed text marks; scripts, remote media and arbitrary CSS never enter the model. */
export function richTextFromDom(root: HTMLElement | DocumentFragment): RichTextDocument {
  const blocks: RichTextBlock[] = []
  const ignored = new Set(['SCRIPT', 'STYLE', 'IMG', 'IFRAME', 'OBJECT', 'SVG', 'VIDEO', 'AUDIO'])
  function inline(node: Node, inherited: Omit<RichTextRun, 'text'>, out: RichTextRun[]) {
    if (node.nodeType === 3) { if (node.textContent) out.push({ text: node.textContent, ...inherited }); return }
    if (!(node instanceof HTMLElement) || ignored.has(node.tagName)) return
    if (node.tagName === 'BR') { out.push({ text: '\n', ...inherited }); return }
    const mark = { ...inherited }
    if (['B', 'STRONG'].includes(node.tagName) || ['bold', '700'].includes(node.style.fontWeight)) mark.bold = true
    if (['I', 'EM'].includes(node.tagName) || node.style.fontStyle === 'italic') mark.italic = true
    if (node.tagName === 'U' || node.style.textDecoration.includes('underline')) mark.underline = true
    const color = domColor(node.style.color || node.getAttribute('color') || ''), highlight = domColor(node.style.backgroundColor)
    if (color) mark.color = color
    if (highlight) mark.highlight = highlight
    node.childNodes.forEach(child => inline(child, mark, out))
  }
  const blockTags = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI'])
  function visit(container: HTMLElement | DocumentFragment) {
    let pending: RichTextRun[] = []
    const emit = (kind: RichTextBlock['kind'], runs: RichTextRun[]) => {
      if (runs.length === 1 && runs[0].text === '\n') runs = [{ text: '' }]
      blocks.push({ kind, runs: runs.length ? runs : [{ text: '' }] })
    }
    const flush = () => { if (pending.length) { emit('paragraph', pending); pending = [] } }
    for (const node of container.childNodes) {
      if (node instanceof HTMLElement && ignored.has(node.tagName)) continue
      if (node instanceof HTMLElement && ['UL', 'OL'].includes(node.tagName)) { flush(); for (const child of node.children) { const runs: RichTextRun[] = []; inline(child, {}, runs); emit(node.tagName === 'OL' ? 'number' : 'bullet', runs) }; continue }
      if (node instanceof HTMLElement && blockTags.has(node.tagName)) {
        flush()
        if (Array.from(node.children).some(child => blockTags.has(child.tagName) || ['UL','OL'].includes(child.tagName))) { visit(node); continue }
        const runs: RichTextRun[] = []; inline(node, {}, runs)
        const kind = /^H\d$/.test(node.tagName) ? 'heading' : node.dataset.kind === 'bullet' || node.dataset.kind === 'number' ? node.dataset.kind : 'paragraph'
        emit(kind, runs)
      } else inline(node, {}, pending)
    }
    flush()
  }
  visit(root)
  return normalizeRichText({ blocks: blocks.length ? blocks : [{ kind: 'paragraph', runs: [{ text: '' }] }] })
}



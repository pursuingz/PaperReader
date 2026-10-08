import type { PaperTable, PaperTables } from '../../shared/types'
import { buildSourceEntries, positionedTextLines } from './sourceIndex'
export interface TableDocument { numPages: number; getPage(page: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup?(): unknown }> }
export const TABLE_EXTRACTION_LIMITS = { maxPages: 200, maxCharacters: 240000 }
interface Fragment { raw: string; x: number; y: number; width: number; height: number; valid: boolean }
interface Row { parts: Fragment[]; y: number; height: number; text: string }
const valueLike = (raw: string) => /^\s*(?:[-+−]?\d|[<>≤≥]\s*[-+−]?\d|[-+−]?\.\d)/.test(raw)
const noteLike = (raw: string) => /^(?:notes?\s*[:：]|[*†‡]|注\s*[:：])/i.test(raw)
const units = /^(?:%|s|ms|µs|μs|ns|min|h|Hz|kHz|MHz|GHz|W|mW|J|mJ|K|°C|kg|g|mm|cm|m|µm|μm|m\/s|m²|m\^2|bytes?|[KMGT]i?B|[GM]?FLOPs)$/i
function join(parts: Fragment[]): string {
  let text = '', right = 0
  for (const part of parts) {
    const gap = part.x - right
    const separator = text && gap > Math.max(.5, part.height * .12) && !/\s$/.test(text) && !/^\s|^[,.;:!?，。；：！？)]/.test(part.raw) ? ' ' : ''
    text += separator + part.raw; right = Math.max(right, part.x + part.width)
  }
  return text.trim()
}
function positionedRows(items: unknown[]): Row[] {
  const parts: Fragment[] = []
  for (const [index, unknown] of items.entries()) {
    if (!unknown || typeof unknown !== 'object' || !('str' in unknown) || typeof unknown.str !== 'string' || !unknown.str.trim()) continue
    const item = unknown as { str: string; transform?: number[]; width?: number; height?: number }
    const matrix = item.transform
    const geometry = Array.isArray(matrix) && matrix.length >= 6 && matrix.every(Number.isFinite)
    const valid = geometry && typeof item.width === 'number' && Number.isFinite(item.width) && item.width >= 0 && Math.abs(matrix![1]) < .01 && Math.abs(matrix![2]) < .01
    const height = typeof item.height === 'number' && Number.isFinite(item.height) && item.height > 0 ? item.height : 12
    parts.push({ raw: item.str, x: geometry ? matrix![4] : 0, y: geometry ? matrix![5] : -index * 16, width: valid ? item.width! : 0, height, valid })
  }
  parts.sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: Row[] = []
  for (const part of parts) {
    let row = rows[rows.length - 1]
    if (!row || Math.abs(row.y - part.y) > Math.max(2, Math.min(row.height, part.height) * .35)) { row = { parts: [], y: part.y, height: part.height, text: '' }; rows.push(row) }
    row.parts.push(part)
  }
  for (const row of rows) { row.parts.sort((a, b) => a.x - b.x); row.text = join(row.parts) }
  return rows
}
function headerParts(row: Row): Fragment[][] {
  const groups: Fragment[][] = []
  let right = -Infinity
  for (const part of row.parts) {
    if (!groups.length || part.x - right > Math.max(18, part.height * 1.5)) groups.push([])
    groups[groups.length - 1].push(part); right = Math.max(right, part.x + part.width)
  }
  return groups
}

/** Values come only from positioned source fragments; uncertain grids never receive fabricated cells. */
export function parsePageTables(items: unknown[], page: number): PaperTable[] {
  const rows = positionedRows(items)
  const sourceLines = positionedTextLines(items, page)
  const captions = buildSourceEntries(sourceLines).entries.filter(entry => entry.kind === 'table')
  const anchored = new Set<number>()
  const anchors = captions.map(caption => {
    const firstLine = caption.text.split('\n')[0]
    const lineIndex = sourceLines.findIndex((line, index) => !anchored.has(index) && line.text === firstLine)
    if (lineIndex >= 0) anchored.add(lineIndex)
    const line = sourceLines[lineIndex], row = line ? rows.findIndex(row => Math.abs(row.y - line.y) <= Math.max(2, line.height * .35)) : -1
    return { caption, row, x: line?.x ?? 0 }
  }).filter(value => value.row >= 0).sort((a, b) => a.row - b.row || a.x - b.x)
  return anchors.map(({ caption, row: start }, ordinal) => {
    const nearby = anchors.filter(anchor => Math.abs(anchor.x - anchors[ordinal].x) > 24 && Math.abs(rows[anchor.row].y - rows[start].y) <= 60)
    const parallel = nearby.length > 0
    const firstRow = parallel ? Math.min(start, ...nearby.map(anchor => anchor.row)) : start
    const lastRow = parallel ? Math.max(start, ...nearby.map(anchor => anchor.row)) : start
    const end = anchors.find(anchor => anchor.row > lastRow)?.row ?? rows.length, region = rows.slice(firstRow, end)
    const raw = region.map(row => row.text).join('\n')
    const table: PaperTable = { id: `table-${page}-${ordinal + 1}`, label: caption.label, page, columns: [], rows: [], notes: [], rawText: raw.slice(0, 16000), status: 'unsupported' }
    const reject = (reason: string) => { table.columns = []; table.rows = []; table.notes = []; table.status = 'unsupported'; table.reason = reason; return table }
    if (raw.length > 16000) return reject('Source text limit reached; this table is not exported as a partial grid.')
    if (parallel || anchors.filter(anchor => anchor.row === start).length > 1) return reject('Nearby captions occupy different horizontal regions. Side-by-side tables cannot be separated safely; both source texts are retained.')
    if (region.some(row => row.parts.some(part => !part.valid))) return reject('Missing or rotated text coordinates; OCR and rotated table extraction are not included.')
    let header = 1
    while (header < region.length && headerParts(region[header]).length < 2 && region[header - 1].y - region[header].y <= 60) header++
    if (header >= region.length || region[header - 1].y - region[header].y > 60) return reject('No stable multi-column header found below the caption. Image, bottom-caption and merged layouts need manual reading.')
    const groups = headerParts(region[header])
    if (groups.length < 2 || groups.length > 32 || groups.slice(1).some(group => valueLike(join(group)))) return reject('Ambiguous or merged header; multirow headers are not included.')
    if (groups.some(group => join(group).length > 500)) return reject('Header text limit reached; source labels were not shortened or invented.')
    const centres = groups.map(group => (group[0].x + group[group.length - 1].x + group[group.length - 1].width) / 2)
    const gaps = centres.slice(1).map((centre, index) => centre - centres[index]), spacing = Math.min(...gaps)
    if (spacing < 24) return reject('Columns are too close to separate reliably.')
    const cuts = centres.slice(1).map((centre, index) => (centre + centres[index]) / 2)
    const first = groups[0][0].x - 12, lastGroup = groups[groups.length - 1]
    const right = Math.max(lastGroup[lastGroup.length - 1].x + lastGroup[lastGroup.length - 1].width + 12, lastGroup[0].x + spacing * .8)
    table.columns = groups.map((group, index) => {
      const header = join(group), match = /(?:\(([^()]*)\)|\[([^\[\]]*)\])\s*$/.exec(header), unit = match ? (match[1] ?? match[2]).trim() : null
      return { id: `column-${index + 1}`, header, unit: unit && units.test(unit) ? unit : null }
    })
    let previous = region[header].y, numeric = false
    for (let index = header + 1; index < region.length; index++) {
      const row = region[index]
      if (previous - row.y > Math.max(36, row.height * 3)) break
      if (noteLike(row.text)) {
        if (table.notes.length >= 32 || row.text.length > 2000) return reject('Table note limit reached; source notes remain in the original text.')
        table.notes.push(row.text); previous = row.y; continue
      }
      if (table.notes.length) break
      if (table.rows.length && row.parts.length === 1 && !valueLike(row.text) && /[.。]$/.test(row.text) && row.text.split(/\s+/).length >= 6) break
      const cells: Fragment[][] = groups.map(() => [])
      for (const part of row.parts) {
        if (part.x < first || part.x + part.width > right + 12 || cuts.some(cut => part.x < cut - 8 && part.x + part.width > cut + 8)) return reject('A source fragment spans or lies outside the detected columns; merged or unstable cells are not reconstructed.')
        const centre = part.x + part.width / 2; let column = 0
        while (column < cuts.length && centre > cuts[column]) column++
        cells[column].push(part)
      }
      if (cells.some(cell => !cell.length)) {
        return reject('Rows do not align with all detected columns; missing cells are not filled or inferred.')
      }
      const values = cells.map(cell => ({ raw: join(cell) }))
      if (values.some(cell => cell.raw.length > 2000)) return reject('Cell text limit reached; source values were not shortened or invented.')
      if (!values.slice(1).some(cell => valueLike(cell.raw) || /^(?:—|–|-|n\/?a)$/i.test(cell.raw))) return reject('Ambiguous multirow header or nonnumeric grid; no experimental values were inferred.')
      if (table.rows.length >= 200) return reject('Row limit reached; this table is not exported as a partial grid.')
      numeric ||= values.slice(1).some(cell => valueLike(cell.raw)); table.rows.push(values); previous = row.y
    }
    if (!table.rows.length || !numeric) return reject('No aligned numeric source rows found; image-only tables need OCR, which is not included.')
    table.status = 'candidate'; return table
  })
}

export async function extractPaperTables(document: TableDocument, paperId: string, current: () => boolean, progress?: (page: number, total: number) => void, limits = TABLE_EXTRACTION_LIMITS): Promise<PaperTables> {
  if (!Number.isSafeInteger(document.numPages) || document.numPages < 1 || document.numPages > 100000) throw new Error('Invalid table PDF page count.')
  const check = () => { if (!current()) throw new Error('Table extraction cancelled.') }
  const result: PaperTables = { paperId, extractorVersion: 1, createdAt: new Date().toISOString(), pageCount: document.numPages, indexedPages: [], textlessPages: [], failedPages: [], limitReached: document.numPages > limits.maxPages, tables: [] }
  let characters = 0, savedText = 0, savedCells = 0
  for (let number = 1; number <= Math.min(document.numPages, limits.maxPages, 200); number++) {
    check(); let page: Awaited<ReturnType<TableDocument['getPage']>> | undefined
    try {
      page = await document.getPage(number); check(); const content = await page.getTextContent(); check()
      let length = 0, readable = false
      for (const item of content.items) {
        if (item && typeof item === 'object' && 'str' in item && typeof item.str === 'string') { length += item.str.length + 1; readable ||= !!item.str.trim() }
        if (characters + length > limits.maxCharacters) break
      }
      if (characters + length > limits.maxCharacters) { result.limitReached = true; break }
      characters += length
      if (readable) {
        result.indexedPages.push(number)
        for (const table of parsePageTables(content.items, number)) {
          const cells = table.rows.length * table.columns.length
          if (result.tables.length >= 200 || savedText + table.rawText.length > 240000 || savedCells + cells > 20000) { result.limitReached = true; break }
          savedText += table.rawText.length; savedCells += cells; result.tables.push(table); result.limitReached ||= /limit reached/i.test(table.reason ?? '')
        }
      } else result.textlessPages.push(number)
    } catch { check(); result.failedPages.push(number) }
    finally { try { page?.cleanup?.() } catch { /* Independent extraction may already have released its PDF resources. */ } }
    check(); progress?.(number, document.numPages)
  }
  check(); return result
}

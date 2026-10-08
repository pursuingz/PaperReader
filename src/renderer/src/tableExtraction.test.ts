import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePageTables, extractPaperTables, type TableDocument } from './tableExtraction'

const item = (str: string, x: number, y: number, width = str.length * 5) => ({ str, transform: [12, 0, 0, 12, x, y], height: 12, width })
export const tableItems = () => [
  item('Table 1. Experimental results', 50, 740),
  item('Method', 50, 700), item('Accuracy (%)', 190, 700), item('Time (s)', 330, 700),
  item('Baseline', 50, 680), item('98.00', 190, 680), item('1.2300 ± 0.004', 330, 680),
  item('Ours', 50, 660), item('99.10', 190, 660), item('−0.50', 330, 660),
  item('Note: values are reported as in the source.', 50, 630)
]

test('structured columns and source units retain decimal strings and uncertainty without numeric conversion', () => {
  const tables = parsePageTables(tableItems(), 1)
  assert.equal(tables.length, 1); const table = tables[0]
  assert.equal(table.status, 'candidate'); assert.equal(table.label, 'Table 1'); assert.equal(table.page, 1)
  assert.deepEqual(table.columns.map(column => [column.header, column.unit]), [['Method', null], ['Accuracy (%)', '%'], ['Time (s)', 's']])
  assert.deepEqual(table.rows.map(row => row.map(cell => cell.raw)), [['Baseline', '98.00', '1.2300 ± 0.004'], ['Ours', '99.10', '−0.50']])
  assert.equal(table.notes[0], 'Note: values are reported as in the source.')
  assert.match(table.rawText, /98\.00/); assert.match(table.rawText, /−0\.50/)
})

test('fragments inside a source cell are joined without moving values into a neighbouring column', () => {
  const items = tableItems().filter(value => value.str !== '1.2300 ± 0.004')
  items.push(item('1.2300', 330, 680, 35), item('±', 368, 680, 8), item('0.004', 380, 680, 30))
  const tables = parsePageTables(items.reverse(), 2)
  assert.deepEqual(tables[0].rows[0].map(cell => cell.raw), ['Baseline', '98.00', '1.2300 ± 0.004'])
})

test('unpositioned, unstable and merged-header tables retain source text without invented cells', () => {
  const cases = [
    [{ str: 'Table 2. Scanned or unpositioned grid' }, { str: 'Method 98.00 1.00' }],
    [item('Table 2. Results', 50, 740), item('Method', 50, 700), item('Score', 190, 700), item('A', 50, 680), item('5', 330, 680)],
    [item('Table 2. Results', 50, 740), item('All measurements', 50, 700, 260), item('A', 50, 680), item('5.00', 190, 680)]
  ]
  for (const items of cases) {
    const [table] = parsePageTables(items, 1)
    assert.equal(table.status, 'unsupported'); assert.deepEqual(table.columns, []); assert.deepEqual(table.rows, [])
    assert.ok(table.reason); assert.match(table.rawText, /Table 2/)
  }
})

test('body references and a number-containing paragraph never invent an experimental table', () => {
  assert.deepEqual(parsePageTables([item('Table 1 shows the findings.', 50, 740), item('The measured value was 98.00.', 50, 700)], 1), [])
})

test('ordinary paragraph text below a stable grid does not destroy its extracted values', () => {
  const items = tableItems().filter(value => !value.str.startsWith('Note:'))
  items.push(item('The following paragraph discusses the measured results and spans the page.', 50, 640, 480))
  const [table] = parsePageTables(items, 1)
  assert.equal(table.status, 'candidate'); assert.equal(table.rows.length, 2)
  assert.ok(table.rawText.includes('following paragraph'))
})

test('a missing-cell row rejects the whole grid and retains later source values for review', () => {
  const items = [item('Table 1. Results', 50, 740), item('Method', 50, 700), item('Score', 190, 700), item('A', 50, 680), item('98.00', 190, 680), item('B', 50, 660), item('C', 50, 640), item('99.00', 190, 640)]
  const [table] = parsePageTables(items, 1)
  assert.equal(table.status, 'unsupported'); assert.deepEqual(table.rows, []); assert.deepEqual(table.columns, [])
  assert.match(table.rawText, /\nB\n/); assert.match(table.rawText, /C 99\.00/)
})

test('body mention above a genuine caption cannot capture that caption source anchor', () => {
  const [table] = parsePageTables([item('Table 1 shows that our approach performs well.', 50, 780), ...tableItems()], 1)
  assert.equal(table.status, 'candidate'); assert.equal(table.rows.length, 2)
  assert.ok(!table.rawText.startsWith('Table 1 shows'))
})

test('parallel table captions retain both identities as unsupported rather than merge four columns', () => {
  const items = [item('Table 1. Left results', 50, 740), item('Table 2. Right results', 340, 740), item('Method', 50, 700), item('Score', 140, 700), item('Method', 340, 700), item('Score', 430, 700), item('A', 50, 680), item('98', 140, 680), item('B', 340, 680), item('99', 430, 680)]
  const tables = parsePageTables(items, 1)
  assert.deepEqual(tables.map(table => table.label), ['Table 1', 'Table 2'])
  assert.ok(tables.every(table => table.status === 'unsupported' && !table.rows.length && !table.columns.length))
  assert.ok(tables.every(table => table.rawText.includes('98') && table.rawText.includes('99')))
})

test('staggered parallel captions cannot make the lower caption claim a merged four-column grid', () => {
  const items = [item('Table 1. Left results', 50, 750), item('Table 2. Right results', 340, 740), item('Method', 50, 700), item('Score', 180, 700), item('Method', 340, 700), item('Score', 470, 700), item('A', 50, 680), item('98', 180, 680), item('B', 340, 680), item('99', 470, 680)]
  const tables = parsePageTables(items, 1)
  assert.deepEqual(tables.map(table => table.label), ['Table 1', 'Table 2'])
  assert.ok(tables.every(table => table.status === 'unsupported' && !table.rows.length && !table.columns.length))
  assert.ok(tables.every(table => table.rawText.includes('98') && table.rawText.includes('99')))
})

test('notes/header/cell limits return a compliant unsupported record instead of an unsavable cache', () => {
  const base = tableItems().filter(value => !value.str.startsWith('Note:'))
  const cases = [
    [...base, ...Array.from({ length: 33 }, (_, index) => item(`Note: ${index}`, 50, 630 - index * 12))],
    base.map(value => value.str === 'Accuracy (%)' ? item('x'.repeat(501), 190, 700, 70) : value),
    base.map(value => value.str === '98.00' ? item('1'.repeat(2001), 190, 680, 70) : value),
    [...base, item('Note: ' + 'x'.repeat(2001), 50, 630, 400)]
  ]
  for (const items of cases) {
    const [table] = parsePageTables(items, 1)
    assert.equal(table.status, 'unsupported'); assert.deepEqual(table.rows, []); assert.deepEqual(table.columns, []); assert.deepEqual(table.notes, [])
    assert.match(table.reason ?? '', /limit/i); assert.ok(table.rawText.length <= 16000)
  }
})

test('a page with two table captions preserves separate grids and source identities', () => {
  const items = [...tableItems(), ...tableItems().map(value => ({ ...value, str: value.str.replace('Table 1.', 'Table 2.'), transform: [12, 0, 0, 12, value.transform[4], value.transform[5] - 220] }))]
  const tables = parsePageTables(items, 1)
  assert.equal(tables.length, 2); assert.notEqual(tables[0].id, tables[1].id)
  assert.deepEqual(tables.map(table => table.label), ['Table 1', 'Table 2'])
  assert.deepEqual(tables.map(table => table.rows.length), [2, 2])
})

test('repeated caption labels use distinct source positions instead of creating an empty cache record', () => {
  const items = [...tableItems(), ...tableItems().map(value => ({ ...value, transform: [12, 0, 0, 12, value.transform[4], value.transform[5] - 220] }))]
  const tables = parsePageTables(items, 1)
  assert.equal(tables.length, 2); assert.deepEqual(tables.map(table => table.status), ['candidate', 'candidate'])
  assert.deepEqual(tables.map(table => table.rows.length), [2, 2]); assert.ok(tables.every(table => table.rawText.trim()))
})

test('aggregate cell limits retain bounded candidates and disclose omitted grids before saving', async () => {
  const dense = (page: number) => [item(`Table ${page}. Measurements`, 50, 6000), ...Array.from({ length: 32 }, (_, col) => item(col ? `M${col}` : 'Method', 50 + col * 50, 5970, 20)), ...Array.from({ length: 200 }, (_, row) => Array.from({ length: 32 }, (_, col) => item(col ? '1' : 'A', 50 + col * 50, 5950 - row * 20, 5))).flat()]
  const document: TableDocument = { numPages: 4, getPage: async page => ({ getTextContent: async () => ({ items: dense(page) }) }) }
  const result = await extractPaperTables(document, 'paper-a', () => true)
  assert.equal(result.limitReached, true); assert.equal(result.tables.length, 3)
  assert.equal(result.tables.reduce((count, table) => count + table.rows.length * table.columns.length, 0), 19200)
  assert.deepEqual(result.indexedPages, [1, 2, 3, 4])
})

test('extraction scans all bounded pages, reports failed/textless coverage and releases each page', async () => {
  const cleaned: number[] = []
  const document: TableDocument = { numPages: 3, async getPage(page) { if (page === 3) throw new Error('bad page'); return { getTextContent: async () => ({ items: page === 1 ? tableItems() : [] }), cleanup() { cleaned.push(page) } } } }
  const tables = await extractPaperTables(document, 'paper-a', () => true)
  assert.deepEqual(tables.indexedPages, [1]); assert.deepEqual(tables.textlessPages, [2]); assert.deepEqual(tables.failedPages, [3])
  assert.equal(tables.limitReached, false); assert.equal(tables.tables[0].rows[0][1].raw, '98.00'); assert.deepEqual(cleaned, [1, 2])
})

test('page/character limits and cancellation cannot claim unvisited content as extracted', async () => {
  let cleaned = 0, alive = true
  const document: TableDocument = { numPages: 3, async getPage() { return { getTextContent: async () => ({ items: tableItems() }), cleanup() { cleaned++ } } } }
  const limited = await extractPaperTables(document, 'paper-a', () => true, undefined, { maxPages: 1, maxCharacters: 240000 })
  assert.equal(limited.limitReached, true); assert.deepEqual(limited.indexedPages, [1])
  const byChars = await extractPaperTables(document, 'paper-a', () => true, undefined, { maxPages: 200, maxCharacters: 3 })
  assert.equal(byChars.limitReached, true); assert.deepEqual(byChars.indexedPages, []); assert.deepEqual(byChars.tables, [])
  await assert.rejects(extractPaperTables(document, 'paper-a', () => alive, () => { alive = false }), /cancel/i)
  assert.equal(cleaned, 3)
})

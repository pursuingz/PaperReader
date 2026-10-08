import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSourceEntries, positionedTextLines, extractSourceIndex, type SourceLine, type SourceDocument } from './sourceIndex'

const line = (text: string, page = 1, y = 700): SourceLine => ({ text, page, x: 50, y, height: 12 })
const item = (str: string, x = 50, y = 700, width = str.length * 6) => ({ str, transform: [12, 0, 0, 12, x, y], width, height: 12 })

test('positioned fragments reconstruct caption lines and keep separate columns apart', () => {
  const lines = positionedTextLines([item('Figure', 50), item('1.', 92), item('First caption', 112), item('continued here', 50, 684), item('Other column', 330, 700)], 1)
  assert.deepEqual(lines.map(value => value.text), ['Figure 1. First caption', 'continued here', 'Other column'])
})

test('original whitespace survives adjoining PDF text fragments and still identifies a caption', () => {
  const lines = positionedTextLines([item('Figure ', 50, 700, 42), item('1. Original caption', 92)], 1)
  assert.equal(lines[0].text, 'Figure 1. Original caption')
  assert.equal(buildSourceEntries(lines).entries[0].kind, 'figure')
})

test('stable column starts keep narrow gutters from mixing right-column body into a caption', () => {
  const lines = positionedTextLines([
    item('Figure 1. This line reaches the gutter', 50, 700, 245), item('Unrelated right column paragraph.', 313, 700, 250),
    item('Left continuation.', 50, 684, 150), item('Further unrelated right column.', 313, 684, 250)
  ], 1)
  const result = buildSourceEntries(lines)
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].text, 'Figure 1. This line reaches the gutter\nLeft continuation.')
})

test('caption candidates retain multiline original text but exclude see-Fig body references', () => {
  const result = buildSourceEntries([line('As shown in Fig. 1, the effect is clear.'), line('Figure 1. Original finding', 1, 660), line('continued with uncertainty.', 1, 644), line('2. Discussion', 1, 600), line('Table 2: Measured results', 2), line('图3：原始结果', 3), line('表 4. 对照实验', 3, 650)])
  assert.deepEqual(result.entries.map(value => [value.kind, value.label, value.text, value.pages]), [
    ['figure', 'Figure 1', 'Figure 1. Original finding\ncontinued with uncertainty.', [1]],
    ['table', 'Table 2', 'Table 2: Measured results', [2]],
    ['figure', '图3', '图3：原始结果', [3]],
    ['table', '表 4', '表 4. 对照实验', [3]]
  ])
  assert.equal(new Set(result.entries.map(value => value.id)).size, 4)
})

test('numbered references retain multiline and cross-page source provenance', () => {
  const result = buildSourceEntries([line('References', 2), line('[1] First author. Original title.', 2, 670), line('Journal 2024.', 2, 654), line('continued publication information.', 3), line('[2] Second author. Another title.', 3, 660), line('Appendix A', 3, 600), line('This is not a bibliography item.', 3, 570)])
  assert.deepEqual(result.entries.map(value => [value.kind, value.text, value.pages]), [
    ['reference', '[1] First author. Original title.\nJournal 2024.\ncontinued publication information.', [2, 3]],
    ['reference', '[2] Second author. Another title.', [3]]
  ])
})

test('unnumbered bibliography remains source-section text instead of invented individual references', () => {
  const result = buildSourceEntries([line('参考文献', 2), line('张三. 原始研究. 2020.', 2, 670), line('Smith, A. Original title. 2022.', 3)])
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].kind, 'reference-section')
  assert.equal(result.entries[0].text, '参考文献\n张三. 原始研究. 2020.\nSmith, A. Original title. 2022.')
  assert.deepEqual(result.entries[0].pages, [2, 3])
})

test('source extraction distinguishes readable, textless and failed pages and always cleans pages', async () => {
  const cleaned: number[] = []
  const document: SourceDocument = { numPages: 3, async getPage(page) { if (page === 3) throw new Error('bad page'); return { getTextContent: async () => ({ items: page === 1 ? [item('Fig. 2. Caption')] : [] }), cleanup() { cleaned.push(page) } } } }
  const value = await extractSourceIndex(document, 'paper-1', () => true)
  assert.deepEqual(value.indexedPages, [1]); assert.deepEqual(value.textlessPages, [2]); assert.deepEqual(value.failedPages, [3]); assert.equal(value.limitReached, false)
  assert.deepEqual(value.entries[0].pages, [1]); assert.deepEqual(cleaned, [1, 2])
})

test('page and character limits report unvisited pages without claiming them indexed', async () => {
  let loaded = 0
  const document: SourceDocument = { numPages: 3, async getPage(page) { loaded++; return { getTextContent: async () => ({ items: [item(`Figure ${page}. Caption`)] }) } } }
  const byPages = await extractSourceIndex(document, 'paper-1', () => true, undefined, { maxPages: 1, maxCharacters: 240000 })
  assert.equal(byPages.limitReached, true); assert.deepEqual(byPages.indexedPages, [1]); assert.equal(loaded, 1)
  const byChars = await extractSourceIndex(document, 'paper-1', () => true, undefined, { maxPages: 200, maxCharacters: 3 })
  assert.equal(byChars.limitReached, true); assert.deepEqual(byChars.indexedPages, []); assert.deepEqual(byChars.entries, [])
})

test('entry bounds stop candidate accumulation and disclose truncation', () => {
  const entries = buildSourceEntries(Array.from({ length: 1001 }, (_, i) => line(`Figure ${i + 1}. Caption`, 1, 20000 - i * 20)))
  assert.equal(entries.entries.length, 1000); assert.equal(entries.limitReached, true)
  const long = buildSourceEntries([line('Figure 1. ' + 'x'.repeat(17000))])
  assert.equal(long.entries[0].text.length, 16000); assert.equal(long.limitReached, true)
})

test('body descriptions beginning with figure numbering are not mistaken for captions', () => {
  const result = buildSourceEntries([line('Figure 1 shows the measurements.'), line('图1显示了实验结果。', 1, 650), line('Fig. 2: Measurement overview', 1, 600)])
  assert.deepEqual(result.entries.map(value => value.label), ['Fig. 2'])
})

test('inconsistent reference numbering falls back to the original section and preserves all included pages', () => {
  const result = buildSourceEntries([line('Bibliography', 1), line('[1] A first source.', 1, 675), line('[7] A broken or incomplete numbering sequence.', 2)])
  assert.equal(result.entries.length, 1); assert.equal(result.entries[0].kind, 'reference-section')
  assert.deepEqual(result.entries[0].pages, [1, 2]); assert.match(result.entries[0].text, /\[7\]/)
})

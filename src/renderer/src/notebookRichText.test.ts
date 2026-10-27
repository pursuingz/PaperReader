import test from 'node:test'
import assert from 'node:assert/strict'
import type { RichTextDocument } from '../../shared/notebookTypes'
const modulePromise = import('./notebookRichText').catch(() => ({}))
async function rich() { const value = await modulePromise; assert.equal(typeof (value as any).layoutRichText, 'function', 'Structured rich text feature is missing'); return value as typeof import('./notebookRichText') }
test('partial formatting splits selected text while preserving Chinese characters and unrelated marks', async () => {
  const r = await rich(); const doc: RichTextDocument = { blocks: [{ kind: 'paragraph', runs: [{ text: '前中文后', italic: true }] }] }
  const marked = r.markRichText(doc, 1, 3, { bold: true, highlight: '#f3d653' })
  assert.deepEqual(marked.blocks[0].runs, [{ text: '前', italic: true }, { text: '中文', italic: true, bold: true, highlight: '#f3d653' }, { text: '后', italic: true }])
  assert.equal(r.richTextPlain(marked), '前中文后')
})
test('plain persistence uses paragraph newlines and sanitized marks never retain HTML or arbitrary CSS', async () => {
  const r = await rich()
  const cleaned = r.normalizeRichText({ blocks: [{ kind: 'heading', runs: [{ text: 'Title', bold: true, color: '#334155', onclick: 'evil()', style: 'position:fixed', highlight: 'url(https://bad)' }] }, { kind: 'bullet', runs: [{ text: '<script>literal text</script>' }] }] })
  assert.equal(r.richTextPlain(cleaned), 'Title\n<script>literal text</script>')
  assert.deepEqual(cleaned.blocks[0].runs, [{ text: 'Title', bold: true, color: '#334155' }])
  assert.throws(() => r.normalizeRichText({ blocks: [{ kind: 'table', runs: [] }] }), /block/i)
})
test('layout preserves every character and run style instead of clipping at a text box height', async () => {
  const r = await rich(); const doc: RichTextDocument = { blocks: [{ kind: 'heading', runs: [{ text: 'AB', bold: true }] }, { kind: 'bullet', runs: [{ text: '中文😀X', underline: true, highlight: '#f3d653' }] }] }
  const layout = r.layoutRichText(doc, 20, 40, text => Array.from(text).length * 10)
  assert.equal(layout.lines.flatMap(line => line.fragments.filter(f => !f.marker).map(f => f.text)).join(''), 'AB中文😀X')
  assert.ok(layout.height > 50)
  assert.ok(layout.lines.some(line => line.fragments.some(f => f.marker && f.text === '• ')))
  assert.ok(layout.lines.some(line => line.fragments.some(f => f.underline && f.highlight === '#f3d653')))
})


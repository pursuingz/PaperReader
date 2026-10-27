import test from 'node:test'
import assert from 'node:assert/strict'
import * as reading from './readingFeatures'

const doc = (pages: unknown[][]) => ({ numPages: pages.length, getPage: async (page: number) => ({ getTextContent: async () => ({ items: pages[page - 1] }) }) })
const structuredItems = [{ str: '1 Introduction', hasEOL: true }, { str: 'We study recon-', hasEOL: true }, { str: 'struction with 64 samples.', hasEOL: true }, { str: '', hasEOL: true }, { str: '2 Methods', hasEOL: true }, { str: 'We optimize' }, { str: 'the field.', hasEOL: true }]

test('default extraction keeps its original byte output including item spaces and ignored EOL', async () => {
  const expected = '1 Introduction We study recon- struction with 64 samples.  2 Methods We optimize the field.'
  assert.deepEqual(await reading.extractAllPages(doc([structuredItems]), () => true), [{ page: 1, text: expected }])
  const odd = [{ str: '  before' }, {}, { str: '' }, { str: 'after  ' }, { str: 0 }]
  assert.equal((await reading.extractAllPages(doc([odd]), () => true))[0].text, 'before   after   0')
})

test('Summary alone retains heading, line and explicit paragraph boundaries without rewriting words', async () => {
  const pages = await reading.extractSummaryPages(doc([structuredItems]), () => true)
  assert.equal(pages[0].text, '1 Introduction\nWe study recon-\nstruction with 64 samples.\n\n2 Methods\nWe optimize the field.')
  assert.doesNotMatch(pages[0].text, /reconstruction/)
})

test('Summary preserves embedded paragraph breaks and PDF item order rather than sorting columns', async () => {
  const items = [{ str: 'Right column', transform: [1, 0, 0, 1, 300, 700], hasEOL: true }, { str: 'Left column\n\nOriginal paragraph', transform: [1, 0, 0, 1, 20, 700], hasEOL: true }, { str: 'x' }, { str: '=' }, { str: 'y' }]
  const pages = await reading.extractSummaryPages(doc([items]), () => true)
  assert.equal(pages[0].text, 'Right column\nLeft column\n\nOriginal paragraph\nx = y')
})

test('Summary keeps physical page indices, textless pages and progress', async () => {
  const progress: number[][] = []
  const pages = await reading.extractSummaryPages(doc([[{ str: 'Alpha', hasEOL: true }], [{ str: '', hasEOL: true }], [{ str: 'Omega' }]]), () => true, (page, total) => progress.push([page, total]))
  assert.deepEqual(pages, [{ page: 1, text: 'Alpha' }, { page: 2, text: '' }, { page: 3, text: 'Omega' }])
  assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]])
})

test('Summary retains the 200-page and 240000-character limits including inserted structure', async () => {
  let loads = 0
  await assert.rejects(reading.extractSummaryPages({ numPages: 201, getPage: async () => { loads++; throw Error('unexpected') } }, () => true), /200/)
  assert.equal(loads, 0)
  assert.equal((await reading.extractSummaryPages(doc([[{ str: 'x'.repeat(240000) }]]), () => true))[0].text.length, 240000)
  await assert.rejects(reading.extractSummaryPages(doc([[{ str: 'x'.repeat(239999), hasEOL: true }, { str: 'y' }]]), () => true), /240,000/)
  await assert.rejects(reading.extractSummaryPages(doc([[{ str: 'x'.repeat(120001) }], [{ str: 'y'.repeat(120000) }]]), () => true), /240,000/)
})

test('Summary cancellation is checked before loading and after text extraction', async () => {
  let loads = 0
  await assert.rejects(reading.extractSummaryPages({ numPages: 1, getPage: async () => { loads++; throw Error('unexpected') } }, () => false), /cancel/i)
  assert.equal(loads, 0)
  let alive = true
  await assert.rejects(reading.extractSummaryPages({ numPages: 2, getPage: async () => ({ getTextContent: async () => { alive = false; return { items: [{ str: 'stale', hasEOL: true }] } } }) }, () => alive), /cancel/i)
})

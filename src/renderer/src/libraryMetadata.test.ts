import test from 'node:test'
import assert from 'node:assert/strict'
import type { Paper } from '../../shared/types'
import { groupRecentLibrary, overlayLibraryMetadata, paperInformationInput } from './libraryMetadata'

function paper(id: string, importedAt: string, isDemo = false): Paper { return { id, title: id, fileName: `${id}.pdf`, category: 'Imported', importedAt, isDemo } }

test('recent groups follow local calendar dates across midnight rather than elapsed 24-hour intervals', () => {
  const now = new Date(2026, 9, 6, 0, 5)
  const values = [paper('yesterday', new Date(2026, 9, 5, 23, 58).toISOString()), paper('today-older', new Date(2026, 9, 6, 0, 1).toISOString()), paper('today-newer', new Date(2026, 9, 6, 0, 3).toISOString()), paper('earlier', new Date(2026, 9, 3, 15, 0).toISOString())]
  const groups = groupRecentLibrary(values, now, {version:1,lastOpenedAt:Object.fromEntries(values.map(p=>[p.id,p.importedAt]))})
  assert.deepEqual(groups.slice(0, 2).map(group => group.name), ['Today', 'Last 3 days'])
  assert.deepEqual(groups[0].papers.map(value => value.id), ['today-newer', 'today-older'])
  assert.deepEqual(groups[1].papers.map(value => value.id), ['yesterday'])
  assert.equal(groups[2].name, 'This month')
  assert.deepEqual(values.map(value => value.id), ['yesterday', 'today-older', 'today-newer', 'earlier'])
})

test('recent grouping keeps demo distinct, malformed dates readable and empty results empty', () => {
  const now = new Date(2026, 9, 6, 10)
  const groups = groupRecentLibrary([paper('broken', 'nonsense'), paper('demo-workspace', now.toISOString(), true), paper('imported', now.toISOString())], now, {version:1,lastOpenedAt:{imported:now.toISOString(),broken:'nonsense'}})
  assert.deepEqual(groups.map(group => group.name), ['Today', 'Earlier', 'Demonstration'])
  assert.deepEqual(groups[2].papers.map(value => value.id), ['demo-workspace'])
  assert.deepEqual(groupRecentLibrary([], now), [])
})

test('metadata overlay changes display fields only and leaves imported identity, dates and demo intact', () => {
  const values = [paper('paper-1', '2026-10-06T09:00:00Z'), paper('demo-workspace', '2026-10-05T09:00:00Z', true)]
  const result = overlayLibraryMetadata(values, { 'paper-1': { title: 'Corrected title', authors: 'Author', year: 2026 }, 'demo-workspace': { title: 'Never override sample', authors: '', year: null } })
  assert.equal(result[0].title, 'Corrected title'); assert.equal(result[0].authors, 'Author'); assert.equal(result[0].year, 2026)
  assert.equal(result[0].id, values[0].id); assert.equal(result[0].fileName, values[0].fileName); assert.equal(result[0].importedAt, values[0].importedAt)
  assert.equal(values[0].title, 'paper-1'); assert.equal(result[1].title, 'demo-workspace')
})

test('paper editor input requires title, treats blank year as null and rejects fractional or non-four-digit years', () => {
  assert.deepEqual(paperInformationInput('  A title  ', '  Author One; Author Two  ', ''), { title: 'A title', authors: 'Author One; Author Two', year: null })
  assert.equal(paperInformationInput('A title', '', ' 2026 ').year, 2026)
  for (const year of ['999', '10000', '2026.5', '2e3', '0000', '20xx']) assert.throws(() => paperInformationInput('A title', '', year), /year/i)
  assert.throws(() => paperInformationInput(' ', '', ''), /title/i)
  assert.throws(() => paperInformationInput('x'.repeat(301), '', ''), /title/i)
  assert.throws(() => paperInformationInput('Title', 'x'.repeat(1001), ''), /author/i)
  assert.throws(() => paperInformationInput('Title\nnext', '', ''), /title/i)
})

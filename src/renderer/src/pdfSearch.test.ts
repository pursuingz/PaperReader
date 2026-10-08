import test from 'node:test'
import assert from 'node:assert/strict'
import { searchPdfText, LocalPdfSearch, SearchResultNavigation, highlightSearchText, parsePageInput } from './pdfSearch'

const documentOf = (texts: string[]) => ({ numPages: texts.length, getPage: async (page: number) => ({ getTextContent: async () => ({ items: [{ str: texts[page - 1] }] }) }) })

test('reopening search preserves a manually selected result; only a new completion navigates to the first page', async () => {
  const navigation = new SearchResultNavigation()
  const result = await searchPdfText(documentOf(['alpha', '', 'alpha']), 'alpha', () => true)
  let readerPage = navigation.takeInitialPage(result)!
  assert.equal(readerPage, 1)
  readerPage = 3 // Next result; the controller outlives the hidden result panel.
  const reopened = navigation.takeInitialPage(result)
  if (reopened !== null) readerPage = reopened
  assert.equal(readerPage, 3)
  assert.equal(navigation.takeInitialPage(result), null) // Summary -> Reader also remounts the panel.
  const repeatedQuery = await searchPdfText(documentOf(['alpha', '', 'alpha']), 'alpha', () => true)
  assert.equal(navigation.takeInitialPage(repeatedQuery), 1)
  navigation.reset()
  assert.equal(navigation.takeInitialPage(null), null)
  assert.equal(navigation.takeInitialPage(await searchPdfText(documentOf(['none']), 'alpha', () => true)), null)
})

test('local search includes the final page, returns matching pages, and reports blank coverage', async () => {
  const progress: number[] = []
  const result = await searchPdfText(documentOf(['Alpha alpha', '', 'Last ALPHA page']), 'alpha', () => true, page => { progress.push(page) })
  assert.deepEqual(result.matches.map(match => match.page), [1, 3])
  assert.deepEqual(result.blankPages, [2])
  assert.equal(result.scannedPages, 3)
  assert.equal(result.complete, true)
  assert.deepEqual(progress, [1, 2, 3])
})

test('search treats regex and HTML syntax as literal text and escapes highlighted content', async () => {
  const result = await searchPdfText(documentOf(['<script>A+B</script> [x]']), 'A+B', () => true)
  assert.equal(result.matches.length, 1)
  assert.equal(highlightSearchText('<script>A+B</script>', 'A+B'), '&lt;script&gt;<mark class="pdf-search-hit">A+B</mark>&lt;/script&gt;')
  assert.equal(highlightSearchText('<img onerror="alert(1)">', 'missing'), '&lt;img onerror=&quot;alert(1)&quot;&gt;')
  assert.equal(highlightSearchText('ABC', ''), 'ABC')
})

test('text fragments and whitespace form searchable phrases; snippets stay close to the first match', async () => {
  const document = { numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'x'.repeat(300) }, { str: 'special' }, { str: '  phrase' }, { str: 'tail' }] }) }) }
  const result = await searchPdfText(document, ' special \n phrase ', () => true)
  assert.equal(result.query, 'special phrase')
  assert.match(result.matches[0].snippet, /special phrase/)
  assert.ok(result.matches[0].snippet.length < 250)
  assert.ok(result.matches[0].snippet.startsWith('…'))
})

test('page and text bounds retain honest partial coverage without splitting a page', async () => {
  const pages = await searchPdfText(documentOf(['alpha', 'alpha', 'alpha']), 'alpha', () => true, undefined, { maxPages: 2, maxCharacters: 100 })
  assert.equal(pages.complete, false)
  assert.equal(pages.limit, 'pages')
  assert.equal(pages.scannedPages, 2)
  assert.equal(pages.totalPages, 3)
  const chars = await searchPdfText(documentOf(['alpha', 'x'.repeat(20), 'alpha']), 'alpha', () => true, undefined, { maxPages: 4, maxCharacters: 10 })
  assert.equal(chars.scannedPages, 1)
  assert.equal(chars.limit, 'characters')
  assert.deepEqual(chars.matches.map(match => match.page), [1])
})

test('unreadable pages are reported and never described as complete coverage', async () => {
  const result = await searchPdfText({ numPages: 3, getPage: async page => { if (page === 2) throw new Error('broken page'); return { getTextContent: async () => ({ items: [{ str: 'alpha' }] }) } } }, 'alpha', () => true)
  assert.deepEqual(result.failedPages, [2])
  assert.deepEqual(result.matches.map(match => match.page), [1, 3])
  assert.equal(result.scannedPages, 2)
  assert.equal(result.complete, false)
})

test('strict page entry rejects fractional, exponent, signed and out-of-range values', () => {
  assert.equal(parsePageInput(' 03 ', 10), 3)
  for (const value of ['', '0', '-1', '+1', '1.0', '1e2', '11', 'Infinity', '2x']) assert.throws(() => parsePageInput(value, 10), /whole page number from 1 to 10/)
  assert.throws(() => parsePageInput('1', 0), /not ready/)
})

test('cancellation during extraction prevents stale progress/results and destroys only the owned task once', async () => {
  let release!: (value: { items: { str: string }[] }) => void
  let began!: () => void
  const started = new Promise<void>(resolve => { began = resolve })
  let destroyed = 0
  const runner = new LocalPdfSearch(async () => new Uint8Array([1]), () => ({
    promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: () => { began(); return new Promise(resolve => { release = resolve }) } }) }),
    destroy: async () => { destroyed++ }
  }))
  const progress: number[] = []
  const pending = runner.run('a', 'alpha', page => { progress.push(page) })
  await started
  await runner.cancel()
  release({ items: [{ str: 'alpha' }] })
  await assert.rejects(pending, /cancelled/)
  assert.equal(destroyed, 1)
  assert.deepEqual(progress, [])
})

test('late file bytes are ignored after another paper opens; successful tasks are released', async () => {
  let release!: (value: Uint8Array) => void
  let tasks = 0, destroyed = 0
  const runner = new LocalPdfSearch(id => id === 'old' ? new Promise(resolve => { release = resolve }) : Promise.resolve(new Uint8Array([2])), () => {
    tasks++
    return { promise: Promise.resolve(documentOf(['new result'])), destroy: async () => { destroyed++ } }
  })
  const old = runner.run('old', 'old')
  await runner.cancel()
  const fresh = await runner.run('new', 'result')
  release(new Uint8Array([1]))
  await assert.rejects(old, /cancelled/)
  assert.equal(fresh.matches[0].page, 1)
  assert.equal(tasks, 1)
  assert.equal(destroyed, 1)
})

test('changing the query variable cannot change an in-flight search snapshot', async () => {
  let release!: (value: Uint8Array) => void
  const runner = new LocalPdfSearch(() => new Promise(resolve => { release = resolve }), () => ({ promise: Promise.resolve(documentOf(['alpha', 'beta'])), destroy: async () => {} }))
  let query = 'alpha'
  const pending = runner.run('a', query)
  query = 'beta'
  release(new Uint8Array([1]))
  const result = await pending
  assert.equal(result.query, 'alpha')
  assert.deepEqual(result.matches.map(match => match.page), [1])
  assert.equal(query, 'beta')
})

test('cancelled extraction can restart before the previous page resolves', async () => {
  let release!: (value: { items: { str: string }[] }) => void
  let began!: () => void
  const started = new Promise<void>(resolve => { began = resolve })
  let created = 0, destroyed = 0
  const runner = new LocalPdfSearch(async () => new Uint8Array([1]), () => ({
    promise: Promise.resolve(++created === 1 ? { numPages: 1, getPage: async () => ({ getTextContent: () => { began(); return new Promise(resolve => { release = resolve }) } }) } : documentOf(['beta'])),
    destroy: async () => { destroyed++ }
  }))
  const old = runner.run('a', 'alpha')
  await started; await runner.cancel()
  const fresh = await runner.run('a', 'beta')
  release({ items: [{ str: 'alpha' }] })
  await assert.rejects(old, /cancelled/)
  assert.equal(fresh.query, 'beta')
  assert.equal(fresh.matches.length, 1)
  assert.equal(destroyed, 2)
})

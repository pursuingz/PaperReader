import assert from 'node:assert/strict'
import test from 'node:test'
import { ReadingHistory, type ReadingLocation } from './readingHistory'

const location = (paperId: string | null, page = 1, view: 'reader' | 'summary' = 'reader'): ReadingLocation => ({ paperId, page, view, zoom: 100, scrollTop: 0, scrollLeft: 0 })

test('history begins at Welcome and does not traverse beyond either end', () => {
  const history = new ReadingHistory()
  assert.deepEqual(history.current, location(null))
  assert.equal(history.canBack, false)
  assert.equal(history.canForward, false)
  assert.equal(history.peek('back'), null)
  assert.equal(history.commit('forward'), null)
  assert.equal(history.length, 1)
})

test('paper, page and view changes each produce a traversable visit', () => {
  const history = new ReadingHistory()
  history.visit(location('paper-a'))
  history.visit(location('paper-a', 3))
  history.visit(location('paper-a', 3, 'summary'))
  history.visit(location('paper-b'))
  history.visit(location(null))
  assert.equal(history.length, 6)
  assert.deepEqual(history.commit('back'), location('paper-b'))
  assert.deepEqual(history.commit('back'), location('paper-a', 3, 'summary'))
  assert.deepEqual(history.commit('back'), location('paper-a', 3))
  assert.deepEqual(history.commit('back'), location('paper-a'))
  assert.deepEqual(history.commit('back'), location(null))
  assert.equal(history.canBack, false)
  assert.deepEqual(history.commit('forward'), location('paper-a'))
})

test('duplicate visits preserve the forward branch and refresh zoom and scroll', () => {
  const history = new ReadingHistory(location('paper-a'))
  history.visit(location('paper-b'))
  history.commit('back')
  history.visit({ ...location('paper-a'), zoom: 150, scrollTop: 400, scrollLeft: 20 })
  assert.equal(history.length, 2)
  assert.equal(history.canForward, true)
  history.commit('forward')
  assert.deepEqual(history.commit('back'), { ...location('paper-a'), zoom: 150, scrollTop: 400, scrollLeft: 20 })
})

test('updating current geometry does not advance history or clear future visits', () => {
  const history = new ReadingHistory(location('paper-a'))
  history.visit(location('paper-b'))
  history.commit('back')
  history.update({ ...location('paper-a'), zoom: 80, scrollTop: 42, scrollLeft: 7 })
  assert.equal(history.length, 2)
  assert.deepEqual(history.peek('forward'), location('paper-b'))
  assert.equal(history.current.scrollTop, 42)
})

test('a new visit after going back discards only the old forward branch', () => {
  const history = new ReadingHistory()
  history.visit(location('paper-a'))
  history.visit(location('paper-b'))
  history.commit('back')
  history.visit(location('paper-a', 7))
  assert.equal(history.length, 3)
  assert.equal(history.canForward, false)
  assert.equal(history.peek('forward'), null)
  assert.deepEqual(history.commit('back'), location('paper-a'))
  assert.deepEqual(history.commit('back'), location(null))
})

test('peeking while a load is pending leaves cursor and future intact until an explicit commit', () => {
  const history = new ReadingHistory(location('paper-a'))
  history.visit(location('paper-b'))
  const target = history.peek('back')
  assert.deepEqual(target, location('paper-a'))
  assert.deepEqual(history.current, location('paper-b'))
  assert.equal(history.canBack, true)
  assert.equal(history.canForward, false)
  assert.deepEqual(history.peek('back'), target)
})

test('snapshots cannot be mutated through input, current, peek or commit results', () => {
  const first = location('paper-a')
  const history = new ReadingHistory(first)
  first.page = 99
  history.current.page = 98
  const next = location('paper-b')
  history.visit(next)
  next.paperId = 'changed'
  history.peek('back')!.page = 97
  const returned = history.commit('back')!
  returned.page = 96
  assert.deepEqual(history.current, location('paper-a'))
  assert.deepEqual(history.peek('forward'), location('paper-b'))
  const update = { ...location('paper-a'), scrollTop: 10 }
  history.update(update)
  update.scrollTop = 900
  assert.equal(history.current.scrollTop, 10)
})

test('the one hundred entry bound retains the most recent pages and a valid cursor', () => {
  const history = new ReadingHistory()
  for (let page = 1; page <= 110; page++) history.visit(location('paper-a', page))
  assert.equal(history.length, 100)
  let steps = 0
  while (history.canBack) { history.commit('back'); steps++ }
  assert.equal(steps, 99)
  assert.deepEqual(history.current, location('paper-a', 11))
  assert.equal(history.commit('back'), null)
  assert.deepEqual(history.peek('forward'), location('paper-a', 12))
})

test('invalid locations or a changed identity in update cannot corrupt navigation', () => {
  const history = new ReadingHistory(location('paper-a'))
  history.visit(location('paper-b'))
  history.commit('back')
  for (const invalid of [
    { ...location('paper-c'), page: 0 }, { ...location('paper-c'), page: 1.5 },
    { ...location('paper-c'), zoom: Number.NaN }, { ...location('paper-c'), zoom: 0 },
    { ...location('paper-c'), scrollTop: -1 }, { ...location('paper-c'), scrollLeft: Infinity },
    { ...location('paper-c'), paperId: '' }, { ...location('paper-c'), view: 'other' }
  ]) assert.throws(() => history.visit(invalid as ReadingLocation), /location/i)
  assert.throws(() => history.update(location('paper-c')), /visit/i)
  assert.deepEqual(history.current, location('paper-a'))
  assert.equal(history.length, 2)
  assert.deepEqual(history.peek('forward'), location('paper-b'))
})

test('invalid traversal direction never changes the current position', () => {
  const history = new ReadingHistory()
  history.visit(location('paper-a'))
  assert.throws(() => history.peek('sideways' as 'back'), /direction/i)
  assert.throws(() => history.commit('sideways' as 'back'), /direction/i)
  assert.deepEqual(history.current, location('paper-a'))
})

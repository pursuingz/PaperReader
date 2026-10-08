import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PaperState } from '../../shared/types'
import { saveNavigationPage, checkHistoryPdf, historyContentReady } from './pageNavigation'
import { RenderPositionRestore } from './focusPosition'

const state = (): PaperState => ({ note: 'Keep my note', messages: [], lastPage: 1 })
test('a rejected page save leaves state and history untouched', async () => {
  const current = state(); let commits = 0
  await assert.rejects(async () => { const next = await saveNavigationPage(3, () => current, async () => { throw new Error('Disk full') }, () => true); if (next) commits++ }, /Disk full/)
  assert.equal(current.lastPage, 1); assert.equal(commits, 0)
})
test('an AI answer arriving during save is included before page commit', async () => {
  let current = state(); const saved: PaperState[] = []
  const next = await saveNavigationPage(3, () => current, async value => {
    saved.push(structuredClone(value))
    if (saved.length === 1) current = { ...current, messages: [{ id: 'a', paperId: 'paper-a', role: 'assistant', content: 'Late complete answer', createdAt: '2026-10-06' }] }
  }, () => true)
  assert.equal(current.lastPage, 1); assert.equal(saved.length, 2); assert.equal(saved[1].messages[0].content, 'Late complete answer'); assert.equal(next?.lastPage, 3)
})
test('a cancelled or superseded navigation never commits a stale page', async () => {
  const current = state(); let valid = true
  const next = await saveNavigationPage(3, () => current, async () => { valid = false }, () => valid)
  assert.equal(next, null); assert.equal(current.lastPage, 1)
})
test('continuous state changes stop with a bounded explicit failure', async () => {
  let current = state(), saves = 0
  await assert.rejects(saveNavigationPage(3, () => current, async () => { ++saves; current = { ...current, note: current.note + '.' } }, () => true), /kept changing/)
  assert.equal(saves, 4); assert.equal(current.lastPage, 1)
})
test('history PDF preflight validates page and destroys its independent task', async () => {
  let destroyed = 0
  await checkHistoryPdf(new Uint8Array([1]), 3, () => ({ promise: Promise.resolve({ numPages: 3 }), destroy: async () => { destroyed++ } }))
  await assert.rejects(checkHistoryPdf(new Uint8Array([1]), 4, () => ({ promise: Promise.resolve({ numPages: 3 }), destroy: async () => { destroyed++ } })), /page is unavailable/)
  await assert.rejects(checkHistoryPdf(new Uint8Array([1]), 1, () => ({ promise: Promise.reject(new Error('Broken PDF')), destroy: async () => { destroyed++ } })), /Broken PDF/)
  assert.equal(destroyed, 3)
})
test('a delayed saved Summary cannot consume its history position before the matching content loads', () => {
  const jobs = new Set<() => void>(); let top = 0
  let status = { paperId: 'paper-a', summaryReady: false }
  const restore = new RenderPositionRestore<{ fullscreen: boolean; top: number }>(value => { if (!historyContentReady({ paperId: 'paper-a', view: 'summary' }, status)) return false; top = value.top; return true }, task => { jobs.add(task); return () => { jobs.delete(task) } })
  const tick = () => { for (const task of [...jobs]) { jobs.delete(task); task() } }
  restore.begin({ fullscreen: false, top: 120 }); restore.confirm(false); restore.rendered(restore.generation); tick()
  assert.equal(top, 0); assert.equal(restore.pending?.top, 120)
  status = { paperId: 'paper-b', summaryReady: true }; restore.rendered(restore.generation); tick()
  assert.equal(top, 0); assert.equal(restore.pending?.top, 120)
  status = { paperId: 'paper-a', summaryReady: true }; restore.rendered(restore.generation); tick()
  assert.equal(top, 120); assert.equal(restore.pending, null)
})

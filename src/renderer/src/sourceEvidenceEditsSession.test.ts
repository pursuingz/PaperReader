import test from 'node:test'
import assert from 'node:assert/strict'
import type { PaperSourceEntry, SummaryEvidenceManifest } from '../../shared/types'
import { SourceEvidenceEditsSession, evidenceCaption, evidenceEditFor, evidenceHidden, captionPageNumber, captionCopySelection } from './sourceEvidenceEditsSession'
import { matchingEvidenceCrop } from './automaticEvidenceSession'
import type { SourceEvidenceEdits } from '../../shared/sourceEvidenceEditsTypes'

const entry: PaperSourceEntry = { id: 'source-1', kind: 'figure', label: 'Figure 1', text: 'Figure 1. Original reconstruction comparisons.', pages: [2] }
const edits = (paperId = 'paper-a'): SourceEvidenceEdits => ({ version: 1, paperId, edits: [{ source: structuredClone(entry), caption: 'Corrected visible caption', hidden: true }] })
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

test('caption display overrides preserve original crop identity and hidden entries survive compatible refresh', () => {
  const manifest: SummaryEvidenceManifest = { version: 1, paperId: 'paper-a', crops: [{ entryId: entry.id, kind: 'figure', label: entry.label, caption: entry.text, page: 2, rect: { x: .1, y: .1, width: .3, height: .3 }, assetId: 'asset-1', confidence: 1, method: 'manual', status: 'ready' }] }
  assert.equal(evidenceCaption(edits(), entry, [entry]), 'Corrected visible caption')
  assert.equal(evidenceHidden(edits(), entry, [entry]), true)
  assert.equal(matchingEvidenceCrop(manifest, entry)?.assetId, 'asset-1'); assert.equal(entry.text, 'Figure 1. Original reconstruction comparisons.')
  const refreshed = { ...entry, id: 'new-id', label: 'Fig. 1', text: 'Fig. 1. Original reconstruction comparisons.' }
  assert.equal(evidenceHidden(edits(), refreshed, [refreshed]), true)
  assert.equal(evidenceEditFor(edits(), { ...entry, text: 'Figure 1. Another unrelated caption.' }, [entry]), null)
  assert.equal(evidenceHidden(edits(), { ...entry, pages: [3] }, [entry]), false)
})

test('ambiguous source aliases and recycled ids cannot adopt another item edit', () => {
  const a = { ...entry, id: 'a' }, b = { ...entry, id: 'b' }
  assert.equal(evidenceEditFor(edits(), a, [a, b]), null)
  const recycled = { ...entry, text: 'Figure 1. Different caption.' }
  assert.equal(evidenceEditFor(edits(), a, [recycled, a]), null)
})

test('a retained source edit follows the equivalent alias selected by crop projection', () => {
  const alias = { ...entry, id: 'alias', label: 'Fig. 1', text: 'Fig. 1. Original reconstruction comparisons.' }
  assert.equal(evidenceHidden(edits(), alias, [entry, alias]), true)
  assert.equal(evidenceCaption(edits(), alias, [entry, alias]), 'Corrected visible caption')
})

test('caption pages validate physical bounds and copy selection must belong entirely to the PDF', () => {
  assert.equal(captionPageNumber('3', 8), 3)
  for (const value of ['', '0', '-1', '9', '1.5', 'NaN']) assert.equal(captionPageNumber(value, 8), null)
  assert.equal(captionCopySelection(' selected caption ', true, true), ' selected caption ')
  assert.equal(captionCopySelection('outside', true, false), null); assert.equal(captionCopySelection('outside', false, true), null)
  assert.equal(captionCopySelection(' ', true, true), null)
})

test('failed load prevents mutation until explicit reload and cancellation creates no save', async () => {
  let failure = true, calls = 0
  const session = new SourceEvidenceEditsSession({ loadSourceEvidenceEdits: async id => { if (failure) throw Error('Damaged edits'); return edits(id) }, saveSourceEvidenceCaption: async id => { calls++; return edits(id) }, setSourceEvidenceHidden: async id => { calls++; return edits(id) } })
  await assert.rejects(session.open('paper-a'), /Damaged/)
  await assert.rejects(session.saveCaption(entry, 'New'), /load/i); assert.equal(calls, 0)
  failure = false; await session.open('paper-a'); session.close(); assert.equal(calls, 0)
})

test('save snapshots original entry and suppresses stale responses across paper switches', async () => {
  const old = deferred<SourceEvidenceEdits>(), newer = deferred<SourceEvidenceEdits>(); let sent: PaperSourceEntry | null = null
  const session = new SourceEvidenceEditsSession({ loadSourceEvidenceEdits: async id => edits(id), saveSourceEvidenceCaption: async (id, input) => { sent = input.entry; return id === 'paper-a' ? old.promise : newer.promise }, setSourceEvidenceHidden: async id => edits(id) })
  await session.open('paper-a'); const input = structuredClone(entry), first = session.saveCaption(input, 'First'); input.text = 'Mutated'
  assert.equal(sent!.text, entry.text); await assert.rejects(session.setHidden(entry, true), /progress/i)
  await session.open('paper-b'); const second = session.saveCaption(entry, 'Second'); old.resolve(edits()); assert.equal(await first, null); assert.equal(session.busy, true)
  session.close(); newer.resolve(edits('paper-b')); assert.equal(await second, null)
})

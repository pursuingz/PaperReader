import test from 'node:test'
import assert from 'node:assert/strict'
import { NoteAdoptionSaveGate } from './noteAdoptionSave'

for (const success of [false, true]) test(`closing waits for adoption to settle before saving ${success ? 'adopted' : 'original'} notes`, async () => {
  const gate = new NoteAdoptionSaveGate()
  let note = 'Original', disk = 'Original', writes = 0
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const adoption = gate.run(async () => {
    await pending
    ++writes
    if (!success) throw new Error('Transient save failure')
    disk = 'Adopted'; note = 'Adopted'
  })
  const observed = adoption.catch(error => error.message)
  let closed = false
  const closing = (async () => { await gate.settle(); disk = note; ++writes; closed = true })()
  await Promise.resolve()
  assert.equal(closed, false)
  release()
  await Promise.all([observed, closing])
  assert.equal(disk, success ? 'Adopted' : 'Original')
  assert.equal(note, disk)
  assert.equal(writes, 2)
  assert.equal(closed, true)
})

test('a pending adoption rejects a duplicate and a failed adoption allows a fresh retry', async () => {
  const gate = new NoteAdoptionSaveGate()
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const first = gate.run(async () => { await pending; throw new Error('Failure') })
  const observed = first.catch(() => undefined)
  await assert.rejects(gate.run(async () => {}), /already being saved/)
  release(); await observed
  let retried = false
  await gate.run(async () => { retried = true })
  assert.equal(retried, true)
  await gate.settle()
})

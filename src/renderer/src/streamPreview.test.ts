import { test } from 'node:test'
import assert from 'node:assert/strict'
import { updateStreamPreview } from './streamPreview'
import type { AIProgress } from '../../shared/types'

const active = { requestId: 'request-a', paperId: 'paper-a', loaded: true }
const reset: AIProgress = { requestId: 'request-a', paperId: 'paper-a', attempt: 1, type: 'reset' }
const delta: AIProgress = { ...reset, type: 'delta', content: '中文 **answer**' }

test('partial text remains separate and appears only after the current attempt starts', () => {
  assert.equal(updateStreamPreview(null, delta, active), null)
  const start = updateStreamPreview(null, reset, active)
  assert.equal(updateStreamPreview(start, delta, active)?.content, delta.content)
  assert.equal(start?.content, '')
})

test('cancel, paper change and a new request reject late events including A to B to A', () => {
  const preview = updateStreamPreview(null, reset, active)
  for (const identity of [{ ...active, requestId: null }, { ...active, paperId: 'paper-b' }, { ...active, requestId: 'request-new' }, { ...active, loaded: false }]) {
    assert.equal(updateStreamPreview(preview, delta, identity), preview)
  }
})

test('retry replaces truncated preview and rejects stale attempt events', () => {
  const first = updateStreamPreview(updateStreamPreview(null, reset, active), delta, active)
  const second = updateStreamPreview(first, { ...reset, attempt: 2 }, active)
  assert.equal(second?.content, '')
  assert.equal(updateStreamPreview(second, delta, active), second)
  assert.equal(updateStreamPreview(second, reset, active), second)
  assert.equal(updateStreamPreview(second, { ...delta, attempt: 2, content: 'Complete' }, active)?.content, 'Complete')
})

test('duplicate reset does not erase in-progress content and previews stay bounded', () => {
  const preview = updateStreamPreview(updateStreamPreview(null, reset, active), delta, active)
  assert.equal(updateStreamPreview(preview, reset, active), preview)
  assert.equal(updateStreamPreview(preview, { ...delta, content: 'x'.repeat(200001) }, active), preview)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareQuestionReuse, commitQuestionReuse } from './questionReuse'

test('reuse fills an empty composer without sending and captures the paper for replacement', () => {
  assert.deepEqual(prepareQuestionReuse('paper-a', '', 'Explain this term'), { kind: 'fill', question: 'Explain this term' })
  const result = prepareQuestionReuse('paper-a', 'My draft', 'Old question')
  assert.equal(result.kind, 'review')
  if (result.kind === 'review') assert.equal(commitQuestionReuse(result.review, 'paper-a', 'My draft'), 'Old question')
})
test('reviewed replacement cannot erase a changed draft or land in another paper', () => {
  const result = prepareQuestionReuse('paper-a', 'My draft', 'Old question')
  assert.equal(result.kind, 'review')
  if (result.kind !== 'review') throw new Error('Expected a review')
  assert.throws(() => commitQuestionReuse(result.review, 'paper-b', 'My draft'), /paper/i)
  assert.throws(() => commitQuestionReuse(result.review, 'paper-a', 'New draft'), /draft.*changed/i)
  assert.throws(() => prepareQuestionReuse('paper-a', '', '  '), /question/i)
})
test('even whitespace in an unsent draft requires a replacement choice', () => {
  assert.equal(prepareQuestionReuse('paper-a', ' \n', 'Old question').kind, 'review')
})

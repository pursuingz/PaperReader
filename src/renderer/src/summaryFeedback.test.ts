import test from 'node:test'
import assert from 'node:assert/strict'
import { summaryFailureMessage } from './summaryFeedback'

test('summary feedback exposes the real failure instead of Electron transport details', () => {
  const error = new Error("Error invoking remote method 'paper-reader:generate-summary': Error: DeepSeek cut off source chunk 2/4 after two attempts. Retry generation.")
  const result = summaryFailureMessage(error, true)
  assert.match(result, /source chunk 2\/4/)
  assert.match(result, /two attempts/)
  assert.match(result, /saved summary.*unchanged/i)
  assert.doesNotMatch(result, /remote method|paper-reader:|Error:/)
})

test('a first summary failure never claims a nonexistent saved summary', () => {
  const result = summaryFailureMessage('DeepSeek cut off the full-paper summary after two attempts.', false)
  assert.match(result, /full-paper summary/)
  assert.doesNotMatch(result, /saved summary|unchanged|preserved/)
})

test('non-Electron errors preserve actionable diagnostics without transport assumptions', () => {
  assert.match(summaryFailureMessage(new Error('This PDF needs a password.'), false), /needs a password/)
  assert.match(summaryFailureMessage(null, false), /Summary generation failed/)
})

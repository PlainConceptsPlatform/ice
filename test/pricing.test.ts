import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costOf } from '../server/pricing.ts'

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`)

test('input and output tokens are priced per million', () => {
  close(costOf('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 3 + 15)
  close(costOf('claude-opus-5-5', { input_tokens: 1_000_000 }), 5)
  close(costOf('claude-haiku-5-5', { output_tokens: 1_000_000 }), 5)
})

test('cache reads are cheaper than input', () => {
  close(costOf('claude-sonnet-5-5', { cache_read_input_tokens: 1_000_000 }), 0.3)
})

test('cache writes: the 5 minute and 1 hour split is priced separately', () => {
  close(costOf('claude-sonnet-5-5', { cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 } }), 3.75 + 6)
})

test('cache writes without a split are priced as 5 minute writes', () => {
  close(costOf('claude-sonnet-5-5', { cache_creation_input_tokens: 1_000_000 }), 3.75)
})

test('missing fields count as zero', () => {
  assert.equal(costOf('claude-sonnet-5-5', {}), 0)
})

test('an unknown model has no price, so the cost is 0 (the UI shows it as unknown elsewhere)', () => {
  assert.equal(costOf('some-other-model', { input_tokens: 1_000_000 }), 0)
})

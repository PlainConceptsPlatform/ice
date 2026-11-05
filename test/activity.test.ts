import { test } from 'node:test'
import assert from 'node:assert/strict'
import { idle8h } from '../server/activity.ts'

const MIN = 60_000
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0)

test('a session that existed for 30 minutes and worked for 10 is 20 minutes idle', () => {
  const start = NOW - 30 * MIN
  const r = idle8h([[start, start + 10 * MIN]], start, NOW, NOW)
  assert.equal(r.existsMs, 30 * MIN)
  assert.equal(r.activeMs, 10 * MIN)
  assert.equal(r.idleMs, 20 * MIN)
})

test('overlapping and touching intervals are merged, not double counted', () => {
  const start = NOW - 60 * MIN
  const r = idle8h([[start, start + 20 * MIN], [start + 10 * MIN, start + 30 * MIN], [start + 30 * MIN, start + 40 * MIN]], start, NOW, NOW)
  assert.equal(r.activeMs, 40 * MIN)
})

test('there are 48 buckets; time before the session existed is -1, working time is 1', () => {
  const start = NOW - 20 * MIN
  const r = idle8h([[start, NOW]], start, NOW, NOW)
  assert.equal(r.buckets.length, 48)
  assert.equal(r.buckets[0], -1)
  assert.equal(r.buckets[47], 1)
  assert.equal(r.buckets[46], 1)
  assert.equal(r.buckets[45], -1)
})

test('only the last 8 hours count', () => {
  const start = NOW - 20 * 3_600_000
  const r = idle8h([], start, NOW, NOW)
  assert.equal(r.existsMs, 8 * 3_600_000)
  assert.equal(r.idleMs, 8 * 3_600_000)
})

test('a finished session counts only until its last activity', () => {
  const start = NOW - 3 * 3_600_000, end = NOW - 2 * 3_600_000
  assert.equal(idle8h([], start, end, NOW).existsMs, 3_600_000)
})

test('empty or inverted intervals are ignored', () => {
  const start = NOW - 10 * MIN
  assert.equal(idle8h([[start + 5 * MIN, start + 5 * MIN], [start + 8 * MIN, start + 2 * MIN]], start, NOW, NOW).activeMs, 0)
})

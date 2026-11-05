import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alertsFor } from '../server/alerts.ts'

const base = { cost: 1, costKnown: true, compactions: 0, state: 'working' as const }
const kinds = (s: Parameters<typeof alertsFor>[0]) => alertsFor(s).map((a) => a.kind)

test('a quiet session has no alerts', () => assert.deepEqual(kinds(base), []))
test('waiting for the user raises "waiting"', () => assert.deepEqual(kinds({ ...base, state: 'needs-you' }), ['waiting']))
test('two compactions raise "compactions", one does not', () => {
  assert.deepEqual(kinds({ ...base, compactions: 1 }), [])
  assert.deepEqual(kinds({ ...base, compactions: 2 }), ['compactions'])
})
test('cost over the threshold raises "cost" only when the cost is known', () => {
  assert.deepEqual(kinds({ ...base, cost: 50 }), ['cost'])
  assert.deepEqual(kinds({ ...base, cost: 500, costKnown: false }), [])
})
test('alerts combine', () => assert.deepEqual(kinds({ cost: 99, costKnown: true, compactions: 3, state: 'needs-you' }), ['cost', 'compactions', 'waiting']))

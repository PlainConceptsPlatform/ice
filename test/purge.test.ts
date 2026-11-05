import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The state file is read at import time, so point it at a temp file first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-purge-'))
process.env.ICE_STATE_FILE = path.join(dir, 'nested', 'purged.json')
const { purge, purgedSet, isPurged, restoreAll } = await import('../server/purge.ts')

test('nothing is purged at first', () => assert.deepEqual(purgedSet(), {}))

test('purging hides a session until it has new activity', () => {
  assert.equal(purge([{ id: 'a', lastActivity: 100 }, { id: 'b', lastActivity: 200 }]), 2)
  const p = purgedSet()
  assert.ok(isPurged(p, { id: 'a', lastActivity: 100 }))
  assert.ok(isPurged(p, { id: 'a', lastActivity: 50 }))
  assert.ok(!isPurged(p, { id: 'a', lastActivity: 101 }), 'new activity brings it back')
  assert.ok(!isPurged(p, { id: 'zzz', lastActivity: 1 }))
})

test('the state survives a re-read and is stored as plain JSON', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(process.env.ICE_STATE_FILE!, 'utf8')), { a: 100, b: 200 })
})

test('restoring brings everything back', () => {
  restoreAll()
  assert.deepEqual(purgedSet(), {})
  assert.ok(!isPurged(purgedSet(), { id: 'a', lastActivity: 1 }))
})

test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

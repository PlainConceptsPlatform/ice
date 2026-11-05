import { test } from 'node:test'
import assert from 'node:assert/strict'
import { demoDetail, demoOverview, demoTranscript } from '../server/demo.ts'

test('the demo wall has 16 invented sessions with consistent totals', () => {
  const o = demoOverview()
  assert.equal(o.sessions.length, 16)
  assert.equal(new Set(o.sessions.map((s) => s.id)).size, 16)
  assert.equal(o.totals.live, o.sessions.filter((s) => s.live).length)
  assert.equal(o.totals.needsYou, o.sessions.filter((s) => s.state === 'needs-you').length)
})

test('demo data points nowhere real', () => {
  const text = JSON.stringify(demoOverview())
  assert.doesNotMatch(text, /\/Users\/|plainconcepts|@[\w.-]+\.(com|io)/i)
  for (const s of demoOverview().sessions) assert.match(s.cwd, /^\/home\/dev\//)
})

test('every session has a detail with a timeline, and a transcript', () => {
  for (const s of demoOverview().sessions) {
    const d = demoDetail(s.id)
    assert.ok(d && d.timeline.length > 1, s.id)
    assert.ok((demoTranscript(s.id) ?? []).length > 3, s.id)
  }
  assert.equal(demoDetail('nope'), null)
  assert.equal(demoTranscript('nope'), null)
})

test('a session that needs you says so in its alerts', () => {
  for (const s of demoOverview().sessions.filter((x) => x.state === 'needs-you')) assert.ok(s.alerts.some((a) => a.kind === 'waiting'))
})

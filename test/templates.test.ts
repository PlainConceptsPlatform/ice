import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TEMPLATES, messageFor } from '../web/src/templates.ts'

const o = { pre: false, pro: false }

test('every template except custom produces a message, and custom is empty', () => {
  for (const t of TEMPLATES) {
    if (t.id === 'custom') assert.equal(messageFor(t.id, o), '')
    else assert.ok(messageFor(t.id, { ...o, issue: 1, idea: 'x' }).length > 100, t.id)
  }
})

test('the report template is read-only', () => {
  const m = messageFor('report', o)
  assert.match(m, /read-only/)
  assert.match(m, /do not change, merge, comment on or close/)
})

test('implement-all never deploys', () => assert.match(messageFor('implement-all', o), /do not deploy anything/))

test('implement-one references the chosen issue', () => {
  const m = messageFor('implement-one', { ...o, issue: 42, issueTitle: 'Fix login' })
  assert.match(m, /#42 \(Fix login\)/)
  assert.match(m, /gh issue view 42/)
  assert.match(m, /Closes #42/)
})

test('implement-one deploy: none, PRE only, PRE and PRO', () => {
  const none = messageFor('implement-one', { ...o, issue: 1 })
  assert.match(none, /Do not deploy/)
  const pre = messageFor('implement-one', { ...o, issue: 1, pre: true })
  assert.match(pre, /Deploy to PRE\b/)
  assert.match(pre, /Do NOT promote to PRO/)
  const both = messageFor('implement-one', { ...o, issue: 1, pre: true, pro: true })
  assert.match(both, /Deploy to PRE and PRO/)
  assert.match(both, /do not approve it yourself/)
})

test('new-issue embeds the idea, keeps a progress log and stops only on a real blocker', () => {
  const m = messageFor('new-issue', { ...o, idea: 'Add a dark mode toggle' })
  assert.match(m, /Add a dark mode toggle/)
  assert.match(m, /gh issue create/)
  assert.match(m, /gh issue comment/)
  assert.match(m, /two consecutive review passes/)
  assert.match(m, /truly blocked/)
})

test('new-issue deploys only when asked', () => {
  assert.match(messageFor('new-issue', { ...o, idea: 'x' }), /Do not deploy/)
  assert.match(messageFor('new-issue', { ...o, idea: 'x', pre: true }), /Deploy to PRE\b/)
})

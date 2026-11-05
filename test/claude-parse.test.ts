import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseSession } from '../server/sources/claude-parse.ts'

// Synthetic transcripts only: never copy real sessions into the repository.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-parse-'))
test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

const T0 = Date.UTC(2026, 0, 1, 10, 0, 0)
const ts = (min: number) => new Date(T0 + min * 60_000).toISOString()
let n = 0
async function parse(lines: object[], raw: string[] = []) {
  const file = path.join(dir, `session-${++n}.jsonl`)
  fs.writeFileSync(file, [...lines.map((l) => JSON.stringify(l)), ...raw].join('\n') + '\n')
  return parseSession(file)
}
const user = (min: number, text: string, extra: object = {}) => ({ type: 'user', timestamp: ts(min), cwd: '/work/shop', gitBranch: 'feat/x', message: { role: 'user', content: text }, ...extra })
const assistant = (min: number, id: string, usage: object, model = 'claude-sonnet-5-5') => ({ type: 'assistant', timestamp: ts(min), message: { id, model, usage, stop_reason: 'end_turn' } })

test('an empty or timestamp-less file is not a session', async () => {
  assert.equal(await parse([{ type: 'ai-title', aiTitle: 'x' }]), null)
})

test('basic fields: project from cwd, branch, turns, times', async () => {
  const p = await parse([user(0, 'hello'), user(5, 'again')])
  assert.ok(p)
  assert.equal(p.project, 'shop')
  assert.equal(p.cwd, '/work/shop')
  assert.equal(p.branch, 'feat/x')
  assert.equal(p.turns, 2)
  assert.equal(p.startedAt, T0)
  assert.equal(p.lastActivity, T0 + 5 * 60_000)
})

test('title: a name set with /rename beats the generated title, which beats the first prompt', async () => {
  assert.equal((await parse([user(0, 'first prompt'), { type: 'last-prompt', lastPrompt: 'first prompt' }]))?.title, 'first prompt')
  assert.equal((await parse([user(0, 'p'), { type: 'ai-title', aiTitle: 'Generated' }]))?.title, 'Generated')
  assert.equal((await parse([user(0, 'p'), { type: 'ai-title', aiTitle: 'Generated' }, { type: 'custom-title', customTitle: 'Mine' }]))?.title, 'Mine')
  assert.equal((await parse([user(0, 'p'), { type: 'custom-title', customTitle: 'Old' }, { type: 'agent-name', agentName: 'Newest' }, { type: 'ai-title', aiTitle: 'Generated' }]))?.title, 'Newest')
})

test('cost and tokens are summed once per message, even when its blocks repeat the usage', async () => {
  const u = { input_tokens: 1_000_000, output_tokens: 0 }
  const p = await parse([user(0, 'p'), assistant(1, 'm1', u), assistant(1, 'm1', u), assistant(2, 'm2', { input_tokens: 1_000_000 })])
  assert.ok(p)
  assert.equal(p.tokens.input, 2_000_000)
  assert.ok(Math.abs(p.cost - 6) < 1e-9) // two messages x 1M sonnet input tokens x $3
  assert.ok(Math.abs(p.models['claude-sonnet-5-5'] - 6) < 1e-9)
})

test('synthetic messages are not billed', async () => {
  const p = await parse([user(0, 'p'), assistant(1, 'm1', { input_tokens: 1_000_000 }, '<synthetic>')])
  assert.equal(p?.cost, 0)
})

test('errors: failed tool results and API errors', async () => {
  const toolErr = { type: 'user', timestamp: ts(1), message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: 'boom' }] } }
  const apiErr = { type: 'system', subtype: 'api_error', timestamp: ts(2) }
  const p = await parse([user(0, 'p'), toolErr, apiErr, { ...assistant(3, 'm', {}), isApiErrorMessage: true }])
  assert.equal(p?.errors, 3)
})

test('compactions and working intervals', async () => {
  const p = await parse([user(0, 'p'), { type: 'system', subtype: 'compact_boundary', timestamp: ts(10) }, { type: 'system', subtype: 'turn_duration', durationMs: 120_000, timestamp: ts(12) }])
  assert.equal(p?.compactions, 1)
  assert.deepEqual(p?.intervals, [[T0 + 10 * 60_000, T0 + 12 * 60_000]])
})

test('pull requests are collected once per URL', async () => {
  const pr = { type: 'pr-link', prNumber: 7, prRepository: 'acme/shop', prUrl: 'https://github.com/acme/shop/pull/7' }
  const p = await parse([user(0, 'p'), pr, pr])
  assert.deepEqual(p?.prs, [{ number: 7, repo: 'acme/shop', url: pr.prUrl }])
})

test('goal: set by a goal_status attachment, cleared by a "Goal cleared" message', async () => {
  const goal = (met: boolean) => ({ type: 'attachment', timestamp: ts(1), attachment: { type: 'goal_status', condition: 'all tests pass', met } })
  assert.deepEqual((await parse([user(0, 'p'), goal(false)]))?.goal, { condition: 'all tests pass', met: false })
  assert.deepEqual((await parse([user(0, 'p'), goal(false), goal(true)]))?.goal, { condition: 'all tests pass', met: true })
  assert.equal((await parse([user(0, 'p'), goal(false), user(2, 'Goal cleared')]))?.goal, undefined)
})

test('sidechain (sub-agent) messages do not count as turns, and junk lines are skipped', async () => {
  const p = await parse([user(0, 'real'), user(1, 'sub-agent', { isSidechain: true })], ['not json at all', '{"type":"api-request","huge":"blob"}'])
  assert.equal(p?.turns, 1)
})

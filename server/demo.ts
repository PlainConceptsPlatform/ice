// Demo mode (`ICE_DEMO=1`): serves 16 invented sessions so ICE can be tried, and screenshotted, without any agent
// installed and without touching real data. Names, repositories and prompts below are fictional.
import type { FlowInfo, FlowRun, Overview, PrInfo, SessionDetail, SessionState, SessionSummary, TranscriptItem } from '../shared/types.ts'

export const DEMO = process.env.ICE_DEMO === '1'

const MIN = 60_000
const HOUR = 60 * MIN

type FlowKind = 'none' | 'running' | 'queue' | 'approval' | 'deploying' | 'failed' | 'green'
interface Spec {
  agent: 'claude' | 'opencode'; title: string; project: string; branch: string; state: SessionState
  ageMin: number; runMin: number; turns: number; compactions: number; errors: number; cost: number
  flow: FlowKind; goal?: { condition: string; met: boolean }; remote?: boolean; hosted?: boolean; pr?: PrInfo['checks']; model?: string
}

const SPECS: Spec[] = [
  { agent: 'claude', title: 'Add rate limiting to the public API', project: 'storefront-api', branch: 'feat/rate-limit', state: 'needs-you', ageMin: 7, runMin: 190, turns: 41, compactions: 1, errors: 2, cost: 9.4, flow: 'green', pr: 'passing', remote: true },
  { agent: 'claude', title: 'Migrate invoices table to the new schema', project: 'billing-service', branch: 'feat/invoice-schema', state: 'working', ageMin: 0, runMin: 95, turns: 28, compactions: 0, errors: 0, cost: 4.1, flow: 'running', pr: 'pending' },
  { agent: 'claude', title: 'Fix flaky checkout test', project: 'storefront-api', branch: 'fix/flaky-checkout', state: 'working', ageMin: 1, runMin: 40, turns: 17, compactions: 0, errors: 3, cost: 1.9, flow: 'failed', pr: 'failing' },
  { agent: 'opencode', title: 'Dark mode for the settings screen', project: 'mobile-app', branch: 'feat/dark-settings', state: 'working', ageMin: 0, runMin: 55, turns: 22, compactions: 0, errors: 0, cost: 2.7, flow: 'queue', pr: 'pending', model: 'gpt-5.5' },
  { agent: 'claude', title: 'Write the contributor guide', project: 'docs-site', branch: 'docs/contributing', state: 'needs-you', ageMin: 38, runMin: 70, turns: 12, compactions: 0, errors: 0, cost: 0.8, flow: 'none' },
  { agent: 'claude', title: 'Upgrade Terraform providers', project: 'infra-terraform', branch: 'chore/providers', state: 'working', ageMin: 2, runMin: 310, turns: 63, compactions: 3, errors: 5, cost: 21.3, flow: 'approval', goal: { condition: 'plan shows no changes and CI is green', met: false }, pr: 'passing' },
  { agent: 'opencode', title: 'Cache the ranking features', project: 'ml-ranker', branch: 'perf/feature-cache', state: 'working', ageMin: 0, runMin: 120, turns: 35, compactions: 1, errors: 1, cost: 5.6, flow: 'none', model: 'gpt-5.5' },
  { agent: 'claude', title: 'Rotate signing keys', project: 'auth-gateway', branch: 'sec/rotate-keys', state: 'needs-you', ageMin: 14, runMin: 85, turns: 19, compactions: 0, errors: 0, cost: 3.2, flow: 'green', pr: 'passing' },
  { agent: 'claude', title: 'Backfill the events warehouse', project: 'data-pipeline', branch: 'feat/backfill', state: 'working', ageMin: 3, runMin: 205, turns: 54, compactions: 2, errors: 4, cost: 14.8, flow: 'deploying', goal: { condition: 'all partitions loaded and row counts match', met: false }, pr: 'passing' },
  { agent: 'claude', title: 'Refactor the cart service', project: 'storefront-api', branch: 'refactor/cart', state: 'running-shell', ageMin: 0, runMin: 150, turns: 47, compactions: 1, errors: 1, cost: 8.5, flow: 'running', hosted: true, pr: 'pending' },
  { agent: 'opencode', title: 'Localize onboarding to Spanish', project: 'mobile-app', branch: 'feat/i18n-es', state: 'finished', ageMin: 190, runMin: 60, turns: 15, compactions: 0, errors: 0, cost: 1.4, flow: 'green', pr: 'passing', model: 'gpt-5.5' },
  { agent: 'claude', title: 'Add the audit log endpoint', project: 'billing-service', branch: 'feat/audit-log', state: 'finished', ageMin: 260, runMin: 110, turns: 30, compactions: 1, errors: 0, cost: 6.2, flow: 'green', goal: { condition: 'endpoint documented and covered by tests', met: true }, pr: 'passing' },
  { agent: 'claude', title: 'Investigate the p99 latency regression', project: 'auth-gateway', branch: 'main', state: 'finished', ageMin: 330, runMin: 75, turns: 24, compactions: 0, errors: 2, cost: 3.9, flow: 'none' },
  { agent: 'opencode', title: 'Draft the migration runbook', project: 'docs-site', branch: 'docs/runbook', state: 'finished', ageMin: 400, runMin: 45, turns: 11, compactions: 0, errors: 0, cost: 0.6, flow: 'none', model: 'gpt-5.5' },
  { agent: 'claude', title: 'Tighten the CI cache keys', project: 'infra-terraform', branch: 'ci/cache-keys', state: 'finished', ageMin: 450, runMin: 35, turns: 9, compactions: 0, errors: 0, cost: 1.1, flow: 'green', pr: 'passing' },
  { agent: 'claude', title: 'Prototype the recommendations widget', project: 'ml-ranker', branch: 'spike/widget', state: 'finished', ageMin: 520, runMin: 130, turns: 38, compactions: 2, errors: 3, cost: 11.7, flow: 'failed', pr: 'failing' },
]

// Small deterministic generator, so the demo looks the same on every start.
function rng(seed: number) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) }

const id = (i: number) => `demo-${String(i + 1).padStart(2, '0')}`

function runOf(now: number, n: number, workflow: string, conclusion: string | null, status: string, agoMin: number, repo: string): FlowRun {
  const t = new Date(now - agoMin * MIN).toISOString()
  return { runId: 9000 + n, workflow, url: `https://github.com/${repo}/actions/runs/${9000 + n}`, event: 'push', status, conclusion, createdAt: t, startedAt: t, updatedAt: t, attempt: 1 }
}

function flowOf(spec: Spec, now: number, i: number): FlowInfo | undefined {
  if (spec.flow === 'none') return { repo: `acme/${spec.project}`, branch: spec.branch, active: [], recent: [], iteration: 0, failedSinceStart: 0, expectIterate: { value: null, reason: 'No runs yet' } }
  const repo = `acme/${spec.project}`
  const done = (n: number, wf: string, ok: boolean, ago: number) => runOf(now, i * 10 + n, wf, ok ? 'success' : 'failure', 'completed', ago, repo)
  const base = { repo, branch: spec.branch, failedSinceStart: spec.flow === 'failed' ? 2 : 0, iteration: 2 + (i % 4) }
  const recent: FlowRun[] = spec.flow === 'failed' ? [done(1, 'CI', false, 6), done(2, 'CI', false, 22), done(3, 'Lint', true, 25)] : [done(1, 'CI', true, 12), done(2, 'Lint', true, 14), done(3, 'CI', true, 70)]
  if (spec.flow === 'green' || spec.flow === 'failed') {
    return { ...base, active: [], latest: recent[0], recent, expectIterate: spec.flow === 'failed' ? { value: true, reason: 'The latest run failed' } : { value: false, reason: 'The latest run passed' } }
  }
  const stage = spec.flow === 'queue' ? 'runner-queue' : spec.flow === 'approval' ? 'approval' : spec.flow === 'deploying' ? 'deploying' : 'running'
  const wf = spec.flow === 'deploying' ? 'Deploy to PRE' : 'CI'
  const run = runOf(now, i * 10 + 5, wf, null, stage === 'approval' ? 'waiting' : stage === 'runner-queue' ? 'queued' : 'in_progress', 4, repo)
  const active = {
    run, stage: stage as 'running', elapsedMs: 4 * MIN + i * 7_000, ...(stage === 'runner-queue' ? { queuedMs: 3 * MIN } : {}),
    job: stage === 'running' ? 'test' : stage === 'deploying' ? 'deploy' : undefined,
    step: stage === 'running' ? 'Run unit tests' : stage === 'deploying' ? 'Apply release' : undefined,
    nextStep: stage === 'running' ? 'Upload coverage' : undefined,
    stepElapsedMs: 70_000, stepMedianMs: 95_000, stepEtaMs: 25_000, flowMedianMs: 7 * MIN, flowEtaMs: 3 * MIN, jobs: [],
  }
  return { ...base, active: [active], recent, expectIterate: { value: null, reason: 'No result yet' } }
}

function build(spec: Spec, i: number, now: number): SessionDetail {
  const r = rng(i * 977 + 13)
  const last = now - spec.ageMin * MIN
  const started = last - spec.runMin * MIN
  const buckets: number[] = Array.from({ length: 48 }, (_, k) => {
    const t = now - (47 - k) * 10 * MIN
    if (t < started - 10 * MIN || t > last + 10 * MIN) return -1
    return Math.min(1, 0.25 + r() * 0.85)
  })
  const exist = buckets.filter((b) => b >= 0).length * 10 * MIN
  const active = buckets.filter((b) => b >= 0).reduce((a, b) => a + b * 10 * MIN, 0)
  const alerts: SessionSummary['alerts'] = []
  if (spec.state === 'needs-you') alerts.push({ kind: 'waiting', message: 'Waiting for your decision' })
  if (spec.compactions >= 2) alerts.push({ kind: 'compactions', message: `${spec.compactions} compactions: consider splitting the task` })
  if (spec.flow === 'failed') alerts.push({ kind: 'flow-failed', message: 'The latest workflow run failed' })
  if (spec.flow === 'approval') alerts.push({ kind: 'flow', message: 'A workflow run is waiting for approval' })
  const model = spec.model ?? 'claude-sonnet-5-5'
  const live = spec.state !== 'finished'
  const prs: PrInfo[] = spec.pr ? [{ number: 100 + i * 7, repo: `acme/${spec.project}`, url: `https://github.com/acme/${spec.project}/pull/${100 + i * 7}`, state: 'OPEN', title: spec.title, checks: spec.pr, review: 'REVIEW_REQUIRED' }] : []
  const steps = 14
  const timeline = Array.from({ length: steps }, (_, k) => ({ t: started + ((last - started) * k) / (steps - 1), cost: spec.cost * Math.pow((k + 1) / steps, 0.85) }))
  return {
    id: id(i), agent: spec.agent, title: spec.title, project: spec.project, cwd: `/home/dev/${spec.project}`, branch: spec.branch,
    live, pid: live ? 40000 + i : undefined, state: spec.state, startedAt: started, lastActivity: last,
    turns: spec.turns, compactions: spec.compactions, errors: spec.errors,
    idle8h: { idleMs: Math.max(0, exist - active), activeMs: active, existsMs: exist, buckets },
    flow: flowOf(spec, now, i), cost: spec.cost, costKnown: true,
    tokens: { input: Math.round(spec.cost * 190_000), output: Math.round(spec.cost * 4_200), cacheRead: Math.round(spec.cost * 1_900_000), cacheWrite: Math.round(spec.cost * 60_000) },
    models: { [model]: spec.cost }, prs, remote: spec.remote ? { url: 'https://claude.ai/code/demo' } : undefined,
    hosted: spec.hosted, goal: spec.goal, alerts, lastPrompt: spec.title,
    timeline, events: [],
  }
}

const all = () => { const now = Date.now(); return SPECS.map((s, i) => build(s, i, now)) }

export function demoOverview(): Overview {
  const sessions = all().map(({ timeline, events, ...s }) => s)
  const day = new Date(); day.setHours(0, 0, 0, 0)
  return {
    generatedAt: Date.now(),
    totals: {
      costToday: sessions.filter((s) => s.lastActivity >= day.getTime()).reduce((a, s) => a + s.cost, 0),
      cost7d: sessions.reduce((a, s) => a + s.cost, 0) * 3.4,
      live: sessions.filter((s) => s.live).length,
      needsYou: sessions.filter((s) => s.state === 'needs-you').length,
    },
    sessions, purged: 0,
  }
}

export const demoDetail = (sid: string): SessionDetail | null => all().find((s) => s.id === sid) ?? null

export function demoTranscript(sid: string): TranscriptItem[] | null {
  const s = demoDetail(sid)
  if (!s) return null
  const t = (m: number) => Date.now() - m * MIN
  return [
    { t: t(30), role: 'user', text: `${s.title}. Keep the change small and add tests.` },
    { t: t(28), role: 'assistant', text: 'I will start by reading the current implementation and its tests.' },
    { t: t(27), role: 'tool', tool: 'Read', text: 'src/server.ts' },
    { t: t(26), role: 'result', text: '412 lines read' },
    { t: t(20), role: 'assistant', text: 'The handler has no shared limiter. I will add a small token-bucket middleware and wire it in before the routes.' },
    { t: t(18), role: 'tool', tool: 'Edit', text: 'src/middleware/limiter.ts' },
    { t: t(15), role: 'tool', tool: 'Bash', text: 'npm test' },
    { t: t(14), role: 'result', text: '1 test failed: limiter resets too early', isError: true },
    { t: t(9), role: 'assistant', text: [
      'Fixed the window calculation; **all tests pass** now.',
      '',
      '### What changed',
      '- `limiter.ts`: token bucket with a **60 s** window',
      '- `server.ts`: middleware wired in before the routes',
      '  - health checks are excluded',
      '',
      '| Check | Result |',
      '|---|---|',
      '| Unit tests | 128 passed |',
      '| Lint | clean |',
      '',
      '```ts',
      'app.use(limiter({ windowMs: 60_000, max: 100 }))',
      '```',
      '',
      'See the [design notes](https://example.com/limiter) for the trade-offs.',
    ].join('\n') },
    ...(s.state === 'needs-you' ? [{ t: t(SPECS[Number(sid.slice(5)) - 1].ageMin), role: 'assistant' as const, text: 'Do you want the limit to apply per API key or per IP address?' }] : []),
  ]
}

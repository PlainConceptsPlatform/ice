import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ActiveFlow, FlowInfo, FlowJob, FlowRun, FlowStage } from '../shared/types.ts'

const run = promisify(execFile)
const sh = (cmd: string, args: string[], opts: { cwd?: string; timeout: number }) => run(cmd, args, opts)

// ---- stale-while-revalidate cache: never block the dashboard on slow gh calls ----
const store = new Map<string, { at: number; value: unknown; loading?: boolean }>()
function swr<T>(key: string, ttl: number, load: () => Promise<T>): T | undefined {
  const e = store.get(key)
  const stale = !e || Date.now() - e.at > ttl
  if (stale && !e?.loading) {
    store.set(key, { at: e?.at ?? 0, value: e?.value, loading: true })
    load().then((value) => store.set(key, { at: Date.now(), value })).catch(() => store.set(key, { at: Date.now(), value: e?.value }))
  }
  return e?.value as T | undefined
}

const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending'])
const FAILED = new Set(['failure', 'timed_out', 'startup_failure'])
const DEPLOY = /deploy|release|publish|rollout|promote/i
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : undefined)
const ms = (iso?: string | null) => (iso ? Date.parse(iso) : undefined)

function parseRemote(url: string) {
  const m = url.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/)
  return m ? `${m[1]}/${m[2]}` : undefined
}

// ---- data sources ----
function repoOf(cwd: string) {
  return swr<{ repo?: string }>(`repo:${cwd}`, 600_000, async () => {
    try {
      const { stdout } = await sh('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { timeout: 5_000 })
      return { repo: parseRemote(stdout.trim()) }
    } catch { return {} }
  })
}

interface RawRun {
  databaseId: number; workflowName: string; status: string; conclusion: string; headBranch: string; event: string
  createdAt: string; startedAt: string; updatedAt: string; attempt: number; url: string
}
const FIELDS = 'databaseId,workflowName,status,conclusion,headBranch,event,createdAt,startedAt,updatedAt,attempt,url'
const toRun = (r: RawRun): FlowRun => ({
  runId: r.databaseId, workflow: r.workflowName, url: r.url, event: r.event, status: r.status,
  conclusion: r.conclusion || null, createdAt: r.createdAt, startedAt: r.startedAt, updatedAt: r.updatedAt, attempt: r.attempt,
})

function friendlyError(msg: string) {
  if (/SAML|SSO/i.test(msg)) return 'GitHub SSO authorization required for this organization'
  if (/404|Not Found/i.test(msg)) return 'No access to this repository\'s Actions'
  if (/403|scope|not accessible/i.test(msg)) return 'Token cannot read Actions (gh auth refresh -s workflow)'
  return 'Could not read GitHub Actions'
}

function runsOf(repo: string, branch: string) {
  return swr<{ runs: FlowRun[]; error?: string }>(`runs:${repo}:${branch}`, 30_000, async () => {
    try {
      const { stdout } = await sh('gh', ['run', 'list', '--repo', repo, '--branch', branch, '--limit', '25', '--json', FIELDS], { timeout: 20_000 })
      return { runs: (JSON.parse(stdout) as RawRun[]).map(toRun) }
    } catch (e: any) { return { runs: [], error: friendlyError(String(e?.stderr ?? e?.message)) } }
  })
}

async function fetchJobs(repo: string, runId: number): Promise<FlowJob[]> {
  try {
    const { stdout } = await sh('gh', ['run', 'view', String(runId), '--repo', repo, '--json', 'jobs'], { timeout: 20_000 })
    return ((JSON.parse(stdout).jobs ?? []) as any[]).map((j) => ({
      name: j.name, status: j.status, conclusion: j.conclusion || null, startedAt: j.startedAt || undefined, completedAt: j.completedAt || undefined,
      steps: ((j.steps ?? []) as any[]).map((s) => ({ name: s.name, status: s.status, conclusion: s.conclusion || null, startedAt: s.startedAt || undefined, completedAt: s.completedAt || undefined })),
    }))
  } catch { return [] }
}
const jobsOf = (repo: string, runId: number) => swr<FlowJob[]>(`jobs:${repo}:${runId}`, 15_000, () => fetchJobs(repo, runId))

interface History { flowMedianMs?: number; jobMedian: Record<string, number>; stepMedian: Record<string, number> }
/** Typical durations of this workflow from its recent successful runs (cached 30 min). */
function historyOf(repo: string, workflow: string) {
  return swr<History>(`hist:${repo}:${workflow}`, 1_800_000, async () => {
    const { stdout } = await sh('gh', ['run', 'list', '--repo', repo, '--workflow', workflow, '--status', 'success', '--limit', '10', '--json', FIELDS], { timeout: 20_000 })
    const runs = JSON.parse(stdout) as RawRun[]
    const flowMedianMs = median(runs.map((r) => Date.parse(r.updatedAt) - Date.parse(r.startedAt)).filter((d) => d > 0))
    const acc: { job: Record<string, number[]>; step: Record<string, number[]> } = { job: {}, step: {} }
    for (const r of runs.slice(0, 3)) {
      for (const j of await fetchJobs(repo, r.databaseId)) {
        const jd = (ms(j.completedAt) ?? 0) - (ms(j.startedAt) ?? 0)
        if (jd > 0) (acc.job[j.name] ??= []).push(jd)
        for (const s of j.steps) {
          const sd = (ms(s.completedAt) ?? 0) - (ms(s.startedAt) ?? 0)
          if (sd >= 0 && ms(s.startedAt)) (acc.step[`${j.name}/${s.name}`] ??= []).push(sd)
        }
      }
    }
    const med = (o: Record<string, number[]>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, median(v)!]))
    return { flowMedianMs, jobMedian: med(acc.job), stepMedian: med(acc.step) }
  })
}

// ---- analysis of one active run ----
function analyse(repo: string, r: FlowRun, now: number): ActiveFlow {
  const jobs = (r.status === 'in_progress' || r.status === 'waiting' ? jobsOf(repo, r.runId) : undefined) ?? []
  const hist = historyOf(repo, r.workflow)
  const startedMs = ms(r.startedAt) ?? ms(r.createdAt)!
  const elapsedMs = now - (ms(r.createdAt) ?? startedMs)

  const curJob = jobs.find((j) => j.status === 'in_progress') ?? jobs.find((j) => j.status === 'queued' || j.status === 'waiting' || j.status === 'pending')
  const curStep = curJob?.steps.find((s) => s.status === 'in_progress')
  let nextStep: string | undefined
  if (curJob && curStep) {
    const i = curJob.steps.indexOf(curStep)
    nextStep = curJob.steps.slice(i + 1).find((s) => s.status !== 'completed')?.name
  }
  if (!nextStep && curJob) {
    const nj = jobs[jobs.indexOf(curJob) + 1]
    if (nj) nextStep = `${nj.name}`
  }

  let stage: FlowStage = 'running'
  if (r.status === 'waiting' || curJob?.status === 'waiting') stage = 'approval'
  else if (r.status !== 'in_progress' || (curJob && curJob.status !== 'in_progress')) stage = 'runner-queue'
  else if (DEPLOY.test(r.workflow) || (curJob && DEPLOY.test(curJob.name))) stage = 'deploying'
  if (stage === 'deploying' && r.status !== 'in_progress') stage = 'runner-queue'

  const stepElapsedMs = ms(curStep?.startedAt) ? now - ms(curStep!.startedAt)! : undefined
  const stepMedianMs = curJob && curStep ? hist?.stepMedian[`${curJob.name}/${curStep.name}`] : undefined
  const flowMedianMs = hist?.flowMedianMs
  // Time actually spent running: a run still waiting for a runner has not started yet.
  const flowElapsed = stage === 'runner-queue' && !jobs.some((j) => j.startedAt) ? 0 : now - startedMs
  return {
    run: r, stage, elapsedMs,
    queuedMs: stage === 'runner-queue' ? now - (ms(curJob?.startedAt) ?? ms(r.createdAt)!) : undefined,
    job: curJob?.name, step: curStep?.name, nextStep, stepElapsedMs, stepMedianMs,
    stepEtaMs: stepMedianMs != null && stepElapsedMs != null ? Math.max(0, stepMedianMs - stepElapsedMs) : undefined,
    flowMedianMs, flowEtaMs: flowMedianMs != null ? Math.max(0, flowMedianMs - flowElapsed) : undefined,
    overrunMs: flowMedianMs != null && flowElapsed > flowMedianMs ? flowElapsed - flowMedianMs : undefined,
    jobs,
  }
}

/** Flow state for a session: GitHub Actions runs on its branch since it started. Returns immediately (cached). */
export function flowFor(cwd: string, branch: string | undefined, since: number, now = Date.now()): FlowInfo | undefined {
  if (!branch) return undefined
  const base: FlowInfo = { branch, active: [], recent: [], iteration: 0, failedSinceStart: 0, expectIterate: { value: null, reason: 'No runs since the session started' } }
  const r = repoOf(cwd)
  if (!r) return { ...base, loading: true }
  if (!r.repo) return { ...base, expectIterate: { value: null, reason: 'No GitHub remote' } }
  const res = runsOf(r.repo, branch)
  if (!res) return { ...base, repo: r.repo, loading: true }
  if (res.error) return { ...base, repo: r.repo, error: res.error }

  const mine = res.runs.filter((x) => (ms(x.createdAt) ?? 0) >= since - 60_000)
  const activeRuns = mine.filter((x) => ACTIVE.has(x.status))
  const done = mine.filter((x) => x.status === 'completed')
  const latest = done[0]
  const failed = done.filter((x) => x.conclusion && FAILED.has(x.conclusion)).length
  const focus = activeRuns[0] ?? latest
  const iteration = focus ? mine.filter((x) => x.workflow === focus.workflow).length : 0

  let expectIterate: FlowInfo['expectIterate'] = { value: null, reason: 'No runs since the session started' }
  if (activeRuns.length) expectIterate = failed > 0
    ? { value: true, reason: `Re-run after ${failed} failed run${failed === 1 ? '' : 's'}` }
    : { value: null, reason: 'First run still in progress' }
  else if (latest) expectIterate = latest.conclusion && FAILED.has(latest.conclusion)
    ? { value: true, reason: `Latest run failed (${latest.workflow})` }
    : { value: false, reason: `Latest run ${latest.conclusion ?? 'finished'}` }

  return {
    repo: r.repo, branch, active: activeRuns.map((x) => analyse(r.repo!, x, now)),
    latest, recent: mine.slice(0, 8), iteration, failedSinceStart: failed, expectIterate,
  }
}

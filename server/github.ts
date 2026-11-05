import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PrInfo } from '../shared/types.ts'

const run = promisify(execFile)
const cache = new Map<string, { at: number; info: Partial<PrInfo> }>()
const TTL = 120_000

export async function enrichPr(pr: { number: number; repo: string; url: string }): Promise<PrInfo> {
  const hit = cache.get(pr.url)
  if (hit && Date.now() - hit.at < TTL) return { ...pr, ...hit.info }
  let info: Partial<PrInfo> = {}
  try {
    const { stdout } = await run('gh', ['pr', 'view', String(pr.number), '--repo', pr.repo,
      '--json', 'state,title,isDraft,reviewDecision,statusCheckRollup'], { timeout: 15_000 })
    const j = JSON.parse(stdout)
    const checks: any[] = j.statusCheckRollup ?? []
    const failing = checks.some((c) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED'].includes(c.conclusion ?? c.state))
    const pending = checks.some((c) => (c.status && c.status !== 'COMPLETED') || c.state === 'PENDING')
    info = {
      state: j.state, title: j.title, draft: j.isDraft, review: j.reviewDecision || undefined,
      checks: !checks.length ? 'none' : failing ? 'failing' : pending ? 'pending' : 'passing',
    }
  } catch { /* gh unavailable or no access: show only the link */ }
  cache.set(pr.url, { at: Date.now(), info })
  return { ...pr, ...info }
}

const branchCache = new Map<string, { at: number; value: { branch?: string; prs: PrInfo[] } }>()

/** Current branch of a working directory and the PR for it (if any), via git + gh. Cached. */
export async function branchAndPr(cwd: string): Promise<{ branch?: string; prs: PrInfo[] }> {
  const hit = branchCache.get(cwd)
  if (hit && Date.now() - hit.at < TTL) return hit.value
  let value: { branch?: string; prs: PrInfo[] } = { prs: [] }
  try {
    const { stdout } = await run('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 5_000 })
    const branch = stdout.trim()
    value = { branch, prs: [] }
    if (branch && branch !== 'HEAD') {
      const r = await run('gh', ['pr', 'view', branch, '--json', 'number,url'], { cwd, timeout: 15_000 }).catch(() => null)
      if (r) {
        const j = JSON.parse(r.stdout)
        const repo = new URL(j.url).pathname.split('/').slice(1, 3).join('/')
        value.prs = [await enrichPr({ number: j.number, repo, url: j.url })]
      }
    }
  } catch { /* not a git repo, or git/gh unavailable */ }
  branchCache.set(cwd, { at: Date.now(), value })
  return value
}

let ghStatus: { at: number; value: { ok: boolean; user?: string; message?: string } } | null = null

export async function githubStatus() {
  if (ghStatus && Date.now() - ghStatus.at < 60_000) return ghStatus.value
  let value: { ok: boolean; user?: string; message?: string }
  try {
    const { stdout } = await run('gh', ['api', 'user', '--jq', '.login'], { timeout: 10_000 })
    value = { ok: true, user: stdout.trim() }
  } catch (e: any) {
    value = { ok: false, message: e?.code === 'ENOENT' ? 'GitHub CLI (gh) is not installed' : 'Not signed in: run `gh auth login`' }
  }
  ghStatus = { at: Date.now(), value }
  return value
}

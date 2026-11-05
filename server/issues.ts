import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { RepoIssue } from '../shared/types.ts'

const run = promisify(execFile)
const cache = new Map<string, { at: number; value: { issues: RepoIssue[]; error?: string } }>()

/** Open issues of the GitHub repo in `cwd` (read-only, through the user's `gh` login). Cached for a minute. */
export async function openIssues(cwd: string): Promise<{ issues: RepoIssue[]; error?: string }> {
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return { issues: [], error: 'Not a directory' }
  const hit = cache.get(cwd)
  if (hit && Date.now() - hit.at < 60_000) return hit.value
  let value: { issues: RepoIssue[]; error?: string }
  try {
    const { stdout } = await run('gh', ['issue', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,labels'], { cwd, timeout: 15_000 })
    const rows = JSON.parse(stdout) as { number: number; title: string; labels: { name: string }[] }[]
    value = { issues: rows.map((r) => ({ number: r.number, title: r.title, labels: r.labels.map((l) => l.name) })) }
  } catch (e) {
    value = { issues: [], error: /not a git repository|no git remotes|none of the git remotes/i.test(String((e as Error).message)) ? 'No GitHub repository in this directory' : 'Could not list issues (is `gh` signed in?)' }
  }
  cache.set(cwd, { at: Date.now(), value })
  return value
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseSession } from './claude-parse.ts'
import { enrichPr } from '../github.ts'
import { alertsFor } from '../alerts.ts'
import { idle8h } from '../activity.ts'
import type { SessionDetail, SessionState } from '../../shared/types.ts'

// Claude Code keeps transcripts in <config>/projects and live-session registry in <config>/sessions.
const CLAUDE = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')

interface LiveInfo { pid: number; sessionId: string; status: string; name?: string; bridgeSessionId?: string }

function liveSessions(): Map<string, LiveInfo> {
  const out = new Map<string, LiveInfo>()
  const dir = path.join(CLAUDE, 'sessions')
  if (!fs.existsSync(dir)) return out
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      try { process.kill(j.pid, 0) } catch { continue } // dead process
      out.set(j.sessionId, { pid: j.pid, sessionId: j.sessionId, status: j.status, name: j.name, bridgeSessionId: typeof j.bridgeSessionId === 'string' ? j.bridgeSessionId : undefined })
    } catch { /* file mid-write */ }
  }
  return out
}

function recentFiles(windowDays: number): string[] {
  const root = path.join(CLAUDE, 'projects')
  if (!fs.existsSync(root)) return []
  const cutoff = Date.now() - windowDays * 864e5
  const files: string[] = []
  for (const p of fs.readdirSync(root)) {
    const dir = path.join(root, p)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue
      const full = path.join(dir, f)
      if (fs.statSync(full).mtimeMs >= cutoff) files.push(full)
    }
  }
  return files
}

function stateOf(live: LiveInfo | undefined): SessionState {
  if (!live) return 'finished'
  if (live.status === 'busy') return 'working'
  if (live.status === 'shell') return 'running-shell'
  return 'needs-you' // idle: the agent finished its turn and is waiting for your input
}

async function build(file: string, live: Map<string, LiveInfo>): Promise<SessionDetail | null> {
  const p = await parseSession(file)
  if (!p) return null
  const l = live.get(p.id)
  const state = stateOf(l)
  const { intervals, lastStopReason, ...rest } = p
  const now = Date.now()
  // A turn in progress has no turn_duration event yet: count it as working until now.
  const iv = state === 'working' ? [...intervals, [Math.max(0, ...intervals.map((i) => i[1]), 0) || p.lastActivity, now] as [number, number]] : intervals
  const base = { ...rest, agent: 'claude' as const, costKnown: true, name: l?.name, live: !!l, pid: l?.pid, remote: l?.bridgeSessionId ? { url: `https://claude.ai/code/${l.bridgeSessionId}` } : undefined, state,
    idle8h: idle8h(iv, p.startedAt, l ? now : p.lastActivity, now) }
  void lastStopReason
  return { ...base, alerts: alertsFor(base), prs: await Promise.all(p.prs.map(enrichPr)) }
}

export async function claudeSessions(windowDays: number): Promise<SessionDetail[]> {
  const live = liveSessions()
  return (await Promise.all(recentFiles(windowDays).map((f) => build(f, live)))).filter(Boolean) as SessionDetail[]
}

export async function claudeDetail(id: string): Promise<SessionDetail | null> {
  const root = path.join(CLAUDE, 'projects')
  if (!fs.existsSync(root)) return null
  for (const p of fs.readdirSync(root)) {
    const f = path.join(root, p, `${id}.jsonl`)
    if (fs.existsSync(f)) return build(f, liveSessions())
  }
  return null
}

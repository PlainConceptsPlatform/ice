import { claudeSessions, claudeDetail } from './sources/claude.ts'
import { DEMO, demoDetail, demoOverview } from './demo.ts'
import { opencodeSessions, opencodeDetail } from './sources/opencode.ts'
import { flowFor } from './flow.ts'
import { hostedState, refreshHosted } from './hostclient.ts'
import { isPurged, purgedSet, purge } from './purge.ts'
import type { Alert, Overview, SessionDetail, SessionSummary } from '../shared/types.ts'

const WINDOW_DAYS = Number(process.env.ICE_WINDOW_DAYS ?? 3)

const EIGHT_H = 8 * 3_600_000

function withFlow(s: SessionDetail): SessionDetail {
  // Only look up CI for sessions that were active recently; older ones would just burn gh calls.
  if (!s.live && Date.now() - s.lastActivity > EIGHT_H) return s
  const flow = flowFor(s.cwd, s.branch, s.startedAt)
  if (!flow) return s
  const alerts: Alert[] = [...s.alerts]
  const a = flow.active[0]
  if (a?.stage === 'runner-queue' && (a.queuedMs ?? 0) > 5 * 60_000)
    alerts.push({ kind: 'flow', message: `${a.run.workflow} has waited ${Math.round((a.queuedMs ?? 0) / 60_000)} min for a runner` })
  if (a?.stage === 'approval') alerts.push({ kind: 'flow', message: `${a.run.workflow} is waiting for approval` })
  const l = flow.latest
  if (!a && l?.conclusion && ['failure', 'timed_out', 'startup_failure'].includes(l.conclusion)) {
    alerts.push({ kind: 'flow-failed', message: `${l.workflow} failed on ${flow.branch ?? 'this branch'}` })
  }
  return { ...s, flow, alerts }
}

// Each source is isolated: a missing or broken agent install must never take the dashboard down.
async function safe<T>(name: string, fn: () => Promise<T[]>): Promise<T[]> {
  try { return await fn() } catch (e) { console.error(`[${name}]`, e instanceof Error ? e.message : e); return [] }
}

/** For sessions ICE hosts, ICE knows the real state (the process is its own). */
function hostedOverride<T extends SessionSummary>(s: T): T {
  const h = hostedState(s.id)
  if (!h) return s
  const alerts = h.pending ? [...s.alerts.filter((a) => a.kind !== 'waiting'), { kind: 'waiting' as const, message: `Waiting for your decision: ${h.pending.tool}` }] : s.alerts
  return { ...s, hosted: true, live: true, state: h.pending ? 'needs-you' : h.busy ? 'working' : 'needs-you', alerts }
}

export async function overview(): Promise<Overview> {
  if (DEMO) return demoOverview()
  await refreshHosted()
  const all = (await Promise.all([
    safe('claude', () => claudeSessions(WINDOW_DAYS)),
    safe('opencode', () => opencodeSessions(WINDOW_DAYS)),
  ])).flat().map(withFlow)
  const sessions: SessionSummary[] = all.map(({ timeline, events, ...s }) => hostedOverride(s))
  sessions.sort((a, b) => Number(b.live) - Number(a.live) || b.lastActivity - a.lastActivity)
  const purged = purgedSet()
  const day = new Date(); day.setHours(0, 0, 0, 0)
  // Cost today: approximation — total cost of sessions with activity today.
  const costToday = sessions.filter((s) => s.lastActivity >= day.getTime()).reduce((a, s) => a + s.cost, 0)
  return {
    generatedAt: Date.now(),
    totals: {
      costToday, cost7d: sessions.reduce((a, s) => a + s.cost, 0),
      live: sessions.filter((s) => s.live).length, needsYou: sessions.filter((s) => s.state === 'needs-you').length,
    },
    sessions: sessions.filter((s) => !isPurged(purged, s)),
    purged: sessions.filter((s) => isPurged(purged, s)).length,
  }
}

/** Hides every finished session from the view (see purge.ts). Returns how many were hidden. */
export async function purgeFinished(): Promise<number> {
  const o = await overview()
  return purge(o.sessions.filter((s) => s.state === 'finished'))
}

export async function detail(id: string): Promise<SessionDetail | null> {
  if (DEMO) return demoDetail(id)
  const d = (await claudeDetail(id)) ?? (await opencodeDetail(id).catch(() => null))
  return d ? hostedOverride(withFlow(d)) : null
}

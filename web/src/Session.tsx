import { useEffect, useState } from 'react'
import type { ActiveFlow, FlowInfo, FlowRun, SessionDetail, SessionSummary } from '../../shared/types'
import { AGENT_LABEL, STATE_LABEL, ago, dur, fmt, money, tok } from './format'

export type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'muted'
export interface Phase { label: string; tone: Tone; rank: number }

const FAILED = ['failure', 'timed_out', 'startup_failure']
export const isFailed = (r?: FlowRun) => !!r?.conclusion && FAILED.includes(r.conclusion)

/** The one-line answer to "what is this session doing right now?" */
export function phaseOf(s: SessionSummary): Phase {
  const a = s.flow?.active[0]
  if (s.state === 'finished' && !a) return { label: 'Finished', tone: 'muted', rank: 9 }
  if (a) {
    const agentBusy = s.state === 'working'
    const base = { 'runner-queue': 'Waiting: runner', approval: 'Waiting: approval', deploying: 'Deploying', running: 'In flow' }[a.stage]
    const tone: Tone = a.stage === 'approval' ? 'warn' : a.stage === 'runner-queue' ? 'warn' : 'info'
    return { label: agentBusy ? `Agent + ${base.toLowerCase()}` : base, tone, rank: a.stage === 'approval' ? 0 : 3 }
  }
  if (isFailed(s.flow?.latest) && !s.flow?.active.length) return { label: 'Flow failed', tone: 'bad', rank: 0 }
  if (s.state === 'needs-you') return { label: 'Needs you', tone: 'warn', rank: 1 }
  if (s.state === 'running-shell') return { label: 'Running shell', tone: 'ok', rank: 4 }
  return { label: STATE_LABEL[s.state] === 'Working' ? 'Agent working' : STATE_LABEL[s.state], tone: 'info', rank: 5 }
}

export function RemoteIcon({ s }: { s: SessionSummary }) {
  if (!s.remote) return null
  return (
    <a className="remoteicon" href={s.remote.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
      title="Remote Control is on: open this session in claude.ai" aria-label="Remote Control active, open in claude.ai">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" /><path d="M5.2 5.2a4 4 0 0 0 0 5.6M10.8 5.2a4 4 0 0 1 0 5.6M3 3a7 7 0 0 0 0 10M13 3a7 7 0 0 1 0 10" />
      </svg>
    </a>
  )
}

/** The goal chip. With `onToggle` it is a button that expands the goal text (cells); without, a plain label (modal). */
export function GoalChip({ s, open, onToggle }: { s: SessionSummary; open?: boolean; onToggle?: () => void }) {
  if (!s.goal) return null
  const label = `◎ ${s.goal.met ? 'Goal met' : 'Goal'}`
  const cls = `goalchip ${s.goal.met ? 'met' : ''}`
  if (!onToggle) return <span className={cls} title={s.goal.condition}>{label}</span>
  // Inside a clickable, draggable header: neither the click nor Enter/Space may reach it (they would open the conversation).
  return (
    <button type="button" className={cls} aria-expanded={!!open} aria-label={open ? 'Hide the goal' : 'Show the goal'} title={open ? 'Hide the goal' : 'Show the goal'}
      onClick={(e) => { e.stopPropagation(); onToggle() }} onKeyDown={(e) => e.stopPropagation()}>{label}</button>
  )
}

const RUN_ICON = (r: FlowRun) => (r.status !== 'completed' ? '…' : r.conclusion === 'success' ? '✓' : isFailed(r) ? '✕' : '–')
const RUN_TONE = (r: FlowRun): Tone => (r.status !== 'completed' ? 'warn' : r.conclusion === 'success' ? 'ok' : isFailed(r) ? 'bad' : 'muted')

/** Compact flow summary used in the collapsed row. */
export function FlowSummary({ s }: { s: SessionSummary }) {
  const f = s.flow
  if (!f) return <span className="muted">no repo</span>
  if (f.loading) return <span className="muted">Reading GitHub…</span>
  if (f.error) return <span className="muted" title={f.error}>GitHub: {f.error}</span>
  const a = f.active[0]
  if (a) {
    return (
      <div className="flowsum">
        <b>{a.run.workflow}</b>
        {a.stage === 'runner-queue' && <span className="warn"> · waiting {fmt(a.queuedMs)} for a runner</span>}
        {a.stage === 'approval' && <span className="warn"> · awaiting approval</span>}
        {(a.stage === 'running' || a.stage === 'deploying') && (
          <span> · {a.stage === 'deploying' ? 'deploying · ' : ''}{a.step ? `“${a.step}”` : a.job ?? 'running'}{a.nextStep ? <span className="muted"> → {a.nextStep}</span> : null}</span>
        )}
        <div className="muted small">
          {a.flowEtaMs != null ? (a.overrunMs ? `overrunning +${fmt(a.overrunMs)}` : `~${fmt(a.flowEtaMs)} left`) : 'no history'}
          {f.iteration > 1 && ` · iteration ${f.iteration}`}{f.expectIterate.value && ' · will iterate'}
        </div>
      </div>
    )
  }
  if (f.latest) {
    return (
      <div className="flowsum">
        <span className={`rt ${RUN_TONE(f.latest)}`}>{RUN_ICON(f.latest)}</span> {f.latest.workflow}
        <span className="muted"> · {f.latest.conclusion} {ago(Date.parse(f.latest.updatedAt))}</span>
        <div className="muted small">{f.expectIterate.value ? '↻ ' : ''}{f.expectIterate.reason}</div>
      </div>
    )
  }
  return <span className="muted">No runs yet</span>
}

/** 8-hour working/idle strip. */
export function IdleStrip({ s, big }: { s: SessionSummary; big?: boolean }) {
  const { buckets, idleMs, existsMs } = s.idle8h
  return (
    <div className={`strip ${big ? 'big' : ''}`} title={existsMs ? `Idle ${fmt(idleMs)} of ${fmt(existsMs)} in the last 8 h` : 'No activity in the last 8 h'}>
      {buckets.map((v, i) => <i key={i} style={{ opacity: v < 0 ? 0.12 : 0.18 + v * 0.82 }} className={v < 0 ? 'none' : v > 0.05 ? 'on' : 'off'} />)}
    </div>
  )
}

export const idlePct = (s: SessionSummary) => (s.idle8h.existsMs ? Math.round((s.idle8h.idleMs / s.idle8h.existsMs) * 100) : 0)

function Metric({ k, v, tone }: { k: string; v: React.ReactNode; tone?: Tone }) {
  return <div className="metric"><span>{k}</span><b className={tone}>{v}</b></div>
}

function FlowPanel({ f }: { f?: FlowInfo }) {
  if (!f) return <p className="muted">No git repository or branch for this session.</p>
  if (f.loading) return <p className="muted">Reading GitHub Actions…</p>
  if (f.error) return <p className="muted">{f.error}</p>
  return (
    <>
      {f.active.length === 0 && <p className="muted small">No flow running on <span className="mono">{f.branch}</span>.</p>}
      {f.active.map((a) => <ActiveBlock key={a.run.runId} a={a} />)}
      <div className="metrics">
        <Metric k="Iteration" v={f.iteration ? `#${f.iteration}` : '—'} />
        <Metric k="Failed runs" v={f.failedSinceStart} tone={f.failedSinceStart ? 'bad' : undefined} />
        <Metric k="Keeps iterating?" v={f.expectIterate.value == null ? 'unknown' : f.expectIterate.value ? 'likely' : 'unlikely'} tone={f.expectIterate.value ? 'warn' : undefined} />
      </div>
      <p className="muted small">{f.expectIterate.reason}</p>
      {f.recent.length > 0 && (
        <ul className="runs">
          {f.recent.slice(0, 5).map((r) => (
            <li key={r.runId}><a href={r.url} target="_blank" rel="noreferrer">
              <i className={`rt ${RUN_TONE(r)}`}>{RUN_ICON(r)}</i><span className="wf">{r.workflow}</span>
              <span className="muted">{r.status === 'completed' ? r.conclusion : r.status.replace('_', ' ')} · {ago(Date.parse(r.createdAt))}</span>
            </a></li>
          ))}
        </ul>
      )}
    </>
  )
}

const STAGE = { 'runner-queue': 'Waiting for a runner', running: 'Running', deploying: 'Deploying', approval: 'Waiting for approval' } as const

function ActiveBlock({ a }: { a: ActiveFlow }) {
  const cur = a.jobs.find((j) => j.name === a.job)
  return (
    <div className="active">
      <div className="ah">
        <a href={a.run.url} target="_blank" rel="noreferrer"><b>{a.run.workflow}</b></a>
        <span className={`pill ${a.stage === 'running' || a.stage === 'deploying' ? 'working' : 'needs-you'}`}>{STAGE[a.stage]}</span>
        <span className="muted small">{a.run.event}{a.run.attempt > 1 ? ` · attempt ${a.run.attempt}` : ''}</span>
      </div>
      <div className="metrics">
        <Metric k="In flow" v={fmt(a.elapsedMs)} />
        {a.queuedMs != null && <Metric k="Queued" v={fmt(a.queuedMs)} tone="warn" />}
        {a.step && <Metric k="Step" v={`${fmt(a.stepElapsedMs)}${a.stepMedianMs != null ? ` / ~${fmt(a.stepMedianMs)}` : ''}`} />}
        {a.stepEtaMs != null && <Metric k="Step ETA" v={fmt(a.stepEtaMs)} />}
        <Metric k="Flow typical" v={fmt(a.flowMedianMs)} />
        <Metric k={a.overrunMs ? 'Overrun' : 'Flow ETA'} v={a.overrunMs ? `+${fmt(a.overrunMs)}` : fmt(a.flowEtaMs)} tone={a.overrunMs ? 'warn' : undefined} />
      </div>
      {cur && (
        <ol className="steps">
          {cur.steps.map((st) => (
            <li key={st.name} className={st.status === 'in_progress' ? 'cur' : st.status === 'completed' ? 'done' : ''}>
              <i>{st.status === 'in_progress' ? '▶' : st.status === 'completed' ? (st.conclusion === 'success' || st.conclusion === 'skipped' ? '✓' : '✕') : '·'}</i>
              {st.name}{st.name === a.nextStep && <em> next</em>}
            </li>
          ))}
        </ol>
      )}
      {!cur && a.jobs.length > 0 && <p className="muted small">{a.jobs.map((j) => `${j.name}: ${j.status}`).join(' · ')}</p>}
      {a.nextStep && !cur?.steps.some((st) => st.name === a.nextStep) && <p className="muted small">Next: {a.nextStep}</p>}
    </div>
  )
}

export function SessionPanel({ s }: { s: SessionSummary }) {
  const [d, setD] = useState<SessionDetail | null>(null)
  useEffect(() => { fetch(`/api/sessions/${s.id}`).then((r) => r.json()).then(setD).catch(() => {}) }, [s.id])
  const total = s.cost || 1
  return (
    <div className="panel">
      <section>
        <h4>Flow</h4>
        <FlowPanel f={s.flow} />
      </section>
      <section>
        <h4>Session</h4>
        <div className="metrics">
          <Metric k="Running for" v={dur(s.startedAt, s.live ? Date.now() : s.lastActivity)} />
          <Metric k="Idle" v={fmt(s.idle8h.idleMs)} tone={idlePct(s) > 60 ? 'warn' : undefined} />
          <Metric k="Idle share" v={s.idle8h.existsMs ? `${idlePct(s)}%` : '—'} />
        </div>
        <IdleStrip s={s} big />
        <div className="strip-legend muted small"><span>8 h ago</span><span>now</span></div>
        <div className="metrics">
          <Metric k="Agent working" v={fmt(s.idle8h.activeMs)} />
          <Metric k="Turns" v={s.turns} />
          <Metric k="Errors" v={s.errors} tone={s.errors >= 10 ? 'bad' : undefined} />
          <Metric k="Tokens in/out" v={`${tok(s.tokens.input + s.tokens.cacheRead)} / ${tok(s.tokens.output)}`} />
          <Metric k="Compactions" v={s.compactions} tone={s.compactions >= 2 ? 'warn' : undefined} />
          <Metric k="Cost (est.)" v={money(s.cost, s.costKnown)} />
        </div>
        {Object.entries(s.models).map(([m, c]) => (
          <div className="bar" key={m}><span>{m}</span><i style={{ width: `${s.costKnown ? (c / total) * 100 : 0}%` }} /><b>{money(c, s.costKnown)}</b></div>
        ))}
      </section>
      <section>
        <h4>Pull requests</h4>
        {s.prs.length === 0 ? <p className="muted small">None linked</p> : (
          <ul className="prlist">
            {[...s.prs].sort((a, b) => b.number - a.number).slice(0, 4).map((p) => (
              <li key={p.url}><a href={p.url} target="_blank" rel="noreferrer">#{p.number}</a> <span>{p.title ?? p.repo}</span>
                <em className="muted">{p.state?.toLowerCase()}{p.checks && p.checks !== 'none' ? ` · checks ${p.checks}` : ''}</em></li>
            ))}
          </ul>
        )}
        {d && d.events.length > 0 && (<>
          <h4 className="h-events">Latest prompts</h4>
          <ul className="events">{d.events.slice(-3).reverse().map((e, i) => <li key={i} className={e.kind}><time>{ago(e.t)}</time>{e.text}</li>)}</ul>
        </>)}
        <p className="muted small mono">{s.cwd}</p>
      </section>
    </div>
  )
}

export { AGENT_LABEL }

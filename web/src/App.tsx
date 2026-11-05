import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Agent, SessionSummary } from '../../shared/types'
import { useOverview } from './useOverview'
import { AGENT_LABEL, usd } from './format'
import { Cells, PAGE_SIZES, type PageSize } from './Wall'
import { idlePct, phaseOf } from './Session'
import { NewSession } from './NewSession'
import { moveSlot, reconcile, type Layout } from './layout'
import { SessionModal } from './Modal'
import { Palette } from './Palette'
import { opensNewSession } from './shortcuts'
import { post } from './api'

type SortKey = 'attention' | 'activity' | 'cost' | 'idle' | 'duration' | 'compactions' | 'errors' | 'eta'
const SORT_LABEL: Record<SortKey, string> = { attention: 'Attention', activity: 'Last activity', cost: 'Cost', idle: 'Idle (8 h)', duration: 'Running time', compactions: 'Compactions', errors: 'Errors', eta: 'Flow ETA' }
const needsYou = (s: SessionSummary) => (s.live && s.alerts.length > 0) || s.alerts.some((a) => a.kind === 'flow-failed')
type Status = 'all' | 'live' | 'flow' | 'attention'

const sortVal: Record<SortKey, (s: SessionSummary) => number> = {
  attention: (s) => phaseOf(s).rank * 1e13 - s.lastActivity, // lower rank first, then newest
  activity: (s) => -s.lastActivity,
  cost: (s) => -s.cost,
  idle: (s) => -idlePct(s),
  duration: (s) => -((s.live ? Date.now() : s.lastActivity) - s.startedAt),
  compactions: (s) => -s.compactions,
  errors: (s) => -s.errors,
  eta: (s) => s.flow?.active[0]?.flowEtaMs ?? Infinity,
}

export function App() {
  const { data, error } = useOverview()
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'dark')
  const [gh, setGh] = useState<{ ok: boolean; user?: string; message?: string } | null>(null)
  const [agent, setAgent] = useState<Agent | 'all'>('all')
  const [status, setStatus] = useState<Status>('all')
  const [grouped, setGrouped] = useState(true)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'attention', dir: 1 })
  const [size, setSize] = useState<PageSize>(() => {
    const n = Number(localStorage.getItem('ice-cells'))
    return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : 4
  })
  const strip = useRef<HTMLDivElement>(null)
  const [creating, setCreating] = useState(false)
  const [searching, setSearching] = useState(false)
  // The open session modal lives here, not inside its cell: a refresh that moves the session out of the filtered set
  // (or leaves a hole) must not close it, and it always shows the latest data of that session.
  const [openId, setOpenId] = useState<string | null>(null)
  const closeModal = useCallback(() => setOpenId(null), [])
  const lastOpen = useRef<SessionSummary | undefined>(undefined)
  const [pending, setPending] = useState<string[] | null>(null) // cells to reveal as soon as they are on the wall
  const [hl, setHl] = useState<ReadonlySet<string>>(new Set())
  const [resort, setResort] = useState(0)
  const [shown, setShown] = useState(0) // how many cells are mounted; grows as the strip is scrolled

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('ice-theme', theme) }, [theme])
  useEffect(() => { localStorage.setItem('ice-cells', String(size)) }, [size])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return
      const el = strip.current
      if (!el) return
      if (e.key === 'ArrowRight') el.scrollBy({ left: el.clientWidth, behavior: 'smooth' })
      if (e.key === 'ArrowLeft') el.scrollBy({ left: -el.clientWidth, behavior: 'smooth' })
    }
    addEventListener('keydown', h); return () => removeEventListener('keydown', h)
  }, [])
  useEffect(() => { fetch('/api/github').then((r) => r.json()).then(setGh).catch(() => setGh({ ok: false, message: 'API unreachable' })) }, [])

  const all = data?.sessions ?? []
  const visible = all
    .filter((s) => (agent === 'all' || s.agent === agent) &&
      (status === 'all' || (status === 'live' ? s.live : status === 'flow' ? !!s.flow?.active.length : needsYou(s))))
    .sort((a, b) => (sortVal[sort.key](a) - sortVal[sort.key](b)) * sort.dir)

  const groups = useMemo(() => {
    if (!grouped) return [{ key: '', rows: visible }]
    const m = new Map<string, SessionSummary[]>()
    for (const s of visible) m.set(s.project, [...(m.get(s.project) ?? []), s]) // keeps sort order; groups ordered by their best row
    return [...m.entries()].map(([key, rows]) => ({ key, rows }))
  }, [visible, grouped])

  const ordered = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  // Cells keep their position: a session gets a slot when it first appears and keeps it while it stays in the
  // filtered set, even if that leaves holes. Changing a filter, the sort or the grouping (or "Re-sort") lays them out again.
  const layoutKey = `${agent}|${status}|${grouped}|${sort.key}|${sort.dir}|${resort}`
  const layoutRef = useRef<Layout | null>(null)
  const [moved, setMoved] = useState(0)
  const slots = useMemo(() => {
    void moved
    if (!data) return layoutRef.current?.slots ?? []
    if (!layoutRef.current) {
      try { const s = JSON.parse(localStorage.getItem('ice-layout') ?? 'null'); if (s?.key === layoutKey && Array.isArray(s.slots)) layoutRef.current = { key: layoutKey, slots: s.slots, mem: new Map() } } catch { /* ignore */ }
    }
    layoutRef.current = reconcile(layoutRef.current, ordered.map((s) => s.id), layoutKey)
    return layoutRef.current.slots
  }, [data, ordered, layoutKey, moved])
  // Drag and drop: the cell takes the target slot; whatever was there takes the old one (a hole stays a hole).
  const move = useCallback((id: string, to: number) => {
    const p = layoutRef.current; if (!p) return
    layoutRef.current = moveSlot(p, id, to); setMoved((n) => n + 1)
  }, [])
  useEffect(() => { if (data) localStorage.setItem('ice-layout', JSON.stringify({ key: layoutKey, slots })) }, [slots, layoutKey, data])

  const batch = size * 2 // mount two screens ahead; more as the strip nears its end
  const mounted = Math.min(slots.length, Math.max(shown, batch))
  const byId = useMemo(() => new Map(all.map((s) => [s.id, s])), [all])
  const fresh = openId ? byId.get(openId) : undefined
  if (fresh) lastOpen.current = fresh
  const openSession = openId ? fresh ?? (lastOpen.current?.id === openId ? lastOpen.current : undefined) : undefined
  const rows = slots.slice(0, mounted).map((id) => (id ? byId.get(id) ?? null : null))
  const holes = slots.filter((x) => x === null).length
  useEffect(() => { setShown(0); strip.current?.scrollTo({ left: 0 }) }, [layoutKey, size])
  const onScroll = useCallback(() => {
    const el = strip.current
    if (el && el.scrollLeft + el.clientWidth > el.scrollWidth - el.clientWidth * 1.5) setShown((n) => n + size)
  }, [size])
  useEffect(() => { onScroll() }, [mounted, onScroll]) // a fresh batch may still not fill the lookahead

  const inbox = all.filter((s) => needsYou(s))
  const inFlow = all.filter((s) => s.flow?.active.length)
  const blocked = inFlow.filter((s) => ['runner-queue', 'approval'].includes(s.flow!.active[0].stage)).length

  const finished = all.filter((s) => s.state === 'finished').length
  const act = (path: string) => post(path).catch(() => undefined)

  // Cell reveal: scroll the first of `ids` to the centre and flash all of them. Used by search, the inbox and new sessions.
  const reveal = (ids: string[]) => {
    const present = ids.filter((id) => slots.includes(id)).sort((x, y) => slots.indexOf(x) - slots.indexOf(y))
    if (!present.length) return
    setShown((n) => Math.max(n, slots.indexOf(present[present.length - 1]) + size)) // make sure every target cell is mounted
    setHl(new Set(present))
    setTimeout(() => document.getElementById(`s-${present[0]}`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }), 80)
    setTimeout(() => setHl(new Set()), 2800)
  }
  const focus = (id: string) => reveal([id])
  // Jump to cells; if filters hide them, clear the filters first and reveal once the wall has been laid out again.
  const goTo = (ids: string[]) => {
    if (ids.some((id) => slots.indexOf(id) < 0)) { setAgent('all'); setStatus('all') }
    setPending(ids)
  }
  useEffect(() => {
    if (!pending) return
    const present = pending.filter((id) => slots.includes(id))
    if (present.length) { reveal(present); setPending(null); return }
    const t = setTimeout(() => setPending(null), 20_000) // gave up: the session never showed up
    return () => clearTimeout(t)
  }, [pending, slots])
  useEffect(() => { // N starts a new session (unless you are typing or a dialog is open)
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (!opensNewSession(e, { targetTag: t?.tagName, targetEditable: !!t?.isContentEditable, dialogOpen: creating || searching || openId !== null })) return
      e.preventDefault(); setCreating(true)
    }
    addEventListener('keydown', h); return () => removeEventListener('keydown', h)
  }, [creating, searching, openId])
  useEffect(() => { // Cmd/Ctrl+K opens the search
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearching((s) => !s) } }
    addEventListener('keydown', h); return () => removeEventListener('keydown', h)
  }, [])

  const toolbar = (
    <div className="toolbar">
      <h2>Sessions <span className="count">{visible.length}</span></h2>
      <div className="seg">{(['all', 'claude', 'opencode'] as const).map((a) => (
        <button key={a} className={agent === a ? 'on' : ''} onClick={() => setAgent(a)}>{a === 'all' ? 'All agents' : AGENT_LABEL[a]}</button>))}</div>
      <div className="seg">{(['all', 'live', 'flow', 'attention'] as Status[]).map((f) => (
        <button key={f} className={status === f ? 'on' : ''} onClick={() => setStatus(f)}>{{ all: 'All', live: 'Live', flow: 'In flow', attention: 'Alerts' }[f]}</button>))}</div>
      <div className="seg">
        <button className={grouped ? 'on' : ''} onClick={() => setGrouped(true)}>By project</button>
        <button className={!grouped ? 'on' : ''} onClick={() => setGrouped(false)}>Flat</button>
      </div>
      <label className="sortsel muted">Sort
        <select value={sort.key} onChange={(e) => setSort({ key: e.target.value as SortKey, dir: 1 })}>
          {Object.entries(SORT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="seg-btn" onClick={() => setSort((p) => ({ ...p, dir: (-p.dir) as 1 | -1 }))} aria-label="Reverse sort order">{sort.dir === 1 ? '↑' : '↓'}</button>
      </label>
      <div className="seg">
        <button disabled={!finished} onClick={() => act('/api/purge')} title="Hide all finished sessions from ICE. Nothing is deleted; they return if they get new activity.">Purge finished{finished ? ` (${finished})` : ''}</button>
        {!!data?.purged && <button onClick={() => act('/api/restore')} title="Show the hidden sessions again">Restore {data.purged} hidden</button>}
      </div>
      {holes > 0 && <button className="seg-btn" onClick={() => setResort((n) => n + 1)} title="Lay the cells out again, closing the gaps and applying the current sort">Re-sort</button>}
      <div className="seg" role="group" aria-label="Cells per screen">
        <span className="seglabel muted" title="Cells per screen" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
        </span>
        {PAGE_SIZES.map((n) => <button key={n} className={n === size ? 'on' : ''} onClick={() => setSize(n)}>{n}</button>)}
      </div>
    </div>
  )

  const wallHeader = data && (
    <div className="wallstats">
      <div className="ws-left">
        <b>ICE</b><span><b>{data.totals.live}</b> live</span><span className={inbox.length ? 'warn' : ''}><b>{inbox.length}</b> need attention</span>
        <span><b>{inFlow.length}</b> in flow{blocked ? ` (${blocked} blocked)` : ''}</span><span><b>{usd(data.totals.costToday)}</b> today (est.)</span>
      </div>
      <button className="seg-btn searchbtn" onClick={() => setSearching(true)} title="Search sessions and projects" aria-label="Search sessions and projects">⌕ Search <kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd></button>
      <div className="ws-right">
        <button className="theme" aria-label="Toggle theme" title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀' : '☾'}</button>
        <span className={error ? 'conn off' : 'conn'}>{error ? 'API unreachable' : 'Live · local'}</span>
        {gh && <span className={gh.ok ? 'gh ok' : 'gh off'} title={gh.ok ? `GitHub: signed in as ${gh.user}` : gh.message}>{gh.ok ? `GitHub · ${gh.user}` : 'GitHub ✕'}</span>}
        <button className="primary" onClick={() => setCreating(true)} title="Start a session that ICE owns (Claude Code or OpenCode). Shortcut: N">＋ New session <kbd>N</kbd></button>
      </div>
    </div>
  )

  return (
    <div className="shell">
      <main className="main wall">
        {!data ? <p className="muted">Reading sessions…</p> : (
          <>
            {wallHeader}
            {inbox.length > 0 && (
              <div className="inboxbar" aria-label="Needs your attention">
                <span className="warn">Needs your attention</span>
                {inbox.map((s) => (
                  <button key={s.id} onClick={() => focus(s.id)} title={s.alerts.map((a) => a.message).join(' · ')}>
                    <span className={`pill ${phaseOf(s).tone}`}>{phaseOf(s).label}</span>
                    <b>{s.project}</b>
                  </button>
                ))}
              </div>
            )}
            {toolbar}
            {ordered.length === 0 ? <p className="empty">No sessions match these filters.</p> : <Cells rows={rows} size={size} stripRef={strip} onScroll={onScroll} hl={hl} onMove={move} onOpen={setOpenId} />}
          </>
        )}
      </main>
      {openSession && <SessionModal s={openSession} onClose={closeModal} />}
      {creating && <NewSession sessions={all} onClose={() => setCreating(false)} onStarted={(id) => { setSort({ key: 'activity', dir: 1 }); setPending([id]) }} />}
      {searching && <Palette sessions={all} onPick={goTo} onClose={() => setSearching(false)} />}
    </div>
  )
}

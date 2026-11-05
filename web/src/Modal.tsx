import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { HostedPending, SessionSummary, SlashCommandInfo, TranscriptItem } from '../../shared/types'
import { post } from './api'
import { Composer, strip, type Attached } from './Composer'
import { AGENT_LABEL, ago } from './format'
import { GoalChip, RemoteIcon, phaseOf } from './Session'
import { Markdown } from './Markdown'
import { visibleItems } from './transcript-view'

const ROLE: Record<TranscriptItem['role'], string> = { user: 'You', assistant: 'Agent', tool: 'Tool', result: 'Result' }

export function SessionModal({ s, onClose }: { s: SessionSummary; onClose: () => void }) {
  const [items, setItems] = useState<TranscriptItem[] | null>(null)
  const [err, setErr] = useState(false)
  const [host, setHost] = useState<{ busy: boolean; pending?: HostedPending; error?: string } | null>(null)
  const [text, setText] = useState('')
  // Tool calls and their results are internal noise for most readers: hidden unless asked, and the choice is remembered.
  const [showInternal, setShowInternal] = useState(() => localStorage.getItem('ice-show-internal') === '1')
  const toggleInternal = () => setShowInternal((v) => { localStorage.setItem('ice-show-internal', v ? '0' : '1'); return !v })
  const [images, setImages] = useState<Attached[]>([])
  const [cmds, setCmds] = useState<SlashCommandInfo[] | null>(null)
  const cmdsAsked = useRef(false)
  const [sending, setSending] = useState(false)
  const [actErr, setActErr] = useState('')
  const body = useRef<HTMLDivElement>(null)
  const stick = useRef(true) // keep following the end unless the user scrolled up
  const byUser = useRef(false) // programmatic scrolls (and late layout growth) must not clear `stick`
  const ph = phaseOf(s)

  const seen = useRef('') // last transcript payload: an unchanged refresh must not re-render (it would reset selection and scroll)
  useEffect(() => {
    let live = true
    const load = () => fetch(`/api/sessions/${s.id}/transcript`).then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((raw) => { if (!live) return; setErr(false); if (raw === seen.current) return; seen.current = raw; const d = JSON.parse(raw) as { items: TranscriptItem[]; host: typeof host }; setItems(d.items); setHost(d.host) }).catch(() => live && setErr(true))
    load()
    const iv = setInterval(load, host?.pending || host?.busy ? 1500 : 4000)
    return () => { live = false; clearInterval(iv) }
  }, [s.id, host?.busy, !!host?.pending])

  // `onClose` may be a new function on every render: keep it in a ref so this effect (and its focus restore) runs only on open and close.
  const closeRef = useRef(onClose); closeRef.current = onClose
  const opener = useRef<HTMLElement | null>(null) // the element that had focus before the modal opened (read before autoFocus moves it)
  if (opener.current === null && typeof document !== 'undefined') opener.current = document.activeElement as HTMLElement | null
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    addEventListener('keydown', h)
    return () => { removeEventListener('keydown', h); opener.current?.focus?.({ preventScroll: true }) }
  }, [])

  useEffect(() => {
    const el = body.current
    if (!el || !stick.current) return
    const down = () => { el.scrollTop = el.scrollHeight }
    down(); const r = requestAnimationFrame(down); return () => cancelAnimationFrame(r)
  }, [items])

  const hosted = s.hosted || !!host
  const view = items ? visibleItems(items, showInternal) : null
  const [cmd, setCmd] = useState('')
  const [chrome, setChrome] = useState(true)
  const [autoAllow, setAutoAllow] = useState(true)
  const canResume = !hosted && !s.live
  const run = async (fn: () => Promise<unknown>) => {
    setActErr(''); setSending(true)
    try { await fn(); stick.current = true } catch (e) { setActErr((e as Error).message) } finally { setSending(false) }
  }
  // Hand the session over to a terminal: free it in ICE first (two writers on one transcript corrupt it), then give the command.
  const shq = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`
  const terminalCmd = s.agent === 'claude' ? `cd ${shq(s.cwd)} && claude --resume ${s.id} --remote-control` : `cd ${shq(s.cwd)} && opencode --session ${s.id}`
  const handoff = () => run(async () => { await post(`/api/sessions/${s.id}/stop`); setCmd(terminalCmd) })
  const clearDraft = () => { setText(''); setImages([]) }
  const resume = () => { const m = text.trim(); if (m || images.length) run(async () => { await post(`/api/sessions/${s.id}/resume`, { text: m, chrome, autoAllow, images: strip(images) }); clearDraft() }) }
  const sendMsg = () => { const m = text.trim(); if (m || images.length) run(async () => { await post(`/api/sessions/${s.id}/message`, { text: m, images: strip(images) }); clearDraft() }) }
  // Commands and skills of this session (live list when ICE hosts it, otherwise read for its directory). Loaded the first time the user types "/".
  const [cmdErr, setCmdErr] = useState('')
  const wantCommands = () => {
    if (cmdsAsked.current) return
    cmdsAsked.current = true
    post<{ commands: SlashCommandInfo[] }>('/api/commands', { id: s.id }).then((d) => { if (!Array.isArray(d.commands)) throw new Error('Unexpected answer from the ICE server'); setCmdErr(''); setCmds(d.commands) })
      .catch((e: Error) => { setCmdErr(e.message); cmdsAsked.current = false })
  }

  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={s.title}>
        <header>
          <div className="r1">
            <span className={`pill ${ph.tone}`}>{ph.label}</span>
            <span className={`agent ${s.agent}`}>{AGENT_LABEL[s.agent]}</span>
            <GoalChip s={s} />
            <RemoteIcon s={s} />
            <span className="muted small spacer">{ago(s.lastActivity)}</span>
            <button className={`seg-btn ${showInternal ? 'on' : ''}`} onClick={toggleInternal} aria-pressed={showInternal}
              title={showInternal ? 'Hide tool calls and their results' : 'Show tool calls and their results'}>
              Tools{view && !showInternal && view.hidden > 0 ? ` · ${view.hidden} hidden` : showInternal ? ' · shown' : ''}</button>
            <button className="seg-btn" onClick={onClose} aria-label="Close" autoFocus>✕</button>
          </div>
          <Title s={s} />
          <div className="muted mono small">{s.project} · {s.branch ?? '—'}</div>
          {s.goal && <p className="small goalline"><span className="muted">Goal:</span> {s.goal.condition}</p>}
          {s.alerts.map((a, i) => <div key={i} className={`calert ${a.kind}`}>{a.message}</div>)}
        </header>
        <div className="mbody" ref={body} onWheel={() => (byUser.current = true)} onTouchMove={() => (byUser.current = true)} onPointerDown={() => (byUser.current = true)}
          onScroll={(e) => { if (!byUser.current) return; const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
          {err && !items && <p className="muted">Could not read this session's transcript.</p>}
          {!items && !err && <p className="muted">Reading transcript…</p>}
          {items?.length === 0 && <p className="muted">No messages yet.</p>}
          {view && view.shown.length === 0 && items!.length > 0 && <p className="muted">Only tool activity so far. Use the Tools button to show it.</p>}
          {view?.shown.map((m, i) => (
            <div key={i} className={`msg ${m.role} ${m.isError ? 'err' : ''}`}>
              <div className="who">{m.tool ?? ROLE[m.role]}{m.t ? <span className="muted small"> · {ago(m.t)}</span> : null}</div>
              {m.role === 'user' || m.role === 'assistant' ? <Markdown text={m.text} /> : <pre>{m.text}</pre>}
            </div>
          ))}
        </div>
        {host?.pending && <PendingPanel p={host.pending} busy={sending} onAnswer={(r) => run(() => post(`/api/sessions/${s.id}/respond`, { requestId: host.pending!.requestId, ...r }))} />}
        {hosted ? (
          <div className="composer">
            {host?.error && <div className="calert flow-failed">{host.error}</div>}
            {actErr && <div className="calert flow-failed">{actErr}</div>}
            {!cmd && <Composer value={text} onChange={setText} onSend={sendMsg} images={images} onImages={setImages} commands={cmds} commandsError={cmdErr} onWantCommands={wantCommands}
              placeholder={host?.pending ? 'Answer the request above first, or type a message to queue' : host?.busy ? 'Agent is working — your message is queued' : 'Message the agent…  (Enter sends, Shift+Enter for a new line)'} />}
            {cmd && <CommandBox cmd={cmd} note={s.agent === 'claude' ? 'Released from ICE. Run this in a terminal to continue the same session there with Remote Control:' : 'Released from ICE. Run this in a terminal to continue the same session in OpenCode:'} />}
            {!cmd && <div className="crow">
              <span className="muted small">{host?.busy ? 'Working…' : 'Waiting for you'}</span>
              <span className="spacer" />
              { <button onClick={handoff} disabled={sending || !!host?.busy || !!host?.pending} title={host?.busy || host?.pending ? 'Wait until the agent is idle' : 'Stop the session here and get the command to continue it in a terminal'}>Continue in terminal</button>}
              {host?.busy && <button onClick={() => run(() => post(`/api/sessions/${s.id}/interrupt`))} disabled={sending}>Interrupt</button>}
              <button className="primary" onClick={sendMsg} disabled={sending || (!text.trim() && !images.length)}>Send</button>
            </div>}
          </div>
        ) : canResume ? (
          <div className="composer">
            {actErr && <div className="calert flow-failed">{actErr}</div>}
            {cmd && <CommandBox cmd={cmd} note="Run this in a terminal to continue the session there (do not also resume it here):" />}
            <p className="muted small resumenote">This session has finished. Sending a message resumes it from ICE (same session, same transcript). Resuming reloads the whole context, so the first turn can cost noticeably more{s.costKnown && s.cost > 0 ? ` (this session has cost about $${s.cost.toFixed(2)} so far)` : ''}.</p>
            <Composer value={text} onChange={setText} onSend={resume} images={images} onImages={setImages} commands={cmds} commandsError={cmdErr} onWantCommands={wantCommands} placeholder="Message to resume with…  (Enter sends, Shift+Enter for a new line)" />
            <div className="crow"><button className="linkbtn" onClick={() => setCmd(terminalCmd)}>Or continue in a terminal</button><label className="chk"><input type="checkbox" checked={autoAllow} onChange={(e) => setAutoAllow(e.target.checked)} />Auto-allow</label>{s.agent === 'claude' && <label className="chk"><input type="checkbox" checked={chrome} onChange={(e) => setChrome(e.target.checked)} />Claude in Chrome</label>}<span className="spacer" />
              <button className="primary" onClick={resume} disabled={sending || (!text.trim() && !images.length)}>{sending ? 'Resuming…' : 'Resume and send'}</button></div>
          </div>
        ) : (
          <footer className="muted small">Last {view?.shown.length ?? 0} messages · observed only: {s.agent === 'opencode' ? 'OpenCode sessions are read-only in ICE for now' : 'this session is running in a terminal; close it there to resume it from ICE'} · Esc closes</footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

function PendingPanel({ p, busy, onAnswer }: { p: HostedPending; busy: boolean; onAnswer: (r: { allow: boolean; answers?: Record<string, string>; message?: string }) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [note, setNote] = useState('')
  useEffect(() => { setPicked({}); setNote('') }, [p.requestId])
  if (p.questions) {
    const done = p.questions.every((q) => picked[q.question]?.length)
    const toggle = (q: NonNullable<HostedPending['questions']>[number], label: string) => setPicked((cur) => {
      const now = cur[q.question] ?? []
      return { ...cur, [q.question]: q.multiSelect ? (now.includes(label) ? now.filter((x) => x !== label) : [...now, label]) : [label] }
    })
    return (
      <div className="pending">
        <b>The agent is asking you</b>
        {p.questions.map((q) => (
          <div key={q.question} className="q">
            <p>{q.question}{q.multiSelect && <span className="muted small"> (choose several)</span>}</p>
            <div className="opts">{q.options.map((o) => (
              <button key={o.label} className={picked[q.question]?.includes(o.label) ? 'on' : ''} onClick={() => toggle(q, o.label)} title={o.description}>
                {o.label}{o.description && <small>{o.description}</small>}
              </button>))}</div>
          </div>
        ))}
        <div className="crow"><span className="spacer" />
          <button disabled={busy} onClick={() => onAnswer({ allow: false, message: 'The user declined to answer' })}>Skip</button>
          <button className="primary" disabled={busy || !done} onClick={() => onAnswer({ allow: true, answers: Object.fromEntries(Object.entries(picked).map(([k, v]) => [k, v.join(', ')])) })}>Submit answer</button>
        </div>
      </div>
    )
  }
  return (
    <div className="pending">
      <b>{p.title}</b>
      <div className="muted small">{p.tool}</div>
      <pre>{p.summary}</pre>
      <input className="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional: tell the agent why (used if you deny)" />
      <div className="crow"><span className="spacer" />
        <button disabled={busy} onClick={() => onAnswer({ allow: false, message: note })}>Deny</button>
        <button className="primary" disabled={busy} onClick={() => onAnswer({ allow: true })}>Allow</button>
      </div>
    </div>
  )
}

function CommandBox({ cmd, note }: { cmd: string; note: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => navigator.clipboard.writeText(cmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => undefined)
  return (
    <div className="cmdbox">
      <p className="muted small">{note}</p>
      <div className="crow"><code>{cmd}</code><button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
    </div>
  )
}

/** Session name with inline rename. The new name is written to the real session (Claude Code transcript / OpenCode). */
function Title({ s }: { s: SessionSummary }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(s.title)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const locked = s.agent === 'claude' && s.live && !s.hosted // a terminal session would write its old name back
  useEffect(() => { if (!editing) setVal(s.title) }, [s.title, editing])
  const save = async () => {
    const title = val.trim()
    if (!title || title === s.title) return setEditing(false)
    setBusy(true); setErr('')
    try { await post(`/api/sessions/${s.id}/rename`, { title }); setEditing(false) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  if (!editing) return (
    <h3 className="titlerow">{s.title}
      <button className="seg-btn editbtn" onClick={() => setEditing(true)} disabled={locked} aria-label="Rename session"
        title={locked ? 'Running in a terminal: rename it there with /rename' : 'Rename this session (also renames it in ' + (s.agent === 'claude' ? 'Claude Code' : 'OpenCode') + ')'}>✎</button>
    </h3>
  )
  return (
    <div className="renamebox">
      <input autoFocus value={val} maxLength={200} onChange={(e) => setVal(e.target.value)} disabled={busy}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.nativeEvent.isComposing) save(); else if (e.key === 'Escape') setEditing(false) }} />
      <button className="primary" onClick={save} disabled={busy || !val.trim()}>Save</button>
      <button onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
      {err && <div className="calert flow-failed">{err}</div>}
    </div>
  )
}

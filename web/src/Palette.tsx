import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionSummary } from '../../shared/types'
import { AGENT_LABEL, ago } from './format'
import { phaseOf } from './Session'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

type Item = { kind: 'project'; project: string; n: number; live: number } | { kind: 'session'; s: SessionSummary }

/** Cmd/Ctrl+K: find a session (title, name, project, branch) or a project and jump to its cell(s). */
export function Palette({ sessions, onPick, onClose }: { sessions: SessionSummary[]; onPick: (ids: string[]) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const list = useRef<HTMLUListElement>(null)

  const items = useMemo<Item[]>(() => {
    const tokens = norm(q).split(/\s+/).filter(Boolean)
    const hay = (s: SessionSummary) => norm(`${s.title} ${s.name ?? ''} ${s.project} ${s.branch ?? ''} ${AGENT_LABEL[s.agent]}`)
    const byProject = new Map<string, SessionSummary[]>()
    for (const s of sessions) byProject.set(s.project, [...(byProject.get(s.project) ?? []), s])
    const projects: Item[] = [...byProject.entries()]
      .filter(([p]) => tokens.every((t) => norm(p).includes(t)))
      .sort((a, b) => b[1].filter((s) => s.live).length - a[1].filter((s) => s.live).length || b[1].length - a[1].length)
      .map(([project, ss]) => ({ kind: 'project', project, n: ss.length, live: ss.filter((s) => s.live).length }))
    const matched: Item[] = sessions
      .filter((s) => tokens.every((t) => hay(s).includes(t)))
      .sort((a, b) => Number(b.live) - Number(a.live) || b.lastActivity - a.lastActivity)
      .map((s) => ({ kind: 'session', s }))
    return q.trim() ? [...projects.slice(0, 5), ...matched.slice(0, 40)] : [...projects.slice(0, 6), ...matched.slice(0, 10)]
  }, [q, sessions])

  useEffect(() => setAt(0), [q])
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [at])

  const pick = (it?: Item) => {
    if (!it) return
    onPick(it.kind === 'project' ? sessions.filter((s) => s.project === it.project).map((s) => s.id) : [it.s.id])
    onClose()
  }
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(items.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); pick(items[at]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return createPortal(
    <div className="scrim palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label="Search sessions and projects">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder="Search sessions or projects…  (title, project, branch)" spellCheck={false}
          role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={`pal-${at}`} />
        <ul id="palette-list" ref={list} role="listbox">
          {items.length === 0 && <li className="muted pal-empty">Nothing matches “{q}”.</li>}
          {items.map((it, i) => (
            <li key={it.kind === 'project' ? `p-${it.project}` : it.s.id} id={`pal-${i}`} role="option" aria-selected={i === at}
              className={i === at ? 'on' : ''} onMouseEnter={() => setAt(i)} onClick={() => pick(it)}>
              {it.kind === 'project' ? (
                <><span className="pal-kind">Project</span><b>{it.project}</b>
                  <span className="muted small">{it.n} session{it.n === 1 ? '' : 's'}{it.live ? ` · ${it.live} live` : ''}</span></>
              ) : (
                <><span className={`pill ${phaseOf(it.s).tone}`}>{phaseOf(it.s).label}</span>
                  <span className="pal-title">{it.s.title}</span>
                  <span className="muted small mono pal-meta">{it.s.project}{it.s.branch ? ` · ${it.s.branch}` : ''}</span>
                  <span className="muted small">{ago(it.s.lastActivity)}</span></>
              )}
            </li>
          ))}
        </ul>
        <footer className="muted small">↑ ↓ to move · Enter to jump · Esc to close · a project highlights all its sessions</footer>
      </div>
    </div>,
    document.body,
  )
}

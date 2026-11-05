import { useRef, useState } from 'react'
import type { SessionSummary } from '../../shared/types'
import { AGENT_LABEL, ago } from './format'
import { GoalChip, RemoteIcon, SessionPanel, phaseOf } from './Session'

export const PAGE_SIZES = [2, 4, 8, 16] as const
export type PageSize = (typeof PAGE_SIZES)[number]

// Cells visible per screen. Columns first so each cell keeps as much height as possible;
// 8 and 16 use two rows. The strip scrolls horizontally past the visible screen.
export const COLS: Record<PageSize, number> = { 2: 2, 4: 4, 8: 4, 16: 8 }
const ROWS: Record<PageSize, number> = { 2: 1, 4: 1, 8: 2, 16: 2 }

export function Cells({ rows, size, stripRef, onScroll, hl, onMove, onOpen }: {
  rows: (SessionSummary | null)[]; size: PageSize; stripRef: React.RefObject<HTMLDivElement | null>; onScroll: () => void; hl: ReadonlySet<string>
  onMove: (id: string, to: number) => void; onOpen: (id: string) => void
}) {
  const cols = COLS[size]
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const scroller = useRef(0)
  const stopScroll = () => { clearInterval(scroller.current); scroller.current = 0 }
  const end = () => { stopScroll(); setDrag(null); setOver(null) }
  // Scroll the strip while the pointer is near its left or right edge, so a cell can be carried to another screen.
  const edge = (x: number) => {
    const el = stripRef.current; if (!el) return
    const r = el.getBoundingClientRect(), zone = Math.min(90, r.width / 6)
    const dir = x < r.left + zone ? -1 : x > r.right - zone ? 1 : 0
    if (!dir) return stopScroll()
    if (!scroller.current) scroller.current = window.setInterval(() => { el.scrollLeft += dir * 28 }, 16)
  }
  const target = (i: number) => ({
    onDragOver: (e: React.DragEvent) => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(i); edge(e.clientX) },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); if (drag) onMove(drag, i); end() },
  })
  return (
    <div ref={stripRef} onScroll={onScroll} className={`cells n${size}`} style={{
      gridTemplateRows: `repeat(${ROWS[size]},minmax(0,1fr))`,
      gridAutoColumns: `calc((100% - ${(cols - 1) * 10}px) / ${cols})`,
    }}>
      {rows.map((s, i) => s
        ? <Cell key={s.id} s={s} dense={size >= 8} hl={hl.has(s.id)} onOpen={onOpen} dragging={drag === s.id} over={over === i && drag !== s.id} target={target(i)}
            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); setDrag(s.id) }} onDragEnd={end} />
        : <div key={`hole-${i}`} className={`cell hole ${drag && over === i ? 'over' : ''}`} aria-hidden="true" {...target(i)} />)}
    </div>
  )
}

function Cell({ s, dense, hl, onOpen, dragging, over, target, onDragStart, onDragEnd }: {
  s: SessionSummary; dense: boolean; hl: boolean; onOpen: (id: string) => void; dragging: boolean; over: boolean
  target: { onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void }
  onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void
}) {
  const ph = phaseOf(s)
  const [goalOpen, setGoalOpen] = useState(false) // the goal text only shows when the goal chip is pressed
  return (
    <article id={`s-${s.id}`} className={`cell t-${ph.tone} ${dense ? 'dense' : ''} ${hl ? 'hl' : ''} ${dragging ? 'dragging' : ''} ${over ? 'over' : ''}`} {...target}>
      <header className="clickable" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} tabIndex={0} role="button" aria-label={`Open session: ${s.title}`} title="Open the session conversation. Drag to move the cell."
        onClick={() => onOpen(s.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(s.id))}>
        <div className="r1">
          <span className={`pill ${ph.tone}`}>{ph.label}</span>
          <span className={`agent ${s.agent}`}>{AGENT_LABEL[s.agent]}</span>
          <GoalChip s={s} open={goalOpen} onToggle={() => setGoalOpen((v) => !v)} />
          <RemoteIcon s={s} />
          <span className="muted small spacer">{ago(s.lastActivity)}</span>
        </div>
        <h3 title={s.title}>{s.title}</h3>
        <div className="muted mono small ell">{s.project} · {s.branch ?? '—'}</div>
      </header>
      <div className="cbody">
        {s.goal && goalOpen && <p className="goalopen small"><b>Goal{s.goal.met ? ' (met)' : ''}:</b> {s.goal.condition}</p>}
        {s.alerts.map((a, i) => <div key={i} className={`calert ${a.kind}`}>{a.message}</div>)}
        <SessionPanel s={s} />
      </div>
    </article>
  )
}


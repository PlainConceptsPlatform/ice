import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { costOf } from '../pricing.ts'
import { branchAndPr } from '../github.ts'
import { alertsFor } from '../alerts.ts'
import { idle8h } from '../activity.ts'
import type { SessionDetail, SessionState, TimelinePoint } from '../../shared/types.ts'

// OpenCode keeps everything in a SQLite DB: <data>/opencode/opencode.db
const DB_PATH =
  process.env.ICE_OPENCODE_DB ??
  path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'opencode', 'opencode.db')

// OpenCode has no live-process registry, so "working" is inferred from recent writes.
const WORKING_MS = 60_000

let db: DatabaseSync | null = null
function open(): DatabaseSync | null {
  if (db) return db
  if (!fs.existsSync(DB_PATH)) return null
  db = new DatabaseSync(DB_PATH, { readOnly: true }) // never write to the user's OpenCode data
  return db
}

interface SessionRow { id: string; directory: string; title: string; time_created: number; time_updated: number; parent_id: string | null }
interface MsgRow { session_id: string; time_created: number; data: string }

async function build(s: SessionRow, msgs: MsgRow[], errors = 0, compactions = 0): Promise<SessionDetail> {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const models: Record<string, number> = {}
  const timeline: TimelinePoint[] = []
  const intervals: [number, number][] = []
  let cost = 0, costKnown = false, turns = 0, lastRole = ''
  for (const m of msgs) {
    let d: any
    try { d = JSON.parse(m.data) } catch { continue }
    lastRole = d.role
    if (d.role === 'user') { turns++; continue }
    if (d.role !== 'assistant') continue
    if (d.time?.created) intervals.push([d.time.created, d.time.completed ?? d.time.created])
    const t = d.tokens ?? {}
    const u = {
      input_tokens: t.input ?? 0, output_tokens: (t.output ?? 0) + (t.reasoning ?? 0),
      cache_read_input_tokens: t.cache?.read ?? 0, cache_creation_input_tokens: t.cache?.write ?? 0,
    }
    tokens.input += u.input_tokens; tokens.output += u.output_tokens
    tokens.cacheRead += u.cache_read_input_tokens; tokens.cacheWrite += u.cache_creation_input_tokens
    // Prefer the cost OpenCode reports; otherwise estimate if we have a price for the model.
    let c = Number(d.cost) || 0
    if (!c) c = costOf(String(d.modelID ?? ''), u)
    if (c > 0) costKnown = true
    cost += c
    const model = `${d.modelID ?? 'unknown'}`
    models[model] = (models[model] ?? 0) + c
    timeline.push({ t: m.time_created, cost })
  }
  const live = Date.now() - s.time_updated < WORKING_MS
  const state: SessionState = live ? 'working' : 'finished'
  if (live) intervals.push([s.time_updated, Date.now()])
  const { branch, prs } = await branchAndPr(s.directory)
  const base = {
    id: s.id, agent: 'opencode' as const, title: s.title || '(untitled)', project: path.basename(s.directory),
    cwd: s.directory, branch, live, state, startedAt: s.time_created, lastActivity: s.time_updated,
    turns, compactions, errors, cost, costKnown, tokens, models, prs,
    idle8h: idle8h(intervals, s.time_created, live ? Date.now() : s.time_updated),
    lastPrompt: undefined as string | undefined,
  }
  void lastRole
  return { ...base, alerts: alertsFor(base), timeline, events: [] }
}

export async function opencodeSessions(windowDays: number): Promise<SessionDetail[]> {
  const d = open()
  if (!d) return []
  const cutoff = Date.now() - windowDays * 864e5
  // Sub-agent sessions have a parent_id; skip them so each task shows once.
  const sessions = d.prepare(
    'SELECT id, directory, title, time_created, time_updated, parent_id FROM session WHERE time_updated >= ? AND parent_id IS NULL AND time_archived IS NULL',
  ).all(cutoff) as unknown as SessionRow[]
  if (!sessions.length) return []
  const msgs = d.prepare(
    'SELECT session_id, time_created, data FROM message WHERE session_id IN (SELECT id FROM session WHERE time_updated >= ? AND parent_id IS NULL) ORDER BY time_created',
  ).all(cutoff) as unknown as MsgRow[]
  const by = new Map<string, MsgRow[]>()
  for (const m of msgs) (by.get(m.session_id) ?? by.set(m.session_id, []).get(m.session_id)!).push(m)
  const count = (type: string, extra = '') => {
    const m = new Map<string, number>()
    const rows = d.prepare(
      `SELECT session_id, COUNT(*) n FROM part WHERE json_extract(data,'$.type') = ? ${extra}
       AND session_id IN (SELECT id FROM session WHERE time_updated >= ? AND parent_id IS NULL) GROUP BY session_id`,
    ).all(type, cutoff) as unknown as { session_id: string; n: number }[]
    for (const r of rows) m.set(r.session_id, r.n)
    return m
  }
  const errs = count('tool', "AND json_extract(data,'$.state.status') = 'error'")
  const comps = count('compaction')
  return Promise.all(sessions.map((s) => build(s, by.get(s.id) ?? [], errs.get(s.id) ?? 0, comps.get(s.id) ?? 0)))
}

export async function opencodeDetail(id: string): Promise<SessionDetail | null> {
  const d = open()
  if (!d) return null
  const s = d.prepare('SELECT id, directory, title, time_created, time_updated, parent_id FROM session WHERE id = ?').get(id) as unknown as SessionRow | undefined
  if (!s) return null
  const msgs = d.prepare('SELECT session_id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created').all(id) as unknown as MsgRow[]
  const n = (type: string, extra = '') => (d.prepare(
    `SELECT COUNT(*) n FROM part WHERE session_id = ? AND json_extract(data,'$.type') = ? ${extra}`,
  ).get(id, type) as unknown as { n: number }).n
  const detail = await build(s, msgs, n('tool', "AND json_extract(data,'$.state.status') = 'error'"), n('compaction'))
  const prompts = d.prepare(
    `SELECT p.time_created t, json_extract(p.data,'$.text') text FROM part p JOIN message m ON m.id = p.message_id
     WHERE p.session_id = ? AND json_extract(m.data,'$.role') = 'user' AND json_extract(p.data,'$.type') = 'text'
     ORDER BY p.time_created DESC LIMIT 12`,
  ).all(id) as unknown as { t: number; text: string }[]
  detail.events = prompts.reverse().map((p) => ({ t: p.t, kind: 'prompt', text: String(p.text).slice(0, 240) }))
  return detail
}

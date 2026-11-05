import fs from 'node:fs'
import readline from 'node:readline'
import path from 'node:path'
import { costOf, type Usage } from '../pricing.ts'
import { cleanUserText } from './user-text.ts'
import type { SessionDetail, TimelinePoint } from '../../shared/types.ts'

type Parsed = Omit<SessionDetail, 'agent' | 'costKnown' | 'errors' | 'idle8h' | 'flow' | 'live' | 'pid' | 'state' | 'alerts' | 'name' | 'prs'> & {
  prs: { number: number; repo: string; url: string }[]
  lastStopReason?: string
  errors: number
  intervals: [number, number][] // agent-working intervals (from turn_duration events)
}

const cache = new Map<string, { mtime: number; size: number; data: Parsed }>()

export async function parseSession(file: string): Promise<Parsed | null> {
  const st = fs.statSync(file)
  const hit = cache.get(file)
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.data

  const id = path.basename(file, '.jsonl')
  const msgs = new Map<string, { model: string; usage: Usage; t: number; stop?: string }>()
  const events: Parsed['events'] = []
  const prs = new Map<string, { number: number; repo: string; url: string }>()
  let aiTitle = '', userTitle = '', cwd = '', branch: string | undefined, lastPrompt: string | undefined
  let startedAt = 0, lastActivity = 0, turns = 0, compactions = 0, errors = 0
  const intervals: [number, number][] = []
  let goal: Parsed['goal']

  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) {
    // Shortcut: skip parsing the huge api-request* blobs.
    if (line.startsWith('{"type":"api-request')) continue
    let d: any
    try { d = JSON.parse(line) } catch { continue }
    const t = d.timestamp ? Date.parse(d.timestamp) : 0
    if (t) { startedAt ||= t; lastActivity = Math.max(lastActivity, t) }
    if (d.cwd) cwd = d.cwd
    if (d.gitBranch) branch = d.gitBranch

    if (d.type === 'attachment' && d.attachment?.type === 'goal_status') goal = { condition: String(d.attachment.condition ?? ''), met: !!d.attachment.met }
    else if (d.type === 'user' && line.includes('Goal cleared')) goal = undefined

    switch (d.type) {
      case 'ai-title': aiTitle = d.aiTitle; break
      // /rename writes both; whichever comes last is the current user-chosen name and beats the generated title.
      case 'custom-title': if (d.customTitle) userTitle = d.customTitle; break
      case 'agent-name': if (d.agentName) userTitle = d.agentName; break
      case 'last-prompt': { const u = cleanUserText(String(d.lastPrompt ?? '')); lastPrompt = u.kind === 'skip' || u.kind === 'output' ? lastPrompt : u.text; break }
      case 'pr-link': prs.set(d.prUrl, { number: d.prNumber, repo: d.prRepository, url: d.prUrl }); break
      case 'user': {
        if (d.isSidechain || d.message?.role !== 'user') break
        const c = d.message.content
        if (Array.isArray(c)) for (const b of c) if (b?.type === 'tool_result' && b.is_error) errors++
        const text = typeof c === 'string' ? c : c?.find?.((b: any) => b.type === 'text')?.text
        if (typeof c === 'string' || text) turns++
        const u = text ? cleanUserText(String(text)) : null
        if (u && (u.kind === 'text' || u.kind === 'command') && events.length < 400) events.push({ t, kind: 'prompt', text: u.text.slice(0, 240) })
        break
      }
      case 'system':
        if (d.subtype === 'turn_duration' && d.durationMs > 0) intervals.push([t - d.durationMs, t])
        if (d.subtype === 'api_error') errors++
        if (d.subtype === 'compact_boundary') {
          compactions++
          events.push({ t, kind: 'compact', text: 'Context compacted' })
        }
        break
      case 'assistant': {
        const m = d.message
        if (d.isApiErrorMessage) errors++
        if (!m?.usage || !m.model || m.model === '<synthetic>') break
        const key = m.id ?? d.uuid
        const prev = msgs.get(key)
        // Blocks of the same message share usage: keep the last/largest.
        if (!prev || (m.usage.output_tokens ?? 0) >= (prev.usage.output_tokens ?? 0))
          msgs.set(key, { model: m.model, usage: m.usage, t, stop: m.stop_reason })
        break
      }
    }
  }
  if (!startedAt) return null

  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const models: Record<string, number> = {}
  const timeline: TimelinePoint[] = []
  let cost = 0, lastStopReason: string | undefined
  for (const m of [...msgs.values()].sort((a, b) => a.t - b.t)) {
    const c = costOf(m.model, m.usage)
    cost += c
    models[m.model] = (models[m.model] ?? 0) + c
    tokens.input += m.usage.input_tokens ?? 0
    tokens.output += m.usage.output_tokens ?? 0
    tokens.cacheRead += m.usage.cache_read_input_tokens ?? 0
    tokens.cacheWrite += m.usage.cache_creation_input_tokens ?? 0
    timeline.push({ t: m.t, cost })
    lastStopReason = m.stop
  }

  const data: Parsed = {
    id, title: userTitle || aiTitle || lastPrompt?.slice(0, 80) || '(untitled)', project: path.basename(cwd || 'unknown'),
    cwd, branch, startedAt, lastActivity, turns, compactions, errors, intervals, cost, tokens, models,
    prs: [...prs.values()], goal, lastPrompt, lastStopReason, timeline: downsample(timeline, 120), events,
  }
  cache.set(file, { mtime: st.mtimeMs, size: st.size, data })
  return data
}

function downsample<T>(a: T[], n: number): T[] {
  if (a.length <= n) return a
  const step = a.length / n
  return Array.from({ length: n }, (_, i) => a[Math.min(a.length - 1, Math.floor(i * step))]).concat(a[a.length - 1])
}

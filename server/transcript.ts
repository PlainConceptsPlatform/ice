import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { TranscriptItem } from '../shared/types.ts'
import { cleanUserText } from './sources/user-text.ts'

const CLAUDE = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')
const OC_DB = process.env.ICE_OPENCODE_DB ?? path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'opencode', 'opencode.db')
const TAIL_BYTES = 3_000_000 // transcripts reach hundreds of MB: only the tail matters
const MAX_ITEMS = 40
const clip = (s: unknown, n = 4000) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + '…' : t }

/** One line summary of a tool call; AskUserQuestion is spelled out because that is what the user must answer. */
function toolText(name: string, input: any): string {
  if (name === 'AskUserQuestion' && Array.isArray(input?.questions))
    return input.questions.map((q: any) => `${q.question}\n${(q.options ?? []).map((o: any) => `  • ${o.label}${o.description ? ` — ${o.description}` : ''}`).join('\n')}`).join('\n\n')
  if (name === 'ExitPlanMode' && input?.plan) return clip(input.plan)
  const main = input?.command ?? input?.file_path ?? input?.path ?? input?.pattern ?? input?.url ?? input?.description ?? input?.prompt
  return main ? clip(main, 600) : clip(JSON.stringify(input ?? {}), 300)
}

function claudeFile(id: string): string | null {
  const root = path.join(CLAUDE, 'projects')
  if (!fs.existsSync(root)) return null
  for (const p of fs.readdirSync(root)) {
    const f = path.join(root, p, `${id}.jsonl`)
    if (fs.existsSync(f)) return f
  }
  return null
}

function claudeTranscript(file: string): TranscriptItem[] {
  const st = fs.statSync(file)
  const start = Math.max(0, st.size - TAIL_BYTES)
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(st.size - start)
  fs.readSync(fd, buf, 0, buf.length, start); fs.closeSync(fd)
  let lines = buf.toString('utf8').split('\n')
  if (start > 0) lines = lines.slice(1) // first line is cut in half
  const items: TranscriptItem[] = []
  for (const line of lines) {
    if (!line || line.startsWith('{"type":"api-request')) continue
    let d: any
    try { d = JSON.parse(line) } catch { continue }
    if (d.isSidechain) continue
    const t = d.timestamp ? Date.parse(d.timestamp) : 0
    const c = d.message?.content
    if (d.type === 'user' && d.message?.role === 'user') {
      const userText = (raw: string) => { // slash commands and their output are recorded as pseudo-XML
        const u = cleanUserText(raw)
        if (u.kind === 'skip') return
        items.push({ t, role: u.kind === 'output' ? 'result' : 'user', text: clip(u.text) })
      }
      if (typeof c === 'string') userText(c)
      else if (Array.isArray(c)) for (const b of c) {
        if (b.type === 'text') userText(String(b.text ?? ''))
        else if (b.type === 'image') items.push({ t, role: 'user', text: `🖼 Image attached${b.source?.media_type ? ` (${String(b.source.media_type).replace('image/', '')})` : ''}` })
        else if (b.type === 'tool_result') {
          const out = typeof b.content === 'string' ? b.content : (b.content ?? []).map((x: any) => x.text ?? '').join('\n')
          items.push({ t, role: 'result', text: clip(out, 600), isError: !!b.is_error })
        }
      }
    } else if (d.type === 'assistant' && Array.isArray(c)) {
      for (const b of c) {
        if (b.type === 'text' && b.text?.trim()) items.push({ t, role: 'assistant', text: clip(b.text) })
        else if (b.type === 'tool_use') items.push({ t, role: 'tool', tool: b.name, text: toolText(b.name, b.input) })
      }
    }
  }
  return items.slice(-MAX_ITEMS)
}

function opencodeTranscript(id: string): TranscriptItem[] {
  if (!fs.existsSync(OC_DB)) return []
  const db = new DatabaseSync(OC_DB, { readOnly: true })
  try {
    const rows = db.prepare(`SELECT p.time_created t, p.data pd, m.data md FROM part p JOIN message m ON m.id = p.message_id
      WHERE p.session_id = ? ORDER BY p.time_created DESC, p.id DESC LIMIT 120`).all(id) as unknown as { t: number; pd: string; md: string }[]
    const items: TranscriptItem[] = []
    for (const r of rows.reverse()) {
      let p: any, m: any
      try { p = JSON.parse(r.pd); m = JSON.parse(r.md) } catch { continue }
      if (p.type === 'text' && p.text?.trim()) items.push({ t: r.t, role: m.role === 'user' ? 'user' : 'assistant', text: clip(p.text) })
      else if (p.type === 'file' && String(p.mime ?? '').startsWith('image/')) items.push({ t: r.t, role: m.role === 'user' ? 'user' : 'assistant', text: `🖼 Image attached${p.filename ? ` (${clip(p.filename, 80)})` : ''}` })
      else if (p.type === 'tool') items.push({ t: r.t, role: 'tool', tool: p.tool, text: toolText(p.tool, p.state?.input), isError: p.state?.status === 'error' })
    }
    return items.slice(-MAX_ITEMS)
  } finally { db.close() }
}

export function transcript(id: string): TranscriptItem[] | null {
  const f = claudeFile(id)
  if (f) return claudeTranscript(f)
  if (id.startsWith('ses_')) return opencodeTranscript(id)
  return null
}

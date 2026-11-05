/**
 * OpenCode sessions started or driven from ICE. Runs inside the host daemon.
 * ICE starts its own `opencode serve` (loopback, random port, random password kept only in memory) and talks to its
 * documented REST API: create/resume a session, send a prompt, abort, answer permission requests, rename. It shares
 * OpenCode's database with your other OpenCode processes but never writes to it directly.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import type { HostedPending, SlashCommandInfo } from '../shared/types.ts'
import { checkMessage, opencodeParts } from './attachments.ts'
import type { Msg } from './host.ts'

type State = { busy: boolean; pending?: HostedPending; error?: string }
interface Tracked { id: string; dir: string; autoAllow: boolean; busy: boolean; pending?: HostedPending; error?: string }
const tracked = new Map<string, Tracked>()
type Srv = { url: string; auth: string; child: ChildProcess }
let server: Srv | null = null
let starting: Promise<Srv> | null = null

export const isOpenCodeId = (id: string) => id.startsWith('ses_')
export const openCodeCount = () => tracked.size
export const openCodeStates = (): Record<string, State> =>
  Object.fromEntries([...tracked.values()].map((t) => [t.id, { busy: t.busy, pending: t.pending, error: t.error }]))

function binary(): string {
  if (process.env.ICE_OPENCODE_BIN) return process.env.ICE_OPENCODE_BIN
  const home = path.join(os.homedir(), '.opencode', 'bin', 'opencode')
  return fs.existsSync(home) ? home : 'opencode'
}
const freePort = () => new Promise<number>((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject)
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)) })
})

const dbg = (...a: unknown[]) => { if (process.env.ICE_DEBUG) console.error('[opencode-host]', ...a) }

/** One attempt to boot `opencode serve`; null if it never became healthy (it sometimes hangs on a cold start). */
async function bootServer(): Promise<Srv | null> {
  const port = await freePort(); dbg('spawning opencode serve on', port)
  const password = crypto.randomBytes(24).toString('hex')
  const child = spawn(binary(), ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
    env: { ...process.env, OPENCODE_SERVER_PASSWORD: password }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout?.on('data', (c) => { log += c }); child.stderr?.on('data', (c) => { log += c })
  const s: Srv = { url: `http://127.0.0.1:${port}`, auth: 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64'), child }
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250))
    if (child.exitCode !== null) throw new Error(`opencode serve exited: ${log.slice(-300)}`)
    try {
      const r = await fetch(`${s.url}/global/health`, { headers: { authorization: s.auth }, signal: AbortSignal.timeout(2000) })
      if (r.ok) return s
    } catch { /* not up yet */ }
  }
  dbg('server did not become healthy, killing it'); child.kill()
  return null
}

async function ensureServer(): Promise<Srv> {
  if (server && server.child.exitCode === null) return server
  starting ??= (async (): Promise<Srv> => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const s = await bootServer()
      if (s) {
        dbg('server healthy'); server = s
        s.child.on('exit', () => { if (server === s) server = null })
        void eventLoop(s); return s
      }
    }
    throw new Error('opencode serve did not start after 3 attempts. Is `opencode` installed (set ICE_OPENCODE_BIN)?')
  })().finally(() => { starting = null })
  return starting
}

async function api<T = any>(method: string, p: string, dir: string, body?: unknown, timeoutMs = 60_000): Promise<T> {
  const s = await ensureServer()
  const url = `${s.url}${p}${p.includes('?') ? '&' : '?'}directory=${encodeURIComponent(dir)}`
  dbg(method, p)
  const r = await fetch(url, { method, headers: { authorization: s.auth, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
  const text = await r.text(); dbg(method, p, '→', r.status)
  if (!r.ok) throw new Error(`OpenCode ${method} ${p} → ${r.status} ${text.slice(0, 200)}`)
  try { return (text ? JSON.parse(text) : undefined) as T } catch { return undefined as T }
}

/** Follows the server's global event stream and keeps busy/pending state of the sessions ICE tracks. */
async function eventLoop(s: Srv) {
  while (server === s) {
    try {
      const r = await fetch(`${s.url}/global/event`, { headers: { authorization: s.auth } })
      if (!r.body) throw new Error('no body')
      const dec = new TextDecoder(); let buf = ''
      for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
        buf += dec.decode(chunk, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
          if (!line.startsWith('data:')) continue
          try { onEvent(JSON.parse(line.slice(5)).payload) } catch { /* ignore a bad frame */ }
        }
      }
    } catch { /* reconnect */ }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

function onEvent(e: any) {
  const p = e?.properties ?? {}
  const t = tracked.get(p.sessionID ?? p.info?.id)
  if (!t) return
  switch (e.type) {
    case 'session.status': t.busy = p.status?.type !== 'idle'; break
    case 'session.idle': t.busy = false; break
    case 'session.error': t.error = String(p.error?.data?.message ?? p.error?.name ?? 'session error'); t.busy = false; break
    case 'permission.updated': case 'permission.asked': {
      const requestId = String(p.id ?? p.requestID)
      if (t.autoAllow) { void reply(t, requestId, true); break }
      t.pending = {
        requestId, tool: String(p.type ?? p.permission ?? 'permission'), title: String(p.title ?? `Allow ${p.permission ?? p.type ?? 'this action'}?`),
        summary: String(Array.isArray(p.pattern) ? p.pattern.join('\n') : p.pattern ?? (p.patterns ?? []).join?.('\n') ?? JSON.stringify(p.metadata ?? {})).slice(0, 1500),
      }
      break
    }
    case 'permission.replied': t.pending = undefined; break
  }
}

async function reply(t: Tracked, requestId: string, allow: boolean) {
  try { await api('POST', `/session/${t.id}/permissions/${requestId}`, t.dir, { response: allow ? 'once' : 'reject' }) }
  catch (e) { t.error = String((e as Error).message) }
}

function lastModel(): { providerID: string; modelID: string } | undefined {
  try {
    const f = path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state'), 'opencode', 'model.json')
    const m = JSON.parse(fs.readFileSync(f, 'utf8')).recent?.[0]
    return m?.providerID && m?.modelID ? { providerID: m.providerID, modelID: m.modelID } : undefined
  } catch { return undefined }
}

const checkDir = (cwd: string) => { if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('cwd is not a directory') }

async function prompt(t: Tracked, m: Msg) {
  checkMessage(m.text, m.images ?? [])
  t.busy = true; t.error = undefined
  const model = lastModel()
  try { await api('POST', `/session/${t.id}/prompt_async`, t.dir, { ...(model ? { model } : {}), parts: opencodeParts(m.text, m.images) }) }
  catch (e) { t.busy = false; throw e }
}

/** Commands, skills and MCP prompts OpenCode offers in a directory. */
export const isHostedOpenCode = (id: string) => tracked.has(id)
export const commandsOpenCode = (id: string) => commandsInDir(get(id).dir)
export async function commandsInDir(dir: string): Promise<SlashCommandInfo[]> {
  checkDir(dir)
  const list = await api<{ name: string; description?: string; hints?: string[] }[]>('GET', '/command', dir)
  return list.map((c) => ({ name: c.name, description: c.description ?? '', hint: c.hints?.length ? c.hints.join(' ') : undefined }))
}

/** `/name args` → run it as an OpenCode command (a plain prompt "/name" would not be interpreted). Returns false if it is not a known command. */
async function runIfCommand(t: Tracked, m: Msg): Promise<boolean> {
  const hit = m.text.trim().match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
  if (!hit) return false
  if (!(await commandsOpenCode(t.id).catch(() => [])).some((c) => c.name === hit[1])) return false
  t.busy = true; t.error = undefined
  const parts = opencodeParts('', m.images)
  // The command call returns only when the turn is over: do not wait for it, report a failure through the session state.
  void api('POST', `/session/${t.id}/command`, t.dir, { command: hit[1], arguments: hit[2] ?? '', ...(parts.length ? { parts } : {}) }, 30 * 60_000)
    .catch((e) => { t.error = String((e as Error).message); t.busy = false })
  return true
}

export async function startOpenCode(cwd: string, text: Msg, o: { autoAllow?: boolean } = {}): Promise<string> {
  checkDir(cwd); checkMessage(text.text, text.images ?? [])
  const s = await api<{ id: string }>('POST', '/session', cwd, {})
  const t: Tracked = { id: s.id, dir: cwd, autoAllow: !!o.autoAllow, busy: true }
  tracked.set(t.id, t)
  await prompt(t, text)
  return t.id
}
export async function resumeOpenCode(id: string, cwd: string, text: Msg, o: { autoAllow?: boolean } = {}): Promise<string> {
  checkDir(cwd); checkMessage(text.text, text.images ?? [])
  if (tracked.has(id)) throw new Error('this session is already running in ICE')
  const t: Tracked = { id, dir: cwd, autoAllow: !!o.autoAllow, busy: true }
  tracked.set(id, t)
  try { await prompt(t, text) } catch (e) { tracked.delete(id); throw e }
  return id
}
const get = (id: string) => { const t = tracked.get(id); if (!t) throw new Error('not a session hosted by ICE'); return t }
export async function sendOpenCode(id: string, m: Msg) {
  const t = get(id)
  checkMessage(m.text, m.images ?? [])
  if (await runIfCommand(t, m)) return
  await prompt(t, m)
}
export async function respondOpenCode(id: string, requestId: string, allow: boolean) {
  const t = get(id)
  if (!t.pending || t.pending.requestId !== requestId) throw new Error('that request is no longer pending')
  t.pending = undefined
  await reply(t, requestId, allow)
}
export async function interruptOpenCode(id: string) { const t = get(id); await api('POST', `/session/${id}/abort`, t.dir); t.busy = false }
export async function stopOpenCode(id: string) { const t = get(id); try { await api('POST', `/session/${id}/abort`, t.dir) } catch { /* already idle */ } tracked.delete(id) }
export async function renameOpenCode(id: string, cwd: string, title: string) {
  checkDir(cwd); if (!title.trim()) throw new Error('empty title')
  await api('PATCH', `/session/${id}`, cwd, { title: title.trim() })
}
export function shutdownOpenCode() { server?.child.kill() }

import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import type { HostedPending, ImageInput, SlashCommandInfo } from '../shared/types.ts'
import { HOSTD_PROTOCOL, LOG_PATH, SOCKET_PATH, STATE_DIR } from './hostd-paths.ts'

type State = { busy: boolean; pending?: HostedPending; error?: string }
let cache: Record<string, State> = {}

export function call<T = any>(method: 'GET' | 'POST', p: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET_PATH, path: p, method, headers: { 'content-type': 'application/json' }, timeout: timeoutMs }, (res) => {
      let s = ''; res.on('data', (c) => { s += c })
      res.on('end', () => {
        let j: any; try { j = s ? JSON.parse(s) : {} } catch { return reject(new Error('bad answer from the host daemon')) }
        res.statusCode && res.statusCode >= 400 ? reject(new Error(j.error ?? `host daemon error ${res.statusCode}`)) : resolve(j)
      })
    })
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('host daemon timed out')))
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}

/** Refresh the cached state of every hosted session. Cheap; a missing daemon just means "no hosted sessions". */
export async function refreshHosted(): Promise<void> {
  try {
    const s = await call<{ protocol: number; sessions: Record<string, State> }>('GET', '/state')
    cache = s.protocol === HOSTD_PROTOCOL ? s.sessions : {}
  } catch { cache = {} }
}
export const hostedState = (id: string): State | undefined => cache[id]

async function alive(): Promise<boolean> {
  try { const s = await call<{ protocol: number }>('GET', '/state'); if (s.protocol !== HOSTD_PROTOCOL) throw new Error('The ICE host daemon is from an older version. Run `npm run hostd:stop` (running sessions will end) and try again.'); return true }
  catch (e) { if (String((e as Error).message).includes('older version')) throw e; return false }
}

/** Start the daemon detached from this process (own session, no stdio) if it is not running. */
async function ensureDaemon(): Promise<void> {
  if (await alive()) return
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  const log = fs.openSync(LOG_PATH, 'a')
  const root = path.resolve(import.meta.dirname, '..')
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'server/hostd.ts')], { cwd: root, detached: true, stdio: ['ignore', log, log] })
  child.unref()
  for (let i = 0; i < 50; i++) { await new Promise((r) => setTimeout(r, 200)); if (await alive()) return }
  throw new Error(`The ICE host daemon did not start. See ${LOG_PATH}`)
}

async function act<T = any>(p: string, body: unknown): Promise<T> {
  await ensureDaemon()
  // Starting an OpenCode session may first boot ICE's own OpenCode server and load its plugins: allow it time.
  const r = await call<T>('POST', p, body, p === '/start' || p === '/resume' || p === '/rename' || p === '/commands' ? 120_000 : 30_000)
  await refreshHosted()
  return r
}

export const startSession = (cwd: string, prompt: string, model?: string, o: { chrome?: boolean; autoAllow?: boolean; agent?: 'claude' | 'opencode'; images?: ImageInput[] } = {}) => act<{ id: string }>('/start', { cwd, prompt, model, ...o }).then((r) => r.id)
export const resumeSession = (id: string, cwd: string, prompt: string, o: { chrome?: boolean; autoAllow?: boolean; images?: ImageInput[] } = {}) => act('/resume', { id, cwd, prompt, ...o })
export const send = (id: string, text: string, images: ImageInput[] = []) => act('/message', { id, text, images })
export const commands = (o: { id?: string; agent: 'claude' | 'opencode'; cwd: string }) => act<{ commands: SlashCommandInfo[] }>('/commands', o).then((r) => r.commands)
export const respond = (id: string, requestId: string, r: { allow: boolean; answers?: Record<string, string>; message?: string }) => act('/respond', { id, requestId, ...r })
export const interrupt = (id: string) => act('/interrupt', { id })
export const stop = (id: string) => act('/stop', { id })
export const renameOpenCode = (id: string, cwd: string, title: string) => act('/rename', { id, cwd, title })

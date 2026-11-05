/**
 * ICE session host daemon. A separate, long-lived process that owns the Claude Code sessions started from ICE,
 * so restarting (or crashing, or `tsx watch`-reloading) the ICE web server does not end them.
 * It listens only on a unix socket (owner-only permissions), never on the network.
 * Stop it with `npm run hostd:stop`. It also exits by itself after 30 idle minutes with no sessions.
 */
import fs from 'node:fs'
import http from 'node:http'
import { allStates, commands, commandsInDir, hostedCount, isHosted, interrupt, respond, resumeSession, send, startSession, stop } from './host.ts'
import { commandsInDir as commandsInDirOpenCode, commandsOpenCode, isHostedOpenCode, isOpenCodeId, interruptOpenCode, openCodeCount, openCodeStates, renameOpenCode, respondOpenCode, resumeOpenCode, sendOpenCode, shutdownOpenCode, startOpenCode, stopOpenCode } from './opencode-host.ts'
import { parseImages } from './attachments.ts'
import { HOSTD_PROTOCOL, SOCKET_PATH, STATE_DIR } from './hostd-paths.ts'

fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
fs.chmodSync(STATE_DIR, 0o700) // the directory may predate the daemon (purge state lives here too)
try { fs.unlinkSync(SOCKET_PATH) } catch { /* no stale socket */ }

let idleSince = Date.now()
setInterval(() => {
  if (hostedCount() + openCodeCount() > 0) idleSince = Date.now()
  else if (Date.now() - idleSince > 30 * 60_000) { console.log('idle for 30 min, exiting'); process.exit(0) }
}, 60_000).unref()

const body = (req: http.IncomingMessage): Promise<any> => new Promise((resolve, reject) => {
  let s = ''; req.on('data', (c) => { s += c }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}) } catch { reject(new Error('invalid JSON')) } })
})
/** Text plus validated images of a request (the web server validates too; the daemon does not trust its caller blindly). */
const msg = (b: any, key: 'prompt' | 'text') => ({ text: String(b[key] ?? ''), images: parseImages(b.images) })
const out = (res: http.ServerResponse, code: number, b: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)) }

const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://hostd').pathname
    if (req.method === 'GET' && path === '/state') return out(res, 200, { protocol: HOSTD_PROTOCOL, sessions: { ...allStates(), ...openCodeStates() } })
    if (req.method !== 'POST') return out(res, 404, { error: 'not found' })
    const b = await body(req)
    const oc = isOpenCodeId(String(b.id ?? ''))
    switch (path) {
      case '/start':
        if (b.agent === 'opencode') return out(res, 200, { id: await startOpenCode(String(b.cwd ?? ''), msg(b, 'prompt'), { autoAllow: !!b.autoAllow }) })
        return out(res, 200, { id: startSession(String(b.cwd ?? ''), msg(b, 'prompt'), b.model ? String(b.model) : undefined, { chrome: !!b.chrome, autoAllow: !!b.autoAllow }) })
      case '/resume':
        if (oc) return out(res, 200, { id: await resumeOpenCode(String(b.id), String(b.cwd ?? ''), msg(b, 'prompt'), { autoAllow: !!b.autoAllow }) })
        return out(res, 200, { id: resumeSession(String(b.id), String(b.cwd ?? ''), msg(b, 'prompt'), { chrome: !!b.chrome, autoAllow: !!b.autoAllow }) })
      case '/commands': { // by session when ICE hosts it (live list), otherwise by directory
        const id = String(b.id ?? ''), cwd = String(b.cwd ?? ''), openCode = b.agent === 'opencode'
        if (id && isHostedOpenCode(id)) return out(res, 200, { commands: await commandsOpenCode(id) })
        if (id && isHosted(id)) return out(res, 200, { commands: await commands(id) })
        return out(res, 200, { commands: openCode ? await commandsInDirOpenCode(cwd) : await commandsInDir(cwd) })
      }
      case '/message': if (oc) await sendOpenCode(String(b.id), msg(b, 'text')); else send(String(b.id), msg(b, 'text')); return out(res, 200, { ok: true })
      case '/respond':
        if (oc) await respondOpenCode(String(b.id), String(b.requestId ?? ''), !!b.allow)
        else respond(String(b.id), String(b.requestId ?? ''), { allow: !!b.allow, answers: b.answers, message: b.message })
        return out(res, 200, { ok: true })
      case '/interrupt': if (oc) await interruptOpenCode(String(b.id)); else await interrupt(String(b.id)); return out(res, 200, { ok: true })
      case '/stop': if (oc) await stopOpenCode(String(b.id)); else stop(String(b.id)); return out(res, 200, { ok: true })
      case '/rename': await renameOpenCode(String(b.id), String(b.cwd ?? ''), String(b.title ?? '')); return out(res, 200, { ok: true })
      case '/shutdown': out(res, 200, { ok: true }); setTimeout(() => { shutdownOpenCode(); try { fs.unlinkSync(SOCKET_PATH) } catch { /* gone */ } process.exit(0) }, 100); return
      default: return out(res, 404, { error: 'not found' })
    }
  } catch (e) { out(res, 400, { error: String((e as Error).message ?? e) }) }
})
server.listen(SOCKET_PATH, () => { fs.chmodSync(SOCKET_PATH, 0o600); console.log(`ICE host daemon (pid ${process.pid}) on ${SOCKET_PATH}`) })

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { shutdownOpenCode(); try { fs.unlinkSync(SOCKET_PATH) } catch { /* already gone */ } process.exit(0) })
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e))

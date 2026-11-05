import http from 'node:http'
import { isAllowedPost, isLoopbackHost } from './security.ts'
import { DEMO, demoTranscript } from './demo.ts'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { overview, detail, purgeFinished } from './sessions.ts'
import { restoreAll } from './purge.ts'
import { transcript } from './transcript.ts'
import { openIssues } from './issues.ts'
import { renameSession } from '@anthropic-ai/claude-agent-sdk'
import { parseImages } from './attachments.ts'
import { commands, hostedState, refreshHosted, renameOpenCode, interrupt, respond, resumeSession, send, startSession, stop } from './hostclient.ts'
import { githubStatus } from './github.ts'

const PORT = Number(process.env.ICE_PORT ?? 4317)
const HOST = '127.0.0.1' // local only: the .jsonl files contain everything you see in your sessions
const DIST = path.resolve(import.meta.dirname, '../dist')
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }

const clients = new Set<http.ServerResponse>()
let last = ''

async function tick() {
  if (!clients.size) return
  try {
    const o = await overview()
    const payload = JSON.stringify({ ...o, generatedAt: 0 })
    if (payload === last) return
    last = payload
    for (const c of clients) c.write(`data: ${JSON.stringify(o)}\n\n`)
  } catch (e) { console.error('tick', e) }
}
setInterval(tick, 5000)

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body))
}

const MESSAGE_BODY_MAX = 40_000_000 // 5 images of 5 MB, base64-encoded, plus text
const readBody = (req: http.IncomingMessage, max = 1_000_000): Promise<any> => new Promise((resolve, reject) => {
  let s = ''
  req.on('data', (c) => { s += c; if (s.length > max) { reject(new Error('body too large')); req.destroy() } })
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}) } catch { reject(new Error('invalid JSON')) } })
})

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`)
  try {
    // Anti DNS-rebinding: only answer requests addressed to the loopback name.
    if (!isLoopbackHost(req.headers.host)) return json(res, 403, { error: 'forbidden host' })
    if (DEMO && req.method === 'POST') return json(res, 403, { error: 'Demo mode: actions are disabled' })
    if (req.method === 'POST') {
      // Actions can start processes and run tools. Same-origin only; a custom header forces a CORS preflight that we never grant.
      if (!isAllowedPost(req.headers.origin, req.headers['x-ice'])) return json(res, 403, { error: 'forbidden' })
    }
    if (url.pathname === '/api/overview') return json(res, 200, await overview())
    if (req.method === 'POST' && (url.pathname === '/api/purge' || url.pathname === '/api/restore')) {
      const n = url.pathname === '/api/purge' ? await purgeFinished() : (restoreAll(), 0)
      last = '' // force the next SSE tick to push
      void tick()
      return json(res, 200, { ok: true, purged: n })
    }
    if (DEMO && url.pathname === '/api/github') return json(res, 200, { ok: true, user: 'demo' })
    if (DEMO && url.pathname === '/api/issues') return json(res, 200, { issues: [] })
    if (url.pathname === '/api/issues') return json(res, 200, await openIssues(url.searchParams.get('cwd') ?? ''))
    if (url.pathname === '/api/github') return json(res, 200, await githubStatus())
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      clients.add(res); req.on('close', () => clients.delete(res))
      res.write(`data: ${JSON.stringify(await overview())}\n\n`)
      return
    }
    const tr = url.pathname.match(/^\/api\/sessions\/([\w-]+)\/transcript$/)
    if (tr && DEMO) { const x = demoTranscript(tr[1]); return x ? json(res, 200, { items: x, host: null }) : json(res, 404, { error: 'not found' }) }
    if (tr) { await refreshHosted(); const x = transcript(tr[1]); return x ? json(res, 200, { items: x, host: hostedState(tr[1]) ?? null }) : json(res, 404, { error: 'not found' }) }
    if (req.method === 'POST' && url.pathname === '/api/commands') {
      // Slash commands and skills for a session (by id) or for a new one (agent + directory).
      const b = await readBody(req)
      if (DEMO) return json(res, 200, { commands: [{ name: 'review', description: 'Review the current changes' }, { name: 'summarize', description: 'Summarize the session', hint: '[focus]' }] })
      let agent: 'claude' | 'opencode' = b.agent === 'opencode' ? 'opencode' : 'claude', cwd = String(b.cwd ?? '')
      const id = b.id ? String(b.id) : undefined
      if (id) { const d = await detail(id); if (!d) return json(res, 404, { error: 'session not found' }); agent = d.agent as 'claude' | 'opencode'; cwd = d.cwd }
      await refreshHosted()
      return json(res, 200, { commands: await commands({ id, agent, cwd }) })
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      const b = await readBody(req, MESSAGE_BODY_MAX)
      return json(res, 200, { id: await startSession(String(b.cwd ?? ''), String(b.prompt ?? ''), b.model ? String(b.model) : undefined, { agent: b.agent === 'opencode' ? 'opencode' : 'claude', chrome: b.chrome !== false, autoAllow: b.autoAllow !== false, images: parseImages(b.images) }) })
    }
    const act = url.pathname.match(/^\/api\/sessions\/([\w-]+)\/(message|respond|interrupt|stop|resume|rename)$/)
    if (req.method === 'POST' && act) {
      const [, id, what] = act, b = await readBody(req, what === 'message' || what === 'resume' ? MESSAGE_BODY_MAX : undefined)
      if (what === 'resume') {
        // Only finished sessions: resuming one that another client is still running would put two writers on one session.
        await refreshHosted()
        const d = await detail(id)
        if (!d) return json(res, 404, { error: 'session not found' })
        if (d.live && !d.hosted) return json(res, 409, { error: d.agent === 'claude' ? 'This session is still running in a terminal. Close it there first.' : 'This OpenCode session was active in the last minute. Wait until it is idle, or close it in OpenCode.' })
        await resumeSession(id, d.cwd, String(b.text ?? ''), { chrome: b.chrome !== false, autoAllow: b.autoAllow !== false, images: parseImages(b.images) })
      }
      else if (what === 'rename') {
        const title = String(b.title ?? '').trim()
        if (!title || title.length > 200) return json(res, 400, { error: 'The name must have 1 to 200 characters' })
        await refreshHosted()
        const d = await detail(id)
        if (!d) return json(res, 404, { error: 'session not found' })
        // A live terminal session keeps its own name in memory and would write the old one back: rename it there (/rename).
        if (d.agent === 'claude') {
          if (d.live && !d.hosted) return json(res, 409, { error: 'This session is running in a terminal: rename it there with /rename.' })
          await renameSession(id, title)
        } else await renameOpenCode(id, d.cwd, title)
      }
      else if (what === 'message') await send(id, String(b.text ?? ''), parseImages(b.images))
      else if (what === 'respond') await respond(id, String(b.requestId ?? ''), { allow: !!b.allow, answers: b.answers, message: b.message })
      else if (what === 'interrupt') await interrupt(id)
      else await stop(id)
      last = ''; void tick()
      return json(res, 200, { ok: true })
    }
    const m = url.pathname.match(/^\/api\/sessions\/([\w-]+)$/)
    if (m) { const d = await detail(m[1]); return d ? json(res, 200, d) : json(res, 404, { error: 'not found' }) }

    // Static files (production build)
    let f = path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname)
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html')
    if (!fs.existsSync(f)) return json(res, 404, { error: 'Run `npm run build` or use `npm run dev`' })
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' })
    fs.createReadStream(f).pipe(res)
  } catch (e) { console.error(e); json(res, 500, { error: String(e) }) }
}).listen(PORT, HOST, () => console.log(`ICE API → http://${HOST}:${PORT}  (home: ${os.homedir()}/.claude)`))

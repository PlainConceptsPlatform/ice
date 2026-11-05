import crypto from 'node:crypto'
import fs from 'node:fs'
import { query, type CanUseTool, type PermissionResult, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { HostedPending, ImageInput, SlashCommandInfo } from '../shared/types.ts'
import { checkMessage, claudeContent } from './attachments.ts'

/**
 * Sessions started from ICE. ICE owns the Claude Code process (Agent SDK), so it can send messages,
 * answer permission prompts and interrupt turns. Sessions started elsewhere stay read-only.
 * They live only as long as the ICE server: restarting ICE ends them (the transcript stays and can be resumed).
 */
interface Hosted {
  id: string
  cwd: string
  q: Query
  push: (m: SDKUserMessage | null) => void
  busy: boolean
  pending?: HostedPending & { resolve: (r: PermissionResult) => void; input: Record<string, unknown> }
  error?: string
}
const sessions = new Map<string, Hosted>()

// hostedState is declared below as a const; allStates only runs after module init.

export const allStates = (): Record<string, { busy: boolean; pending?: HostedPending; error?: string }> =>
  Object.fromEntries([...sessions.keys()].map((id) => [id, hostedState(id)!]))
export const hostedCount = () => sessions.size
export const hostedState = (id: string): { busy: boolean; pending?: HostedPending; error?: string } | undefined => {
  const h = sessions.get(id)
  if (!h) return undefined
  const { resolve: _r, input: _i, ...pending } = h.pending ?? ({} as any)
  return { busy: h.busy, pending: h.pending ? (pending as HostedPending) : undefined, error: h.error }
}

export interface Msg { text: string; images?: ImageInput[] }
const userMsg = (m: Msg): SDKUserMessage => ({ type: 'user', message: { role: 'user', content: claudeContent(m.text, m.images) as any }, parent_tool_use_id: null })

/** Async queue feeding the SDK's streaming-input mode: the process stays alive between turns. */
function inputQueue() {
  const buf: (SDKUserMessage | null)[] = []
  let wake: (() => void) | null = null
  const push = (m: SDKUserMessage | null) => { buf.push(m); wake?.(); wake = null }
  async function* gen(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while (!buf.length) await new Promise<void>((r) => (wake = r))
      const m = buf.shift()!
      if (m === null) return
      yield m
    }
  }
  return { push, gen: gen() }
}

export interface LaunchOpts { chrome?: boolean; autoAllow?: boolean }

export function startSession(cwd: string, prompt: Msg, model?: string, o: LaunchOpts = {}): string {
  return launch(crypto.randomUUID(), cwd, prompt, { model, ...o })
}

/** Continue a finished session (same id, same transcript). Refuse if something else is already running it. */
export function resumeSession(id: string, cwd: string, prompt: Msg, o: LaunchOpts = {}): string {
  if (sessions.has(id)) throw new Error('this session is already running in ICE')
  return launch(id, cwd, prompt, { resume: true, ...o })
}

function launch(id: string, cwd: string, prompt: Msg, o: LaunchOpts & { model?: string; resume?: boolean }): string {
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('cwd is not a directory')
  checkMessage(prompt.text, prompt.images ?? [])
  const inq = inputQueue()
  const h = { id, cwd, push: inq.push, busy: true } as Hosted

  // Every permission prompt (and AskUserQuestion) lands here and waits for the user in ICE.
  // With autoAllow, permission prompts are accepted without asking. canUseTool only runs after the user's deny rules and
  // hooks, so those still win. Questions and plan approval are decisions, not permissions: they always wait for the user.
  const ASK = new Set(['AskUserQuestion', 'ExitPlanMode'])
  const canUseTool: CanUseTool = (tool, input, opts) => new Promise<PermissionResult>((resolve) => {
    if (o.autoAllow && !ASK.has(tool)) return resolve({ behavior: 'allow', updatedInput: input })
    const requestId = crypto.randomUUID()
    h.pending = { requestId, tool, title: opts.title ?? opts.decisionReason ?? `Allow ${tool}?`, input, resolve, summary: summarize(tool, input), questions: tool === 'AskUserQuestion' ? (input as any).questions : undefined }
    opts.signal.addEventListener('abort', () => { if (h.pending?.requestId === requestId) { h.pending = undefined; resolve({ behavior: 'deny', message: 'Aborted' }) } })
  })

  h.q = query({ prompt: inq.gen, options: { cwd, ...(o.resume ? { resume: id } : { sessionId: id }), model: o.model, canUseTool, ...(o.chrome ? { extraArgs: { chrome: null } } : {}), permissionMode: 'default' } })
  sessions.set(id, h)
  inq.push(userMsg(prompt))

  void (async () => {
    try {
      for await (const m of h.q) {
        if (m.type === 'result') h.busy = false
        else if (m.type === 'assistant' || m.type === 'user' || m.type === 'system') h.busy = true
      }
    } catch (e) { h.error = String((e as Error).message ?? e) }
    finally { h.pending?.resolve({ behavior: 'deny', message: 'Session closed' }); sessions.delete(id) }
  })()
  return id
}

function get(id: string): Hosted { const h = sessions.get(id); if (!h) throw new Error('not a session hosted by ICE'); return h }

export function send(id: string, m: Msg) {
  checkMessage(m.text, m.images ?? [])
  const h = get(id); h.busy = true; h.push(userMsg(m))
}

/** Slash commands and skills of a hosted session. Claude Code's own terminal commands mostly do nothing outside a terminal: keep the few that work. */
const SDK_BUILTINS = new Set(['compact', 'context', 'goal', 'rename'])
export const isHosted = (id: string) => sessions.has(id)
const withTimeout = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out reading the command list')), 15_000))])
const keep = (all: Awaited<ReturnType<Query['supportedCommands']>>): SlashCommandInfo[] =>
  all.filter((c) => !c.builtin || SDK_BUILTINS.has(c.name)).map((c) => ({ name: c.name, description: c.description, hint: c.argumentHint || undefined }))

/** Commands of a live hosted session. */
export const commands = async (id: string) => keep(await withTimeout(get(id).q.supportedCommands()))

/** Commands available in a directory, for sessions ICE does not host: a throwaway Claude Code process that is initialised and closed
 *  at once (no model call, no cost). Cached for a minute per directory. */
const dirCache = new Map<string, { at: number; list: SlashCommandInfo[] }>()
export async function commandsInDir(cwd: string): Promise<SlashCommandInfo[]> {
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('cwd is not a directory')
  const hit = dirCache.get(cwd)
  if (hit && Date.now() - hit.at < 60_000) return hit.list
  async function* never(): AsyncGenerator<SDKUserMessage> { await new Promise(() => undefined) }
  const q = query({ prompt: never(), options: { cwd, permissionMode: 'default' } })
  try {
    const list = keep(await withTimeout(q.supportedCommands()))
    dirCache.set(cwd, { at: Date.now(), list }); return list
  } finally { q.close() }
}

/** Answer the pending permission request. For AskUserQuestion pass `answers` (question text → label; multi-select comma separated). */
export function respond(id: string, requestId: string, r: { allow: boolean; answers?: Record<string, string>; message?: string }) {
  const h = get(id)
  if (!h.pending || h.pending.requestId !== requestId) throw new Error('that request is no longer pending')
  const p = h.pending; h.pending = undefined
  if (!r.allow) return p.resolve({ behavior: 'deny', message: r.message?.trim() || 'Denied by the user in ICE' })
  p.resolve({ behavior: 'allow', updatedInput: r.answers ? { ...p.input, answers: r.answers } : p.input })
}

export async function interrupt(id: string) { const h = get(id); h.pending?.resolve({ behavior: 'deny', message: 'Interrupted', interrupt: true }); h.pending = undefined; await h.q.interrupt() }
export function stop(id: string) { const h = get(id); h.push(null); h.q.close() }

function summarize(tool: string, input: Record<string, any>): string {
  const main = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.description ?? input.plan
  return String(main ?? JSON.stringify(input)).slice(0, 1500)
}

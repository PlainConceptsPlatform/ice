export type Agent = 'claude' | 'opencode'

export type SessionState = 'working' | 'needs-you' | 'running-shell' | 'finished'

export interface PrInfo {
  number: number
  repo: string
  url: string
  state?: 'OPEN' | 'MERGED' | 'CLOSED'
  title?: string
  draft?: boolean
  checks?: 'passing' | 'failing' | 'pending' | 'none'
  review?: string
}

/** How the last 8 hours of a session split between agent-working and idle. */
export interface Idle8h {
  idleMs: number
  activeMs: number
  existsMs: number // time the session existed inside the window
  buckets: number[] // 48 x 10 min; working fraction 0..1, -1 = session did not exist yet / already ended
}

export type FlowStage = 'runner-queue' | 'running' | 'deploying' | 'approval'

export interface FlowStep { name: string; status: string; conclusion: string | null; startedAt?: string; completedAt?: string }
export interface FlowJob { name: string; status: string; conclusion: string | null; startedAt?: string; completedAt?: string; steps: FlowStep[] }
export interface FlowRun {
  runId: number; workflow: string; url: string; event: string; status: string; conclusion: string | null
  createdAt: string; startedAt?: string; updatedAt: string; attempt: number
}
export interface ActiveFlow {
  run: FlowRun
  stage: FlowStage
  elapsedMs: number // since the run was created (includes runner queue)
  queuedMs?: number // set while waiting for a runner
  job?: string
  step?: string
  nextStep?: string
  stepElapsedMs?: number
  stepMedianMs?: number // typical duration from history
  stepEtaMs?: number
  flowMedianMs?: number // typical total duration from history
  flowEtaMs?: number
  overrunMs?: number // how far past the typical duration
  jobs: FlowJob[]
}
export interface FlowInfo {
  repo?: string
  branch?: string
  loading?: boolean
  error?: string
  active: ActiveFlow[]
  latest?: FlowRun // most recent completed run since the session started
  recent: FlowRun[] // runs since the session started, newest first
  iteration: number // runs of the current workflow since the session started
  failedSinceStart: number
  expectIterate: { value: boolean | null; reason: string }
}

export interface Alert {
  kind: 'cost' | 'compactions' | 'waiting' | 'flow' | 'flow-failed'
  message: string
}

export interface SessionSummary {
  id: string
  agent: Agent
  title: string
  name?: string
  project: string // working directory name
  cwd: string
  branch?: string
  live: boolean
  pid?: number
  state: SessionState
  startedAt: number
  lastActivity: number
  turns: number
  compactions: number
  errors: number // failed tool calls / API errors
  idle8h: Idle8h
  flow?: FlowInfo // undefined when there is no repo/branch to look up
  cost: number
  costKnown: boolean // false when no price is available (cost shown as "—")
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  models: Record<string, number> // model -> cost
  prs: PrInfo[]
  remote?: { url: string } // Remote Control is on: the session can be continued from claude.ai or the Claude app
  hosted?: boolean // started from ICE: you can message it and answer its prompts
  goal?: { condition: string; met: boolean } // Claude Code /goal; absent when none is set
  alerts: Alert[]
  lastPrompt?: string
}

export interface TimelinePoint { t: number; cost: number }
export interface SessionDetail extends SessionSummary {
  timeline: TimelinePoint[]
  events: { t: number; kind: string; text: string }[]
}

export interface TranscriptItem {
  t: number
  role: 'user' | 'assistant' | 'tool' | 'result'
  text: string
  tool?: string
  isError?: boolean
}

/** A permission prompt or AskUserQuestion that a session hosted by ICE is waiting on. */
export interface HostedPending {
  requestId: string
  tool: string
  title: string
  summary: string
  questions?: { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string }[] }[]
}

export interface RepoIssue { number: number; title: string; labels: string[] }

export interface Overview {
  generatedAt: number
  totals: { costToday: number; cost7d: number; live: number; needsYou: number }
  sessions: SessionSummary[]
  purged: number // finished sessions hidden by the user (restorable)
}


/** An image attached to a message: base64 payload (no data: prefix). */
export interface ImageInput { mediaType: string; data: string }

/** A slash command or skill the agent of a hosted session can run. */
export interface SlashCommandInfo { name: string; description: string; hint?: string }

export const usd = (n: number) => (n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`)
export const money = (n: number, known = true) => (known ? usd(n) : '—')
export const AGENT_LABEL = { claude: 'Claude', opencode: 'OpenCode' } as const
export const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : `${n}`)
export function ago(t: number) {
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86400) return `${Math.floor(s / 3600)} h`
  return `${Math.floor(s / 86400)} d`
}
export function dur(a: number, b: number) {
  const m = Math.floor((b - a) / 60000)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}
export const STATE_LABEL = {
  working: 'Working', 'needs-you': 'Needs you', 'running-shell': 'Running shell', finished: 'Finished',
} as const

/** Duration in ms → "35 s", "4 min", "1 h 12 min". */
export function fmt(msv?: number) {
  if (msv == null) return '—'
  const s = Math.round(msv / 1000)
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim()
}

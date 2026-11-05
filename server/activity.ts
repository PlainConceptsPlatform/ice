import type { Idle8h } from '../shared/types.ts'

const HOUR = 3_600_000
const BUCKET = 10 * 60_000
const N = 48

export type Interval = [number, number]

function merge(iv: Interval[]): Interval[] {
  const s = iv.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  const out: Interval[] = []
  for (const [a, b] of s) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

const overlap = (iv: Interval[], a: number, b: number) =>
  iv.reduce((acc, [x, y]) => acc + Math.max(0, Math.min(y, b) - Math.max(x, a)), 0)

/** Working vs idle time over the last 8 h. `endAt` is `now` for live sessions, else the last activity. */
export function idle8h(intervals: Interval[], startedAt: number, endAt: number, now = Date.now()): Idle8h {
  const w0 = now - 8 * HOUR
  const from = Math.max(startedAt, w0)
  const to = Math.min(endAt, now)
  const iv = merge(intervals)
  const buckets = Array.from({ length: N }, (_, i) => {
    const b0 = w0 + i * BUCKET, b1 = b0 + BUCKET
    const exists = Math.max(0, Math.min(b1, to) - Math.max(b0, from))
    return exists > 0 ? Math.min(1, overlap(iv, Math.max(b0, from), Math.min(b1, to)) / exists) : -1
  })
  const existsMs = Math.max(0, to - from)
  const activeMs = existsMs ? Math.min(existsMs, overlap(iv, from, to)) : 0
  return { idleMs: existsMs - activeMs, activeMs, existsMs, buckets }
}

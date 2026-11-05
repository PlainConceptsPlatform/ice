/** POST helper: the server only accepts same-origin POSTs carrying this header. */
export async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ice': '1' }, body: JSON.stringify(body ?? {}) })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`)
  // A 200 that is not JSON means an older ICE server answered with the page: say so instead of pretending it worked.
  if (j === null) throw new Error('Unexpected answer from the ICE server. Restart ICE (npm start) so it matches this page.')
  return j as T
}

// Slot layout of the wall: pure functions, so the rules can be tested without a browser.
export interface Layout { key: string; slots: (string | null)[]; mem: Map<string, number> }

/**
 * Cells keep their position: a session gets a slot when it first appears and keeps it while it stays in `ids`
 * (the filtered set), even if that leaves holes. A different `key` (filters, sort, grouping, re-sort) lays everything out again.
 */
export function reconcile(prev: Layout | null, ids: string[], key: string): Layout {
  if (!prev || prev.key !== key) return { key, slots: ids, mem: new Map(ids.map((id, i) => [id, i])) }
  const want = new Set(ids)
  const mem = new Map(prev.mem)
  const out = prev.slots.map((id) => (id && want.has(id) ? id : null))
  for (const [i, id] of prev.slots.entries()) if (id && !want.has(id)) mem.set(id, i) // remember where it was
  const placed = new Set(out.filter(Boolean))
  for (const id of ids) {
    if (placed.has(id)) continue
    const back = mem.get(id) // came back (e.g. working again): its old slot, if still free
    const at = back !== undefined && out[back] === null ? back : out.indexOf(null)
    if (at >= 0) out[at] = id; else out.push(id)
    placed.add(id)
  }
  while (out.length && out[out.length - 1] === null) out.pop()
  return { key, slots: out, mem }
}

/** Drag and drop: the cell takes the target slot; whatever was there takes the old one (a hole stays a hole). */
export function moveSlot(layout: Layout, id: string, to: number): Layout {
  const s = [...layout.slots], from = s.indexOf(id)
  if (from < 0 || from === to) return layout
  while (s.length <= to) s.push(null)
  const other = s[to]; s[to] = id; s[from] = other
  const mem = new Map(layout.mem)
  mem.set(id, to); if (other) mem.set(other, from)
  while (s.length && s[s.length - 1] === null) s.pop()
  return { ...layout, slots: s, mem }
}

/** Small, safe Markdown parser for chat messages: no HTML is ever produced from the text, only a tree the UI renders. */
export type Inline =
  | { t: 'text'; s: string } | { t: 'code'; s: string } | { t: 'br' }
  | { t: 'b' | 'i' | 'del'; c: Inline[] } | { t: 'a'; href: string; c: Inline[] }
export type Block =
  | { t: 'p'; c: Inline[] } | { t: 'h'; l: number; c: Inline[] } | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; c: Block[] } | { t: 'list'; ordered: boolean; items: Block[][] } | { t: 'hr' }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }

const SAFE = /^(https?:\/\/|mailto:)/i
const URL_RE = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/

/** Inline spans. Unclosed markers stay literal. */
export function inline(src: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => { if (buf) { out.push({ t: 'text', s: buf }); buf = '' } }
  let i = 0
  while (i < src.length) {
    const c = src[i], rest = src.slice(i)
    if (c === '\\' && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!~|>]/.test(src[i + 1])) { buf += src[i + 1]; i += 2; continue }
    if (c === '`') {
      const n = /^(`+)/.exec(rest)![1].length, end = src.indexOf('`'.repeat(n), i + n)
      if (end > i + n) { flush(); out.push({ t: 'code', s: src.slice(i + n, end).replace(/^ (.*) $/, '$1') }); i = end + n; continue }
    }
    const pair = (mark: string, t: 'b' | 'i' | 'del') => {
      if (!rest.startsWith(mark) || /^\s/.test(rest.slice(mark.length))) return false
      const end = src.indexOf(mark, i + mark.length)
      if (end <= i + mark.length || /\s$/.test(src.slice(i + mark.length, end))) return false
      if (t === 'i' && mark === '_' && /\w/.test(src[i - 1] ?? '')) return false // snake_case stays literal
      flush(); out.push({ t, c: inline(src.slice(i + mark.length, end)) }); i = end + mark.length; return true
    }
    if (pair('**', 'b') || pair('__', 'b') || pair('~~', 'del') || pair('*', 'i') || pair('_', 'i')) continue
    if (c === '[') {
      const m = /^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/.exec(rest)
      if (m) { flush(); out.push(SAFE.test(m[2]) ? { t: 'a', href: m[2], c: inline(m[1]) } : { t: 'text', s: m[1] }); i += m[0].length; continue }
    }
    if (c === 'h') { const m = URL_RE.exec(rest); if (m && !/\w/.test(src[i - 1] ?? '')) { flush(); out.push({ t: 'a', href: m[0], c: [{ t: 'text', s: m[0] }] }); i += m[0].length; continue } }
    if (c === '\n') { flush(); out.push({ t: 'br' }); i++; continue }
    buf += c; i++
  }
  flush()
  return out
}

const LI = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((x) => x.trim().replace(/\\\|/g, '|'))
const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-')

function list(lines: string[], start: number): [Block, number] {
  const first = LI.exec(lines[start])!
  const base = first[1].length, ordered = /\d/.test(first[2][0])
  const items: Block[][] = []
  let i = start
  while (i < lines.length) {
    let m = LI.exec(lines[i])
    if (!m && !lines[i].trim()) { // one blank line between items of the same list is fine
      const nx = LI.exec(lines[i + 1] ?? ''); if (nx && nx[1].length >= base) { i++; m = nx } else break
    }
    if (!m || m[1].length < base) break
    if (m[1].length > base && items.length) { const [nested, ni] = list(lines, i); items[items.length - 1].push(nested); i = ni; continue }
    const para: Block = { t: 'p', c: inline(m[3]) }
    items.push([para]); i++
    // wrapped text of the same item: indented, not a new item, not blank
    while (i < lines.length && lines[i].trim() && !LI.test(lines[i]) && /^\s+\S/.test(lines[i])) { para.c.push({ t: 'br' }, ...inline(lines[i].trim())); i++ }
  }
  return [{ t: 'list', ordered, items }, i]
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    const fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)/.exec(l)
    if (fence) {
      const body: string[] = []; i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++])
      i++ // closing fence (a missing one just ends the block)
      out.push({ t: 'code', lang: fence[2], text: body.join('\n') }); continue
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l)
    if (h) { out.push({ t: 'h', l: h[1].length, c: inline(h[2]) }); i++; continue }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push({ t: 'hr' }); i++; continue }
    if (/^\s*>/.test(l)) {
      const q: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*> ?/, ''))
      out.push({ t: 'quote', c: parseMarkdown(q.join('\n')) }); continue
    }
    if (l.includes('|') && i + 1 < lines.length && isSep(lines[i + 1]) && cells(l).length > 1) {
      const head = cells(l).map(inline); i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]).map(inline))
      out.push({ t: 'table', head, rows }); continue
    }
    if (LI.test(l)) { const [b, ni] = list(lines, i); out.push(b); i = ni; continue }
    // paragraph: until a blank line or the start of another block
    const p: string[] = []
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) && !LI.test(lines[i])) p.push(lines[i++])
    out.push({ t: 'p', c: inline(p.join('\n')) })
  }
  return out
}

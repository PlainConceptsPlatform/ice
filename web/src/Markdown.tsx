import type { Block, Inline } from './mdparse'
import { parseMarkdown } from './mdparse'

function Inl({ c }: { c: Inline[] }) {
  return <>{c.map((x, i) => {
    switch (x.t) {
      case 'text': return x.s
      case 'br': return <br key={i} />
      case 'code': return <code key={i}>{x.s}</code>
      case 'b': return <strong key={i}><Inl c={x.c} /></strong>
      case 'i': return <em key={i}><Inl c={x.c} /></em>
      case 'del': return <del key={i}><Inl c={x.c} /></del>
      case 'a': return <a key={i} href={x.href} target="_blank" rel="noopener noreferrer"><Inl c={x.c} /></a>
    }
  })}</>
}

function Blocks({ b }: { b: Block[] }) {
  return <>{b.map((x, i) => {
    switch (x.t) {
      case 'p': return <p key={i}><Inl c={x.c} /></p>
      case 'h': { const H = `h${Math.min(6, x.l + 2)}` as 'h3'; return <H key={i} className="mdh"><Inl c={x.c} /></H> }
      case 'code': return <pre key={i} className="mdcode" data-lang={x.lang || undefined}><code>{x.text}</code></pre>
      case 'quote': return <blockquote key={i}><Blocks b={x.c} /></blockquote>
      case 'hr': return <hr key={i} />
      case 'list': { const L = x.ordered ? 'ol' : 'ul'; return <L key={i}>{x.items.map((it, j) => <li key={j}><Blocks b={it} /></li>)}</L> }
      case 'table': return (
        <div key={i} className="mdtable"><table>
          <thead><tr>{x.head.map((c, j) => <th key={j}><Inl c={c} /></th>)}</tr></thead>
          <tbody>{x.rows.map((r, j) => <tr key={j}>{x.head.map((_, k) => <td key={k}><Inl c={r[k] ?? []} /></td>)}</tr>)}</tbody>
        </table></div>
      )
    }
  })}</>
}

/** Renders chat Markdown as React elements (never as raw HTML). */
export function Markdown({ text }: { text: string }) {
  return <div className="md"><Blocks b={parseMarkdown(text)} /></div>
}

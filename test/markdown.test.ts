import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inline, parseMarkdown } from '../web/src/mdparse.ts'
import { isInternal, visibleItems } from '../web/src/transcript-view.ts'
import type { TranscriptItem } from '../shared/types.ts'

const kinds = (s: string) => parseMarkdown(s).map((b) => b.t)

test('headings, paragraphs, rules and code fences', () => {
  assert.deepEqual(kinds('# Title\n\ntext\n\n---\n\n```ts\nconst a = 1\n```'), ['h', 'p', 'hr', 'code'])
  const code = parseMarkdown('```js\nx()\n\ny()\n```')[0] as any
  assert.equal(code.lang, 'js'); assert.equal(code.text, 'x()\n\ny()')
})
test('an unclosed fence ends the block instead of swallowing nothing', () => {
  const b = parseMarkdown('```\nopen') as any[]
  assert.equal(b[0].t, 'code'); assert.equal(b[0].text, 'open')
})
test('inline: bold, italic, code, strike, escapes', () => {
  assert.deepEqual(inline('a **b** `c` ~~d~~ *e*').map((x) => x.t), ['text', 'b', 'text', 'code', 'text', 'del', 'text', 'i'])
  assert.deepEqual(inline('\\*lit\\*'), [{ t: 'text', s: '*lit*' }])
  assert.deepEqual(inline('snake_case_name'), [{ t: 'text', s: 'snake_case_name' }])
  assert.deepEqual(inline('2 * 3 * 4'), [{ t: 'text', s: '2 * 3 * 4' }])
  assert.deepEqual(inline('**open'), [{ t: 'text', s: '**open' }])
})
test('links: http, https and mailto only; javascript: is dropped to plain text', () => {
  assert.equal((inline('[x](https://a.com)')[0] as any).href, 'https://a.com')
  assert.deepEqual(inline('[x](javascript:alert(1))'), [{ t: 'text', s: 'x' }])
  assert.deepEqual(inline('[x](data:text/html,hi)'), [{ t: 'text', s: 'x' }])
  const bare = inline('see https://a.com/x. ok')
  assert.equal((bare[1] as any).href, 'https://a.com/x')
})
test('raw HTML stays text', () => {
  assert.deepEqual(inline('<img src=x onerror=alert(1)>'), [{ t: 'text', s: '<img src=x onerror=alert(1)>' }])
  assert.deepEqual(kinds('<script>x</script>'), ['p'])
})
test('lists: bullets, numbers, nesting and wrapped items', () => {
  const l = parseMarkdown('- one\n  more\n- two\n  - nested\n- three')[0] as any
  assert.equal(l.t, 'list'); assert.equal(l.items.length, 3)
  assert.equal(l.items[1][1].t, 'list')
  assert.equal((parseMarkdown('1. a\n2. b')[0] as any).ordered, true)
  assert.equal((parseMarkdown('- a\n\n- b')[0] as any).items.length, 2)
})
test('tables and blockquotes', () => {
  const t = parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |')[0] as any
  assert.equal(t.t, 'table'); assert.equal(t.head.length, 2); assert.equal(t.rows.length, 2)
  assert.deepEqual(kinds('> quoted\n> more'), ['quote'])
  assert.deepEqual(kinds('a | b\nplain'), ['p'])
})
test('empty and whitespace input', () => {
  assert.deepEqual(parseMarkdown(''), []); assert.deepEqual(parseMarkdown('  \n\n'), [])
})

const item = (role: TranscriptItem['role'], tool?: string): TranscriptItem => ({ t: 1, role, text: 'x', tool })
test('tool calls and results are internal, messages are not', () => {
  assert.ok(isInternal(item('tool', 'Bash'))); assert.ok(isInternal(item('result')))
  assert.ok(!isInternal(item('user'))); assert.ok(!isInternal(item('assistant')))
})
test('questions to the user are never hidden', () => {
  assert.ok(!isInternal(item('tool', 'AskUserQuestion'))); assert.ok(!isInternal(item('tool', 'ExitPlanMode')))
})
test('visibleItems hides internal items by default and counts them', () => {
  const all = [item('user'), item('tool', 'Bash'), item('result'), item('assistant')]
  const v = visibleItems(all, false)
  assert.equal(v.shown.length, 2); assert.equal(v.hidden, 2)
  const w = visibleItems(all, true)
  assert.equal(w.shown.length, 4); assert.equal(w.hidden, 0)
})

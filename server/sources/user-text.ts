/**
 * Claude Code records slash commands, shell escapes, notifications and pastes as pseudo-XML inside "user" messages.
 * Turn them into what the user actually typed or saw:
 *   <command-name>/goal</command-name><command-args>…</command-args>   → "/goal …"            (command)
 *   <bash-input>ls</bash-input>                                        → "! ls"                (command)
 *   <local-command-stdout> / <bash-stdout> + <bash-stderr>             → its text              (output)
 *   <task-notification> (background task finished)                     → "Background task …"  (output)
 *   <local-command-caveat>, <system-reminder>                          → dropped               (skip)
 *   <pasted_content id="…">text</pasted_content>                       → text                  (text)
 * "output" is internal (shown as a hidden result); everything else reads as a normal message.
 */
export type UserText = { kind: 'text' | 'command' | 'output' | 'skip'; text: string }

const tag = (s: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(s)?.[1]
const ANSI = /\u001b\[[0-9;]*m/g
const SKIP: UserText = { kind: 'skip', text: '' }
const output = (t: string): UserText => { const x = t.replace(ANSI, '').trim(); return x ? { kind: 'output', text: x } : SKIP }

export function cleanUserText(raw: string): UserText {
  const s = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
  if (!s) return raw.trim() ? SKIP : { kind: 'text', text: raw }

  const name = tag(s, 'command-name')?.trim()
  if (name) {
    const args = tag(s, 'command-args')?.trim()
    return { kind: 'command', text: `${name.startsWith('/') ? name : `/${name}`}${args ? ` ${args}` : ''}` }
  }
  if (/^<local-command-caveat>/.test(s)) return SKIP
  const bash = tag(s, 'bash-input')
  if (bash !== undefined) return { kind: 'command', text: `! ${bash.trim()}` }
  const out = tag(s, 'local-command-stdout') ?? tag(s, 'local-command-stderr')
  if (out !== undefined) return output(out)
  const so = tag(s, 'bash-stdout'), se = tag(s, 'bash-stderr')
  if (so !== undefined || se !== undefined) return output([so, se].filter(Boolean).join('\n'))
  if (/^<task-notification>/.test(s)) {
    const status = tag(s, 'status')?.trim(), summary = tag(s, 'summary')?.trim()
    return { kind: 'output', text: `Background task${status ? ` ${status}` : ''}${summary ? `: ${summary}` : ''}` }
  }
  return { kind: 'text', text: s.replace(/<pasted_content(?:\s[^>]*)?>([\s\S]*?)(?:<\/pasted_content(?:\s[^>]*)?>|$)/g, (_, inner: string) => inner.trim()) }
}

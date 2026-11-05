import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('slash commands are shown as typed, their caveat is dropped and output becomes a result', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-tr2-'))
  process.env.CLAUDE_CONFIG_DIR = dir
  fs.mkdirSync(path.join(dir, 'projects', 'p'), { recursive: true })
  const u = (content: string) => JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content } })
  fs.writeFileSync(path.join(dir, 'projects', 'p', 'cmd.jsonl'), [
    u('<local-command-caveat>Caveat: generated while running local commands</local-command-caveat>'),
    u('<command-name>/goal</command-name>\n<command-message>goal</command-message>\n<command-args>ship it</command-args>'),
    u('<local-command-stdout>Goal set</local-command-stdout>'),
  ].join('\n') + '\n')
  const { transcript } = await import('../server/transcript.ts')
  const items = transcript('cmd')!
  assert.deepEqual(items.map((i) => [i.role, i.text]), [['user', '/goal ship it'], ['result', 'Goal set']])
  fs.rmSync(dir, { recursive: true, force: true })
})

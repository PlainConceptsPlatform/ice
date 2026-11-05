import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('a user image block shows as a note, not as raw base64', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-tr-'))
  process.env.CLAUDE_CONFIG_DIR = dir
  fs.mkdirSync(path.join(dir, 'projects', 'p'), { recursive: true })
  const line = { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA'.repeat(1000) } }, { type: 'text', text: 'what is this?' }] } }
  fs.writeFileSync(path.join(dir, 'projects', 'p', 'abc.jsonl'), JSON.stringify(line) + '\n')
  const { transcript } = await import('../server/transcript.ts')
  const items = transcript('abc')!
  assert.equal(items.length, 2)
  assert.match(items[0].text, /Image attached \(png\)/)
  assert.ok(!items[0].text.includes('AAAA'))
  assert.equal(items[1].text, 'what is this?')
  fs.rmSync(dir, { recursive: true, force: true })
})

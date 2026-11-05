import { test } from 'node:test'
import assert from 'node:assert/strict'
import { opensNewSession, type KeyInfo } from '../web/src/shortcuts.ts'

const key = (k: string, extra: Partial<KeyInfo> = {}): KeyInfo => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra })
const idle = { dialogOpen: false }

test('N opens a new session when nothing else has the keyboard', () => {
  assert.ok(opensNewSession(key('n'), idle))
  assert.ok(opensNewSession(key('N'), { ...idle, targetTag: 'BODY' }))
  assert.ok(opensNewSession(key('n'), { ...idle, targetTag: 'BUTTON' }))
})
test('typing in a field never triggers it', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'textarea']) assert.ok(!opensNewSession(key('n'), { ...idle, targetTag: tag }), tag)
  assert.ok(!opensNewSession(key('n'), { ...idle, targetTag: 'DIV', targetEditable: true }))
})
test('not while a dialog (conversation, search, new session) is open', () => {
  assert.ok(!opensNewSession(key('n'), { dialogOpen: true }))
})
test('modifiers, repeats and IME composition are ignored; other keys too', () => {
  for (const m of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'] as const) assert.ok(!opensNewSession(key('n', { [m]: true }), idle), m)
  assert.ok(!opensNewSession(key('n', { repeat: true }), idle))
  assert.ok(!opensNewSession(key('n', { isComposing: true }), idle))
  assert.ok(!opensNewSession(key('m'), idle))
  assert.ok(!opensNewSession(key('Enter'), idle))
})

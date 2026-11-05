import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedPost, isLoopbackHost } from '../server/security.ts'

test('host check accepts only the loopback names', () => {
  for (const h of ['127.0.0.1', '127.0.0.1:4317', 'localhost', 'localhost:5173']) assert.ok(isLoopbackHost(h), h)
  for (const h of [undefined, '', 'evil.example', 'evil.example:4317', '127.0.0.1.evil.example', 'localhost.evil.example', '0.0.0.0:4317', '[::1]:4317'])
    assert.ok(!isLoopbackHost(h), String(h))
})

test('POST needs the x-ice header', () => {
  assert.ok(isAllowedPost(undefined, '1'))
  assert.ok(!isAllowedPost(undefined, undefined))
  assert.ok(!isAllowedPost(undefined, '0'))
  assert.ok(!isAllowedPost(undefined, ['1', '1']))
})

test('POST rejects cross-site origins even with the header', () => {
  assert.ok(isAllowedPost('http://127.0.0.1:4317', '1'))
  assert.ok(isAllowedPost('http://localhost:5173', '1'))
  assert.ok(!isAllowedPost('https://evil.example', '1'))
  assert.ok(!isAllowedPost('http://127.0.0.1.evil.example', '1'))
  assert.ok(!isAllowedPost('https://127.0.0.1:4317', '1')) // only plain http on loopback
  assert.ok(!isAllowedPost('null', '1'))
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moveSlot, reconcile, type Layout } from '../web/src/layout.ts'

const fresh = (ids: string[], key = 'k') => reconcile(null, ids, key)

test('a new layout follows the given order', () => {
  assert.deepEqual(fresh(['a', 'b', 'c']).slots, ['a', 'b', 'c'])
})

test('cells keep their slot when the order changes', () => {
  const l = reconcile(fresh(['a', 'b', 'c']), ['c', 'a', 'b'], 'k')
  assert.deepEqual(l.slots, ['a', 'b', 'c'])
})

test('a session that leaves the set leaves a hole, and later ones keep their slot', () => {
  const l = reconcile(fresh(['a', 'b', 'c']), ['a', 'c'], 'k')
  assert.deepEqual(l.slots, ['a', null, 'c'])
})

test('a returning session gets its old slot back when it is free', () => {
  const gone = reconcile(fresh(['a', 'b', 'c']), ['a', 'c'], 'k')
  const back = reconcile(gone, ['a', 'c', 'b'], 'k')
  assert.deepEqual(back.slots, ['a', 'b', 'c'])
})

test('a new session fills the first hole, else goes at the end', () => {
  const gone = reconcile(fresh(['a', 'b', 'c']), ['a', 'c'], 'k')
  assert.deepEqual(reconcile(gone, ['a', 'c', 'd'], 'k').slots, ['a', 'd', 'c'])
  assert.deepEqual(reconcile(fresh(['a', 'b']), ['a', 'b', 'd'], 'k').slots, ['a', 'b', 'd'])
})

test('a returning session whose old slot was taken goes to another free slot', () => {
  const l1 = reconcile(fresh(['a', 'b', 'c']), ['a', 'c'], 'k') // b leaves: [a, _, c]
  const l2 = reconcile(l1, ['a', 'c', 'x'], 'k') // x takes b's slot
  const l3 = reconcile(l2, ['a', 'c', 'x', 'b'], 'k')
  assert.deepEqual(l3.slots, ['a', 'x', 'c', 'b'])
})

test('trailing holes are trimmed', () => {
  assert.deepEqual(reconcile(fresh(['a', 'b', 'c']), ['a'], 'k').slots, ['a'])
})

test('a different key lays everything out again', () => {
  const l = reconcile(fresh(['a', 'b', 'c']), ['c', 'b'], 'other')
  assert.deepEqual(l.slots, ['c', 'b'])
  assert.equal(l.key, 'other')
})

test('reconcile does not mutate the previous layout', () => {
  const prev = fresh(['a', 'b', 'c'])
  const snapshot = JSON.stringify([prev.slots, [...prev.mem]])
  reconcile(prev, ['a', 'c', 'd'], 'k')
  assert.equal(JSON.stringify([prev.slots, [...prev.mem]]), snapshot)
})

test('moving onto another cell swaps them', () => {
  assert.deepEqual(moveSlot(fresh(['a', 'b', 'c']), 'a', 2).slots, ['c', 'b', 'a'])
})

test('moving onto a hole leaves a hole behind', () => {
  const holey: Layout = reconcile(fresh(['a', 'b', 'c']), ['a', 'c'], 'k') // [a, _, c]
  assert.deepEqual(moveSlot(holey, 'c', 1).slots, ['a', 'c'])
  assert.deepEqual(moveSlot(holey, 'a', 1).slots, [null, 'a', 'c'])
})

test('moving past the end pads with holes and leaves the old slot empty', () => {
  assert.deepEqual(moveSlot(fresh(['a', 'b']), 'a', 4).slots, [null, 'b', null, null, 'a'])
  assert.deepEqual(moveSlot(fresh(['a', 'b']), 'b', 3).slots, ['a', null, null, 'b'])
})

test('moving to its own slot or moving an unknown id changes nothing', () => {
  const l = fresh(['a', 'b'])
  assert.equal(moveSlot(l, 'a', 0), l)
  assert.equal(moveSlot(l, 'zzz', 1), l)
})

test('a moved cell is remembered at its new slot', () => {
  const moved = moveSlot(fresh(['a', 'b', 'c']), 'a', 2) // [c, b, a]
  const gone = reconcile(moved, ['c', 'b'], 'k') // a leaves
  assert.deepEqual(reconcile(gone, ['c', 'b', 'a'], 'k').slots, ['c', 'b', 'a'])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_IMAGES, checkMessage, claudeContent, opencodeParts, parseImages } from '../server/attachments.ts'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const GIF = Buffer.from('GIF89a......')
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])
const img = (b: Buffer, mediaType: string) => ({ mediaType, data: b.toString('base64') })

test('accepts the four supported types', () => {
  const r = parseImages([img(PNG, 'image/png'), img(JPG, 'image/jpeg'), img(GIF, 'image/gif'), img(WEBP, 'image/webp')])
  assert.equal(r.length, 4)
})
test('no images is fine, a non-list is not', () => {
  assert.deepEqual(parseImages(undefined), [])
  assert.deepEqual(parseImages([]), [])
  assert.throws(() => parseImages('x'), /list/)
})
test('rejects an unsupported type', () => {
  assert.throws(() => parseImages([img(PNG, 'image/svg+xml')]), /only PNG/)
  assert.throws(() => parseImages([{ data: 'AAAA' }]), /only PNG/)
})
test('rejects content that does not match the declared type', () => {
  assert.throws(() => parseImages([img(JPG, 'image/png')]), /not a image\/png/)
  assert.throws(() => parseImages([img(Buffer.from('<script>alert(1)</script>'), 'image/png')]), /not a image\/png/)
})
test('rejects invalid base64, including a data: prefix', () => {
  assert.throws(() => parseImages([{ mediaType: 'image/png', data: 'data:image/png;base64,AAAA' }]), /invalid data/)
  assert.throws(() => parseImages([{ mediaType: 'image/png', data: 'not base64!' }]), /invalid data/)
})
test('limits the number and the size', () => {
  assert.throws(() => parseImages(Array.from({ length: MAX_IMAGES + 1 }, () => img(PNG, 'image/png'))), /At most/)
  const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])
  assert.throws(() => parseImages([img(big, 'image/png')]), /larger than/)
})
test('a message needs text or an image', () => {
  assert.throws(() => checkMessage('  ', []), /empty/)
  assert.doesNotThrow(() => checkMessage('', [img(PNG, 'image/png')]))
  assert.doesNotThrow(() => checkMessage('hi', []))
})
test('claude content stays a string without images and becomes blocks with them', () => {
  assert.equal(claudeContent('hello'), 'hello')
  const c = claudeContent('look', [img(PNG, 'image/png')]) as any[]
  assert.equal(c[0].type, 'image'); assert.equal(c[0].source.media_type, 'image/png'); assert.equal(c[0].source.type, 'base64')
  assert.deepEqual(c[1], { type: 'text', text: 'look' })
  assert.equal((claudeContent('', [img(PNG, 'image/png')]) as any[]).length, 1)
})
test('opencode parts: text then one data-URL file per image', () => {
  const p = opencodeParts('look', [img(PNG, 'image/png'), img(JPG, 'image/jpeg')]) as any[]
  assert.equal(p[0].type, 'text')
  assert.equal(p[1].type, 'file'); assert.match(p[1].url, /^data:image\/png;base64,/); assert.equal(p[1].filename, 'image-1.png')
  assert.equal(p[2].filename, 'image-2.jpg')
  assert.equal(opencodeParts('', [img(PNG, 'image/png')]).length, 1)
})

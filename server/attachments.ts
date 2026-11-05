/** Image attachments for messages: validation and the message shapes each agent expects. Pure, no I/O. */
import type { ImageInput } from '../shared/types.ts'

export const MAX_IMAGES = 5
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // decoded; Claude rejects images above 5 MB
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

/** Magic bytes of each accepted type, so a mislabelled payload is refused instead of forwarded to the agent. */
const sniff = (b: Buffer): string | null =>
  b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png'
  : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
  : b.subarray(0, 4).toString('latin1') === 'GIF8' ? 'image/gif'
  : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp'
  : null

/** Validate untrusted `images` from a request body. Throws a user-facing Error. */
export function parseImages(raw: unknown): ImageInput[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Error('images must be a list')
  if (raw.length > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images per message`)
  return raw.map((x, i) => {
    const mediaType = String((x as any)?.mediaType ?? ''), data = String((x as any)?.data ?? '')
    if (!(IMAGE_TYPES as readonly string[]).includes(mediaType)) throw new Error(`Image ${i + 1}: only PNG, JPEG, GIF and WebP are supported`)
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error(`Image ${i + 1}: invalid data`)
    const bytes = Buffer.from(data, 'base64')
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`Image ${i + 1} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`)
    if (sniff(bytes) !== mediaType) throw new Error(`Image ${i + 1}: the content is not a ${mediaType}`)
    return { mediaType, data }
  })
}

/** A message needs text or at least one image. */
export function checkMessage(text: string, images: ImageInput[]) {
  if (!text.trim() && !images.length) throw new Error('empty message')
}

/** Claude Agent SDK user message content: a plain string, or blocks when there are images. */
export function claudeContent(text: string, images: ImageInput[] = []) {
  if (!images.length) return text
  return [
    ...images.map((im) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: im.mediaType, data: im.data } })),
    ...(text.trim() ? [{ type: 'text' as const, text }] : []),
  ]
}

/** OpenCode prompt parts: text plus one `file` part (data URL) per image. */
export function opencodeParts(text: string, images: ImageInput[] = []) {
  return [
    ...(text.trim() ? [{ type: 'text', text }] : []),
    ...images.map((im, i) => ({ type: 'file', mime: im.mediaType, filename: `image-${i + 1}.${im.mediaType.split('/')[1].replace('jpeg', 'jpg')}`, url: `data:${im.mediaType};base64,${im.data}` })),
  ]
}

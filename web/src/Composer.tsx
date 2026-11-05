import { useEffect, useMemo, useRef, useState } from 'react'
import type { ImageInput, SlashCommandInfo } from '../../shared/types'

const MAX_IMAGES = 5
const MAX_BYTES = 5 * 1024 * 1024 // the server refuses larger images
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export type Attached = ImageInput & { id: number; url: string }

const readB64 = (f: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader(); r.onerror = () => reject(new Error('Could not read the image'))
  r.onload = () => resolve(String(r.result).split(',')[1] ?? ''); r.readAsDataURL(f)
})

/** Screenshots can exceed the size limit: re-encode as JPEG, scaled down, until it fits. */
async function shrink(f: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(f)
  for (const [side, q] of [[2400, 0.88], [1800, 0.8], [1200, 0.75]] as const) {
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height)
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q))
    if (b && b.size <= MAX_BYTES) return b
  }
  throw new Error('The image is too large even after shrinking it')
}

/** Image files on the clipboard. `items` catches copies from a browser or an app that `files` misses. */
export function clipboardImages(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const out = [...dt.files].filter((f) => f.type.startsWith('image/'))
  if (out.length) return out
  return [...dt.items].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter((f): f is File => !!f)
}

let nextId = 1
export async function toAttached(f: File): Promise<Attached> {
  if (!TYPES.includes(f.type)) throw new Error('Only PNG, JPEG, GIF and WebP images can be attached')
  const blob = f.size > MAX_BYTES && f.type !== 'image/gif' ? await shrink(f) : f
  if (blob.size > MAX_BYTES) throw new Error('The image is larger than 5 MB')
  return { id: nextId++, mediaType: blob.type, data: await readB64(blob), url: URL.createObjectURL(blob) }
}

export const strip = (a: Attached[]): ImageInput[] => a.map(({ mediaType, data }) => ({ mediaType, data }))

/**
 * Message box: Enter sends, images can be pasted, dropped or picked, and typing "/" at the start offers the session's
 * slash commands and skills. `commands` is loaded lazily by the parent through `onWantCommands`.
 */
export function Composer({ value, onChange, onSend, placeholder, images, onImages, commands, commandsError, onWantCommands, disabled, rows = 2, enterSends = true }: {
  value: string; onChange: (v: string) => void; onSend: () => void; placeholder: string
  images: Attached[]; onImages: (f: (cur: Attached[]) => Attached[]) => void
  commands?: SlashCommandInfo[] | null; commandsError?: string; onWantCommands?: () => void; disabled?: boolean; rows?: number; enterSends?: boolean
}) {
  const [err, setErr] = useState('')
  const [hi, setHi] = useState(0)
  const [menuOff, setMenuOff] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const mounted = useRef(true); useEffect(() => () => { mounted.current = false }, [])

  const add = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return false
    setErr('')
    for (const f of imgs) {
      try {
        const a = await toAttached(f)
        let over = false
        onImages((cur) => { if (cur.length >= MAX_IMAGES) { over = true; URL.revokeObjectURL(a.url); return cur } return [...cur, a] })
        if (over) { setErr(`At most ${MAX_IMAGES} images per message`); break }
      } catch (e) { if (mounted.current) setErr((e as Error).message) }
    }
    return true
  }

  // Paste works anywhere in the dialog, not only with the cursor inside the box (the box handles its own paste first).
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const f = clipboardImages(e.clipboardData); if (!f.length) return
      e.preventDefault(); void add(f); ta.current?.focus()
    }
    document.addEventListener('paste', h)
    return () => document.removeEventListener('paste', h)
  })

  // Slash menu: only while the whole message is "/word" (before the first space).
  const q = /^\/(\S*)$/.exec(value)?.[1]
  useEffect(() => { if (q !== undefined) onWantCommands?.() }, [q !== undefined])
  useEffect(() => { setHi(0); setMenuOff(false) }, [q])
  const matches = useMemo(() => {
    if (q === undefined || !commands) return []
    const l = q.toLowerCase()
    return commands.filter((c) => c.name.toLowerCase().includes(l)).sort((a, b) => Number(b.name.toLowerCase().startsWith(l)) - Number(a.name.toLowerCase().startsWith(l)) || a.name.localeCompare(b.name)).slice(0, 50)
  }, [q, commands])
  const open = q !== undefined && !menuOff && matches.length > 0
  const showNote = q !== undefined && !menuOff && matches.length === 0 // loading, failed, or nothing matches
  const pick = (c: SlashCommandInfo) => { onChange(`/${c.name} `); ta.current?.focus() }

  return (
    <div className="composer-box"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void add([...e.dataTransfer.files]) } }}>
      {showNote && (
        <ul className="slashmenu" aria-label="Commands and skills"><li className="muted small">
          {commandsError ? `Could not load commands: ${commandsError}` : commands === null || commands === undefined ? 'Loading commands…' : commands.length === 0 ? 'No commands or skills available here' : `No command matches “/${q}”`}
        </li></ul>
      )}
      {open && (
        <ul className="slashmenu" role="listbox" aria-label="Commands and skills">
          {matches.map((c, i) => (
            <li key={c.name} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''} ref={(el) => { if (i === hi) el?.scrollIntoView({ block: 'nearest' }) }}
              onMouseDown={(e) => { e.preventDefault(); pick(c) }} onMouseEnter={() => setHi(i)}>
              <b>/{c.name}</b>{c.hint && <span className="muted small"> {c.hint}</span>}
              {c.description && <span className="muted small desc"> {c.description}</span>}
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <div className="thumbs">
          {images.map((a) => (
            <span key={a.id} className="thumb"><img src={a.url} alt="Attached image" />
              <button type="button" aria-label="Remove image" onClick={() => onImages((cur) => { URL.revokeObjectURL(a.url); return cur.filter((x) => x.id !== a.id) })}>✕</button></span>
          ))}
        </div>
      )}
      <textarea ref={ta} value={value} rows={rows} placeholder={placeholder} disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => { const f = clipboardImages(e.clipboardData); if (f.length) { e.preventDefault(); void add(f) } }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length); return }
            if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); pick(matches[hi]); return }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setMenuOff(true); return }
          }
          if (enterSends && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() }
        }} />
      <div className="attachrow">
        <button type="button" className="linkbtn" onClick={() => file.current?.click()} disabled={disabled || images.length >= MAX_IMAGES}>📎 Attach image</button>
        <span className="muted small">{images.length ? `${images.length}/${MAX_IMAGES} · ` : ''}paste or drop images · type / at the start for commands</span>
        {err && <span className="small attacherr">{err}</span>}
        <input ref={file} type="file" accept={TYPES.join(',')} multiple hidden onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = '' }} />
      </div>
    </div>
  )
}

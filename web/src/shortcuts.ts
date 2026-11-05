/** Keyboard shortcut for "New session": the bare N key. Cmd/Ctrl+N belongs to the browser (new window), so it cannot be used. */
export interface KeyInfo { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; repeat?: boolean; isComposing?: boolean }
export interface KeyContext { targetTag?: string; targetEditable?: boolean; dialogOpen: boolean }

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function opensNewSession(e: KeyInfo, ctx: KeyContext): boolean {
  if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat || e.isComposing) return false
  if (ctx.dialogOpen) return false
  if (ctx.targetEditable || (ctx.targetTag && TYPING.has(ctx.targetTag.toUpperCase()))) return false
  return true
}

import type { TranscriptItem } from '../../shared/types'

/** Tool calls that ask the user something: never hidden, they are the content of the conversation. */
const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode'])

/** Internal activity: tool calls and their results. */
export const isInternal = (m: TranscriptItem) => (m.role === 'tool' && !ASKS.has(m.tool ?? '')) || m.role === 'result'

/** Items to show, and how many internal ones are hidden. */
export function visibleItems(items: TranscriptItem[], showInternal: boolean): { shown: TranscriptItem[]; hidden: number } {
  if (showInternal) return { shown: items, hidden: 0 }
  const shown = items.filter((m) => !isInternal(m))
  return { shown, hidden: items.length - shown.length }
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// "Purge" only hides finished sessions inside ICE. It never touches ~/.claude or the OpenCode
// database (ICE is read-only to them). A purged session comes back if it has new activity.
const FILE = process.env.ICE_STATE_FILE ?? path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state'), 'ice', 'purged.json')

type Purged = Record<string, number> // session id -> lastActivity at purge time

function read(): Purged {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}
function write(p: Purged) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(p))
}

export const isPurged = (p: Purged, s: { id: string; lastActivity: number }) => p[s.id] !== undefined && s.lastActivity <= p[s.id]
export const purgedSet = read

export function purge(sessions: { id: string; lastActivity: number }[]) {
  const p = read()
  for (const s of sessions) p[s.id] = s.lastActivity
  write(p)
  return sessions.length
}
export function restoreAll() { write({}) }

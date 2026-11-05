import os from 'node:os'
import path from 'node:path'

export const HOSTD_PROTOCOL = 3 // bump when the daemon API changes, so a stale daemon is detected
export const STATE_DIR = path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state'), 'ice')
export const SOCKET_PATH = process.env.ICE_HOSTD_SOCKET ?? path.join(STATE_DIR, 'hostd.sock')
export const LOG_PATH = path.join(STATE_DIR, 'hostd.log')

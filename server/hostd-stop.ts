import { call } from './hostclient.ts'
call('POST', '/shutdown', {}).then(() => console.log('ICE host daemon stopped (its sessions ended; transcripts stay)')).catch(() => console.log('ICE host daemon was not running'))

import { ipcMain } from 'electron'
import type { SshConnectResult, SshProfileConnectRequest } from '../../shared/ssh'
import type { SshApi } from './create-ssh-api'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseProfileConnectRequest(value: unknown): SshProfileConnectRequest | undefined {
  if (!isRecord(value) || typeof value.profileId !== 'string') {
    return undefined
  }
  if (typeof value.cols !== 'number' || typeof value.rows !== 'number') {
    return undefined
  }
  const req: SshProfileConnectRequest = {
    profileId: value.profileId,
    cols: value.cols,
    rows: value.rows
  }
  if (typeof value.secret === 'string') {
    req.secret = value.secret
  }
  return req
}

function invalidRequest(): SshConnectResult {
  return { ok: false, reason: 'invalid', message: 'invalid request' }
}

export function registerSshIpc(api: SshApi): void {
  ipcMain.handle('ssh:pickPrivateKey', (event) => api.pickPrivateKey({ id: event.sender.id }))
  ipcMain.handle('ssh:secretRequirement', (_event, profileId: unknown) => {
    if (typeof profileId !== 'string') {
      return { ok: false as const, reason: 'unknown-profile' as const }
    }
    return api.secretRequirement(profileId)
  })
  ipcMain.handle('ssh:connect', (event, req: unknown) => {
    const parsed = parseProfileConnectRequest(req)
    if (parsed === undefined) {
      return invalidRequest()
    }
    return api.connectFromProfile(parsed, { id: event.sender.id })
  })
  ipcMain.handle('ssh:confirmHostKey', (event, sessionId: unknown, action: unknown) => {
    if (typeof sessionId !== 'string' || (action !== 'trust-always' && action !== 'abort')) {
      return invalidRequest()
    }
    return api.confirmHostKey(sessionId, action, { id: event.sender.id })
  })
  ipcMain.handle('ssh:disconnect', (event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') {
      return
    }
    return api.disconnect(sessionId, { id: event.sender.id })
  })
  ipcMain.handle('ssh:cancel', (event, profileId: unknown) => {
    if (typeof profileId !== 'string') {
      return
    }
    return api.cancel(profileId, { id: event.sender.id })
  })
  ipcMain.on('ssh:write', (event, sessionId: unknown, data: unknown) => {
    if (typeof sessionId !== 'string' || !(data instanceof Uint8Array)) {
      return
    }
    api.write(sessionId, data, { id: event.sender.id })
  })
  ipcMain.on('ssh:resize', (event, sessionId: unknown, cols: unknown, rows: unknown) => {
    if (typeof sessionId !== 'string' || typeof cols !== 'number' || typeof rows !== 'number') {
      return
    }
    api.resize(sessionId, cols, rows, { id: event.sender.id })
  })
}

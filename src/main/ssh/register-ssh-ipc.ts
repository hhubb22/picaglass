import { ipcMain } from 'electron'
import type { SshAuth, SshConnectRequest, SshConnectResult } from '../../shared/ssh'
import type { SshApi } from './create-ssh-api'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseAuth(value: unknown): SshAuth | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  if (value.method === 'password' && typeof value.password === 'string') {
    return { method: 'password', password: value.password }
  }
  if (value.method === 'privateKey' && typeof value.keyRef === 'string') {
    if (typeof value.passphrase === 'string') {
      return { method: 'privateKey', keyRef: value.keyRef, passphrase: value.passphrase }
    }
    return { method: 'privateKey', keyRef: value.keyRef }
  }
  return undefined
}

function parseConnectRequest(value: unknown): SshConnectRequest | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  if (typeof value.host !== 'string' || typeof value.username !== 'string') {
    return undefined
  }
  if (typeof value.cols !== 'number' || typeof value.rows !== 'number') {
    return undefined
  }
  const auth = parseAuth(value.auth)
  if (auth === undefined) {
    return undefined
  }
  const req: SshConnectRequest = {
    host: value.host,
    username: value.username,
    auth,
    cols: value.cols,
    rows: value.rows
  }
  if (typeof value.port === 'number') {
    req.port = value.port
  }
  if (typeof value.term === 'string') {
    req.term = value.term
  }
  return req
}

function invalidRequest(): SshConnectResult {
  return { ok: false, reason: 'invalid', message: 'invalid request' }
}

export function registerSshIpc(api: SshApi): void {
  ipcMain.handle('ssh:pickPrivateKey', (event) => api.pickPrivateKey({ id: event.sender.id }))
  ipcMain.handle('ssh:connect', (event, req: unknown) => {
    const parsed = parseConnectRequest(req)
    if (parsed === undefined) {
      return invalidRequest()
    }
    return api.connect(parsed, { id: event.sender.id })
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

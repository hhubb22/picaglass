import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { Client } from 'ssh2'
import type {
  SshAuth,
  SshConnectRequest,
  SshConnectResult,
  SshHostKeyAction,
  SshKeyPick
} from '../../shared/ssh'

export type SshSender = { id: number }

export type SshDialogs = {
  showOpenDialog: (options: {
    title?: string
    defaultPath?: string
    properties?: Array<'openFile'>
  }) => Promise<{ canceled: boolean; filePaths: string[] }>
  showMessageBox: (options: {
    type?: 'question'
    buttons?: string[]
    message: string
    detail?: string
  }) => Promise<{
    response: number
  }>
}

export type CreateSshApiDeps = {
  userDataPath: string
  dialogs: SshDialogs
  emitTo: (senderId: number, channel: string, payload: unknown) => void
}

export type SshApi = {
  pickPrivateKey: (sender: SshSender) => Promise<SshKeyPick | null>
  connect: (req: SshConnectRequest, sender: SshSender) => Promise<SshConnectResult>
  confirmHostKey: (
    sessionId: string,
    action: SshHostKeyAction,
    sender: SshSender
  ) => Promise<SshConnectResult>
  write: (sessionId: string, data: Uint8Array, sender: SshSender) => void
  resize: (sessionId: string, cols: number, rows: number, sender: SshSender) => void
  disconnect: (sessionId: string, sender: SshSender) => Promise<void>
  disposeSender: (senderId: number) => void
  dispose: () => void
}

type PendingSession = {
  senderId: number
  client: Client
  verify: ((valid: boolean) => void) | undefined
}

function invalid(message: string): { ok: false; reason: 'invalid'; message: string } {
  return { ok: false, reason: 'invalid', message }
}

function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

function hostKeyAlgorithm(key: Buffer): string {
  if (key.length < 4) {
    return 'unknown'
  }
  const length = key.readUInt32BE(0)
  if (length < 1 || 4 + length > key.length) {
    return 'unknown'
  }
  return key.subarray(4, 4 + length).toString('ascii')
}

type ParsedConnect =
  | {
      ok: true
      host: string
      port: number
      username: string
      auth: SshAuth
      cols: number
      rows: number
      term?: string
    }
  | { ok: false; reason: 'invalid'; message: string }

function parsePort(
  port: number | undefined
): number | { ok: false; reason: 'invalid'; message: string } {
  if (port === undefined) {
    return 22
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return invalid('port must be 1..65535')
  }
  return port
}

function parseConnect(req: SshConnectRequest): ParsedConnect {
  const host = req.host.trim()
  if (host.length === 0 || host.includes('://') || host.includes('/')) {
    return invalid('invalid host')
  }
  const port = parsePort(req.port)
  if (typeof port !== 'number') {
    return port
  }
  const username = req.username.trim()
  if (username.length === 0) {
    return invalid('invalid username')
  }
  return {
    ok: true,
    host,
    port,
    username,
    auth: req.auth,
    cols: req.cols,
    rows: req.rows,
    term: req.term
  }
}

export function createSshApi(deps: CreateSshApiDeps): SshApi {
  const sessions = new Map<string, PendingSession>()
  const keyFiles = new Map<string, string>()

  function dropSession(sessionId: string): void {
    const session = sessions.get(sessionId)
    if (session === undefined) {
      return
    }
    sessions.delete(sessionId)
    try {
      if (session.verify !== undefined) {
        session.verify(false)
      }
    } finally {
      session.client.end()
    }
  }

  function dropSender(senderId: number): void {
    for (const sessionId of [...sessions.keys()]) {
      const session = sessions.get(sessionId)
      if (session?.senderId === senderId) {
        dropSession(sessionId)
      }
    }
  }

  return {
    async pickPrivateKey() {
      const result = await deps.dialogs.showOpenDialog({
        title: '选择私钥',
        defaultPath: join(homedir(), '.ssh'),
        properties: ['openFile']
      })
      const filePath = result.filePaths[0]
      if (result.canceled || filePath === undefined) {
        return null
      }
      const keyRef = randomUUID()
      keyFiles.set(keyRef, filePath)
      return { keyRef, label: basename(filePath) }
    },

    connect(req, sender) {
      const parsed = parseConnect(req)
      if (parsed.ok !== true) {
        return Promise.resolve(parsed)
      }

      dropSender(sender.id)

      let privateKey: Buffer | undefined
      let passphrase: string | undefined
      if (parsed.auth.method === 'privateKey') {
        const filePath = keyFiles.get(parsed.auth.keyRef)
        if (filePath === undefined) {
          return Promise.resolve(invalid('unknown key'))
        }
        try {
          privateKey = readFileSync(filePath)
        } catch {
          return Promise.resolve(invalid('cannot read key'))
        }
        passphrase = parsed.auth.passphrase
      }

      const sessionId = randomUUID()
      const client = new Client()
      const session: PendingSession = { senderId: sender.id, client, verify: undefined }
      sessions.set(sessionId, session)

      return new Promise((resolve) => {
        let settled = false
        const settle = (result: SshConnectResult): void => {
          if (settled) {
            return
          }
          settled = true
          resolve(result)
        }

        client.on('error', (err: Error) => {
          if (settled) {
            return
          }
          sessions.delete(sessionId)
          settle({ ok: false, reason: 'network', message: err.message })
        })

        try {
          client.connect({
            host: parsed.host,
            port: parsed.port,
            username: parsed.username,
            password: parsed.auth.method === 'password' ? parsed.auth.password : undefined,
            privateKey,
            passphrase,
            readyTimeout: 0,
            hostVerifier: (key, verify) => {
              session.verify = verify
              settle({
                ok: false,
                reason: 'host-unknown',
                sessionId,
                fingerprint: hostKeyFingerprint(key),
                algorithm: hostKeyAlgorithm(key)
              })
            }
          })
        } catch (err) {
          sessions.delete(sessionId)
          const message = err instanceof Error ? err.message : 'cannot connect'
          settle(invalid(message))
        }
      })
    },

    async confirmHostKey(sessionId, action, sender) {
      const session = sessions.get(sessionId)
      if (session === undefined || session.senderId !== sender.id) {
        return invalid('unknown session')
      }
      if (action !== 'abort') {
        return invalid('host not trusted')
      }
      dropSession(sessionId)
      return invalid('aborted')
    },

    write() {
      return
    },

    resize() {
      return
    },

    async disconnect(sessionId, sender) {
      const session = sessions.get(sessionId)
      if (session === undefined || session.senderId !== sender.id) {
        return
      }
      dropSession(sessionId)
    },

    disposeSender(senderId) {
      dropSender(senderId)
    },

    dispose() {
      for (const sessionId of [...sessions.keys()]) {
        dropSession(sessionId)
      }
    }
  }
}

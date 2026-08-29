import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { Client, type ClientChannel } from 'ssh2'
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
    defaultId?: number
    cancelId?: number
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

type SshSession = {
  senderId: number
  client: Client
  verify: ((valid: boolean) => void) | undefined
  host: string
  port: number
  hostKey: Buffer | undefined
  cols: number
  rows: number
  ready: Promise<void>
  stream: ClientChannel | undefined
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

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
}

function knownHostsFile(userDataPath: string): string {
  return join(userDataPath, 'ssh', 'known_hosts')
}

function hostName(host: string, port: number): string {
  if (port === 22) {
    return host
  }
  return `[${host}]:${port}`
}

function parseHostName(name: string): { host: string; port: number } | undefined {
  if (name.startsWith('[')) {
    const close = name.indexOf(']')
    if (close < 2) {
      return undefined
    }
    const host = name.slice(1, close)
    if (name.slice(close + 1, close + 2) !== ':') {
      return { host, port: 22 }
    }
    const port = Number(name.slice(close + 2))
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return undefined
    }
    return { host, port }
  }
  return { host: name, port: 22 }
}

function readKnownHostKey(userDataPath: string, host: string, port: number): Buffer | undefined {
  let text: string
  try {
    text = readFileSync(knownHostsFile(userDataPath), 'utf8')
  } catch (err) {
    if (isEnoent(err)) {
      return undefined
    }
    throw err
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('@')) {
      continue
    }
    const parts = trimmed.split(/\s+/)
    const name = parts[0]
    const b64 = parts[2]
    if (name === undefined || b64 === undefined) {
      continue
    }
    const parsed = parseHostName(name)
    if (parsed === undefined || parsed.host !== host || parsed.port !== port) {
      continue
    }
    return Buffer.from(b64, 'base64')
  }
  return undefined
}

function persistKnownHost(userDataPath: string, host: string, port: number, key: Buffer): void {
  mkdirSync(join(userDataPath, 'ssh'), { recursive: true })
  const line = `${hostName(host, port)} ${hostKeyAlgorithm(key)} ${key.toString('base64')}\n`
  appendFileSync(knownHostsFile(userDataPath), line)
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
  const sessions = new Map<string, SshSession>()
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

  function openShell(sessionId: string): Promise<SshConnectResult> {
    const session = sessions.get(sessionId)
    if (session === undefined) {
      return Promise.resolve(invalid('unknown session'))
    }
    return session.ready.then(
      () =>
        new Promise<SshConnectResult>((resolve) => {
          session.client.shell(
            { term: 'xterm-256color', cols: session.cols, rows: session.rows },
            (err, stream) => {
              if (err) {
                resolve({ ok: false, reason: 'network', message: err.message })
                return
              }
              session.stream = stream
              stream.on('data', (data: Buffer | string) => {
                if (!(data instanceof Uint8Array)) {
                  return
                }
                deps.emitTo(session.senderId, 'ssh:data', {
                  sessionId,
                  chunk: Uint8Array.from(data)
                })
              })
              stream.on('close', () => {
                deps.emitTo(session.senderId, 'ssh:status', {
                  sessionId,
                  type: 'closed'
                })
              })
              deps.emitTo(session.senderId, 'ssh:status', {
                sessionId,
                type: 'connected'
              })
              resolve({ ok: true, sessionId })
            }
          )
        })
    )
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
      let resolveReady = (): void => undefined
      const ready = new Promise<void>((resolve) => {
        resolveReady = resolve
      })
      const session: SshSession = {
        senderId: sender.id,
        client,
        verify: undefined,
        host: parsed.host,
        port: parsed.port,
        hostKey: undefined,
        cols: parsed.cols,
        rows: parsed.rows,
        ready,
        stream: undefined
      }
      sessions.set(sessionId, session)
      client.on('ready', () => {
        resolveReady()
      })

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
              session.hostKey = key
              const known = readKnownHostKey(deps.userDataPath, parsed.host, parsed.port)
              if (known !== undefined && known.equals(key)) {
                verify(true)
                void openShell(sessionId).then(settle)
                return
              }
              if (known !== undefined) {
                verify(false)
                sessions.delete(sessionId)
                settle({
                  ok: false,
                  reason: 'host-changed',
                  fingerprint: hostKeyFingerprint(key),
                  algorithm: hostKeyAlgorithm(key)
                })
                return
              }
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
      if (action === 'abort') {
        dropSession(sessionId)
        return invalid('aborted')
      }
      const options: {
        type: 'question'
        buttons: string[]
        defaultId: number
        cancelId: number
        message: string
        detail?: string
      } = {
        type: 'question',
        buttons: ['是', '否'],
        defaultId: 0,
        cancelId: 1,
        message: '信任这台主机？'
      }
      if (session.hostKey !== undefined) {
        options.detail = hostKeyFingerprint(session.hostKey)
      }
      const box = await deps.dialogs.showMessageBox(options)
      if (box.response !== 0) {
        dropSession(sessionId)
        return invalid('host not trusted')
      }
      if (session.hostKey !== undefined) {
        persistKnownHost(deps.userDataPath, session.host, session.port, session.hostKey)
      }
      if (session.verify !== undefined) {
        session.verify(true)
        session.verify = undefined
      }
      return openShell(sessionId)
    },

    write(sessionId, data, sender) {
      const session = sessions.get(sessionId)
      if (session === undefined || session.senderId !== sender.id || session.stream === undefined) {
        return
      }
      session.stream.write(Buffer.from(data))
    },

    resize(sessionId, cols, rows, sender) {
      const session = sessions.get(sessionId)
      if (session === undefined || session.senderId !== sender.id || session.stream === undefined) {
        return
      }
      session.stream.setWindow(rows, cols, 0, 0)
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

import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { Client, type ClientChannel, utils as ssh2Utils } from 'ssh2'
import type {
  SshAuth,
  SshConnectRequest,
  SshConnectResult,
  SshHostKeyAction,
  SshKeyPick,
  SshProfileConnectRequest,
  SshSecretRequirement
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

export type ResolvedProfile = {
  id: string
  host: string
  port: number
  username: string
  auth: { method: 'password' } | { method: 'privateKey'; filePath: string }
}

export type CreateSshApiDeps = {
  userDataPath: string
  dialogs: SshDialogs
  emitTo: (senderId: number, channel: string, payload: unknown) => void
  authTimeoutMs?: number
  resolveProfile?: (profileId: string) => Promise<ResolvedProfile | undefined>
}

export type SshApi = {
  pickPrivateKey: (sender: SshSender) => Promise<SshKeyPick | null>
  secretRequirement: (profileId: string) => Promise<SshSecretRequirement>
  connect: (req: SshConnectRequest, sender: SshSender) => Promise<SshConnectResult>
  connectFromProfile: (
    req: SshProfileConnectRequest,
    sender: SshSender
  ) => Promise<SshConnectResult>
  confirmHostKey: (
    sessionId: string,
    action: SshHostKeyAction,
    sender: SshSender
  ) => Promise<SshConnectResult>
  write: (sessionId: string, data: Uint8Array, sender: SshSender) => void
  resize: (sessionId: string, cols: number, rows: number, sender: SshSender) => void
  disconnect: (sessionId: string, sender: SshSender) => Promise<void>
  cancel: (profileId: string, sender: SshSender) => Promise<void>
  hasSession: (profileId: string) => boolean
  dropProfileSession: (profileId: string) => void
  disposeSender: (senderId: number) => void
  dispose: () => void
}

type SshReady =
  | { ok: true }
  | {
      ok: false
      reason: 'auth-failed' | 'network' | 'timeout' | 'canceled'
      message: string
    }

type SshSession = {
  senderId: number
  profileId: string
  client: Client
  verify: ((valid: boolean) => void) | undefined
  host: string
  port: number
  hostKey: Buffer | undefined
  cols: number
  rows: number
  ready: Promise<SshReady>
  stream: ClientChannel | undefined
  armAuthTimeout: () => void
  clearAuthTimeout: () => void
  settleOpen: ((result: SshConnectResult) => void) | undefined
  failHandshake: ((result: SshReady & { ok: false }) => void) | undefined
  confirming: boolean
  ended: boolean
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

function readKnownHostKey(
  userDataPath: string,
  host: string,
  port: number
): { ok: true; key: Buffer | undefined } | { ok: false; message: string } {
  let text: string
  try {
    text = readFileSync(knownHostsFile(userDataPath), 'utf8')
  } catch (err) {
    if (isEnoent(err)) {
      return { ok: true, key: undefined }
    }
    const message = err instanceof Error ? err.message : 'cannot read known_hosts'
    return { ok: false, message }
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
    return { ok: true, key: Buffer.from(b64, 'base64') }
  }
  return { ok: true, key: undefined }
}

function persistKnownHost(userDataPath: string, host: string, port: number, key: Buffer): void {
  mkdirSync(join(userDataPath, 'ssh'), { recursive: true })
  const line = `${hostName(host, port)} ${hostKeyAlgorithm(key)} ${key.toString('base64')}\n`
  appendFileSync(knownHostsFile(userDataPath), line)
}

type ParsedConnect =
  | {
      ok: true
      profileId: string
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

function sshClientFailure(err: Error): SshReady & { ok: false } {
  if (!('level' in err) || typeof err.level !== 'string') {
    return { ok: false, reason: 'network', message: err.message }
  }
  if (err.level === 'client-authentication') {
    return { ok: false, reason: 'auth-failed', message: err.message }
  }
  if (err.level === 'client-timeout') {
    return { ok: false, reason: 'timeout', message: err.message }
  }
  return { ok: false, reason: 'network', message: err.message }
}

function privateKeyError(privateKey: Buffer, passphrase: string | undefined): string | undefined {
  const parsed = ssh2Utils.parseKey(privateKey, passphrase)
  if (parsed instanceof Error) {
    return parsed.message
  }
  const key = Array.isArray(parsed) ? parsed[0] : parsed
  if (key === undefined || !key.isPrivateKey()) {
    return 'privateKey value does not contain a (valid) private key'
  }
  return undefined
}

function isMissingPassphrase(message: string): boolean {
  return message.includes('Encrypted') && message.includes('no passphrase given')
}

function isBadPassphrase(message: string): boolean {
  return message.toLowerCase().includes('bad passphrase')
}

function parseConnect(req: SshConnectRequest): ParsedConnect {
  const profileId = req.profileId.trim()
  if (profileId.length === 0) {
    return invalid('invalid profile')
  }
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
    profileId,
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
  const sessionByProfile = new Map<string, string>()
  const keyFiles = new Map<string, { senderId: number; filePath: string }>()
  const authTimeoutMs = deps.authTimeoutMs ?? 20_000

  function forgetSession(sessionId: string): SshSession | undefined {
    const session = sessions.get(sessionId)
    if (session === undefined) {
      return undefined
    }
    sessions.delete(sessionId)
    if (sessionByProfile.get(session.profileId) === sessionId) {
      sessionByProfile.delete(session.profileId)
    }
    return session
  }

  function dropSession(sessionId: string): void {
    const session = forgetSession(sessionId)
    if (session === undefined) {
      return
    }
    session.clearAuthTimeout()
    const closed: SshReady & { ok: false } = {
      ok: false,
      reason: 'network',
      message: 'connection closed'
    }
    session.settleOpen?.(closed)
    session.failHandshake?.(closed)
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

  // Key refs die with the window, not with the session: the form keeps its picked key across
  // reconnects, so dropping a session must leave them alone.
  function forgetKeys(senderId: number): void {
    for (const [keyRef, entry] of [...keyFiles]) {
      if (entry.senderId === senderId) {
        keyFiles.delete(keyRef)
      }
    }
  }

  // A shell ends once, and the first cause wins. ssh2 surfaces a transport failure on the client
  // before it tears the channel down, so a dropped connection reports error; a channel that
  // closes on its own reports closed.
  function endSession(
    sessionId: string,
    session: SshSession,
    outcome: { type: 'closed' } | { type: 'error'; message: string }
  ): void {
    if (session.ended || session.stream === undefined) {
      return
    }
    session.ended = true
    if (outcome.type === 'error') {
      deps.emitTo(session.senderId, 'ssh:status', {
        sessionId,
        profileId: session.profileId,
        type: 'error',
        message: outcome.message
      })
      return
    }
    deps.emitTo(session.senderId, 'ssh:status', {
      sessionId,
      profileId: session.profileId,
      type: 'closed'
    })
  }

  function openShell(sessionId: string): Promise<SshConnectResult> {
    const session = sessions.get(sessionId)
    if (session === undefined) {
      return Promise.resolve(invalid('unknown session'))
    }
    return session.ready.then((outcome) => {
      if (!outcome.ok) {
        dropSession(sessionId)
        return outcome
      }
      return new Promise<SshConnectResult>((resolve) => {
        let finished = false
        const finish = (result: SshConnectResult): void => {
          if (finished) {
            return
          }
          finished = true
          session.settleOpen = undefined
          resolve(result)
        }
        session.settleOpen = finish
        try {
          session.client.shell(
            { term: 'xterm-256color', cols: session.cols, rows: session.rows },
            (err, stream) => {
              if (finished || sessions.get(sessionId) !== session) {
                stream?.destroy()
                return
              }
              if (err) {
                session.clearAuthTimeout()
                finish({ ok: false, reason: 'network', message: err.message })
                dropSession(sessionId)
                return
              }
              session.clearAuthTimeout()
              session.stream = stream
              stream.on('data', (data: Buffer | string) => {
                if (!(data instanceof Uint8Array)) {
                  return
                }
                deps.emitTo(session.senderId, 'ssh:data', {
                  sessionId,
                  profileId: session.profileId,
                  chunk: Uint8Array.from(data)
                })
              })
              stream.on('close', () => {
                endSession(sessionId, session, { type: 'closed' })
                dropSession(sessionId)
              })
              deps.emitTo(session.senderId, 'ssh:status', {
                sessionId,
                profileId: session.profileId,
                type: 'connected'
              })
              finish({ ok: true, sessionId })
            }
          )
        } catch (err) {
          session.clearAuthTimeout()
          const message = err instanceof Error ? err.message : 'cannot open shell'
          finish({ ok: false, reason: 'network', message })
          dropSession(sessionId)
        }
      })
    })
  }

  const api: SshApi = {
    async pickPrivateKey(sender) {
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
      keyFiles.set(keyRef, { senderId: sender.id, filePath })
      return { keyRef, label: basename(filePath) }
    },

    async secretRequirement(profileId) {
      const id = profileId.trim()
      if (id.length === 0 || deps.resolveProfile === undefined) {
        return { ok: false, reason: 'unknown-profile' }
      }
      const profile = await deps.resolveProfile(id)
      if (profile === undefined) {
        return { ok: false, reason: 'unknown-profile' }
      }
      if (profile.auth.method === 'password') {
        return { ok: true, kind: 'password' }
      }
      try {
        const privateKey = readFileSync(profile.auth.filePath)
        const keyError = privateKeyError(privateKey, undefined)
        if (keyError !== undefined && isMissingPassphrase(keyError)) {
          return { ok: true, kind: 'passphrase' }
        }
        if (keyError !== undefined) {
          return { ok: false, reason: 'cannot-read-key' }
        }
        return { ok: true, kind: 'none' }
      } catch {
        return { ok: false, reason: 'cannot-read-key' }
      }
    },

    async connectFromProfile(req, sender) {
      const profileId = req.profileId.trim()
      if (profileId.length === 0) {
        return invalid('invalid profile')
      }
      const resolver = deps.resolveProfile
      if (resolver === undefined) {
        return invalid('unknown profile')
      }
      const profile = await resolver(profileId)
      if (profile === undefined) {
        return invalid('unknown profile')
      }
      if (profile.auth.method === 'password') {
        if (req.secret === undefined || req.secret.length === 0) {
          return { ok: false, reason: 'secret-required', kind: 'password' }
        }
        return api.connect(
          {
            profileId: profile.id,
            host: profile.host,
            port: profile.port,
            username: profile.username,
            auth: { method: 'password', password: req.secret },
            cols: req.cols,
            rows: req.rows
          },
          sender
        )
      }
      const keyRef = randomUUID()
      keyFiles.set(keyRef, { senderId: sender.id, filePath: profile.auth.filePath })
      const auth =
        req.secret !== undefined && req.secret.length > 0
          ? { method: 'privateKey' as const, keyRef, passphrase: req.secret }
          : { method: 'privateKey' as const, keyRef }
      try {
        const result = await api.connect(
          {
            profileId: profile.id,
            host: profile.host,
            port: profile.port,
            username: profile.username,
            auth,
            cols: req.cols,
            rows: req.rows
          },
          sender
        )
        if (!result.ok && result.reason === 'invalid' && isMissingPassphrase(result.message)) {
          return { ok: false, reason: 'secret-required', kind: 'passphrase' }
        }
        if (!result.ok && result.reason === 'invalid' && isBadPassphrase(result.message)) {
          return { ok: false, reason: 'auth-failed', message: result.message }
        }
        return result
      } finally {
        keyFiles.delete(keyRef)
      }
    },

    connect(req, sender) {
      const parsed = parseConnect(req)
      if (parsed.ok !== true) {
        return Promise.resolve(parsed)
      }

      let privateKey: Buffer | undefined
      let passphrase: string | undefined
      if (parsed.auth.method === 'privateKey') {
        const entry = keyFiles.get(parsed.auth.keyRef)
        if (entry === undefined || entry.senderId !== sender.id) {
          return Promise.resolve(invalid('unknown key'))
        }
        try {
          privateKey = readFileSync(entry.filePath)
        } catch {
          return Promise.resolve(invalid('cannot read key'))
        }
        passphrase = parsed.auth.passphrase
        const keyError = privateKeyError(privateKey, passphrase)
        if (keyError !== undefined) {
          return Promise.resolve(invalid(keyError))
        }
      }

      const known = readKnownHostKey(deps.userDataPath, parsed.host, parsed.port)
      if (known.ok !== true) {
        return Promise.resolve(invalid(known.message))
      }

      // Occupancy is per Connection Profile, not per sender: a second connect on a live
      // profile must bounce so the existing SSH Session stays put.
      if (sessionByProfile.has(parsed.profileId)) {
        return Promise.resolve(invalid('session already exists'))
      }

      const sessionId = randomUUID()
      const client = new Client()
      let resolveReady: (outcome: SshReady) => void = () => undefined
      const ready = new Promise<SshReady>((resolve) => {
        resolveReady = resolve
      })
      const settleReady = (outcome: SshReady): void => {
        resolveReady(outcome)
        resolveReady = () => undefined
      }
      const session: SshSession = {
        senderId: sender.id,
        profileId: parsed.profileId,
        client,
        verify: undefined,
        host: parsed.host,
        port: parsed.port,
        hostKey: undefined,
        cols: parsed.cols,
        rows: parsed.rows,
        ready,
        stream: undefined,
        armAuthTimeout: () => undefined,
        clearAuthTimeout: () => undefined,
        settleOpen: undefined,
        failHandshake: undefined,
        confirming: false,
        ended: false
      }
      sessions.set(sessionId, session)
      sessionByProfile.set(parsed.profileId, sessionId)
      client.on('ready', () => {
        settleReady({ ok: true })
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

        let authTimer: ReturnType<typeof setTimeout> | undefined
        const clearAuthTimeout = (): void => {
          if (authTimer !== undefined) {
            clearTimeout(authTimer)
            authTimer = undefined
          }
        }
        session.clearAuthTimeout = clearAuthTimeout
        session.armAuthTimeout = () => {
          clearAuthTimeout()
          if (authTimeoutMs <= 0) {
            return
          }
          authTimer = setTimeout(() => {
            authTimer = undefined
            const failed: SshReady & { ok: false } = {
              ok: false,
              reason: 'timeout',
              message: 'authentication timed out'
            }
            settleReady(failed)
            session.settleOpen?.(failed)
            settle(failed)
            dropSession(sessionId)
          }, authTimeoutMs)
        }
        session.failHandshake = (result) => {
          settleReady(result)
          settle(result)
        }
        session.armAuthTimeout()

        client.on('error', (err: Error) => {
          session.clearAuthTimeout()
          const failed = sshClientFailure(err)
          endSession(sessionId, session, { type: 'error', message: failed.message })
          settleReady(failed)
          session.settleOpen?.(failed)
          settle(failed)
          dropSession(sessionId)
        })
        client.on('close', () => {
          session.clearAuthTimeout()
          const failed: SshReady & { ok: false } = {
            ok: false,
            reason: 'network',
            message: 'connection closed'
          }
          settleReady(failed)
          session.settleOpen?.(failed)
          dropSession(sessionId)
          settle(failed)
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
              if (known.key !== undefined && known.key.equals(key)) {
                verify(true)
                session.armAuthTimeout()
                void openShell(sessionId).then(settle)
                return
              }
              if (known.key !== undefined) {
                session.clearAuthTimeout()
                forgetSession(sessionId)
                settle({
                  ok: false,
                  reason: 'host-changed',
                  fingerprint: hostKeyFingerprint(key),
                  algorithm: hostKeyAlgorithm(key)
                })
                verify(false)
                return
              }
              session.clearAuthTimeout()
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
          session.clearAuthTimeout()
          const message = err instanceof Error ? err.message : 'cannot connect'
          settle({ ok: false, reason: 'network', message })
          dropSession(sessionId)
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
      if (session.verify === undefined || session.confirming) {
        return invalid('unknown session')
      }
      session.confirming = true
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
        defaultId: 1,
        cancelId: 1,
        message: '信任这台主机？'
      }
      if (session.hostKey !== undefined) {
        options.detail = hostKeyFingerprint(session.hostKey)
      }
      try {
        const box = await deps.dialogs.showMessageBox(options)
        const current = sessions.get(sessionId)
        if (current === undefined || current.senderId !== sender.id) {
          return invalid('unknown session')
        }
        if (box.response !== 0) {
          dropSession(sessionId)
          return invalid('host not trusted')
        }
        if (current.hostKey !== undefined) {
          try {
            persistKnownHost(deps.userDataPath, current.host, current.port, current.hostKey)
          } catch (err) {
            dropSession(sessionId)
            const message = err instanceof Error ? err.message : 'cannot save host key'
            return invalid(message)
          }
        }
        if (current.verify !== undefined) {
          current.verify(true)
          current.verify = undefined
          current.armAuthTimeout()
        }
        return openShell(sessionId)
      } catch (err) {
        dropSession(sessionId)
        const message = err instanceof Error ? err.message : 'trust dialog failed'
        return invalid(message)
      } finally {
        const current = sessions.get(sessionId)
        if (current !== undefined) {
          current.confirming = false
        }
      }
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
      if (session === undefined || session.senderId !== sender.id) {
        return
      }
      session.cols = cols
      session.rows = rows
      if (session.stream !== undefined) {
        session.stream.setWindow(rows, cols, 0, 0)
      }
    },

    async disconnect(sessionId, sender) {
      const session = sessions.get(sessionId)
      if (session === undefined || session.senderId !== sender.id) {
        return
      }
      dropSession(sessionId)
    },

    async cancel(profileId, sender) {
      const sessionId = sessionByProfile.get(profileId.trim())
      if (sessionId === undefined) {
        return
      }
      const session = sessions.get(sessionId)
      if (session === undefined || session.senderId !== sender.id) {
        return
      }
      if (session.stream !== undefined) {
        return
      }
      const canceled: SshReady & { ok: false } = {
        ok: false,
        reason: 'canceled',
        message: 'canceled'
      }
      session.settleOpen?.(canceled)
      session.failHandshake?.(canceled)
      dropSession(sessionId)
    },

    hasSession(profileId) {
      return sessionByProfile.has(profileId.trim())
    },

    dropProfileSession(profileId) {
      const sessionId = sessionByProfile.get(profileId.trim())
      if (sessionId === undefined) {
        return
      }
      dropSession(sessionId)
    },

    disposeSender(senderId) {
      dropSender(senderId)
      forgetKeys(senderId)
    },

    dispose() {
      for (const sessionId of [...sessions.keys()]) {
        dropSession(sessionId)
      }
      keyFiles.clear()
    }
  }
  return api
}

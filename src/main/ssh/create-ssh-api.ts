import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { Client, type ClientChannel, utils as ssh2Utils } from 'ssh2'
import {
  MACHINE_SNAPSHOT_COMMAND,
  MACHINE_SNAPSHOT_OUTPUT_CAP_BYTES,
  MACHINE_SNAPSHOT_TIMEOUT_MS,
  applyDiscoveryRun,
  interpretDiscoveryOutput,
  type MachineSnapshot
} from '../../shared/machine-snapshot'
import type {
  ForgetHostKeyResult,
  HostTrustState,
  SshAuth,
  SshConnectRequest,
  SshConnectResult,
  SshHostKeyAction,
  SshKeyPick,
  SshProfileConnectRequest,
  SshSecretRequirement
} from '../../shared/ssh'
import type {
  ConnectionAttemptOutcome,
  ConnectionAttemptSummary
} from '../../shared/connection-attempt'

export type SshSender = { id: number }

export type SshDialogs = {
  showOpenDialog: (options: {
    title?: string
    defaultPath?: string
    properties?: Array<'openFile'>
  }) => Promise<{ canceled: boolean; filePaths: string[] }>
}

export type ResolvedProfile = {
  id: string
  host: string
  port: number
  username: string
  auth: { method: 'password' } | { method: 'privateKey'; filePath: string }
  automaticDiscovery: boolean
}

export type CreateSshApiDeps = {
  userDataPath: string
  dialogs: SshDialogs
  emitTo: (senderId: number, channel: string, payload: unknown) => void
  authTimeoutMs?: number
  discoveryTimeoutMs?: number
  resolveProfile?: (profileId: string) => Promise<ResolvedProfile | undefined>
  now?: () => Date
  recordAttempt?: (profileId: string, summary: ConnectionAttemptSummary) => Promise<void>
  readSnapshot?: (profileId: string) => Promise<MachineSnapshot | undefined>
  recordSnapshot?: (profileId: string, snapshot: MachineSnapshot) => Promise<void>
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
  hostTrust: (host: string, port: number) => Promise<HostTrustState>
  forgetHostKey: (host: string, port: number) => Promise<ForgetHostKeyResult>
  write: (sessionId: string, data: Uint8Array, sender: SshSender) => void
  resize: (sessionId: string, cols: number, rows: number, sender: SshSender) => void
  disconnect: (sessionId: string, sender: SshSender) => Promise<void>
  cancel: (profileId: string, sender: SshSender) => Promise<void>
  disconnectAll: (sender: SshSender) => Promise<void>
  activeSessionCount: (sender?: SshSender) => number
  refreshDiscovery: (profileId: string, sender: SshSender) => Promise<void>
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
  pendingTrust: 'unknown' | 'changed' | undefined
  confirming: boolean
  ended: boolean
  attemptStartedAt: string
  attemptConnectedAt: string | undefined
  attemptFinalized: boolean
  operatorDisconnect: boolean
  autoDiscoveryStarted: boolean
  discoveryInFlight: boolean
  discoveryStream: ClientChannel | undefined
  discoveryTimer: ReturnType<typeof setTimeout> | undefined
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

function parseKnownHostLine(line: string): { host: string; port: number } | undefined {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('@')) {
    return undefined
  }
  const name = trimmed.split(/\s+/)[0]
  if (name === undefined) {
    return undefined
  }
  return parseHostName(name)
}

function readKnownHostsText(
  userDataPath: string
): { ok: true; text: string } | { ok: false; message: string } {
  try {
    return { ok: true, text: readFileSync(knownHostsFile(userDataPath), 'utf8') }
  } catch (err) {
    if (isEnoent(err)) {
      return { ok: true, text: '' }
    }
    const message = err instanceof Error ? err.message : 'cannot read known_hosts'
    return { ok: false, message }
  }
}

function knownHostLinesWithoutEndpoint(text: string, host: string, port: number): string[] {
  const kept: string[] = []
  for (const line of text.split('\n')) {
    const parsed = parseKnownHostLine(line)
    if (parsed !== undefined && parsed.host === host && parsed.port === port) {
      continue
    }
    kept.push(line)
  }
  while (kept.length > 0 && kept[kept.length - 1] === '') {
    kept.pop()
  }
  return kept
}

function writeKnownHosts(userDataPath: string, lines: string[]): void {
  mkdirSync(join(userDataPath, 'ssh'), { recursive: true })
  const body = lines.length === 0 ? '' : `${lines.join('\n')}\n`
  writeFileSync(knownHostsFile(userDataPath), body)
}

function readKnownHostKey(
  userDataPath: string,
  host: string,
  port: number
): { ok: true; key: Buffer | undefined } | { ok: false; message: string } {
  const loaded = readKnownHostsText(userDataPath)
  if (loaded.ok !== true) {
    return loaded
  }
  for (const line of loaded.text.split('\n')) {
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
  const loaded = readKnownHostsText(userDataPath)
  if (loaded.ok !== true) {
    throw new Error(loaded.message)
  }
  const lines = knownHostLinesWithoutEndpoint(loaded.text, host, port)
  lines.push(`${hostName(host, port)} ${hostKeyAlgorithm(key)} ${key.toString('base64')}`)
  writeKnownHosts(userDataPath, lines)
}

function forgetKnownHost(userDataPath: string, host: string, port: number): void {
  const loaded = readKnownHostsText(userDataPath)
  if (loaded.ok !== true) {
    throw new Error(loaded.message)
  }
  if (loaded.text.length === 0) {
    return
  }
  writeKnownHosts(userDataPath, knownHostLinesWithoutEndpoint(loaded.text, host, port))
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
  const sessionTrust = new Map<
    string,
    { key: Buffer; algorithm: string; fingerprint: string; holders: Set<string> }
  >()
  const authTimeoutMs = deps.authTimeoutMs ?? 20_000

  function isoNow(): string {
    return (deps.now?.() ?? new Date()).toISOString()
  }

  function attemptSnapshot(
    session: SshSession,
    extra: { ended?: boolean; outcome?: ConnectionAttemptOutcome }
  ): ConnectionAttemptSummary {
    const summary: ConnectionAttemptSummary = { startedAt: session.attemptStartedAt }
    if (session.attemptConnectedAt !== undefined) {
      summary.connectedAt = session.attemptConnectedAt
    }
    if (extra.ended === true) {
      summary.endedAt = isoNow()
    }
    if (extra.outcome !== undefined) {
      summary.outcome = extra.outcome
    }
    return summary
  }

  async function persistAttempt(
    session: SshSession,
    summary: ConnectionAttemptSummary
  ): Promise<void> {
    if (deps.recordAttempt === undefined) {
      return
    }
    try {
      await deps.recordAttempt(session.profileId, summary)
    } catch {
      // Persistence is best-effort: a failed write must not drop or block the SSH Session.
    }
  }

  async function finalizeAttempt(
    session: SshSession,
    outcome: ConnectionAttemptOutcome
  ): Promise<void> {
    if (session.attemptFinalized) {
      return
    }
    session.attemptFinalized = true
    await persistAttempt(session, attemptSnapshot(session, { ended: true, outcome }))
  }

  function outcomeFromHandshakeFailure(
    reason: 'auth-failed' | 'network' | 'timeout' | 'canceled'
  ): ConnectionAttemptOutcome {
    if (reason === 'auth-failed') {
      return 'authentication-failed'
    }
    if (reason === 'timeout') {
      return 'timed-out'
    }
    if (reason === 'canceled') {
      return 'canceled'
    }
    return 'network-failed'
  }

  function endpointKey(host: string, port: number): string {
    return `${host}\n${port}`
  }

  function clearSessionTrust(host: string, port: number): void {
    sessionTrust.delete(endpointKey(host, port))
  }

  function grantSessionTrust(sessionId: string, session: SshSession): void {
    if (session.hostKey === undefined) {
      return
    }
    const id = endpointKey(session.host, session.port)
    const existing = sessionTrust.get(id)
    if (existing !== undefined && existing.key.equals(session.hostKey)) {
      existing.holders.add(sessionId)
      return
    }
    sessionTrust.set(id, {
      key: session.hostKey,
      algorithm: hostKeyAlgorithm(session.hostKey),
      fingerprint: hostKeyFingerprint(session.hostKey),
      holders: new Set([sessionId])
    })
  }

  function releaseSessionTrust(sessionId: string, session: SshSession): void {
    const id = endpointKey(session.host, session.port)
    const existing = sessionTrust.get(id)
    if (existing === undefined) {
      return
    }
    existing.holders.delete(sessionId)
    if (existing.holders.size === 0) {
      sessionTrust.delete(id)
    }
  }

  function forgetSession(sessionId: string): SshSession | undefined {
    const session = sessions.get(sessionId)
    if (session === undefined) {
      return undefined
    }
    sessions.delete(sessionId)
    if (sessionByProfile.get(session.profileId) === sessionId) {
      sessionByProfile.delete(session.profileId)
    }
    releaseSessionTrust(sessionId, session)
    return session
  }

  function dropSession(sessionId: string): void {
    const session = forgetSession(sessionId)
    if (session === undefined) {
      return
    }
    session.clearAuthTimeout()
    abortDiscovery(session)
    // A live shell without a recorded end stays on disk so launch recovery can
    // mark it interrupted. Handshake failures already finalized their outcome.
    if (!session.attemptFinalized && session.stream !== undefined) {
      session.attemptFinalized = true
    }
    if (!session.attemptFinalized) {
      const closed: SshReady & { ok: false } = {
        ok: false,
        reason: 'network',
        message: 'connection closed'
      }
      session.settleOpen?.(closed)
      session.failHandshake?.(closed)
    }
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
    const attemptOutcome: ConnectionAttemptOutcome = session.operatorDisconnect
      ? 'operator-disconnected'
      : outcome.type === 'error'
        ? 'network-failed'
        : 'remote-session-ended'
    void finalizeAttempt(session, attemptOutcome).finally(() => {
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
                void finalizeAttempt(session, 'network-failed').finally(() => {
                  finish({ ok: false, reason: 'network', message: err.message })
                })
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
              session.attemptConnectedAt = isoNow()
              void persistAttempt(session, attemptSnapshot(session, {})).finally(() => {
                deps.emitTo(session.senderId, 'ssh:status', {
                  sessionId,
                  profileId: session.profileId,
                  type: 'connected'
                })
                finish({ ok: true, sessionId })
                void startAutoDiscovery(sessionId)
              })
            }
          )
        } catch (err) {
          session.clearAuthTimeout()
          const message = err instanceof Error ? err.message : 'cannot open shell'
          void finalizeAttempt(session, 'network-failed').finally(() => {
            finish({ ok: false, reason: 'network', message })
          })
          dropSession(sessionId)
        }
      })
    })
  }

  function abortDiscovery(session: SshSession): void {
    if (session.discoveryTimer !== undefined) {
      clearTimeout(session.discoveryTimer)
      session.discoveryTimer = undefined
    }
    const stream = session.discoveryStream
    session.discoveryStream = undefined
    if (stream !== undefined) {
      try {
        stream.destroy()
      } catch {
        // Discovery-channel teardown must never take down the SSH Session.
      }
    }
    session.discoveryInFlight = false
  }

  async function startAutoDiscovery(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId)
    if (session === undefined || session.autoDiscoveryStarted) {
      return
    }
    session.autoDiscoveryStarted = true
    const profile = await deps.resolveProfile?.(session.profileId)
    if (profile === undefined || profile.automaticDiscovery !== true) {
      return
    }
    await runDiscovery(sessionId)
  }

  async function runDiscovery(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId)
    if (session === undefined || session.stream === undefined || session.discoveryInFlight) {
      return
    }
    session.discoveryInFlight = true
    const timeoutMs = deps.discoveryTimeoutMs ?? MACHINE_SNAPSHOT_TIMEOUT_MS
    const collected = await new Promise<{
      stdout: Buffer
      stderr: Buffer
    }>((resolve) => {
      const buffers: { stdout: Buffer; stderr: Buffer; total: number } = {
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        total: 0
      }
      let settled = false
      const finish = (): void => {
        if (settled) {
          return
        }
        settled = true
        if (session.discoveryTimer !== undefined) {
          clearTimeout(session.discoveryTimer)
          session.discoveryTimer = undefined
        }
        const stream = session.discoveryStream
        session.discoveryStream = undefined
        if (stream !== undefined) {
          try {
            stream.destroy()
          } catch {
            // Isolation: destroying the exec channel must not end the client.
          }
        }
        resolve({ stdout: buffers.stdout, stderr: buffers.stderr })
      }
      const take = (chunk: Uint8Array, dest: Buffer): Buffer => {
        if (settled) {
          return dest
        }
        const remaining = MACHINE_SNAPSHOT_OUTPUT_CAP_BYTES - buffers.total
        if (remaining <= 0) {
          finish()
          return dest
        }
        const source = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk
        buffers.total += source.byteLength
        const next = Buffer.concat([dest, source]) as Buffer
        if (chunk.byteLength > remaining) {
          finish()
        }
        return next
      }
      try {
        session.client.exec(MACHINE_SNAPSHOT_COMMAND, { pty: false }, (err, stream) => {
          if (settled) {
            stream?.destroy()
            return
          }
          if (sessions.get(sessionId) !== session || err) {
            finish()
            return
          }
          session.discoveryStream = stream
          stream.on('data', (data: Buffer | string) => {
            if (data instanceof Uint8Array) {
              buffers.stdout = take(data, buffers.stdout)
            }
          })
          if (stream.stderr !== undefined) {
            stream.stderr.on('data', (data: Buffer | string) => {
              if (data instanceof Uint8Array) {
                buffers.stderr = take(data, buffers.stderr)
              }
            })
          }
          stream.on('close', () => {
            finish()
          })
          stream.on('error', () => {
            finish()
          })
        })
      } catch {
        finish()
      }
      session.discoveryTimer = setTimeout(() => {
        finish()
      }, timeoutMs)
    })

    session.discoveryInFlight = false
    if (sessions.get(sessionId) !== session) {
      return
    }
    const run = interpretDiscoveryOutput({
      stdout: collected.stdout.toString('utf8'),
      stderr: collected.stderr.toString('utf8')
    })
    const previous = await deps.readSnapshot?.(session.profileId)
    if (sessions.get(sessionId) !== session) {
      return
    }
    const snapshot = applyDiscoveryRun(previous, run, new Date().toISOString())
    try {
      await deps.recordSnapshot?.(session.profileId, snapshot)
    } catch {
      // Persistence failure still surfaces the in-memory snapshot.
    }
    deps.emitTo(session.senderId, 'ssh:snapshot', { profileId: session.profileId, snapshot })
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
        pendingTrust: undefined,
        confirming: false,
        ended: false,
        attemptStartedAt: isoNow(),
        attemptConnectedAt: undefined,
        attemptFinalized: false,
        operatorDisconnect: false,
        autoDiscoveryStarted: false,
        discoveryInFlight: false,
        discoveryStream: undefined,
        discoveryTimer: undefined
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
          // Resolve outside ssh2's socket callback so Electron IPC delivers the invoke reply.
          queueMicrotask(() => {
            resolve(result)
          })
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
            void finalizeAttempt(session, 'timed-out').finally(() => {
              settle(failed)
            })
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
          if (session.stream !== undefined) {
            endSession(sessionId, session, { type: 'error', message: failed.message })
            settleReady(failed)
            session.settleOpen?.(failed)
            settle(failed)
            dropSession(sessionId)
            return
          }
          settleReady(failed)
          session.settleOpen?.(failed)
          void finalizeAttempt(session, outcomeFromHandshakeFailure(failed.reason)).finally(() => {
            settle(failed)
          })
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
          if (session.stream === undefined && !session.attemptFinalized) {
            void finalizeAttempt(session, 'network-failed').finally(() => {
              settle(failed)
            })
          } else if (!session.attemptFinalized) {
            settle(failed)
          }
          dropSession(sessionId)
        })

        const pauseHostTrust = (
          presented: Buffer,
          previous: Buffer | undefined,
          verify: (valid: boolean) => void
        ): void => {
          session.clearAuthTimeout()
          session.verify = verify
          if (previous !== undefined) {
            session.pendingTrust = 'changed'
            settle({
              ok: false,
              reason: 'host-changed',
              sessionId,
              fingerprint: hostKeyFingerprint(presented),
              algorithm: hostKeyAlgorithm(presented),
              previousFingerprint: hostKeyFingerprint(previous),
              previousAlgorithm: hostKeyAlgorithm(previous)
            })
            return
          }
          session.pendingTrust = 'unknown'
          settle({
            ok: false,
            reason: 'host-unknown',
            sessionId,
            fingerprint: hostKeyFingerprint(presented),
            algorithm: hostKeyAlgorithm(presented)
          })
        }

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
              const once = sessionTrust.get(endpointKey(parsed.host, parsed.port))
              if (known.key !== undefined && known.key.equals(key)) {
                verify(true)
                session.armAuthTimeout()
                void openShell(sessionId).then(settle)
                return
              }
              if (known.key !== undefined) {
                pauseHostTrust(key, known.key, verify)
                return
              }
              if (once !== undefined && once.key.equals(key)) {
                once.holders.add(sessionId)
                verify(true)
                session.armAuthTimeout()
                void openShell(sessionId).then(settle)
                return
              }
              if (once !== undefined) {
                pauseHostTrust(key, once.key, verify)
                return
              }
              pauseHostTrust(key, undefined, verify)
            }
          })
        } catch (err) {
          session.clearAuthTimeout()
          const message = err instanceof Error ? err.message : 'cannot connect'
          void finalizeAttempt(session, 'network-failed').finally(() => {
            settle({ ok: false, reason: 'network', message })
          })
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
        const outcome: ConnectionAttemptOutcome =
          session.pendingTrust === 'changed' ? 'host-key-rejected' : 'canceled'
        await finalizeAttempt(session, outcome)
        dropSession(sessionId)
        return { ok: false, reason: 'canceled', message: 'canceled' }
      }
      if (session.verify === undefined || session.confirming) {
        return invalid('unknown session')
      }
      if (action === 'replace') {
        if (session.pendingTrust !== 'changed') {
          return invalid('unknown session')
        }
      } else if (action === 'trust-once' || action === 'trust-always') {
        if (session.pendingTrust !== 'unknown') {
          return invalid('unknown session')
        }
      } else {
        return invalid('unknown session')
      }
      session.confirming = true
      try {
        // The renderer already collected the in-app Host Trust decision; apply it here.
        const current = sessions.get(sessionId)
        if (current === undefined || current.senderId !== sender.id) {
          return invalid('unknown session')
        }
        if (action === 'trust-always' || action === 'replace') {
          if (current.hostKey === undefined) {
            dropSession(sessionId)
            return invalid('unknown session')
          }
          try {
            persistKnownHost(deps.userDataPath, current.host, current.port, current.hostKey)
          } catch (err) {
            dropSession(sessionId)
            const message = err instanceof Error ? err.message : 'cannot save host key'
            return invalid(message)
          }
          clearSessionTrust(current.host, current.port)
        }
        if (action === 'trust-once') {
          grantSessionTrust(sessionId, current)
        }
        if (current.verify !== undefined) {
          current.verify(true)
          current.verify = undefined
          current.pendingTrust = undefined
          current.armAuthTimeout()
        }
        return openShell(sessionId)
      } finally {
        const current = sessions.get(sessionId)
        if (current !== undefined) {
          current.confirming = false
        }
      }
    },

    async hostTrust(host, port) {
      const trimmed = host.trim()
      if (trimmed.length === 0 || trimmed.includes('://') || trimmed.includes('/')) {
        return { status: 'not-remembered' }
      }
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { status: 'not-remembered' }
      }
      const known = readKnownHostKey(deps.userDataPath, trimmed, port)
      if (known.ok !== true) {
        return { status: 'not-remembered' }
      }
      if (known.key !== undefined) {
        return {
          status: 'remembered',
          algorithm: hostKeyAlgorithm(known.key),
          fingerprint: hostKeyFingerprint(known.key)
        }
      }
      const once = sessionTrust.get(endpointKey(trimmed, port))
      if (once !== undefined) {
        return {
          status: 'session',
          algorithm: once.algorithm,
          fingerprint: once.fingerprint
        }
      }
      return { status: 'not-remembered' }
    },

    async forgetHostKey(host, port) {
      const trimmed = host.trim()
      if (trimmed.length === 0 || trimmed.includes('://') || trimmed.includes('/')) {
        return { ok: false, message: 'invalid host' }
      }
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { ok: false, message: 'invalid port' }
      }
      try {
        forgetKnownHost(deps.userDataPath, trimmed, port)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'cannot update known_hosts'
        return { ok: false, message }
      }
      clearSessionTrust(trimmed, port)
      return { ok: true }
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
      session.operatorDisconnect = true
      if (session.stream !== undefined) {
        await finalizeAttempt(session, 'operator-disconnected')
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
      await finalizeAttempt(session, 'canceled')
      session.settleOpen?.(canceled)
      session.failHandshake?.(canceled)
      dropSession(sessionId)
    },

    async disconnectAll(sender) {
      const owned = [...sessions.entries()].filter(([, session]) => session.senderId === sender.id)
      for (const [sessionId, session] of owned) {
        if (sessions.get(sessionId) !== session) {
          continue
        }
        if (session.stream !== undefined) {
          session.operatorDisconnect = true
          await finalizeAttempt(session, 'operator-disconnected')
        } else {
          const canceled: SshReady & { ok: false } = {
            ok: false,
            reason: 'canceled',
            message: 'canceled'
          }
          await finalizeAttempt(session, 'canceled')
          session.settleOpen?.(canceled)
          session.failHandshake?.(canceled)
        }
        dropSession(sessionId)
      }
    },

    activeSessionCount(sender) {
      let count = 0
      for (const session of sessions.values()) {
        if (sender !== undefined && session.senderId !== sender.id) {
          continue
        }
        count += 1
      }
      return count
    },

    async refreshDiscovery(profileId, sender) {
      const sessionId = sessionByProfile.get(profileId.trim())
      if (sessionId === undefined) {
        return
      }
      const session = sessions.get(sessionId)
      if (session === undefined || session.senderId !== sender.id || session.stream === undefined) {
        return
      }
      await runDiscovery(sessionId)
    },

    hasSession(profileId) {
      return sessionByProfile.has(profileId.trim())
    },

    dropProfileSession(profileId) {
      const sessionId = sessionByProfile.get(profileId.trim())
      if (sessionId === undefined) {
        return
      }
      const session = sessions.get(sessionId)
      if (session !== undefined) {
        if (session.stream !== undefined) {
          session.operatorDisconnect = true
          void finalizeAttempt(session, 'operator-disconnected')
        } else {
          void finalizeAttempt(session, 'canceled')
        }
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
      sessionTrust.clear()
      keyFiles.clear()
    }
  }
  return api
}

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'ssh2'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SshApi } from './create-ssh-api'
import { createSshEventInbox } from '../../shared/ssh-event-inbox'
import { runSshConnect, syncSshConnectInbox } from '../../shared/ssh-connect-ui'
import {
  type CapturedEmit,
  type TestProxy,
  type TestServer,
  connectRequest,
  dataChunk,
  emitsHaveChunk,
  generateHostKey,
  isRecord,
  listenTcp,
  neverSettles,
  startServer,
  statusTypes,
  tcpProxy,
  testApi,
  testApiWithInbox
} from './ssh-test-fixture'

describe('createSshApi session', () => {
  let userDataPath: string | undefined
  let api: SshApi | undefined
  let server: TestServer | undefined
  let tcp: { port: number; close: () => Promise<void> } | undefined
  let proxy: TestProxy | undefined

  afterEach(async () => {
    api?.dispose()
    api = undefined
    if (proxy) {
      await proxy.close()
      proxy = undefined
    }
    if (server) {
      await server.close()
      server = undefined
    }
    if (tcp) {
      await tcp.close()
      tcp = undefined
    }
    if (userDataPath) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = undefined
    }
  })

  it('ssh:data delivers invalid UTF-8 bytes after clone', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    api = testApi(
      userDataPath,
      {
        showMessageBox: async () => ({ response: 0 })
      },
      emits
    )

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected a live session')
    }

    const expected = Uint8Array.from([0xff, 0xfe, 0x00, 0x61])
    const utf8RoundTrip = Buffer.from(Buffer.from(expected).toString('utf8'), 'utf8')
    expect(utf8RoundTrip.equals(Buffer.from(expected))).toBe(false)

    const chunk = await vi.waitFor(() => {
      const received = dataChunk(emits)
      if (received === undefined) {
        throw new Error('no ssh:data yet')
      }
      return received
    })

    expect(chunk).toEqual(expected)
    expect(JSON.stringify(emits.map((event) => event.payload))).not.toContain(
      'BEGIN OPENSSH PRIVATE KEY'
    )
    expect(JSON.stringify(emits.map((event) => event.payload))).not.toContain(
      'BEGIN RSA PRIVATE KEY'
    )
  })

  it('first pty bytes emitted before connect returns still reach the terminal', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const chunks: Uint8Array[] = []
    const inbox = createSshEventInbox({
      onData: (_id, chunk) => {
        chunks.push(Uint8Array.from(chunk))
      },
      onStatus: () => undefined
    })
    api = testApiWithInbox(userDataPath, inbox, {
      showMessageBox: async () => ({ response: 0 })
    })

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected trust-always to succeed')
    }
    await api.disconnect(unknown.sessionId, { id: 1 })
    inbox.deactivate()
    chunks.length = 0

    inbox.beginHandoff()
    const again = await api.connect(connectRequest(server.port), { id: 1 })
    if (!again.ok) {
      throw new Error('expected a live session')
    }
    inbox.activate(again.sessionId)

    await vi.waitFor(() => {
      if (chunks.length === 0) {
        throw new Error('terminal empty after connect')
      }
    })

    expect(chunks[0]).toEqual(Uint8Array.from([0xff, 0xfe, 0x00, 0x61]))
  })

  it('first pty bytes emitted before trust-always returns still reach the terminal', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const chunks: Uint8Array[] = []
    const inbox = createSshEventInbox({
      onData: (_id, chunk) => {
        chunks.push(Uint8Array.from(chunk))
      },
      onStatus: () => undefined
    })
    api = testApiWithInbox(userDataPath, inbox, {
      showMessageBox: async () => ({ response: 0 })
    })

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    inbox.beginHandoff()
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected a live session')
    }
    inbox.activate(trusted.sessionId)

    await vi.waitFor(() => {
      if (chunks.length === 0) {
        throw new Error('terminal empty after trust-always')
      }
    })

    expect(chunks[0]).toEqual(Uint8Array.from([0xff, 0xfe, 0x00, 0x61]))
  })

  it('a second connect from the same sender settles the first handshake', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    tcp = await listenTcp(() => undefined)
    api = testApi(userDataPath)

    const first = api.connect(connectRequest(tcp.port), { id: 1 })
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
    void api.connect(connectRequest(tcp.port), { id: 1 })

    const firstResult = await Promise.race([
      first,
      neverSettles('first connect hung after dropSender')
    ])
    expect(firstResult).toEqual({
      ok: false,
      reason: 'network',
      message: expect.any(String)
    })
  })

  it('a second trust-always on the same session does not open a second shell', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    let messageBoxes = 0
    api = testApi(userDataPath, {
      showMessageBox: async () => {
        messageBoxes += 1
        return { response: 0 }
      }
    })

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }

    const first = api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    const second = api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    const results = await Promise.all([first, second])

    expect(messageBoxes).toBe(1)
    expect(server.shellCount()).toBe(1)
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)
  })

  it('an invalid reconnect does not drop the live session', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath, { showMessageBox: async () => ({ response: 0 }) })

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected a live session')
    }

    const rejected = await api.connect(
      { ...connectRequest(server.port), username: '   ' },
      { id: 1 }
    )

    expect(rejected).toEqual({
      ok: false,
      reason: 'invalid',
      message: expect.any(String)
    })
    expect(server.shellCount()).toBe(1)

    const rejectedKey = await api.connect(
      connectRequest(server.port, { method: 'privateKey', keyRef: 'missing' }),
      { id: 1 }
    )
    expect(rejectedKey).toEqual({
      ok: false,
      reason: 'invalid',
      message: expect.any(String)
    })
    expect(server.shellCount()).toBe(1)

    await api.disconnect(trusted.sessionId, { id: 1 })
    const leftover = await api.confirmHostKey(trusted.sessionId, 'abort', { id: 1 })
    expect(leftover).toEqual({ ok: false, reason: 'invalid', message: 'unknown session' })
  })

  it('a late shell success after timeout does not emit connected', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    const originalShell = Client.prototype.shell
    let deliverShell: (() => void) | undefined
    Object.defineProperty(Client.prototype, 'shell', {
      configurable: true,
      writable: true,
      value: function delayedShell(this: Client, ...args: unknown[]) {
        const index = args.findIndex((arg) => typeof arg === 'function')
        const callback = args[index]
        if (index < 0 || typeof callback !== 'function') {
          throw new Error('shell callback required')
        }
        args[index] = (err: Error | undefined, stream: unknown) => {
          deliverShell = () => {
            callback(err, stream)
          }
        }
        return Reflect.apply(originalShell, this, args)
      }
    })
    api = testApi(userDataPath, { showMessageBox: async () => ({ response: 0 }) }, emits, {
      authTimeoutMs: 80
    })

    try {
      const unknown = await api.connect(connectRequest(server.port), { id: 1 })
      if (unknown.ok || unknown.reason !== 'host-unknown') {
        throw new Error('expected host-unknown')
      }

      const trusted = await Promise.race([
        api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 }),
        neverSettles('confirmHostKey hung waiting for delayed shell')
      ])

      expect(trusted).toEqual({
        ok: false,
        reason: 'timeout',
        message: expect.any(String)
      })
      expect(deliverShell).toBeTypeOf('function')
      deliverShell?.()

      const connected = emits.filter((event) => {
        if (event.channel !== 'ssh:status' || !isRecord(event.payload)) {
          return false
        }
        return event.payload.type === 'connected'
      })
      expect(connected).toEqual([])
    } finally {
      Object.defineProperty(Client.prototype, 'shell', {
        configurable: true,
        writable: true,
        value: originalShell
      })
    }
  })

  it('closing the shell drops the session', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    api = testApi(userDataPath, { showMessageBox: async () => ({ response: 0 }) }, emits)

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected a live session')
    }

    server.closeLastShell()

    await vi.waitFor(() => {
      const closed = emits.some((event) => {
        if (event.channel !== 'ssh:status' || !isRecord(event.payload)) {
          return false
        }
        return event.payload.type === 'closed'
      })
      if (!closed) {
        throw new Error('no closed status yet')
      }
    })

    const leftover = await api.confirmHostKey(unknown.sessionId, 'abort', { id: 1 })
    expect(leftover).toEqual({ ok: false, reason: 'invalid', message: 'unknown session' })
  })

  it('a live session that loses its transport reports an error status with a message', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    proxy = await tcpProxy(server.port)
    const emits: CapturedEmit[] = []
    api = testApi(userDataPath, { showMessageBox: async () => ({ response: 0 }) }, emits)

    const unknown = await api.connect(connectRequest(proxy.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected a live session')
    }
    const probe = Uint8Array.from([0x71, 0x72])
    api.write(trusted.sessionId, probe, { id: 1 })
    await vi.waitFor(() => {
      if (!server?.receivedBytes().includes(Buffer.from(probe))) {
        throw new Error('session is not live yet')
      }
    })

    proxy.cut()

    await vi.waitFor(() => {
      if (!statusTypes(emits, trusted.sessionId).includes('error')) {
        throw new Error(`no error status yet: ${statusTypes(emits, trusted.sessionId).join()}`)
      }
    })
    expect(statusTypes(emits, trusted.sessionId)).toEqual(['connected', 'error'])
    const failure = emits.find((event) => {
      return (
        event.channel === 'ssh:status' && isRecord(event.payload) && event.payload.type === 'error'
      )
    })
    if (failure === undefined || !isRecord(failure.payload)) {
      throw new Error('expected an error status')
    }
    expect(failure.payload.message).toEqual(expect.any(String))
    expect(failure.payload.message).not.toBe('')
  })

  it('a corrupted private key reconnect does not drop the live session', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    const badKeyPath = join(userDataPath, 'broken_key')
    writeFileSync(badKeyPath, 'not-a-key\n')
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    api = testApi(
      userDataPath,
      {
        showOpenDialog: async () => ({ canceled: false, filePaths: [badKeyPath] }),
        showMessageBox: async () => ({ response: 0 })
      },
      emits
    )

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected a live session')
    }

    const picked = await api.pickPrivateKey({ id: 1 })
    if (picked === null) {
      throw new Error('expected a key')
    }
    const rejected = await api.connect(
      connectRequest(server.port, { method: 'privateKey', keyRef: picked.keyRef }),
      { id: 1 }
    )

    expect(rejected).toEqual({
      ok: false,
      reason: 'invalid',
      message: expect.any(String)
    })
    expect(server.shellCount()).toBe(1)

    const probe = Uint8Array.from([0x99, 0x88])
    api.write(trusted.sessionId, probe, { id: 1 })
    await vi.waitFor(() => {
      if (!emitsHaveChunk(emits, probe)) {
        throw new Error('live session did not echo after corrupted-key reconnect')
      }
    })
  })

  it('a wrong passphrase reconnect does not drop the live session', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    const clientKeyPath = join(userDataPath, 'id_ed25519')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', clientKeyPath, '-N', 'correct-pass', '-q'])
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    api = testApi(
      userDataPath,
      {
        showOpenDialog: async () => ({ canceled: false, filePaths: [clientKeyPath] }),
        showMessageBox: async () => ({ response: 0 })
      },
      emits
    )

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected a live session')
    }

    const picked = await api.pickPrivateKey({ id: 1 })
    if (picked === null) {
      throw new Error('expected a key')
    }
    const rejected = await api.connect(
      connectRequest(server.port, {
        method: 'privateKey',
        keyRef: picked.keyRef,
        passphrase: 'wrong-pass'
      }),
      { id: 1 }
    )

    expect(rejected).toEqual({
      ok: false,
      reason: 'invalid',
      message: expect.any(String)
    })
    expect(server.shellCount()).toBe(1)

    const probe = Uint8Array.from([0x77, 0x66])
    api.write(trusted.sessionId, probe, { id: 1 })
    await vi.waitFor(() => {
      if (!emitsHaveChunk(emits, probe)) {
        throw new Error('live session did not echo after wrong-passphrase reconnect')
      }
    })
  })

  it('first pty bytes of a reconnect reach the terminal while the old session is still active', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const chunks: Uint8Array[] = []
    const inbox = createSshEventInbox({
      onData: (_id, chunk) => {
        chunks.push(Uint8Array.from(chunk))
      },
      onStatus: () => undefined
    })
    api = testApiWithInbox(
      userDataPath,
      inbox,
      {
        showMessageBox: async () => ({ response: 0 })
      },
      { forwardStatus: false }
    )

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    inbox.beginHandoff()
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected a live session')
    }
    inbox.activate(trusted.sessionId)
    await vi.waitFor(() => {
      if (chunks.length === 0) {
        throw new Error('no banner yet')
      }
    })
    chunks.length = 0

    const previous = trusted.sessionId
    inbox.beginHandoff()
    const next = await runSshConnect({
      sessionId: previous,
      currentSessionId: () => previous,
      req: connectRequest(server.port),
      connect: (req) => {
        if (api === undefined) {
          throw new Error('api missing')
        }
        return api.connect(req, { id: 1 })
      }
    })
    syncSshConnectInbox(inbox, next)
    if (next.sessionId === null) {
      throw new Error(`expected reconnect to succeed, got ${JSON.stringify(next)}`)
    }

    await vi.waitFor(() => {
      if (chunks.length === 0) {
        throw new Error('terminal empty after reconnect')
      }
    })
    expect(chunks[0]).toEqual(Uint8Array.from([0xff, 0xfe, 0x00, 0x61]))
  })

  it('a synchronous shell error on a known host returns network instead of hanging', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const originalShell = Client.prototype.shell
    api = testApi(userDataPath, { showMessageBox: async () => ({ response: 0 }) })

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected a live session')
    }
    await api.disconnect(trusted.sessionId, { id: 1 })

    Object.defineProperty(Client.prototype, 'shell', {
      configurable: true,
      writable: true,
      value: function throwingShell() {
        throw new Error('Not connected')
      }
    })
    try {
      const again = await Promise.race([
        api.connect(connectRequest(server.port), { id: 1 }),
        neverSettles('connect hung after shell throw')
      ])
      expect(again).toEqual({
        ok: false,
        reason: 'network',
        message: expect.any(String)
      })
    } finally {
      Object.defineProperty(Client.prototype, 'shell', {
        configurable: true,
        writable: true,
        value: originalShell
      })
    }
  })

  it('trust-always returns network if shell throws synchronously', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const originalShell = Client.prototype.shell
    api = testApi(userDataPath, { showMessageBox: async () => ({ response: 0 }) })

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }

    Object.defineProperty(Client.prototype, 'shell', {
      configurable: true,
      writable: true,
      value: function throwingShell() {
        throw new Error('Not connected')
      }
    })
    try {
      const trusted = await Promise.race([
        api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 }),
        neverSettles('confirmHostKey hung after shell throw')
      ])
      expect(trusted).toEqual({
        ok: false,
        reason: 'network',
        message: expect.any(String)
      })
    } finally {
      Object.defineProperty(Client.prototype, 'shell', {
        configurable: true,
        writable: true,
        value: originalShell
      })
    }
  })

  it('a synchronous connect error after session handover returns network not invalid', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const originalConnect = Client.prototype.connect
    api = testApi(userDataPath, { showMessageBox: async () => ({ response: 0 }) })

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected a live session')
    }

    Object.defineProperty(Client.prototype, 'connect', {
      configurable: true,
      writable: true,
      value: function throwingConnect() {
        throw new Error('cannot connect')
      }
    })
    try {
      const again = await Promise.race([
        api.connect(connectRequest(server.port), { id: 1 }),
        neverSettles('connect hung after connect throw')
      ])
      expect(again).toEqual({
        ok: false,
        reason: 'network',
        message: expect.any(String)
      })
    } finally {
      Object.defineProperty(Client.prototype, 'connect', {
        configurable: true,
        writable: true,
        value: originalConnect
      })
    }
  })
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SshApi } from './create-ssh-api'
import {
  type CapturedEmit,
  type TestServer,
  connectRequest,
  generateHostKey,
  isRecord,
  listenTcp,
  neverSettles,
  startServer,
  testApi
} from './ssh-test-fixture'

describe('createSshApi auth', () => {
  let userDataPath: string | undefined
  let api: SshApi | undefined
  let server: TestServer | undefined
  let tcp: { port: number; close: () => Promise<void> } | undefined

  afterEach(async () => {
    api?.dispose()
    api = undefined
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

  it('trust-always with a wrong password returns auth-failed instead of hanging', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath, {
      showMessageBox: async () => ({ response: 0 })
    })

    const unknown = await api.connect(
      connectRequest(server.port, { method: 'password', password: 'wrong-password' }),
      { id: 1 }
    )
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }

    const trusted = await Promise.race([
      api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('confirmHostKey hung')), 2000)
      })
    ])

    expect(trusted).toEqual({
      ok: false,
      reason: 'auth-failed',
      message: expect.any(String)
    })
    expect(server.shellOpened()).toBe(false)

    const retry = await Promise.race([
      api.connect(connectRequest(server.port), { id: 1 }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('retry connect hung')), 2000)
      })
    ])
    expect(retry).toEqual({ ok: true, sessionId: expect.any(String) })
  })

  it('known host with a wrong password returns auth-failed instead of hanging', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath, {
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

    const failed = await Promise.race([
      api.connect(connectRequest(server.port, { method: 'password', password: 'wrong-password' }), {
        id: 1
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('connect hung')), 2000)
      })
    ])

    expect(failed).toEqual({
      ok: false,
      reason: 'auth-failed',
      message: expect.any(String)
    })
  })

  it('trust-always times out if the server never answers authentication', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem, { stallAuth: true })
    api = testApi(
      userDataPath,
      {
        showMessageBox: async () => ({ response: 0 })
      },
      undefined,
      { authTimeoutMs: 80 }
    )

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }

    const trusted = await Promise.race([
      api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('confirmHostKey hung')), 1500)
      })
    ])

    expect(trusted).toEqual({
      ok: false,
      reason: 'timeout',
      message: expect.any(String)
    })
    expect(server.shellOpened()).toBe(false)

    const again = await Promise.race([
      api.connect(connectRequest(server.port), { id: 1 }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('known-host connect hung')), 1500)
      })
    ])
    expect(again).toEqual({
      ok: false,
      reason: 'timeout',
      message: expect.any(String)
    })
  })

  it('the auth timeout does not start until the host is trusted', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem, { stallAuth: true })
    api = testApi(
      userDataPath,
      {
        showMessageBox: async () => ({ response: 0 })
      },
      undefined,
      { authTimeoutMs: 80 }
    )

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 150)
    })

    const trusted = await Promise.race([
      api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('confirmHostKey hung')), 1500)
      })
    ])

    expect(trusted).toEqual({
      ok: false,
      reason: 'timeout',
      message: expect.any(String)
    })
  })

  it('a live session stays up after the auth timeout window', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    api = testApi(
      userDataPath,
      {
        showMessageBox: async () => ({ response: 0 })
      },
      emits,
      { authTimeoutMs: 1500 }
    )

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error(`expected a live session, got ${JSON.stringify(trusted)}`)
    }

    // Wait past the auth timeout so a live session would drop if the timer were still armed.
    await new Promise((resolve) => {
      setTimeout(resolve, 2000)
    })

    const closed = emits.some((event) => {
      if (event.channel !== 'ssh:status' || !isRecord(event.payload)) {
        return false
      }
      return event.payload.type === 'closed'
    })
    expect(closed).toBe(false)
    expect(server.shellOpened()).toBe(true)
  })

  it('connect returns network when the peer closes before host verification', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    tcp = await listenTcp((socket) => {
      socket.end()
    })
    api = testApi(userDataPath)

    const result = await Promise.race([
      api.connect(connectRequest(tcp.port), { id: 1 }),
      neverSettles('connect hung after peer EOF')
    ])

    expect(result).toEqual({
      ok: false,
      reason: 'network',
      message: expect.any(String)
    })
  })

  it('trust-always times out if the server never opens a shell', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem, { stallShell: true })
    api = testApi(
      userDataPath,
      {
        showMessageBox: async () => ({ response: 0 })
      },
      undefined,
      { authTimeoutMs: 80 }
    )

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }

    const trusted = await Promise.race([
      api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 }),
      neverSettles('confirmHostKey hung waiting for shell')
    ])

    expect(trusted).toEqual({
      ok: false,
      reason: 'timeout',
      message: expect.any(String)
    })
    expect(server.shellOpened()).toBe(false)
  })

  it('connect times out if the peer never sends an SSH banner', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    tcp = await listenTcp(() => undefined)
    api = testApi(userDataPath, undefined, undefined, { authTimeoutMs: 80 })

    const result = await Promise.race([
      api.connect(connectRequest(tcp.port), { id: 1 }),
      neverSettles('connect hung waiting for SSH banner')
    ])

    expect(result).toEqual({
      ok: false,
      reason: 'timeout',
      message: expect.any(String)
    })
  })
})

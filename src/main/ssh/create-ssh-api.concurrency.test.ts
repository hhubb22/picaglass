import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SINGLE_FORM_PROFILE_ID } from '../../shared/ssh'
import type { SshApi, SshSender } from './create-ssh-api'
import {
  type CapturedEmit,
  type TestServer,
  connectRequest,
  emitsHaveChunk,
  generateHostKey,
  listenTcp,
  liveSession,
  neverSettles,
  startServer,
  testApi,
  waitForServerBytes
} from './ssh-test-fixture'

describe('createSshApi concurrency', () => {
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

  it('rejects a second connect on the same Connection Profile without disturbing the live session', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    api = testApi(userDataPath, undefined, emits)

    const owner: SshSender = { id: 1 }
    const live = await liveSession(api, server, owner)
    const opening = Uint8Array.from([0x21])
    api.write(live, opening, owner)
    await waitForServerBytes(server, opening)

    const second = await api.connect(connectRequest(server.port), owner)

    expect(second).toEqual({
      ok: false,
      reason: 'invalid',
      message: 'session already exists'
    })
    expect(server.shellCount()).toBe(1)

    const probe = Uint8Array.from([0x41])
    api.write(live, probe, owner)
    await waitForServerBytes(server, probe)
    await vi.waitFor(() => {
      if (!emitsHaveChunk(emits, probe)) {
        throw new Error('live session did not echo after a conflicting connect')
      }
    })
  })

  it('a blank Connection Profile identity is invalid and does not drop the live session', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const live = await liveSession(api, server, { id: 1 })
    const rejected = await api.connect(
      { ...connectRequest(server.port), profileId: '   ' },
      { id: 1 }
    )

    expect(rejected).toEqual({
      ok: false,
      reason: 'invalid',
      message: 'invalid profile'
    })
    expect(server.shellCount()).toBe(1)

    const probe = Uint8Array.from([0x31])
    api.write(live, probe, { id: 1 })
    await waitForServerBytes(server, probe)
  })

  it('a second connect on the same Connection Profile does not settle a pending handshake', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    tcp = await listenTcp(() => undefined)
    api = testApi(userDataPath)

    const first = api.connect(connectRequest(tcp.port), { id: 1 })
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
    const second = await api.connect(connectRequest(tcp.port), { id: 1 })

    expect(second).toEqual({
      ok: false,
      reason: 'invalid',
      message: 'session already exists'
    })

    const raced = await Promise.race([
      first.then((result) => ({ settled: true as const, result })),
      new Promise<{ settled: false }>((resolve) => {
        setTimeout(() => resolve({ settled: false }), 80)
      })
    ])
    expect(raced).toEqual({ settled: false })

    await api.cancel(SINGLE_FORM_PROFILE_ID, { id: 1 })
    const firstResult = await Promise.race([first, neverSettles('first connect hung after cancel')])
    expect(firstResult).toEqual({
      ok: false,
      reason: 'canceled',
      message: 'canceled'
    })
  })

  it('sessions on different Connection Profiles connect, echo, and disconnect independently', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    api = testApi(userDataPath, undefined, emits)

    const owner: SshSender = { id: 1 }
    const firstId = await liveSession(api, server, owner, 'profile-a')
    const secondId = await liveSession(api, server, owner, 'profile-b')
    expect(firstId).not.toBe(secondId)
    expect(server.liveConnections()).toBe(2)
    expect(server.shellCount()).toBe(2)

    const probeA = Uint8Array.from([0x61])
    const probeB = Uint8Array.from([0x62])
    api.write(firstId, probeA, owner)
    api.write(secondId, probeB, owner)
    await waitForServerBytes(server, probeA)
    await waitForServerBytes(server, probeB)
    await vi.waitFor(() => {
      if (!emitsHaveChunk(emits, probeA) || !emitsHaveChunk(emits, probeB)) {
        throw new Error('both sessions did not echo')
      }
    })

    await api.disconnect(firstId, owner)
    await vi.waitFor(() => {
      if (server?.liveConnections() !== 1) {
        throw new Error(`expected one live client, got ${server?.liveConnections()}`)
      }
    })

    const stale = Uint8Array.from([0x63])
    api.write(firstId, stale, owner)
    const stillLive = Uint8Array.from([0x64])
    api.write(secondId, stillLive, owner)
    await waitForServerBytes(server, stillLive)
    expect(server.receivedBytes().includes(Buffer.from(stale))).toBe(false)
  })

  it('canceling a pending attempt does not affect another Connection Profile', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    tcp = await listenTcp(() => undefined)
    const emits: CapturedEmit[] = []
    api = testApi(userDataPath, undefined, emits)

    const owner: SshSender = { id: 1 }
    const live = await liveSession(api, server, owner, 'profile-live')
    const pending = api.connect(connectRequest(tcp.port, undefined, 'profile-pending'), owner)
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })

    await api.cancel('profile-pending', owner)
    const pendingResult = await Promise.race([
      pending,
      neverSettles('pending connect hung after cancel')
    ])
    expect(pendingResult).toEqual({
      ok: false,
      reason: 'canceled',
      message: 'canceled'
    })

    const probe = Uint8Array.from([0x71])
    api.write(live, probe, owner)
    await waitForServerBytes(server, probe)
    await vi.waitFor(() => {
      if (!emitsHaveChunk(emits, probe)) {
        throw new Error('live session on the other key did not echo after cancel')
      }
    })
  })

  it('another sender cannot cancel a pending attempt', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    tcp = await listenTcp(() => undefined)
    api = testApi(userDataPath)

    const pending = api.connect(connectRequest(tcp.port), { id: 1 })
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })

    await api.cancel(SINGLE_FORM_PROFILE_ID, { id: 2 })
    const raced = await Promise.race([
      pending.then((result) => ({ settled: true as const, result })),
      new Promise<{ settled: false }>((resolve) => {
        setTimeout(() => resolve({ settled: false }), 80)
      })
    ])
    expect(raced).toEqual({ settled: false })

    await api.cancel(SINGLE_FORM_PROFILE_ID, { id: 1 })
    expect(await pending).toEqual({
      ok: false,
      reason: 'canceled',
      message: 'canceled'
    })
  })

  it('canceling a live session is a no-op', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const owner: SshSender = { id: 1 }
    const live = await liveSession(api, server, owner)
    await api.cancel(SINGLE_FORM_PROFILE_ID, owner)

    const probe = Uint8Array.from([0x81])
    api.write(live, probe, owner)
    await waitForServerBytes(server, probe)
    expect(server.liveConnections()).toBe(1)
  })

  it('a canceled Connection Profile can connect again', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    tcp = await listenTcp(() => undefined)
    api = testApi(userDataPath)

    const pending = api.connect(connectRequest(tcp.port), { id: 1 })
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
    await api.cancel(SINGLE_FORM_PROFILE_ID, { id: 1 })
    await pending

    const next = await liveSession(api, server, { id: 1 })
    expect(next.length).toBeGreaterThan(0)
    expect(server.shellOpened()).toBe(true)
  })

  it('a pending host-unknown occupies the Connection Profile until it is confirmed or dropped', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const owner: SshSender = { id: 1 }
    const unknown = await api.connect(connectRequest(server.port), owner)
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error(`expected host-unknown, got ${JSON.stringify(unknown)}`)
    }

    const conflict = await api.connect(connectRequest(server.port), owner)
    expect(conflict).toEqual({
      ok: false,
      reason: 'invalid',
      message: 'session already exists'
    })
    expect(server.shellOpened()).toBe(false)

    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', owner)
    expect(trusted).toEqual({ ok: true, sessionId: unknown.sessionId })
    expect(server.shellOpened()).toBe(true)
  })

  it('canceling a host-unknown attempt frees the Connection Profile', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const owner: SshSender = { id: 1 }
    const unknown = await api.connect(connectRequest(server.port), owner)
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error(`expected host-unknown, got ${JSON.stringify(unknown)}`)
    }

    await api.cancel(SINGLE_FORM_PROFILE_ID, owner)
    const leftover = await api.confirmHostKey(unknown.sessionId, 'trust-always', owner)
    expect(leftover).toEqual({ ok: false, reason: 'invalid', message: 'unknown session' })

    const again = await api.connect(connectRequest(server.port), owner)
    expect(again).toEqual({
      ok: false,
      reason: 'host-unknown',
      sessionId: expect.any(String),
      fingerprint: hostKey.fingerprint,
      algorithm: 'ssh-ed25519'
    })
  })
})

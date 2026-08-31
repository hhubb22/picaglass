import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SshApi, SshSender } from './create-ssh-api'
import {
  type CapturedEmit,
  type TestServer,
  connectRequest,
  emitsHaveChunk,
  generateHostKey,
  startServer,
  testApi,
  waitForServerBytes
} from './ssh-test-fixture'

const PROFILE_A = 'profile-a'
const PROFILE_B = 'profile-b'
const owner: SshSender = { id: 1 }

describe('createSshApi host trust', () => {
  let userDataPath: string | undefined
  let api: SshApi | undefined
  let server: TestServer | undefined

  afterEach(async () => {
    api?.dispose()
    api = undefined
    if (server) {
      await server.close()
      server = undefined
    }
    if (userDataPath) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = undefined
    }
  })

  async function startUnknown(): Promise<{
    fingerprint: string
    algorithm: string
  }> {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-trust-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)
    return { fingerprint: hostKey.fingerprint, algorithm: 'ssh-ed25519' }
  }

  async function confirm(
    sessionId: string,
    action: 'trust-always' | 'trust-once' | 'replace' | 'abort'
  ): Promise<void> {
    if (api === undefined) {
      throw new Error('api missing')
    }
    const result = await api.confirmHostKey(sessionId, action, owner)
    if (action === 'abort') {
      return
    }
    if (!result.ok) {
      throw new Error(`expected confirm ${action} to succeed, got ${JSON.stringify(result)}`)
    }
  }

  async function connectProfile(profileId: string): ReturnType<SshApi['connect']> {
    if (api === undefined || server === undefined) {
      throw new Error('api missing')
    }
    return api.connect(connectRequest(server.port, undefined, profileId), owner)
  }

  it('trust once opens a shell without writing known_hosts', async () => {
    const hostKey = await startUnknown()
    const unknown = await connectProfile(PROFILE_A)
    expect(unknown).toEqual({
      ok: false,
      reason: 'host-unknown',
      sessionId: expect.any(String),
      fingerprint: hostKey.fingerprint,
      algorithm: hostKey.algorithm
    })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }

    const trusted = await api!.confirmHostKey(unknown.sessionId, 'trust-once', owner)

    expect(trusted).toEqual({ ok: true, sessionId: unknown.sessionId })
    expect(server!.shellOpened()).toBe(true)
    expect(existsSync(join(userDataPath!, 'ssh', 'known_hosts'))).toBe(false)
    await expect(api!.hostTrust('127.0.0.1', server!.port)).resolves.toEqual({
      status: 'session',
      algorithm: 'ssh-ed25519',
      fingerprint: hostKey.fingerprint
    })
  })

  it('trust once reverts to not-remembered after disconnect and the next connect verifies again', async () => {
    const hostKey = await startUnknown()
    const unknown = await connectProfile(PROFILE_A)
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    await confirm(unknown.sessionId, 'trust-once')
    await api!.disconnect(unknown.sessionId, owner)

    await expect(api!.hostTrust('127.0.0.1', server!.port)).resolves.toEqual({
      status: 'not-remembered'
    })
    const again = await connectProfile(PROFILE_A)
    expect(again).toEqual({
      ok: false,
      reason: 'host-unknown',
      sessionId: expect.any(String),
      fingerprint: hostKey.fingerprint,
      algorithm: hostKey.algorithm
    })
    expect(existsSync(join(userDataPath!, 'ssh', 'known_hosts'))).toBe(false)
  })

  it('trust once is shared by a second profile on the same endpoint until every session disconnects', async () => {
    const hostKey = await startUnknown()
    const first = await connectProfile(PROFILE_A)
    if (first.ok || first.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    await confirm(first.sessionId, 'trust-once')

    const second = await connectProfile(PROFILE_B)
    expect(second).toEqual({ ok: true, sessionId: expect.any(String) })
    if (!second.ok) {
      throw new Error('expected profile B to use session trust')
    }
    expect(server!.liveConnections()).toBe(2)
    await expect(api!.hostTrust('127.0.0.1', server!.port)).resolves.toEqual({
      status: 'session',
      algorithm: 'ssh-ed25519',
      fingerprint: hostKey.fingerprint
    })

    await api!.disconnect(first.sessionId, owner)
    await expect(api!.hostTrust('127.0.0.1', server!.port)).resolves.toEqual({
      status: 'session',
      algorithm: 'ssh-ed25519',
      fingerprint: hostKey.fingerprint
    })

    await api!.disconnect(second.sessionId, owner)
    await expect(api!.hostTrust('127.0.0.1', server!.port)).resolves.toEqual({
      status: 'not-remembered'
    })
    const third = await connectProfile(PROFILE_A)
    expect(third).toMatchObject({ ok: false, reason: 'host-unknown' })
  })

  it('trust and remember persists shared trust for a second profile and a later API instance', async () => {
    const hostKey = await startUnknown()
    const unknown = await connectProfile(PROFILE_A)
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api!.confirmHostKey(unknown.sessionId, 'trust-always', owner)
    expect(trusted).toEqual({ ok: true, sessionId: unknown.sessionId })
    expect(readFileSync(join(userDataPath!, 'ssh', 'known_hosts'), 'utf8')).toContain(
      `[127.0.0.1]:${server!.port} ssh-ed25519 `
    )
    await expect(api!.hostTrust('127.0.0.1', server!.port)).resolves.toEqual({
      status: 'remembered',
      algorithm: 'ssh-ed25519',
      fingerprint: hostKey.fingerprint
    })

    const second = await connectProfile(PROFILE_B)
    expect(second).toEqual({ ok: true, sessionId: expect.any(String) })

    api!.dispose()
    api = testApi(userDataPath!)
    const again = await connectProfile(PROFILE_A)
    expect(again).toEqual({ ok: true, sessionId: expect.any(String) })
  })

  it('a changed host key pauses with old and new fingerprints without opening a shell', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-trust-'))
    const firstHostKey = generateHostKey(userDataPath, 'host-a')
    const changedHostKey = generateHostKey(userDataPath, 'host-b')
    server = await startServer(firstHostKey.pem)
    api = testApi(userDataPath)

    const unknown = await connectProfile(PROFILE_A)
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', owner)
    if (!trusted.ok) {
      throw new Error('expected remembered trust')
    }
    const port = server.port
    await api.disconnect(trusted.sessionId, owner)
    await server.close()
    server = await startServer(changedHostKey.pem, { port })

    const changed = await connectProfile(PROFILE_A)
    expect(changed).toEqual({
      ok: false,
      reason: 'host-changed',
      sessionId: expect.any(String),
      fingerprint: changedHostKey.fingerprint,
      algorithm: 'ssh-ed25519',
      previousFingerprint: firstHostKey.fingerprint,
      previousAlgorithm: 'ssh-ed25519'
    })
    expect(server.shellOpened()).toBe(false)
    if (changed.ok || changed.reason !== 'host-changed') {
      throw new Error('expected host-changed')
    }

    const skipped = await api.confirmHostKey(changed.sessionId, 'trust-always', owner)
    expect(skipped).toEqual({ ok: false, reason: 'invalid', message: 'unknown session' })
    expect(server.shellOpened()).toBe(false)
    await expect(api.hostTrust('127.0.0.1', port)).resolves.toEqual({
      status: 'remembered',
      algorithm: 'ssh-ed25519',
      fingerprint: firstHostKey.fingerprint
    })
  })

  it('aborting a changed host key leaves remembered trust unchanged', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-trust-'))
    const firstHostKey = generateHostKey(userDataPath, 'host-a')
    const changedHostKey = generateHostKey(userDataPath, 'host-b')
    server = await startServer(firstHostKey.pem)
    api = testApi(userDataPath)

    const unknown = await connectProfile(PROFILE_A)
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', owner)
    if (!trusted.ok) {
      throw new Error('expected remembered trust')
    }
    const port = server.port
    await api.disconnect(trusted.sessionId, owner)
    await server.close()
    server = await startServer(changedHostKey.pem, { port })

    const changed = await connectProfile(PROFILE_A)
    if (changed.ok || changed.reason !== 'host-changed') {
      throw new Error('expected host-changed')
    }
    await api.confirmHostKey(changed.sessionId, 'abort', owner)

    await expect(api.hostTrust('127.0.0.1', port)).resolves.toEqual({
      status: 'remembered',
      algorithm: 'ssh-ed25519',
      fingerprint: firstHostKey.fingerprint
    })
    const again = await connectProfile(PROFILE_A)
    expect(again).toMatchObject({
      ok: false,
      reason: 'host-changed',
      fingerprint: changedHostKey.fingerprint,
      previousFingerprint: firstHostKey.fingerprint
    })
  })

  it('aborting a changed host key leaves a live sibling session running', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-trust-'))
    const firstHostKey = generateHostKey(userDataPath, 'host-a')
    const otherHostKey = generateHostKey(userDataPath, 'host-b')
    server = await startServer(firstHostKey.pem)
    const emits: CapturedEmit[] = []
    api = testApi(userDataPath, undefined, emits)

    const firstUnknown = await connectProfile(PROFILE_A)
    if (firstUnknown.ok || firstUnknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const liveA = await api.confirmHostKey(firstUnknown.sessionId, 'trust-always', owner)
    if (!liveA.ok) {
      throw new Error('expected profile A live')
    }
    const pub = readFileSync(join(userDataPath, 'host-b.pub'), 'utf8').trim().split(/\s+/)
    const alg = pub[0]
    const b64 = pub[1]
    if (alg === undefined || b64 === undefined) {
      throw new Error('expected a public host key')
    }
    writeFileSync(
      join(userDataPath, 'ssh', 'known_hosts'),
      `[127.0.0.1]:${server.port} ${alg} ${b64}\n`
    )

    const changed = await connectProfile(PROFILE_B)
    if (changed.ok || changed.reason !== 'host-changed') {
      throw new Error('expected host-changed')
    }
    const aborted = await api.confirmHostKey(changed.sessionId, 'abort', owner)
    expect(aborted).toEqual({ ok: false, reason: 'canceled', message: 'canceled' })
    await expect(api.hostTrust('127.0.0.1', server.port)).resolves.toEqual({
      status: 'remembered',
      algorithm: 'ssh-ed25519',
      fingerprint: otherHostKey.fingerprint
    })

    const probe = Uint8Array.from([0x44, 0x34])
    api.write(liveA.sessionId, probe, owner)
    await waitForServerBytes(server, probe)
    await vi.waitFor(() => {
      if (!emitsHaveChunk(emits, probe)) {
        throw new Error('live session did not echo after aborting replace')
      }
    })
  })

  it('replace updates shared trust for future connections and leaves a live session running', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-trust-'))
    const firstHostKey = generateHostKey(userDataPath, 'host-a')
    const otherHostKey = generateHostKey(userDataPath, 'host-b')
    server = await startServer(firstHostKey.pem)
    const emits: CapturedEmit[] = []
    api = testApi(userDataPath, undefined, emits)

    const firstUnknown = await connectProfile(PROFILE_A)
    if (firstUnknown.ok || firstUnknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const liveA = await api.confirmHostKey(firstUnknown.sessionId, 'trust-always', owner)
    if (!liveA.ok) {
      throw new Error('expected profile A live')
    }

    const pub = readFileSync(join(userDataPath, 'host-b.pub'), 'utf8').trim().split(/\s+/)
    const alg = pub[0]
    const b64 = pub[1]
    if (alg === undefined || b64 === undefined) {
      throw new Error('expected a public host key')
    }
    writeFileSync(
      join(userDataPath, 'ssh', 'known_hosts'),
      `[127.0.0.1]:${server.port} ${alg} ${b64}\n`
    )

    const changed = await connectProfile(PROFILE_B)
    expect(changed).toEqual({
      ok: false,
      reason: 'host-changed',
      sessionId: expect.any(String),
      fingerprint: firstHostKey.fingerprint,
      algorithm: 'ssh-ed25519',
      previousFingerprint: otherHostKey.fingerprint,
      previousAlgorithm: 'ssh-ed25519'
    })
    if (changed.ok || changed.reason !== 'host-changed') {
      throw new Error('expected host-changed')
    }
    const replaced = await api.confirmHostKey(changed.sessionId, 'replace', owner)
    expect(replaced).toEqual({ ok: true, sessionId: changed.sessionId })
    await expect(api.hostTrust('127.0.0.1', server.port)).resolves.toEqual({
      status: 'remembered',
      algorithm: 'ssh-ed25519',
      fingerprint: firstHostKey.fingerprint
    })

    const probe = Uint8Array.from([0x41, 0x31])
    api.write(liveA.sessionId, probe, owner)
    await waitForServerBytes(server, probe)
    await vi.waitFor(() => {
      if (!emitsHaveChunk(emits, probe)) {
        throw new Error('live session did not echo after replace')
      }
    })

    await api.disconnect(changed.sessionId, owner)
    const again = await connectProfile(PROFILE_B)
    expect(again).toEqual({ ok: true, sessionId: expect.any(String) })
  })

  it('forget removes remembered trust for every matching profile without ending live sessions', async () => {
    const hostKey = await startUnknown()
    const first = await connectProfile(PROFILE_A)
    if (first.ok || first.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const liveA = await api!.confirmHostKey(first.sessionId, 'trust-always', owner)
    if (!liveA.ok) {
      throw new Error('expected profile A live')
    }
    const liveB = await connectProfile(PROFILE_B)
    if (!liveB.ok) {
      throw new Error('expected profile B to use remembered trust')
    }

    const forgotten = await api!.forgetHostKey('127.0.0.1', server!.port)
    expect(forgotten).toEqual({ ok: true })
    await expect(api!.hostTrust('127.0.0.1', server!.port)).resolves.toEqual({
      status: 'not-remembered'
    })
    expect(server!.liveConnections()).toBe(2)

    const probe = Uint8Array.from([0x42, 0x32])
    api!.write(liveA.sessionId, probe, owner)
    await waitForServerBytes(server!, probe)

    await api!.disconnect(liveB.sessionId, owner)
    const next = await connectProfile(PROFILE_B)
    expect(next).toEqual({
      ok: false,
      reason: 'host-unknown',
      sessionId: expect.any(String),
      fingerprint: hostKey.fingerprint,
      algorithm: hostKey.algorithm
    })
    expect(server!.shellCount()).toBe(2)

    const stillLive = Uint8Array.from([0x43, 0x33])
    api!.write(liveA.sessionId, stillLive, owner)
    await waitForServerBytes(server!, stillLive)
  })
})

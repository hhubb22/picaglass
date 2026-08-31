import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SshApi } from './create-ssh-api'
import {
  type CapturedEmit,
  type TestServer,
  connectRequest,
  emitsHaveChunk,
  filesContain,
  generateHostKey,
  neverSettles,
  startServer,
  testApi
} from './ssh-test-fixture'

describe('createSshApi handshake', () => {
  let userDataPath: string | undefined
  let api: SshApi | undefined
  let server: TestServer | undefined

  afterEach(async () => {
    vi.unstubAllEnvs()
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

  it('connects to an unknown host as host-unknown with the ssh-keygen fingerprint and does not open a shell', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const result = await api.connect(connectRequest(server.port), { id: 1 })

    expect(result).toEqual({
      ok: false,
      reason: 'host-unknown',
      sessionId: expect.any(String),
      fingerprint: hostKey.fingerprint,
      algorithm: 'ssh-ed25519'
    })
    if (result.ok || result.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    expect(result.sessionId.length).toBeGreaterThan(0)
    expect(server.shellOpened()).toBe(false)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('secret-password')
    expect(serialized).not.toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(serialized).not.toContain('BEGIN RSA PRIVATE KEY')
  })

  it('aborts an unknown host and the next connect is still host-unknown', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const first = await api.connect(connectRequest(server.port), { id: 1 })
    if (first.ok || first.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }

    await api.confirmHostKey(first.sessionId, 'abort', { id: 1 })

    const second = await api.connect(connectRequest(server.port), { id: 1 })

    expect(second).toEqual({
      ok: false,
      reason: 'host-unknown',
      sessionId: expect.any(String),
      fingerprint: hostKey.fingerprint,
      algorithm: 'ssh-ed25519'
    })
    if (second.ok || second.reason !== 'host-unknown') {
      throw new Error('expected host-unknown after abort')
    }
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(server.shellOpened()).toBe(false)
  })

  it('pickPrivateKey returns an opaque keyRef and connect still pauses without a shell', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    const clientKeyPath = join(userDataPath, 'id_ed25519')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', clientKeyPath, '-N', '', '-q'])
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath, {
      showOpenDialog: async () => ({ canceled: false, filePaths: [clientKeyPath] })
    })

    const picked = await api.pickPrivateKey({ id: 1 })
    expect(picked).toEqual({ keyRef: expect.any(String), label: 'id_ed25519' })
    if (picked === null) {
      throw new Error('expected a key')
    }
    expect(picked.keyRef).not.toBe(clientKeyPath)
    expect(picked.keyRef.includes('/')).toBe(false)
    expect(picked.keyRef.includes('\\')).toBe(false)

    const result = await api.connect(
      connectRequest(server.port, { method: 'privateKey', keyRef: picked.keyRef }),
      { id: 1 }
    )

    expect(result).toEqual({
      ok: false,
      reason: 'host-unknown',
      sessionId: expect.any(String),
      fingerprint: hostKey.fingerprint,
      algorithm: 'ssh-ed25519'
    })
    expect(server.shellOpened()).toBe(false)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(serialized).not.toContain(readFileSync(clientKeyPath, 'utf8'))
  })

  it('pickPrivateKey cancel returns null and stores nothing', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    api = testApi(userDataPath, {
      showOpenDialog: async () => ({ canceled: true, filePaths: ['/tmp/id_ed25519'] })
    })

    expect(await api.pickPrivateKey({ id: 1 })).toBeNull()
  })

  it('trust-always opens a shell with xterm-256color and the current cols/rows', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }

    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })

    expect(trusted).toEqual({ ok: true, sessionId: unknown.sessionId })
    expect(server.shellOpened()).toBe(true)
    expect(server.pty()).toEqual({ term: 'xterm-256color', cols: 80, rows: 24 })
    const serialized = JSON.stringify(trusted)
    expect(serialized).not.toContain('secret-password')
    expect(serialized).not.toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(serialized).not.toContain('BEGIN RSA PRIVATE KEY')
  })

  it('trust-always opens a shell with cols/rows updated while the host was pending', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    api.resize(unknown.sessionId, 132, 43, { id: 1 })

    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })

    expect(trusted).toEqual({ ok: true, sessionId: unknown.sessionId })
    expect(server.pty()).toEqual({ term: 'xterm-256color', cols: 132, rows: 43 })
  })

  it('abort does not persist the host and the next connect is still host-unknown', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const first = await api.connect(connectRequest(server.port), { id: 1 })
    if (first.ok || first.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }

    const rejected = await api.confirmHostKey(first.sessionId, 'abort', { id: 1 })

    expect(rejected).toEqual({
      ok: false,
      reason: 'invalid',
      message: 'aborted'
    })
    expect(server.shellOpened()).toBe(false)
    expect(() => readFileSync(join(userDataPath!, 'ssh', 'known_hosts'))).toThrow()

    const second = await api.connect(connectRequest(server.port), { id: 1 })

    expect(second).toEqual({
      ok: false,
      reason: 'host-unknown',
      sessionId: expect.any(String),
      fingerprint: hostKey.fingerprint,
      algorithm: 'ssh-ed25519'
    })
    expect(server.shellOpened()).toBe(false)
  })

  it('a second createSshApi on the same userData connects without host-unknown', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected trust-always to succeed')
    }
    const shellsAfterTrust = server.shellCount()
    api.dispose()

    api = testApi(userDataPath)
    const again = await api.connect(connectRequest(server.port), { id: 1 })

    expect(again).toEqual({ ok: true, sessionId: expect.any(String) })
    if (!again.ok) {
      throw new Error('expected a live session')
    }
    expect(again.sessionId).not.toBe(unknown.sessionId)
    expect(server.shellCount()).toBe(shellsAfterTrust + 1)
    expect(JSON.stringify(again)).not.toContain('secret-password')
    expect(filesContain(userDataPath, 'secret-password')).toBe(false)
  })

  it('persists trusted hosts under userData without changing the home known_hosts', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const appUserDataPath = join(userDataPath, 'app-data')
    const homePath = join(userDataPath, 'home')
    const homeKnownHostsPath = join(homePath, '.ssh', 'known_hosts')
    const homeKnownHosts = 'example.test ssh-ed25519 untouched\n'
    mkdirSync(join(homePath, '.ssh'), { recursive: true })
    writeFileSync(homeKnownHostsPath, homeKnownHosts)
    vi.stubEnv('HOME', homePath)
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(appUserDataPath)

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })

    expect(trusted).toEqual({ ok: true, sessionId: unknown.sessionId })
    expect(readFileSync(homeKnownHostsPath, 'utf8')).toBe(homeKnownHosts)
    expect(readFileSync(join(appUserDataPath, 'ssh', 'known_hosts'), 'utf8')).toContain(
      `[127.0.0.1]:${server.port} ssh-ed25519 `
    )
  })

  it('pauses a changed host key with old and new fingerprints without opening a shell', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const firstHostKey = generateHostKey(userDataPath, 'host-a')
    const changedHostKey = generateHostKey(userDataPath, 'host-b')
    server = await startServer(firstHostKey.pem)
    api = testApi(userDataPath)

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected trust-always to succeed')
    }

    const port = server.port
    await api.disconnect(trusted.sessionId, { id: 1 })
    await server.close()
    server = await startServer(changedHostKey.pem, { port })

    const changed = await api.connect(connectRequest(port), { id: 1 })

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
    const skipped = await api.confirmHostKey(changed.sessionId, 'trust-always', { id: 1 })
    expect(skipped).toEqual({
      ok: false,
      reason: 'invalid',
      message: 'unknown session'
    })
    expect(server.shellOpened()).toBe(false)
  })

  it('trust-always Yes with a private key opens a shell', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    const clientKeyPath = join(userDataPath, 'id_ed25519')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', clientKeyPath, '-N', '', '-q'])
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath, {
      showOpenDialog: async () => ({ canceled: false, filePaths: [clientKeyPath] })
    })

    const picked = await api.pickPrivateKey({ id: 1 })
    if (picked === null) {
      throw new Error('expected a key')
    }
    const unknown = await api.connect(
      connectRequest(server.port, { method: 'privateKey', keyRef: picked.keyRef }),
      { id: 1 }
    )
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }

    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })

    expect(trusted).toEqual({ ok: true, sessionId: unknown.sessionId })
    expect(server.shellOpened()).toBe(true)
    expect(JSON.stringify(trusted)).not.toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(JSON.stringify(trusted)).not.toContain(readFileSync(clientKeyPath, 'utf8'))
  })

  it('a known_hosts read error returns a structured failure instead of hanging', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    mkdirSync(join(userDataPath, 'ssh', 'known_hosts'), { recursive: true })
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const result = await Promise.race([
      api.connect(connectRequest(server.port), { id: 1 }),
      neverSettles('connect hung after known_hosts read error')
    ])

    expect(result).toEqual({
      ok: false,
      reason: 'invalid',
      message: expect.any(String)
    })
  })

  it('a known_hosts read error on reconnect does not drop the live session', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    api = testApi(userDataPath, undefined, emits)

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected a live session')
    }

    unlinkSync(join(userDataPath, 'ssh', 'known_hosts'))
    mkdirSync(join(userDataPath, 'ssh', 'known_hosts'))

    const rejected = await api.connect(connectRequest(server.port), { id: 1 })
    expect(rejected).toEqual({
      ok: false,
      reason: 'invalid',
      message: expect.any(String)
    })
    expect(server.shellCount()).toBe(1)

    const probe = Uint8Array.from([0x55, 0x44])
    api.write(trusted.sessionId, probe, { id: 1 })
    await vi.waitFor(() => {
      if (!emitsHaveChunk(emits, probe)) {
        throw new Error('live session did not echo after known_hosts reconnect')
      }
    })
  })

  it('a known_hosts write error returns a structured failure instead of throwing', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    mkdirSync(join(userDataPath, 'ssh', 'known_hosts'), { recursive: true })

    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })

    expect(trusted).toEqual({
      ok: false,
      reason: 'invalid',
      message: expect.any(String)
    })
    expect(server.shellOpened()).toBe(false)
  })
})

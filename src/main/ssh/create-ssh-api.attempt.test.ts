import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionAttemptSummary } from '../../shared/connection-attempt'
import { createProfileApi, type ProfileApi } from '../profiles/create-profile-api'
import { createSshApi, type SshApi, type SshSender } from './create-ssh-api'
import {
  type CapturedEmit,
  type TestServer,
  filesContain,
  generateHostKey,
  listenTcp,
  neverSettles,
  startServer
} from './ssh-test-fixture'

const WORKSPACE_PRIMARY = join('workspace', 'workspace.json')

describe('Connection Attempt summaries at the SSH API seam', () => {
  let userDataPath: string | undefined
  let sshApi: SshApi | undefined
  let server: TestServer | undefined
  let tcp: { port: number; close: () => Promise<void> } | undefined
  let nowMs = Date.parse('2026-08-31T12:00:00.000Z')

  afterEach(async () => {
    sshApi?.dispose()
    sshApi = undefined
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
    nowMs = Date.parse('2026-08-31T12:00:00.000Z')
  })

  function now(): Date {
    return new Date(nowMs)
  }

  function advance(ms: number): void {
    nowMs += ms
  }

  async function wired(
    emits?: CapturedEmit[],
    extras?: { authTimeoutMs?: number }
  ): Promise<{
    profiles: ProfileApi
    ssh: SshApi
  }> {
    const dir = userDataPath ?? (await mkdtemp(join(tmpdir(), 'picaglass-attempt-ssh-')))
    userDataPath = dir
    const profiles = createProfileApi({
      userDataPath: dir,
      now
    })
    const ssh = createSshApi({
      userDataPath: dir,
      dialogs: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] })
      },
      emitTo: (_senderId, channel, payload) => {
        emits?.push({ channel, payload: structuredClone(payload) })
      },
      resolveProfile: (profileId) => profiles.getConnectTarget(profileId),
      recordAttempt: (profileId, summary) => profiles.recordAttempt(profileId, summary),
      now,
      authTimeoutMs: extras?.authTimeoutMs
    })
    sshApi = ssh
    return { profiles, ssh }
  }

  async function savePassword(profiles: ProfileApi, port: number): Promise<string> {
    const created = await profiles.create({
      host: '127.0.0.1',
      port,
      username: 'tester',
      auth: { method: 'password' },
      displayName: 'prod db'
    })
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected a saved profile')
    }
    return created.workspace.selectedProfileId
  }

  async function lastAttempt(
    profiles: ProfileApi,
    profileId: string
  ): Promise<ConnectionAttemptSummary | null> {
    const loaded = await profiles.load()
    return loaded.profiles.find((profile) => profile.id === profileId)?.lastAttempt ?? null
  }

  async function openFromProfile(
    ssh: SshApi,
    profileId: string,
    sender: SshSender,
    secret = 'secret-password'
  ): Promise<string> {
    const first = await ssh.connectFromProfile({ profileId, secret, cols: 80, rows: 24 }, sender)
    if (first.ok) {
      return first.sessionId
    }
    if (first.reason !== 'host-unknown') {
      throw new Error(`expected host-unknown, got ${JSON.stringify(first)}`)
    }
    const trusted = await ssh.confirmHostKey(first.sessionId, 'trust-always', sender)
    if (!trusted.ok) {
      throw new Error(`expected a live session, got ${JSON.stringify(trusted)}`)
    }
    return trusted.sessionId
  }

  it('does not start a Connection Attempt when the local secret is missing', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-attempt-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()
    const profileId = await savePassword(profiles, server.port)

    const result = await ssh.connectFromProfile({ profileId, cols: 80, rows: 24 }, { id: 1 })
    expect(result).toEqual({ ok: false, reason: 'secret-required', kind: 'password' })
    expect(await lastAttempt(profiles, profileId)).toBe(null)
  })

  it('does not start a Connection Attempt when an encrypted key has no passphrase', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-attempt-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    const clientKeyPath = join(userDataPath, 'id_ed25519')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', clientKeyPath, '-N', 'key-passphrase', '-q'])
    server = await startServer(hostKey.pem)
    const profiles = createProfileApi({
      userDataPath: userDataPath,
      now,
      dialogs: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [clientKeyPath] })
      }
    })
    const picked = await profiles.pickPrivateKey()
    if (picked === null) {
      throw new Error('expected a key pick')
    }
    const created = await profiles.create({
      host: '127.0.0.1',
      port: server.port,
      username: 'tester',
      auth: { method: 'privateKey', keyRef: picked.keyRef },
      displayName: 'encrypted'
    })
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected a key profile')
    }
    const ssh = createSshApi({
      userDataPath: userDataPath,
      dialogs: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] })
      },
      emitTo: () => undefined,
      resolveProfile: (profileId) => profiles.getConnectTarget(profileId),
      recordAttempt: (profileId, summary) => profiles.recordAttempt(profileId, summary),
      now
    })
    sshApi = ssh

    const result = await ssh.connectFromProfile(
      { profileId: created.workspace.selectedProfileId, cols: 80, rows: 24 },
      { id: 1 }
    )
    expect(result).toEqual({ ok: false, reason: 'secret-required', kind: 'passphrase' })
    expect(await lastAttempt(profiles, created.workspace.selectedProfileId)).toBe(null)
  })

  it('does not persist an attempt while Host Trust is still pending', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-attempt-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()
    const profileId = await savePassword(profiles, server.port)

    const unknown = await ssh.connectFromProfile(
      { profileId, secret: 'secret-password', cols: 80, rows: 24 },
      { id: 1 }
    )
    expect(unknown).toMatchObject({ ok: false, reason: 'host-unknown' })
    expect(await lastAttempt(profiles, profileId)).toBe(null)
  })

  it('records canceled when a pending network attempt is canceled', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-attempt-ssh-'))
    tcp = await listenTcp(() => undefined)
    const { profiles, ssh } = await wired()
    const profileId = await savePassword(profiles, tcp.port)
    const sender: SshSender = { id: 1 }

    const pending = ssh.connectFromProfile(
      { profileId, secret: 'secret-password', cols: 80, rows: 24 },
      sender
    )
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
    await ssh.cancel(profileId, sender)
    expect(
      await Promise.race([pending, neverSettles('pending connect hung after cancel')])
    ).toEqual({
      ok: false,
      reason: 'canceled',
      message: 'canceled'
    })

    await vi.waitFor(async () => {
      expect(await lastAttempt(profiles, profileId)).toEqual({
        startedAt: '2026-08-31T12:00:00.000Z',
        endedAt: '2026-08-31T12:00:00.000Z',
        outcome: 'canceled'
      })
    })
  })

  it('records canceled when unknown-host verification is aborted', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-attempt-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()
    const profileId = await savePassword(profiles, server.port)
    const sender: SshSender = { id: 1 }

    const unknown = await ssh.connectFromProfile(
      { profileId, secret: 'secret-password', cols: 80, rows: 24 },
      sender
    )
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    expect(await ssh.confirmHostKey(unknown.sessionId, 'abort', sender)).toEqual({
      ok: false,
      reason: 'canceled',
      message: 'canceled'
    })
    expect(await lastAttempt(profiles, profileId)).toMatchObject({
      startedAt: expect.any(String),
      endedAt: expect.any(String),
      outcome: 'canceled'
    })
  })

  it('records start and connected times when a shell opens, then operator disconnected', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-attempt-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()
    const profileId = await savePassword(profiles, server.port)
    const sender: SshSender = { id: 1 }

    const sessionId = await openFromProfile(ssh, profileId, sender)
    const connected = await lastAttempt(profiles, profileId)
    expect(connected).toEqual({
      startedAt: '2026-08-31T12:00:00.000Z',
      connectedAt: '2026-08-31T12:00:00.000Z'
    })

    advance(5_000)
    await ssh.disconnect(sessionId, sender)
    expect(await lastAttempt(profiles, profileId)).toEqual({
      startedAt: '2026-08-31T12:00:00.000Z',
      connectedAt: '2026-08-31T12:00:00.000Z',
      endedAt: '2026-08-31T12:00:05.000Z',
      outcome: 'operator-disconnected'
    })
  })

  it('records remote session ended when the remote shell closes', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-attempt-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    const { profiles, ssh } = await wired(emits)
    const profileId = await savePassword(profiles, server.port)

    await openFromProfile(ssh, profileId, { id: 1 })
    advance(2_000)
    server.closeLastShell()

    await vi.waitFor(async () => {
      const attempt = await lastAttempt(profiles, profileId)
      if (attempt?.outcome !== 'remote-session-ended') {
        throw new Error(`expected remote session ended, got ${JSON.stringify(attempt)}`)
      }
    })
    expect(await lastAttempt(profiles, profileId)).toMatchObject({
      startedAt: expect.any(String),
      connectedAt: expect.any(String),
      endedAt: expect.any(String),
      outcome: 'remote-session-ended'
    })
  })

  it('records authentication failed without writing transport text to disk', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-attempt-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()
    const profileId = await savePassword(profiles, server.port)
    const sender: SshSender = { id: 1 }

    const sessionId = await openFromProfile(ssh, profileId, sender)
    await ssh.disconnect(sessionId, sender)

    const failed = await ssh.connectFromProfile(
      { profileId, secret: 'wrong-password', cols: 80, rows: 24 },
      sender
    )
    expect(failed).toMatchObject({ ok: false, reason: 'auth-failed' })
    await vi.waitFor(async () => {
      expect(await lastAttempt(profiles, profileId)).toMatchObject({
        startedAt: expect.any(String),
        endedAt: expect.any(String),
        outcome: 'authentication-failed'
      })
    })
    expect(await lastAttempt(profiles, profileId)).not.toHaveProperty('connectedAt')
    if (failed.ok || failed.reason !== 'auth-failed') {
      throw new Error('expected auth-failed')
    }
    expect(filesContain(userDataPath, failed.message)).toBe(false)
    const document = await readFile(join(userDataPath, WORKSPACE_PRIMARY), 'utf8')
    expect(document).not.toContain(failed.message)
  })

  it('records timed out when the peer never sends an SSH banner', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-attempt-ssh-'))
    tcp = await listenTcp(() => undefined)
    const { profiles, ssh } = await wired(undefined, { authTimeoutMs: 80 })
    const profileId = await savePassword(profiles, tcp.port)

    const result = await Promise.race([
      ssh.connectFromProfile(
        { profileId, secret: 'secret-password', cols: 80, rows: 24 },
        { id: 1 }
      ),
      neverSettles('connect hung waiting for SSH banner')
    ])
    expect(result).toMatchObject({ ok: false, reason: 'timeout' })
    await vi.waitFor(async () => {
      expect(await lastAttempt(profiles, profileId)).toMatchObject({
        outcome: 'timed-out',
        startedAt: expect.any(String),
        endedAt: expect.any(String)
      })
    })
  })

  it('records network failed when the peer closes before host verification', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-attempt-ssh-'))
    tcp = await listenTcp((socket) => {
      socket.end()
    })
    const { profiles, ssh } = await wired()
    const profileId = await savePassword(profiles, tcp.port)

    const result = await Promise.race([
      ssh.connectFromProfile(
        { profileId, secret: 'secret-password', cols: 80, rows: 24 },
        { id: 1 }
      ),
      neverSettles('connect hung after peer EOF')
    ])
    expect(result).toMatchObject({ ok: false, reason: 'network' })
    await vi.waitFor(async () => {
      expect(await lastAttempt(profiles, profileId)).toMatchObject({
        outcome: 'network-failed',
        startedAt: expect.any(String),
        endedAt: expect.any(String)
      })
    })
  })

  it('records host key rejected when a changed host key is aborted', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-attempt-ssh-'))
    const firstHostKey = generateHostKey(userDataPath, 'host-a')
    const changedHostKey = generateHostKey(userDataPath, 'host-b')
    server = await startServer(firstHostKey.pem)
    const { profiles, ssh } = await wired()
    const profileId = await savePassword(profiles, server.port)
    const sender: SshSender = { id: 1 }

    const sessionId = await openFromProfile(ssh, profileId, sender)
    await ssh.disconnect(sessionId, sender)
    const port = server.port
    await server.close()
    server = await startServer(changedHostKey.pem, { port })

    const changed = await ssh.connectFromProfile(
      { profileId, secret: 'secret-password', cols: 80, rows: 24 },
      sender
    )
    if (changed.ok || changed.reason !== 'host-changed') {
      throw new Error(`expected host-changed, got ${JSON.stringify(changed)}`)
    }
    await ssh.confirmHostKey(changed.sessionId, 'abort', sender)

    expect(await lastAttempt(profiles, profileId)).toMatchObject({
      outcome: 'host-key-rejected',
      startedAt: expect.any(String),
      endedAt: expect.any(String)
    })
  })

  it('keeps only the latest summary for a profile', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-attempt-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()
    const profileId = await savePassword(profiles, server.port)
    const sender: SshSender = { id: 1 }

    const first = await openFromProfile(ssh, profileId, sender)
    await ssh.disconnect(first, sender)
    expect((await lastAttempt(profiles, profileId))?.outcome).toBe('operator-disconnected')

    const second = await openFromProfile(ssh, profileId, sender)
    await ssh.disconnect(second, sender)
    const latest = await lastAttempt(profiles, profileId)
    expect(latest?.outcome).toBe('operator-disconnected')

    const document = JSON.parse(await readFile(join(userDataPath, WORKSPACE_PRIMARY), 'utf8')) as {
      latestAttempts: Record<string, unknown>
    }
    expect(Object.keys(document.latestAttempts)).toEqual([profileId])
  })

  it('finalizes a dangling connected attempt as interrupted on the next launch', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-attempt-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()
    const profileId = await savePassword(profiles, server.port)

    await openFromProfile(ssh, profileId, { id: 1 })
    expect(await lastAttempt(profiles, profileId)).toMatchObject({
      connectedAt: expect.any(String)
    })
    expect((await lastAttempt(profiles, profileId))?.endedAt).toBeUndefined()
    expect((await lastAttempt(profiles, profileId))?.outcome).toBeUndefined()

    const recoveredAt = new Date('2026-08-31T15:42:00.000Z')
    const relaunched = createProfileApi({
      userDataPath: userDataPath,
      now: () => recoveredAt
    })
    expect(await lastAttempt(relaunched, profileId)).toEqual({
      startedAt: '2026-08-31T12:00:00.000Z',
      connectedAt: '2026-08-31T12:00:00.000Z',
      endedAt: '2026-08-31T15:42:00.000Z',
      outcome: 'interrupted-by-previous-app-exit'
    })
  })

  it('does not finalize a live shell on dispose, so the next launch can mark it interrupted', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-attempt-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()
    const profileId = await savePassword(profiles, server.port)

    await openFromProfile(ssh, profileId, { id: 1 })
    ssh.dispose()
    sshApi = undefined

    const recoveredAt = new Date('2026-08-31T15:42:00.000Z')
    const relaunched = createProfileApi({
      userDataPath: userDataPath,
      now: () => recoveredAt
    })
    expect(await lastAttempt(relaunched, profileId)).toEqual({
      startedAt: '2026-08-31T12:00:00.000Z',
      connectedAt: '2026-08-31T12:00:00.000Z',
      endedAt: '2026-08-31T15:42:00.000Z',
      outcome: 'interrupted-by-previous-app-exit'
    })
  })
})

import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProfileApi, type ProfileApi } from '../profiles/create-profile-api'
import { createSshApi, type SshApi, type SshSender } from './create-ssh-api'
import {
  type CapturedEmit,
  type TestServer,
  emitsHaveChunk,
  filesContain,
  generateHostKey,
  isRecord,
  startServer,
  waitForServerBytes
} from './ssh-test-fixture'

describe('connectFromProfile', () => {
  let userDataPath: string | undefined
  let sshApi: SshApi | undefined
  let server: TestServer | undefined

  let pickKeyPath: string | undefined

  afterEach(async () => {
    sshApi?.dispose()
    sshApi = undefined
    pickKeyPath = undefined
    if (server) {
      await server.close()
      server = undefined
    }
    if (userDataPath) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = undefined
    }
  })

  async function wired(emits?: CapturedEmit[]): Promise<{
    profiles: ProfileApi
    ssh: SshApi
  }> {
    const dir = userDataPath ?? (await mkdtemp(join(tmpdir(), 'picaglass-profile-ssh-')))
    userDataPath = dir
    const profiles = createProfileApi({
      userDataPath: dir,
      dialogs: {
        showOpenDialog: async () =>
          pickKeyPath === undefined
            ? { canceled: true, filePaths: [] }
            : { canceled: false, filePaths: [pickKeyPath] }
      }
    })
    const ssh = createSshApi({
      userDataPath: dir,
      dialogs: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        showMessageBox: async () => ({ response: 0 })
      },
      emitTo: (_senderId, channel, payload) => {
        emits?.push({ channel, payload: structuredClone(payload) })
      },
      resolveProfile: (profileId) => profiles.getConnectTarget(profileId)
    })
    sshApi = ssh
    return { profiles, ssh }
  }

  async function openFromProfile(
    ssh: SshApi,
    profileId: string,
    sender: SshSender,
    secret?: string
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

  it('opens a live SSH Session from a saved password Connection Profile', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-profile-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()
    const created = await profiles.create({
      host: '127.0.0.1',
      port: server.port,
      username: 'tester',
      auth: { method: 'password' }
    })
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error(`expected a saved profile, got ${JSON.stringify(created)}`)
    }

    const sessionId = await openFromProfile(
      ssh,
      created.workspace.selectedProfileId,
      { id: 1 },
      'secret-password'
    )

    expect(sessionId).toEqual(expect.any(String))
    expect(server.shellOpened()).toBe(true)
  })

  it('does not start a Connection Attempt when a password profile is missing its secret', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-profile-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()
    const created = await profiles.create({
      host: '127.0.0.1',
      port: server.port,
      username: 'tester',
      auth: { method: 'password' }
    })
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected a saved profile')
    }

    const result = await ssh.connectFromProfile(
      { profileId: created.workspace.selectedProfileId, cols: 80, rows: 24 },
      { id: 1 }
    )

    expect(result).toEqual({ ok: false, reason: 'secret-required', kind: 'password' })
    expect(server.liveConnections()).toBe(0)
    expect(server.shellOpened()).toBe(false)
  })

  it('returns auth-failed for a wrong password and lets a retry open the session', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-profile-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()
    const created = await profiles.create({
      host: '127.0.0.1',
      port: server.port,
      username: 'tester',
      auth: { method: 'password' }
    })
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected a saved profile')
    }
    const profileId = created.workspace.selectedProfileId
    const sender: SshSender = { id: 1 }

    const unknown = await ssh.connectFromProfile(
      { profileId, secret: 'wrong-password', cols: 80, rows: 24 },
      sender
    )
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error(`expected host-unknown, got ${JSON.stringify(unknown)}`)
    }
    const failed = await ssh.confirmHostKey(unknown.sessionId, 'trust-always', sender)
    expect(failed).toEqual({
      ok: false,
      reason: 'auth-failed',
      message: expect.any(String)
    })
    expect(server.shellOpened()).toBe(false)

    const retry = await ssh.connectFromProfile(
      { profileId, secret: 'secret-password', cols: 80, rows: 24 },
      sender
    )
    expect(retry).toEqual({ ok: true, sessionId: expect.any(String) })
    expect(server.shellOpened()).toBe(true)
  })

  it('never writes an Authentication Secret to the workspace document', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-profile-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()
    const created = await profiles.create({
      host: '127.0.0.1',
      port: server.port,
      username: 'tester',
      auth: { method: 'password' }
    })
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected a saved profile')
    }

    await openFromProfile(ssh, created.workspace.selectedProfileId, { id: 1 }, 'secret-password')

    expect(filesContain(userDataPath, 'secret-password')).toBe(false)
  })

  it('tags session data with the Connection Profile identity', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-profile-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    const { profiles, ssh } = await wired(emits)
    const created = await profiles.create({
      host: '127.0.0.1',
      port: server.port,
      username: 'tester',
      auth: { method: 'password' }
    })
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected a saved profile')
    }
    const profileId = created.workspace.selectedProfileId
    const sessionId = await openFromProfile(ssh, profileId, { id: 1 }, 'secret-password')

    const data = emits.find((event) => event.channel === 'ssh:data')
    expect(data?.payload).toMatchObject({ sessionId, profileId })
    const connected = emits.find(
      (event) =>
        event.channel === 'ssh:status' &&
        isRecord(event.payload) &&
        event.payload.type === 'connected'
    )
    expect(connected?.payload).toMatchObject({ sessionId, profileId, type: 'connected' })
  })

  async function saveKeyProfile(
    profiles: ProfileApi,
    keyPath: string,
    port: number,
    username = 'tester'
  ): Promise<string> {
    pickKeyPath = keyPath
    const picked = await profiles.pickPrivateKey()
    pickKeyPath = undefined
    if (picked === null) {
      throw new Error('expected a key pick')
    }
    const created = await profiles.create({
      host: '127.0.0.1',
      port,
      username,
      auth: { method: 'privateKey', keyRef: picked.keyRef }
    })
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error(`expected a saved key profile, got ${JSON.stringify(created)}`)
    }
    return created.workspace.selectedProfileId
  }

  it('opens a live SSH Session from an unencrypted private-key profile without a secret', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-profile-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    const clientKeyPath = join(userDataPath, 'id_ed25519')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', clientKeyPath, '-N', '', '-q'])
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()
    const profileId = await saveKeyProfile(profiles, clientKeyPath, server.port)

    const sessionId = await openFromProfile(ssh, profileId, { id: 1 })

    expect(sessionId).toEqual(expect.any(String))
    expect(server.shellOpened()).toBe(true)
  })

  it('does not start a Connection Attempt when an encrypted key has no passphrase', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-profile-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    const clientKeyPath = join(userDataPath, 'id_ed25519')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', clientKeyPath, '-N', 'key-passphrase', '-q'])
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()
    const profileId = await saveKeyProfile(profiles, clientKeyPath, server.port)

    const result = await ssh.connectFromProfile({ profileId, cols: 80, rows: 24 }, { id: 1 })

    expect(result).toEqual({ ok: false, reason: 'secret-required', kind: 'passphrase' })
    expect(server.liveConnections()).toBe(0)
    expect(server.shellOpened()).toBe(false)
  })

  it('opens a live SSH Session from an encrypted private-key profile with a passphrase', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-profile-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    const clientKeyPath = join(userDataPath, 'id_ed25519')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', clientKeyPath, '-N', 'key-passphrase', '-q'])
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()
    const profileId = await saveKeyProfile(profiles, clientKeyPath, server.port)

    const sessionId = await openFromProfile(ssh, profileId, { id: 1 }, 'key-passphrase')

    expect(sessionId).toEqual(expect.any(String))
    expect(server.shellOpened()).toBe(true)
    expect(filesContain(userDataPath, 'key-passphrase')).toBe(false)
  })

  it('holds live sessions on two Connection Profiles at once, each with independent output', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-profile-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    const { profiles, ssh } = await wired(emits)
    const first = await profiles.create({
      host: '127.0.0.1',
      port: server.port,
      username: 'tester',
      auth: { method: 'password' },
      displayName: 'alpha'
    })
    const second = await profiles.create({
      host: '127.0.0.1',
      port: server.port,
      username: 'tester',
      auth: { method: 'password' },
      displayName: 'beta',
      saveAnyway: true
    })
    if (!first.ok || first.workspace.selectedProfileId === null) {
      throw new Error('expected first profile')
    }
    if (!second.ok || second.workspace.selectedProfileId === null) {
      throw new Error('expected second profile')
    }
    const owner: SshSender = { id: 1 }
    const firstId = await openFromProfile(
      ssh,
      first.workspace.selectedProfileId,
      owner,
      'secret-password'
    )
    const secondId = await openFromProfile(
      ssh,
      second.workspace.selectedProfileId,
      owner,
      'secret-password'
    )
    expect(firstId).not.toBe(secondId)
    expect(server.liveConnections()).toBe(2)

    const probeA = Uint8Array.from([0x61])
    const probeB = Uint8Array.from([0x62])
    ssh.write(firstId, probeA, owner)
    ssh.write(secondId, probeB, owner)
    await waitForServerBytes(server, probeA)
    await waitForServerBytes(server, probeB)
    await vi.waitFor(() => {
      if (!emitsHaveChunk(emits, probeA) || !emitsHaveChunk(emits, probeB)) {
        throw new Error('both profile sessions did not echo')
      }
    })
  })

  it('reports which Authentication Secret a saved profile needs before connecting', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-profile-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    const plainKey = join(userDataPath, 'plain')
    const encKey = join(userDataPath, 'enc')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', plainKey, '-N', '', '-q'])
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', encKey, '-N', 'key-passphrase', '-q'])
    server = await startServer(hostKey.pem)
    const { profiles, ssh } = await wired()

    const password = await profiles.create({
      host: '127.0.0.1',
      port: server.port,
      username: 'tester',
      auth: { method: 'password' },
      displayName: 'password'
    })
    const plainId = await saveKeyProfile(profiles, plainKey, server.port, 'plain')
    const encId = await saveKeyProfile(profiles, encKey, server.port, 'enc')
    if (!password.ok || password.workspace.selectedProfileId === null) {
      throw new Error('expected password profile')
    }

    await expect(ssh.secretRequirement(password.workspace.selectedProfileId)).resolves.toEqual({
      ok: true,
      kind: 'password'
    })
    await expect(ssh.secretRequirement(plainId)).resolves.toEqual({ ok: true, kind: 'none' })
    await expect(ssh.secretRequirement(encId)).resolves.toEqual({ ok: true, kind: 'passphrase' })
    await expect(ssh.secretRequirement('missing')).resolves.toEqual({
      ok: false,
      reason: 'unknown-profile'
    })
    expect(server.liveConnections()).toBe(0)
  })
})

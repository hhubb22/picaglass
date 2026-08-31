import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSshApi, type SshApi, type SshSender } from '../ssh/create-ssh-api'
import {
  type CapturedEmit,
  type TestServer,
  generateHostKey,
  startServer
} from '../ssh/ssh-test-fixture'
import { createProfileApi, type ProfileApi } from './create-profile-api'

describe('profile edit and delete against a live SSH Session', () => {
  let userDataPath: string | undefined
  let sshApi: SshApi | undefined
  let servers: TestServer[] = []
  let pickKeyPath: string | undefined

  afterEach(async () => {
    sshApi?.dispose()
    sshApi = undefined
    pickKeyPath = undefined
    for (const server of servers) {
      await server.close()
    }
    servers = []
    if (userDataPath) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = undefined
    }
  })

  async function listen(hostKeyPem: string): Promise<TestServer> {
    const server = await startServer(hostKeyPem)
    servers.push(server)
    return server
  }

  async function wired(emits?: CapturedEmit[]): Promise<{
    profiles: ProfileApi
    ssh: SshApi
  }> {
    const dir = userDataPath ?? (await mkdtemp(join(tmpdir(), 'picaglass-profile-edit-')))
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
        showOpenDialog: async () => ({ canceled: true, filePaths: [] })
      },
      emitTo: (_senderId, channel, payload) => {
        emits?.push({ channel, payload: structuredClone(payload) })
      },
      resolveProfile: (profileId) => profiles.getConnectTarget(profileId)
    })
    profiles.setSessionHooks({
      isOccupied: (profileId) => ssh.hasSession(profileId),
      dropSession: async (profileId) => {
        ssh.dropProfileSession(profileId)
      }
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

  async function saveKeyProfile(
    profiles: ProfileApi,
    keyPath: string,
    port: number
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
      username: 'tester',
      auth: { method: 'privateKey', keyRef: picked.keyRef }
    })
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error(`expected a saved key profile, got ${JSON.stringify(created)}`)
    }
    return created.workspace.selectedProfileId
  }

  it('disconnects a live SSH Session on delete and leaves shared Trusted Host Keys in place', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-profile-edit-'))
    const hostKey = generateHostKey(userDataPath)
    const server = await listen(hostKey.pem)
    const { profiles, ssh } = await wired()
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
    await openFromProfile(ssh, first.workspace.selectedProfileId, owner, 'secret-password')
    expect(server.liveConnections()).toBe(1)
    expect(ssh.hasSession(first.workspace.selectedProfileId)).toBe(true)

    const deleted = await profiles.delete(first.workspace.selectedProfileId)
    expect(deleted.ok).toBe(true)
    await vi.waitFor(() => {
      if (server && server.liveConnections() !== 0) {
        throw new Error('deleted profile session is still live')
      }
    })
    expect(ssh.hasSession(first.workspace.selectedProfileId)).toBe(false)
    expect(existsSync(join(userDataPath, 'ssh', 'known_hosts'))).toBe(true)

    const remaining = await ssh.connectFromProfile(
      {
        profileId: second.workspace.selectedProfileId,
        secret: 'secret-password',
        cols: 80,
        rows: 24
      },
      owner
    )
    expect(remaining).toEqual({ ok: true, sessionId: expect.any(String) })
    expect(server.liveConnections()).toBe(1)
  })

  it('blocks Connect when the private-key file is missing, then replace-and-continue opens a session', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-profile-edit-'))
    const hostKey = generateHostKey(userDataPath)
    const missingKey = join(userDataPath, 'missing')
    const replacement = join(userDataPath, 'replacement')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', missingKey, '-N', '', '-q'])
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', replacement, '-N', '', '-q'])
    const server = await listen(hostKey.pem)
    const { profiles, ssh } = await wired()
    const profileId = await saveKeyProfile(profiles, missingKey, server.port)
    await unlink(missingKey)

    await expect(ssh.secretRequirement(profileId)).resolves.toEqual({
      ok: false,
      reason: 'cannot-read-key'
    })
    const blocked = await ssh.connectFromProfile({ profileId, cols: 80, rows: 24 }, { id: 1 })
    expect(blocked.ok).toBe(false)
    expect(server.liveConnections()).toBe(0)

    pickKeyPath = replacement
    const replaced = await profiles.replacePrivateKey(profileId)
    expect(replaced.ok).toBe(true)
    if (!replaced.ok) {
      throw new Error('expected replace to succeed')
    }
    expect(JSON.stringify(replaced.workspace)).not.toContain(replacement)

    const sessionId = await openFromProfile(ssh, profileId, { id: 1 })
    expect(sessionId).toEqual(expect.any(String))
    expect(server.shellOpened()).toBe(true)
  })

  it('resolves Trusted Host Key for a new endpoint after a host change without dropping the old Trusted Host Key', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-profile-edit-'))
    const hostKey = generateHostKey(userDataPath)
    const otherHostKey = generateHostKey(userDataPath, 'other-host')
    const original = await listen(hostKey.pem)
    const nextEndpoint = await listen(otherHostKey.pem)
    const { profiles, ssh } = await wired()
    const moved = await profiles.create({
      host: '127.0.0.1',
      port: original.port,
      username: 'tester',
      auth: { method: 'password' },
      displayName: 'moved'
    })
    const stays = await profiles.create({
      host: '127.0.0.1',
      port: original.port,
      username: 'tester',
      auth: { method: 'password' },
      displayName: 'stays',
      saveAnyway: true
    })
    if (!moved.ok || moved.workspace.selectedProfileId === null) {
      throw new Error('expected moved profile')
    }
    if (!stays.ok || stays.workspace.selectedProfileId === null) {
      throw new Error('expected stays profile')
    }
    const owner: SshSender = { id: 1 }
    const live = await openFromProfile(
      ssh,
      moved.workspace.selectedProfileId,
      owner,
      'secret-password'
    )
    await ssh.disconnect(live, owner)
    await vi.waitFor(() => {
      if (ssh.hasSession(moved.workspace.selectedProfileId as string)) {
        throw new Error('session still occupied')
      }
    })

    const updated = await profiles.update({
      profileId: moved.workspace.selectedProfileId,
      host: '127.0.0.1',
      port: nextEndpoint.port,
      username: 'tester',
      auth: { method: 'password' },
      displayName: 'moved'
    })
    expect(updated.ok).toBe(true)

    const unknown = await ssh.connectFromProfile(
      {
        profileId: moved.workspace.selectedProfileId,
        secret: 'secret-password',
        cols: 80,
        rows: 24
      },
      owner
    )
    expect(unknown).toMatchObject({ ok: false, reason: 'host-unknown' })
    if (!unknown.ok && unknown.reason === 'host-unknown') {
      await ssh.confirmHostKey(unknown.sessionId, 'abort', owner)
    }

    const remembered = await ssh.connectFromProfile(
      {
        profileId: stays.workspace.selectedProfileId,
        secret: 'secret-password',
        cols: 80,
        rows: 24
      },
      owner
    )
    expect(remembered).toEqual({ ok: true, sessionId: expect.any(String) })
  })
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MACHINE_SNAPSHOT_COMMAND,
  MACHINE_SNAPSHOT_OUTPUT_CAP_BYTES,
  type MachineSnapshot
} from '../../shared/machine-snapshot'
import { createProfileApi, type ProfileApi } from '../profiles/create-profile-api'
import { createSshApi, type SshApi, type SshSender } from './create-ssh-api'
import {
  type CapturedEmit,
  type TestExecResponse,
  type TestServer,
  emitsHaveChunk,
  generateHostKey,
  isRecord,
  startServer,
  waitForServerBytes
} from './ssh-test-fixture'

describe('bounded Machine Snapshot discovery', () => {
  let userDataPath: string | undefined
  let sshApi: SshApi | undefined
  let server: TestServer | undefined

  afterEach(async () => {
    sshApi?.dispose()
    sshApi = undefined
    if (server) {
      await server.close()
      server = undefined
    }
    if (userDataPath) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = undefined
    }
  })

  async function wired(
    emits: CapturedEmit[],
    exec: (command: string) => TestExecResponse,
    extras?: { discoveryTimeoutMs?: number }
  ): Promise<{ profiles: ProfileApi; ssh: SshApi }> {
    const dir = await mkdtemp(join(tmpdir(), 'picaglass-discovery-'))
    userDataPath = dir
    const hostKey = generateHostKey(dir)
    server = await startServer(hostKey.pem, { exec })
    const profiles = createProfileApi({ userDataPath: dir })
    const ssh = createSshApi({
      userDataPath: dir,
      dialogs: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] })
      },
      emitTo: (_senderId, channel, payload) => {
        emits.push({ channel, payload: structuredClone(payload) })
      },
      discoveryTimeoutMs: extras?.discoveryTimeoutMs,
      resolveProfile: (profileId) => profiles.getConnectTarget(profileId),
      readSnapshot: (profileId) => profiles.getSnapshot(profileId),
      recordSnapshot: async (profileId, snapshot) => {
        await profiles.recordSnapshot(profileId, snapshot)
      }
    })
    sshApi = ssh
    return { profiles, ssh }
  }

  async function saveAndOpen(
    profiles: ProfileApi,
    ssh: SshApi,
    sender: SshSender,
    overrides?: {
      automaticDiscovery?: boolean
      displayName?: string
      username?: string
      host?: string
    }
  ): Promise<{ profileId: string; sessionId: string }> {
    if (server === undefined) {
      throw new Error('expected a test server')
    }
    const created = await profiles.create({
      displayName: overrides?.displayName ?? 'prod db',
      host: overrides?.host ?? '127.0.0.1',
      port: server.port,
      username: overrides?.username ?? 'tester',
      auth: { method: 'password' },
      automaticDiscovery: overrides?.automaticDiscovery
    })
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error(`expected a saved profile, got ${JSON.stringify(created)}`)
    }
    const profileId = created.workspace.selectedProfileId
    const first = await ssh.connectFromProfile(
      { profileId, secret: 'secret-password', cols: 80, rows: 24 },
      sender
    )
    if (first.ok) {
      return { profileId, sessionId: first.sessionId }
    }
    if (first.reason !== 'host-unknown') {
      throw new Error(`expected host-unknown, got ${JSON.stringify(first)}`)
    }
    const trusted = await ssh.confirmHostKey(first.sessionId, 'trust-always', sender)
    if (!trusted.ok) {
      throw new Error(`expected a live session, got ${JSON.stringify(trusted)}`)
    }
    return { profileId, sessionId: trusted.sessionId }
  }

  async function waitForSnapshot(
    emits: CapturedEmit[],
    profileId: string
  ): Promise<MachineSnapshot> {
    return vi.waitFor(() => {
      for (let i = emits.length - 1; i >= 0; i -= 1) {
        const event = emits[i]
        if (event === undefined || event.channel !== 'ssh:snapshot' || !isRecord(event.payload)) {
          continue
        }
        if (event.payload.profileId !== profileId || !isRecord(event.payload.snapshot)) {
          continue
        }
        return event.payload.snapshot as MachineSnapshot
      }
      throw new Error('no Machine Snapshot event yet')
    })
  }

  async function assertShellStillLive(
    ssh: SshApi,
    sessionId: string,
    sender: SshSender,
    emits: CapturedEmit[],
    probe: Uint8Array
  ): Promise<void> {
    if (server === undefined) {
      throw new Error('expected a test server')
    }
    ssh.write(sessionId, probe, sender)
    await waitForServerBytes(server, probe)
    await vi.waitFor(() => {
      if (!emitsHaveChunk(emits, probe)) {
        throw new Error('interactive session did not echo after discovery')
      }
    })
  }

  it('runs the fixed no-PTY command after connect and records a complete snapshot', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh } = await wired(emits, () => ({
      stdout: 'web-1\nLinux\n6.8.0-1-amd64\nx86_64\n'
    }))
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender, {
      username: 'tester$(reboot)',
      host: '127.0.0.1'
    })

    const snapshot = await waitForSnapshot(emits, profileId)

    expect(server?.execs()).toEqual([{ command: MACHINE_SNAPSHOT_COMMAND, ptyRequested: false }])
    expect(snapshot).toMatchObject({
      hostname: 'web-1',
      kernelName: 'Linux',
      kernelRelease: '6.8.0-1-amd64',
      architecture: 'x86_64'
    })
    expect(snapshot.observedAt).toEqual(expect.any(String))
    expect(snapshot.failedRefreshAt).toBeUndefined()
    const loaded = await profiles.load()
    expect(loaded.profiles[0]?.snapshot).toMatchObject({
      hostname: 'web-1',
      kernelName: 'Linux',
      kernelRelease: '6.8.0-1-amd64',
      architecture: 'x86_64'
    })
    expect(loaded.profiles[0]?.label).toBe('prod db')
    const relaunched = createProfileApi({ userDataPath: userDataPath as string })
    const again = await relaunched.load()
    expect(again.profiles[0]?.snapshot).toMatchObject({
      hostname: 'web-1',
      kernelName: 'Linux',
      observedAt: loaded.profiles[0]?.snapshot?.observedAt
    })
    expect(again.profiles[0]?.label).toBe('prod db')
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x41]))
  })

  it('replaces with partial facts and never merges older fields', async () => {
    const emits: CapturedEmit[] = []
    let round = 0
    const { profiles, ssh } = await wired(emits, () => {
      round += 1
      if (round === 1) {
        return { stdout: 'web-1\nLinux\n6.8.0-1-amd64\nx86_64\n' }
      }
      return { stdout: 'web-2\nLinux\n' }
    })
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender)
    await waitForSnapshot(emits, profileId)

    await ssh.refreshDiscovery(profileId, sender)
    const snapshot = await vi.waitFor(async () => {
      const current = await profiles.getSnapshot(profileId)
      if (current?.hostname !== 'web-2') {
        throw new Error(`still ${JSON.stringify(current)}`)
      }
      return current
    })

    expect(snapshot).toEqual({
      hostname: 'web-2',
      kernelName: 'Linux',
      observedAt: snapshot.observedAt
    })
    expect(snapshot.kernelRelease).toBeUndefined()
    expect(snapshot.architecture).toBeUndefined()
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x42]))
  })

  it('preserves the older snapshot as Last observed when discovery times out', async () => {
    const emits: CapturedEmit[] = []
    let round = 0
    const { profiles, ssh } = await wired(
      emits,
      () => {
        round += 1
        if (round === 1) {
          return { stdout: 'web-1\nLinux\n6.8.0-1-amd64\nx86_64\n' }
        }
        return { hang: true }
      },
      { discoveryTimeoutMs: 500 }
    )
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender)
    const first = await waitForSnapshot(emits, profileId)
    expect(first.hostname).toBe('web-1')

    await ssh.refreshDiscovery(profileId, sender)
    const snapshot = await vi.waitFor(async () => {
      const current = await profiles.getSnapshot(profileId)
      if (current?.failedRefreshAt === undefined) {
        throw new Error('expected a failed refresh time')
      }
      return current
    })

    expect(snapshot.hostname).toBe('web-1')
    expect(snapshot.kernelName).toBe('Linux')
    expect(snapshot.kernelRelease).toBe('6.8.0-1-amd64')
    expect(snapshot.architecture).toBe('x86_64')
    expect(snapshot.observedAt).toBe(first.observedAt)
    expect(snapshot.failedRefreshAt).toEqual(expect.any(String))
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x43]))
  })

  it('stops at the 32 KiB cap and still isolates the interactive session', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh } = await wired(emits, () => ({
      stdout: Buffer.concat([
        Buffer.from('web-1\nLinux\n6.8.0-1-amd64\nx86_64\n'),
        Buffer.alloc(MACHINE_SNAPSHOT_OUTPUT_CAP_BYTES, 0x41)
      ])
    }))
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender)
    const snapshot = await waitForSnapshot(emits, profileId)

    expect(snapshot).toMatchObject({
      hostname: 'web-1',
      kernelName: 'Linux',
      kernelRelease: '6.8.0-1-amd64',
      architecture: 'x86_64'
    })
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x44]))
  })

  it('reports discovery unavailable for a non-POSIX target without touching the terminal', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh } = await wired(emits, () => ({
      stdout: '',
      stderr: "'uname' is not recognized as an internal or external command",
      exitCode: 1
    }))
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender)
    const snapshot = await waitForSnapshot(emits, profileId)

    expect(snapshot.unavailable).toBe(true)
    expect(snapshot.hostname).toBeUndefined()
    expect(snapshot.failedRefreshAt).toBeUndefined()
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x45]))
  })

  it('sanitizes untrusted exec output and never interpolates profile text into the command', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh } = await wired(emits, () => ({
      stdout: 'web-1\u0000\u0007evil\nLinux\n6.8.0-1-amd64\nx86_64\n'
    }))
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender, {
      username: 'tester;id',
      displayName: 'prod db'
    })
    const snapshot = await waitForSnapshot(emits, profileId)

    expect(server?.execs().map((entry) => entry.command)).toEqual([MACHINE_SNAPSHOT_COMMAND])
    expect(snapshot.hostname).toBe('web-1evil')
    expect(snapshot.hostname?.includes('\u0000')).toBe(false)
  })

  it('does not auto-run when automatic discovery is disabled, and Refresh still probes while connected', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh } = await wired(emits, () => ({
      stdout: 'web-1\nLinux\n6.8.0-1-amd64\nx86_64\n'
    }))
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender, {
      automaticDiscovery: false
    })
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(server?.execs()).toEqual([])

    await ssh.refreshDiscovery(profileId, sender)
    const snapshot = await waitForSnapshot(emits, profileId)
    expect(snapshot.hostname).toBe('web-1')
    expect(server?.execs()).toHaveLength(1)
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x46]))
  })

  it('keeps one discovery request in flight per profile', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh } = await wired(emits, () => ({ hang: true }), {
      discoveryTimeoutMs: 400
    })
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)
    await vi.waitFor(() => {
      if ((server?.execs().length ?? 0) < 1) {
        throw new Error('auto discovery has not started')
      }
    })
    await ssh.refreshDiscovery(profileId, sender)
    await ssh.refreshDiscovery(profileId, sender)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(server?.execs()).toHaveLength(1)
  })

  it('does not close the SSH Session when the exec channel is rejected', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh } = await wired(emits, () => ({ reject: true }))
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender)
    await waitForSnapshot(emits, profileId)
    expect(ssh.hasSession(profileId)).toBe(true)
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x47]))
  })
})

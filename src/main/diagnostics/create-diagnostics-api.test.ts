import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deviceFactsCliCommand } from '../../shared/picos/device-facts'
import { createProfileApi, type ProfileApi } from '../profiles/create-profile-api'
import { createSshApi, type SshApi, type SshSender } from '../ssh/create-ssh-api'
import {
  type CapturedEmit,
  type TestExecResponse,
  type TestServer,
  emitsHaveChunk,
  generateHostKey,
  startServer,
  waitForServerBytes
} from '../ssh/ssh-test-fixture'
import { createDiagnosticsApi, type DiagnosticsApi } from './create-diagnostics-api'

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures/picos', name), 'utf8').trimEnd()
}

function noisyDeviceFactsStdout(): string {
  return [
    'Synchronizing configuration...OK.',
    'NOTICE TO USERS',
    'This is a trial license banner line.',
    'Unauthorized use is prohibited.',
    '',
    'Welcome to PICOS',
    'admin@PICOS> ',
    '.',
    'Execute command: show version | no-more',
    fixture('show-version.txt'),
    'admin@PICOS> ',
    '.',
    'Execute command: show system fan | no-more',
    fixture('show-system-fan.txt'),
    'admin@PICOS> ',
    '.',
    'Execute command: show system temperature | no-more',
    fixture('show-system-temperature.txt'),
    'admin@PICOS> ',
    '.',
    'Execute command: show system rpsu | no-more',
    fixture('show-system-rpsu.txt'),
    'admin@PICOS> '
  ].join('\r\n')
}

describe('device facts diagnostic execution', () => {
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
    extras?: { diagnosticsTimeoutMs?: number }
  ): Promise<{ profiles: ProfileApi; ssh: SshApi; diagnostics: DiagnosticsApi }> {
    const dir = await mkdtemp(join(tmpdir(), 'picaglass-diagnostics-'))
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
      resolveProfile: (profileId) => profiles.getConnectTarget(profileId)
    })
    sshApi = ssh
    const diagnostics = createDiagnosticsApi({
      hasLiveSession: (profileId) => ssh.hasLiveSession(profileId),
      exec: (profileId, command) =>
        ssh.execOnSession(profileId, command, { timeoutMs: extras?.diagnosticsTimeoutMs })
    })
    return { profiles, ssh, diagnostics }
  }

  async function saveAndOpen(
    profiles: ProfileApi,
    ssh: SshApi,
    sender: SshSender
  ): Promise<{ profileId: string; sessionId: string }> {
    if (server === undefined) {
      throw new Error('expected a test server')
    }
    const created = await profiles.create({
      displayName: 'lab switch',
      host: '127.0.0.1',
      port: server.port,
      username: 'tester',
      auth: { method: 'password' },
      automaticDiscovery: false
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
        throw new Error('interactive session did not echo after diagnostics')
      }
    })
  }

  it('does not open an exec channel when there is no active SSH Session', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, diagnostics } = await wired(emits, () => ({ stdout: 'should-not-run' }))
    const created = await profiles.create({
      displayName: 'lab switch',
      host: '127.0.0.1',
      port: server?.port ?? 22,
      username: 'tester',
      auth: { method: 'password' },
      automaticDiscovery: false
    })
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected a saved profile')
    }

    const run = await diagnostics.runDeviceFacts(created.workspace.selectedProfileId)

    expect(run).toEqual({ kind: 'no-session' })
    expect(server?.execs()).toEqual([])
  })

  it('aggregates device-facts commands on one no-PTY exec and parses noisy output', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, (command) => {
      if (command === deviceFactsCliCommand()) {
        return { stdout: noisyDeviceFactsStdout() }
      }
      return { stdout: '', exitCode: 1 }
    })
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender)

    const run = await diagnostics.runDeviceFacts(profileId)

    expect(server?.execs()).toEqual([{ command: deviceFactsCliCommand(), ptyRequested: false }])
    expect(run.kind).toBe('ok')
    if (run.kind !== 'ok') {
      return
    }
    expect(run.block.version.status).toBe('parsed')
    if (run.block.version.status === 'parsed') {
      expect(run.block.version.data.model).toBe('S5810-28FS')
      expect(run.block.version.data.licenseType).toBe('Uninstalled')
      expect(run.block.version.data.hardwareId).toBeUndefined()
    }
    expect(run.block.fans.status).toBe('parsed')
    if (run.block.fans.status === 'parsed') {
      expect(run.block.fans.data.rows).toHaveLength(3)
    }
    expect(run.block.temperatures.status).toBe('parsed')
    expect(run.block.powerSupplies.status).toBe('parsed')
    expect(run.raw.includes('Synchronizing configuration')).toBe(false)
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x51]))
  })

  it('treats a nonzero exit as a channel failure, not parse-failed', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, () => ({
      stdout: '',
      stderr: "syntax error, expecting 'analyzer'\n",
      exitCode: 1
    }))
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender)

    const run = await diagnostics.runDeviceFacts(profileId)

    expect(run).toEqual({
      kind: 'channel-failed',
      reason: 'nonzero-exit',
      exitCode: 1,
      stderrHead: "syntax error, expecting 'analyzer'\n"
    })
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x52]))
  })

  it('treats an exec timeout as a channel failure and keeps the shell live', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, () => ({ hang: true }), {
      diagnosticsTimeoutMs: 400
    })
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender)

    const run = await diagnostics.runDeviceFacts(profileId)

    expect(run).toEqual({
      kind: 'channel-failed',
      reason: 'timeout',
      stderrHead: ''
    })
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x53]))
  })

  it('keeps one device-facts request in flight per profile', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, () => ({ hang: true }), {
      diagnosticsTimeoutMs: 400
    })
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    const first = diagnostics.runDeviceFacts(profileId)
    const second = diagnostics.runDeviceFacts(profileId)
    await vi.waitFor(() => {
      if ((server?.execs().length ?? 0) < 1) {
        throw new Error('diagnostics exec has not started')
      }
    })
    await Promise.all([first, second])
    expect(server?.execs()).toHaveLength(1)
  })
})

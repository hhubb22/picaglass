import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

function noisyShowVersionStdout(): string {
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
    'admin@PICOS> '
  ].join('\r\n')
}

describe('run_show diagnostic execution', () => {
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
    const dir = await mkdtemp(join(tmpdir(), 'picaglass-run-show-'))
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

    const run = await diagnostics.runShow(created.workspace.selectedProfileId, 'show version')

    expect(run).toEqual({ kind: 'no-session' })
    expect(server?.execs()).toEqual([])
  })

  it('rejects a write command without opening an exec channel', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, () => ({ stdout: 'should-not-run' }))
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender)

    const run = await diagnostics.runShow(profileId, 'configure')

    expect(run).toEqual({
      kind: 'rejected',
      reason: 'run_show only allows show and ping commands.'
    })
    expect(server?.execs()).toEqual([])
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x51]))
  })

  it('executes a known show command and returns structured data', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, (command) => {
      if (command === "cli -c 'show version | no-more'") {
        return { stdout: noisyShowVersionStdout() }
      }
      return { stdout: '', stderr: `unexpected exec: ${command}`, exitCode: 1 }
    })
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender)

    const run = await diagnostics.runShow(profileId, 'show version')
    const versionRaw = fixture('show-version.txt')

    expect(run.kind).toBe('ok')
    if (run.kind !== 'ok') {
      return
    }
    expect(run.command).toBe('show version | no-more')
    expect(run.result).toEqual({
      status: 'parsed',
      data: {
        copyright: 'Copyright (C) 2009-2026 Pica8, Inc. All Rights Reserved.',
        model: 'S5810-28FS',
        softwareVersion: '9.8.7-main-EC1/86c10a20e6',
        softwareReleasedDate: '03/19/2026',
        serialNumber: '<SERIAL>',
        systemUptime: '164 day 6 hour 43 minute',
        licenseType: 'Uninstalled',
        deviceMacAddress: '02:00:00:00:00:01',
        unparsedLines: 0
      },
      raw: versionRaw
    })
    expect(run.raw.includes('Synchronizing configuration')).toBe(false)
    expect(server?.execs()).toEqual([
      { command: "cli -c 'show version | no-more'", ptyRequested: false }
    ])
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x52]))
  })

  it('returns raw text for a show command with no parser', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, () => ({
      stdout: [
        'Execute command: show spanning-tree | no-more',
        'STP is not enabled',
        'admin@PICOS> '
      ].join('\r\n')
    }))
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    const run = await diagnostics.runShow(profileId, 'show spanning-tree')

    expect(run).toEqual({
      kind: 'ok',
      command: 'show spanning-tree | no-more',
      result: { status: 'raw', raw: 'STP is not enabled' },
      raw: 'STP is not enabled'
    })
    expect(server?.execs()).toEqual([
      { command: "cli -c 'show spanning-tree | no-more'", ptyRequested: false }
    ])
  })

  it('executes ping with injected count and returns raw text', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, () => ({
      stdout: [
        'Execute command: ping 192.0.2.1 count 5 | no-more',
        'PING 192.0.2.1: 56 data bytes',
        'admin@PICOS> '
      ].join('\r\n')
    }))
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    const run = await diagnostics.runShow(profileId, 'ping 192.0.2.1')

    expect(run).toEqual({
      kind: 'ok',
      command: 'ping 192.0.2.1 count 5 | no-more',
      result: { status: 'raw', raw: 'PING 192.0.2.1: 56 data bytes' },
      raw: 'PING 192.0.2.1: 56 data bytes'
    })
    expect(server?.execs()).toEqual([
      { command: "cli -c 'ping 192.0.2.1 count 5 | no-more'", ptyRequested: false }
    ])
  })

  it('treats a nonzero exit as a channel failure, not parse-failed', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, () => ({
      stdout: '',
      stderr: "syntax error, expecting 'analyzer'\n",
      exitCode: 1
    }))
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    const run = await diagnostics.runShow(profileId, 'show version')

    expect(run).toEqual({
      kind: 'channel-failed',
      reason: 'nonzero-exit',
      exitCode: 1,
      stderrHead: "syntax error, expecting 'analyzer'\n"
    })
  })
})

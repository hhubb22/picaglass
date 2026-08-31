import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deviceFactsCliCommand } from '../../shared/picos/device-facts'
import { interfaceStatusCliCommand } from '../../shared/picos/interface-status'
import { l2CliCommand } from '../../shared/picos/l2'
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

function noisyInterfaceStatusStdout(detail?: { command: string; output: string }): string {
  const parts = [
    'Synchronizing configuration...OK.',
    'NOTICE TO USERS',
    'This is a trial license banner line.',
    'Unauthorized use is prohibited.',
    '',
    'Welcome to PICOS',
    'admin@PICOS> ',
    '.',
    'Execute command: show interface brief | no-more',
    fixture('show-interface-brief.txt'),
    'admin@PICOS> ',
    '.',
    'Execute command: show interface diagnostics optics all | no-more',
    fixture('show-interface-diagnostics-optics.txt'),
    'admin@PICOS> '
  ]
  if (detail !== undefined) {
    parts.push('.', `Execute command: ${detail.command} | no-more`, detail.output, 'admin@PICOS> ')
  }
  return parts.join('\r\n')
}

function firstDetailBlock(): string {
  const raw = fixture('show-interface-detail.txt')
  const blocks = raw.split(/(?=Physical interface:)/).filter((part) => part.trim().length > 0)
  const first = blocks[0]
  if (first === undefined) {
    throw new Error('expected a physical interface block')
  }
  return first.trimEnd()
}

describe('interface status diagnostic execution', () => {
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
    const dir = await mkdtemp(join(tmpdir(), 'picaglass-ifstatus-'))
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

    const run = await diagnostics.runInterfaceStatus(created.workspace.selectedProfileId)

    expect(run).toEqual({ kind: 'no-session' })
    expect(server?.execs()).toEqual([])
  })

  it('rejects an invalid interface name without opening an exec channel', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, () => ({ stdout: 'should-not-run' }))
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    const run = await diagnostics.runInterfaceStatus(profileId, ['all'])

    expect(run).toEqual({
      kind: 'invalid-interfaces',
      reason: 'invalid interface name: "all"'
    })
    expect(server?.execs()).toEqual([])
  })

  it('aggregates brief and optics all on one no-PTY exec and parses noisy empty optics', async () => {
    const emits: CapturedEmit[] = []
    const expected = interfaceStatusCliCommand()
    if (!expected.ok) {
      throw new Error(expected.reason)
    }
    const { profiles, ssh, diagnostics } = await wired(emits, (command) => {
      if (command === expected.command) {
        return { stdout: noisyInterfaceStatusStdout() }
      }
      return { stdout: '', exitCode: 1 }
    })
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender)

    const run = await diagnostics.runInterfaceStatus(profileId)

    expect(server?.execs()).toEqual([{ command: expected.command, ptyRequested: false }])
    expect(run.kind).toBe('ok')
    if (run.kind !== 'ok') {
      return
    }
    expect(run.block.brief.status).toBe('parsed')
    if (run.block.brief.status === 'parsed') {
      expect(run.block.brief.data.rows).toHaveLength(33)
      expect(run.block.brief.data.rows.every((row) => row.status === 'Down')).toBe(true)
    }
    expect(run.block.optics).toMatchObject({
      status: 'parsed',
      data: { rows: [] }
    })
    expect(run.block.details).toBeNull()
    expect(run.raw.includes('Synchronizing configuration')).toBe(false)
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x61]))
  })

  it('fetches detail only for named interfaces on the same aggregated exec', async () => {
    const emits: CapturedEmit[] = []
    const cli = interfaceStatusCliCommand(['ge-1/1/1'])
    if (!cli.ok) {
      throw new Error(cli.reason)
    }
    const { profiles, ssh, diagnostics } = await wired(emits, (command) => {
      if (command === cli.command) {
        return {
          stdout: noisyInterfaceStatusStdout({
            command: 'show interface detail ge-1/1/1',
            output: firstDetailBlock()
          })
        }
      }
      return { stdout: '', exitCode: 1 }
    })
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender)

    const run = await diagnostics.runInterfaceStatus(profileId, ['ge-1/1/1'])

    expect(server?.execs()).toEqual([{ command: cli.command, ptyRequested: false }])
    expect(run.kind).toBe('ok')
    if (run.kind !== 'ok') {
      return
    }
    expect(run.block.details?.status).toBe('parsed')
    if (run.block.details?.status === 'parsed') {
      expect(run.block.details.data.rows.map((row) => row.name)).toEqual(['ge-1/1/1'])
      expect(run.block.details.data.rows[0]?.link).toBe('Down')
    }
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x62]))
  })

  it('treats a nonzero exit as a channel failure, not parse-failed', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, () => ({
      stdout: '',
      stderr: "syntax error, expecting 'all'\n",
      exitCode: 1
    }))
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    const run = await diagnostics.runInterfaceStatus(profileId)

    expect(run).toEqual({
      kind: 'channel-failed',
      reason: 'nonzero-exit',
      exitCode: 1,
      stderrHead: "syntax error, expecting 'all'\n"
    })
  })
})

function noisyL2Stdout(): string {
  return [
    'Synchronizing configuration...OK.',
    'NOTICE TO USERS',
    'This is a trial license banner line.',
    'Unauthorized use is prohibited.',
    '',
    'Welcome to PICOS',
    'admin@PICOS> ',
    '.',
    'Execute command: show vlans | no-more',
    fixture('show-vlans.txt'),
    'admin@PICOS> ',
    '.',
    'Execute command: show mac-address table | no-more',
    fixture('show-mac-address.txt'),
    'admin@PICOS> ',
    '.',
    'Execute command: show ethernet-switching interfaces | no-more',
    fixture('show-ethernet-switching-interfaces.txt'),
    'admin@PICOS> '
  ].join('\r\n')
}

describe('L2 diagnostic execution', () => {
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
    const dir = await mkdtemp(join(tmpdir(), 'picaglass-l2-'))
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

    const run = await diagnostics.runL2(created.workspace.selectedProfileId)

    expect(run).toEqual({ kind: 'no-session' })
    expect(server?.execs()).toEqual([])
  })

  it('aggregates L2 commands on one no-PTY exec and parses a noisy empty FDB', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, (command) => {
      if (command === l2CliCommand()) {
        return { stdout: noisyL2Stdout() }
      }
      return { stdout: '', exitCode: 1 }
    })
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender)

    const run = await diagnostics.runL2(profileId)

    expect(server?.execs()).toEqual([{ command: l2CliCommand(), ptyRequested: false }])
    expect(run.kind).toBe('ok')
    if (run.kind !== 'ok') {
      return
    }
    expect(run.block.vlans.status).toBe('parsed')
    if (run.block.vlans.status === 'parsed') {
      expect(run.block.vlans.data.rows).toHaveLength(5)
    }
    expect(run.block.fdb).toMatchObject({
      status: 'parsed',
      data: { rows: [], totalEntries: '0' }
    })
    expect(run.block.switching.status).toBe('parsed')
    if (run.block.switching.status === 'parsed') {
      expect(run.block.switching.data.rows).toHaveLength(64)
    }
    expect(run.raw.includes('Synchronizing configuration')).toBe(false)
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x71]))
  })

  it('treats a nonzero exit as a channel failure, not parse-failed', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, () => ({
      stdout: '',
      stderr: "syntax error, expecting 'table'\n",
      exitCode: 1
    }))
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    const run = await diagnostics.runL2(profileId)

    expect(run).toEqual({
      kind: 'channel-failed',
      reason: 'nonzero-exit',
      exitCode: 1,
      stderrHead: "syntax error, expecting 'table'\n"
    })
  })

  it('keeps one L2 request in flight per profile', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, () => ({ hang: true }), {
      diagnosticsTimeoutMs: 400
    })
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    const first = diagnostics.runL2(profileId)
    const second = diagnostics.runL2(profileId)
    await vi.waitFor(() => {
      if ((server?.execs().length ?? 0) < 1) {
        throw new Error('diagnostics exec has not started')
      }
    })
    await Promise.all([first, second])
    expect(server?.execs()).toHaveLength(1)
  })
})

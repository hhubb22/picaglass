import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TECH_SUPPORT_STARTED_MESSAGE,
  TECH_SUPPORT_WAITING_FOR_SESSION,
  techSupportDeleteCommand,
  techSupportPollCommand,
  techSupportStartCommand
} from '../../shared/picos/tech-support'
import { createProfileApi, type ProfileApi } from '../profiles/create-profile-api'
import { createSshApi, type SshApi, type SshSender } from '../ssh/create-ssh-api'
import {
  type CapturedEmit,
  type TestExecResponse,
  type TestServer,
  type TestSftpFiles,
  emitsHaveChunk,
  generateHostKey,
  startServer,
  waitForServerBytes
} from '../ssh/ssh-test-fixture'
import { createDiagnosticsApi, type DiagnosticsApi } from './create-diagnostics-api'

const REMOTE_PATH = '/tmp/PICOS-202608310901-techSupport.log'
const ARTIFACT_BYTES = 2048
const ARTIFACT_BODY = Buffer.alloc(ARTIFACT_BYTES, 0x61)

function pollStdout(opts: {
  running: boolean
  bytes?: number
  path?: string
  files?: boolean
}): string {
  const processLine = opts.running ? 'root     4321  0.1  0.4  pica_sh -c show tech_support' : ''
  if (opts.files === false) {
    return ['__PG_PROCESS__', processLine, '__PG_FILES__'].join('\n')
  }
  const path = opts.path ?? REMOTE_PATH
  const bytes = opts.bytes ?? ARTIFACT_BYTES
  return [
    '__PG_PROCESS__',
    processLine,
    '__PG_FILES__',
    `-rw-r--r-- 1 root xorp ${bytes} Aug 31 09:08 ${path}`
  ].join('\n')
}

describe('tech_support diagnostic execution', () => {
  let userDataPath: string | undefined
  let sshApi: SshApi | undefined
  let diagnosticsApi: DiagnosticsApi | undefined
  let server: TestServer | undefined

  afterEach(async () => {
    diagnosticsApi?.dispose()
    diagnosticsApi = undefined
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
    extras?: {
      diagnosticsTimeoutMs?: number
      pollIntervalMs?: number
      collectTimeoutMs?: number
      sftp?: TestSftpFiles
      createTaskId?: () => string
      revealed?: string[]
    }
  ): Promise<{ profiles: ProfileApi; ssh: SshApi; diagnostics: DiagnosticsApi; dir: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'picaglass-techsupport-'))
    userDataPath = dir
    const hostKey = generateHostKey(dir)
    server = await startServer(hostKey.pem, { exec, sftp: extras?.sftp })
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
        ssh.execOnSession(profileId, command, { timeoutMs: extras?.diagnosticsTimeoutMs }),
      pullFile: (profileId, remotePath, localPath) =>
        ssh.sftpGetOnSession(profileId, remotePath, localPath),
      userDataPath: dir,
      pollIntervalMs: extras?.pollIntervalMs ?? 30,
      collectTimeoutMs: extras?.collectTimeoutMs ?? 2_000,
      createTaskId: extras?.createTaskId ?? (() => 'task-1'),
      revealItemInFolder: (fullPath) => {
        extras?.revealed?.push(fullPath)
      }
    })
    diagnosticsApi = diagnostics
    return { profiles, ssh, diagnostics, dir }
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

  async function reconnect(ssh: SshApi, profileId: string, sender: SshSender): Promise<string> {
    const next = await ssh.connectFromProfile(
      { profileId, secret: 'secret-password', cols: 80, rows: 24 },
      sender
    )
    if (next.ok) {
      return next.sessionId
    }
    if (next.reason !== 'host-unknown') {
      throw new Error(`expected reconnect to succeed, got ${JSON.stringify(next)}`)
    }
    const trusted = await ssh.confirmHostKey(next.sessionId, 'trust-always', sender)
    if (!trusted.ok) {
      throw new Error(`expected reconnect trust, got ${JSON.stringify(trusted)}`)
    }
    return trusted.sessionId
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

  async function waitForPhase(
    diagnostics: DiagnosticsApi,
    profileId: string,
    phase: string
  ): Promise<void> {
    await vi.waitFor(
      () => {
        const snapshot = diagnostics.getTechSupport(profileId)
        if (snapshot.phase !== phase) {
          throw new Error(`phase=${snapshot.phase} failure=${snapshot.failure?.message ?? ''}`)
        }
        if (
          phase === 'done' &&
          snapshot.artifact !== null &&
          !snapshot.artifact.remoteDeleted &&
          snapshot.cleanupError === null
        ) {
          throw new Error('cleanup still pending')
        }
      },
      { timeout: 3_000 }
    )
  }

  function collectionExec(pollsUntilDone: number): (command: string) => TestExecResponse {
    let polls = 0
    return (command) => {
      if (command === techSupportStartCommand()) {
        return { stdout: 'started\n' }
      }
      if (command === techSupportPollCommand()) {
        polls += 1
        if (polls < pollsUntilDone) {
          return { stdout: pollStdout({ running: true, bytes: 1024 }) }
        }
        return { stdout: pollStdout({ running: false, bytes: ARTIFACT_BYTES }) }
      }
      const del = techSupportDeleteCommand(REMOTE_PATH)
      if (del.ok && command === del.command) {
        return { stdout: '' }
      }
      return { stdout: '', exitCode: 1 }
    }
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

    const started = await diagnostics.startTechSupport(created.workspace.selectedProfileId)

    expect(started).toEqual({ kind: 'no-session' })
    expect(server?.execs()).toEqual([])
    expect(diagnostics.getTechSupport(created.workspace.selectedProfileId).phase).toBe('idle')
  })

  it('collects in the background with nohup, waits for the process to exit, pulls, verifies size, and deletes the remote copy', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics, dir } = await wired(emits, collectionExec(2), {
      sftp: { [REMOTE_PATH]: ARTIFACT_BODY }
    })
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender)

    const started = await diagnostics.startTechSupport(profileId)
    expect(started.kind).toBe('ok')
    if (started.kind !== 'ok') {
      return
    }
    expect(started.snapshot.phase).toBe('collecting')
    expect(started.snapshot.taskId).toBe('task-1')
    expect(started.snapshot.progress.map((event) => event.message)).toContain(
      TECH_SUPPORT_STARTED_MESSAGE
    )
    expect(server?.execs()[0]).toEqual({
      command: techSupportStartCommand(),
      ptyRequested: false
    })
    expect(techSupportStartCommand()).toContain('nohup')

    await vi.waitFor(() => {
      const snapshot = diagnostics.getTechSupport(profileId)
      if (snapshot.lastProcessRunning !== true) {
        throw new Error('collection process has not been observed')
      }
    })
    expect(diagnostics.getTechSupport(profileId).phase).toBe('collecting')
    expect(diagnostics.getTechSupport(profileId).artifact).toBeNull()
    expect(diagnostics.getTechSupport(profileId).lastRemoteBytes).toBe(1024)

    await waitForPhase(diagnostics, profileId, 'done')
    const snapshot = diagnostics.getTechSupport(profileId)
    expect(snapshot.failure).toBeNull()
    expect(snapshot.artifact).toEqual({
      fileName: 'PICOS-202608310901-techSupport.log',
      byteSize: ARTIFACT_BYTES,
      localPath: join(dir, 'tech-support', profileId, 'PICOS-202608310901-techSupport.log'),
      remotePath: REMOTE_PATH,
      remoteDeleted: true
    })
    const localPath = snapshot.artifact?.localPath
    if (localPath === undefined) {
      throw new Error('expected a local artifact')
    }
    expect(await readFile(localPath)).toEqual(ARTIFACT_BODY)
    expect((await stat(localPath)).size).toBe(ARTIFACT_BYTES)
    const deleteCmd = techSupportDeleteCommand(REMOTE_PATH)
    expect(deleteCmd.ok).toBe(true)
    if (deleteCmd.ok) {
      expect(server?.execs().map((entry) => entry.command)).toContain(deleteCmd.command)
    }
    await assertShellStillLive(ssh, sessionId, sender, emits, Uint8Array.from([0x71]))
  })

  it('fails starting when the detached launch command exits nonzero', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, (command) => {
      if (command === techSupportStartCommand()) {
        return { stdout: '', stderr: 'nohup: failed\n', exitCode: 1 }
      }
      return { stdout: '', exitCode: 1 }
    })
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    const started = await diagnostics.startTechSupport(profileId)
    expect(started.kind).toBe('ok')
    if (started.kind !== 'ok') {
      return
    }
    expect(started.snapshot.phase).toBe('failed')
    expect(started.snapshot.failure).toEqual({
      stage: 'starting',
      message: 'Command failed (exit 1)\nnohup: failed\n'
    })
    expect(started.snapshot.lastRemotePath).toBeNull()
  })

  it('fails collecting when the process exits without an artifact, keeping the last poll', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, (command) => {
      if (command === techSupportStartCommand()) {
        return { stdout: 'started\n' }
      }
      if (command === techSupportPollCommand()) {
        return { stdout: pollStdout({ running: false, files: false }) }
      }
      return { stdout: '', exitCode: 1 }
    })
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    await diagnostics.startTechSupport(profileId)
    await waitForPhase(diagnostics, profileId, 'failed')
    const snapshot = diagnostics.getTechSupport(profileId)
    expect(snapshot.failure).toEqual({
      stage: 'collecting',
      message: '采集进程已退出，但未发现产物文件'
    })
    expect(snapshot.lastProcessRunning).toBe(false)
    expect(snapshot.artifact).toBeNull()
  })

  it('times out collecting while the process is still running and keeps last file size', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(
      emits,
      (command) => {
        if (command === techSupportStartCommand()) {
          return { stdout: 'started\n' }
        }
        if (command === techSupportPollCommand()) {
          return { stdout: pollStdout({ running: true, bytes: 512 }) }
        }
        return { stdout: '', exitCode: 1 }
      },
      { pollIntervalMs: 20, collectTimeoutMs: 80 }
    )
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    await diagnostics.startTechSupport(profileId)
    await waitForPhase(diagnostics, profileId, 'failed')
    const snapshot = diagnostics.getTechSupport(profileId)
    expect(snapshot.failure?.stage).toBe('collecting')
    expect(snapshot.failure?.message).toBe('采集超时')
    expect(snapshot.lastRemoteBytes).toBe(512)
    expect(snapshot.lastProcessRunning).toBe(true)
    expect(snapshot.artifact).toBeNull()
  })

  it('fails transferring when SFTP cannot fetch the artifact, keeping remote path and size', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, collectionExec(1), {
      sftp: {}
    })
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    await diagnostics.startTechSupport(profileId)
    await waitForPhase(diagnostics, profileId, 'failed')
    const snapshot = diagnostics.getTechSupport(profileId)
    expect(snapshot.failure?.stage).toBe('transferring')
    expect(snapshot.lastRemotePath).toBe(REMOTE_PATH)
    expect(snapshot.lastRemoteBytes).toBe(ARTIFACT_BYTES)
    expect(snapshot.artifact).toBeNull()
  })

  it('fails transferring when pulled size does not match the last poll', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, collectionExec(1), {
      sftp: { [REMOTE_PATH]: Buffer.alloc(1000, 0x62) }
    })
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    await diagnostics.startTechSupport(profileId)
    await waitForPhase(diagnostics, profileId, 'failed')
    const snapshot = diagnostics.getTechSupport(profileId)
    expect(snapshot.failure).toEqual({
      stage: 'transferring',
      message: '回传校验失败：设备侧 2048 字节，本机 1000 字节'
    })
    expect(snapshot.lastRemoteBytes).toBe(2048)
    expect(snapshot.artifact?.byteSize).toBe(1000)
    expect(snapshot.artifact?.remoteDeleted).toBe(false)
  })

  it('keeps the local artifact when remote cleanup fails', async () => {
    const emits: CapturedEmit[] = []
    let polls = 0
    const { profiles, ssh, diagnostics, dir } = await wired(
      emits,
      (command) => {
        if (command === techSupportStartCommand()) {
          return { stdout: 'started\n' }
        }
        if (command === techSupportPollCommand()) {
          polls += 1
          return { stdout: pollStdout({ running: false, bytes: ARTIFACT_BYTES }) }
        }
        const del = techSupportDeleteCommand(REMOTE_PATH)
        if (del.ok && command === del.command) {
          return { stdout: '', stderr: 'Operation not permitted\n', exitCode: 1 }
        }
        return { stdout: '', exitCode: 1 }
      },
      { sftp: { [REMOTE_PATH]: ARTIFACT_BODY } }
    )
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    await diagnostics.startTechSupport(profileId)
    await waitForPhase(diagnostics, profileId, 'done')
    const snapshot = diagnostics.getTechSupport(profileId)
    expect(snapshot.artifact?.remoteDeleted).toBe(false)
    expect(snapshot.artifact?.localPath).toBe(
      join(dir, 'tech-support', profileId, 'PICOS-202608310901-techSupport.log')
    )
    expect(snapshot.cleanupError).toContain('Operation not permitted')
    expect(polls).toBeGreaterThanOrEqual(1)

    const deleted = await diagnostics.deleteTechSupportRemote(profileId)
    expect(deleted.kind).toBe('ok')
    if (deleted.kind !== 'ok') {
      return
    }
    expect(deleted.snapshot.artifact?.remoteDeleted).toBe(false)
  })

  it('resumes polling after the SSH Session disconnects (断开续查)', async () => {
    const emits: CapturedEmit[] = []
    let polls = 0
    const { profiles, ssh, diagnostics, dir } = await wired(
      emits,
      (command) => {
        if (command === techSupportStartCommand()) {
          return { stdout: 'started\n' }
        }
        if (command === techSupportPollCommand()) {
          polls += 1
          if (polls === 1) {
            return { stdout: pollStdout({ running: true, bytes: 1024 }) }
          }
          return { stdout: pollStdout({ running: false, bytes: ARTIFACT_BYTES }) }
        }
        const del = techSupportDeleteCommand(REMOTE_PATH)
        if (del.ok && command === del.command) {
          return { stdout: '' }
        }
        return { stdout: '', exitCode: 1 }
      },
      { sftp: { [REMOTE_PATH]: ARTIFACT_BODY }, pollIntervalMs: 40 }
    )
    const sender: SshSender = { id: 1 }
    const { profileId, sessionId } = await saveAndOpen(profiles, ssh, sender)

    await diagnostics.startTechSupport(profileId)
    await vi.waitFor(() => {
      if (diagnostics.getTechSupport(profileId).lastProcessRunning !== true) {
        throw new Error('collection has not been observed')
      }
    })

    await ssh.disconnect(sessionId, sender)
    expect(ssh.hasLiveSession(profileId)).toBe(false)
    expect(diagnostics.getTechSupport(profileId).phase).toBe('collecting')

    await vi.waitFor(() => {
      if (!diagnostics.getTechSupport(profileId).waitingForSession) {
        throw new Error('expected waiting for SSH Session')
      }
    })
    expect(diagnostics.getTechSupport(profileId).progress.map((event) => event.message)).toContain(
      TECH_SUPPORT_WAITING_FOR_SESSION
    )
    expect(polls).toBe(1)

    await reconnect(ssh, profileId, sender)
    await waitForPhase(diagnostics, profileId, 'done')
    const snapshot = diagnostics.getTechSupport(profileId)
    expect(snapshot.artifact?.byteSize).toBe(ARTIFACT_BYTES)
    expect(snapshot.artifact?.remoteDeleted).toBe(true)
    expect(snapshot.artifact?.localPath).toBe(
      join(dir, 'tech-support', profileId, 'PICOS-202608310901-techSupport.log')
    )
    expect(polls).toBeGreaterThanOrEqual(2)
  })

  it('returns the in-flight task instead of launching a second collection', async () => {
    const emits: CapturedEmit[] = []
    const { profiles, ssh, diagnostics } = await wired(emits, collectionExec(8), {
      sftp: { [REMOTE_PATH]: ARTIFACT_BODY },
      pollIntervalMs: 200
    })
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    const first = await diagnostics.startTechSupport(profileId)
    const second = await diagnostics.startTechSupport(profileId)
    expect(first).toEqual(second)
    expect(
      server?.execs().filter((entry) => entry.command === techSupportStartCommand())
    ).toHaveLength(1)
  })

  it('starts a new collection from a finished task', async () => {
    const emits: CapturedEmit[] = []
    let starts = 0
    const { profiles, ssh, diagnostics } = await wired(
      emits,
      (command) => {
        if (command === techSupportStartCommand()) {
          starts += 1
          return { stdout: 'started\n' }
        }
        if (command === techSupportPollCommand()) {
          return { stdout: pollStdout({ running: false, bytes: ARTIFACT_BYTES }) }
        }
        const del = techSupportDeleteCommand(REMOTE_PATH)
        if (del.ok && command === del.command) {
          return { stdout: '' }
        }
        return { stdout: '', exitCode: 1 }
      },
      {
        sftp: { [REMOTE_PATH]: ARTIFACT_BODY },
        createTaskId: () => `task-${starts + 1}`
      }
    )
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    await diagnostics.startTechSupport(profileId)
    await waitForPhase(diagnostics, profileId, 'done')
    const firstId = diagnostics.getTechSupport(profileId).taskId

    const again = await diagnostics.startTechSupport(profileId)
    expect(again.kind).toBe('ok')
    if (again.kind !== 'ok') {
      return
    }
    expect(again.snapshot.taskId).not.toBe(firstId)
    await waitForPhase(diagnostics, profileId, 'done')
    expect(starts).toBe(2)
  })

  it('fails collecting when a poll exec returns nonzero, keeping the last poll facts', async () => {
    const emits: CapturedEmit[] = []
    let polls = 0
    const { profiles, ssh, diagnostics } = await wired(emits, (command) => {
      if (command === techSupportStartCommand()) {
        return { stdout: 'started\n' }
      }
      if (command === techSupportPollCommand()) {
        polls += 1
        if (polls === 1) {
          return { stdout: pollStdout({ running: true, bytes: 512 }) }
        }
        return { stdout: '', stderr: 'ps: error\n', exitCode: 1 }
      }
      return { stdout: '', exitCode: 1 }
    })
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    await diagnostics.startTechSupport(profileId)
    await waitForPhase(diagnostics, profileId, 'failed')
    const snapshot = diagnostics.getTechSupport(profileId)
    expect(snapshot.failure?.stage).toBe('collecting')
    expect(snapshot.failure?.message).toContain('Command failed (exit 1)')
    expect(snapshot.lastRemoteBytes).toBe(512)
    expect(snapshot.lastProcessRunning).toBe(true)
  })

  it('reveals the local artifact directory after a successful pull', async () => {
    const emits: CapturedEmit[] = []
    const revealed: string[] = []
    const { profiles, ssh, diagnostics, dir } = await wired(emits, collectionExec(1), {
      sftp: { [REMOTE_PATH]: ARTIFACT_BODY },
      revealed
    })
    const sender: SshSender = { id: 1 }
    const { profileId } = await saveAndOpen(profiles, ssh, sender)

    await diagnostics.startTechSupport(profileId)
    await waitForPhase(diagnostics, profileId, 'done')
    const localPath = join(dir, 'tech-support', profileId, 'PICOS-202608310901-techSupport.log')
    expect(await diagnostics.revealTechSupportArtifact(profileId)).toEqual({ ok: true })
    expect(revealed).toEqual([localPath])
    expect(await diagnostics.revealTechSupportArtifact('unknown')).toEqual({
      ok: false,
      reason: 'no-artifact',
      message: 'no local artifact'
    })
  })
})

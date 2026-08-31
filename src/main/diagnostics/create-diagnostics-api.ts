import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { ExecChannelResult, SftpGetResult } from '../ssh/create-ssh-api'
import { frameCliOutput } from './frame-cli-output'
import {
  deviceFactsCliCommand,
  parseDeviceFacts,
  type DeviceFactsChannelFailure,
  type DeviceFactsRun
} from '../../shared/picos/device-facts'
import {
  interfaceStatusCliCommand,
  parseInterfaceStatus,
  type InterfaceStatusChannelFailure,
  type InterfaceStatusRun
} from '../../shared/picos/interface-status'
import { l2CliCommand, parseL2, type L2ChannelFailure, type L2Run } from '../../shared/picos/l2'
import { l3CliCommand, parseL3, type L3ChannelFailure, type L3Run } from '../../shared/picos/l3'
import {
  logsCliCommand,
  parseLogs,
  type LogsChannelFailure,
  type LogsRun
} from '../../shared/picos/logs'
import {
  authorizeRunShow,
  parseRunShowOutput,
  type RunShowChannelFailure,
  type RunShowRun
} from '../../shared/picos/run-show'
import {
  TECH_SUPPORT_CLEANUP_FAILED_MESSAGE,
  TECH_SUPPORT_COLLECT_TIMEOUT_MS,
  TECH_SUPPORT_POLL_INTERVAL_MS,
  TECH_SUPPORT_REMOTE_DELETED_MESSAGE,
  TECH_SUPPORT_STARTED_MESSAGE,
  TECH_SUPPORT_TRANSFERRING_MESSAGE,
  TECH_SUPPORT_WAITING_FOR_SESSION,
  idleTechSupportSnapshot,
  isTechSupportInFlight,
  parseTechSupportPoll,
  pickLatestTechSupportFile,
  techSupportDeleteCommand,
  techSupportFileName,
  techSupportPollCommand,
  techSupportProcessMessage,
  techSupportSizeMismatchMessage,
  techSupportStartCommand,
  techSupportVerifiedMessage,
  type TechSupportDeleteRemoteResult,
  type TechSupportFailureStage,
  type TechSupportPhase,
  type TechSupportPollFile,
  type TechSupportRevealResult,
  type TechSupportSnapshot,
  type TechSupportStartResult
} from '../../shared/picos/tech-support'

export const DIAGNOSTICS_STDERR_HEAD_CHARS = 200

export type DiagnosticsApi = {
  runDeviceFacts: (profileId: string) => Promise<DeviceFactsRun>
  runInterfaceStatus: (
    profileId: string,
    interfaces?: readonly string[]
  ) => Promise<InterfaceStatusRun>
  runL2: (profileId: string) => Promise<L2Run>
  runL3: (profileId: string) => Promise<L3Run>
  runLogs: (profileId: string, lines?: number) => Promise<LogsRun>
  runShow: (profileId: string, command: string) => Promise<RunShowRun>
  startTechSupport: (profileId: string) => Promise<TechSupportStartResult>
  getTechSupport: (profileId: string) => TechSupportSnapshot
  deleteTechSupportRemote: (profileId: string) => Promise<TechSupportDeleteRemoteResult>
  revealTechSupportArtifact: (profileId: string) => Promise<TechSupportRevealResult>
  dispose: () => void
}

export type CreateDiagnosticsApiDeps = {
  hasLiveSession: (profileId: string) => boolean
  exec: (profileId: string, command: string) => Promise<ExecChannelResult>
  pullFile?: (profileId: string, remotePath: string, localPath: string) => Promise<SftpGetResult>
  userDataPath?: string
  now?: () => Date
  pollIntervalMs?: number
  collectTimeoutMs?: number
  createTaskId?: () => string
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  revealItemInFolder?: (fullPath: string) => void
}

function head(text: string): string {
  return text.slice(0, DIAGNOSTICS_STDERR_HEAD_CHARS)
}

function stderrHead(stderr: string, stdout: string): string {
  if (stderr.length > 0) {
    return head(stderr)
  }
  return head(stdout)
}

type ChannelFailure = DeviceFactsChannelFailure &
  InterfaceStatusChannelFailure &
  L2ChannelFailure &
  L3ChannelFailure &
  LogsChannelFailure &
  RunShowChannelFailure

function channelFailure(captured: ExecChannelResult): { kind: 'no-session' } | ChannelFailure {
  if (captured.ok) {
    throw new Error('expected a channel failure')
  }
  if (captured.reason === 'no-session') {
    return { kind: 'no-session' }
  }
  if (captured.reason === 'timeout') {
    return {
      kind: 'channel-failed',
      reason: 'timeout',
      stderrHead: stderrHead(captured.stderr, captured.stdout)
    }
  }
  if (captured.reason === 'rejected') {
    return {
      kind: 'channel-failed',
      reason: 'rejected',
      stderrHead: head(captured.message)
    }
  }
  return {
    kind: 'channel-failed',
    reason: 'nonzero-exit',
    exitCode: captured.exitCode,
    stderrHead: stderrHead(captured.stderr, captured.stdout)
  }
}

function execFailureMessage(captured: Exclude<ExecChannelResult, { ok: true }>): string {
  if (captured.reason === 'timeout') {
    const details = stderrHead(captured.stderr, captured.stdout)
    return details.length > 0 ? `Command timed out\n${details}` : 'Command timed out'
  }
  if (captured.reason === 'rejected') {
    return captured.message
  }
  if (captured.reason === 'no-session') {
    return 'No active SSH Session'
  }
  const details = stderrHead(captured.stderr, captured.stdout)
  const prefix = `Command failed (exit ${captured.exitCode})`
  return details.length > 0 ? `${prefix}\n${details}` : prefix
}

function pullFailureMessage(pulled: Exclude<SftpGetResult, { ok: true }>): string {
  if (pulled.reason === 'no-session') {
    return 'No active SSH Session during transfer'
  }
  return pulled.message
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

type TechSupportTask = {
  snapshot: TechSupportSnapshot
  abort: AbortController
}

export function createDiagnosticsApi(deps: CreateDiagnosticsApiDeps): DiagnosticsApi {
  const inflight = new Map<
    string,
    Promise<DeviceFactsRun | InterfaceStatusRun | L2Run | L3Run | LogsRun | RunShowRun>
  >()
  const tasks = new Map<string, TechSupportTask>()
  const pollIntervalMs = deps.pollIntervalMs ?? TECH_SUPPORT_POLL_INTERVAL_MS
  const collectTimeoutMs = deps.collectTimeoutMs ?? TECH_SUPPORT_COLLECT_TIMEOUT_MS
  const sleep = deps.sleep ?? defaultSleep

  function now(): Date {
    return deps.now?.() ?? new Date()
  }

  function cloneSnapshot(snapshot: TechSupportSnapshot): TechSupportSnapshot {
    return structuredClone(snapshot)
  }

  function currentSnapshot(profileId: string): TechSupportSnapshot {
    const task = tasks.get(profileId)
    if (task === undefined) {
      return idleTechSupportSnapshot(profileId)
    }
    return cloneSnapshot(task.snapshot)
  }

  function stillCurrent(task: TechSupportTask, profileId: string): boolean {
    return !task.abort.signal.aborted && tasks.get(profileId) === task
  }

  function pushProgress(task: TechSupportTask, phase: TechSupportPhase, message: string): void {
    task.snapshot.progress.push({
      at: now().toISOString(),
      phase,
      message
    })
  }

  function failTask(task: TechSupportTask, stage: TechSupportFailureStage, message: string): void {
    task.snapshot.phase = 'failed'
    task.snapshot.failure = { stage, message }
    task.snapshot.waitingForSession = false
    pushProgress(task, 'failed', message)
  }

  function recordPoll(
    task: TechSupportTask,
    file: TechSupportPollFile | undefined,
    running: boolean
  ): void {
    task.snapshot.lastProcessRunning = running
    if (file !== undefined) {
      task.snapshot.lastRemotePath = file.path
      task.snapshot.lastRemoteBytes = file.bytes
    }
    pushProgress(task, 'collecting', techSupportProcessMessage(running, file))
  }

  async function transferArtifact(
    task: TechSupportTask,
    profileId: string,
    file: TechSupportPollFile
  ): Promise<void> {
    task.snapshot.phase = 'transferring'
    pushProgress(task, 'transferring', TECH_SUPPORT_TRANSFERRING_MESSAGE)
    const userDataPath = deps.userDataPath
    const pullFile = deps.pullFile
    if (userDataPath === undefined || pullFile === undefined) {
      failTask(task, 'transferring', 'file pull is not available')
      return
    }
    const fileName = techSupportFileName(file.path)
    const localPath = join(userDataPath, 'tech-support', profileId, fileName)
    const pulled = await pullFile(profileId, file.path, localPath)
    if (!stillCurrent(task, profileId)) {
      return
    }
    if (!pulled.ok) {
      failTask(task, 'transferring', pullFailureMessage(pulled))
      return
    }
    task.snapshot.artifact = {
      fileName,
      byteSize: pulled.bytes,
      localPath,
      remotePath: file.path,
      remoteDeleted: false
    }
    if (pulled.bytes !== file.bytes) {
      failTask(task, 'transferring', techSupportSizeMismatchMessage(file.bytes, pulled.bytes))
      return
    }
    task.snapshot.phase = 'done'
    pushProgress(task, 'done', techSupportVerifiedMessage(pulled.bytes))
    const del = techSupportDeleteCommand(file.path)
    if (!del.ok) {
      task.snapshot.cleanupError = del.reason
      pushProgress(task, 'done', TECH_SUPPORT_CLEANUP_FAILED_MESSAGE)
      return
    }
    const deleted = await deps.exec(profileId, del.command)
    if (!stillCurrent(task, profileId)) {
      return
    }
    if (!deleted.ok) {
      task.snapshot.cleanupError = execFailureMessage(deleted)
      pushProgress(task, 'done', TECH_SUPPORT_CLEANUP_FAILED_MESSAGE)
      return
    }
    task.snapshot.artifact.remoteDeleted = true
    pushProgress(task, 'done', TECH_SUPPORT_REMOTE_DELETED_MESSAGE)
  }

  async function runCollectLoop(task: TechSupportTask, profileId: string): Promise<void> {
    const startedAt = now().getTime()
    while (stillCurrent(task, profileId)) {
      if (now().getTime() - startedAt >= collectTimeoutMs) {
        failTask(task, 'collecting', '采集超时')
        return
      }
      if (!deps.hasLiveSession(profileId)) {
        if (!task.snapshot.waitingForSession) {
          task.snapshot.waitingForSession = true
          pushProgress(task, 'collecting', TECH_SUPPORT_WAITING_FOR_SESSION)
        }
        await sleep(pollIntervalMs, task.abort.signal)
        continue
      }
      task.snapshot.waitingForSession = false
      const captured = await deps.exec(profileId, techSupportPollCommand())
      if (!stillCurrent(task, profileId)) {
        return
      }
      if (!captured.ok) {
        if (captured.reason === 'no-session') {
          if (!task.snapshot.waitingForSession) {
            task.snapshot.waitingForSession = true
            pushProgress(task, 'collecting', TECH_SUPPORT_WAITING_FOR_SESSION)
          }
          await sleep(pollIntervalMs, task.abort.signal)
          continue
        }
        failTask(task, 'collecting', execFailureMessage(captured))
        return
      }
      const reading = parseTechSupportPoll(captured.stdout)
      const latest = pickLatestTechSupportFile(reading.files)
      recordPoll(task, latest, reading.processRunning)
      if (!reading.processRunning) {
        if (latest === undefined) {
          failTask(task, 'collecting', '采集进程已退出，但未发现产物文件')
          return
        }
        await transferArtifact(task, profileId, latest)
        return
      }
      await sleep(pollIntervalMs, task.abort.signal)
    }
  }

  async function startTechSupport(profileId: string): Promise<TechSupportStartResult> {
    const id = profileId.trim()
    const existing = tasks.get(id)
    if (existing !== undefined && isTechSupportInFlight(existing.snapshot.phase)) {
      return { kind: 'ok', snapshot: cloneSnapshot(existing.snapshot) }
    }
    if (!deps.hasLiveSession(id)) {
      return { kind: 'no-session' }
    }
    existing?.abort.abort()
    const task: TechSupportTask = {
      snapshot: {
        ...idleTechSupportSnapshot(id),
        taskId: deps.createTaskId?.() ?? randomUUID(),
        phase: 'starting'
      },
      abort: new AbortController()
    }
    tasks.set(id, task)
    const captured = await deps.exec(id, techSupportStartCommand())
    if (!stillCurrent(task, id)) {
      return { kind: 'ok', snapshot: currentSnapshot(id) }
    }
    if (!captured.ok) {
      failTask(task, 'starting', execFailureMessage(captured))
      return { kind: 'ok', snapshot: cloneSnapshot(task.snapshot) }
    }
    task.snapshot.phase = 'collecting'
    pushProgress(task, 'starting', TECH_SUPPORT_STARTED_MESSAGE)
    void runCollectLoop(task, id)
    return { kind: 'ok', snapshot: cloneSnapshot(task.snapshot) }
  }

  async function deleteTechSupportRemote(
    profileId: string
  ): Promise<TechSupportDeleteRemoteResult> {
    const id = profileId.trim()
    const task = tasks.get(id)
    if (task === undefined || task.snapshot.artifact === null) {
      return { kind: 'not-available', reason: 'no remote artifact to delete' }
    }
    const artifact = task.snapshot.artifact
    if (artifact.remoteDeleted) {
      return { kind: 'ok', snapshot: cloneSnapshot(task.snapshot) }
    }
    if (!deps.hasLiveSession(id)) {
      return { kind: 'no-session' }
    }
    const del = techSupportDeleteCommand(artifact.remotePath)
    if (!del.ok) {
      return { kind: 'not-available', reason: del.reason }
    }
    const deleted = await deps.exec(id, del.command)
    if (!deleted.ok) {
      task.snapshot.cleanupError = execFailureMessage(deleted)
      return { kind: 'ok', snapshot: cloneSnapshot(task.snapshot) }
    }
    artifact.remoteDeleted = true
    task.snapshot.cleanupError = null
    pushProgress(task, task.snapshot.phase, TECH_SUPPORT_REMOTE_DELETED_MESSAGE)
    return { kind: 'ok', snapshot: cloneSnapshot(task.snapshot) }
  }

  async function revealTechSupportArtifact(profileId: string): Promise<TechSupportRevealResult> {
    const task = tasks.get(profileId.trim())
    const localPath = task?.snapshot.artifact?.localPath
    if (localPath === undefined) {
      return { ok: false, reason: 'no-artifact', message: 'no local artifact' }
    }
    try {
      deps.revealItemInFolder?.(localPath)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'could not open directory'
      return { ok: false, reason: 'missing-file', message }
    }
    return { ok: true }
  }

  async function runDeviceFactsOnce(profileId: string): Promise<DeviceFactsRun> {
    if (!deps.hasLiveSession(profileId)) {
      return { kind: 'no-session' }
    }
    const captured = await deps.exec(profileId, deviceFactsCliCommand())
    if (!captured.ok) {
      return channelFailure(captured)
    }
    const framed = frameCliOutput(captured.stdout)
    const block = parseDeviceFacts(framed.commands, framed.cleaned)
    return { kind: 'ok', block, raw: framed.cleaned }
  }

  async function runInterfaceStatusOnce(
    profileId: string,
    interfaces: readonly string[]
  ): Promise<InterfaceStatusRun> {
    const cli = interfaceStatusCliCommand(interfaces)
    if (!cli.ok) {
      return { kind: 'invalid-interfaces', reason: cli.reason }
    }
    if (!deps.hasLiveSession(profileId)) {
      return { kind: 'no-session' }
    }
    const captured = await deps.exec(profileId, cli.command)
    if (!captured.ok) {
      return channelFailure(captured)
    }
    const framed = frameCliOutput(captured.stdout)
    const block = parseInterfaceStatus(framed.commands, framed.cleaned, {
      includeDetails: cli.names.length > 0
    })
    return { kind: 'ok', block, raw: framed.cleaned }
  }

  async function runL2Once(profileId: string): Promise<L2Run> {
    if (!deps.hasLiveSession(profileId)) {
      return { kind: 'no-session' }
    }
    const captured = await deps.exec(profileId, l2CliCommand())
    if (!captured.ok) {
      return channelFailure(captured)
    }
    const framed = frameCliOutput(captured.stdout)
    const block = parseL2(framed.commands, framed.cleaned)
    return { kind: 'ok', block, raw: framed.cleaned }
  }

  async function runL3Once(profileId: string): Promise<L3Run> {
    if (!deps.hasLiveSession(profileId)) {
      return { kind: 'no-session' }
    }
    const captured = await deps.exec(profileId, l3CliCommand())
    if (!captured.ok) {
      return channelFailure(captured)
    }
    const framed = frameCliOutput(captured.stdout)
    const block = parseL3(framed.commands, framed.cleaned)
    return { kind: 'ok', block, raw: framed.cleaned }
  }

  async function runLogsOnce(profileId: string, lines: number | undefined): Promise<LogsRun> {
    const cli = logsCliCommand(lines)
    if (!cli.ok) {
      return { kind: 'invalid-lines', reason: cli.reason }
    }
    if (!deps.hasLiveSession(profileId)) {
      return { kind: 'no-session' }
    }
    const captured = await deps.exec(profileId, cli.command)
    if (!captured.ok) {
      return channelFailure(captured)
    }
    const framed = frameCliOutput(captured.stdout)
    const block = parseLogs(framed.commands, framed.cleaned)
    return { kind: 'ok', block, raw: framed.cleaned }
  }

  async function runShowOnce(profileId: string, command: string): Promise<RunShowRun> {
    const authorized = authorizeRunShow(command)
    if (!authorized.ok) {
      return { kind: 'rejected', reason: authorized.reason }
    }
    if (!deps.hasLiveSession(profileId)) {
      return { kind: 'no-session' }
    }
    const captured = await deps.exec(profileId, authorized.cliCommand)
    if (!captured.ok) {
      return channelFailure(captured)
    }
    const framed = frameCliOutput(captured.stdout)
    const raw =
      framed.commands.length === 1 && framed.commands[0] !== undefined
        ? framed.commands[0].output
        : framed.cleaned
    return {
      kind: 'ok',
      command: authorized.inner,
      result: parseRunShowOutput(authorized.inner, raw),
      raw: framed.cleaned
    }
  }

  function dedupe<
    T extends DeviceFactsRun | InterfaceStatusRun | L2Run | L3Run | LogsRun | RunShowRun
  >(key: string, start: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key)
    if (existing !== undefined) {
      return existing as Promise<T>
    }
    const promise = start().finally(() => {
      inflight.delete(key)
    })
    inflight.set(key, promise)
    return promise
  }

  return {
    runDeviceFacts(profileId) {
      const id = profileId.trim()
      return dedupe(`device-facts:${id}`, () => runDeviceFactsOnce(id))
    },
    runInterfaceStatus(profileId, interfaces = []) {
      const id = profileId.trim()
      const parsed = interfaceStatusCliCommand(interfaces)
      const namesKey = parsed.ok ? parsed.names.join('\0') : parsed.reason
      return dedupe(`interface-status:${id}:${namesKey}`, () =>
        runInterfaceStatusOnce(id, interfaces)
      )
    },
    runL2(profileId) {
      const id = profileId.trim()
      return dedupe(`l2:${id}`, () => runL2Once(id))
    },
    runL3(profileId) {
      const id = profileId.trim()
      return dedupe(`l3:${id}`, () => runL3Once(id))
    },
    runLogs(profileId, lines) {
      const id = profileId.trim()
      const parsed = logsCliCommand(lines)
      const linesKey = parsed.ok ? String(parsed.lines) : parsed.reason
      return dedupe(`logs:${id}:${linesKey}`, () => runLogsOnce(id, lines))
    },
    runShow(profileId, command) {
      const id = profileId.trim()
      const authorized = authorizeRunShow(command)
      if (!authorized.ok) {
        return Promise.resolve({ kind: 'rejected', reason: authorized.reason })
      }
      return dedupe(`run-show:${id}:${authorized.inner}`, () => runShowOnce(id, command))
    },
    startTechSupport,
    getTechSupport(profileId) {
      return currentSnapshot(profileId.trim())
    },
    deleteTechSupportRemote,
    revealTechSupportArtifact,
    dispose() {
      for (const task of tasks.values()) {
        task.abort.abort()
      }
      tasks.clear()
    }
  }
}

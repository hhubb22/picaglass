export const TECH_SUPPORT_COMMAND = 'show tech_support'

export const TECH_SUPPORT_START_COMMAND =
  "nohup cli -c 'show tech_support' >/dev/null 2>&1 & echo started"

export const TECH_SUPPORT_POLL_COMMAND =
  "echo __PG_PROCESS__; ps aux | grep -E '[s]how tech_support' || true; echo __PG_FILES__; ls -l /tmp/*techSupport.log 2>/dev/null || true"

export const TECH_SUPPORT_POLL_INTERVAL_MS = 4 * 60 * 1000
export const TECH_SUPPORT_COLLECT_TIMEOUT_MS = 30 * 60 * 1000

export const TECH_SUPPORT_START_LABEL = '开始采集'
export const TECH_SUPPORT_RECOLLECT_LABEL = '重新采集'
export const TECH_SUPPORT_OPEN_DIRECTORY_LABEL = '打开所在目录'
export const TECH_SUPPORT_DELETE_REMOTE_LABEL = '删除设备侧副本'
export const TECH_SUPPORT_WAITING_FOR_SESSION = '等待 SSH Session 以继续轮询'
export const TECH_SUPPORT_STARTED_MESSAGE = '已在设备侧后台启动采集（nohup 脱离会话）'
export const TECH_SUPPORT_PROCESS_RUNNING_MESSAGE = '采集进程仍在运行'
export const TECH_SUPPORT_PROCESS_EXITED_MESSAGE = '采集进程已退出'
export const TECH_SUPPORT_TRANSFERRING_MESSAGE = '正在拉取产物'
export const TECH_SUPPORT_CLEANUP_FAILED_MESSAGE = '设备侧副本清理失败'
export const TECH_SUPPORT_REMOTE_DELETED_MESSAGE = '已删除设备侧副本'
export const TECH_SUPPORT_NO_CURRENT_ARTIFACT_MESSAGE =
  '采集进程已退出，但未发现本次采集的产物文件'

export const TECH_SUPPORT_PHASES = [
  'idle',
  'starting',
  'collecting',
  'transferring',
  'done',
  'failed'
] as const

export type TechSupportPhase = (typeof TECH_SUPPORT_PHASES)[number]

export type TechSupportInFlightPhase = 'starting' | 'collecting' | 'transferring'

export type TechSupportFailureStage = 'starting' | 'collecting' | 'transferring'

export type TechSupportProgressEvent = {
  at: string
  phase: TechSupportPhase
  message: string
}

export type TechSupportArtifact = {
  fileName: string
  byteSize: number
  localPath: string
  remotePath: string
  remoteDeleted: boolean
}

export type TechSupportFailure = {
  stage: TechSupportFailureStage
  message: string
}

export type TechSupportSnapshot = {
  taskId: string | null
  profileId: string
  phase: TechSupportPhase
  progress: TechSupportProgressEvent[]
  artifact: TechSupportArtifact | null
  failure: TechSupportFailure | null
  lastRemotePath: string | null
  lastRemoteBytes: number | null
  lastProcessRunning: boolean | null
  cleanupError: string | null
  waitingForSession: boolean
}

export type TechSupportStartResult =
  { kind: 'no-session' } | { kind: 'ok'; snapshot: TechSupportSnapshot }

export type TechSupportDeleteRemoteResult =
  | { kind: 'no-session' }
  | { kind: 'not-available'; reason: string }
  | { kind: 'ok'; snapshot: TechSupportSnapshot }

export type TechSupportRevealResult =
  { ok: true } | { ok: false; reason: 'no-artifact' | 'missing-file'; message: string }

export type TechSupportPollFile = {
  path: string
  bytes: number
}

export type TechSupportPollReading = {
  processRunning: boolean
  files: TechSupportPollFile[]
}

const REMOTE_PATH = /^\/tmp\/[A-Za-z0-9._-]+-techSupport\.log$/
const FILE_TIMESTAMP = /-(\d{12})-techSupport\.log$/
const PROCESS_MARKER = '__PG_PROCESS__'
const FILES_MARKER = '__PG_FILES__'

const PHASE_LABELS: Record<Exclude<TechSupportPhase, 'idle'>, string> = {
  starting: '正在启动',
  collecting: '正在采集',
  transferring: '正在回传',
  done: '采集完成',
  failed: '采集失败'
}

export function techSupportStartCommand(): string {
  return TECH_SUPPORT_START_COMMAND
}

export function techSupportPollCommand(): string {
  return TECH_SUPPORT_POLL_COMMAND
}

export function isTechSupportRemotePath(path: string): boolean {
  return REMOTE_PATH.test(path)
}

export function techSupportDeleteCommand(
  remotePath: string
): { ok: true; command: string } | { ok: false; reason: string } {
  if (!isTechSupportRemotePath(remotePath)) {
    return { ok: false, reason: `refusing to delete ${JSON.stringify(remotePath)}` }
  }
  return { ok: true, command: `cli -c 'file delete ${remotePath}'` }
}

export function isTechSupportInFlight(phase: TechSupportPhase): phase is TechSupportInFlightPhase {
  return phase === 'starting' || phase === 'collecting' || phase === 'transferring'
}

export function idleTechSupportSnapshot(profileId: string): TechSupportSnapshot {
  return {
    taskId: null,
    profileId,
    phase: 'idle',
    progress: [],
    artifact: null,
    failure: null,
    lastRemotePath: null,
    lastRemoteBytes: null,
    lastProcessRunning: null,
    cleanupError: null,
    waitingForSession: false
  }
}

export function parseTechSupportPoll(stdout: string): TechSupportPollReading {
  const processIdx = stdout.indexOf(PROCESS_MARKER)
  const filesIdx = stdout.indexOf(FILES_MARKER)
  let processSection = ''
  let filesSection = stdout
  if (processIdx !== -1 && filesIdx !== -1 && filesIdx > processIdx) {
    processSection = stdout.slice(processIdx + PROCESS_MARKER.length, filesIdx)
    filesSection = stdout.slice(filesIdx + FILES_MARKER.length)
  } else if (filesIdx !== -1) {
    filesSection = stdout.slice(filesIdx + FILES_MARKER.length)
  }
  const files: TechSupportPollFile[] = []
  for (const line of filesSection.split('\n')) {
    const parsed = parseLsFileLine(line)
    if (parsed !== undefined) {
      files.push(parsed)
    }
  }
  return {
    processRunning: processSection.includes('show tech_support'),
    files
  }
}

export function pickLatestTechSupportFile(
  files: readonly TechSupportPollFile[]
): TechSupportPollFile | undefined {
  if (files.length === 0) {
    return undefined
  }
  return files.reduce((best, file) => {
    const bestStamp = fileTimestamp(best.path)
    const stamp = fileTimestamp(file.path)
    if (stamp > bestStamp) {
      return file
    }
    if (stamp === bestStamp && file.bytes > best.bytes) {
      return file
    }
    return best
  })
}

function belongsToCurrentCollection(
  file: TechSupportPollFile,
  baseline: readonly TechSupportPollFile[]
): boolean {
  const prior = baseline.find((entry) => entry.path === file.path)
  return prior === undefined || file.bytes > prior.bytes
}

export function pickCurrentCollectionFile(
  files: readonly TechSupportPollFile[],
  baseline: readonly TechSupportPollFile[]
): TechSupportPollFile | undefined {
  return pickLatestTechSupportFile(
    files.filter((file) => belongsToCurrentCollection(file, baseline))
  )
}

export function techSupportFileName(remotePath: string): string {
  const slash = remotePath.lastIndexOf('/')
  return slash === -1 ? remotePath : remotePath.slice(slash + 1)
}

export function techSupportProcessMessage(
  processRunning: boolean,
  file: TechSupportPollFile | undefined
): string {
  if (processRunning) {
    if (file !== undefined) {
      return `采集进程仍在运行；产物 ${file.path} 当前 ${file.bytes} 字节`
    }
    return TECH_SUPPORT_PROCESS_RUNNING_MESSAGE
  }
  if (file !== undefined) {
    return `采集进程已退出；产物 ${file.path} ${file.bytes} 字节`
  }
  return TECH_SUPPORT_PROCESS_EXITED_MESSAGE
}

export function techSupportVerifiedMessage(bytes: number): string {
  return `回传校验通过（${bytes} 字节）`
}

export function techSupportSizeMismatchMessage(remoteBytes: number, localBytes: number): string {
  return `回传校验失败：设备侧 ${remoteBytes} 字节，本机 ${localBytes} 字节`
}

export function techSupportPhaseLabel(phase: Exclude<TechSupportPhase, 'idle'>): string {
  return PHASE_LABELS[phase]
}

export type TechSupportPanelView =
  | { status: 'need-session'; message: string }
  | { status: 'idle'; startLabel: string }
  | {
      status: 'in-progress'
      phase: TechSupportInFlightPhase
      phaseLabel: string
      waitingForSession: boolean
      waitingForSessionMessage: string | null
      progress: Array<{ at: string; message: string }>
    }
  | {
      status: 'done'
      phaseLabel: string
      artifact: {
        fileName: string
        byteSize: number
        byteSizeLabel: string
        localPath: string
        remoteDeleted: boolean
      }
      progress: Array<{ at: string; message: string }>
      openDirectoryLabel: string
      deleteRemoteLabel: string
      recollectLabel: string
      canDeleteRemote: boolean
      cleanupError: string | null
    }
  | {
      status: 'failed'
      phaseLabel: string
      message: string
      lastRemotePath: string | null
      lastRemoteBytes: number | null
      lastProcessRunning: boolean | null
      lastProcessLabel: string | null
      artifact: {
        fileName: string
        byteSize: number
        byteSizeLabel: string
        localPath: string
      } | null
      progress: Array<{ at: string; message: string }>
      recollectLabel: string
    }

export function techSupportPanelView(
  snapshot: TechSupportSnapshot,
  session: { connected: boolean }
): TechSupportPanelView {
  if (!session.connected && snapshot.phase === 'idle') {
    return { status: 'need-session', message: '请先连接' }
  }
  if (snapshot.phase === 'idle') {
    return { status: 'idle', startLabel: TECH_SUPPORT_START_LABEL }
  }
  const progress = snapshot.progress.map((event) => ({ at: event.at, message: event.message }))
  if (isTechSupportInFlight(snapshot.phase)) {
    return {
      status: 'in-progress',
      phase: snapshot.phase,
      phaseLabel: techSupportPhaseLabel(snapshot.phase),
      waitingForSession: snapshot.waitingForSession,
      waitingForSessionMessage: snapshot.waitingForSession
        ? TECH_SUPPORT_WAITING_FOR_SESSION
        : null,
      progress
    }
  }
  if (snapshot.phase === 'done' && snapshot.artifact !== null) {
    return {
      status: 'done',
      phaseLabel: techSupportPhaseLabel('done'),
      artifact: {
        fileName: snapshot.artifact.fileName,
        byteSize: snapshot.artifact.byteSize,
        byteSizeLabel: `${snapshot.artifact.byteSize} 字节`,
        localPath: snapshot.artifact.localPath,
        remoteDeleted: snapshot.artifact.remoteDeleted
      },
      progress,
      openDirectoryLabel: TECH_SUPPORT_OPEN_DIRECTORY_LABEL,
      deleteRemoteLabel: TECH_SUPPORT_DELETE_REMOTE_LABEL,
      recollectLabel: TECH_SUPPORT_RECOLLECT_LABEL,
      canDeleteRemote: !snapshot.artifact.remoteDeleted,
      cleanupError: snapshot.cleanupError
    }
  }
  return {
    status: 'failed',
    phaseLabel: techSupportPhaseLabel('failed'),
    message: snapshot.failure?.message ?? '采集失败',
    lastRemotePath: snapshot.lastRemotePath,
    lastRemoteBytes: snapshot.lastRemoteBytes,
    lastProcessRunning: snapshot.lastProcessRunning,
    lastProcessLabel:
      snapshot.lastProcessRunning === null
        ? null
        : snapshot.lastProcessRunning
          ? '进程仍在运行'
          : '进程已退出',
    artifact:
      snapshot.artifact === null
        ? null
        : {
            fileName: snapshot.artifact.fileName,
            byteSize: snapshot.artifact.byteSize,
            byteSizeLabel: `${snapshot.artifact.byteSize} 字节`,
            localPath: snapshot.artifact.localPath
          },
    progress,
    recollectLabel: TECH_SUPPORT_RECOLLECT_LABEL
  }
}

function parseLsFileLine(line: string): TechSupportPollFile | undefined {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return undefined
  }
  const parts = trimmed.split(/\s+/)
  if (parts.length < 9) {
    return undefined
  }
  const path = parts[parts.length - 1]
  if (path === undefined || !isTechSupportRemotePath(path)) {
    return undefined
  }
  const sizeToken = parts[4]
  if (sizeToken === undefined) {
    return undefined
  }
  const bytes = Number(sizeToken)
  if (!Number.isFinite(bytes) || bytes < 0 || !Number.isInteger(bytes)) {
    return undefined
  }
  return { path, bytes }
}

function fileTimestamp(path: string): string {
  const match = FILE_TIMESTAMP.exec(path)
  return match?.[1] ?? ''
}

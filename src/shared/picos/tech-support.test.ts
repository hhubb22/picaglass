import { describe, expect, it } from 'vitest'
import {
  TECH_SUPPORT_COLLECT_TIMEOUT_MS,
  TECH_SUPPORT_COMMAND,
  TECH_SUPPORT_DELETE_REMOTE_LABEL,
  TECH_SUPPORT_OPEN_DIRECTORY_LABEL,
  TECH_SUPPORT_POLL_INTERVAL_MS,
  TECH_SUPPORT_PROCESS_RUNNING_MESSAGE,
  TECH_SUPPORT_RECOLLECT_LABEL,
  TECH_SUPPORT_START_COMMAND,
  TECH_SUPPORT_START_LABEL,
  TECH_SUPPORT_STARTED_MESSAGE,
  TECH_SUPPORT_WAITING_FOR_SESSION,
  idleTechSupportSnapshot,
  isTechSupportInFlight,
  isTechSupportRemotePath,
  parseTechSupportPoll,
  pickCurrentCollectionFile,
  pickLatestTechSupportFile,
  techSupportDeleteCommand,
  techSupportFileName,
  techSupportPanelView,
  techSupportPollCommand,
  techSupportProcessMessage,
  techSupportSizeMismatchMessage,
  techSupportStartCommand,
  techSupportVerifiedMessage,
  type TechSupportSnapshot
} from './tech-support'

describe('tech_support commands', () => {
  it('starts collection detached from the SSH Session with nohup', () => {
    expect(techSupportStartCommand()).toBe(TECH_SUPPORT_START_COMMAND)
    expect(techSupportStartCommand()).toContain('nohup')
    expect(techSupportStartCommand()).toContain("cli -c 'show tech_support'")
    expect(techSupportStartCommand()).toMatch(/&/)
    expect(TECH_SUPPORT_COMMAND).toBe('show tech_support')
  })

  it('polls process table and artifact listing, not file contents', () => {
    const command = techSupportPollCommand()
    expect(command).toContain('ps aux')
    expect(command).toContain('[s]how tech_support')
    expect(command).toContain('/tmp/*techSupport.log')
    expect(command).not.toContain('complete')
    expect(command).not.toContain('done')
    expect(TECH_SUPPORT_POLL_INTERVAL_MS).toBe(240_000)
    expect(TECH_SUPPORT_COLLECT_TIMEOUT_MS).toBe(1_800_000)
  })

  it('builds a privileged file delete only for a /tmp techSupport.log path', () => {
    expect(techSupportDeleteCommand('/tmp/PICOS-202608310901-techSupport.log')).toEqual({
      ok: true,
      command: "cli -c 'file delete /tmp/PICOS-202608310901-techSupport.log'"
    })
    expect(techSupportDeleteCommand('/etc/passwd')).toEqual({
      ok: false,
      reason: 'refusing to delete "/etc/passwd"'
    })
    expect(techSupportDeleteCommand("/tmp/x-techSupport.log'; rm -rf /")).toEqual({
      ok: false,
      reason: `refusing to delete "/tmp/x-techSupport.log'; rm -rf /"`
    })
    expect(isTechSupportRemotePath('/tmp/PICOS-202608310901-techSupport.log')).toBe(true)
    expect(isTechSupportRemotePath('/tmp/other.log')).toBe(false)
  })
})

describe('parseTechSupportPoll', () => {
  it('treats a live pica_sh tech_support process as still collecting even when the file exists', () => {
    const reading = parseTechSupportPoll(
      [
        '__PG_PROCESS__',
        'root     4321  0.1  0.4  pica_sh -c show tech_support',
        '__PG_FILES__',
        '-rw-r--r-- 1 root xorp 1024 Aug 31 09:04 /tmp/PICOS-202608310901-techSupport.log'
      ].join('\n')
    )
    expect(reading).toEqual({
      processRunning: true,
      files: [{ path: '/tmp/PICOS-202608310901-techSupport.log', bytes: 1024 }]
    })
  })

  it('does not treat file presence as completion when the process section is empty', () => {
    const reading = parseTechSupportPoll(
      [
        '__PG_PROCESS__',
        '',
        '__PG_FILES__',
        '-rw-r--r-- 1 root xorp 2572353 Aug 31 09:08 /tmp/PICOS-202608310901-techSupport.log'
      ].join('\n')
    )
    expect(reading.processRunning).toBe(false)
    expect(reading.files).toEqual([
      { path: '/tmp/PICOS-202608310901-techSupport.log', bytes: 2572353 }
    ])
  })

  it('ignores show tech_support text that only appears in the files section', () => {
    const reading = parseTechSupportPoll(
      [
        '__PG_PROCESS__',
        'admin    99  0.0  0.1  sshd: admin@pts/0',
        '__PG_FILES__',
        '-rw-r--r-- 1 root xorp 12 Aug 31 09:08 /tmp/PICOS-202608310901-techSupport.log'
      ].join('\n')
    )
    expect(reading.processRunning).toBe(false)
  })

  it('picks the latest timestamped artifact when several copies remain', () => {
    const reading = parseTechSupportPoll(
      [
        '__PG_PROCESS__',
        '__PG_FILES__',
        '-rw-r--r-- 1 root xorp 100 Aug 31 08:01 /tmp/PICOS-202608310801-techSupport.log',
        '-rw-r--r-- 1 root xorp 200 Aug 31 09:01 /tmp/PICOS-202608310901-techSupport.log'
      ].join('\n')
    )
    expect(pickLatestTechSupportFile(reading.files)).toEqual({
      path: '/tmp/PICOS-202608310901-techSupport.log',
      bytes: 200
    })
    expect(techSupportFileName('/tmp/PICOS-202608310901-techSupport.log')).toBe(
      'PICOS-202608310901-techSupport.log'
    )
  })

  it('ignores unchanged historical artifacts when choosing the current collection file', () => {
    const historical = {
      path: '/tmp/PICOS-202608310801-techSupport.log',
      bytes: 288_000
    }
    const current = {
      path: '/tmp/PICOS-202608310901-techSupport.log',
      bytes: 2_572_353
    }
    expect(pickCurrentCollectionFile([historical], [historical])).toBeUndefined()
    expect(pickCurrentCollectionFile([historical, current], [historical])).toEqual(current)
    expect(
      pickCurrentCollectionFile([{ ...historical, bytes: 400_000 }], [historical])
    ).toEqual({ path: historical.path, bytes: 400_000 })
  })
})

describe('techSupportPanelView', () => {
  const collecting: TechSupportSnapshot = {
    ...idleTechSupportSnapshot('p-lab'),
    taskId: 'task-1',
    phase: 'collecting',
    lastRemotePath: '/tmp/PICOS-202608310901-techSupport.log',
    lastRemoteBytes: 1024,
    lastProcessRunning: true,
    progress: [
      {
        at: '2026-08-31T09:01:00.000Z',
        phase: 'starting',
        message: TECH_SUPPORT_STARTED_MESSAGE
      },
      {
        at: '2026-08-31T09:04:00.000Z',
        phase: 'collecting',
        message: techSupportProcessMessage(true, {
          path: '/tmp/PICOS-202608310901-techSupport.log',
          bytes: 1024
        })
      }
    ]
  }

  it('shows 请先连接 when idle and there is no active SSH Session', () => {
    expect(techSupportPanelView(idleTechSupportSnapshot('p-lab'), { connected: false })).toEqual({
      status: 'need-session',
      message: '请先连接'
    })
  })

  it('shows a start action when idle with a live session', () => {
    expect(techSupportPanelView(idleTechSupportSnapshot('p-lab'), { connected: true })).toEqual({
      status: 'idle',
      startLabel: TECH_SUPPORT_START_LABEL
    })
    expect(TECH_SUPPORT_START_LABEL).toBe('开始采集')
  })

  it('projects collecting progress and keeps it after the session drops', () => {
    const view = techSupportPanelView(collecting, { connected: false })
    expect(view.status).toBe('in-progress')
    if (view.status !== 'in-progress') {
      return
    }
    expect(view.phase).toBe('collecting')
    expect(view.phaseLabel).toBe('正在采集')
    expect(view.progress).toEqual([
      { at: '2026-08-31T09:01:00.000Z', message: '已在设备侧后台启动采集（nohup 脱离会话）' },
      {
        at: '2026-08-31T09:04:00.000Z',
        message: '采集进程仍在运行；产物 /tmp/PICOS-202608310901-techSupport.log 当前 1024 字节'
      }
    ])
    expect(isTechSupportInFlight('collecting')).toBe(true)
    expect(TECH_SUPPORT_PROCESS_RUNNING_MESSAGE).toBe('采集进程仍在运行')
  })

  it('surfaces waiting-for-session on the progress stream', () => {
    const view = techSupportPanelView(
      { ...collecting, waitingForSession: true },
      { connected: false }
    )
    expect(view.status).toBe('in-progress')
    if (view.status !== 'in-progress') {
      return
    }
    expect(view.waitingForSession).toBe(true)
    expect(view.waitingForSessionMessage).toBe(TECH_SUPPORT_WAITING_FOR_SESSION)
    expect(TECH_SUPPORT_WAITING_FOR_SESSION).toBe('等待 SSH Session 以继续轮询')
  })

  it('projects an artifact card with open-directory, delete-remote, and recollect actions', () => {
    const snapshot: TechSupportSnapshot = {
      ...idleTechSupportSnapshot('p-lab'),
      taskId: 'task-1',
      phase: 'done',
      artifact: {
        fileName: 'PICOS-202608310901-techSupport.log',
        byteSize: 2048,
        localPath: '/tmp/artifacts/PICOS-202608310901-techSupport.log',
        remotePath: '/tmp/PICOS-202608310901-techSupport.log',
        remoteDeleted: true
      },
      progress: [
        {
          at: '2026-08-31T09:08:00.000Z',
          phase: 'done',
          message: techSupportVerifiedMessage(2048)
        }
      ]
    }
    const view = techSupportPanelView(snapshot, { connected: true })
    expect(view).toEqual({
      status: 'done',
      phaseLabel: '采集完成',
      artifact: {
        fileName: 'PICOS-202608310901-techSupport.log',
        byteSize: 2048,
        byteSizeLabel: '2048 字节',
        localPath: '/tmp/artifacts/PICOS-202608310901-techSupport.log',
        remoteDeleted: true
      },
      progress: [{ at: '2026-08-31T09:08:00.000Z', message: '回传校验通过（2048 字节）' }],
      openDirectoryLabel: TECH_SUPPORT_OPEN_DIRECTORY_LABEL,
      deleteRemoteLabel: TECH_SUPPORT_DELETE_REMOTE_LABEL,
      recollectLabel: TECH_SUPPORT_RECOLLECT_LABEL,
      canDeleteRemote: false,
      cleanupError: null
    })
    expect(TECH_SUPPORT_OPEN_DIRECTORY_LABEL).toBe('打开所在目录')
    expect(TECH_SUPPORT_DELETE_REMOTE_LABEL).toBe('删除设备侧副本')
    expect(TECH_SUPPORT_RECOLLECT_LABEL).toBe('重新采集')
  })

  it('keeps last poll facts on a failed collection', () => {
    const snapshot: TechSupportSnapshot = {
      ...idleTechSupportSnapshot('p-lab'),
      taskId: 'task-1',
      phase: 'failed',
      failure: {
        stage: 'transferring',
        message: techSupportSizeMismatchMessage(2048, 1000)
      },
      lastRemotePath: '/tmp/PICOS-202608310901-techSupport.log',
      lastRemoteBytes: 2048,
      lastProcessRunning: false,
      progress: [
        {
          at: '2026-08-31T09:08:00.000Z',
          phase: 'failed',
          message: techSupportSizeMismatchMessage(2048, 1000)
        }
      ]
    }
    const view = techSupportPanelView(snapshot, { connected: true })
    expect(view.status).toBe('failed')
    if (view.status !== 'failed') {
      return
    }
    expect(view.message).toBe('回传校验失败：设备侧 2048 字节，本机 1000 字节')
    expect(view.lastRemotePath).toBe('/tmp/PICOS-202608310901-techSupport.log')
    expect(view.lastRemoteBytes).toBe(2048)
    expect(view.lastProcessRunning).toBe(false)
    expect(view.lastProcessLabel).toBe('进程已退出')
    expect(view.artifact).toBeNull()
    expect(view.recollectLabel).toBe('重新采集')
  })
})

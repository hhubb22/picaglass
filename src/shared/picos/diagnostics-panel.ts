import {
  PARSE_FAILED_NOTICE,
  VIEW_RAW_LABEL,
  deviceFactsCard,
  type DeviceFactsCard,
  type DeviceFactsRun
} from './device-facts'

export const NEED_SESSION_MESSAGE = '请先连接'
export { PARSE_FAILED_NOTICE, VIEW_RAW_LABEL }

export type DiagnosticBlockId =
  'device-facts' | 'interface-status' | 'l2' | 'l3' | 'logs' | 'tech-support'

export type DiagnosticBlockTab = {
  id: DiagnosticBlockId
  label: string
}

const BLOCK_TABS: DiagnosticBlockTab[] = [
  { id: 'device-facts', label: '设备事实' },
  { id: 'interface-status', label: '接口状态' },
  { id: 'l2', label: 'L2' },
  { id: 'l3', label: 'L3' },
  { id: 'logs', label: '日志' },
  { id: 'tech-support', label: 'tech_support 采集' }
]

export function diagnosticBlockTabs(): DiagnosticBlockTab[] {
  return BLOCK_TABS.map((tab) => ({ ...tab }))
}

export function needSessionMessage(): string {
  return NEED_SESSION_MESSAGE
}

export type DeviceFactsPanelView =
  | { status: 'need-session'; message: string }
  | {
      status: 'channel-failed'
      message: string
      exitCode?: number
      stderrHead: string
    }
  | ({ status: 'ready' } & DeviceFactsCard)

function channelMessage(run: Extract<DeviceFactsRun, { kind: 'channel-failed' }>): string {
  if (run.reason === 'timeout') {
    return 'Command timed out'
  }
  if (run.reason === 'rejected') {
    return 'Command channel was rejected'
  }
  if (run.exitCode !== undefined) {
    return `Command failed (exit ${run.exitCode})`
  }
  return 'Command failed'
}

export function deviceFactsPanelView(run: DeviceFactsRun): DeviceFactsPanelView {
  if (run.kind === 'no-session') {
    return { status: 'need-session', message: NEED_SESSION_MESSAGE }
  }
  if (run.kind === 'channel-failed') {
    const view: Extract<DeviceFactsPanelView, { status: 'channel-failed' }> = {
      status: 'channel-failed',
      message: channelMessage(run),
      stderrHead: run.stderrHead
    }
    if (run.exitCode !== undefined) {
      view.exitCode = run.exitCode
    }
    return view
  }
  return { status: 'ready', ...deviceFactsCard(run.block, run.raw) }
}

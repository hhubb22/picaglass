import {
  PARSE_FAILED_NOTICE,
  VIEW_RAW_LABEL,
  deviceFactsCard,
  type DeviceFactsCard,
  type DeviceFactsRun
} from './device-facts'
import {
  interfaceStatusCard,
  type InterfaceStatusCard,
  type InterfaceStatusRun
} from './interface-status'
import { l2Card, type L2Card, type L2Run } from './l2'
import { l3Card, type L3Card, type L3Run } from './l3'
import { logsCard, type LogsCard, type LogsRun } from './logs'

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

type ChannelFailed = Extract<DeviceFactsRun, { kind: 'channel-failed' }>

function channelMessage(run: ChannelFailed): string {
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

function channelFailedView(
  run: ChannelFailed
): Extract<DeviceFactsPanelView, { status: 'channel-failed' }> {
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

export function deviceFactsPanelView(run: DeviceFactsRun): DeviceFactsPanelView {
  if (run.kind === 'no-session') {
    return { status: 'need-session', message: NEED_SESSION_MESSAGE }
  }
  if (run.kind === 'channel-failed') {
    return channelFailedView(run)
  }
  return { status: 'ready', ...deviceFactsCard(run.block, run.raw) }
}

export type InterfaceStatusPanelView =
  | { status: 'need-session'; message: string }
  | {
      status: 'channel-failed'
      message: string
      exitCode?: number
      stderrHead: string
    }
  | { status: 'invalid-interfaces'; message: string }
  | ({ status: 'ready' } & InterfaceStatusCard)

export function interfaceStatusPanelView(run: InterfaceStatusRun): InterfaceStatusPanelView {
  if (run.kind === 'no-session') {
    return { status: 'need-session', message: NEED_SESSION_MESSAGE }
  }
  if (run.kind === 'invalid-interfaces') {
    return { status: 'invalid-interfaces', message: run.reason }
  }
  if (run.kind === 'channel-failed') {
    return channelFailedView(run)
  }
  return { status: 'ready', ...interfaceStatusCard(run.block, run.raw) }
}

export type L2PanelView =
  | { status: 'need-session'; message: string }
  | {
      status: 'channel-failed'
      message: string
      exitCode?: number
      stderrHead: string
    }
  | ({ status: 'ready' } & L2Card)

export function l2PanelView(run: L2Run): L2PanelView {
  if (run.kind === 'no-session') {
    return { status: 'need-session', message: NEED_SESSION_MESSAGE }
  }
  if (run.kind === 'channel-failed') {
    return channelFailedView(run)
  }
  return { status: 'ready', ...l2Card(run.block, run.raw) }
}

export type L3PanelView =
  | { status: 'need-session'; message: string }
  | {
      status: 'channel-failed'
      message: string
      exitCode?: number
      stderrHead: string
    }
  | ({ status: 'ready' } & L3Card)

export function l3PanelView(run: L3Run): L3PanelView {
  if (run.kind === 'no-session') {
    return { status: 'need-session', message: NEED_SESSION_MESSAGE }
  }
  if (run.kind === 'channel-failed') {
    return channelFailedView(run)
  }
  return { status: 'ready', ...l3Card(run.block, run.raw) }
}

export type LogsPanelView =
  | { status: 'need-session'; message: string }
  | {
      status: 'channel-failed'
      message: string
      exitCode?: number
      stderrHead: string
    }
  | { status: 'invalid-lines'; message: string }
  | ({ status: 'ready' } & LogsCard)

export function logsPanelView(run: LogsRun): LogsPanelView {
  if (run.kind === 'no-session') {
    return { status: 'need-session', message: NEED_SESSION_MESSAGE }
  }
  if (run.kind === 'invalid-lines') {
    return { status: 'invalid-lines', message: run.reason }
  }
  if (run.kind === 'channel-failed') {
    return channelFailedView(run)
  }
  return { status: 'ready', ...logsCard(run.block, run.raw) }
}

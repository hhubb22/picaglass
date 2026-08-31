import type {
  DeviceFactsRun,
  FanRow,
  PowerSupplyRow,
  TemperatureRow,
  VersionFacts
} from './device-facts'
import type { ParsedResult } from './parsed-result'

export const NEED_SESSION_MESSAGE = '请先连接'
export const VIEW_RAW_LABEL = '查看原文'
export const PARSE_FAILED_NOTICE = '解析失败，以下为设备原文'

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

export type ParseFailureView = {
  reason: string
  raw: string
}

export type DeviceFactsPanelView =
  | { status: 'need-session'; message: string }
  | {
      status: 'channel-failed'
      message: string
      exitCode?: number
      stderrHead: string
    }
  | {
      status: 'ready'
      parseFailed: boolean
      parseFailedNotice: string | null
      model?: string
      softwareVersion?: string
      serialNumber?: string
      licenseType?: string
      systemUptime?: string
      hardwareId?: string
      deviceMacAddress?: string
      copyright?: string
      softwareReleasedDate?: string
      fans: FanRow[] | null
      temperatures: TemperatureRow[] | null
      powerSupplies: PowerSupplyRow[] | null
      raw: string
      viewRawLabel: string
      versionFailure: ParseFailureView | null
      fansFailure: ParseFailureView | null
      temperaturesFailure: ParseFailureView | null
      powerSuppliesFailure: ParseFailureView | null
    }

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

function failureView<T>(result: ParsedResult<T>): ParseFailureView | null {
  if (result.status !== 'parse-failed') {
    return null
  }
  return { reason: result.reason, raw: result.raw }
}

function copyVersionFields(
  view: Extract<DeviceFactsPanelView, { status: 'ready' }>,
  facts: VersionFacts
): void {
  if (facts.model !== undefined) {
    view.model = facts.model
  }
  if (facts.softwareVersion !== undefined) {
    view.softwareVersion = facts.softwareVersion
  }
  if (facts.serialNumber !== undefined) {
    view.serialNumber = facts.serialNumber
  }
  if (facts.licenseType !== undefined) {
    view.licenseType = facts.licenseType
  }
  if (facts.systemUptime !== undefined) {
    view.systemUptime = facts.systemUptime
  }
  if (facts.hardwareId !== undefined) {
    view.hardwareId = facts.hardwareId
  }
  if (facts.deviceMacAddress !== undefined) {
    view.deviceMacAddress = facts.deviceMacAddress
  }
  if (facts.copyright !== undefined) {
    view.copyright = facts.copyright
  }
  if (facts.softwareReleasedDate !== undefined) {
    view.softwareReleasedDate = facts.softwareReleasedDate
  }
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

  const versionFailure = failureView(run.block.version)
  const fansFailure = failureView(run.block.fans)
  const temperaturesFailure = failureView(run.block.temperatures)
  const powerSuppliesFailure = failureView(run.block.powerSupplies)
  const parseFailed =
    versionFailure !== null ||
    fansFailure !== null ||
    temperaturesFailure !== null ||
    powerSuppliesFailure !== null

  const view: Extract<DeviceFactsPanelView, { status: 'ready' }> = {
    status: 'ready',
    parseFailed,
    parseFailedNotice: parseFailed ? PARSE_FAILED_NOTICE : null,
    fans: run.block.fans.status === 'parsed' ? run.block.fans.data.rows : null,
    temperatures:
      run.block.temperatures.status === 'parsed' ? run.block.temperatures.data.rows : null,
    powerSupplies:
      run.block.powerSupplies.status === 'parsed' ? run.block.powerSupplies.data.rows : null,
    raw: run.raw,
    viewRawLabel: VIEW_RAW_LABEL,
    versionFailure,
    fansFailure,
    temperaturesFailure,
    powerSuppliesFailure
  }
  if (run.block.version.status === 'parsed') {
    copyVersionFields(view, run.block.version.data)
  }
  return view
}

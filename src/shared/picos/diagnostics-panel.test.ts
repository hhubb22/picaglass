import { describe, expect, it } from 'vitest'
import {
  PARSE_FAILED_NOTICE,
  VIEW_RAW_LABEL,
  deviceFactsPanelView,
  diagnosticBlockTabs,
  interfaceStatusPanelView,
  needSessionMessage
} from './diagnostics-panel'
import type { DeviceFactsRun } from './device-facts'
import type { InterfaceStatusRun } from './interface-status'

const parsedRun: DeviceFactsRun = {
  kind: 'ok',
  raw: 'show version output',
  block: {
    version: {
      status: 'parsed',
      data: {
        model: 'S5810-28FS',
        softwareVersion: '9.8.7',
        serialNumber: '<SERIAL>',
        licenseType: 'Uninstalled',
        unparsedLines: 0
      },
      raw: 'version-raw'
    },
    fans: {
      status: 'parsed',
      data: {
        rows: [{ id: '1', speed: '5415 RPM', pwm: '76', direction: 'Forward' }],
        unparsedLines: 0
      },
      raw: 'fan-raw'
    },
    temperatures: {
      status: 'parsed',
      data: {
        rows: [{ sensor: 'CPU', celsius: '33.00', fahrenheit: '91.40' }],
        unparsedLines: 0
      },
      raw: 'temp-raw'
    },
    powerSupplies: {
      status: 'parsed',
      data: {
        rows: [{ id: '1', status: 'Powered on' }],
        unparsedLines: 0
      },
      raw: 'psu-raw'
    }
  }
}

describe('diagnosticBlockTabs', () => {
  it('lays out the six Diagnostic Block tabs with 设备事实 first', () => {
    expect(diagnosticBlockTabs()).toEqual([
      { id: 'device-facts', label: '设备事实' },
      { id: 'interface-status', label: '接口状态' },
      { id: 'l2', label: 'L2' },
      { id: 'l3', label: 'L3' },
      { id: 'logs', label: '日志' },
      { id: 'tech-support', label: 'tech_support 采集' }
    ])
  })
})

describe('deviceFactsPanelView', () => {
  it('shows 请先连接 when there is no active SSH Session', () => {
    expect(deviceFactsPanelView({ kind: 'no-session' })).toEqual({
      status: 'need-session',
      message: needSessionMessage()
    })
    expect(needSessionMessage()).toBe('请先连接')
  })

  it('presents a nonzero-exit channel failure without a parse-failed notice', () => {
    const view = deviceFactsPanelView({
      kind: 'channel-failed',
      reason: 'nonzero-exit',
      exitCode: 1,
      stderrHead: 'syntax error, expecting ...'
    })
    expect(view).toEqual({
      status: 'channel-failed',
      message: 'Command failed (exit 1)',
      exitCode: 1,
      stderrHead: 'syntax error, expecting ...'
    })
    expect(view.status).not.toBe('ready')
  })

  it('presents a timeout as a channel failure', () => {
    expect(
      deviceFactsPanelView({
        kind: 'channel-failed',
        reason: 'timeout',
        stderrHead: ''
      })
    ).toEqual({
      status: 'channel-failed',
      message: 'Command timed out',
      stderrHead: ''
    })
  })

  it('projects parsed device facts and keeps a raw toggle label', () => {
    expect(deviceFactsPanelView(parsedRun)).toEqual({
      status: 'ready',
      parseFailed: false,
      parseFailedNotice: null,
      model: 'S5810-28FS',
      softwareVersion: '9.8.7',
      serialNumber: '<SERIAL>',
      licenseType: 'Uninstalled',
      fans: [{ id: '1', speed: '5415 RPM', pwm: '76', direction: 'Forward' }],
      temperatures: [{ sensor: 'CPU', celsius: '33.00', fahrenheit: '91.40' }],
      powerSupplies: [{ id: '1', status: 'Powered on' }],
      raw: 'show version output',
      viewRawLabel: VIEW_RAW_LABEL,
      versionFailure: null,
      fansFailure: null,
      temperaturesFailure: null,
      powerSuppliesFailure: null
    })
    expect(VIEW_RAW_LABEL).toBe('查看原文')
  })

  it('shows a parse-failed notice plus raw, distinct from a channel failure', () => {
    const run: DeviceFactsRun = {
      kind: 'ok',
      raw: 'garbled version text',
      block: {
        version: {
          status: 'parse-failed',
          raw: 'garbled version text',
          reason: 'missing version skeleton'
        },
        fans: {
          status: 'parsed',
          data: { rows: [], unparsedLines: 0 },
          raw: 'Fan Status:\n'
        },
        temperatures: { status: 'parse-failed', raw: '', reason: 'missing temperature skeleton' },
        powerSupplies: { status: 'parse-failed', raw: '', reason: 'missing power supply skeleton' }
      }
    }
    const view = deviceFactsPanelView(run)
    expect(view.status).toBe('ready')
    if (view.status !== 'ready') {
      return
    }
    expect(view.parseFailed).toBe(true)
    expect(view.parseFailedNotice).toBe(PARSE_FAILED_NOTICE)
    expect(PARSE_FAILED_NOTICE).toBe('解析失败，以下为设备原文')
    expect(view.raw).toBe('garbled version text')
    expect(view.versionFailure).toEqual({
      reason: 'missing version skeleton',
      raw: 'garbled version text'
    })
    expect(view.model).toBeUndefined()
    expect(view.fans).toEqual([])
  })
})

describe('interfaceStatusPanelView', () => {
  it('shows 请先连接 when there is no active SSH Session', () => {
    expect(interfaceStatusPanelView({ kind: 'no-session' })).toEqual({
      status: 'need-session',
      message: needSessionMessage()
    })
  })

  it('presents a nonzero-exit channel failure without a parse-failed notice', () => {
    expect(
      interfaceStatusPanelView({
        kind: 'channel-failed',
        reason: 'nonzero-exit',
        exitCode: 1,
        stderrHead: "syntax error, expecting 'all'"
      })
    ).toEqual({
      status: 'channel-failed',
      message: 'Command failed (exit 1)',
      exitCode: 1,
      stderrHead: "syntax error, expecting 'all'"
    })
  })

  it('surfaces invalid interface names without opening a channel', () => {
    expect(
      interfaceStatusPanelView({
        kind: 'invalid-interfaces',
        reason: 'invalid interface name: "all"'
      })
    ).toEqual({
      status: 'invalid-interfaces',
      message: 'invalid interface name: "all"'
    })
  })

  it('projects a parsed brief table and empty optics as ready data', () => {
    const run: InterfaceStatusRun = {
      kind: 'ok',
      raw: 'combined-raw',
      block: {
        brief: {
          status: 'parsed',
          data: {
            rows: [
              {
                name: 'ge-1/1/1',
                management: 'Enabled',
                status: 'Down',
                speed: 'Auto'
              }
            ],
            unparsedLines: 0
          },
          raw: 'brief-raw'
        },
        optics: {
          status: 'parsed',
          data: { rows: [], unparsedLines: 0 },
          raw: 'optics-raw'
        },
        details: null
      }
    }
    const view = interfaceStatusPanelView(run)
    expect(view.status).toBe('ready')
    if (view.status !== 'ready') {
      return
    }
    expect(view.parseFailed).toBe(false)
    expect(view.brief).toEqual([
      { name: 'ge-1/1/1', management: 'Enabled', status: 'Down', speed: 'Auto' }
    ])
    expect(view.optics).toEqual([])
    expect(view.emptyOpticsNotice).toBe('No optics rows.')
    expect(view.detailsRequested).toBe(false)
    expect(view.viewRawLabel).toBe(VIEW_RAW_LABEL)
  })
})

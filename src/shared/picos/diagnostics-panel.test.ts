import { describe, expect, it } from 'vitest'
import {
  PARSE_FAILED_NOTICE,
  VIEW_RAW_LABEL,
  deviceFactsPanelView,
  diagnosticBlockTabs,
  interfaceStatusPanelView,
  l2PanelView,
  l3PanelView,
  logsPanelView,
  needSessionMessage
} from './diagnostics-panel'
import type { DeviceFactsRun } from './device-facts'
import type { InterfaceStatusRun } from './interface-status'
import type { L2Run } from './l2'
import type { L3Run } from './l3'
import type { LogsRun } from './logs'

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

describe('l2PanelView', () => {
  it('shows 请先连接 when there is no active SSH Session', () => {
    expect(l2PanelView({ kind: 'no-session' })).toEqual({
      status: 'need-session',
      message: needSessionMessage()
    })
  })

  it('presents a nonzero-exit channel failure without a parse-failed notice', () => {
    expect(
      l2PanelView({
        kind: 'channel-failed',
        reason: 'nonzero-exit',
        exitCode: 1,
        stderrHead: "syntax error, expecting 'table'"
      })
    ).toEqual({
      status: 'channel-failed',
      message: 'Command failed (exit 1)',
      exitCode: 1,
      stderrHead: "syntax error, expecting 'table'"
    })
  })

  it('projects parsed VLANs and an empty FDB as ready data', () => {
    const run: L2Run = {
      kind: 'ok',
      raw: 'combined-raw',
      block: {
        vlans: {
          status: 'parsed',
          data: {
            rows: [{ id: '15', name: 'default', untagged: [], tagged: ['ae3'] }],
            unparsedLines: 0
          },
          raw: 'vlan-raw'
        },
        fdb: {
          status: 'parsed',
          data: {
            totalEntries: '0',
            staticEntries: '0',
            dynamicEntries: '0',
            rows: [],
            unparsedLines: 0
          },
          raw: 'fdb-raw'
        },
        switching: {
          status: 'parsed',
          data: {
            rows: [
              {
                name: 'ge-1/1/1',
                state: 'down',
                tagging: 'untagged',
                nativeVlan: '1',
                vlanMembers: []
              }
            ],
            unparsedLines: 0
          },
          raw: 'sw-raw'
        }
      }
    }
    const view = l2PanelView(run)
    expect(view.status).toBe('ready')
    if (view.status !== 'ready') {
      return
    }
    expect(view.parseFailed).toBe(false)
    expect(view.vlans).toEqual([{ id: '15', name: 'default', untagged: [], tagged: ['ae3'] }])
    expect(view.fdb).toEqual([])
    expect(view.emptyFdbNotice).toBe('No FDB rows.')
    expect(view.fdbTotalEntries).toBe('0')
    expect(view.switching).toHaveLength(1)
    expect(view.viewRawLabel).toBe(VIEW_RAW_LABEL)
  })
})

describe('l3PanelView', () => {
  it('shows 请先连接 when there is no active SSH Session', () => {
    expect(l3PanelView({ kind: 'no-session' })).toEqual({
      status: 'need-session',
      message: needSessionMessage()
    })
  })

  it('presents a nonzero-exit channel failure without a parse-failed notice', () => {
    expect(
      l3PanelView({
        kind: 'channel-failed',
        reason: 'nonzero-exit',
        exitCode: 1,
        stderrHead: "syntax error, expecting 'ipv4'"
      })
    ).toEqual({
      status: 'channel-failed',
      message: 'Command failed (exit 1)',
      exitCode: 1,
      stderrHead: "syntax error, expecting 'ipv4'"
    })
  })

  it('projects software and hardware routes on one ready view, with empty ARP as data', () => {
    const run: L3Run = {
      kind: 'ok',
      raw: 'combined-raw',
      block: {
        softwareRoutes: {
          status: 'parsed',
          data: {
            rows: [
              {
                protocol: 'K',
                selected: true,
                fib: true,
                destination: '0.0.0.0/0',
                nexthop: '192.0.2.5',
                interface: 'eth0'
              }
            ],
            unparsedLines: 0
          },
          raw: 'sw-raw'
        },
        hardwareRoutes: {
          status: 'parsed',
          data: {
            totalRouteCount: '1',
            rows: [
              {
                destination: '0.0.0.0/0',
                nextHopMac: '02:00:00:00:00:01',
                port: 'connected'
              }
            ],
            unparsedLines: 0
          },
          raw: 'hw-raw'
        },
        hardwareHosts: {
          status: 'parsed',
          data: { totalHostCount: '0', rows: [], unparsedLines: 0 },
          raw: 'host-raw'
        },
        arp: {
          status: 'parsed',
          data: { agingTime: '1200', totalCount: '0', rows: [], unparsedLines: 0 },
          raw: 'arp-raw'
        },
        neighbors: {
          status: 'parsed',
          data: { agingTime: '1200', totalCount: '0', rows: [], unparsedLines: 0 },
          raw: 'neigh-raw'
        }
      }
    }
    const view = l3PanelView(run)
    expect(view.status).toBe('ready')
    if (view.status !== 'ready') {
      return
    }
    expect(view.parseFailed).toBe(false)
    expect(view.softwareRoutes).toEqual([
      {
        protocol: 'K',
        selected: true,
        fib: true,
        destination: '0.0.0.0/0',
        nexthop: '192.0.2.5',
        interface: 'eth0',
        flags: '>*',
        prefMetric: '—',
        nexthopLabel: '192.0.2.5'
      }
    ])
    expect(view.hardwareRoutes).toEqual([
      {
        destination: '0.0.0.0/0',
        nextHopMac: '02:00:00:00:00:01',
        port: 'connected'
      }
    ])
    expect(view.arp).toEqual([])
    expect(view.emptyArpNotice).toBe('No ARP rows.')
    expect(view.emptyNeighborsNotice).toBe('No neighbor rows.')
    expect(view.hardwareRouteCount).toBe('1')
    expect(view.viewRawLabel).toBe(VIEW_RAW_LABEL)
  })
})

describe('logsPanelView', () => {
  it('shows 请先连接 when there is no active SSH Session', () => {
    expect(logsPanelView({ kind: 'no-session' })).toEqual({
      status: 'need-session',
      message: needSessionMessage()
    })
  })

  it('presents a nonzero-exit channel failure without a parse-failed notice', () => {
    expect(
      logsPanelView({
        kind: 'channel-failed',
        reason: 'nonzero-exit',
        exitCode: 1,
        stderrHead: "syntax error, expecting 'last'"
      })
    ).toEqual({
      status: 'channel-failed',
      message: 'Command failed (exit 1)',
      exitCode: 1,
      stderrHead: "syntax error, expecting 'last'"
    })
  })

  it('surfaces an invalid line count without opening a channel', () => {
    expect(
      logsPanelView({
        kind: 'invalid-lines',
        reason: 'invalid log line count: 0'
      })
    ).toEqual({
      status: 'invalid-lines',
      message: 'invalid log line count: 0'
    })
  })

  it('projects parsed syslog and a no-core symlink as ready data', () => {
    const run: LogsRun = {
      kind: 'ok',
      raw: 'combined-raw',
      block: {
        syslog: {
          status: 'parsed',
          data: {
            rows: [
              {
                timestamp: 'Aug 31 2026 09:35:29',
                host: 'PICOS',
                facility: 'local0',
                severity: 'debug',
                message: '[SIF]Get port link status, interface: ae28'
              }
            ],
            unparsedLines: 0
          },
          raw: 'log-raw'
        },
        core: {
          status: 'parsed',
          data: {
            path: '/pica/core',
            target: '/mnt/open/picos/support',
            symlink: true,
            cores: [],
            unparsedLines: 0
          },
          raw: 'core-raw'
        }
      }
    }
    const view = logsPanelView(run)
    expect(view.status).toBe('ready')
    if (view.status !== 'ready') {
      return
    }
    expect(view.parseFailed).toBe(false)
    expect(view.syslog).toHaveLength(1)
    expect(view.cores).toEqual([])
    expect(view.emptyCoresNotice).toBe('No core dumps.')
    expect(view.corePath).toBe('/pica/core')
    expect(view.coreTarget).toBe('/mnt/open/picos/support')
    expect(view.coreSymlink).toBe(true)
    expect(view.viewRawLabel).toBe(VIEW_RAW_LABEL)
  })
})

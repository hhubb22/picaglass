/**
 * Builds scripts/baseline/payloads.json: diagnostic run objects produced by the
 * real parsers over the golden PicOS fixtures, plus the fixture workspace and
 * tech_support snapshots used by the baseline screenshot harness.
 *
 * Run from the repo root:
 *   node_modules/.bin/esbuild scripts/baseline/generate-payloads.ts --bundle \
 *     --platform=node --format=cjs --outfile=/tmp/picaglass-gen-payloads.cjs
 *   node /tmp/picaglass-gen-payloads.cjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEVICE_FACTS_COMMANDS,
  parseDeviceFacts
} from '../../src/shared/picos/device-facts'
import {
  INTERFACE_STATUS_BRIEF_COMMAND,
  INTERFACE_STATUS_DETAIL_PREFIX,
  INTERFACE_STATUS_OPTICS_COMMAND,
  parseInterfaceStatus
} from '../../src/shared/picos/interface-status'
import {
  L2_FDB_COMMAND,
  L2_SWITCHING_COMMAND,
  L2_VLAN_COMMAND,
  parseL2
} from '../../src/shared/picos/l2'
import {
  L3_ARP_COMMAND,
  L3_HARDWARE_HOST_COMMAND,
  L3_HARDWARE_ROUTE_COMMAND,
  L3_NEIGHBOR_COMMAND,
  L3_SOFTWARE_ROUTE_COMMAND,
  parseL3
} from '../../src/shared/picos/l3'
import { LOGS_CORE_COMMAND, logsSyslogCommand, parseLogs } from '../../src/shared/picos/logs'

const root = process.cwd()
const fixture = (name: string): string =>
  readFileSync(join(root, 'tests/fixtures/picos', name), 'utf8')

function rawOf(commands: Array<{ command: string; output: string }>): string {
  return commands.map((entry) => `$ ${entry.command}\n${entry.output}`).join('\n')
}

const emptyTable = { status: 'parsed', data: { rows: [], unparsedLines: 0 }, raw: '' }

const deviceFactsCommands = [
  { command: 'show version', output: fixture('show-version.txt') },
  { command: 'show system fan', output: fixture('show-system-fan.txt') },
  { command: 'show system temperature', output: fixture('show-system-temperature.txt') },
  { command: 'show system rpsu', output: fixture('show-system-rpsu.txt') }
]

const interfaceStatusCommands = [
  { command: INTERFACE_STATUS_BRIEF_COMMAND, output: fixture('show-interface-brief.txt') },
  {
    command: INTERFACE_STATUS_OPTICS_COMMAND,
    output: fixture('show-interface-diagnostics-optics.txt')
  },
  {
    command: `${INTERFACE_STATUS_DETAIL_PREFIX}te-1/1/49`,
    output: fixture('show-interface-detail.txt')
  }
]

const l2Commands = [
  { command: L2_VLAN_COMMAND, output: fixture('show-vlans.txt') },
  { command: L2_FDB_COMMAND, output: fixture('show-mac-address.txt') },
  {
    command: L2_SWITCHING_COMMAND,
    output: fixture('show-ethernet-switching-interfaces.txt')
  }
]

const l3Commands = [
  { command: L3_SOFTWARE_ROUTE_COMMAND, output: fixture('show-route-ipv4.txt') },
  {
    command: L3_HARDWARE_ROUTE_COMMAND,
    output: fixture('show-route-forward-route-ipv4-all.txt')
  },
  {
    command: L3_HARDWARE_HOST_COMMAND,
    output: fixture('show-route-forward-host-ipv4-all.txt')
  },
  { command: L3_ARP_COMMAND, output: fixture('show-arp.txt') },
  { command: L3_NEIGHBOR_COMMAND, output: fixture('show-neighbors.txt') }
]

const logsCommands = [
  { command: logsSyslogCommand(50), output: fixture('show-log-last-50.txt') },
  { command: LOGS_CORE_COMMAND, output: fixture('file-list-pica-core.txt') }
]

void DEVICE_FACTS_COMMANDS

const payloads = {
  workspace: {
    profiles: [
      {
        id: 'p-leaf01',
        label: 'leaf01.dc1',
        displayName: 'leaf01.dc1',
        host: '10.0.0.11',
        port: 22,
        username: 'admin',
        auth: { method: 'privateKey', label: 'id_ed25519' },
        automaticDiscovery: true,
        lastAttempt: null,
        snapshot: null
      },
      {
        id: 'p-spine02',
        label: 'spine02.dc1',
        displayName: 'spine02.dc1',
        host: '10.0.0.2',
        port: 22,
        username: 'admin',
        auth: { method: 'privateKey', label: 'id_ed25519' },
        automaticDiscovery: true,
        lastAttempt: null,
        snapshot: null
      },
      {
        id: 'p-edge-gw',
        label: 'edge-gw',
        displayName: 'edge-gw',
        host: '192.0.2.1',
        port: 2222,
        username: 'noc',
        auth: { method: 'privateKey', label: 'id_rsa' },
        automaticDiscovery: false,
        lastAttempt: null,
        snapshot: null
      },
      {
        id: 'p-lab-sw',
        label: 'lab-sw',
        displayName: 'lab-sw',
        host: 'lab-sw.local',
        port: 22,
        username: 'admin',
        auth: { method: 'password' },
        automaticDiscovery: true,
        lastAttempt: null,
        snapshot: null
      },
      {
        id: 'p-core01',
        label: 'core01',
        displayName: 'core01',
        host: '172.16.0.1',
        port: 22,
        username: 'backup',
        auth: { method: 'privateKey', label: 'id_ed25519' },
        automaticDiscovery: true,
        lastAttempt: null,
        snapshot: null
      }
    ],
    selectedProfileId: 'p-leaf01',
    sidebarCollapsed: false,
    notice: null
  },
  workspaceEmpty: {
    profiles: [],
    selectedProfileId: null,
    sidebarCollapsed: false,
    notice: null
  },
  snapshot: {
    hostname: 'leaf01',
    kernelName: 'Linux',
    kernelRelease: '5.10.0',
    architecture: 'x86_64',
    observedAt: '2026-01-15T09:30:00.000Z'
  },
  runs: {
    'device-facts': {
      kind: 'ok',
      block: parseDeviceFacts(deviceFactsCommands),
      raw: rawOf(deviceFactsCommands)
    },
    'device-facts-empty': {
      kind: 'ok',
      block: {
        version: { status: 'parsed', data: { unparsedLines: 0 }, raw: '' },
        fans: emptyTable,
        temperatures: emptyTable,
        powerSupplies: emptyTable
      },
      raw: ''
    },
    'interface-status': {
      kind: 'ok',
      block: parseInterfaceStatus(interfaceStatusCommands, '', { includeDetails: true }),
      raw: rawOf(interfaceStatusCommands)
    },
    'interface-status-empty': {
      kind: 'ok',
      block: { brief: emptyTable, optics: emptyTable, details: null },
      raw: ''
    },
    l2: { kind: 'ok', block: parseL2(l2Commands), raw: rawOf(l2Commands) },
    'l2-empty': {
      kind: 'ok',
      block: { vlans: emptyTable, fdb: emptyTable, switching: emptyTable },
      raw: ''
    },
    l3: { kind: 'ok', block: parseL3(l3Commands), raw: rawOf(l3Commands) },
    'l3-empty': {
      kind: 'ok',
      block: {
        softwareRoutes: emptyTable,
        hardwareRoutes: emptyTable,
        hardwareHosts: emptyTable,
        arp: emptyTable,
        neighbors: emptyTable
      },
      raw: ''
    },
    logs: { kind: 'ok', block: parseLogs(logsCommands), raw: rawOf(logsCommands) },
    'logs-empty': {
      kind: 'ok',
      block: {
        syslog: emptyTable,
        core: { status: 'parsed', data: { symlink: false, cores: [], unparsedLines: 0 }, raw: '' }
      },
      raw: ''
    }
  },
  techSupport: {
    idle: {
      taskId: null,
      profileId: 'p-leaf01',
      phase: 'idle',
      progress: [],
      artifact: null,
      failure: null,
      lastRemotePath: null,
      lastRemoteBytes: null,
      lastProcessRunning: null,
      cleanupError: null,
      waitingForSession: false
    },
    collecting: {
      taskId: 'ts-20260115-093000',
      profileId: 'p-leaf01',
      phase: 'collecting',
      progress: [
        {
          at: '2026-01-15T09:30:00.000Z',
          phase: 'starting',
          message: '已在设备侧后台启动采集（nohup 脱离会话）'
        },
        {
          at: '2026-01-15T09:34:00.000Z',
          phase: 'collecting',
          message: '采集进程仍在运行'
        },
        {
          at: '2026-01-15T09:38:00.000Z',
          phase: 'collecting',
          message: '采集进程仍在运行'
        }
      ],
      artifact: null,
      failure: null,
      lastRemotePath: '/pica/tech_support/tech_support_leaf01_20260115.tar.gz',
      lastRemoteBytes: null,
      lastProcessRunning: true,
      cleanupError: null,
      waitingForSession: false
    },
    done: {
      taskId: 'ts-20260115-093000',
      profileId: 'p-leaf01',
      phase: 'done',
      progress: [
        {
          at: '2026-01-15T09:30:00.000Z',
          phase: 'starting',
          message: '已在设备侧后台启动采集（nohup 脱离会话）'
        },
        {
          at: '2026-01-15T09:34:00.000Z',
          phase: 'collecting',
          message: '采集进程仍在运行'
        },
        {
          at: '2026-01-15T09:42:10.000Z',
          phase: 'collecting',
          message: '采集进程已退出'
        },
        {
          at: '2026-01-15T09:42:12.000Z',
          phase: 'transferring',
          message: '正在拉取产物'
        },
        {
          at: '2026-01-15T09:42:31.000Z',
          phase: 'done',
          message: '已删除设备侧副本'
        }
      ],
      artifact: {
        fileName: 'tech_support_leaf01_20260115.tar.gz',
        byteSize: 18874368,
        localPath: '/Users/asa/Library/Application Support/picaglass/tech-support/p-leaf01/tech_support_leaf01_20260115.tar.gz',
        remotePath: '/pica/tech_support/tech_support_leaf01_20260115.tar.gz',
        remoteDeleted: true
      },
      failure: null,
      lastRemotePath: '/pica/tech_support/tech_support_leaf01_20260115.tar.gz',
      lastRemoteBytes: 18874368,
      lastProcessRunning: false,
      cleanupError: null,
      waitingForSession: false
    },
    failed: {
      taskId: 'ts-20260115-093000',
      profileId: 'p-leaf01',
      phase: 'failed',
      progress: [
        {
          at: '2026-01-15T09:30:00.000Z',
          phase: 'starting',
          message: '已在设备侧后台启动采集（nohup 脱离会话）'
        },
        {
          at: '2026-01-15T09:34:00.000Z',
          phase: 'collecting',
          message: '采集进程仍在运行'
        },
        {
          at: '2026-01-15T09:46:00.000Z',
          phase: 'collecting',
          message: '采集进程已退出'
        },
        {
          at: '2026-01-15T09:46:02.000Z',
          phase: 'transferring',
          message: '正在拉取产物'
        }
      ],
      artifact: null,
      failure: { stage: 'transferring', message: 'SFTP 拉取中断：connection lost' },
      lastRemotePath: '/pica/tech_support/tech_support_leaf01_20260115.tar.gz',
      lastRemoteBytes: 12582912,
      lastProcessRunning: false,
      cleanupError: null,
      waitingForSession: false
    }
  },
  mcpConfig: {
    available: true,
    claudeCode: 'claude mcp add picaglass -- http://127.0.0.1:7391/mcp',
    pi: 'pi mcp add picaglass http://127.0.0.1:7391/mcp'
  }
}

const out = join(root, 'scripts/baseline/payloads.json')
writeFileSync(out, JSON.stringify(payloads, null, 2))
console.log(`wrote ${out}`)

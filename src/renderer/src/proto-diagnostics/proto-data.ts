// PROTOTYPE — throwaway mock data for the diagnostics UI prototype (wayfinder #35).
// Question: three variants of the PicOS diagnostics surface inside ProfileWorkspace,
// switchable via ?variant= (A = third workspace tab, B = right drawer, C = bottom panel).

import briefRaw from './fixtures/show-interface-brief.txt?raw'
import versionRaw from './fixtures/show-version.txt?raw'
import vlansRaw from './fixtures/show-vlans.txt?raw'
import logRaw from './fixtures/show-log-last-50.txt?raw'

export type ProtoBlockId =
  | 'device-facts'
  | 'interfaces'
  | 'l2'
  | 'l3'
  | 'logs'
  | 'tech-support'

export type ProtoBlock = {
  id: ProtoBlockId
  label: string
  commands: string[]
}

export const PROTO_BLOCKS: ProtoBlock[] = [
  {
    id: 'device-facts',
    label: '设备事实',
    commands: ['show version', 'show system fan', 'show system temperature', 'show system rpsu']
  },
  {
    id: 'interfaces',
    label: '接口状态',
    commands: ['show interface brief', 'show interface detail', 'show interface diagnostics optics all']
  },
  {
    id: 'l2',
    label: 'L2',
    commands: ['show vlans', 'show mac-address', 'show ethernet-switching interfaces']
  },
  {
    id: 'l3',
    label: 'L3',
    commands: ['show route ipv4', 'show route forward-route ipv4 all', 'show arp', 'show neighbors']
  },
  { id: 'logs', label: '日志', commands: ['show log last 50', 'file list /pica/core'] },
  { id: 'tech-support', label: 'tech_support', commands: ['show tech_support'] }
]

// --- naive throwaway parsing against real fixtures; real parsers land in src/shared/picos/ ---

export type BriefRow = {
  name: string
  management: string
  status: string
  speed: string
  description: string
}

export function parseBrief(raw: string): BriefRow[] {
  const lines = raw.split(/\r?\n/)
  const header = lines.find((l) => l.startsWith('Interface'))
  if (header === undefined) return []
  const cols = ['Interface', 'Management', 'Status', 'Flow Control', 'Duplex', 'Speed', 'Description']
  const at = cols.map((c) => header.indexOf(c))
  const rows: BriefRow[] = []
  for (const line of lines.slice(lines.indexOf(header) + 1)) {
    if (!line.trim() || line.trimStart().startsWith('---')) continue
    const cell = (i: number) => line.slice(at[i], i + 1 < at.length ? at[i + 1] : undefined).trim()
    rows.push({
      name: cell(0),
      management: cell(1),
      status: cell(2),
      speed: cell(5),
      description: cell(6)
    })
  }
  return rows
}

export function parseVersion(raw: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const line of raw.split(/\r?\n/)) {
    const m = /^(.+?)\s*:\s+(.*)$/.exec(line)
    if (m) out.push([m[1].trim(), m[2].trim()])
  }
  return out
}

export const protoBriefRows = parseBrief(briefRaw)
export const protoVersionFacts = parseVersion(versionRaw)

export const PROTO_RAW: Record<string, string> = {
  interfaces: briefRaw,
  'device-facts': versionRaw,
  l2: vlansRaw,
  l3: '',
  logs: logRaw,
  'tech-support': ''
}

// L2 demonstrates the degraded state: parse failed, raw is still shown (CONTEXT.md Parsed Result).
export const PROTO_PARSE_FAILED: Record<string, { reason: string } | undefined> = {
  l2: { reason: 'skeleton 未识别：show vlans 表头与 9.8.x 预期 schema 不符（演示降级状态）' }
}

// L3 demonstrates empty-but-successful tables on a trial-license box.
export const PROTO_EMPTY_NOTE: Record<string, string | undefined> = {
  l3: '路由 / ARP / 邻居表为空（trial license 设备的正常形态：parsed，rows 0 行）'
}

export const PROTO_LOG_LINES = logRaw.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(-8)

export const TECH_SUPPORT_STAGES = [
  'Collecting version information ... OK',
  'Collecting interface information ... OK',
  'Collecting FDB / VLAN tables ... OK',
  'Collecting routing tables (soft + hardware) ... OK',
  'Collecting process list ... OK',
  'Collecting logs ... OK',
  'Writing /tmp/PICOS-20260831-0930-techSupport.log ...'
]

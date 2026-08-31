import type { ParsedResult } from './parsed-result'
import { PARSE_FAILED_NOTICE, VIEW_RAW_LABEL } from './device-facts'
import { normalizeShowCommand } from './show-command'

export const L3_SOFTWARE_ROUTE_COMMAND = 'show route ipv4'
export const L3_HARDWARE_ROUTE_COMMAND = 'show route forward-route ipv4 all'
export const L3_HARDWARE_HOST_COMMAND = 'show route forward-host ipv4 all'
export const L3_ARP_COMMAND = 'show arp'
export const L3_NEIGHBOR_COMMAND = 'show neighbors'

export const L3_COMMANDS = [
  L3_SOFTWARE_ROUTE_COMMAND,
  L3_HARDWARE_ROUTE_COMMAND,
  L3_HARDWARE_HOST_COMMAND,
  L3_ARP_COMMAND,
  L3_NEIGHBOR_COMMAND
] as const

export function l3CliCommand(): string {
  const inner = L3_COMMANDS.map((command) => `${command} | no-more`).join('; ')
  return `cli -c '${inner}'`
}

export type TableFacts<Row> = {
  rows: Row[]
  unparsedLines: number
}

export type SoftwareRouteRow = {
  protocol: string
  selected: boolean
  fib: boolean
  destination: string
  preference?: string
  metric?: string
  nexthop?: string
  connected?: boolean
  unreachable?: boolean
  interface?: string
  weight?: string
  age?: string
}

export type HardwareRouteRow = {
  destination: string
  nextHopMac?: string
  port?: string
}

export type HardwareRouteFacts = TableFacts<HardwareRouteRow> & {
  totalRouteCount?: string
}

export type HardwareHostRow = {
  address: string
  hwAddress?: string
  port?: string
}

export type HardwareHostFacts = TableFacts<HardwareHostRow> & {
  totalHostCount?: string
}

export type NeighborRow = {
  address?: string
  hwAddress?: string
  type?: string
  interface?: string
  age?: string
}

export type NeighborFacts = TableFacts<NeighborRow> & {
  agingTime?: string
  totalCount?: string
}

export type L3Block = {
  softwareRoutes: ParsedResult<TableFacts<SoftwareRouteRow>>
  hardwareRoutes: ParsedResult<HardwareRouteFacts>
  hardwareHosts: ParsedResult<HardwareHostFacts>
  arp: ParsedResult<NeighborFacts>
  neighbors: ParsedResult<NeighborFacts>
}

export type L3ChannelFailure = {
  kind: 'channel-failed'
  reason: 'nonzero-exit' | 'timeout' | 'rejected'
  exitCode?: number
  stderrHead: string
}

export type L3Run =
  { kind: 'no-session' } | L3ChannelFailure | { kind: 'ok'; block: L3Block; raw: string }

const CODES_LINE = /^\s*Codes:/i
const SOFTWARE_ROUTE_LINE = /^([A-Za-z])([>*qrbto ]{0,3})\s+(\S+)(?:\s+\[(\d+)\/(\d+)\])?\s*(.*)$/
const TOTAL_ROUTE_COUNT = /^Total route count:\s*(\S+)\s*$/i
const TOTAL_HOST_COUNT = /^Total host count:\s*(\S+)\s*$/i
const AGING_TIME = /^Aging-time\(seconds\):\s*(\S+)\s*$/i
const TOTAL_COUNT = /^Total count\s*:\s*(\S+)\s*$/i
const MAC_ADDRESS = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$/
const VIA = /^via\s+(\S+)$/i
const DIRECTLY_CONNECTED = /^is directly connected$/i
const UNREACHABLE = /^unreachable(?:\s+\(([^)]+)\))?$/i
const WEIGHT = /^weight\s+(\S+)$/i

function splitLines(raw: string): string[] {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function parsed<T>(data: T, raw: string): ParsedResult<T> {
  return { status: 'parsed', data, raw }
}

function parseFailed<T>(raw: string, reason: string): ParsedResult<T> {
  return { status: 'parse-failed', raw, reason }
}

function dashColumnStarts(line: string): number[] | undefined {
  if (!/^-+(?:\s+-+)+\s*$/.test(line)) {
    return undefined
  }
  const starts: number[] = []
  let inDash = false
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '-') {
      if (!inDash) {
        starts.push(i)
        inDash = true
      }
    } else {
      inDash = false
    }
  }
  return starts.length >= 2 ? starts : undefined
}

function tableCells(line: string, starts: number[]): string[] {
  return starts.map((start, index) => line.slice(start, starts[index + 1]).trim())
}

function headerKey(cell: string): string {
  return cell.replace(/\s+/g, ' ').trim().toLowerCase()
}

function optionalCell(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function assignOptional<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function headerIndex(headers: string[], ...aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header))
}

type CliTable = {
  starts: number[]
  headers: string[]
}

function isMac(value: string): boolean {
  return MAC_ADDRESS.test(value)
}

function isIpv4(value: string): boolean {
  return IPV4.test(value)
}

function isIpv6(value: string): boolean {
  return value.includes(':') && !isMac(value)
}

function looksLikeL3Address(value: string): boolean {
  return isIpv4(value) || isIpv6(value)
}

function looksLikeHardwareRouteHeader(line: string): boolean {
  const lower = line.toLowerCase()
  return lower.includes('destination') && (lower.includes('nexthop') || lower.includes('port'))
}

function looksLikeHardwareHostHeader(line: string): boolean {
  const lower = line.toLowerCase()
  if (lower.includes('destination')) {
    return false
  }
  return lower.includes('address') && lower.includes('port')
}

function looksLikeNeighborHeader(line: string): boolean {
  const lower = line.toLowerCase()
  if (!lower.includes('address')) {
    return false
  }
  return lower.includes('hw') || lower.includes('type') || lower.includes('interface')
}

function isHardwareRouteMeta(line: string): boolean {
  return TOTAL_ROUTE_COUNT.test(line)
}

function isHardwareHostMeta(line: string): boolean {
  return TOTAL_HOST_COUNT.test(line)
}

function isNeighborMeta(line: string): boolean {
  return AGING_TIME.test(line) || TOTAL_COUNT.test(line)
}

function readTaggedTable(
  raw: string,
  looksLikeHeader: (line: string) => boolean,
  extraSkip?: (line: string) => boolean
): {
  table: CliTable | undefined
  rows: string[][]
  rawRows: string[]
  unparsedLines: number
  preamble: string[]
} {
  const rows: string[][] = []
  const rawRows: string[] = []
  const preamble: string[] = []
  let unparsedLines = 0
  let pendingHeader: string | undefined
  let table: CliTable | undefined
  for (const line of splitLines(raw)) {
    if (line.trim().length === 0) {
      continue
    }
    if (extraSkip?.(line) === true) {
      preamble.push(line)
      continue
    }
    const dashes = dashColumnStarts(line)
    if (dashes !== undefined) {
      if (pendingHeader !== undefined && table === undefined) {
        table = {
          starts: dashes,
          headers: tableCells(pendingHeader, dashes).map(headerKey)
        }
        pendingHeader = undefined
        continue
      }
      unparsedLines += 1
      continue
    }
    if (table === undefined) {
      if (looksLikeHeader(line)) {
        pendingHeader = line
        continue
      }
      unparsedLines += 1
      continue
    }
    if (looksLikeHeader(line)) {
      unparsedLines += 1
      continue
    }
    rows.push(tableCells(line, table.starts))
    rawRows.push(line)
  }
  return { table, rows, rawRows, unparsedLines, preamble }
}

function applyRouteDetail(row: SoftwareRouteRow, rest: string): void {
  const segments = rest
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
  for (const segment of segments) {
    const via = VIA.exec(segment)
    if (via !== null) {
      assignOptional(row, 'nexthop', optionalCell(via[1]))
      continue
    }
    if (DIRECTLY_CONNECTED.test(segment)) {
      row.connected = true
      continue
    }
    const unreachable = UNREACHABLE.exec(segment)
    if (unreachable !== null) {
      row.unreachable = true
      assignOptional(row, 'nexthop', optionalCell(unreachable[1]))
      continue
    }
    const weight = WEIGHT.exec(segment)
    if (weight !== null) {
      assignOptional(row, 'weight', optionalCell(weight[1]))
      continue
    }
    if (
      row.interface === undefined &&
      row.unreachable !== true &&
      (row.connected === true || row.nexthop !== undefined)
    ) {
      assignOptional(row, 'interface', segment)
      continue
    }
    assignOptional(row, 'age', segment)
  }
}

export function parseSoftwareRoutes(raw: string): ParsedResult<TableFacts<SoftwareRouteRow>> {
  const lines = splitLines(raw)
  const hasCodes = lines.some((line) => CODES_LINE.test(line))
  if (!hasCodes) {
    return parseFailed(raw, 'missing software route skeleton')
  }
  const rows: SoftwareRouteRow[] = []
  let unparsedLines = 0
  for (const line of lines) {
    if (line.trim().length === 0 || CODES_LINE.test(line) || /^\s/.test(line)) {
      continue
    }
    const match = SOFTWARE_ROUTE_LINE.exec(line)
    if (match === null || match[1] === undefined || match[3] === undefined) {
      unparsedLines += 1
      continue
    }
    const flags = match[2] ?? ''
    const row: SoftwareRouteRow = {
      protocol: match[1],
      selected: flags.includes('>'),
      fib: flags.includes('*'),
      destination: match[3]
    }
    assignOptional(row, 'preference', optionalCell(match[4]))
    assignOptional(row, 'metric', optionalCell(match[5]))
    applyRouteDetail(row, match[6] ?? '')
    rows.push(row)
  }
  return parsed({ rows, unparsedLines }, raw)
}

function applyHardwareRouteMeta(facts: HardwareRouteFacts, line: string): void {
  const total = TOTAL_ROUTE_COUNT.exec(line)
  if (total !== null) {
    assignOptional(facts, 'totalRouteCount', optionalCell(total[1]))
  }
}

export function parseHardwareRoutes(raw: string): ParsedResult<HardwareRouteFacts> {
  const {
    table,
    rawRows,
    unparsedLines: skipped,
    preamble
  } = readTaggedTable(raw, looksLikeHardwareRouteHeader, isHardwareRouteMeta)
  if (table === undefined || headerIndex(table.headers, 'destination') === -1) {
    return parseFailed(raw, 'missing hardware route skeleton')
  }
  const facts: HardwareRouteFacts = { rows: [], unparsedLines: skipped }
  for (const line of preamble) {
    applyHardwareRouteMeta(facts, line)
  }
  for (const line of rawRows) {
    const tokens = line
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0)
    const destination = optionalCell(tokens[0])
    if (destination === undefined || !looksLikeL3Address(destination)) {
      facts.unparsedLines += 1
      continue
    }
    const row: HardwareRouteRow = { destination }
    assignOptional(row, 'nextHopMac', optionalCell(tokens[1]))
    assignOptional(row, 'port', optionalCell(tokens.slice(2).join(' ')))
    facts.rows.push(row)
  }
  return parsed(facts, raw)
}

function applyHardwareHostMeta(facts: HardwareHostFacts, line: string): void {
  const total = TOTAL_HOST_COUNT.exec(line)
  if (total !== null) {
    assignOptional(facts, 'totalHostCount', optionalCell(total[1]))
  }
}

export function parseHardwareHosts(raw: string): ParsedResult<HardwareHostFacts> {
  const {
    table,
    rawRows,
    unparsedLines: skipped,
    preamble
  } = readTaggedTable(raw, looksLikeHardwareHostHeader, isHardwareHostMeta)
  if (table === undefined || headerIndex(table.headers, 'address') === -1) {
    return parseFailed(raw, 'missing hardware host skeleton')
  }
  const facts: HardwareHostFacts = { rows: [], unparsedLines: skipped }
  for (const line of preamble) {
    applyHardwareHostMeta(facts, line)
  }
  for (const line of rawRows) {
    const tokens = line
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0)
    const address = optionalCell(tokens[0])
    if (address === undefined || !looksLikeL3Address(address)) {
      facts.unparsedLines += 1
      continue
    }
    const row: HardwareHostRow = { address }
    assignOptional(row, 'hwAddress', optionalCell(tokens[1]))
    assignOptional(row, 'port', optionalCell(tokens.slice(2).join(' ')))
    facts.rows.push(row)
  }
  return parsed(facts, raw)
}

function applyNeighborMeta(facts: NeighborFacts, line: string): void {
  const aging = AGING_TIME.exec(line)
  if (aging !== null) {
    assignOptional(facts, 'agingTime', optionalCell(aging[1]))
    return
  }
  const total = TOTAL_COUNT.exec(line)
  if (total !== null) {
    assignOptional(facts, 'totalCount', optionalCell(total[1]))
  }
}

function parseNeighborTable(raw: string, missingReason: string): ParsedResult<NeighborFacts> {
  const {
    table,
    rows,
    unparsedLines: skipped,
    preamble
  } = readTaggedTable(raw, looksLikeNeighborHeader, isNeighborMeta)
  const facts: NeighborFacts = { rows: [], unparsedLines: skipped }
  for (const line of preamble) {
    applyNeighborMeta(facts, line)
  }
  const hasMeta = facts.agingTime !== undefined || facts.totalCount !== undefined
  if (table === undefined) {
    if (!hasMeta) {
      return parseFailed(raw, missingReason)
    }
    return parsed(facts, raw)
  }
  const addressIdx = headerIndex(table.headers, 'address')
  if (addressIdx === -1) {
    return parseFailed(raw, missingReason)
  }
  const macIdx = headerIndex(table.headers, 'hw address', 'hwaddress')
  const typeIdx = headerIndex(table.headers, 'type')
  const ifIdx = headerIndex(table.headers, 'interface')
  const ageIdx = headerIndex(table.headers, 'age')
  for (const cells of rows) {
    const address = optionalCell(cells[addressIdx])
    const hwAddress = optionalCell(cells[macIdx])
    const looksLikeRow =
      (address !== undefined && looksLikeL3Address(address)) ||
      (hwAddress !== undefined && isMac(hwAddress))
    if (!looksLikeRow) {
      facts.unparsedLines += 1
      continue
    }
    const row: NeighborRow = {}
    assignOptional(row, 'address', address)
    assignOptional(row, 'hwAddress', hwAddress)
    assignOptional(row, 'type', optionalCell(cells[typeIdx]))
    assignOptional(row, 'interface', optionalCell(cells[ifIdx]))
    assignOptional(row, 'age', optionalCell(cells[ageIdx]))
    facts.rows.push(row)
  }
  return parsed(facts, raw)
}

export function parseArp(raw: string): ParsedResult<NeighborFacts> {
  return parseNeighborTable(raw, 'missing arp skeleton')
}

export function parseNeighbors(raw: string): ParsedResult<NeighborFacts> {
  return parseNeighborTable(raw, 'missing neighbor skeleton')
}

function outputFor(
  commands: Array<{ command: string; output: string }>,
  name: string,
  fallbackRaw: string
): string {
  for (const entry of commands) {
    if (normalizeShowCommand(entry.command) === name) {
      return entry.output
    }
  }
  return fallbackRaw
}

export function parseL3(
  commands: Array<{ command: string; output: string }>,
  fallbackRaw = ''
): L3Block {
  return {
    softwareRoutes: parseSoftwareRoutes(
      outputFor(commands, L3_SOFTWARE_ROUTE_COMMAND, fallbackRaw)
    ),
    hardwareRoutes: parseHardwareRoutes(
      outputFor(commands, L3_HARDWARE_ROUTE_COMMAND, fallbackRaw)
    ),
    hardwareHosts: parseHardwareHosts(outputFor(commands, L3_HARDWARE_HOST_COMMAND, fallbackRaw)),
    arp: parseArp(outputFor(commands, L3_ARP_COMMAND, fallbackRaw)),
    neighbors: parseNeighbors(outputFor(commands, L3_NEIGHBOR_COMMAND, fallbackRaw))
  }
}

export type ParseFailureView = {
  reason: string
  raw: string
}

export type L3Card = {
  parseFailed: boolean
  parseFailedNotice: string | null
  softwareRoutes: SoftwareRouteRow[] | null
  hardwareRoutes: HardwareRouteRow[] | null
  hardwareHosts: HardwareHostRow[] | null
  arp: NeighborRow[] | null
  neighbors: NeighborRow[] | null
  hardwareRouteCount?: string
  hardwareHostCount?: string
  arpAgingTime?: string
  arpTotalCount?: string
  neighborAgingTime?: string
  neighborTotalCount?: string
  emptySoftwareRoutesNotice: string | null
  emptyHardwareRoutesNotice: string | null
  emptyHardwareHostsNotice: string | null
  emptyArpNotice: string | null
  emptyNeighborsNotice: string | null
  raw: string
  viewRawLabel: string
  softwareRoutesFailure: ParseFailureView | null
  hardwareRoutesFailure: ParseFailureView | null
  hardwareHostsFailure: ParseFailureView | null
  arpFailure: ParseFailureView | null
  neighborsFailure: ParseFailureView | null
}

function failureView<T>(result: ParsedResult<T>): ParseFailureView | null {
  if (result.status !== 'parse-failed') {
    return null
  }
  return { reason: result.reason, raw: result.raw }
}

export function l3Card(block: L3Block, raw: string): L3Card {
  const softwareRoutesFailure = failureView(block.softwareRoutes)
  const hardwareRoutesFailure = failureView(block.hardwareRoutes)
  const hardwareHostsFailure = failureView(block.hardwareHosts)
  const arpFailure = failureView(block.arp)
  const neighborsFailure = failureView(block.neighbors)
  const parseFailed =
    softwareRoutesFailure !== null ||
    hardwareRoutesFailure !== null ||
    hardwareHostsFailure !== null ||
    arpFailure !== null ||
    neighborsFailure !== null
  const softwareRoutes =
    block.softwareRoutes.status === 'parsed' ? block.softwareRoutes.data.rows : null
  const hardwareRoutes =
    block.hardwareRoutes.status === 'parsed' ? block.hardwareRoutes.data.rows : null
  const hardwareHosts =
    block.hardwareHosts.status === 'parsed' ? block.hardwareHosts.data.rows : null
  const arp = block.arp.status === 'parsed' ? block.arp.data.rows : null
  const neighbors = block.neighbors.status === 'parsed' ? block.neighbors.data.rows : null
  const card: L3Card = {
    parseFailed,
    parseFailedNotice: parseFailed ? PARSE_FAILED_NOTICE : null,
    softwareRoutes,
    hardwareRoutes,
    hardwareHosts,
    arp,
    neighbors,
    emptySoftwareRoutesNotice:
      softwareRoutes !== null && softwareRoutes.length === 0 ? 'No software route rows.' : null,
    emptyHardwareRoutesNotice:
      hardwareRoutes !== null && hardwareRoutes.length === 0 ? 'No hardware route rows.' : null,
    emptyHardwareHostsNotice:
      hardwareHosts !== null && hardwareHosts.length === 0 ? 'No hardware host rows.' : null,
    emptyArpNotice: arp !== null && arp.length === 0 ? 'No ARP rows.' : null,
    emptyNeighborsNotice: neighbors !== null && neighbors.length === 0 ? 'No neighbor rows.' : null,
    raw,
    viewRawLabel: VIEW_RAW_LABEL,
    softwareRoutesFailure,
    hardwareRoutesFailure,
    hardwareHostsFailure,
    arpFailure,
    neighborsFailure
  }
  if (block.hardwareRoutes.status === 'parsed') {
    assignOptional(card, 'hardwareRouteCount', block.hardwareRoutes.data.totalRouteCount)
  }
  if (block.hardwareHosts.status === 'parsed') {
    assignOptional(card, 'hardwareHostCount', block.hardwareHosts.data.totalHostCount)
  }
  if (block.arp.status === 'parsed') {
    assignOptional(card, 'arpAgingTime', block.arp.data.agingTime)
    assignOptional(card, 'arpTotalCount', block.arp.data.totalCount)
  }
  if (block.neighbors.status === 'parsed') {
    assignOptional(card, 'neighborAgingTime', block.neighbors.data.agingTime)
    assignOptional(card, 'neighborTotalCount', block.neighbors.data.totalCount)
  }
  return card
}

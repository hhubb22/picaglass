import type { ParsedResult } from './parsed-result'
import { PARSE_FAILED_NOTICE, VIEW_RAW_LABEL } from './device-facts'
import { normalizeShowCommand } from './show-command'

export const INTERFACE_STATUS_BRIEF_COMMAND = 'show interface brief'
export const INTERFACE_STATUS_OPTICS_COMMAND = 'show interface diagnostics optics all'
export const INTERFACE_STATUS_DETAIL_PREFIX = 'show interface detail '

const INTERFACE_NAME = /^[A-Za-z][A-Za-z0-9/._:-]{0,47}(?:\([0-9]{1,6}\))?$/
const RESERVED_INTERFACE_NAMES = new Set(['all', 'interface'])

export type TableFacts<Row> = {
  rows: Row[]
  unparsedLines: number
}

export type InterfaceBriefRow = {
  name: string
  management?: string
  status?: string
  flowControl?: string
  duplex?: string
  speed?: string
  description?: string
}

export type OpticsRow = {
  name: string
  temperature?: string
  voltage?: string
  bias?: string
  txPower?: string
  rxPower?: string
  moduleType?: string
}

export type InterfaceMemberRow = {
  name: string
  status?: string
  speed?: string
}

export type InterfaceDetail = {
  name: string
  management?: string
  link?: string
  errorDiscard?: string
  portMode?: string
  description?: string
  mtu?: string
  speed?: string
  duplex?: string
  flowControl?: string
  currentAddress?: string
  hardwareAddress?: string
  inputPackets?: string
  outputPackets?: string
  inputOctets?: string
  outputOctets?: string
  members: InterfaceMemberRow[]
  unparsedLines: number
}

export type InterfaceStatusBlock = {
  brief: ParsedResult<TableFacts<InterfaceBriefRow>>
  optics: ParsedResult<TableFacts<OpticsRow>>
  details: ParsedResult<TableFacts<InterfaceDetail>> | null
}

export type InterfaceStatusChannelFailure = {
  kind: 'channel-failed'
  reason: 'nonzero-exit' | 'timeout' | 'rejected'
  exitCode?: number
  stderrHead: string
}

export type InterfaceStatusRun =
  | { kind: 'no-session' }
  | { kind: 'invalid-interfaces'; reason: string }
  | InterfaceStatusChannelFailure
  | { kind: 'ok'; block: InterfaceStatusBlock; raw: string }

export type ParseInterfaceNames = { ok: true; names: string[] } | { ok: false; reason: string }

export function parseInterfaceNames(raw: readonly string[]): ParseInterfaceNames {
  const names: string[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const name = entry.trim()
    if (name.length === 0) {
      return { ok: false, reason: 'invalid interface name: ""' }
    }
    if (RESERVED_INTERFACE_NAMES.has(name.toLowerCase()) || !INTERFACE_NAME.test(name)) {
      return { ok: false, reason: `invalid interface name: ${JSON.stringify(name)}` }
    }
    if (seen.has(name)) {
      continue
    }
    seen.add(name)
    names.push(name)
  }
  return { ok: true, names }
}

export function interfaceDetailCommand(name: string): string {
  return `${INTERFACE_STATUS_DETAIL_PREFIX}${name}`
}

export type InterfaceStatusCliCommand =
  { ok: true; names: string[]; command: string } | { ok: false; reason: string }

export function interfaceStatusCliCommand(
  names: readonly string[] = []
): InterfaceStatusCliCommand {
  const parsed = parseInterfaceNames(names)
  if (!parsed.ok) {
    return parsed
  }
  const commands = [
    `${INTERFACE_STATUS_BRIEF_COMMAND} | no-more`,
    `${INTERFACE_STATUS_OPTICS_COMMAND} | no-more`,
    ...parsed.names.map((name) => `${interfaceDetailCommand(name)} | no-more`)
  ]
  return { ok: true, names: parsed.names, command: `cli -c '${commands.join('; ')}'` }
}

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

function looksLikeTableHeader(line: string): boolean {
  const lower = line.toLowerCase()
  if (!lower.includes('interface')) {
    return false
  }
  return (
    lower.includes('management') ||
    lower.includes('temp') ||
    lower.includes('members') ||
    lower.includes('status')
  )
}

function isRowName(name: string): boolean {
  if (RESERVED_INTERFACE_NAMES.has(name.toLowerCase())) {
    return false
  }
  return INTERFACE_NAME.test(name)
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

type CliTable = {
  starts: number[]
  headers: string[]
}

function readCliTable(raw: string): {
  table: CliTable | undefined
  rows: string[][]
  unparsedLines: number
} {
  const rows: string[][] = []
  let unparsedLines = 0
  let pendingHeader: string | undefined
  let table: CliTable | undefined
  for (const line of splitLines(raw)) {
    if (line.trim().length === 0) {
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
      if (looksLikeTableHeader(line)) {
        pendingHeader = line
        continue
      }
      unparsedLines += 1
      continue
    }
    if (looksLikeTableHeader(line)) {
      unparsedLines += 1
      continue
    }
    const cells = tableCells(line, table.starts)
    const name = cells[0] ?? ''
    if (!isRowName(name)) {
      unparsedLines += 1
      continue
    }
    rows.push(cells)
  }
  return { table, rows, unparsedLines }
}

function headerIndex(headers: string[], ...aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header))
}

export function parseInterfaceBrief(raw: string): ParsedResult<TableFacts<InterfaceBriefRow>> {
  const { table, rows, unparsedLines } = readCliTable(raw)
  if (table === undefined) {
    return parseFailed(raw, 'missing interface brief skeleton')
  }
  const headers = table.headers
  if (
    headerIndex(headers, 'interface') === -1 ||
    headerIndex(headers, 'management') === -1 ||
    headerIndex(headers, 'status') === -1
  ) {
    return parseFailed(raw, 'missing interface brief skeleton')
  }
  const nameIdx = headerIndex(headers, 'interface')
  const managementIdx = headerIndex(headers, 'management')
  const statusIdx = headerIndex(headers, 'status')
  const flowIdx = headerIndex(headers, 'flow control')
  const duplexIdx = headerIndex(headers, 'duplex')
  const speedIdx = headerIndex(headers, 'speed')
  const descriptionIdx = headerIndex(headers, 'description')
  const parsedRows: InterfaceBriefRow[] = []
  for (const cells of rows) {
    const name = cells[nameIdx]
    if (name === undefined) {
      continue
    }
    const row: InterfaceBriefRow = { name }
    assignOptional(row, 'management', optionalCell(cells[managementIdx]))
    assignOptional(row, 'status', optionalCell(cells[statusIdx]))
    assignOptional(row, 'flowControl', optionalCell(cells[flowIdx]))
    assignOptional(row, 'duplex', optionalCell(cells[duplexIdx]))
    assignOptional(row, 'speed', optionalCell(cells[speedIdx]))
    assignOptional(row, 'description', optionalCell(cells[descriptionIdx]))
    parsedRows.push(row)
  }
  return parsed({ rows: parsedRows, unparsedLines }, raw)
}

export function parseOptics(raw: string): ParsedResult<TableFacts<OpticsRow>> {
  const { table, rows, unparsedLines } = readCliTable(raw)
  if (table === undefined) {
    return parseFailed(raw, 'missing optics skeleton')
  }
  const headers = table.headers
  if (
    headerIndex(headers, 'interface') === -1 ||
    headerIndex(headers, 'temp(c/f)', 'temp') === -1
  ) {
    return parseFailed(raw, 'missing optics skeleton')
  }
  const nameIdx = headerIndex(headers, 'interface')
  const tempIdx = headerIndex(headers, 'temp(c/f)', 'temp')
  const voltageIdx = headerIndex(headers, 'voltage(v)', 'voltage')
  const biasIdx = headerIndex(headers, 'bias(ma)', 'bias')
  const txIdx = headerIndex(headers, 'tx power(dbm)', 'tx power')
  const rxIdx = headerIndex(headers, 'rx power(dbm)', 'rx power')
  const typeIdx = headerIndex(headers, 'module type')
  const parsedRows: OpticsRow[] = []
  for (const cells of rows) {
    const name = cells[nameIdx]
    if (name === undefined) {
      continue
    }
    const row: OpticsRow = { name }
    assignOptional(row, 'temperature', optionalCell(cells[tempIdx]))
    assignOptional(row, 'voltage', optionalCell(cells[voltageIdx]))
    assignOptional(row, 'bias', optionalCell(cells[biasIdx]))
    assignOptional(row, 'txPower', optionalCell(cells[txIdx]))
    assignOptional(row, 'rxPower', optionalCell(cells[rxIdx]))
    assignOptional(row, 'moduleType', optionalCell(cells[typeIdx]))
    parsedRows.push(row)
  }
  return parsed({ rows: parsedRows, unparsedLines }, raw)
}

const PHYSICAL_INTERFACE = /^\s*Physical interface:\s*([^,\n]+)/i
const PHYSICAL_ADMIN = /\b(Enabled|Disabled)\b/i
const PHYSICAL_LINK = /Physical link is\s+([^,\s]+)/i
const PHYSICAL_ERROR_DISCARD = /error-discard\s+([^,\s]+)/i
const PORT_MODE = /^\s*Port mode:\s*([^,]+)/i
const DESCRIPTION = /^\s*Description:\s*(.*?)\s*$/i
const LINK_LEVEL = /^\s*Link-level type:/i
const SOURCE_FILTERING = /^\s*Source filtering:/i
const CURRENT_ADDRESS = /^\s*Current address:/i
const INPUT_PACKETS = /^\s*Input Packets\.+(\d+)\s*$/i
const OUTPUT_PACKETS = /^\s*Output Packets\.+(\d+)\s*$/i
const INPUT_OCTETS = /^\s*Input Octets\.+(\d+)\s*$/i
const OUTPUT_OCTETS = /^\s*Output Octets\.+(\d+)\s*$/i
function valueAfter(label: string, line: string): string | undefined {
  const match = new RegExp(`${label}\\s*:\\s*([^,]+)`, 'i').exec(line)
  return optionalCell(match?.[1])
}

function parseMembers(lines: string[]): { members: InterfaceMemberRow[]; unparsedLines: number } {
  const members: InterfaceMemberRow[] = []
  let unparsedLines = 0
  let headerAt = -1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (/^\s*Members\b/i.test(line) && /status/i.test(line)) {
      headerAt = i
      break
    }
  }
  if (headerAt === -1) {
    return { members, unparsedLines }
  }
  let starts: number[] | undefined
  let index = headerAt + 1
  while (index < lines.length) {
    const line = (lines[index] ?? '').trimEnd()
    if (line.trim().length === 0) {
      index += 1
      continue
    }
    const dashes = dashColumnStarts(line.trimStart())
    if (dashes !== undefined) {
      starts = dashes
      index += 1
      break
    }
    break
  }
  if (starts === undefined) {
    return { members, unparsedLines }
  }
  while (index < lines.length) {
    const line = (lines[index] ?? '').trimEnd()
    if (line.trim().length === 0) {
      break
    }
    if (looksLikeTableHeader(line) || dashColumnStarts(line.trimStart()) !== undefined) {
      break
    }
    const cells = tableCells(line.trimStart(), starts)
    const name = optionalCell(cells[0])
    if (name === undefined || !isRowName(name)) {
      unparsedLines += 1
      index += 1
      continue
    }
    const member: InterfaceMemberRow = { name }
    assignOptional(member, 'status', optionalCell(cells[1]))
    assignOptional(member, 'speed', optionalCell(cells[2]))
    members.push(member)
    index += 1
  }
  return { members, unparsedLines }
}

function parseDetailBlock(block: string): InterfaceDetail | undefined {
  const lines = splitLines(block)
  const first = lines.find((line) => line.trim().length > 0)
  if (first === undefined) {
    return undefined
  }
  const match = PHYSICAL_INTERFACE.exec(first)
  if (match === null) {
    return undefined
  }
  const name = match[1]?.trim()
  if (name === undefined || name.length === 0) {
    return undefined
  }
  const detail: InterfaceDetail = { name, members: [], unparsedLines: 0 }
  assignOptional(detail, 'management', optionalCell(PHYSICAL_ADMIN.exec(first)?.[1]))
  assignOptional(detail, 'errorDiscard', optionalCell(PHYSICAL_ERROR_DISCARD.exec(first)?.[1]))
  assignOptional(detail, 'link', optionalCell(PHYSICAL_LINK.exec(first)?.[1]))
  const memberTable = parseMembers(lines)
  detail.members = memberTable.members
  detail.unparsedLines += memberTable.unparsedLines
  for (const line of lines) {
    if (line.trim().length === 0 || line === first) {
      continue
    }
    const portMode = PORT_MODE.exec(line)
    if (portMode !== null) {
      assignOptional(detail, 'portMode', optionalCell(portMode[1]))
      continue
    }
    const description = DESCRIPTION.exec(line)
    if (description !== null) {
      assignOptional(detail, 'description', optionalCell(description[1]))
      continue
    }
    if (LINK_LEVEL.test(line)) {
      assignOptional(detail, 'mtu', valueAfter('MTU', line))
      assignOptional(detail, 'speed', valueAfter('Speed', line))
      assignOptional(detail, 'duplex', valueAfter('Duplex', line))
      continue
    }
    if (SOURCE_FILTERING.test(line)) {
      assignOptional(detail, 'flowControl', valueAfter('Flow control', line))
      continue
    }
    if (CURRENT_ADDRESS.test(line)) {
      assignOptional(detail, 'currentAddress', valueAfter('Current address', line))
      assignOptional(detail, 'hardwareAddress', valueAfter('Hardware address', line))
      continue
    }
    const inputPackets = INPUT_PACKETS.exec(line)
    if (inputPackets !== null) {
      assignOptional(detail, 'inputPackets', optionalCell(inputPackets[1]))
      continue
    }
    const outputPackets = OUTPUT_PACKETS.exec(line)
    if (outputPackets !== null) {
      assignOptional(detail, 'outputPackets', optionalCell(outputPackets[1]))
      continue
    }
    const inputOctets = INPUT_OCTETS.exec(line)
    if (inputOctets !== null) {
      assignOptional(detail, 'inputOctets', optionalCell(inputOctets[1]))
      continue
    }
    const outputOctets = OUTPUT_OCTETS.exec(line)
    if (outputOctets !== null) {
      assignOptional(detail, 'outputOctets', optionalCell(outputOctets[1]))
      continue
    }
  }
  return detail
}

export function parseInterfaceDetail(raw: string): ParsedResult<TableFacts<InterfaceDetail>> {
  const lines = splitLines(raw)
  const blocks: string[] = []
  let current: string[] | undefined
  let preambleUnparsed = 0
  for (const line of lines) {
    if (/^\s*Physical interface:\s*/.test(line)) {
      if (current !== undefined) {
        blocks.push(current.join('\n'))
      }
      current = [line]
      continue
    }
    if (current !== undefined) {
      current.push(line)
    } else if (line.trim().length > 0) {
      preambleUnparsed += 1
    }
  }
  if (current !== undefined) {
    blocks.push(current.join('\n'))
  }
  if (blocks.length === 0) {
    return parseFailed(raw, 'missing interface detail skeleton')
  }
  const rows: InterfaceDetail[] = []
  let unparsedLines = preambleUnparsed
  for (const block of blocks) {
    const detail = parseDetailBlock(block)
    if (detail === undefined) {
      unparsedLines += 1
      continue
    }
    rows.push(detail)
  }
  return parsed({ rows, unparsedLines }, raw)
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

function detailOutputs(
  commands: Array<{ command: string; output: string }>,
  fallbackRaw: string
): string {
  const parts: string[] = []
  for (const entry of commands) {
    const command = normalizeShowCommand(entry.command)
    if (command.startsWith(INTERFACE_STATUS_DETAIL_PREFIX)) {
      parts.push(entry.output)
    }
  }
  if (parts.length > 0) {
    return parts.join('\n')
  }
  return fallbackRaw
}

export function parseInterfaceStatus(
  commands: Array<{ command: string; output: string }>,
  fallbackRaw = '',
  options: { includeDetails?: boolean } = {}
): InterfaceStatusBlock {
  const includeDetails = options.includeDetails === true
  return {
    brief: parseInterfaceBrief(outputFor(commands, INTERFACE_STATUS_BRIEF_COMMAND, fallbackRaw)),
    optics: parseOptics(outputFor(commands, INTERFACE_STATUS_OPTICS_COMMAND, fallbackRaw)),
    details: includeDetails ? parseInterfaceDetail(detailOutputs(commands, fallbackRaw)) : null
  }
}

export type ParseFailureView = {
  reason: string
  raw: string
}

export type InterfaceStatusCard = {
  parseFailed: boolean
  parseFailedNotice: string | null
  brief: InterfaceBriefRow[] | null
  optics: OpticsRow[] | null
  details: InterfaceDetail[] | null
  detailsRequested: boolean
  emptyBriefNotice: string | null
  emptyOpticsNotice: string | null
  raw: string
  viewRawLabel: string
  briefFailure: ParseFailureView | null
  opticsFailure: ParseFailureView | null
  detailsFailure: ParseFailureView | null
}

function failureView<T>(result: ParsedResult<T> | null): ParseFailureView | null {
  if (result === null || result.status !== 'parse-failed') {
    return null
  }
  return { reason: result.reason, raw: result.raw }
}

export function interfaceStatusCard(block: InterfaceStatusBlock, raw: string): InterfaceStatusCard {
  const briefFailure = failureView(block.brief)
  const opticsFailure = failureView(block.optics)
  const detailsFailure = failureView(block.details)
  const parseFailed = briefFailure !== null || opticsFailure !== null || detailsFailure !== null
  const brief = block.brief.status === 'parsed' ? block.brief.data.rows : null
  const optics = block.optics.status === 'parsed' ? block.optics.data.rows : null
  const detailsRequested = block.details !== null
  const details = block.details?.status === 'parsed' ? block.details.data.rows : null
  return {
    parseFailed,
    parseFailedNotice: parseFailed ? PARSE_FAILED_NOTICE : null,
    brief,
    optics,
    details,
    detailsRequested,
    emptyBriefNotice: brief !== null && brief.length === 0 ? 'No interface rows.' : null,
    emptyOpticsNotice: optics !== null && optics.length === 0 ? 'No optics rows.' : null,
    raw,
    viewRawLabel: VIEW_RAW_LABEL,
    briefFailure,
    opticsFailure,
    detailsFailure
  }
}

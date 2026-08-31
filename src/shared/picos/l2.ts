import type { ParsedResult } from './parsed-result'
import { PARSE_FAILED_NOTICE, VIEW_RAW_LABEL } from './device-facts'
import { normalizeShowCommand } from './show-command'

export const L2_VLAN_COMMAND = 'show vlans'
export const L2_FDB_COMMAND = 'show mac-address table'
export const L2_SWITCHING_COMMAND = 'show ethernet-switching interfaces'

export const L2_COMMANDS = [L2_VLAN_COMMAND, L2_FDB_COMMAND, L2_SWITCHING_COMMAND] as const

export function l2CliCommand(): string {
  const inner = L2_COMMANDS.map((command) => `${command} | no-more`).join('; ')
  return `cli -c '${inner}'`
}

export type TableFacts<Row> = {
  rows: Row[]
  unparsedLines: number
}

export type VlanRow = {
  id: string
  name?: string
  untagged: string[]
  tagged: string[]
}

export type FdbRow = {
  vlan?: string
  mac?: string
  type?: string
  age?: string
  interfaces?: string
}

export type FdbFacts = TableFacts<FdbRow> & {
  totalEntries?: string
  staticEntries?: string
  dynamicEntries?: string
}

export type SwitchingRow = {
  name: string
  state?: string
  tagging?: string
  nativeVlan?: string
  vlanMembers: string[]
}

export type L2Block = {
  vlans: ParsedResult<TableFacts<VlanRow>>
  fdb: ParsedResult<FdbFacts>
  switching: ParsedResult<TableFacts<SwitchingRow>>
}

export type L2ChannelFailure = {
  kind: 'channel-failed'
  reason: 'nonzero-exit' | 'timeout' | 'rejected'
  exitCode?: number
  stderrHead: string
}

export type L2Run =
  { kind: 'no-session' } | L2ChannelFailure | { kind: 'ok'; block: L2Block; raw: string }

const INTERFACE_NAME = /^[A-Za-z][A-Za-z0-9/._:-]{0,47}(?:\([0-9]{1,6}\))?$/
const VLAN_ID = /^\d+$/
const MAC_ADDRESS = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i
const FDB_TOTAL = /^Total entries in switching table:\s*(\S+)\s*$/i
const FDB_STATIC = /^Static entries in switching table:\s*(\S+)\s*$/i
const FDB_DYNAMIC = /^Dynamic entries in switching table:\s*(\S+)\s*$/i

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

function looksLikeVlanHeader(line: string): boolean {
  const lower = line.toLowerCase()
  return lower.includes('vlanid') && (lower.includes('tag') || lower.includes('interface'))
}

function looksLikeFdbHeader(line: string): boolean {
  const lower = line.toLowerCase()
  return lower.includes('vlan') && lower.includes('mac')
}

function looksLikeSwitchingHeader(line: string): boolean {
  const lower = line.toLowerCase()
  if (!lower.includes('interface')) {
    return false
  }
  return (
    lower.includes('tagging') || lower.includes('native vlan') || lower.includes('vlan members')
  )
}

function readTaggedTable(
  raw: string,
  looksLikeHeader: (line: string) => boolean,
  extraSkip?: (line: string) => boolean
): {
  table: CliTable | undefined
  rows: string[][]
  unparsedLines: number
  preamble: string[]
} {
  const rows: string[][] = []
  const preamble: string[] = []
  let unparsedLines = 0
  let pendingHeader: string | undefined
  let table: CliTable | undefined
  for (const line of splitLines(raw)) {
    if (line.trim().length === 0) {
      continue
    }
    if (extraSkip?.(line) === true && table === undefined && pendingHeader === undefined) {
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
      if (extraSkip?.(line) === true) {
        preamble.push(line)
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
  }
  return { table, rows, unparsedLines, preamble }
}

function parseInterfaceList(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) {
    return []
  }
  return value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
}

function parseVlanMembers(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) {
    return []
  }
  return value.split(/\s+/).filter((token) => token.length > 0)
}

function isTag(value: string): value is 'untagged' | 'tagged' {
  const lower = value.toLowerCase()
  return lower === 'untagged' || lower === 'tagged'
}

export function parseVlans(raw: string): ParsedResult<TableFacts<VlanRow>> {
  const { table, rows, unparsedLines: skipped } = readTaggedTable(raw, looksLikeVlanHeader)
  if (table === undefined) {
    return parseFailed(raw, 'missing vlan skeleton')
  }
  const headers = table.headers
  if (headerIndex(headers, 'vlanid', 'vlan id') === -1) {
    return parseFailed(raw, 'missing vlan skeleton')
  }
  const idIdx = headerIndex(headers, 'vlanid', 'vlan id')
  const nameIdx = headerIndex(headers, 'vlan name')
  const tagIdx = headerIndex(headers, 'tag')
  const ifIdx = headerIndex(headers, 'interfaces')
  const parsedRows: VlanRow[] = []
  let unparsedLines = skipped
  let current: VlanRow | undefined
  let currentTag: 'untagged' | 'tagged' | undefined
  for (const cells of rows) {
    const id = optionalCell(cells[idIdx])
    const tag = optionalCell(cells[tagIdx])
    const interfaces = parseInterfaceList(optionalCell(cells[ifIdx]))
    if (id !== undefined && VLAN_ID.test(id)) {
      const row: VlanRow = { id, untagged: [], tagged: [] }
      assignOptional(row, 'name', optionalCell(cells[nameIdx]))
      current = row
      currentTag = undefined
      parsedRows.push(row)
      if (tag !== undefined && isTag(tag)) {
        currentTag = tag
        row[tag].push(...interfaces)
      } else if (tag !== undefined) {
        unparsedLines += 1
      }
      continue
    }
    if (current === undefined) {
      unparsedLines += 1
      continue
    }
    if (tag !== undefined && isTag(tag)) {
      currentTag = tag
      current[tag].push(...interfaces)
      continue
    }
    if (currentTag !== undefined && interfaces.length > 0 && id === undefined) {
      current[currentTag].push(...interfaces)
      continue
    }
    unparsedLines += 1
  }
  return parsed({ rows: parsedRows, unparsedLines }, raw)
}

function applyFdbCount(facts: FdbFacts, line: string): boolean {
  const total = FDB_TOTAL.exec(line)
  if (total !== null) {
    assignOptional(facts, 'totalEntries', optionalCell(total[1]))
    return true
  }
  const staticEntries = FDB_STATIC.exec(line)
  if (staticEntries !== null) {
    assignOptional(facts, 'staticEntries', optionalCell(staticEntries[1]))
    return true
  }
  const dynamic = FDB_DYNAMIC.exec(line)
  if (dynamic !== null) {
    assignOptional(facts, 'dynamicEntries', optionalCell(dynamic[1]))
    return true
  }
  return false
}

function isFdbCountLine(line: string): boolean {
  return FDB_TOTAL.test(line) || FDB_STATIC.test(line) || FDB_DYNAMIC.test(line)
}

export function parseFdb(raw: string): ParsedResult<FdbFacts> {
  const {
    table,
    rows,
    unparsedLines: skipped,
    preamble
  } = readTaggedTable(raw, looksLikeFdbHeader, isFdbCountLine)
  if (table === undefined) {
    return parseFailed(raw, 'missing fdb skeleton')
  }
  const headers = table.headers
  if (headerIndex(headers, 'vlan') === -1 || headerIndex(headers, 'mac address') === -1) {
    return parseFailed(raw, 'missing fdb skeleton')
  }
  const facts: FdbFacts = { rows: [], unparsedLines: skipped }
  for (const line of preamble) {
    applyFdbCount(facts, line)
  }
  const vlanIdx = headerIndex(headers, 'vlan')
  const macIdx = headerIndex(headers, 'mac address')
  const typeIdx = headerIndex(headers, 'type')
  const ageIdx = headerIndex(headers, 'age')
  const ifIdx = headerIndex(headers, 'interfaces')
  for (const cells of rows) {
    const vlan = optionalCell(cells[vlanIdx])
    const mac = optionalCell(cells[macIdx])
    const looksLikeRow =
      (vlan !== undefined && VLAN_ID.test(vlan)) || (mac !== undefined && MAC_ADDRESS.test(mac))
    if (!looksLikeRow) {
      facts.unparsedLines += 1
      continue
    }
    const row: FdbRow = {}
    assignOptional(row, 'vlan', vlan)
    assignOptional(row, 'mac', mac)
    assignOptional(row, 'type', optionalCell(cells[typeIdx]))
    assignOptional(row, 'age', optionalCell(cells[ageIdx]))
    assignOptional(row, 'interfaces', optionalCell(cells[ifIdx]))
    facts.rows.push(row)
  }
  return parsed(facts, raw)
}

export function parseEthernetSwitching(raw: string): ParsedResult<TableFacts<SwitchingRow>> {
  const { table, rows, unparsedLines: skipped } = readTaggedTable(raw, looksLikeSwitchingHeader)
  if (table === undefined) {
    return parseFailed(raw, 'missing ethernet-switching skeleton')
  }
  const headers = table.headers
  if (headerIndex(headers, 'interface') === -1) {
    return parseFailed(raw, 'missing ethernet-switching skeleton')
  }
  const nameIdx = headerIndex(headers, 'interface')
  const stateIdx = headerIndex(headers, 'state')
  const taggingIdx = headerIndex(headers, 'tagging')
  const nativeIdx = headerIndex(headers, 'native vlan')
  const membersIdx = headerIndex(headers, 'vlan members')
  const parsedRows: SwitchingRow[] = []
  let unparsedLines = skipped
  for (const cells of rows) {
    const name = optionalCell(cells[nameIdx])
    if (name === undefined || !INTERFACE_NAME.test(name)) {
      unparsedLines += 1
      continue
    }
    const row: SwitchingRow = {
      name,
      vlanMembers: parseVlanMembers(optionalCell(cells[membersIdx]))
    }
    assignOptional(row, 'state', optionalCell(cells[stateIdx]))
    assignOptional(row, 'tagging', optionalCell(cells[taggingIdx]))
    assignOptional(row, 'nativeVlan', optionalCell(cells[nativeIdx]))
    parsedRows.push(row)
  }
  return parsed({ rows: parsedRows, unparsedLines }, raw)
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

export function parseL2(
  commands: Array<{ command: string; output: string }>,
  fallbackRaw = ''
): L2Block {
  return {
    vlans: parseVlans(outputFor(commands, L2_VLAN_COMMAND, fallbackRaw)),
    fdb: parseFdb(outputFor(commands, L2_FDB_COMMAND, fallbackRaw)),
    switching: parseEthernetSwitching(outputFor(commands, L2_SWITCHING_COMMAND, fallbackRaw))
  }
}

export type ParseFailureView = {
  reason: string
  raw: string
}

export type L2Card = {
  parseFailed: boolean
  parseFailedNotice: string | null
  vlans: VlanRow[] | null
  fdb: FdbRow[] | null
  switching: SwitchingRow[] | null
  fdbTotalEntries?: string
  fdbStaticEntries?: string
  fdbDynamicEntries?: string
  emptyVlansNotice: string | null
  emptyFdbNotice: string | null
  emptySwitchingNotice: string | null
  raw: string
  viewRawLabel: string
  vlansFailure: ParseFailureView | null
  fdbFailure: ParseFailureView | null
  switchingFailure: ParseFailureView | null
}

function failureView<T>(result: ParsedResult<T>): ParseFailureView | null {
  if (result.status !== 'parse-failed') {
    return null
  }
  return { reason: result.reason, raw: result.raw }
}

export function l2Card(block: L2Block, raw: string): L2Card {
  const vlansFailure = failureView(block.vlans)
  const fdbFailure = failureView(block.fdb)
  const switchingFailure = failureView(block.switching)
  const parseFailed = vlansFailure !== null || fdbFailure !== null || switchingFailure !== null
  const vlans = block.vlans.status === 'parsed' ? block.vlans.data.rows : null
  const fdb = block.fdb.status === 'parsed' ? block.fdb.data.rows : null
  const switching = block.switching.status === 'parsed' ? block.switching.data.rows : null
  const card: L2Card = {
    parseFailed,
    parseFailedNotice: parseFailed ? PARSE_FAILED_NOTICE : null,
    vlans,
    fdb,
    switching,
    emptyVlansNotice: vlans !== null && vlans.length === 0 ? 'No VLAN rows.' : null,
    emptyFdbNotice: fdb !== null && fdb.length === 0 ? 'No FDB rows.' : null,
    emptySwitchingNotice:
      switching !== null && switching.length === 0 ? 'No switching rows.' : null,
    raw,
    viewRawLabel: VIEW_RAW_LABEL,
    vlansFailure,
    fdbFailure,
    switchingFailure
  }
  if (block.fdb.status === 'parsed') {
    assignOptional(card, 'fdbTotalEntries', block.fdb.data.totalEntries)
    assignOptional(card, 'fdbStaticEntries', block.fdb.data.staticEntries)
    assignOptional(card, 'fdbDynamicEntries', block.fdb.data.dynamicEntries)
  }
  return card
}

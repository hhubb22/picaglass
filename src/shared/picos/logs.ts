import type { ParsedResult } from './parsed-result'
import { PARSE_FAILED_NOTICE, VIEW_RAW_LABEL } from './device-facts'
import { normalizeShowCommand } from './show-command'

export const DEFAULT_LOG_LINES = 50
export const MIN_LOG_LINES = 1
export const MAX_LOG_LINES = 10000
export const LOGS_CORE_COMMAND = 'file list /pica/core'

export function logsSyslogCommand(lines: number): string {
  return `show log last ${String(lines)}`
}

export type ParseLogLines = { ok: true; lines: number } | { ok: false; reason: string }

export function parseLogLines(value: number | undefined = DEFAULT_LOG_LINES): ParseLogLines {
  if (value === undefined) {
    return { ok: true, lines: DEFAULT_LOG_LINES }
  }
  if (!Number.isInteger(value) || value < MIN_LOG_LINES || value > MAX_LOG_LINES) {
    return { ok: false, reason: `invalid log line count: ${JSON.stringify(value)}` }
  }
  return { ok: true, lines: value }
}

export type LogsCliCommand =
  { ok: true; lines: number; command: string } | { ok: false; reason: string }

export function logsCliCommand(lines: number | undefined = DEFAULT_LOG_LINES): LogsCliCommand {
  const parsed = parseLogLines(lines)
  if (!parsed.ok) {
    return parsed
  }
  const syslog = `${logsSyslogCommand(parsed.lines)} | no-more`
  const core = `${LOGS_CORE_COMMAND} | no-more`
  return { ok: true, lines: parsed.lines, command: `cli -c '${syslog}; ${core}'` }
}

export type TableFacts<Row> = {
  rows: Row[]
  unparsedLines: number
}

export type SyslogRow = {
  timestamp: string
  host: string
  program?: string
  facility: string
  severity: string
  message: string
}

export type CoreDumpRow = {
  name: string
  path?: string
  size?: string
  date?: string
  mode?: string
}

export type CoreFacts = {
  path?: string
  target?: string
  symlink: boolean
  cores: CoreDumpRow[]
  unparsedLines: number
}

export type LogsBlock = {
  syslog: ParsedResult<TableFacts<SyslogRow>>
  core: ParsedResult<CoreFacts>
}

export type LogsChannelFailure = {
  kind: 'channel-failed'
  reason: 'nonzero-exit' | 'timeout' | 'rejected'
  exitCode?: number
  stderrHead: string
}

export type LogsRun =
  | { kind: 'no-session' }
  | { kind: 'invalid-lines'; reason: string }
  | LogsChannelFailure
  | { kind: 'ok'; block: LogsBlock; raw: string }

const SYSLOG_LINE =
  /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{4}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(?:(\S+)\s+)?([A-Za-z][A-Za-z0-9]*)\.([A-Za-z]+)\s+:\s(.*)$/
const SYSLOG_COMMAND = /^show log last \d+$/
const LISTING_LINE =
  /^([ldcbsp-][rwxsStT-]{9})\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/
const TOTAL_LINE = /^\s*total\s+\d+\s*$/i
const CORE_DIRECTORY = /(?:^|\/)core$/

function splitLines(raw: string): string[] {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function parsed<T>(data: T, raw: string): ParsedResult<T> {
  return { status: 'parsed', data, raw }
}

function parseFailed<T>(raw: string, reason: string): ParsedResult<T> {
  return { status: 'parse-failed', raw, reason }
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

function isBlank(line: string): boolean {
  return line.trim().length === 0
}

export function parseSyslog(raw: string): ParsedResult<TableFacts<SyslogRow>> {
  const rows: SyslogRow[] = []
  let unparsedLines = 0
  let sawContent = false
  for (const line of splitLines(raw)) {
    if (isBlank(line)) {
      continue
    }
    sawContent = true
    const match = SYSLOG_LINE.exec(line)
    if (
      match === null ||
      match[1] === undefined ||
      match[2] === undefined ||
      match[4] === undefined ||
      match[5] === undefined ||
      match[6] === undefined
    ) {
      unparsedLines += 1
      continue
    }
    const row: SyslogRow = {
      timestamp: match[1],
      host: match[2],
      facility: match[4],
      severity: match[5],
      message: match[6]
    }
    assignOptional(row, 'program', optionalCell(match[3]))
    rows.push(row)
  }
  if (sawContent && rows.length === 0) {
    return parseFailed(raw, 'missing syslog skeleton')
  }
  return parsed({ rows, unparsedLines }, raw)
}

type Listing = {
  mode: string
  size: string
  date: string
  path: string
  target?: string
}

function parseListingLine(line: string): Listing | undefined {
  const match = LISTING_LINE.exec(line)
  if (
    match === null ||
    match[1] === undefined ||
    match[5] === undefined ||
    match[6] === undefined ||
    match[7] === undefined ||
    match[8] === undefined ||
    match[9] === undefined
  ) {
    return undefined
  }
  const rest = match[9].trim()
  const arrow = rest.split(/\s+->\s+/)
  const path = optionalCell(arrow[0])
  if (path === undefined) {
    return undefined
  }
  const listing: Listing = {
    mode: match[1],
    size: match[5],
    date: `${match[6]} ${match[7]} ${match[8]}`,
    path
  }
  assignOptional(listing, 'target', optionalCell(arrow[1]))
  return listing
}

function baseName(path: string): string {
  const parts = path.split('/').filter((part) => part.length > 0)
  return parts[parts.length - 1] ?? path
}

function isCoreDirectory(path: string): boolean {
  return CORE_DIRECTORY.test(path)
}

export function parseCoreListing(raw: string): ParsedResult<CoreFacts> {
  const facts: CoreFacts = { symlink: false, cores: [], unparsedLines: 0 }
  let sawListing = false
  for (const line of splitLines(raw)) {
    if (isBlank(line) || TOTAL_LINE.test(line)) {
      continue
    }
    const listing = parseListingLine(line)
    if (listing === undefined) {
      facts.unparsedLines += 1
      continue
    }
    sawListing = true
    if (isCoreDirectory(listing.path)) {
      assignOptional(facts, 'path', listing.path)
      assignOptional(facts, 'target', listing.target)
      facts.symlink = listing.mode.startsWith('l') || listing.target !== undefined
      continue
    }
    const row: CoreDumpRow = { name: baseName(listing.path) }
    assignOptional(row, 'path', listing.path)
    assignOptional(row, 'size', listing.size)
    assignOptional(row, 'date', listing.date)
    assignOptional(row, 'mode', listing.mode)
    facts.cores.push(row)
  }
  if (!sawListing) {
    return parseFailed(raw, 'missing core listing skeleton')
  }
  return parsed(facts, raw)
}

function isSyslogCommand(command: string): boolean {
  return SYSLOG_COMMAND.test(normalizeShowCommand(command))
}

function isCoreCommand(command: string): boolean {
  return normalizeShowCommand(command) === LOGS_CORE_COMMAND
}

function outputFor(
  commands: Array<{ command: string; output: string }>,
  match: (command: string) => boolean,
  fallbackRaw: string
): string {
  for (const entry of commands) {
    if (match(entry.command)) {
      return entry.output
    }
  }
  return fallbackRaw
}

export function parseLogs(
  commands: Array<{ command: string; output: string }>,
  fallbackRaw = ''
): LogsBlock {
  return {
    syslog: parseSyslog(outputFor(commands, isSyslogCommand, fallbackRaw)),
    core: parseCoreListing(outputFor(commands, isCoreCommand, fallbackRaw))
  }
}

export type ParseFailureView = {
  reason: string
  raw: string
}

export type LogsCard = {
  parseFailed: boolean
  parseFailedNotice: string | null
  syslog: SyslogRow[] | null
  cores: CoreDumpRow[] | null
  corePath?: string
  coreTarget?: string
  coreSymlink: boolean | null
  emptySyslogNotice: string | null
  emptyCoresNotice: string | null
  raw: string
  viewRawLabel: string
  syslogFailure: ParseFailureView | null
  coreFailure: ParseFailureView | null
}

function failureView<T>(result: ParsedResult<T>): ParseFailureView | null {
  if (result.status !== 'parse-failed') {
    return null
  }
  return { reason: result.reason, raw: result.raw }
}

export function logsCard(block: LogsBlock, raw: string): LogsCard {
  const syslogFailure = failureView(block.syslog)
  const coreFailure = failureView(block.core)
  const parseFailed = syslogFailure !== null || coreFailure !== null
  const syslog = block.syslog.status === 'parsed' ? block.syslog.data.rows : null
  const cores = block.core.status === 'parsed' ? block.core.data.cores : null
  const card: LogsCard = {
    parseFailed,
    parseFailedNotice: parseFailed ? PARSE_FAILED_NOTICE : null,
    syslog,
    cores,
    coreSymlink: block.core.status === 'parsed' ? block.core.data.symlink : null,
    emptySyslogNotice: syslog !== null && syslog.length === 0 ? 'No syslog lines.' : null,
    emptyCoresNotice: cores !== null && cores.length === 0 ? 'No core dumps.' : null,
    raw,
    viewRawLabel: VIEW_RAW_LABEL,
    syslogFailure,
    coreFailure
  }
  if (block.core.status === 'parsed') {
    assignOptional(card, 'corePath', block.core.data.path)
    assignOptional(card, 'coreTarget', block.core.data.target)
  }
  return card
}

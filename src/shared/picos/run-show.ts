import type { ParsedResult } from './parsed-result'
import { normalizeShowCommand } from './show-command'
import { parseFans, parsePowerSupplies, parseTemperatures, parseVersion } from './device-facts'
import {
  INTERFACE_STATUS_BRIEF_COMMAND,
  INTERFACE_STATUS_DETAIL_PREFIX,
  INTERFACE_STATUS_OPTICS_COMMAND,
  parseInterfaceBrief,
  parseInterfaceDetail,
  parseOptics
} from './interface-status'
import {
  L2_FDB_COMMAND,
  L2_SWITCHING_COMMAND,
  L2_VLAN_COMMAND,
  parseEthernetSwitching,
  parseFdb,
  parseVlans
} from './l2'
import {
  L3_ARP_COMMAND,
  L3_HARDWARE_HOST_COMMAND,
  L3_HARDWARE_ROUTE_COMMAND,
  L3_NEIGHBOR_COMMAND,
  L3_SOFTWARE_ROUTE_COMMAND,
  parseArp,
  parseHardwareHosts,
  parseHardwareRoutes,
  parseNeighbors,
  parseSoftwareRoutes
} from './l3'
import { parseSyslog } from './logs'

export const DEFAULT_PING_COUNT = 5
export const MAX_PING_COUNT = 20

export const RUN_SHOW_PIPE_FILTERS = ['count', 'except', 'find', 'match', 'no-more'] as const

const PIPE_FILTERS = new Set<string>(RUN_SHOW_PIPE_FILTERS)
const BARE_FILTERS = new Set(['count', 'no-more'])
const PATTERN_FILTERS = new Set(['except', 'find', 'match'])
const UNQUOTED_TOKEN = /^[A-Za-z0-9/._:()+*-]+$/
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})$/
const HOSTNAME =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/
const SYSLOG_COMMAND = /^show log last \d+$/

const ONLY_SHOW_OR_PING = 'run_show only allows show and ping commands.'
const NO_CHAINING = 'run_show does not allow command chaining.'
const PING_SHAPE = 'run_show ping takes a single target and optional count.'

export type AuthorizeRunShow =
  | { ok: true; verb: 'show' | 'ping'; inner: string; cliCommand: string }
  | { ok: false; reason: string }

export type RunShowOutput = ParsedResult<unknown> | { status: 'raw'; raw: string }

export type RunShowChannelFailure = {
  kind: 'channel-failed'
  reason: 'nonzero-exit' | 'timeout' | 'rejected'
  exitCode?: number
  stderrHead: string
}

export type RunShowRun =
  | { kind: 'no-session' }
  | { kind: 'rejected'; reason: string }
  | RunShowChannelFailure
  | { kind: 'ok'; command: string; result: RunShowOutput; raw: string }

type Token = { value: string; quoted: boolean }

const EXACT_PARSERS: Array<{ command: string; parse: (raw: string) => ParsedResult<unknown> }> = [
  { command: 'show version', parse: parseVersion },
  { command: 'show system fan', parse: parseFans },
  { command: 'show system temperature', parse: parseTemperatures },
  { command: 'show system rpsu', parse: parsePowerSupplies },
  { command: INTERFACE_STATUS_BRIEF_COMMAND, parse: parseInterfaceBrief },
  { command: INTERFACE_STATUS_OPTICS_COMMAND, parse: parseOptics },
  { command: L2_VLAN_COMMAND, parse: parseVlans },
  { command: L2_FDB_COMMAND, parse: parseFdb },
  { command: L2_SWITCHING_COMMAND, parse: parseEthernetSwitching },
  { command: L3_SOFTWARE_ROUTE_COMMAND, parse: parseSoftwareRoutes },
  { command: L3_HARDWARE_ROUTE_COMMAND, parse: parseHardwareRoutes },
  { command: L3_HARDWARE_HOST_COMMAND, parse: parseHardwareHosts },
  { command: L3_ARP_COMMAND, parse: parseArp },
  { command: L3_NEIGHBOR_COMMAND, parse: parseNeighbors }
]

function reject(reason: string): { ok: false; reason: string } {
  return { ok: false, reason }
}

function isSafeUnquoted(value: string): boolean {
  return UNQUOTED_TOKEN.test(value) && /[A-Za-z0-9]/.test(value)
}

function tokenize(
  input: string
): { ok: true; segments: Token[][] } | { ok: false; reason: string } {
  const segments: Token[][] = []
  let tokens: Token[] = []
  let current = ''
  let quoted = false
  let quote: '"' | "'" | null = null

  const pushToken = (): { ok: false; reason: string } | undefined => {
    if (current.length === 0) {
      return undefined
    }
    if (!quoted && !isSafeUnquoted(current)) {
      return reject(ONLY_SHOW_OR_PING)
    }
    tokens.push({ value: current, quoted })
    current = ''
    quoted = false
    return undefined
  }

  const pushSegment = (): { ok: false; reason: string } | undefined => {
    const tokenError = pushToken()
    if (tokenError !== undefined) {
      return tokenError
    }
    if (tokens.length === 0) {
      return reject(NO_CHAINING)
    }
    segments.push(tokens)
    tokens = []
    return undefined
  }

  for (const ch of input) {
    const code = ch.charCodeAt(0)
    if (quote !== null) {
      if (ch === quote) {
        quote = null
        continue
      }
      if (code < 32) {
        return reject(NO_CHAINING)
      }
      current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      if (current.length > 0) {
        return reject(ONLY_SHOW_OR_PING)
      }
      quote = ch
      quoted = true
      continue
    }
    if (ch === '|') {
      const error = pushSegment()
      if (error !== undefined) {
        return error
      }
      continue
    }
    if (ch === ';' || ch === '&' || ch === '`' || ch === '$' || ch === '>' || ch === '<') {
      return reject(NO_CHAINING)
    }
    if (code < 32) {
      return reject(NO_CHAINING)
    }
    if (ch === ' ' || ch === '\t') {
      const error = pushToken()
      if (error !== undefined) {
        return error
      }
      continue
    }
    current += ch
  }

  if (quote !== null) {
    return reject('run_show command has an unmatched quote.')
  }
  const last = pushSegment()
  if (last !== undefined) {
    return last
  }
  return { ok: true, segments }
}

function formatToken(token: Token): string {
  if (!token.quoted && isSafeUnquoted(token.value)) {
    return token.value
  }
  if (!token.value.includes('"')) {
    return `"${token.value}"`
  }
  if (!token.value.includes("'")) {
    return `'${token.value}'`
  }
  return `"${token.value}"`
}

function wrapCli(inner: string): string {
  return `cli -c '${inner.replace(/'/g, `'\\''`)}'`
}

function isIpv6(value: string): boolean {
  if (value.includes('.')) {
    return false
  }
  if (!value.includes(':') || !/^[0-9a-fA-F:]+$/.test(value)) {
    return false
  }
  const halves = value.split('::')
  if (halves.length > 2) {
    return false
  }
  const validGroup = (group: string): boolean => group.length >= 1 && group.length <= 4
  if (halves.length === 1) {
    const parts = value.split(':')
    return parts.length === 8 && parts.every(validGroup)
  }
  const left = halves[0] === '' ? [] : (halves[0] ?? '').split(':')
  const right = halves[1] === '' ? [] : (halves[1] ?? '').split(':')
  if (left.some((group) => !validGroup(group)) || right.some((group) => !validGroup(group))) {
    return false
  }
  return left.length + right.length < 8
}

function isPingTarget(value: string): boolean {
  if (IPV4.test(value) || isIpv6(value)) {
    return true
  }
  return HOSTNAME.test(value) && /[A-Za-z]/.test(value)
}

function parsePingArgs(
  tokens: Token[]
): { ok: true; target: string; count: number } | { ok: false; reason: string } {
  const values = tokens.map((token) => token.value)
  let count: number | undefined
  const rest: string[] = []
  for (let i = 0; i < values.length; i += 1) {
    const token = values[i]
    if (token === undefined) {
      continue
    }
    if (token.toLowerCase() === 'count') {
      if (count !== undefined) {
        return reject(PING_SHAPE)
      }
      const raw = values[i + 1]
      i += 1
      if (raw === undefined) {
        return reject('invalid ping count: ""')
      }
      if (!/^\d+$/.test(raw)) {
        return reject(`invalid ping count: ${raw}`)
      }
      const parsed = Number(raw)
      if (parsed < 1 || parsed > MAX_PING_COUNT) {
        return reject(`invalid ping count: ${parsed}`)
      }
      count = parsed
      continue
    }
    rest.push(token)
  }
  if (rest.length !== 1) {
    if (rest.length === 0) {
      return reject('invalid ping target: ""')
    }
    return reject(PING_SHAPE)
  }
  const target = rest[0]
  if (target === undefined || !isPingTarget(target)) {
    return reject(`invalid ping target: ${JSON.stringify(target ?? '')}`)
  }
  return { ok: true, target, count: count ?? DEFAULT_PING_COUNT }
}

function authorizeFilters(segments: Token[][]): { ok: true } | { ok: false; reason: string } {
  for (const segment of segments) {
    const nameToken = segment[0]
    if (nameToken === undefined) {
      return reject(NO_CHAINING)
    }
    const name = nameToken.value.toLowerCase()
    if (!PIPE_FILTERS.has(name)) {
      return reject(`run_show does not allow the "${name}" pipe filter.`)
    }
    if (BARE_FILTERS.has(name) && segment.length !== 1) {
      return reject(`run_show pipe filter "${name}" does not take arguments.`)
    }
    if (PATTERN_FILTERS.has(name) && segment.length !== 2) {
      return reject(`run_show pipe filter "${name}" requires a single pattern.`)
    }
  }
  return { ok: true }
}

function reconstruct(verb: 'show' | 'ping', args: string[], filters: Token[][]): string {
  const head = [verb, ...args].join(' ')
  const tail = filters.map((segment) => {
    const name = (segment[0]?.value ?? '').toLowerCase()
    const rest = segment.slice(1).map(formatToken)
    return [name, ...rest].join(' ')
  })
  if (tail.length === 0) {
    return head
  }
  return `${head} | ${tail.join(' | ')}`
}

export function authorizeRunShow(command: string): AuthorizeRunShow {
  const trimmed = command.trim()
  if (trimmed.length === 0) {
    return reject(ONLY_SHOW_OR_PING)
  }
  const tokenized = tokenize(trimmed)
  if (!tokenized.ok) {
    return tokenized
  }
  const commandSegment = tokenized.segments[0]
  if (commandSegment === undefined || commandSegment[0] === undefined) {
    return reject(ONLY_SHOW_OR_PING)
  }
  const verb = commandSegment[0].value.toLowerCase()
  if (verb !== 'show' && verb !== 'ping') {
    return reject(ONLY_SHOW_OR_PING)
  }
  const filters = tokenized.segments.slice(1)
  const filtered = authorizeFilters(filters)
  if (!filtered.ok) {
    return filtered
  }
  const last = filters[filters.length - 1]
  if (last === undefined || last[0]?.value.toLowerCase() !== 'no-more') {
    filters.push([{ value: 'no-more', quoted: false }])
  }

  if (verb === 'show') {
    const args = commandSegment.slice(1)
    if (args.length === 0) {
      return reject(ONLY_SHOW_OR_PING)
    }
    const inner = reconstruct(
      'show',
      args.map((token) => (token.quoted ? formatToken(token) : token.value.toLowerCase())),
      filters
    )
    return { ok: true, verb: 'show', inner, cliCommand: wrapCli(inner) }
  }

  const ping = parsePingArgs(commandSegment.slice(1))
  if (!ping.ok) {
    return ping
  }
  const inner = reconstruct('ping', [ping.target, 'count', String(ping.count)], filters)
  return { ok: true, verb: 'ping', inner, cliCommand: wrapCli(inner) }
}

export function parseRunShowOutput(inner: string, raw: string): RunShowOutput {
  const base = normalizeShowCommand(inner)
  if (base.includes('|') || /^\s*ping\b/i.test(base)) {
    return { status: 'raw', raw }
  }
  for (const entry of EXACT_PARSERS) {
    if (base === entry.command) {
      return entry.parse(raw)
    }
  }
  if (base.startsWith(INTERFACE_STATUS_DETAIL_PREFIX)) {
    return parseInterfaceDetail(raw)
  }
  if (SYSLOG_COMMAND.test(base)) {
    return parseSyslog(raw)
  }
  return { status: 'raw', raw }
}

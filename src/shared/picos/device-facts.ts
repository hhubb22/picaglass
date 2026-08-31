import type { ParsedResult } from './parsed-result'

export const DEVICE_FACTS_COMMANDS = [
  'show version',
  'show system fan',
  'show system temperature',
  'show system rpsu'
] as const

export function deviceFactsCliCommand(): string {
  const inner = DEVICE_FACTS_COMMANDS.map((command) => `${command} | no-more`).join('; ')
  return `cli -c '${inner}'`
}

export type VersionFacts = {
  copyright?: string
  model?: string
  softwareVersion?: string
  softwareReleasedDate?: string
  serialNumber?: string
  systemUptime?: string
  hardwareId?: string
  licenseType?: string
  deviceMacAddress?: string
  unparsedLines: number
}

export type FanRow = {
  id: string
  speed?: string
  pwm?: string
  direction?: string
}

export type TemperatureRow = {
  sensor: string
  celsius?: string
  fahrenheit?: string
}

export type PowerSupplyRow = {
  id: string
  status: string
}

export type TableFacts<Row> = {
  rows: Row[]
  unparsedLines: number
}

export type DeviceFactsBlock = {
  version: ParsedResult<VersionFacts>
  fans: ParsedResult<TableFacts<FanRow>>
  temperatures: ParsedResult<TableFacts<TemperatureRow>>
  powerSupplies: ParsedResult<TableFacts<PowerSupplyRow>>
}

export type DeviceFactsChannelFailure = {
  kind: 'channel-failed'
  reason: 'nonzero-exit' | 'timeout' | 'rejected'
  exitCode?: number
  stderrHead: string
}

export type DeviceFactsRun =
  | { kind: 'no-session' }
  | DeviceFactsChannelFailure
  | { kind: 'ok'; block: DeviceFactsBlock; raw: string }

const VERSION_FIELDS: Array<{ name: string; field: keyof Omit<VersionFacts, 'unparsedLines'> }> = [
  { name: 'Software Released Date', field: 'softwareReleasedDate' },
  { name: 'Device MAC Address', field: 'deviceMacAddress' },
  { name: 'Software Version', field: 'softwareVersion' },
  { name: 'Serial Number', field: 'serialNumber' },
  { name: 'System Uptime', field: 'systemUptime' },
  { name: 'License Type', field: 'licenseType' },
  { name: 'Hardware ID', field: 'hardwareId' },
  { name: 'Copyright', field: 'copyright' },
  { name: 'Model', field: 'model' }
]

const FAN_HEADER = /^\s*Fan Status:\s*$/i
const FAN_ROW = /^\s*Fan\s+(\d+)\s*:\s*speed\s*=\s*(.+?),\s*PWM\s*=\s*([^,]+),\s*(.+?)\s*$/i
const TEMP_HEADER = /^\s*Temperature:\s*$/i
const TEMP_ROW = /^\s*(.+?)\s*:\s*([\d.]+)\s*C\s*\/\s*([\d.]+)\s*F\s*$/i
const RPSU_ROW = /^\s*RPSU\s+(\d+)\s*:\s*(.+?)\s*$/i
const NO_MORE = /\s*\|\s*no-more\s*$/i

function commandName(command: string): string {
  return command.trim().replace(NO_MORE, '').trim()
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

function findVersionKeys(line: string): Array<{
  field: keyof Omit<VersionFacts, 'unparsedLines'>
  index: number
  colon: number
}> {
  const hits: Array<{
    field: keyof Omit<VersionFacts, 'unparsedLines'>
    index: number
    colon: number
  }> = []
  for (const entry of VERSION_FIELDS) {
    const index = line.indexOf(entry.name)
    if (index === -1) {
      continue
    }
    const afterName = index + entry.name.length
    const colon = line.indexOf(':', afterName)
    if (colon === -1 || line.slice(afterName, colon).trim() !== '') {
      continue
    }
    hits.push({ field: entry.field, index, colon })
  }
  hits.sort((a, b) => a.index - b.index)
  return hits
}

export function parseVersion(raw: string): ParsedResult<VersionFacts> {
  const facts: VersionFacts = { unparsedLines: 0 }
  let skeleton = false
  for (const line of splitLines(raw)) {
    if (line.trim().length === 0) {
      continue
    }
    const hits = findVersionKeys(line)
    if (hits.length === 0) {
      facts.unparsedLines += 1
      continue
    }
    skeleton = true
    for (let i = 0; i < hits.length; i += 1) {
      const hit = hits[i]
      if (hit === undefined) {
        continue
      }
      const next = hits[i + 1]
      const value = line.slice(hit.colon + 1, next?.index).trim()
      if (value.length > 0) {
        facts[hit.field] = value
      }
    }
  }
  if (!skeleton) {
    return parseFailed(raw, 'missing version skeleton')
  }
  return parsed(facts, raw)
}

export function parseFans(raw: string): ParsedResult<TableFacts<FanRow>> {
  const lines = splitLines(raw)
  let skeleton = false
  const rows: FanRow[] = []
  let unparsedLines = 0
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue
    }
    if (FAN_HEADER.test(line)) {
      skeleton = true
      continue
    }
    const match = FAN_ROW.exec(line)
    if (match !== null) {
      skeleton = true
      const id = match[1]
      if (id === undefined) {
        unparsedLines += 1
        continue
      }
      const row: FanRow = { id }
      const speed = match[2]?.trim()
      const pwm = match[3]?.trim()
      const direction = match[4]?.trim()
      if (speed !== undefined && speed.length > 0) {
        row.speed = speed
      }
      if (pwm !== undefined && pwm.length > 0) {
        row.pwm = pwm
      }
      if (direction !== undefined && direction.length > 0) {
        row.direction = direction
      }
      rows.push(row)
      continue
    }
    unparsedLines += 1
  }
  if (!skeleton) {
    return parseFailed(raw, 'missing fan skeleton')
  }
  return parsed({ rows, unparsedLines }, raw)
}

export function parseTemperatures(raw: string): ParsedResult<TableFacts<TemperatureRow>> {
  let skeleton = false
  const rows: TemperatureRow[] = []
  let unparsedLines = 0
  for (const line of splitLines(raw)) {
    if (line.trim().length === 0) {
      continue
    }
    if (TEMP_HEADER.test(line)) {
      skeleton = true
      continue
    }
    const match = TEMP_ROW.exec(line)
    if (match !== null) {
      skeleton = true
      const sensor = match[1]?.trim()
      if (sensor === undefined || sensor.length === 0) {
        unparsedLines += 1
        continue
      }
      const row: TemperatureRow = { sensor }
      const celsius = match[2]?.trim()
      const fahrenheit = match[3]?.trim()
      if (celsius !== undefined && celsius.length > 0) {
        row.celsius = celsius
      }
      if (fahrenheit !== undefined && fahrenheit.length > 0) {
        row.fahrenheit = fahrenheit
      }
      rows.push(row)
      continue
    }
    unparsedLines += 1
  }
  if (!skeleton) {
    return parseFailed(raw, 'missing temperature skeleton')
  }
  return parsed({ rows, unparsedLines }, raw)
}

export function parsePowerSupplies(raw: string): ParsedResult<TableFacts<PowerSupplyRow>> {
  const rows: PowerSupplyRow[] = []
  let unparsedLines = 0
  for (const line of splitLines(raw)) {
    if (line.trim().length === 0) {
      continue
    }
    const match = RPSU_ROW.exec(line)
    if (match !== null) {
      const id = match[1]
      const status = match[2]?.trim()
      if (id === undefined || status === undefined || status.length === 0) {
        unparsedLines += 1
        continue
      }
      rows.push({ id, status })
      continue
    }
    unparsedLines += 1
  }
  if (rows.length === 0) {
    return parseFailed(raw, 'missing power supply skeleton')
  }
  return parsed({ rows, unparsedLines }, raw)
}

function outputFor(
  commands: Array<{ command: string; output: string }>,
  name: string,
  fallbackRaw: string
): string {
  for (const entry of commands) {
    if (commandName(entry.command) === name) {
      return entry.output
    }
  }
  if (commands.length === 0) {
    return fallbackRaw
  }
  return ''
}

export function parseDeviceFacts(
  commands: Array<{ command: string; output: string }>,
  fallbackRaw = ''
): DeviceFactsBlock {
  return {
    version: parseVersion(outputFor(commands, 'show version', fallbackRaw)),
    fans: parseFans(outputFor(commands, 'show system fan', fallbackRaw)),
    temperatures: parseTemperatures(outputFor(commands, 'show system temperature', fallbackRaw)),
    powerSupplies: parsePowerSupplies(outputFor(commands, 'show system rpsu', fallbackRaw))
  }
}

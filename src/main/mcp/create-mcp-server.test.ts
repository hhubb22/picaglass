import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MCP_ENDPOINT_FILE } from '../../shared/mcp-config'
import type { DeviceFactsRun } from '../../shared/picos/device-facts'
import type { InterfaceStatusRun } from '../../shared/picos/interface-status'
import type { L2Run } from '../../shared/picos/l2'
import type { L3Run } from '../../shared/picos/l3'
import type { LogsRun } from '../../shared/picos/logs'
import type { RunShowRun } from '../../shared/picos/run-show'
import {
  idleTechSupportSnapshot,
  type TechSupportSnapshot,
  type TechSupportStartResult
} from '../../shared/picos/tech-support'
import { createMcpServer, type McpServerHandle } from './create-mcp-server'

type OkDeviceFactsRun = Extract<DeviceFactsRun, { kind: 'ok' }>
type OkInterfaceStatusRun = Extract<InterfaceStatusRun, { kind: 'ok' }>
type OkL2Run = Extract<L2Run, { kind: 'ok' }>
type OkL3Run = Extract<L3Run, { kind: 'ok' }>
type OkLogsRun = Extract<LogsRun, { kind: 'ok' }>

const TOKEN = 'b'.repeat(64)
const STARTED_AT = '2026-08-31T00:00:00.000Z'

const versionData = {
  model: 'S5810-28FS',
  softwareVersion: '9.8.7',
  serialNumber: '<SERIAL>',
  licenseType: 'Uninstalled',
  unparsedLines: 0
}

const fansData = {
  rows: [{ id: '1', speed: '5415 RPM', pwm: '76', direction: 'Forward' }],
  unparsedLines: 0
}

const temperaturesData = {
  rows: [{ sensor: 'CPU', celsius: '33.00', fahrenheit: '91.40' }],
  unparsedLines: 0
}

const powerSuppliesData = {
  rows: [{ id: '1', status: 'Powered on' }],
  unparsedLines: 0
}

const parsedFacts: OkDeviceFactsRun = {
  kind: 'ok',
  raw: 'combined-raw',
  block: {
    version: { status: 'parsed', data: versionData, raw: 'version-raw' },
    fans: { status: 'parsed', data: fansData, raw: 'fan-raw' },
    temperatures: { status: 'parsed', data: temperaturesData, raw: 'temp-raw' },
    powerSupplies: { status: 'parsed', data: powerSuppliesData, raw: 'psu-raw' }
  }
}

const briefData = {
  rows: [
    {
      name: 'ge-1/1/1',
      management: 'Enabled',
      status: 'Down',
      speed: 'Auto'
    }
  ],
  unparsedLines: 0
}

const opticsData = { rows: [] as Array<{ name: string }>, unparsedLines: 0 }

const parsedInterfaces: OkInterfaceStatusRun = {
  kind: 'ok',
  raw: 'if-raw',
  block: {
    brief: { status: 'parsed', data: briefData, raw: 'brief-raw' },
    optics: { status: 'parsed', data: opticsData, raw: 'optics-raw' },
    details: null
  }
}

const vlanData = {
  rows: [{ id: '15', name: 'default', untagged: [] as string[], tagged: ['ae3'] }],
  unparsedLines: 0
}

const fdbData = {
  totalEntries: '0',
  staticEntries: '0',
  dynamicEntries: '0',
  rows: [] as Array<{ vlan?: string }>,
  unparsedLines: 0
}

const switchingData = {
  rows: [
    {
      name: 'ge-1/1/1',
      state: 'down',
      tagging: 'untagged',
      nativeVlan: '1',
      vlanMembers: [] as string[]
    }
  ],
  unparsedLines: 0
}

const parsedL2: OkL2Run = {
  kind: 'ok',
  raw: 'l2-raw',
  block: {
    vlans: { status: 'parsed', data: vlanData, raw: 'vlan-raw' },
    fdb: { status: 'parsed', data: fdbData, raw: 'fdb-raw' },
    switching: { status: 'parsed', data: switchingData, raw: 'sw-raw' }
  }
}

const softwareRouteData = {
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
}

const hardwareRouteData = {
  totalRouteCount: '1',
  rows: [
    {
      destination: '0.0.0.0/0',
      nextHopMac: '02:00:00:00:00:01',
      port: 'connected'
    }
  ],
  unparsedLines: 0
}

const hardwareHostData = {
  totalHostCount: '0',
  rows: [] as Array<{ address: string }>,
  unparsedLines: 0
}

const arpData = {
  agingTime: '1200',
  totalCount: '0',
  rows: [] as Array<{ address?: string }>,
  unparsedLines: 0
}

const parsedL3: OkL3Run = {
  kind: 'ok',
  raw: 'l3-raw',
  block: {
    softwareRoutes: { status: 'parsed', data: softwareRouteData, raw: 'soft-raw' },
    hardwareRoutes: { status: 'parsed', data: hardwareRouteData, raw: 'hard-raw' },
    hardwareHosts: { status: 'parsed', data: hardwareHostData, raw: 'host-raw' },
    arp: { status: 'parsed', data: arpData, raw: 'arp-raw' },
    neighbors: { status: 'parsed', data: arpData, raw: 'neigh-raw' }
  }
}

const syslogData = {
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
}

const coreData = {
  path: '/pica/core',
  target: '/mnt/open/picos/support',
  symlink: true,
  cores: [] as Array<{ name: string }>,
  unparsedLines: 0
}

const parsedLogs: OkLogsRun = {
  kind: 'ok',
  raw: 'logs-raw',
  block: {
    syslog: { status: 'parsed', data: syslogData, raw: 'syslog-raw' },
    core: { status: 'parsed', data: coreData, raw: 'core-raw' }
  }
}

type HttpResponse = {
  status: number
  headers: IncomingHttpHeaders
  text: string
}

function post(options: {
  port: number
  token?: string
  origin?: string
  host?: string
  sessionId?: string
  path?: string
  method?: string
  body?: unknown
}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      Host: options.host ?? `127.0.0.1:${options.port}`
    }
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = String(Buffer.byteLength(payload))
    }
    if (options.token !== undefined) {
      headers.Authorization = `Bearer ${options.token}`
    }
    if (options.origin !== undefined) {
      headers.Origin = options.origin
    }
    if (options.sessionId !== undefined) {
      headers['mcp-session-id'] = options.sessionId
    }
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: options.port,
        path: options.path ?? '/mcp',
        method: options.method ?? 'POST',
        headers
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => {
          chunks.push(chunk as Buffer)
        })
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8')
          })
        })
      }
    )
    req.on('error', reject)
    if (payload !== undefined) {
      req.write(payload)
    }
    req.end()
  })
}

function rpcBody(
  id: number | undefined,
  method: string,
  params?: unknown
): Record<string, unknown> {
  const body: Record<string, unknown> = { jsonrpc: '2.0', method }
  if (id !== undefined) {
    body.id = id
  }
  if (params !== undefined) {
    body.params = params
  }
  return body
}

async function openSession(handle: McpServerHandle): Promise<string> {
  const init = await post({
    port: handle.port,
    token: handle.token,
    body: rpcBody(1, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'picaglass-test', version: '1.0.0' }
    })
  })
  const sessionId = init.headers['mcp-session-id']
  if (init.status !== 200 || typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error(`initialize failed: ${init.status} ${init.text}`)
  }
  await post({
    port: handle.port,
    token: handle.token,
    sessionId,
    body: rpcBody(undefined, 'notifications/initialized')
  })
  return sessionId
}

async function callTool(
  handle: McpServerHandle,
  sessionId: string,
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ isError: boolean; text: string; json: unknown }> {
  const res = await post({
    port: handle.port,
    token: handle.token,
    sessionId,
    body: rpcBody(2, 'tools/call', { name, arguments: args })
  })
  if (res.status !== 200) {
    throw new Error(`tools/call HTTP ${res.status}: ${res.text}`)
  }
  const rpc = JSON.parse(res.text) as {
    result?: {
      isError?: boolean
      content?: Array<{ type: string; text?: string }>
    }
    error?: unknown
  }
  const text = rpc.result?.content?.find((item) => item.type === 'text')?.text
  if (typeof text !== 'string') {
    throw new Error(`tools/call missing text: ${res.text}`)
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { isError: rpc.result?.isError === true, text, json }
}

describe('embedded MCP server', () => {
  const handles: McpServerHandle[] = []
  const dirs: string[] = []

  afterEach(async () => {
    while (handles.length > 0) {
      const handle = handles.pop()
      await handle?.stop()
    }
    while (dirs.length > 0) {
      const dir = dirs.pop()
      if (dir !== undefined) {
        await rm(dir, { recursive: true, force: true })
      }
    }
  })

  async function start(overrides?: {
    listProfiles?: () => Promise<Array<{ id: string; label: string }>>
    hasLiveSession?: (profileId: string) => boolean
    runDeviceFacts?: (profileId: string) => Promise<DeviceFactsRun>
    runInterfaceStatus?: (
      profileId: string,
      interfaces?: readonly string[]
    ) => Promise<InterfaceStatusRun>
    runL2?: (profileId: string) => Promise<L2Run>
    runL3?: (profileId: string) => Promise<L3Run>
    runLogs?: (profileId: string, lines?: number) => Promise<LogsRun>
    runShow?: (profileId: string, command: string) => Promise<RunShowRun>
    startTechSupport?: (profileId: string) => Promise<TechSupportStartResult>
    getTechSupport?: (profileId: string) => TechSupportSnapshot
    createToken?: () => string
    now?: () => Date
  }): Promise<{ dir: string; handle: McpServerHandle }> {
    const dir = await mkdtemp(join(tmpdir(), 'picaglass-mcp-'))
    dirs.push(dir)
    const handle = await createMcpServer({
      userDataPath: dir,
      listProfiles: async () => [],
      hasLiveSession: () => false,
      runDeviceFacts: async () => ({ kind: 'no-session' }),
      runInterfaceStatus: async () => ({ kind: 'no-session' }),
      runL2: async () => ({ kind: 'no-session' }),
      runL3: async () => ({ kind: 'no-session' }),
      runLogs: async () => ({ kind: 'no-session' }),
      runShow: async () => ({ kind: 'no-session' }),
      startTechSupport: async () => ({ kind: 'no-session' }),
      getTechSupport: (profileId) => idleTechSupportSnapshot(profileId),
      createToken: () => TOKEN,
      now: () => new Date(STARTED_AT),
      ...overrides
    })
    handles.push(handle)
    return { dir, handle }
  }

  it('writes a 0600 port file with url, token, pid, and startedAt, and deletes it on stop', async () => {
    const { dir, handle } = await start()
    const path = join(dir, MCP_ENDPOINT_FILE)
    const info = await stat(path)
    expect(info.mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      url: handle.url,
      token: TOKEN,
      pid: process.pid,
      startedAt: STARTED_AT
    })
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}/mcp`)
    expect(handle.token).toBe(TOKEN)
    expect(handle.snippets).toEqual({
      claudeCode: `claude mcp add --transport http picaglass ${handle.url} --header "Authorization: Bearer ${TOKEN}"`,
      pi: JSON.stringify(
        {
          mcpServers: {
            picaglass: {
              url: handle.url,
              headers: {
                Authorization: `Bearer ${TOKEN}`
              }
            }
          }
        },
        null,
        2
      )
    })

    await handle.stop()
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('deletes the port file before stop awaits HTTP shutdown', async () => {
    const { dir, handle } = await start()
    const path = join(dir, MCP_ENDPOINT_FILE)
    const pending = handle.stop()
    expect(existsSync(path)).toBe(false)
    await pending
  })

  it('mints a new bearer token on each start', async () => {
    const first = await start({ createToken: undefined })
    const second = await start({ createToken: undefined })
    expect(first.handle.token).not.toBe(second.handle.token)
    expect(first.handle.token.length).toBeGreaterThanOrEqual(32)
    expect(second.handle.token.length).toBeGreaterThanOrEqual(32)
  })

  it('rejects a missing bearer token with 401', async () => {
    const { handle } = await start()
    const res = await post({
      port: handle.port,
      body: rpcBody(1, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'x', version: '1' }
      })
    })
    expect(res.status).toBe(401)
  })

  it('rejects a wrong bearer token with 401', async () => {
    const { handle } = await start()
    const res = await post({
      port: handle.port,
      token: 'wrong-token',
      body: rpcBody(1, 'ping')
    })
    expect(res.status).toBe(401)
  })

  it('rejects a malicious Origin with 403', async () => {
    const { handle } = await start()
    const res = await post({
      port: handle.port,
      token: TOKEN,
      origin: 'https://evil.example',
      body: rpcBody(1, 'ping')
    })
    expect(res.status).toBe(403)
  })

  it('rejects a malicious Host with 403', async () => {
    const { handle } = await start()
    const res = await post({
      port: handle.port,
      token: TOKEN,
      host: 'evil.example',
      body: rpcBody(1, 'ping')
    })
    expect(res.status).toBe(403)
  })

  it('rejects a Host header that omits the bound port with 403', async () => {
    const { handle } = await start()
    const res = await post({
      port: handle.port,
      token: TOKEN,
      host: '127.0.0.1',
      body: rpcBody(1, 'ping')
    })
    expect(res.status).toBe(403)
  })

  it('rejects a loopback Origin that omits the bound port with 403', async () => {
    const { handle } = await start()
    const res = await post({
      port: handle.port,
      token: TOKEN,
      origin: 'http://127.0.0.1',
      body: rpcBody(1, 'ping')
    })
    expect(res.status).toBe(403)
  })

  it('lists Connection Profiles and which have an active SSH Session', async () => {
    const { handle } = await start({
      listProfiles: async () => [
        { id: 'p-core', label: 'core' },
        { id: 'p-lab', label: 'lab switch' }
      ],
      hasLiveSession: (profileId) => profileId === 'p-lab'
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_list_profiles')
    expect(result.isError).toBe(false)
    expect(result.json).toEqual({
      profiles: [
        { id: 'p-core', label: 'core', hasActiveSession: false },
        { id: 'p-lab', label: 'lab switch', hasActiveSession: true }
      ]
    })
  })

  it('returns structured device facts from the diagnostic service without raw by default', async () => {
    const seen: string[] = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: (profileId) => profileId === 'p-lab',
      runDeviceFacts: async (profileId) => {
        seen.push(profileId)
        return parsedFacts
      }
    })
    const sessionId = await openSession(handle)
    const byId = await callTool(handle, sessionId, 'picos_get_device_facts', { profile: 'p-lab' })
    const byLabel = await callTool(handle, sessionId, 'picos_get_device_facts', {
      profile: 'lab switch'
    })

    expect(seen).toEqual(['p-lab', 'p-lab'])
    expect(byId.isError).toBe(false)
    expect(byId.json).toEqual({
      profile: { id: 'p-lab', label: 'lab switch' },
      version: { status: 'parsed', data: versionData },
      fans: { status: 'parsed', data: fansData },
      temperatures: { status: 'parsed', data: temperaturesData },
      powerSupplies: { status: 'parsed', data: powerSuppliesData }
    })
    expect(JSON.stringify(byId.json)).not.toContain('version-raw')
    expect(byLabel.json).toEqual(byId.json)

    const withRaw = await callTool(handle, sessionId, 'picos_get_device_facts', {
      profile: 'p-lab',
      includeRaw: true
    })
    expect(withRaw.isError).toBe(false)
    expect(withRaw.json).toMatchObject({
      version: { status: 'parsed', data: versionData, raw: 'version-raw' }
    })
    expect(JSON.stringify(withRaw.json)).toContain('version-raw')
  })

  it('returns a protocol error when the profile has no active SSH Session', async () => {
    const seen: string[] = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => false,
      runDeviceFacts: async () => {
        seen.push('ran')
        return parsedFacts
      }
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_device_facts', {
      profile: 'lab switch'
    })
    expect(result.isError).toBe(true)
    expect(result.text).toBe('No active SSH Session for profile lab switch.')
    expect(seen).toEqual([])
  })

  it('returns parse-failed as a normal payload with raw and reason', async () => {
    const run: DeviceFactsRun = {
      kind: 'ok',
      raw: 'not a version listing',
      block: {
        version: {
          status: 'parse-failed',
          raw: 'not a version listing',
          reason: 'missing version skeleton'
        },
        fans: parsedFacts.block.fans,
        temperatures: parsedFacts.block.temperatures,
        powerSupplies: parsedFacts.block.powerSupplies
      }
    }
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      runDeviceFacts: async () => run
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_device_facts', { profile: 'p-lab' })
    expect(result.isError).toBe(false)
    expect(result.json).toMatchObject({
      version: {
        status: 'parse-failed',
        reason: 'missing version skeleton',
        raw: 'not a version listing'
      }
    })
  })

  it('returns a protocol error with exit code and stderr head on channel failure', async () => {
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      runDeviceFacts: async () => ({
        kind: 'channel-failed',
        reason: 'nonzero-exit',
        exitCode: 1,
        stderrHead: "syntax error, expecting 'analyzer'\n"
      })
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_device_facts', { profile: 'p-lab' })
    expect(result.isError).toBe(true)
    expect(result.text).toBe("Command failed (exit 1).\nsyntax error, expecting 'analyzer'\n")
  })

  it('returns a protocol error on a command timeout', async () => {
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      runDeviceFacts: async () => ({
        kind: 'channel-failed',
        reason: 'timeout',
        stderrHead: 'partial output'
      })
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_device_facts', { profile: 'p-lab' })
    expect(result.isError).toBe(true)
    expect(result.text).toBe('Command timed out.\npartial output')
  })

  it('returns structured interface brief and empty optics without detail or raw by default', async () => {
    const seen: Array<{ profileId: string; interfaces?: readonly string[] }> = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: (profileId) => profileId === 'p-lab',
      runInterfaceStatus: async (profileId, interfaces) => {
        seen.push({ profileId, interfaces })
        return parsedInterfaces
      }
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_interface_status', {
      profile: 'p-lab'
    })
    expect(seen).toEqual([{ profileId: 'p-lab', interfaces: [] }])
    expect(result.isError).toBe(false)
    expect(result.json).toEqual({
      profile: { id: 'p-lab', label: 'lab switch' },
      brief: { status: 'parsed', data: briefData },
      optics: { status: 'parsed', data: opticsData }
    })
    expect(JSON.stringify(result.json)).not.toContain('brief-raw')
    expect(JSON.stringify(result.json)).not.toContain('details')
  })

  it('requests detail only when interface names are supplied', async () => {
    const seen: Array<readonly string[] | undefined> = []
    const withDetail: OkInterfaceStatusRun = {
      kind: 'ok',
      raw: 'if-raw',
      block: {
        brief: parsedInterfaces.block.brief,
        optics: parsedInterfaces.block.optics,
        details: {
          status: 'parsed',
          data: {
            rows: [
              {
                name: 'ge-1/1/1',
                management: 'Enabled',
                link: 'Down',
                members: [],
                unparsedLines: 0
              }
            ],
            unparsedLines: 0
          },
          raw: 'detail-raw'
        }
      }
    }
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      runInterfaceStatus: async (_profileId, interfaces) => {
        seen.push(interfaces)
        return withDetail
      }
    })
    const sessionId = await openSession(handle)
    const byString = await callTool(handle, sessionId, 'picos_get_interface_status', {
      profile: 'p-lab',
      interface: 'ge-1/1/1, te-1/1/1(29)'
    })
    const byList = await callTool(handle, sessionId, 'picos_get_interface_status', {
      profile: 'p-lab',
      interface: ['ge-1/1/1']
    })
    expect(seen).toEqual([['ge-1/1/1', 'te-1/1/1(29)'], ['ge-1/1/1']])
    expect(byString.isError).toBe(false)
    expect(byString.json).toMatchObject({
      details: {
        status: 'parsed',
        data: {
          rows: [{ name: 'ge-1/1/1', management: 'Enabled', link: 'Down' }]
        }
      }
    })
    expect(JSON.stringify(byList.json)).not.toContain('detail-raw')
    const withRaw = await callTool(handle, sessionId, 'picos_get_interface_status', {
      profile: 'p-lab',
      interface: 'ge-1/1/1',
      includeRaw: true
    })
    expect(JSON.stringify(withRaw.json)).toContain('detail-raw')
  })

  it('returns a protocol error when interface status has no active SSH Session', async () => {
    const seen: string[] = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => false,
      runInterfaceStatus: async () => {
        seen.push('ran')
        return parsedInterfaces
      }
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_interface_status', {
      profile: 'lab switch'
    })
    expect(result.isError).toBe(true)
    expect(result.text).toBe('No active SSH Session for profile lab switch.')
    expect(seen).toEqual([])
  })

  it('returns parse-failed optics as a normal payload with raw and reason', async () => {
    const run: InterfaceStatusRun = {
      kind: 'ok',
      raw: 'not optics',
      block: {
        brief: parsedInterfaces.block.brief,
        optics: {
          status: 'parse-failed',
          raw: 'not optics',
          reason: 'missing optics skeleton'
        },
        details: null
      }
    }
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      runInterfaceStatus: async () => run
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_interface_status', {
      profile: 'p-lab'
    })
    expect(result.isError).toBe(false)
    expect(result.json).toMatchObject({
      optics: {
        status: 'parse-failed',
        reason: 'missing optics skeleton',
        raw: 'not optics'
      }
    })
  })

  it('returns a protocol error for invalid interface names', async () => {
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      runInterfaceStatus: async () => ({
        kind: 'invalid-interfaces',
        reason: 'invalid interface name: "all"'
      })
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_interface_status', {
      profile: 'p-lab',
      interface: 'all'
    })
    expect(result.isError).toBe(true)
    expect(result.text).toBe('invalid interface name: "all"')
  })

  it('returns structured L2 tables without raw by default, including an empty FDB', async () => {
    const seen: string[] = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: (profileId) => profileId === 'p-lab',
      runL2: async (profileId) => {
        seen.push(profileId)
        return parsedL2
      }
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_l2_tables', { profile: 'p-lab' })
    expect(seen).toEqual(['p-lab'])
    expect(result.isError).toBe(false)
    expect(result.json).toEqual({
      profile: { id: 'p-lab', label: 'lab switch' },
      vlans: { status: 'parsed', data: vlanData },
      fdb: { status: 'parsed', data: fdbData },
      switching: { status: 'parsed', data: switchingData }
    })
    expect(JSON.stringify(result.json)).not.toContain('vlan-raw')
    expect(JSON.stringify(result.json)).not.toContain('fdb-raw')
    const withRaw = await callTool(handle, sessionId, 'picos_get_l2_tables', {
      profile: 'p-lab',
      includeRaw: true
    })
    expect(JSON.stringify(withRaw.json)).toContain('vlan-raw')
    expect(JSON.stringify(withRaw.json)).toContain('fdb-raw')
  })

  it('returns a protocol error when L2 has no active SSH Session', async () => {
    const seen: string[] = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => false,
      runL2: async () => {
        seen.push('ran')
        return parsedL2
      }
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_l2_tables', {
      profile: 'lab switch'
    })
    expect(result.isError).toBe(true)
    expect(result.text).toBe('No active SSH Session for profile lab switch.')
    expect(seen).toEqual([])
  })

  it('returns parse-failed FDB as a normal payload with raw and reason', async () => {
    const run: L2Run = {
      kind: 'ok',
      raw: 'not fdb',
      block: {
        vlans: parsedL2.block.vlans,
        fdb: {
          status: 'parse-failed',
          raw: 'not fdb',
          reason: 'missing fdb skeleton'
        },
        switching: parsedL2.block.switching
      }
    }
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      runL2: async () => run
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_l2_tables', { profile: 'p-lab' })
    expect(result.isError).toBe(false)
    expect(result.json).toMatchObject({
      fdb: {
        status: 'parse-failed',
        reason: 'missing fdb skeleton',
        raw: 'not fdb'
      }
    })
  })

  it('returns structured L3 tables without raw by default, including empty ARP', async () => {
    const seen: string[] = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: (profileId) => profileId === 'p-lab',
      runL3: async (profileId) => {
        seen.push(profileId)
        return parsedL3
      }
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_l3_tables', { profile: 'p-lab' })
    expect(seen).toEqual(['p-lab'])
    expect(result.isError).toBe(false)
    expect(result.json).toEqual({
      profile: { id: 'p-lab', label: 'lab switch' },
      softwareRoutes: { status: 'parsed', data: softwareRouteData },
      hardwareRoutes: { status: 'parsed', data: hardwareRouteData },
      hardwareHosts: { status: 'parsed', data: hardwareHostData },
      arp: { status: 'parsed', data: arpData },
      neighbors: { status: 'parsed', data: arpData }
    })
    expect(JSON.stringify(result.json)).not.toContain('soft-raw')
    expect(JSON.stringify(result.json)).not.toContain('arp-raw')
    const withRaw = await callTool(handle, sessionId, 'picos_get_l3_tables', {
      profile: 'p-lab',
      includeRaw: true
    })
    expect(JSON.stringify(withRaw.json)).toContain('soft-raw')
    expect(JSON.stringify(withRaw.json)).toContain('arp-raw')
  })

  it('returns a protocol error when L3 has no active SSH Session', async () => {
    const seen: string[] = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => false,
      runL3: async () => {
        seen.push('ran')
        return parsedL3
      }
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_l3_tables', {
      profile: 'lab switch'
    })
    expect(result.isError).toBe(true)
    expect(result.text).toBe('No active SSH Session for profile lab switch.')
    expect(seen).toEqual([])
  })

  it('returns parse-failed ARP as a normal payload with raw and reason', async () => {
    const run: L3Run = {
      kind: 'ok',
      raw: 'not arp',
      block: {
        softwareRoutes: parsedL3.block.softwareRoutes,
        hardwareRoutes: parsedL3.block.hardwareRoutes,
        hardwareHosts: parsedL3.block.hardwareHosts,
        arp: {
          status: 'parse-failed',
          raw: 'not arp',
          reason: 'missing arp skeleton'
        },
        neighbors: parsedL3.block.neighbors
      }
    }
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      runL3: async () => run
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_l3_tables', { profile: 'p-lab' })
    expect(result.isError).toBe(false)
    expect(result.json).toMatchObject({
      arp: {
        status: 'parse-failed',
        reason: 'missing arp skeleton',
        raw: 'not arp'
      }
    })
  })

  it('returns structured recent logs without raw by default, including empty cores', async () => {
    const seen: Array<{ profileId: string; lines: number | undefined }> = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: (profileId) => profileId === 'p-lab',
      runLogs: async (profileId, lines) => {
        seen.push({ profileId, lines })
        return parsedLogs
      }
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_recent_logs', { profile: 'p-lab' })
    expect(seen).toEqual([{ profileId: 'p-lab', lines: undefined }])
    expect(result.isError).toBe(false)
    expect(result.json).toEqual({
      profile: { id: 'p-lab', label: 'lab switch' },
      syslog: { status: 'parsed', data: syslogData },
      core: { status: 'parsed', data: coreData }
    })
    expect(JSON.stringify(result.json)).not.toContain('syslog-raw')
    expect(JSON.stringify(result.json)).not.toContain('core-raw')
    const withLines = await callTool(handle, sessionId, 'picos_get_recent_logs', {
      profile: 'p-lab',
      lines: 200
    })
    expect(seen).toEqual([
      { profileId: 'p-lab', lines: undefined },
      { profileId: 'p-lab', lines: 200 }
    ])
    expect(withLines.isError).toBe(false)
    const withRaw = await callTool(handle, sessionId, 'picos_get_recent_logs', {
      profile: 'p-lab',
      includeRaw: true
    })
    expect(JSON.stringify(withRaw.json)).toContain('syslog-raw')
    expect(JSON.stringify(withRaw.json)).toContain('core-raw')
  })

  it('returns a protocol error when logs have no active SSH Session', async () => {
    const seen: string[] = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => false,
      runLogs: async () => {
        seen.push('ran')
        return parsedLogs
      }
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_recent_logs', {
      profile: 'lab switch'
    })
    expect(result.isError).toBe(true)
    expect(result.text).toBe('No active SSH Session for profile lab switch.')
    expect(seen).toEqual([])
  })

  it('returns a protocol error for an invalid log line count', async () => {
    const seen: number[] = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      runLogs: async (_profileId, lines) => {
        if (lines !== undefined) {
          seen.push(lines)
        }
        return { kind: 'invalid-lines', reason: 'invalid log line count: 0' }
      }
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_recent_logs', {
      profile: 'p-lab',
      lines: 0
    })
    expect(result.isError).toBe(true)
    expect(result.text).toBe('invalid log line count: 0')
    expect(seen).toEqual([0])
  })

  it('returns parse-failed syslog as a normal payload with raw and reason', async () => {
    const run: LogsRun = {
      kind: 'ok',
      raw: 'not syslog',
      block: {
        syslog: {
          status: 'parse-failed',
          raw: 'not syslog',
          reason: 'missing syslog skeleton'
        },
        core: parsedLogs.block.core
      }
    }
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      runLogs: async () => run
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_get_recent_logs', { profile: 'p-lab' })
    expect(result.isError).toBe(false)
    expect(result.json).toMatchObject({
      syslog: {
        status: 'parse-failed',
        reason: 'missing syslog skeleton',
        raw: 'not syslog'
      }
    })
  })

  it('starts tech_support and returns a handle without waiting for completion', async () => {
    const started: string[] = []
    const collecting: TechSupportSnapshot = {
      ...idleTechSupportSnapshot('p-lab'),
      taskId: 'task-1',
      phase: 'collecting',
      lastRemotePath: '/tmp/PICOS-202608310901-techSupport.log',
      lastRemoteBytes: 1024,
      lastProcessRunning: true,
      progress: [
        {
          at: '2026-08-31T09:01:00.000Z',
          phase: 'starting',
          message: '已在设备侧后台启动采集（nohup 脱离会话）'
        }
      ]
    }
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      startTechSupport: async (profileId) => {
        started.push(profileId)
        return { kind: 'ok', snapshot: collecting }
      },
      getTechSupport: () => idleTechSupportSnapshot('p-lab')
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_collect_tech_support', {
      profile: 'p-lab'
    })
    expect(started).toEqual(['p-lab'])
    expect(result.isError).toBe(false)
    expect(result.json).toEqual({
      profile: { id: 'p-lab', label: 'lab switch' },
      handle: 'task-1',
      phase: 'collecting',
      progress: [
        {
          at: '2026-08-31T09:01:00.000Z',
          phase: 'starting',
          message: '已在设备侧后台启动采集（nohup 脱离会话）'
        }
      ],
      artifact: null,
      failure: null,
      lastKnown: {
        remotePath: '/tmp/PICOS-202608310901-techSupport.log',
        remoteBytes: 1024,
        processRunning: true
      },
      waitingForSession: false,
      cleanupError: null
    })
  })

  it('queries tech_support status by handle without starting again, including after session drop', async () => {
    const started: string[] = []
    const collecting: TechSupportSnapshot = {
      ...idleTechSupportSnapshot('p-lab'),
      taskId: 'task-1',
      phase: 'collecting',
      waitingForSession: true,
      lastRemoteBytes: 1024,
      lastProcessRunning: true,
      progress: [
        {
          at: '2026-08-31T09:04:00.000Z',
          phase: 'collecting',
          message: '等待 SSH Session 以继续轮询'
        }
      ]
    }
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => false,
      startTechSupport: async (profileId) => {
        started.push(profileId)
        return { kind: 'no-session' }
      },
      getTechSupport: () => collecting
    })
    const sessionId = await openSession(handle)
    const byProfile = await callTool(handle, sessionId, 'picos_collect_tech_support', {
      profile: 'p-lab'
    })
    const byHandle = await callTool(handle, sessionId, 'picos_collect_tech_support', {
      profile: 'p-lab',
      handle: 'task-1'
    })
    expect(started).toEqual([])
    expect(byProfile.isError).toBe(false)
    expect(byHandle.isError).toBe(false)
    expect(byProfile.json).toMatchObject({
      handle: 'task-1',
      phase: 'collecting',
      waitingForSession: true,
      lastKnown: { remoteBytes: 1024, processRunning: true }
    })
    expect(byHandle.json).toEqual(byProfile.json)
  })

  it('returns a done artifact payload for a finished collection', async () => {
    const done: TechSupportSnapshot = {
      ...idleTechSupportSnapshot('p-lab'),
      taskId: 'task-1',
      phase: 'done',
      artifact: {
        fileName: 'PICOS-202608310901-techSupport.log',
        byteSize: 2048,
        localPath: '/tmp/PICOS-202608310901-techSupport.log',
        remotePath: '/tmp/PICOS-202608310901-techSupport.log',
        remoteDeleted: true
      },
      progress: [
        {
          at: '2026-08-31T09:08:00.000Z',
          phase: 'done',
          message: '已删除设备侧副本'
        }
      ]
    }
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      startTechSupport: async () => ({ kind: 'ok', snapshot: done }),
      getTechSupport: () => done
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_collect_tech_support', {
      profile: 'p-lab'
    })
    expect(result.isError).toBe(false)
    expect(result.json).toMatchObject({
      handle: 'task-1',
      phase: 'done',
      artifact: {
        fileName: 'PICOS-202608310901-techSupport.log',
        byteSize: 2048,
        localPath: '/tmp/PICOS-202608310901-techSupport.log',
        remoteDeleted: true
      },
      failure: null
    })
  })

  it('returns failed last-known facts as a normal payload', async () => {
    const failed: TechSupportSnapshot = {
      ...idleTechSupportSnapshot('p-lab'),
      taskId: 'task-1',
      phase: 'failed',
      failure: {
        stage: 'transferring',
        message: '回传校验失败：设备侧 2048 字节，本机 1000 字节'
      },
      lastRemotePath: '/tmp/PICOS-202608310901-techSupport.log',
      lastRemoteBytes: 2048,
      lastProcessRunning: false
    }
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      getTechSupport: () => failed
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_collect_tech_support', {
      profile: 'p-lab'
    })
    expect(result.isError).toBe(false)
    expect(result.json).toMatchObject({
      phase: 'failed',
      failure: {
        stage: 'transferring',
        message: '回传校验失败：设备侧 2048 字节，本机 1000 字节'
      },
      lastKnown: {
        remotePath: '/tmp/PICOS-202608310901-techSupport.log',
        remoteBytes: 2048,
        processRunning: false
      }
    })
  })

  it('returns a protocol error when starting tech_support with no active SSH Session', async () => {
    const started: string[] = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => false,
      startTechSupport: async (profileId) => {
        started.push(profileId)
        return { kind: 'no-session' }
      }
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_collect_tech_support', {
      profile: 'lab switch'
    })
    expect(result.isError).toBe(true)
    expect(result.text).toBe('No active SSH Session for profile lab switch.')
    expect(started).toEqual([])
  })

  it('rejects an unknown tech_support handle', async () => {
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      getTechSupport: () => idleTechSupportSnapshot('p-lab')
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'picos_collect_tech_support', {
      profile: 'p-lab',
      handle: 'missing'
    })
    expect(result.isError).toBe(true)
    expect(result.text).toBe('Unknown tech_support handle: missing')
  })

  it('returns structured data for a whitelisted show command that has a parser', async () => {
    const seen: Array<{ profileId: string; command: string }> = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: (profileId) => profileId === 'p-lab',
      runShow: async (profileId, command) => {
        seen.push({ profileId, command })
        return {
          kind: 'ok',
          command: 'show version | no-more',
          result: { status: 'parsed', data: versionData, raw: 'version-raw' },
          raw: 'version-raw'
        }
      }
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'run_show', {
      profile: 'p-lab',
      command: 'show version'
    })
    expect(seen).toEqual([{ profileId: 'p-lab', command: 'show version' }])
    expect(result.isError).toBe(false)
    expect(result.json).toEqual({
      profile: { id: 'p-lab', label: 'lab switch' },
      command: 'show version | no-more',
      result: { status: 'parsed', data: versionData }
    })
    expect(JSON.stringify(result.json)).not.toContain('version-raw')
    const withRaw = await callTool(handle, sessionId, 'run_show', {
      profile: 'p-lab',
      command: 'show version',
      includeRaw: true
    })
    expect(withRaw.json).toMatchObject({
      result: { status: 'parsed', data: versionData, raw: 'version-raw' }
    })
  })

  it('returns raw text for a whitelisted show or ping that has no parser', async () => {
    const seen: string[] = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      runShow: async (_profileId, command) => {
        seen.push(command)
        if (command.startsWith('ping')) {
          return {
            kind: 'ok',
            command: 'ping 192.0.2.1 count 5 | no-more',
            result: { status: 'raw', raw: 'PING 192.0.2.1: 56 data bytes' },
            raw: 'PING 192.0.2.1: 56 data bytes'
          }
        }
        return {
          kind: 'ok',
          command: 'show spanning-tree | no-more',
          result: { status: 'raw', raw: 'STP is not enabled' },
          raw: 'STP is not enabled'
        }
      }
    })
    const sessionId = await openSession(handle)
    const show = await callTool(handle, sessionId, 'run_show', {
      profile: 'p-lab',
      command: 'show spanning-tree'
    })
    const ping = await callTool(handle, sessionId, 'run_show', {
      profile: 'p-lab',
      command: 'ping 192.0.2.1'
    })
    expect(seen).toEqual(['show spanning-tree', 'ping 192.0.2.1'])
    expect(show.isError).toBe(false)
    expect(show.json).toEqual({
      profile: { id: 'p-lab', label: 'lab switch' },
      command: 'show spanning-tree | no-more',
      result: { status: 'raw', raw: 'STP is not enabled' }
    })
    expect(ping.isError).toBe(false)
    expect(ping.json).toEqual({
      profile: { id: 'p-lab', label: 'lab switch' },
      command: 'ping 192.0.2.1 count 5 | no-more',
      result: { status: 'raw', raw: 'PING 192.0.2.1: 56 data bytes' }
    })
  })

  it('rejects configuration, chaining, and non-whitelisted pipes in the tool itself', async () => {
    const seen: string[] = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      runShow: async (_profileId, command) => {
        seen.push(command)
        return { kind: 'no-session' }
      }
    })
    const sessionId = await openSession(handle)
    const configure = await callTool(handle, sessionId, 'run_show', {
      profile: 'p-lab',
      command: 'configure'
    })
    const chained = await callTool(handle, sessionId, 'run_show', {
      profile: 'p-lab',
      command: 'show version; configure'
    })
    const pipe = await callTool(handle, sessionId, 'run_show', {
      profile: 'p-lab',
      command: 'show version | display xml'
    })
    const fileDelete = await callTool(handle, sessionId, 'run_show', {
      profile: 'p-lab',
      command: 'file delete /tmp/x'
    })
    expect(seen).toEqual([])
    expect(configure).toEqual({
      isError: true,
      text: 'run_show only allows show and ping commands.',
      json: undefined
    })
    expect(chained.isError).toBe(true)
    expect(chained.text).toBe('run_show does not allow command chaining.')
    expect(pipe.isError).toBe(true)
    expect(pipe.text).toBe('run_show does not allow the "display" pipe filter.')
    expect(fileDelete.isError).toBe(true)
    expect(fileDelete.text).toBe('run_show only allows show and ping commands.')
  })

  it('rejects an invalid ping target and an over-limit ping count without executing', async () => {
    const seen: string[] = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      runShow: async (_profileId, command) => {
        seen.push(command)
        return { kind: 'no-session' }
      }
    })
    const sessionId = await openSession(handle)
    const badTarget = await callTool(handle, sessionId, 'run_show', {
      profile: 'p-lab',
      command: 'ping 999.999.999.999'
    })
    const overCount = await callTool(handle, sessionId, 'run_show', {
      profile: 'p-lab',
      command: 'ping 192.0.2.1 count 21'
    })
    expect(seen).toEqual([])
    expect(badTarget.isError).toBe(true)
    expect(badTarget.text).toBe('invalid ping target: "999.999.999.999"')
    expect(overCount.isError).toBe(true)
    expect(overCount.text).toBe('invalid ping count: 21')
  })

  it('returns a protocol error when run_show has no active SSH Session', async () => {
    const seen: string[] = []
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => false,
      runShow: async (_profileId, command) => {
        seen.push(command)
        return { kind: 'no-session' }
      }
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'run_show', {
      profile: 'lab switch',
      command: 'show version'
    })
    expect(result.isError).toBe(true)
    expect(result.text).toBe('No active SSH Session for profile lab switch.')
    expect(seen).toEqual([])
  })

  it('returns parse-failed from run_show as a normal payload with raw and reason', async () => {
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      runShow: async () => ({
        kind: 'ok',
        command: 'show version | no-more',
        result: {
          status: 'parse-failed',
          reason: 'missing version skeleton',
          raw: 'not a version listing'
        },
        raw: 'not a version listing'
      })
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'run_show', {
      profile: 'p-lab',
      command: 'show version'
    })
    expect(result.isError).toBe(false)
    expect(result.json).toEqual({
      profile: { id: 'p-lab', label: 'lab switch' },
      command: 'show version | no-more',
      result: {
        status: 'parse-failed',
        reason: 'missing version skeleton',
        raw: 'not a version listing'
      }
    })
  })

  it('returns a protocol error with exit code and stderr head when run_show channel fails', async () => {
    const { handle } = await start({
      listProfiles: async () => [{ id: 'p-lab', label: 'lab switch' }],
      hasLiveSession: () => true,
      runShow: async () => ({
        kind: 'channel-failed',
        reason: 'nonzero-exit',
        exitCode: 1,
        stderrHead: "syntax error, expecting 'analyzer'\n"
      })
    })
    const sessionId = await openSession(handle)
    const result = await callTool(handle, sessionId, 'run_show', {
      profile: 'p-lab',
      command: 'show version'
    })
    expect(result.isError).toBe(true)
    expect(result.text).toBe("Command failed (exit 1).\nsyntax error, expecting 'analyzer'\n")
  })
})

import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MCP_ENDPOINT_FILE } from '../../shared/mcp-config'
import type { DeviceFactsRun } from '../../shared/picos/device-facts'
import { createMcpServer, type McpServerHandle } from './create-mcp-server'

type OkDeviceFactsRun = Extract<DeviceFactsRun, { kind: 'ok' }>

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
})

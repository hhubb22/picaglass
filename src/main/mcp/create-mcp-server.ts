import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { chmod, writeFile } from 'node:fs/promises'
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from 'node:http'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  MCP_ENDPOINT_FILE,
  MCP_SERVER_NAME,
  mcpConfigSnippets,
  type McpConfigSnippets,
  type McpEndpointRecord
} from '../../shared/mcp-config'
import type { ParsedResult } from '../../shared/picos/parsed-result'
import type { DeviceFactsChannelFailure, DeviceFactsRun } from '../../shared/picos/device-facts'
import type {
  InterfaceStatusChannelFailure,
  InterfaceStatusRun
} from '../../shared/picos/interface-status'
import type { L2ChannelFailure, L2Run } from '../../shared/picos/l2'
import type { L3ChannelFailure, L3Run } from '../../shared/picos/l3'

export type McpProfileListing = {
  id: string
  label: string
}

export type CreateMcpServerDeps = {
  userDataPath: string
  listProfiles: () => Promise<McpProfileListing[]>
  hasLiveSession: (profileId: string) => boolean
  runDeviceFacts: (profileId: string) => Promise<DeviceFactsRun>
  runInterfaceStatus: (
    profileId: string,
    interfaces?: readonly string[]
  ) => Promise<InterfaceStatusRun>
  runL2: (profileId: string) => Promise<L2Run>
  runL3: (profileId: string) => Promise<L3Run>
  now?: () => Date
  createToken?: () => string
}

export type McpServerHandle = {
  url: string
  token: string
  port: number
  snippets: McpConfigSnippets
  stop: () => Promise<void>
}

const FILE_MODE = 0o600
const MAX_BODY_BYTES = 1024 * 1024
const READ_ONLY = { readOnlyHint: true as const }

type McpSession = {
  server: McpServer
  transport: StreamableHTTPServerTransport
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function parseHostHeader(host: string): { hostname: string; port: string } | undefined {
  const trimmed = host.trim()
  if (trimmed.length === 0 || trimmed.startsWith('[')) {
    return undefined
  }
  const colon = trimmed.indexOf(':')
  if (colon <= 0 || trimmed.indexOf(':', colon + 1) !== -1) {
    return undefined
  }
  const hostname = trimmed.slice(0, colon).toLowerCase()
  const port = trimmed.slice(colon + 1)
  if (hostname.length === 0 || port.length === 0) {
    return undefined
  }
  return { hostname, port }
}

function hostAllowed(hostHeader: string | string[] | undefined, port: number): boolean {
  const raw = headerValue(hostHeader)
  if (raw === undefined) {
    return false
  }
  const parsed = parseHostHeader(raw)
  if (parsed === undefined) {
    return false
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    return false
  }
  return parsed.port === String(port)
}

function originAllowed(originHeader: string | string[] | undefined, port: number): boolean {
  if (originHeader === undefined) {
    return true
  }
  if (typeof originHeader !== 'string') {
    return false
  }
  const origin = originHeader.trim()
  if (origin.length === 0) {
    return true
  }
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:') {
      return false
    }
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      return false
    }
    return parsed.port === String(port)
  } catch {
    return false
  }
}

function bearerToken(authorization: string | string[] | undefined): string | undefined {
  const header = headerValue(authorization)
  if (header === undefined) {
    return undefined
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  return match?.[1]
}

function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) {
    return false
  }
  return timingSafeEqual(a, b)
}

function sendText(res: ServerResponse, status: number, body: string): void {
  if (res.headersSent) {
    return
  }
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > MAX_BODY_BYTES) {
      throw new Error('payload-too-large')
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function mcpText(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
}

function mcpToolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function noSessionError(label: string): CallToolResult {
  return mcpToolError(`No active SSH Session for profile ${label}.`)
}

function projectResult<T>(result: ParsedResult<T>, includeRaw: boolean): unknown {
  if (result.status === 'parse-failed') {
    return { status: 'parse-failed', reason: result.reason, raw: result.raw }
  }
  if (includeRaw) {
    return { status: 'parsed', data: result.data, raw: result.raw }
  }
  return { status: 'parsed', data: result.data }
}

function channelErrorText(
  run:
    DeviceFactsChannelFailure | InterfaceStatusChannelFailure | L2ChannelFailure | L3ChannelFailure
): string {
  let message = 'Command failed.'
  if (run.reason === 'timeout') {
    message = 'Command timed out.'
  } else if (run.reason === 'rejected') {
    message = 'Command channel was rejected.'
  } else if (run.exitCode !== undefined) {
    message = `Command failed (exit ${run.exitCode}).`
  }
  if (run.stderrHead.length > 0) {
    return `${message}\n${run.stderrHead}`
  }
  return message
}

function resolveProfile(
  profiles: McpProfileListing[],
  ref: string
): { ok: true; profile: McpProfileListing } | { ok: false; message: string } {
  const needle = ref.trim()
  const byId = profiles.find((profile) => profile.id === needle)
  if (byId !== undefined) {
    return { ok: true, profile: byId }
  }
  const byLabel = profiles.filter((profile) => profile.label === needle)
  if (byLabel.length === 1 && byLabel[0] !== undefined) {
    return { ok: true, profile: byLabel[0] }
  }
  if (byLabel.length > 1) {
    return {
      ok: false,
      message: `Profile Label "${needle}" matches more than one Connection Profile; use the profile id.`
    }
  }
  return { ok: false, message: `Unknown Connection Profile: ${needle}` }
}

function normalizeInterfaceArg(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return []
  }
  if (Array.isArray(value)) {
    return value
  }
  return value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
}

function registerTools(server: McpServer, deps: CreateMcpServerDeps): void {
  server.registerTool(
    'picos_list_profiles',
    {
      title: 'List Connection Profiles',
      description:
        'List Connection Profiles and which of them currently have an active SSH Session.',
      annotations: READ_ONLY
    },
    async () => {
      const profiles = await deps.listProfiles()
      return mcpText({
        profiles: profiles.map((profile) => ({
          id: profile.id,
          label: profile.label,
          hasActiveSession: deps.hasLiveSession(profile.id)
        }))
      })
    }
  )

  server.registerTool(
    'picos_get_device_facts',
    {
      title: 'Get device facts',
      description:
        'Get structured device facts (model, version, serial, license, fans, temperature, power supplies) for a Connection Profile that has an active SSH Session.',
      inputSchema: {
        profile: z.string().min(1).describe('Connection Profile id or Profile Label'),
        includeRaw: z
          .boolean()
          .optional()
          .describe('When true, include raw command text for parsed results')
      },
      annotations: READ_ONLY
    },
    async ({ profile, includeRaw }) => {
      const profiles = await deps.listProfiles()
      const resolved = resolveProfile(profiles, profile)
      if (!resolved.ok) {
        return mcpToolError(resolved.message)
      }
      if (!deps.hasLiveSession(resolved.profile.id)) {
        return noSessionError(resolved.profile.label)
      }
      const run = await deps.runDeviceFacts(resolved.profile.id)
      if (run.kind === 'no-session') {
        return noSessionError(resolved.profile.label)
      }
      if (run.kind === 'channel-failed') {
        return mcpToolError(channelErrorText(run))
      }
      const withRaw = includeRaw === true
      return mcpText({
        profile: { id: resolved.profile.id, label: resolved.profile.label },
        version: projectResult(run.block.version, withRaw),
        fans: projectResult(run.block.fans, withRaw),
        temperatures: projectResult(run.block.temperatures, withRaw),
        powerSupplies: projectResult(run.block.powerSupplies, withRaw)
      })
    }
  )

  server.registerTool(
    'picos_get_interface_status',
    {
      title: 'Get interface status',
      description:
        'Get the interface-status Diagnostic Block for a Connection Profile that has an active SSH Session: structured brief table (status, admin state, speed, description) and optics diagnostics. Pass interface names to fetch detail; detail is not pulled for every port by default.',
      inputSchema: {
        profile: z.string().min(1).describe('Connection Profile id or Profile Label'),
        interface: z
          .union([z.string().min(1), z.array(z.string().min(1))])
          .optional()
          .describe(
            'Interface name or list of names. When set, also fetch show interface detail for those names only.'
          ),
        includeRaw: z
          .boolean()
          .optional()
          .describe('When true, include raw command text for parsed results')
      },
      annotations: READ_ONLY
    },
    async ({ profile, includeRaw, interface: interfaceArg }) => {
      const profiles = await deps.listProfiles()
      const resolved = resolveProfile(profiles, profile)
      if (!resolved.ok) {
        return mcpToolError(resolved.message)
      }
      if (!deps.hasLiveSession(resolved.profile.id)) {
        return noSessionError(resolved.profile.label)
      }
      const names = normalizeInterfaceArg(interfaceArg)
      const run = await deps.runInterfaceStatus(resolved.profile.id, names)
      if (run.kind === 'no-session') {
        return noSessionError(resolved.profile.label)
      }
      if (run.kind === 'invalid-interfaces') {
        return mcpToolError(run.reason)
      }
      if (run.kind === 'channel-failed') {
        return mcpToolError(channelErrorText(run))
      }
      const withRaw = includeRaw === true
      const payload: Record<string, unknown> = {
        profile: { id: resolved.profile.id, label: resolved.profile.label },
        brief: projectResult(run.block.brief, withRaw),
        optics: projectResult(run.block.optics, withRaw)
      }
      if (run.block.details !== null) {
        payload.details = projectResult(run.block.details, withRaw)
      }
      return mcpText(payload)
    }
  )

  server.registerTool(
    'picos_get_l2_tables',
    {
      title: 'Get L2 tables',
      description:
        'Get the L2 Diagnostic Block for a Connection Profile that has an active SSH Session: VLAN table, FDB (mac-address table), and per-port tagged/untagged/native VLAN members. An empty FDB is a successful zero-row result.',
      inputSchema: {
        profile: z.string().min(1).describe('Connection Profile id or Profile Label'),
        includeRaw: z
          .boolean()
          .optional()
          .describe('When true, include raw command text for parsed results')
      },
      annotations: READ_ONLY
    },
    async ({ profile, includeRaw }) => {
      const profiles = await deps.listProfiles()
      const resolved = resolveProfile(profiles, profile)
      if (!resolved.ok) {
        return mcpToolError(resolved.message)
      }
      if (!deps.hasLiveSession(resolved.profile.id)) {
        return noSessionError(resolved.profile.label)
      }
      const run = await deps.runL2(resolved.profile.id)
      if (run.kind === 'no-session') {
        return noSessionError(resolved.profile.label)
      }
      if (run.kind === 'channel-failed') {
        return mcpToolError(channelErrorText(run))
      }
      const withRaw = includeRaw === true
      return mcpText({
        profile: { id: resolved.profile.id, label: resolved.profile.label },
        vlans: projectResult(run.block.vlans, withRaw),
        fdb: projectResult(run.block.fdb, withRaw),
        switching: projectResult(run.block.switching, withRaw)
      })
    }
  )

  server.registerTool(
    'picos_get_l3_tables',
    {
      title: 'Get L3 tables',
      description:
        'Get the L3 Diagnostic Block for a Connection Profile that has an active SSH Session: software routing table and hardware forwarding/host tables side by side, plus ARP and IPv6 neighbor tables. Empty ARP/neighbor tables are successful zero-row results.',
      inputSchema: {
        profile: z.string().min(1).describe('Connection Profile id or Profile Label'),
        includeRaw: z
          .boolean()
          .optional()
          .describe('When true, include raw command text for parsed results')
      },
      annotations: READ_ONLY
    },
    async ({ profile, includeRaw }) => {
      const profiles = await deps.listProfiles()
      const resolved = resolveProfile(profiles, profile)
      if (!resolved.ok) {
        return mcpToolError(resolved.message)
      }
      if (!deps.hasLiveSession(resolved.profile.id)) {
        return noSessionError(resolved.profile.label)
      }
      const run = await deps.runL3(resolved.profile.id)
      if (run.kind === 'no-session') {
        return noSessionError(resolved.profile.label)
      }
      if (run.kind === 'channel-failed') {
        return mcpToolError(channelErrorText(run))
      }
      const withRaw = includeRaw === true
      return mcpText({
        profile: { id: resolved.profile.id, label: resolved.profile.label },
        softwareRoutes: projectResult(run.block.softwareRoutes, withRaw),
        hardwareRoutes: projectResult(run.block.hardwareRoutes, withRaw),
        hardwareHosts: projectResult(run.block.hardwareHosts, withRaw),
        arp: projectResult(run.block.arp, withRaw),
        neighbors: projectResult(run.block.neighbors, withRaw)
      })
    }
  )
}

async function createSession(
  deps: CreateMcpServerDeps,
  sessions: Map<string, McpSession>
): Promise<McpSession> {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: '1.0.0' })
  registerTools(server, deps)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { server, transport })
    }
  })
  transport.onclose = () => {
    const sessionId = transport.sessionId
    if (sessionId !== undefined) {
      sessions.delete(sessionId)
    }
  }
  await server.connect(transport)
  return { server, transport }
}

export async function createMcpServer(deps: CreateMcpServerDeps): Promise<McpServerHandle> {
  const token = deps.createToken?.() ?? randomBytes(32).toString('hex')
  const sessions = new Map<string, McpSession>()
  let port = 0
  let stopped = false

  const httpServer: HttpServer = createServer((req, res) => {
    void handleRequest(req, res)
  })

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!hostAllowed(req.headers.host, port) || !originAllowed(req.headers.origin, port)) {
        sendText(res, 403, 'Forbidden')
        return
      }
      const provided = bearerToken(req.headers.authorization)
      if (provided === undefined || !tokensEqual(provided, token)) {
        sendText(res, 401, 'Unauthorized')
        return
      }
      const pathname = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).pathname
      if (pathname !== '/mcp') {
        sendText(res, 404, 'Not Found')
        return
      }
      if (req.method === 'POST') {
        let raw: string
        try {
          raw = await readBody(req)
        } catch {
          sendText(res, 413, 'Payload Too Large')
          return
        }
        let parsed: unknown
        try {
          parsed = raw.length === 0 ? undefined : JSON.parse(raw)
        } catch {
          sendText(res, 400, 'Bad Request')
          return
        }
        const sessionId = headerValue(req.headers['mcp-session-id'])
        if (sessionId !== undefined) {
          const session = sessions.get(sessionId)
          if (session === undefined) {
            sendText(res, 404, 'Session not found')
            return
          }
          await session.transport.handleRequest(req, res, parsed)
          return
        }
        if (isInitializeRequest(parsed)) {
          const session = await createSession(deps, sessions)
          await session.transport.handleRequest(req, res, parsed)
          return
        }
        sendText(res, 400, 'Bad Request')
        return
      }
      if (req.method === 'GET' || req.method === 'DELETE') {
        const sessionId = headerValue(req.headers['mcp-session-id'])
        if (sessionId === undefined) {
          sendText(res, 400, 'Bad Request')
          return
        }
        const session = sessions.get(sessionId)
        if (session === undefined) {
          sendText(res, 404, 'Session not found')
          return
        }
        await session.transport.handleRequest(req, res)
        return
      }
      sendText(res, 405, 'Method Not Allowed')
    } catch {
      sendText(res, 500, 'Internal Server Error')
    }
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      reject(err)
    }
    httpServer.once('error', onError)
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', onError)
      resolve()
    })
  })

  const address = httpServer.address()
  if (address === null || typeof address === 'string') {
    httpServer.close()
    throw new Error('MCP server did not bind a TCP port')
  }
  port = address.port
  const url = `http://127.0.0.1:${port}/mcp`
  const startedAt = (deps.now?.() ?? new Date()).toISOString()
  const record: McpEndpointRecord = { url, token, pid: process.pid, startedAt }
  const portFile = join(deps.userDataPath, MCP_ENDPOINT_FILE)

  try {
    await writeFile(portFile, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      mode: FILE_MODE
    })
    await chmod(portFile, FILE_MODE)
  } catch (err) {
    httpServer.close()
    throw err
  }

  async function stop(): Promise<void> {
    if (stopped) {
      return
    }
    stopped = true
    try {
      unlinkSync(portFile)
    } catch (err) {
      if (!isEnoent(err)) {
        throw err
      }
    }
    for (const session of sessions.values()) {
      await session.transport.close().catch(() => undefined)
      await session.server.close().catch(() => undefined)
    }
    sessions.clear()
    httpServer.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        if (err) {
          reject(err)
          return
        }
        resolve()
      })
    })
  }

  return {
    url,
    token,
    port,
    snippets: mcpConfigSnippets(url, token),
    stop
  }
}

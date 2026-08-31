import { execFileSync } from 'node:child_process'
import { constants, readFileSync, readdirSync } from 'node:fs'
import { createConnection, createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { vi } from 'vitest'
import { Server, type Session, type SFTPWrapper, utils as ssh2Utils } from 'ssh2'
import { createSshApi, type SshApi, type SshDialogs, type SshSender } from './create-ssh-api'
import { createSshEventInbox } from '../../shared/ssh-event-inbox'
import {
  SINGLE_FORM_PROFILE_ID,
  type SshAuth,
  type SshConnectRequest,
  type SshStatusEvent
} from '../../shared/ssh'

export type TestSize = {
  cols: number
  rows: number
}

export type TestPty = TestSize & {
  term: string
}

export type TestExecRequest = {
  command: string
  ptyRequested: boolean
}

export type TestExecResponse = {
  stdout?: string | Buffer
  stderr?: string | Buffer
  exitCode?: number
  delayMs?: number
  hang?: boolean
  reject?: boolean
}

export type TestSftpFiles = Record<string, Buffer | string>

export type TestServer = {
  port: number
  shellCount: () => number
  shellOpened: () => boolean
  pty: () => TestPty | undefined
  windowChanges: () => TestSize[]
  receivedBytes: () => Buffer
  liveConnections: () => number
  execs: () => TestExecRequest[]
  closeLastShell: () => void
  close: () => Promise<void>
}

export type CapturedEmit = { channel: string; payload: unknown }

function fingerprintFromSshKeygen(keyPath: string): string {
  const line = execFileSync('ssh-keygen', ['-lf', keyPath], { encoding: 'utf8' }).trim()
  const fingerprint = line.split(/\s+/)[1]
  if (fingerprint === undefined || !fingerprint.startsWith('SHA256:')) {
    throw new Error(`unexpected ssh-keygen -lf output: ${line}`)
  }
  return fingerprint
}

export function generateHostKey(dir: string, name = 'host'): { pem: string; fingerprint: string } {
  const keyPath = join(dir, name)
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', keyPath, '-N', '', '-q'])
  return {
    pem: readFileSync(keyPath, 'utf8'),
    fingerprint: fingerprintFromSshKeygen(keyPath)
  }
}

function ptyFromInfo(info: { cols: number; rows: number; term?: unknown }): TestPty {
  return {
    term: typeof info.term === 'string' ? info.term : '',
    cols: info.cols,
    rows: info.rows
  }
}

function replyExec(
  stream: {
    write: (data: Buffer) => void
    stderr: { write: (data: Buffer) => void }
    exit: (code: number) => void
    close: () => void
  },
  response: TestExecResponse
): void {
  const stdout = response.stdout
  if (stdout !== undefined) {
    stream.write(typeof stdout === 'string' ? Buffer.from(stdout) : stdout)
  }
  const stderr = response.stderr
  if (stderr !== undefined) {
    stream.stderr.write(typeof stderr === 'string' ? Buffer.from(stderr) : stderr)
  }
  stream.exit(response.exitCode ?? 0)
  stream.close()
}

const { OPEN_MODE, STATUS_CODE } = ssh2Utils.sftp

function fileBuffer(contents: Buffer | string): Buffer {
  return typeof contents === 'string' ? Buffer.from(contents) : contents
}

function sftpAttrs(size: number): {
  mode: number
  uid: number
  gid: number
  size: number
  atime: number
  mtime: number
} {
  return {
    mode: constants.S_IFREG | 0o644,
    uid: 0,
    gid: 0,
    size,
    atime: 0,
    mtime: 0
  }
}

function bindDownloadSftp(session: Session, files: TestSftpFiles): void {
  session.on('sftp', (accept) => {
    const sftp: SFTPWrapper = accept()
    const openFiles = new Map<number, { path: string; data: Buffer }>()
    let nextHandle = 1

    const lookup = (path: string): Buffer | undefined => {
      const contents = files[path]
      if (contents === undefined) {
        return undefined
      }
      return fileBuffer(contents)
    }

    sftp.on('OPEN', (reqid, filename, flags) => {
      const data = lookup(filename)
      if (data === undefined || (flags & OPEN_MODE.READ) === 0) {
        sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE)
        return
      }
      const id = nextHandle
      nextHandle += 1
      const handle = Buffer.alloc(4)
      handle.writeUInt32BE(id, 0)
      openFiles.set(id, { path: filename, data })
      sftp.handle(reqid, handle)
    })
    sftp.on('READ', (reqid, handle, offset, length) => {
      if (handle.length !== 4) {
        sftp.status(reqid, STATUS_CODE.FAILURE)
        return
      }
      const opened = openFiles.get(handle.readUInt32BE(0))
      if (opened === undefined) {
        sftp.status(reqid, STATUS_CODE.FAILURE)
        return
      }
      if (offset >= opened.data.length) {
        sftp.status(reqid, STATUS_CODE.EOF)
        return
      }
      const end = Math.min(offset + length, opened.data.length)
      sftp.data(reqid, opened.data.subarray(offset, end))
    })
    sftp.on('CLOSE', (reqid, handle) => {
      if (handle.length === 4) {
        openFiles.delete(handle.readUInt32BE(0))
      }
      sftp.status(reqid, STATUS_CODE.OK)
    })
    const onStat = (reqid: number, path: string): void => {
      const data = lookup(path)
      if (data === undefined) {
        sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE)
        return
      }
      sftp.attrs(reqid, sftpAttrs(data.length))
    }
    sftp.on('STAT', onStat)
    sftp.on('LSTAT', onStat)
    sftp.on('FSTAT', (reqid, handle) => {
      if (handle.length !== 4) {
        sftp.status(reqid, STATUS_CODE.FAILURE)
        return
      }
      const opened = openFiles.get(handle.readUInt32BE(0))
      if (opened === undefined) {
        sftp.status(reqid, STATUS_CODE.FAILURE)
        return
      }
      sftp.attrs(reqid, sftpAttrs(opened.data.length))
    })
    sftp.on('REALPATH', (reqid, path) => {
      const data = lookup(path)
      const attrs = sftpAttrs(data?.length ?? 0)
      sftp.name(reqid, [{ filename: path, longname: path, attrs }])
    })
  })
}

export async function startServer(
  hostKeyPem: string,
  opts?: {
    stallAuth?: boolean
    stallShell?: boolean
    port?: number
    exec?: (command: string) => TestExecResponse
    sftp?: TestSftpFiles
  }
): Promise<TestServer> {
  let shells = 0
  let pty: TestPty | undefined
  let lastShell: { close: () => void } | undefined
  let live = 0
  const windowChanges: TestSize[] = []
  const received: Buffer[] = []
  const execs: TestExecRequest[] = []
  const server = new Server({ hostKeys: [hostKeyPem] }, (connection) => {
    live += 1
    connection.on('close', () => {
      live -= 1
    })
    connection.on('error', () => undefined)
    connection.on('authentication', (ctx) => {
      if (opts?.stallAuth === true) {
        return
      }
      if (ctx.method === 'password' && ctx.password === 'secret-password') {
        ctx.accept()
        return
      }
      if (ctx.method === 'publickey') {
        ctx.accept()
        return
      }
      ctx.reject(['password', 'publickey'])
    })
    connection.on('ready', () => {
      if (opts?.stallShell === true) {
        connection.on('session', (accept) => {
          const session = accept()
          session.on('pty', (acceptPty) => {
            acceptPty()
          })
          session.on('shell', () => undefined)
        })
        return
      }
      connection.on('session', (accept) => {
        const session = accept()
        let ptyRequested = false
        session.on('pty', (acceptPty, _reject, info) => {
          ptyRequested = true
          pty = ptyFromInfo(info)
          acceptPty()
        })
        // setWindow wants no reply, so there is nothing to accept here.
        session.on('window-change', (_acceptChange, _rejectChange, info) => {
          windowChanges.push({ cols: info.cols, rows: info.rows })
        })
        session.on('shell', (acceptShell) => {
          shells += 1
          const stream = acceptShell()
          lastShell = stream
          stream.write(Buffer.from([0xff, 0xfe, 0x00, 0x61]))
          stream.on('data', (data: Buffer) => {
            received.push(Buffer.from(data))
            stream.write(data)
          })
        })
        session.on('exec', (acceptExec, rejectExec, info) => {
          execs.push({ command: info.command, ptyRequested })
          const response = opts?.exec?.(info.command) ?? { stdout: '', exitCode: 0 }
          if (response.reject === true) {
            rejectExec()
            return
          }
          const stream = acceptExec()
          if (response.hang === true) {
            return
          }
          if (response.delayMs !== undefined && response.delayMs > 0) {
            setTimeout(() => {
              replyExec(stream, response)
            }, response.delayMs)
            return
          }
          replyExec(stream, response)
        })
        if (opts?.sftp !== undefined) {
          bindDownloadSftp(session, opts.sftp)
        }
      })
    })
  })

  server.on('error', () => undefined)

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts?.port ?? 0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        reject(new Error('expected TCP address'))
        return
      }
      resolve(addr.port)
    })
  })

  return {
    port,
    shellCount: () => shells,
    shellOpened: () => shells > 0,
    pty: () => pty,
    windowChanges: () => [...windowChanges],
    receivedBytes: () => Buffer.concat(received),
    liveConnections: () => live,
    execs: () => [...execs],
    closeLastShell: () => {
      lastShell?.close()
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err)
            return
          }
          resolve()
        })
      })
  }
}

export async function listenTcp(onConnection: (socket: Socket) => void): Promise<{
  port: number
  close: () => Promise<void>
}> {
  const sockets: Socket[] = []
  const server = createServer((socket) => {
    sockets.push(socket)
    onConnection(socket)
  })
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        reject(new Error('expected TCP address'))
        return
      }
      resolve(addr.port)
    })
  })
  return {
    port,
    close: () =>
      new Promise((resolve, reject) => {
        for (const socket of sockets) {
          socket.destroy()
        }
        server.close((err) => {
          if (err) {
            reject(err)
            return
          }
          resolve()
        })
      })
  }
}

export type TestProxy = {
  port: number
  cut: () => void
  close: () => Promise<void>
}

// A live session only loses its transport from the outside, so tests reach the server through
// a proxy they can tear down under the shell.
export async function tcpProxy(targetPort: number): Promise<TestProxy> {
  const pairs: Array<{ inbound: Socket; outbound: Socket }> = []
  const server = createServer((inbound) => {
    const outbound = createConnection(targetPort, '127.0.0.1')
    pairs.push({ inbound, outbound })
    inbound.on('error', () => undefined)
    outbound.on('error', () => undefined)
    inbound.pipe(outbound)
    outbound.pipe(inbound)
  })
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        reject(new Error('expected TCP address'))
        return
      }
      resolve(addr.port)
    })
  })
  return {
    port,
    // RST rather than a clean EOF, so the client reports a failure instead of a tidy exit.
    cut: () => {
      for (const pair of pairs) {
        pair.outbound.destroy()
        pair.inbound.resetAndDestroy()
      }
    },
    close: () =>
      new Promise((resolve, reject) => {
        for (const pair of pairs) {
          pair.inbound.destroy()
          pair.outbound.destroy()
        }
        server.close((err) => {
          if (err) {
            reject(err)
            return
          }
          resolve()
        })
      })
  }
}

export function neverSettles(label: string, ms = 1500): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(label)), ms)
  })
}

export function testApi(
  userDataPath: string,
  dialogs?: Partial<SshDialogs>,
  emits?: CapturedEmit[],
  extras?: { authTimeoutMs?: number }
): SshApi {
  return createSshApi({
    userDataPath,
    dialogs: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      ...dialogs
    },
    emitTo: (_senderId, channel, payload) => {
      const cloned = structuredClone(payload)
      emits?.push({ channel, payload: cloned })
    },
    authTimeoutMs: extras?.authTimeoutMs
  })
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function dataChunk(emits: CapturedEmit[]): Uint8Array | undefined {
  for (const event of emits) {
    if (event.channel !== 'ssh:data' || !isRecord(event.payload)) {
      continue
    }
    const chunk = event.payload.chunk
    if (chunk instanceof Uint8Array) {
      return chunk
    }
  }
  return undefined
}

export function emitsHaveChunk(emits: CapturedEmit[], expected: Uint8Array): boolean {
  return emits.some((event) => {
    if (event.channel !== 'ssh:data' || !isRecord(event.payload)) {
      return false
    }
    const chunk = event.payload.chunk
    return chunk instanceof Uint8Array && Buffer.from(chunk).equals(Buffer.from(expected))
  })
}

export function statusTypes(emits: CapturedEmit[], sessionId: string): string[] {
  const types: string[] = []
  for (const event of emits) {
    if (event.channel !== 'ssh:status' || !isRecord(event.payload)) {
      continue
    }
    if (event.payload.sessionId !== sessionId || typeof event.payload.type !== 'string') {
      continue
    }
    types.push(event.payload.type)
  }
  return types
}

export function filesContain(dir: string, needle: string): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (filesContain(full, needle)) {
        return true
      }
      continue
    }
    if (readFileSync(full).includes(needle)) {
      return true
    }
  }
  return false
}

function statusEvent(payload: unknown): SshStatusEvent | undefined {
  if (!isRecord(payload) || typeof payload.sessionId !== 'string') {
    return undefined
  }
  if (payload.type !== 'connected' && payload.type !== 'closed' && payload.type !== 'error') {
    return undefined
  }
  const event: SshStatusEvent = { sessionId: payload.sessionId, type: payload.type }
  if (typeof payload.profileId === 'string') {
    event.profileId = payload.profileId
  }
  if (typeof payload.message === 'string') {
    event.message = payload.message
  }
  if (typeof payload.code === 'number') {
    event.code = payload.code
  }
  return event
}

export function testApiWithInbox(
  userDataPath: string,
  inbox: ReturnType<typeof createSshEventInbox>,
  dialogs?: Partial<SshDialogs>,
  extras?: { forwardStatus?: boolean }
): SshApi {
  const forwardStatus = extras?.forwardStatus !== false
  return createSshApi({
    userDataPath,
    dialogs: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      ...dialogs
    },
    emitTo: (_senderId, channel, payload) => {
      if (channel === 'ssh:data' && isRecord(payload) && typeof payload.sessionId === 'string') {
        const chunk = payload.chunk
        if (chunk instanceof Uint8Array) {
          inbox.handleData(payload.sessionId, Uint8Array.from(chunk))
        }
        return
      }
      if (forwardStatus && channel === 'ssh:status') {
        const event = statusEvent(payload)
        if (event !== undefined) {
          inbox.handleStatus(event)
        }
      }
    }
  })
}

export function connectRequest(
  port: number,
  auth?: SshAuth,
  profileId: string = SINGLE_FORM_PROFILE_ID
): SshConnectRequest {
  return {
    profileId,
    host: '127.0.0.1',
    port,
    username: 'tester',
    auth: auth ?? { method: 'password', password: 'secret-password' },
    cols: 80,
    rows: 24
  }
}

export async function liveSession(
  api: SshApi,
  server: TestServer,
  sender: SshSender,
  profileId = SINGLE_FORM_PROFILE_ID
): Promise<string> {
  const first = await api.connect(connectRequest(server.port, undefined, profileId), sender)
  if (first.ok) {
    return first.sessionId
  }
  if (first.reason !== 'host-unknown') {
    throw new Error(`expected host-unknown, got ${JSON.stringify(first)}`)
  }
  const trusted = await api.confirmHostKey(first.sessionId, 'trust-always', sender)
  if (!trusted.ok) {
    throw new Error(`expected a live session, got ${JSON.stringify(trusted)}`)
  }
  return trusted.sessionId
}

export async function waitForServerBytes(server: TestServer, probe: Uint8Array): Promise<void> {
  await vi.waitFor(() => {
    if (!server.receivedBytes().includes(Buffer.from(probe))) {
      throw new Error('server has not seen the probe yet')
    }
  })
}

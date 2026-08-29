import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Server } from 'ssh2'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSshApi, type SshApi, type SshDialogs } from './create-ssh-api'
import type { SshAuth, SshConnectRequest } from '../../shared/ssh'

type TestPty = {
  term: string
  cols: number
  rows: number
}

type TestServer = {
  port: number
  shellCount: () => number
  shellOpened: () => boolean
  pty: () => TestPty | undefined
  close: () => Promise<void>
}

function fingerprintFromSshKeygen(keyPath: string): string {
  const line = execFileSync('ssh-keygen', ['-lf', keyPath], { encoding: 'utf8' }).trim()
  const fingerprint = line.split(/\s+/)[1]
  if (fingerprint === undefined || !fingerprint.startsWith('SHA256:')) {
    throw new Error(`unexpected ssh-keygen -lf output: ${line}`)
  }
  return fingerprint
}

function generateHostKey(dir: string): { pem: string; fingerprint: string } {
  const keyPath = join(dir, 'host')
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

async function startServer(hostKeyPem: string): Promise<TestServer> {
  let shells = 0
  let pty: TestPty | undefined
  const server = new Server({ hostKeys: [hostKeyPem] }, (connection) => {
    connection.on('error', () => undefined)
    connection.on('authentication', (ctx) => {
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
      connection.on('session', (accept) => {
        const session = accept()
        session.on('pty', (acceptPty, _reject, info) => {
          pty = ptyFromInfo(info)
          acceptPty()
        })
        session.on('shell', (acceptShell) => {
          shells += 1
          const stream = acceptShell()
          stream.write(Buffer.from([0xff, 0xfe, 0x00, 0x61]))
        })
      })
    })
  })

  server.on('error', () => undefined)

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
    shellCount: () => shells,
    shellOpened: () => shells > 0,
    pty: () => pty,
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

type CapturedEmit = { channel: string; payload: unknown }

function testApi(
  userDataPath: string,
  dialogs?: Partial<SshDialogs>,
  emits?: CapturedEmit[]
): SshApi {
  return createSshApi({
    userDataPath,
    dialogs: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showMessageBox: async () => ({ response: 1 }),
      ...dialogs
    },
    emitTo: (_senderId, channel, payload) => {
      const cloned = structuredClone(payload)
      emits?.push({ channel, payload: cloned })
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function dataChunk(emits: CapturedEmit[]): Uint8Array | undefined {
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

function filesContain(dir: string, needle: string): boolean {
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

function connectRequest(port: number, auth?: SshAuth): SshConnectRequest {
  return {
    host: '127.0.0.1',
    port,
    username: 'tester',
    auth: auth ?? { method: 'password', password: 'secret-password' },
    cols: 80,
    rows: 24
  }
}

describe('createSshApi', () => {
  let userDataPath: string | undefined
  let api: SshApi | undefined
  let server: TestServer | undefined

  afterEach(async () => {
    api?.dispose()
    api = undefined
    if (server) {
      await server.close()
      server = undefined
    }
    if (userDataPath) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = undefined
    }
  })

  it('connects to an unknown host as host-unknown with the ssh-keygen fingerprint and does not open a shell', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const result = await api.connect(connectRequest(server.port), { id: 1 })

    expect(result).toEqual({
      ok: false,
      reason: 'host-unknown',
      sessionId: expect.any(String),
      fingerprint: hostKey.fingerprint,
      algorithm: 'ssh-ed25519'
    })
    if (result.ok || result.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    expect(result.sessionId.length).toBeGreaterThan(0)
    expect(server.shellOpened()).toBe(false)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('secret-password')
    expect(serialized).not.toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(serialized).not.toContain('BEGIN RSA PRIVATE KEY')
  })

  it('aborts an unknown host without a Yes/No box and the next connect is still host-unknown', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    let messageBoxes = 0
    api = testApi(userDataPath, {
      showMessageBox: async () => {
        messageBoxes += 1
        return { response: 0 }
      }
    })

    const first = await api.connect(connectRequest(server.port), { id: 1 })
    if (first.ok || first.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }

    await api.confirmHostKey(first.sessionId, 'abort', { id: 1 })
    expect(messageBoxes).toBe(0)

    const second = await api.connect(connectRequest(server.port), { id: 1 })

    expect(second).toEqual({
      ok: false,
      reason: 'host-unknown',
      sessionId: expect.any(String),
      fingerprint: hostKey.fingerprint,
      algorithm: 'ssh-ed25519'
    })
    if (second.ok || second.reason !== 'host-unknown') {
      throw new Error('expected host-unknown after abort')
    }
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(server.shellOpened()).toBe(false)
    expect(messageBoxes).toBe(0)
  })

  it('pickPrivateKey returns an opaque keyRef and connect still pauses without a shell', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    const clientKeyPath = join(userDataPath, 'id_ed25519')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', clientKeyPath, '-N', '', '-q'])
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath, {
      showOpenDialog: async () => ({ canceled: false, filePaths: [clientKeyPath] })
    })

    const picked = await api.pickPrivateKey({ id: 1 })
    expect(picked).toEqual({ keyRef: expect.any(String), label: 'id_ed25519' })
    if (picked === null) {
      throw new Error('expected a key')
    }
    expect(picked.keyRef).not.toBe(clientKeyPath)
    expect(picked.keyRef.includes('/')).toBe(false)
    expect(picked.keyRef.includes('\\')).toBe(false)

    const result = await api.connect(
      connectRequest(server.port, { method: 'privateKey', keyRef: picked.keyRef }),
      { id: 1 }
    )

    expect(result).toEqual({
      ok: false,
      reason: 'host-unknown',
      sessionId: expect.any(String),
      fingerprint: hostKey.fingerprint,
      algorithm: 'ssh-ed25519'
    })
    expect(server.shellOpened()).toBe(false)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(serialized).not.toContain(readFileSync(clientKeyPath, 'utf8'))
  })

  it('pickPrivateKey cancel returns null and stores nothing', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    api = testApi(userDataPath, {
      showOpenDialog: async () => ({ canceled: true, filePaths: ['/tmp/id_ed25519'] })
    })

    expect(await api.pickPrivateKey({ id: 1 })).toBeNull()
  })

  it('trust-always Yes shows a native box then opens a shell with xterm-256color and the current cols/rows', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    let messageBoxes = 0
    api = testApi(userDataPath, {
      showMessageBox: async (options) => {
        expect(options.cancelId).toBe(1)
        expect(options.defaultId).toBe(0)
        messageBoxes += 1
        return { response: 0 }
      }
    })

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }

    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })

    expect(messageBoxes).toBe(1)
    expect(trusted).toEqual({ ok: true, sessionId: unknown.sessionId })
    expect(server.shellOpened()).toBe(true)
    expect(server.pty()).toEqual({ term: 'xterm-256color', cols: 80, rows: 24 })
    const serialized = JSON.stringify(trusted)
    expect(serialized).not.toContain('secret-password')
    expect(serialized).not.toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(serialized).not.toContain('BEGIN RSA PRIVATE KEY')
  })

  it('a second createSshApi on the same userData connects without host-unknown', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath, {
      showMessageBox: async () => ({ response: 0 })
    })

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected trust-always to succeed')
    }
    const shellsAfterTrust = server.shellCount()
    api.dispose()

    api = testApi(userDataPath)
    const again = await api.connect(connectRequest(server.port), { id: 1 })

    expect(again).toEqual({ ok: true, sessionId: expect.any(String) })
    if (!again.ok) {
      throw new Error('expected a live session')
    }
    expect(again.sessionId).not.toBe(unknown.sessionId)
    expect(server.shellCount()).toBe(shellsAfterTrust + 1)
    expect(JSON.stringify(again)).not.toContain('secret-password')
    expect(filesContain(userDataPath, 'secret-password')).toBe(false)
  })

  it('ssh:data delivers invalid UTF-8 bytes after clone', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    api = testApi(
      userDataPath,
      {
        showMessageBox: async () => ({ response: 0 })
      },
      emits
    )

    const unknown = await api.connect(connectRequest(server.port), { id: 1 })
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }
    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })
    if (!trusted.ok) {
      throw new Error('expected a live session')
    }

    const expected = Uint8Array.from([0xff, 0xfe, 0x00, 0x61])
    const utf8RoundTrip = Buffer.from(Buffer.from(expected).toString('utf8'), 'utf8')
    expect(utf8RoundTrip.equals(Buffer.from(expected))).toBe(false)

    const chunk = await vi.waitFor(() => {
      const received = dataChunk(emits)
      if (received === undefined) {
        throw new Error('no ssh:data yet')
      }
      return received
    })

    expect(chunk).toEqual(expected)
    expect(JSON.stringify(emits.map((event) => event.payload))).not.toContain(
      'BEGIN OPENSSH PRIVATE KEY'
    )
    expect(JSON.stringify(emits.map((event) => event.payload))).not.toContain(
      'BEGIN RSA PRIVATE KEY'
    )
  })

  it('trust-always Yes with a private key opens a shell', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    const clientKeyPath = join(userDataPath, 'id_ed25519')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', clientKeyPath, '-N', '', '-q'])
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath, {
      showOpenDialog: async () => ({ canceled: false, filePaths: [clientKeyPath] }),
      showMessageBox: async () => ({ response: 0 })
    })

    const picked = await api.pickPrivateKey({ id: 1 })
    if (picked === null) {
      throw new Error('expected a key')
    }
    const unknown = await api.connect(
      connectRequest(server.port, { method: 'privateKey', keyRef: picked.keyRef }),
      { id: 1 }
    )
    if (unknown.ok || unknown.reason !== 'host-unknown') {
      throw new Error('expected host-unknown')
    }

    const trusted = await api.confirmHostKey(unknown.sessionId, 'trust-always', { id: 1 })

    expect(trusted).toEqual({ ok: true, sessionId: unknown.sessionId })
    expect(server.shellOpened()).toBe(true)
    expect(JSON.stringify(trusted)).not.toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(JSON.stringify(trusted)).not.toContain(readFileSync(clientKeyPath, 'utf8'))
  })
})

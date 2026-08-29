import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Server } from 'ssh2'
import { afterEach, describe, expect, it } from 'vitest'
import { createSshApi, type SshApi, type SshDialogs } from './create-ssh-api'
import type { SshAuth, SshConnectRequest } from '../../shared/ssh'

type TestServer = {
  port: number
  shellOpened: () => boolean
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

async function startServer(hostKeyPem: string): Promise<TestServer> {
  let shellOpened = false
  const server = new Server({ hostKeys: [hostKeyPem] }, (connection) => {
    connection.on('error', () => undefined)
    connection.on('authentication', (ctx) => {
      ctx.accept()
    })
    connection.on('ready', () => {
      connection.on('session', (accept) => {
        const session = accept()
        session.on('pty', (acceptPty) => {
          acceptPty()
        })
        session.on('shell', (acceptShell) => {
          shellOpened = true
          acceptShell()
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
    shellOpened: () => shellOpened,
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

function testApi(userDataPath: string, dialogs?: Partial<SshDialogs>): SshApi {
  return createSshApi({
    userDataPath,
    dialogs: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showMessageBox: async () => ({ response: 1 }),
      ...dialogs
    },
    emitTo: (_senderId, _channel, payload) => {
      structuredClone(payload)
    }
  })
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
})

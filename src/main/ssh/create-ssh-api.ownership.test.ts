import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SshApi, SshSender } from './create-ssh-api'
import {
  type CapturedEmit,
  type TestServer,
  connectRequest,
  emitsHaveChunk,
  generateHostKey,
  liveSession,
  startServer,
  statusTypes,
  testApi,
  waitForServerBytes
} from './ssh-test-fixture'

describe('createSshApi ownership', () => {
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

  it('keyRef is opaque and the dialog path is not a usable keyRef', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    const clientKeyPath = join(userDataPath, 'id_ed25519')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', clientKeyPath, '-N', '', '-q'])
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath, {
      showOpenDialog: async () => ({ canceled: false, filePaths: [clientKeyPath] }),
      showMessageBox: async () => ({ response: 0 })
    })

    const live = await liveSession(api, server, { id: 1 })
    await api.disconnect(live, { id: 1 })

    const picked = await api.pickPrivateKey({ id: 1 })
    if (picked === null) {
      throw new Error('expected a key')
    }
    expect(picked.keyRef).not.toBe(clientKeyPath)
    expect(picked.keyRef).not.toContain('/')
    expect(clientKeyPath).toContain(picked.label)

    const asPath = await api.connect(
      connectRequest(server.port, { method: 'privateKey', keyRef: clientKeyPath }),
      { id: 1 }
    )
    expect(asPath).toEqual({ ok: false, reason: 'invalid', message: 'unknown key' })
    expect(server.shellCount()).toBe(1)

    const byRef = await api.connect(
      connectRequest(server.port, { method: 'privateKey', keyRef: picked.keyRef }),
      { id: 1 }
    )
    expect(byRef).toEqual({ ok: true, sessionId: expect.any(String) })
    expect(server.shellCount()).toBe(2)
  })

  it('a cancelled pickPrivateKey returns null and mints no keyRef', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    const clientKeyPath = join(userDataPath, 'id_ed25519')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', clientKeyPath, '-N', '', '-q'])
    server = await startServer(hostKey.pem)
    let dialogs = 0
    api = testApi(userDataPath, {
      showOpenDialog: async () => {
        dialogs += 1
        return { canceled: true, filePaths: [clientKeyPath] }
      },
      showMessageBox: async () => ({ response: 0 })
    })

    expect(await api.pickPrivateKey({ id: 1 })).toBeNull()
    expect(dialogs).toBe(1)

    const rejected = await api.connect(
      connectRequest(server.port, { method: 'privateKey', keyRef: clientKeyPath }),
      { id: 1 }
    )
    expect(rejected).toEqual({ ok: false, reason: 'invalid', message: 'unknown key' })
    expect(server.shellOpened()).toBe(false)
  })

  it('a keyRef belongs to the window that picked it and dies with it', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    const clientKeyPath = join(userDataPath, 'id_ed25519')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', clientKeyPath, '-N', '', '-q'])
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath, {
      showOpenDialog: async () => ({ canceled: false, filePaths: [clientKeyPath] }),
      showMessageBox: async () => ({ response: 0 })
    })

    const live = await liveSession(api, server, { id: 1 })
    await api.disconnect(live, { id: 1 })
    const picked = await api.pickPrivateKey({ id: 1 })
    if (picked === null) {
      throw new Error('expected a key')
    }

    const borrowed = await api.connect(
      connectRequest(server.port, { method: 'privateKey', keyRef: picked.keyRef }),
      { id: 2 }
    )
    expect(borrowed).toEqual({ ok: false, reason: 'invalid', message: 'unknown key' })
    expect(server.shellCount()).toBe(1)

    api.disposeSender(1)

    const orphaned = await api.connect(
      connectRequest(server.port, { method: 'privateKey', keyRef: picked.keyRef }),
      { id: 1 }
    )
    expect(orphaned).toEqual({ ok: false, reason: 'invalid', message: 'unknown key' })
    expect(server.shellCount()).toBe(1)
  })

  it('another webContents cannot write, resize, disconnect, or confirm', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    api = testApi(userDataPath, { showMessageBox: async () => ({ response: 0 }) }, emits)

    const owner: SshSender = { id: 1 }
    const intruder: SshSender = { id: 2 }
    const live = await liveSession(api, server, owner)

    const stolen = Uint8Array.from([0x01, 0x02, 0x03])
    api.write(live, stolen, intruder)
    api.resize(live, 200, 50, intruder)
    await api.disconnect(live, intruder)
    const confirmed = await api.confirmHostKey(live, 'trust-always', intruder)
    expect(confirmed).toEqual({ ok: false, reason: 'invalid', message: 'unknown session' })

    const probe = Uint8Array.from([0x11, 0x12, 0x13])
    api.write(live, probe, owner)
    await waitForServerBytes(server, probe)
    await vi.waitFor(() => {
      if (!emitsHaveChunk(emits, probe)) {
        throw new Error('owner session did not echo')
      }
    })
    expect(server.receivedBytes().includes(Buffer.from(stolen))).toBe(false)

    api.resize(live, 120, 40, owner)
    await vi.waitFor(() => {
      if (server?.windowChanges().length === 0) {
        throw new Error('no window-change yet')
      }
    })
    expect(server.windowChanges()).toEqual([{ cols: 120, rows: 40 }])
    expect(statusTypes(emits, live)).toEqual(['connected'])
  })

  it('another webContents cannot confirm or abort a pending host key', async () => {
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

    const owner: SshSender = { id: 1 }
    const intruder: SshSender = { id: 2 }
    const paused = await api.connect(connectRequest(server.port), owner)
    if (paused.ok || paused.reason !== 'host-unknown') {
      throw new Error(`expected host-unknown, got ${JSON.stringify(paused)}`)
    }

    const stolenTrust = await api.confirmHostKey(paused.sessionId, 'trust-always', intruder)
    expect(stolenTrust).toEqual({ ok: false, reason: 'invalid', message: 'unknown session' })
    const stolenAbort = await api.confirmHostKey(paused.sessionId, 'abort', intruder)
    expect(stolenAbort).toEqual({ ok: false, reason: 'invalid', message: 'unknown session' })
    expect(messageBoxes).toBe(0)
    expect(server.shellOpened()).toBe(false)
    expect(existsSync(join(userDataPath, 'ssh', 'known_hosts'))).toBe(false)

    const trusted = await api.confirmHostKey(paused.sessionId, 'trust-always', owner)
    expect(trusted).toEqual({ ok: true, sessionId: paused.sessionId })
    expect(messageBoxes).toBe(1)
    expect(existsSync(join(userDataPath, 'ssh', 'known_hosts'))).toBe(true)
  })

  it('another sender cannot take over a live Connection Profile', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    api = testApi(userDataPath, { showMessageBox: async () => ({ response: 0 }) }, emits)

    const owner: SshSender = { id: 1 }
    const live = await liveSession(api, server, owner)
    const stolen = await api.connect(connectRequest(server.port), { id: 2 })
    expect(stolen).toEqual({
      ok: false,
      reason: 'invalid',
      message: 'session already exists'
    })
    expect(server.shellCount()).toBe(1)

    const probe = Uint8Array.from([0x41])
    api.write(live, probe, owner)
    await waitForServerBytes(server, probe)
    expect(statusTypes(emits, live)).toEqual(['connected'])
  })

  it('closing one window ends only that window client', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    api = testApi(userDataPath, { showMessageBox: async () => ({ response: 0 }) }, emits)

    const closing = await liveSession(api, server, { id: 1 }, 'profile-a')
    const staying = await liveSession(api, server, { id: 2 }, 'profile-b')
    expect(server.liveConnections()).toBe(2)

    api.disposeSender(1)

    await vi.waitFor(() => {
      if (server?.liveConnections() !== 1) {
        throw new Error(`expected one live client, got ${server?.liveConnections()}`)
      }
    })
    const stale = Uint8Array.from([0x51, 0x52])
    api.write(closing, stale, { id: 1 })
    const fresh = Uint8Array.from([0x61])
    api.write(staying, fresh, { id: 2 })
    await waitForServerBytes(server, fresh)
    expect(server.receivedBytes().includes(Buffer.from(stale))).toBe(false)
    expect(statusTypes(emits, closing)).toContain('closed')
  })

  it('quitting ends every client', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath, { showMessageBox: async () => ({ response: 0 }) })

    await liveSession(api, server, { id: 1 }, 'profile-a')
    await liveSession(api, server, { id: 2 }, 'profile-b')
    expect(server.liveConnections()).toBe(2)

    api.dispose()

    await vi.waitFor(() => {
      if (server?.liveConnections() !== 0) {
        throw new Error(`expected no live clients, got ${server?.liveConnections()}`)
      }
    })
  })
})

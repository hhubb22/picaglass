import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bindWorkspaceClose,
  confirmWorkspaceClose,
  type ClosableWorkspaceWindow
} from '../profiles/bind-workspace-close'
import type { SshApi, SshSender } from './create-ssh-api'
import {
  type CapturedEmit,
  type TestServer,
  connectRequest,
  emitsHaveChunk,
  generateHostKey,
  listenTcp,
  liveSession,
  neverSettles,
  startServer,
  testApi,
  waitForServerBytes
} from './ssh-test-fixture'

function closableWindow(): {
  window: ClosableWorkspaceWindow
  preventCount: () => number
  sent: string[]
  closeCount: () => number
  fireClose: () => void
} {
  const closeListeners: Array<(event?: { preventDefault: () => void }) => void> = []
  const closedListeners: Array<() => void> = []
  let preventCount = 0
  let closeCount = 0
  const sent: string[] = []
  const window: ClosableWorkspaceWindow = {
    webContents: {
      send(channel) {
        sent.push(channel)
      }
    },
    on(event, listener) {
      if (event === 'close') {
        closeListeners.push(listener)
        return
      }
      closedListeners.push(listener)
    },
    close() {
      closeCount += 1
      const event = {
        preventDefault() {
          preventCount += 1
        }
      }
      for (const listener of closeListeners) {
        listener(event)
      }
      if (preventCount === closeCount) {
        return
      }
      for (const listener of closedListeners) {
        listener()
      }
    }
  }
  return {
    window,
    preventCount: () => preventCount,
    sent,
    closeCount: () => closeCount,
    fireClose() {
      window.close()
    }
  }
}

describe('session controls and shutdown at the SSH API seam', () => {
  let userDataPath: string | undefined
  let api: SshApi | undefined
  let server: TestServer | undefined
  let tcp: { port: number; close: () => Promise<void> } | undefined

  afterEach(async () => {
    api?.dispose()
    api = undefined
    if (server) {
      await server.close()
      server = undefined
    }
    if (tcp) {
      await tcp.close()
      tcp = undefined
    }
    if (userDataPath) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = undefined
    }
  })

  it('Disconnect All ends every session for the sender and leaves other senders untouched', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-shutdown-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    tcp = await listenTcp(() => undefined)
    const emits: CapturedEmit[] = []
    api = testApi(userDataPath, undefined, emits)

    const owner: SshSender = { id: 1 }
    const other: SshSender = { id: 2 }
    const first = await liveSession(api, server, owner, 'profile-a')
    const second = await liveSession(api, server, owner, 'profile-b')
    const kept = await liveSession(api, server, other, 'profile-c')
    const pending = api.connect(connectRequest(tcp.port, undefined, 'profile-pending'), owner)
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })

    expect(api.activeSessionCount(owner)).toBe(3)
    expect(api.activeSessionCount()).toBe(4)

    await api.disconnectAll(owner)
    expect(
      await Promise.race([pending, neverSettles('pending connect hung after disconnect-all')])
    ).toEqual({
      ok: false,
      reason: 'canceled',
      message: 'canceled'
    })

    await vi.waitFor(() => {
      if (server?.liveConnections() !== 1) {
        throw new Error(`expected one live client, got ${server?.liveConnections()}`)
      }
    })
    expect(api.activeSessionCount(owner)).toBe(0)
    expect(api.hasSession('profile-a')).toBe(false)
    expect(api.hasSession('profile-b')).toBe(false)
    expect(api.hasSession('profile-pending')).toBe(false)
    expect(api.hasSession('profile-c')).toBe(true)

    const stale = Uint8Array.from([0x21])
    api.write(first, stale, owner)
    api.write(second, stale, owner)
    const probe = Uint8Array.from([0x22])
    api.write(kept, probe, other)
    await waitForServerBytes(server, probe)
    expect(server.receivedBytes().includes(Buffer.from(stale))).toBe(false)
  })

  it('another sender cannot Disconnect All a window’s sessions', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-shutdown-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    const emits: CapturedEmit[] = []
    api = testApi(userDataPath, undefined, emits)

    const owner: SshSender = { id: 1 }
    const live = await liveSession(api, server, owner)
    await api.disconnectAll({ id: 2 })

    const probe = Uint8Array.from([0x31])
    api.write(live, probe, owner)
    await waitForServerBytes(server, probe)
    await vi.waitFor(() => {
      if (!emitsHaveChunk(emits, probe)) {
        throw new Error('owner session did not echo after a stolen disconnect-all')
      }
    })
    expect(api.activeSessionCount(owner)).toBe(1)
    expect(server.liveConnections()).toBe(1)
  })

  it('window close with active sessions warns first, then disconnects all before the window closes', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-shutdown-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const owner: SshSender = { id: 1 }
    await liveSession(api, server, owner, 'profile-a')
    await liveSession(api, server, owner, 'profile-b')
    const fake = closableWindow()
    bindWorkspaceClose(fake.window, {
      shouldBlock: () => api!.activeSessionCount(owner) > 0,
      beforeClose: () => api!.disconnectAll(owner)
    })

    fake.fireClose()
    expect(fake.sent).toEqual(['workspace:close-requested'])
    expect(fake.preventCount()).toBe(1)
    expect(api.activeSessionCount(owner)).toBe(2)
    expect(server.liveConnections()).toBe(2)

    await confirmWorkspaceClose(fake.window)
    await vi.waitFor(() => {
      if (server?.liveConnections() !== 0) {
        throw new Error(`expected no live clients, got ${server?.liveConnections()}`)
      }
    })
    expect(api.activeSessionCount(owner)).toBe(0)
    expect(fake.closeCount()).toBe(2)
    expect(fake.preventCount()).toBe(1)
  })

  it('a confirmed close disconnects sessions on a macOS-style quit path as well as window close', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-shutdown-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const owner: SshSender = { id: 1 }
    await liveSession(api, server, owner)
    const fake = closableWindow()
    const quitListeners: Array<(event: { preventDefault: () => void }) => void> = []
    let quitCount = 0
    let disposed = false
    const app = {
      on(_event: 'before-quit', listener: (event: { preventDefault: () => void }) => void) {
        quitListeners.push(listener)
      },
      quit() {
        quitCount += 1
        let prevented = false
        const event = {
          preventDefault() {
            prevented = true
          }
        }
        for (const listener of quitListeners) {
          listener(event)
        }
        if (!prevented) {
          disposed = true
        }
      }
    }
    bindWorkspaceClose(fake.window, {
      shouldBlock: () => api!.activeSessionCount(owner) > 0,
      beforeClose: () => api!.disconnectAll(owner),
      app,
      onQuit: () => {
        disposed = true
      }
    })

    app.quit()
    expect(fake.sent).toEqual(['workspace:close-requested'])
    expect(quitCount).toBe(1)
    expect(disposed).toBe(false)
    expect(api.activeSessionCount(owner)).toBe(1)

    await confirmWorkspaceClose(fake.window)
    await vi.waitFor(() => {
      if (server?.liveConnections() !== 0) {
        throw new Error(`expected no live clients, got ${server?.liveConnections()}`)
      }
    })
    expect(api.activeSessionCount(owner)).toBe(0)
    expect(quitCount).toBe(2)
    expect(disposed).toBe(true)
  })

  it('after a clean shutdown a relaunched API restores no SSH Session', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-ssh-shutdown-'))
    const hostKey = generateHostKey(userDataPath)
    server = await startServer(hostKey.pem)
    api = testApi(userDataPath)

    const owner: SshSender = { id: 1 }
    await liveSession(api, server, owner, 'profile-a')
    await liveSession(api, server, owner, 'profile-b')
    await api.disconnectAll(owner)
    await vi.waitFor(() => {
      if (server?.liveConnections() !== 0) {
        throw new Error(`expected no live clients, got ${server?.liveConnections()}`)
      }
    })
    api.dispose()
    api = undefined

    const relaunched = testApi(userDataPath)
    api = relaunched
    expect(relaunched.activeSessionCount()).toBe(0)
    expect(relaunched.hasSession('profile-a')).toBe(false)
    expect(relaunched.hasSession('profile-b')).toBe(false)
    expect(server.liveConnections()).toBe(0)
  })
})

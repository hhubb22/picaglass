import { describe, expect, it, vi } from 'vitest'

const { exposed } = vi.hoisted(() => ({
  exposed: [] as Array<{ key: string; value: unknown }>
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      exposed.push({ key, value })
    }
  },
  ipcRenderer: {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn()
  }
}))

async function loadPreload(): Promise<Array<{ key: string; value: unknown }>> {
  Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true })
  exposed.length = 0
  vi.resetModules()
  await import('./index')
  return exposed
}

describe('preload bridge', () => {
  it('exposes the ssh api and nothing that can reach another IPC channel', async () => {
    const bridges = await loadPreload()

    expect(bridges.map((bridge) => bridge.key)).toEqual(['api'])

    const api = bridges[0]?.value
    if (typeof api !== 'object' || api === null) {
      throw new Error('expected an api object')
    }
    expect(Object.keys(api).sort()).toEqual(['diagnostics', 'mcp', 'profiles', 'ssh', 'workspace'])
    const ssh = (api as { ssh: unknown }).ssh
    if (typeof ssh !== 'object' || ssh === null) {
      throw new Error('expected an ssh object')
    }
    expect(Object.keys(ssh).sort()).toEqual([
      'cancel',
      'confirmHostKey',
      'connect',
      'disconnect',
      'disconnectAll',
      'forgetHostKey',
      'hostTrust',
      'onData',
      'onSnapshot',
      'onStatus',
      'pickPrivateKey',
      'refreshDiscovery',
      'resize',
      'secretRequirement',
      'write'
    ])
    const diagnostics = (api as { diagnostics: unknown }).diagnostics
    if (typeof diagnostics !== 'object' || diagnostics === null) {
      throw new Error('expected a diagnostics object')
    }
    expect(Object.keys(diagnostics).sort()).toEqual([
      'runDeviceFacts',
      'runInterfaceStatus',
      'runL2'
    ])
    const mcp = (api as { mcp: unknown }).mcp
    if (typeof mcp !== 'object' || mcp === null) {
      throw new Error('expected an mcp object')
    }
    expect(Object.keys(mcp).sort()).toEqual(['getConfig'])
    const profiles = (api as { profiles: unknown }).profiles
    if (typeof profiles !== 'object' || profiles === null) {
      throw new Error('expected a profiles object')
    }
    expect(Object.keys(profiles).sort()).toEqual([
      'create',
      'delete',
      'load',
      'pickPrivateKey',
      'replacePrivateKey',
      'select',
      'setSidebarCollapsed',
      'update'
    ])
    const workspace = (api as { workspace: unknown }).workspace
    if (typeof workspace !== 'object' || workspace === null) {
      throw new Error('expected a workspace object')
    }
    expect(Object.keys(workspace).sort()).toEqual([
      'confirmClose',
      'onCloseRequested',
      'setCloseGuard'
    ])
  })

  it('drops ssh data that has no Connection Profile identity', async () => {
    const { ipcRenderer } = await import('electron')
    vi.mocked(ipcRenderer.on).mockClear()
    const bridges = await loadPreload()
    const api = bridges[0]?.value as {
      ssh: { onData: (handler: (id: string, chunk: Uint8Array, profileId: string) => void) => void }
    }
    const received: Array<{ sessionId: string; profileId: string }> = []
    api.ssh.onData((sessionId, _chunk, profileId) => {
      received.push({ sessionId, profileId })
    })
    const listener = vi
      .mocked(ipcRenderer.on)
      .mock.calls.find((call) => call[0] === 'ssh:data')?.[1]
    if (typeof listener !== 'function') {
      throw new Error('expected an ssh:data listener')
    }
    const deliver = listener as (event: unknown, payload: unknown) => void
    deliver({}, { sessionId: 's1', chunk: Uint8Array.from([1]) })
    deliver({}, { sessionId: 's1', profileId: 'p1', chunk: Uint8Array.from([1]) })
    expect(received).toEqual([{ sessionId: 's1', profileId: 'p1' }])
  })
})

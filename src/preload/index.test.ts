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
    expect(Object.keys(api)).toEqual(['ssh'])
    const ssh = (api as { ssh: unknown }).ssh
    if (typeof ssh !== 'object' || ssh === null) {
      throw new Error('expected an ssh object')
    }
    expect(Object.keys(ssh).sort()).toEqual([
      'cancel',
      'confirmHostKey',
      'connect',
      'disconnect',
      'onData',
      'onStatus',
      'pickPrivateKey',
      'resize',
      'write'
    ])
  })
})

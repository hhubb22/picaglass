import { contextBridge, ipcRenderer } from 'electron'
import type { RendererApi, SshStatusEvent } from '../shared/ssh'

const api: RendererApi = {
  ssh: {
    pickPrivateKey: () => ipcRenderer.invoke('ssh:pickPrivateKey'),
    connect: (req) => ipcRenderer.invoke('ssh:connect', req),
    confirmHostKey: (sessionId, action) =>
      ipcRenderer.invoke('ssh:confirmHostKey', sessionId, action),
    write: (sessionId, data) => {
      ipcRenderer.send('ssh:write', sessionId, data)
    },
    resize: (sessionId, cols, rows) => {
      ipcRenderer.send('ssh:resize', sessionId, cols, rows)
    },
    disconnect: (sessionId) => ipcRenderer.invoke('ssh:disconnect', sessionId),
    onData: (handler) => {
      const listener = (_event: unknown, payload: unknown): void => {
        if (typeof payload !== 'object' || payload === null) {
          return
        }
        if (!('sessionId' in payload) || !('chunk' in payload)) {
          return
        }
        const sessionId = payload.sessionId
        const chunk = payload.chunk
        if (typeof sessionId !== 'string' || !(chunk instanceof Uint8Array)) {
          return
        }
        handler(sessionId, chunk)
      }
      ipcRenderer.on('ssh:data', listener)
      return () => {
        ipcRenderer.removeListener('ssh:data', listener)
      }
    },
    onStatus: (handler) => {
      const listener = (_event: unknown, status: SshStatusEvent): void => {
        handler(status)
      }
      ipcRenderer.on('ssh:status', listener)
      return () => {
        ipcRenderer.removeListener('ssh:status', listener)
      }
    }
  }
}

if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled')
}

// Only the ssh methods cross the bridge. The toolkit's electronAPI would hand the page
// ipcRenderer on any channel, which is the hole this contract exists to close.
contextBridge.exposeInMainWorld('api', api)

import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
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
      const listener = (_event: unknown, sessionId: string, chunk: Uint8Array): void => {
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

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)

import { contextBridge, ipcRenderer } from 'electron'
import type { RendererApi, SshStatusEvent } from '../shared/ssh'
import type { CreateProfileInput, UpdateProfileInput } from '../shared/profile'

const api: RendererApi = {
  ssh: {
    pickPrivateKey: () => ipcRenderer.invoke('ssh:pickPrivateKey'),
    secretRequirement: (profileId) => ipcRenderer.invoke('ssh:secretRequirement', profileId),
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
    cancel: (profileId) => ipcRenderer.invoke('ssh:cancel', profileId),
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
        const profileId = 'profileId' in payload ? payload.profileId : undefined
        if (
          typeof sessionId !== 'string' ||
          !(chunk instanceof Uint8Array) ||
          typeof profileId !== 'string'
        ) {
          return
        }
        handler(sessionId, chunk, profileId)
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
  },
  profiles: {
    load: () => ipcRenderer.invoke('profiles:load'),
    create: (input: CreateProfileInput) => ipcRenderer.invoke('profiles:create', input),
    update: (input: UpdateProfileInput) => ipcRenderer.invoke('profiles:update', input),
    select: (profileId) => ipcRenderer.invoke('profiles:select', profileId),
    delete: (profileId) => ipcRenderer.invoke('profiles:delete', profileId),
    pickPrivateKey: () => ipcRenderer.invoke('profiles:pickPrivateKey'),
    replacePrivateKey: (profileId) => ipcRenderer.invoke('profiles:replacePrivateKey', profileId)
  },
  workspace: {
    onCloseRequested: (handler) => {
      const listener = (): void => {
        handler()
      }
      ipcRenderer.on('workspace:close-requested', listener)
      return () => {
        ipcRenderer.removeListener('workspace:close-requested', listener)
      }
    },
    confirmClose: () => ipcRenderer.invoke('workspace:confirmClose'),
    setCloseGuard: (blockClose) => ipcRenderer.invoke('workspace:setCloseGuard', blockClose)
  }
}

if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled')
}

// Only the ssh, profiles, and workspace methods cross the bridge. The toolkit's electronAPI
// would hand the page ipcRenderer on any channel, which is the hole this contract exists to close.
contextBridge.exposeInMainWorld('api', api)

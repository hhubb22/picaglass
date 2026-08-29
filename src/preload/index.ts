import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {}

if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled')
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)

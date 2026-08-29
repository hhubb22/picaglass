import type { ElectronAPI } from '@electron-toolkit/preload'

export type RendererApi = Record<string, never>

declare global {
  interface Window {
    electron: ElectronAPI
    api: RendererApi
  }
}

export {}

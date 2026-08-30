import type { RendererApi } from '../shared/ssh'

declare global {
  interface Window {
    api: RendererApi
  }
}

export {}

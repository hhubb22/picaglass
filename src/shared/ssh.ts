export type SshAuth =
  | { method: 'password'; password: string }
  | { method: 'privateKey'; keyRef: string; passphrase?: string }

export type SshConnectRequest = {
  profileId: string
  host: string
  port?: number
  username: string
  auth: SshAuth
  cols: number
  rows: number
  term?: string
}

export type SshConnectResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: 'host-unknown'; sessionId: string; fingerprint: string; algorithm: string }
  | { ok: false; reason: 'host-changed'; fingerprint: string; algorithm: string }
  | {
      ok: false
      reason: 'auth-failed' | 'network' | 'timeout' | 'invalid' | 'canceled'
      message: string
    }

/** Opaque Connection Profile identity the current single-form renderer uses until saved profiles exist. */
export const SINGLE_FORM_PROFILE_ID = 'single-form'

export type SshHostKeyAction = 'trust-always' | 'abort'

export type SshStatusEvent = {
  sessionId: string
  type: 'connected' | 'closed' | 'error'
  code?: number
  message?: string
}

export type SshKeyPick = { keyRef: string; label: string }

export type RendererApi = {
  ssh: {
    pickPrivateKey: () => Promise<SshKeyPick | null>
    connect: (req: SshConnectRequest) => Promise<SshConnectResult>
    confirmHostKey: (sessionId: string, action: SshHostKeyAction) => Promise<SshConnectResult>
    write: (sessionId: string, data: Uint8Array) => void
    resize: (sessionId: string, cols: number, rows: number) => void
    disconnect: (sessionId: string) => Promise<void>
    cancel: (profileId: string) => Promise<void>
    onData: (handler: (sessionId: string, chunk: Uint8Array) => void) => () => void
    onStatus: (handler: (event: SshStatusEvent) => void) => () => void
  }
}

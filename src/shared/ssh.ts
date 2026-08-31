import type {
  CreateProfileInput,
  CreateProfileResult,
  ProfileKeyPick,
  ProfileWorkspace,
  SelectProfileResult
} from './profile'

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

export type SshProfileConnectRequest = {
  profileId: string
  secret?: string
  cols: number
  rows: number
}

export type SshConnectResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: 'host-unknown'; sessionId: string; fingerprint: string; algorithm: string }
  | { ok: false; reason: 'host-changed'; fingerprint: string; algorithm: string }
  | { ok: false; reason: 'secret-required'; kind: 'password' | 'passphrase' }
  | {
      ok: false
      reason: 'auth-failed' | 'network' | 'timeout' | 'invalid' | 'canceled'
      message: string
    }

/** Occupancy key used by low-level session-manager tests that do not create a saved profile. */
export const SINGLE_FORM_PROFILE_ID = 'single-form'

export type SshSecretRequirement =
  | { ok: true; kind: 'password' | 'passphrase' | 'none' }
  | { ok: false; reason: 'unknown-profile' | 'cannot-read-key' }

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
    secretRequirement: (profileId: string) => Promise<SshSecretRequirement>
    connect: (req: SshProfileConnectRequest) => Promise<SshConnectResult>
    confirmHostKey: (sessionId: string, action: SshHostKeyAction) => Promise<SshConnectResult>
    write: (sessionId: string, data: Uint8Array) => void
    resize: (sessionId: string, cols: number, rows: number) => void
    disconnect: (sessionId: string) => Promise<void>
    cancel: (profileId: string) => Promise<void>
    onData: (handler: (sessionId: string, chunk: Uint8Array) => void) => () => void
    onStatus: (handler: (event: SshStatusEvent) => void) => () => void
  }
  profiles: {
    load: () => Promise<ProfileWorkspace>
    create: (input: CreateProfileInput) => Promise<CreateProfileResult>
    select: (profileId: string) => Promise<SelectProfileResult>
    pickPrivateKey: () => Promise<ProfileKeyPick | null>
  }
  workspace: {
    onCloseRequested: (handler: () => void) => () => void
    confirmClose: () => Promise<void>
    setCloseGuard: (blockClose: boolean) => Promise<void>
  }
}

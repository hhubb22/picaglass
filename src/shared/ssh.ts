import type { MachineSnapshot } from './machine-snapshot'
import type { DeviceFactsRun } from './picos/device-facts'
import type {
  CreateProfileInput,
  CreateProfileResult,
  DeleteProfileResult,
  ProfileKeyPick,
  ProfileWorkspace,
  ReplacePrivateKeyResult,
  SelectProfileResult,
  SetSidebarCollapsedResult,
  UpdateProfileInput,
  UpdateProfileResult
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

export type HostTrustState =
  | { status: 'not-remembered' }
  | { status: 'session'; algorithm: string; fingerprint: string }
  | { status: 'remembered'; algorithm: string; fingerprint: string }

export type ForgetHostKeyResult = { ok: true } | { ok: false; message: string }

export type SshConnectResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: 'host-unknown'; sessionId: string; fingerprint: string; algorithm: string }
  | {
      ok: false
      reason: 'host-changed'
      sessionId: string
      fingerprint: string
      algorithm: string
      previousFingerprint: string
      previousAlgorithm: string
    }
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

export const SSH_HOST_KEY_ACTIONS = ['trust-always', 'trust-once', 'replace', 'abort'] as const

export type SshHostKeyAction = (typeof SSH_HOST_KEY_ACTIONS)[number]

export type SshStatusEvent = {
  sessionId: string
  profileId?: string
  type: 'connected' | 'closed' | 'error'
  code?: number
  message?: string
}

export type MachineSnapshotEvent = {
  profileId: string
  snapshot: MachineSnapshot
}

export type SshKeyPick = { keyRef: string; label: string }

export type RendererApi = {
  ssh: {
    pickPrivateKey: () => Promise<SshKeyPick | null>
    secretRequirement: (profileId: string) => Promise<SshSecretRequirement>
    connect: (req: SshProfileConnectRequest) => Promise<SshConnectResult>
    confirmHostKey: (sessionId: string, action: SshHostKeyAction) => Promise<SshConnectResult>
    hostTrust: (host: string, port: number) => Promise<HostTrustState>
    forgetHostKey: (host: string, port: number) => Promise<ForgetHostKeyResult>
    write: (sessionId: string, data: Uint8Array) => void
    resize: (sessionId: string, cols: number, rows: number) => void
    disconnect: (sessionId: string) => Promise<void>
    cancel: (profileId: string) => Promise<void>
    disconnectAll: () => Promise<void>
    refreshDiscovery: (profileId: string) => Promise<void>
    onData: (
      handler: (sessionId: string, chunk: Uint8Array, profileId: string) => void
    ) => () => void
    onStatus: (handler: (event: SshStatusEvent) => void) => () => void
    onSnapshot: (handler: (event: MachineSnapshotEvent) => void) => () => void
  }
  diagnostics: {
    runDeviceFacts: (profileId: string) => Promise<DeviceFactsRun>
  }
  profiles: {
    load: () => Promise<ProfileWorkspace>
    create: (input: CreateProfileInput) => Promise<CreateProfileResult>
    update: (input: UpdateProfileInput) => Promise<UpdateProfileResult>
    select: (profileId: string) => Promise<SelectProfileResult>
    delete: (profileId: string) => Promise<DeleteProfileResult>
    pickPrivateKey: () => Promise<ProfileKeyPick | null>
    replacePrivateKey: (profileId: string) => Promise<ReplacePrivateKeyResult>
    setSidebarCollapsed: (collapsed: boolean) => Promise<SetSidebarCollapsedResult>
  }
  workspace: {
    onCloseRequested: (handler: (info: { activeCount: number }) => void) => () => void
    confirmClose: () => Promise<void>
    setCloseGuard: (blockClose: boolean) => Promise<void>
  }
}

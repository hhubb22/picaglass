import type { ConnectionAttemptSummary } from './connection-attempt'
import type { MachineSnapshot } from './machine-snapshot'

export type ProfileLabelSource = {
  displayName?: string
  username: string
  host: string
  port: number
}

const DEFAULT_SSH_PORT = 22

function isIPv6Host(host: string): boolean {
  return host.includes(':')
}

function formatHost(host: string): string {
  if (isIPv6Host(host)) {
    return `[${host}]`
  }
  return host
}

export function sortProfilesByLabel<T extends ProfileLabelSource>(profiles: readonly T[]): T[] {
  return [...profiles].sort((a, b) => profileLabel(a).localeCompare(profileLabel(b)))
}

export function profileLabel(profile: ProfileLabelSource): string {
  const displayName = profile.displayName?.trim()
  if (displayName !== undefined && displayName.length > 0) {
    return displayName
  }
  const destination = formatHost(profile.host)
  if (profile.port === DEFAULT_SSH_PORT) {
    return `${profile.username}@${destination}`
  }
  return `${profile.username}@${destination}:${profile.port}`
}

export type ProfileAuthDraft =
  | { method: 'password' }
  | { method: 'privateKey'; keyRef: string }
  | { method: 'privateKey'; keepExisting: true }
  | { method?: undefined }

export type ProfileDraftInput = {
  displayName?: string
  host: string
  port?: number | string
  username: string
  auth: ProfileAuthDraft
  automaticDiscovery?: boolean
}

export type ProfileFieldErrors = {
  host?: string
  port?: string
  username?: string
  auth?: string
}

export type ParsedProfileDraft = {
  displayName?: string
  host: string
  port: number
  username: string
  auth:
    | { method: 'password' }
    | { method: 'privateKey'; keyRef: string }
    | { method: 'privateKey'; keepExisting: true }
  automaticDiscovery: boolean
}

export type ParseProfileDraftResult =
  { ok: true; value: ParsedProfileDraft } | { ok: false; fields: ProfileFieldErrors }

function normalizeHost(host: string): string {
  const trimmed = host.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.length > 2) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parsePort(port: number | string | undefined): number | undefined {
  if (port === undefined || port === '') {
    return DEFAULT_SSH_PORT
  }
  if (typeof port === 'number') {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return undefined
    }
    return port
  }
  if (!/^[0-9]+$/.test(port)) {
    return undefined
  }
  const value = Number(port)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return undefined
  }
  return value
}

export function parseProfileDraft(input: ProfileDraftInput): ParseProfileDraftResult {
  const fields: ProfileFieldErrors = {}
  const host = normalizeHost(input.host)
  if (host.length === 0) {
    fields.host = 'Enter a host'
  } else if (host.includes('://') || host.includes('/')) {
    fields.host = 'Enter a host without a URL scheme or path'
  }

  const port = parsePort(input.port)
  if (port === undefined) {
    fields.port = 'Port must be 1..65535'
  }

  const username = input.username.trim()
  if (username.length === 0) {
    fields.username = 'Enter a username'
  }

  let auth: ParsedProfileDraft['auth'] | undefined
  if (input.auth.method === 'password') {
    auth = { method: 'password' }
  } else if (input.auth.method === 'privateKey') {
    if ('keepExisting' in input.auth && input.auth.keepExisting) {
      auth = { method: 'privateKey', keepExisting: true }
    } else if (!('keyRef' in input.auth) || input.auth.keyRef.trim().length === 0) {
      fields.auth = 'Choose a private-key file'
    } else {
      auth = { method: 'privateKey', keyRef: input.auth.keyRef }
    }
  } else {
    fields.auth = 'Choose an Authentication Method'
  }

  if (
    fields.host !== undefined ||
    fields.port !== undefined ||
    fields.username !== undefined ||
    fields.auth !== undefined
  ) {
    return { ok: false, fields }
  }
  if (port === undefined || auth === undefined) {
    return { ok: false, fields }
  }

  const value: ParsedProfileDraft = {
    host,
    port,
    username,
    auth,
    automaticDiscovery: input.automaticDiscovery !== false
  }
  const displayName = input.displayName?.trim()
  if (displayName !== undefined && displayName.length > 0) {
    value.displayName = displayName
  }
  return { ok: true, value }
}

export type ProfileDuplicateKey = {
  host: string
  port: number
  username: string
  authKey: string
}

export function findDuplicateProfile<T extends ProfileDuplicateKey & { label: string }>(
  existing: readonly T[],
  candidate: ProfileDuplicateKey
): { label: string } | undefined {
  const matches = existing.filter(
    (profile) =>
      profile.host === candidate.host &&
      profile.port === candidate.port &&
      profile.username === candidate.username &&
      profile.authKey === candidate.authKey
  )
  if (matches.length === 0) {
    return undefined
  }
  const [first] = [...matches].sort((a, b) => a.label.localeCompare(b.label))
  if (first === undefined) {
    return undefined
  }
  return { label: first.label }
}

export function resolveSelectedProfileId(
  lastSelectedProfileId: string | null,
  profiles: ReadonlyArray<{ id: string } & ProfileLabelSource>
): string | null {
  if (profiles.some((profile) => profile.id === lastSelectedProfileId)) {
    return lastSelectedProfileId
  }
  const [first] = sortProfilesByLabel(profiles)
  return first?.id ?? null
}

export type ProfileDraftForm = {
  displayName: string
  host: string
  port: string
  username: string
  authMethod: 'password' | 'privateKey' | null
  automaticDiscovery: boolean
}

export function isProfileDraftDirty(draft: ProfileDraftForm): boolean {
  return (
    draft.displayName !== '' ||
    draft.host !== '' ||
    draft.port !== '' ||
    draft.username !== '' ||
    draft.authMethod !== null ||
    draft.automaticDiscovery !== true
  )
}

export type ProfileConnectionIdentity = {
  host: string
  port: number
  username: string
  authKey: string
}

export type ProfileEditClearing = {
  clearSnapshot: boolean
  clearAttempt: boolean
}

export function profileEditClearing(
  previous: ProfileConnectionIdentity,
  next: ProfileConnectionIdentity
): ProfileEditClearing {
  if (previous.host !== next.host || previous.port !== next.port) {
    return { clearSnapshot: true, clearAttempt: true }
  }
  if (previous.username !== next.username || previous.authKey !== next.authKey) {
    return { clearSnapshot: false, clearAttempt: true }
  }
  return { clearSnapshot: false, clearAttempt: false }
}

export function nextSelectedProfileIdAfterDeletion<T extends { id: string } & ProfileLabelSource>(
  profiles: readonly T[],
  deletedId: string
): string | null {
  const sorted = sortProfilesByLabel(profiles)
  const index = sorted.findIndex((profile) => profile.id === deletedId)
  const remaining = sorted.filter((profile) => profile.id !== deletedId)
  if (remaining.length === 0) {
    return null
  }
  if (index < 0) {
    return remaining[0]?.id ?? null
  }
  return remaining[index]?.id ?? remaining[index - 1]?.id ?? null
}

export type DeleteProfileConfirmation = {
  title: string
  confirmLabel: string
  body: string
}

export function deleteProfileConfirmation(
  label: string,
  occupied: boolean
): DeleteProfileConfirmation {
  if (occupied) {
    return {
      title: `Disconnect and delete “${label}”?`,
      confirmLabel: 'Disconnect and delete',
      body: `This ends the SSH Session for “${label}” and removes the Connection Profile. Shared Trusted Host Keys are kept.`
    }
  }
  return {
    title: `Delete “${label}”?`,
    confirmLabel: 'Delete',
    body: `This removes the Connection Profile “${label}”. Shared Trusted Host Keys are kept.`
  }
}

export function draftFromProfile(profile: RendererProfile): ProfileDraftForm {
  return {
    displayName: profile.displayName ?? '',
    host: profile.host,
    port: String(profile.port),
    username: profile.username,
    authMethod: profile.auth.method,
    automaticDiscovery: profile.automaticDiscovery
  }
}

export function isProfileEditDirty(
  draft: ProfileDraftForm,
  original: RendererProfile,
  pickedNewKey: boolean
): boolean {
  if (pickedNewKey) {
    return true
  }
  const baseline = draftFromProfile(original)
  return (
    draft.displayName !== baseline.displayName ||
    draft.host !== baseline.host ||
    draft.port !== baseline.port ||
    draft.username !== baseline.username ||
    draft.authMethod !== baseline.authMethod ||
    draft.automaticDiscovery !== baseline.automaticDiscovery
  )
}

export type RendererProfileAuth = { method: 'password' } | { method: 'privateKey'; label: string }

export type RendererProfile = {
  id: string
  label: string
  displayName?: string
  host: string
  port: number
  username: string
  auth: RendererProfileAuth
  automaticDiscovery: boolean
  lastAttempt: ConnectionAttemptSummary | null
  snapshot?: MachineSnapshot | null
}

export type WorkspaceNotice =
  { kind: 'recovered-from-backup' } | { kind: 'write-failed'; message: string }

export type ProfileWorkspace = {
  profiles: RendererProfile[]
  selectedProfileId: string | null
  notice: WorkspaceNotice | null
}

export type CreateProfileInput = ProfileDraftInput & {
  saveAnyway?: boolean
}

export type CreateProfileResult =
  | { ok: true; workspace: ProfileWorkspace }
  | { ok: false; reason: 'duplicate'; existingLabel: string; workspace: ProfileWorkspace }
  | { ok: false; reason: 'invalid'; fields: ProfileFieldErrors; workspace: ProfileWorkspace }
  | { ok: false; reason: 'write-failed'; workspace: ProfileWorkspace }

export type SelectProfileResult =
  | { ok: true; workspace: ProfileWorkspace }
  | { ok: false; reason: 'unknown-profile'; workspace: ProfileWorkspace }
  | { ok: false; reason: 'write-failed'; workspace: ProfileWorkspace }

export type UpdateProfileInput = CreateProfileInput & {
  profileId: string
}

export type UpdateProfileResult =
  | { ok: true; workspace: ProfileWorkspace }
  | { ok: false; reason: 'duplicate'; existingLabel: string; workspace: ProfileWorkspace }
  | { ok: false; reason: 'invalid'; fields: ProfileFieldErrors; workspace: ProfileWorkspace }
  | { ok: false; reason: 'write-failed'; workspace: ProfileWorkspace }
  | { ok: false; reason: 'unknown-profile'; workspace: ProfileWorkspace }
  | { ok: false; reason: 'session-locked'; workspace: ProfileWorkspace }

export type DeleteProfileResult =
  | { ok: true; workspace: ProfileWorkspace }
  | { ok: false; reason: 'unknown-profile'; workspace: ProfileWorkspace }
  | { ok: false; reason: 'write-failed'; workspace: ProfileWorkspace }

export type ReplacePrivateKeyResult =
  | { ok: true; workspace: ProfileWorkspace }
  | {
      ok: false
      reason: 'canceled' | 'unknown-profile' | 'not-private-key' | 'write-failed'
      workspace: ProfileWorkspace
    }

export type ProfileKeyPick = { keyRef: string; label: string }

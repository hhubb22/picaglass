import { ipcMain } from 'electron'
import type {
  CreateProfileInput,
  CreateProfileResult,
  ProfileAuthDraft,
  ProfileFieldErrors,
  ProfileWorkspace,
  UpdateProfileInput
} from '../../shared/profile'
import type { ProfileApi } from './create-profile-api'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseAuth(value: unknown): ProfileAuthDraft | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  if (value.method === 'password') {
    return { method: 'password' }
  }
  if (value.method === 'privateKey' && value.keepExisting === true) {
    return { method: 'privateKey', keepExisting: true }
  }
  if (value.method === 'privateKey' && typeof value.keyRef === 'string') {
    return { method: 'privateKey', keyRef: value.keyRef }
  }
  if (value.method === undefined) {
    return { method: undefined }
  }
  return undefined
}

function parseCreateInput(value: unknown): CreateProfileInput | undefined {
  if (!isRecord(value) || typeof value.host !== 'string' || typeof value.username !== 'string') {
    return undefined
  }
  const auth = parseAuth(value.auth)
  if (auth === undefined) {
    return undefined
  }
  const input: CreateProfileInput = {
    host: value.host,
    username: value.username,
    auth
  }
  if (typeof value.displayName === 'string') {
    input.displayName = value.displayName
  }
  if (typeof value.port === 'number' || typeof value.port === 'string') {
    input.port = value.port
  }
  if (typeof value.automaticDiscovery === 'boolean') {
    input.automaticDiscovery = value.automaticDiscovery
  }
  if (value.saveAnyway === true) {
    input.saveAnyway = true
  }
  return input
}

function parseUpdateInput(value: unknown): UpdateProfileInput | undefined {
  if (!isRecord(value) || typeof value.profileId !== 'string') {
    return undefined
  }
  const draft = parseCreateInput(value)
  if (draft === undefined) {
    return undefined
  }
  return { ...draft, profileId: value.profileId }
}

function invalidCreate(workspace: ProfileWorkspace): Extract<CreateProfileResult, { ok: false }> {
  const fields: ProfileFieldErrors = { host: 'Enter a host' }
  return { ok: false, reason: 'invalid', fields, workspace }
}

export function registerProfileIpc(api: ProfileApi): void {
  ipcMain.handle('profiles:load', () => api.load())
  ipcMain.handle('profiles:create', (_event, input: unknown) => {
    const parsed = parseCreateInput(input)
    if (parsed === undefined) {
      return api.load().then((workspace) => invalidCreate(workspace))
    }
    return api.create(parsed)
  })
  ipcMain.handle('profiles:update', (_event, input: unknown) => {
    const parsed = parseUpdateInput(input)
    if (parsed === undefined) {
      return api.load().then((workspace) => ({
        ok: false as const,
        reason: 'unknown-profile' as const,
        workspace
      }))
    }
    return api.update(parsed)
  })
  ipcMain.handle('profiles:select', (_event, profileId: unknown) => {
    if (typeof profileId !== 'string') {
      return api.load().then((workspace) => ({
        ok: false as const,
        reason: 'unknown-profile' as const,
        workspace
      }))
    }
    return api.select(profileId)
  })
  ipcMain.handle('profiles:delete', (_event, profileId: unknown) => {
    if (typeof profileId !== 'string') {
      return api.load().then((workspace) => ({
        ok: false as const,
        reason: 'unknown-profile' as const,
        workspace
      }))
    }
    return api.delete(profileId)
  })
  ipcMain.handle('profiles:pickPrivateKey', () => api.pickPrivateKey())
  ipcMain.handle('profiles:replacePrivateKey', (_event, profileId: unknown) => {
    if (typeof profileId !== 'string') {
      return api.load().then((workspace) => ({
        ok: false as const,
        reason: 'unknown-profile' as const,
        workspace
      }))
    }
    return api.replacePrivateKey(profileId)
  })
  ipcMain.handle('profiles:setSidebarCollapsed', (_event, collapsed: unknown) => {
    if (typeof collapsed !== 'boolean') {
      return api.load().then((workspace) => ({ ok: true as const, workspace }))
    }
    return api.setSidebarCollapsed(collapsed)
  })
}

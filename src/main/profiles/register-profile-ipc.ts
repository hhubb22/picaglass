import { ipcMain } from 'electron'
import type {
  CreateProfileInput,
  CreateProfileResult,
  ProfileAuthDraft,
  ProfileFieldErrors,
  ProfileWorkspace
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
  ipcMain.handle('profiles:pickPrivateKey', () => api.pickPrivateKey())
}

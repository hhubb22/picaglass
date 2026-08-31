import { randomUUID } from 'node:crypto'
import { chmod, copyFile, mkdir, open, readFile, rename } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import {
  findDuplicateProfile,
  parseProfileDraft,
  profileLabel,
  resolveSelectedProfileId,
  sortProfilesByLabel,
  type CreateProfileInput,
  type CreateProfileResult,
  type ParsedProfileDraft,
  type ProfileDuplicateKey,
  type ProfileKeyPick,
  type ProfileWorkspace,
  type RendererProfile,
  type SelectProfileResult,
  type WorkspaceNotice
} from '../../shared/profile'

export type ProfileDialogs = {
  showOpenDialog: (options: {
    title?: string
    defaultPath?: string
    properties?: Array<'openFile'>
  }) => Promise<{ canceled: boolean; filePaths: string[] }>
}

export type CreateProfileApiDeps = {
  userDataPath: string
  dialogs?: ProfileDialogs
}

export type ProfileConnectTarget = {
  id: string
  host: string
  port: number
  username: string
  auth: StoredAuth
}

export type ProfileApi = {
  load: () => Promise<ProfileWorkspace>
  create: (input: CreateProfileInput) => Promise<CreateProfileResult>
  select: (profileId: string) => Promise<SelectProfileResult>
  pickPrivateKey: () => Promise<ProfileKeyPick | null>
  getConnectTarget: (profileId: string) => Promise<ProfileConnectTarget | undefined>
}

const SCHEMA_VERSION = 1
const DIR_MODE = 0o700
const FILE_MODE = 0o600

type StoredAuth = { method: 'password' } | { method: 'privateKey'; filePath: string }

type StoredProfile = {
  id: string
  displayName?: string
  host: string
  port: number
  username: string
  auth: StoredAuth
  automaticDiscovery: boolean
}

type StoredDocument = {
  version: number
  profiles: StoredProfile[]
  latestSnapshots: Record<string, unknown>
  latestAttempts: Record<string, unknown>
  lastSelectedProfileId: string | null
  sidebarCollapsed: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
}

function workspaceDir(userDataPath: string): string {
  return join(userDataPath, 'workspace')
}

function primaryPath(userDataPath: string): string {
  return join(workspaceDir(userDataPath), 'workspace.json')
}

function backupPath(userDataPath: string): string {
  return join(workspaceDir(userDataPath), 'workspace.json.bak')
}

function tmpPath(userDataPath: string): string {
  return join(workspaceDir(userDataPath), 'workspace.json.tmp')
}

function emptyDocument(): StoredDocument {
  return {
    version: SCHEMA_VERSION,
    profiles: [],
    latestSnapshots: {},
    latestAttempts: {},
    lastSelectedProfileId: null,
    sidebarCollapsed: false
  }
}

function parseStoredAuth(value: unknown): StoredAuth | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  if (value.method === 'password') {
    return { method: 'password' }
  }
  if (
    value.method === 'privateKey' &&
    typeof value.filePath === 'string' &&
    value.filePath.length > 0
  ) {
    return { method: 'privateKey', filePath: value.filePath }
  }
  return undefined
}

function parseStoredProfile(value: unknown): StoredProfile | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0) {
    return undefined
  }
  if (typeof value.host !== 'string' || typeof value.username !== 'string') {
    return undefined
  }
  if (typeof value.port !== 'number' || typeof value.automaticDiscovery !== 'boolean') {
    return undefined
  }
  const auth = parseStoredAuth(value.auth)
  if (auth === undefined) {
    return undefined
  }
  const profile: StoredProfile = {
    id: value.id,
    host: value.host,
    port: value.port,
    username: value.username,
    auth,
    automaticDiscovery: value.automaticDiscovery
  }
  if (typeof value.displayName === 'string') {
    profile.displayName = value.displayName
  }
  return profile
}

function parseDocument(text: string): StoredDocument | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(raw) || raw.version !== SCHEMA_VERSION) {
    return undefined
  }
  if (!Array.isArray(raw.profiles)) {
    return undefined
  }
  const profiles: StoredProfile[] = []
  for (const entry of raw.profiles) {
    const profile = parseStoredProfile(entry)
    if (profile === undefined) {
      return undefined
    }
    profiles.push(profile)
  }
  const latestSnapshots = isRecord(raw.latestSnapshots) ? { ...raw.latestSnapshots } : {}
  const latestAttempts = isRecord(raw.latestAttempts) ? { ...raw.latestAttempts } : {}
  const lastSelectedProfileId =
    typeof raw.lastSelectedProfileId === 'string' || raw.lastSelectedProfileId === null
      ? raw.lastSelectedProfileId
      : null
  const sidebarCollapsed = raw.sidebarCollapsed === true
  return {
    version: SCHEMA_VERSION,
    profiles,
    latestSnapshots,
    latestAttempts,
    lastSelectedProfileId,
    sidebarCollapsed
  }
}

async function readDocumentFile(path: string): Promise<StoredDocument | undefined> {
  try {
    const text = await readFile(path, 'utf8')
    return parseDocument(text)
  } catch (err) {
    if (isEnoent(err)) {
      return undefined
    }
    return undefined
  }
}

async function fsyncFile(path: string): Promise<void> {
  const handle = await open(path, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function writeDocument(userDataPath: string, document: StoredDocument): Promise<void> {
  // Temp → fsync → copy a readable primary to the last-valid backup → atomic rename.
  // An unreadable primary is replaced, never copied over the backup.
  const dir = workspaceDir(userDataPath)
  await mkdir(dir, { recursive: true, mode: DIR_MODE })
  await chmod(dir, DIR_MODE)
  const tmp = tmpPath(userDataPath)
  const primary = primaryPath(userDataPath)
  const backup = backupPath(userDataPath)
  const payload = `${JSON.stringify(document, null, 2)}\n`
  const handle = await open(tmp, 'w', FILE_MODE)
  try {
    await handle.writeFile(payload, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await chmod(tmp, FILE_MODE)
  const readablePrimary = await readDocumentFile(primary)
  if (readablePrimary !== undefined) {
    await copyFile(primary, backup)
    await chmod(backup, FILE_MODE)
    await fsyncFile(backup)
  }
  await rename(tmp, primary)
}

function authKey(auth: StoredAuth): string {
  if (auth.method === 'password') {
    return 'password'
  }
  return `privateKey:${auth.filePath}`
}

function toRenderer(profile: StoredProfile): RendererProfile {
  // Full private-key paths stay in the main-process document. The renderer only gets a label.
  const projected: RendererProfile = {
    id: profile.id,
    label: profileLabel(profile),
    host: profile.host,
    port: profile.port,
    username: profile.username,
    auth:
      profile.auth.method === 'password'
        ? { method: 'password' }
        : { method: 'privateKey', label: basename(profile.auth.filePath) },
    automaticDiscovery: profile.automaticDiscovery
  }
  if (profile.displayName !== undefined) {
    projected.displayName = profile.displayName
  }
  return projected
}

function project(document: StoredDocument, notice: WorkspaceNotice | null): ProfileWorkspace {
  const sorted = sortProfilesByLabel(document.profiles)
  return {
    profiles: sorted.map(toRenderer),
    selectedProfileId: resolveSelectedProfileId(document.lastSelectedProfileId, document.profiles),
    notice
  }
}

function cloneDocument(document: StoredDocument): StoredDocument {
  return {
    version: document.version,
    profiles: document.profiles.map((profile) => ({ ...profile, auth: { ...profile.auth } })),
    latestSnapshots: { ...document.latestSnapshots },
    latestAttempts: { ...document.latestAttempts },
    lastSelectedProfileId: document.lastSelectedProfileId,
    sidebarCollapsed: document.sidebarCollapsed
  }
}

function storedDuplicate(profile: StoredProfile): ProfileDuplicateKey & { label: string } {
  return {
    label: profileLabel(profile),
    host: profile.host,
    port: profile.port,
    username: profile.username,
    authKey: authKey(profile.auth)
  }
}

function storedAuthFromDraft(
  draft: ParsedProfileDraft,
  keyFiles: Map<string, string>
): StoredAuth | undefined {
  if (draft.auth.method === 'password') {
    return { method: 'password' }
  }
  const filePath = keyFiles.get(draft.auth.keyRef)
  if (filePath === undefined) {
    return undefined
  }
  return { method: 'privateKey', filePath }
}

export function createProfileApi(deps: CreateProfileApiDeps): ProfileApi {
  const keyFiles = new Map<string, string>()
  let document: StoredDocument | undefined
  let notice: WorkspaceNotice | null = null

  async function ensureLoaded(): Promise<StoredDocument> {
    if (document !== undefined) {
      return document
    }
    const primary = await readDocumentFile(primaryPath(deps.userDataPath))
    if (primary !== undefined) {
      document = primary
      return document
    }
    const backup = await readDocumentFile(backupPath(deps.userDataPath))
    if (backup !== undefined) {
      document = backup
      notice = { kind: 'recovered-from-backup' }
      return document
    }
    document = emptyDocument()
    return document
  }

  function workspace(): ProfileWorkspace {
    return project(document ?? emptyDocument(), notice)
  }

  async function commit(next: StoredDocument): Promise<boolean> {
    try {
      await writeDocument(deps.userDataPath, next)
    } catch {
      notice = { kind: 'write-failed', message: 'The workspace document could not be written.' }
      return false
    }
    if (notice?.kind === 'write-failed') {
      notice = null
    }
    document = next
    return true
  }

  return {
    async load() {
      await ensureLoaded()
      return workspace()
    },

    async create(input) {
      await ensureLoaded()
      const current = workspace()
      const parsed = parseProfileDraft(input)
      if (!parsed.ok) {
        return { ok: false, reason: 'invalid', fields: parsed.fields, workspace: current }
      }
      const storedAuth = storedAuthFromDraft(parsed.value, keyFiles)
      if (storedAuth === undefined) {
        return {
          ok: false,
          reason: 'invalid',
          fields: { auth: 'Choose a private-key file' },
          workspace: current
        }
      }
      const duplicate = findDuplicateProfile(
        (document ?? emptyDocument()).profiles.map(storedDuplicate),
        {
          host: parsed.value.host,
          port: parsed.value.port,
          username: parsed.value.username,
          authKey: authKey(storedAuth)
        }
      )
      if (duplicate !== undefined && input.saveAnyway !== true) {
        return {
          ok: false,
          reason: 'duplicate',
          existingLabel: duplicate.label,
          workspace: current
        }
      }
      const next = cloneDocument(document ?? emptyDocument())
      const profile: StoredProfile = {
        id: randomUUID(),
        host: parsed.value.host,
        port: parsed.value.port,
        username: parsed.value.username,
        auth: storedAuth,
        automaticDiscovery: parsed.value.automaticDiscovery
      }
      if (parsed.value.displayName !== undefined) {
        profile.displayName = parsed.value.displayName
      }
      next.profiles.push(profile)
      next.lastSelectedProfileId = profile.id
      const written = await commit(next)
      if (!written) {
        return { ok: false, reason: 'write-failed', workspace: workspace() }
      }
      return { ok: true, workspace: workspace() }
    },

    async select(profileId) {
      await ensureLoaded()
      const current = workspace()
      const exists = (document ?? emptyDocument()).profiles.some(
        (profile) => profile.id === profileId
      )
      if (!exists) {
        return { ok: false, reason: 'unknown-profile', workspace: current }
      }
      const next = cloneDocument(document ?? emptyDocument())
      next.lastSelectedProfileId = profileId
      const written = await commit(next)
      if (!written) {
        return { ok: false, reason: 'write-failed', workspace: workspace() }
      }
      return { ok: true, workspace: workspace() }
    },

    async getConnectTarget(profileId) {
      await ensureLoaded()
      const profile = (document ?? emptyDocument()).profiles.find((entry) => entry.id === profileId)
      if (profile === undefined) {
        return undefined
      }
      return {
        id: profile.id,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        auth: { ...profile.auth }
      }
    },

    async pickPrivateKey() {
      const dialogs = deps.dialogs
      if (dialogs === undefined) {
        return null
      }
      const result = await dialogs.showOpenDialog({
        title: 'Choose a private-key file',
        defaultPath: join(homedir(), '.ssh'),
        properties: ['openFile']
      })
      const filePath = result.filePaths[0]
      if (result.canceled || filePath === undefined) {
        return null
      }
      const keyRef = randomUUID()
      keyFiles.set(keyRef, filePath)
      return { keyRef, label: basename(filePath) }
    }
  }
}

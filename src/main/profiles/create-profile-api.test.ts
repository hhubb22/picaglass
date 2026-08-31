import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProfileApi, type ProfileApi } from './create-profile-api'

const WORKSPACE_DIR = 'workspace'
const PRIMARY = join(WORKSPACE_DIR, 'workspace.json')
const BACKUP = join(WORKSPACE_DIR, 'workspace.json.bak')

const SEEDED_ATTEMPT = {
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: '2026-01-01T00:01:00.000Z',
  outcome: 'remote-session-ended' as const
}

const SEEDED_CANCELED = {
  startedAt: '2026-01-01T00:02:00.000Z',
  endedAt: '2026-01-01T00:02:01.000Z',
  outcome: 'canceled' as const
}

function passwordDraft(overrides?: {
  displayName?: string
  host?: string
  port?: number
  username?: string
  saveAnyway?: boolean
}): {
  displayName?: string
  host: string
  username: string
  port?: number
  auth: { method: 'password' }
  saveAnyway?: boolean
} {
  const draft: {
    displayName?: string
    host: string
    username: string
    port?: number
    auth: { method: 'password' }
    saveAnyway?: boolean
  } = {
    host: overrides?.host ?? '10.0.4.7',
    username: overrides?.username ?? 'deploy',
    auth: { method: 'password' }
  }
  if (overrides?.displayName !== undefined) {
    draft.displayName = overrides.displayName
  }
  if (overrides?.port !== undefined) {
    draft.port = overrides.port
  }
  if (overrides?.saveAnyway !== undefined) {
    draft.saveAnyway = overrides.saveAnyway
  }
  return draft
}

describe('createProfileApi', () => {
  let userDataPath: string | undefined
  let api: ProfileApi | undefined

  afterEach(async () => {
    api = undefined
    if (userDataPath !== undefined) {
      await chmod(join(userDataPath, WORKSPACE_DIR), 0o700).catch(() => undefined)
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = undefined
    }
  })

  async function tempUserData(): Promise<string> {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-profiles-'))
    return userDataPath
  }

  it('loads an empty workspace on first launch', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })

    await expect(api.load()).resolves.toEqual({
      profiles: [],
      selectedProfileId: null,
      sidebarCollapsed: false,
      notice: null
    })
  })

  it('persists a created profile across a relaunch, listed by Profile Label', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })

    const created = await api.create(passwordDraft({ displayName: 'zeta' }))
    expect(created.ok).toBe(true)
    if (!created.ok) {
      throw new Error('expected create to succeed')
    }
    const second = await api.create(passwordDraft({ host: 'alpha.test', username: 'alice' }))
    expect(second.ok).toBe(true)
    if (!second.ok) {
      throw new Error('expected second create to succeed')
    }

    api = createProfileApi({ userDataPath: dir })
    const reloaded = await api.load()

    expect(reloaded.notice).toBe(null)
    expect(reloaded.profiles.map((profile) => profile.label)).toEqual(['alice@alpha.test', 'zeta'])
    expect(reloaded.selectedProfileId).toBe(second.workspace.selectedProfileId)
    expect(reloaded.profiles[0]).toMatchObject({
      host: 'alpha.test',
      port: 22,
      username: 'alice',
      auth: { method: 'password' },
      automaticDiscovery: true
    })
  })

  it('restores last-selected after relaunch, else the first alphabetical profile', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const zeta = await api.create(passwordDraft({ displayName: 'zeta' }))
    const alpha = await api.create(passwordDraft({ host: 'alpha.test', username: 'alice' }))
    expect(zeta.ok && alpha.ok).toBe(true)
    if (!zeta.ok || !alpha.ok) {
      throw new Error('expected creates to succeed')
    }
    const selected = await api.select(zeta.workspace.selectedProfileId as string)
    expect(selected.ok).toBe(true)

    api = createProfileApi({ userDataPath: dir })
    const reloaded = await api.load()
    expect(reloaded.selectedProfileId).toBe(zeta.workspace.selectedProfileId)

    const primary = join(dir, PRIMARY)
    const raw = JSON.parse(await readFile(primary, 'utf8')) as {
      lastSelectedProfileId: string
    }
    raw.lastSelectedProfileId = 'missing-id'
    await writeFile(primary, `${JSON.stringify(raw, null, 2)}\n`)

    api = createProfileApi({ userDataPath: dir })
    const fallback = await api.load()
    expect(fallback.profiles.map((profile) => profile.label)).toEqual(['alice@alpha.test', 'zeta'])
    expect(fallback.selectedProfileId).toBe(alpha.workspace.selectedProfileId)
  })

  it('rejects invalid fields without writing a document', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const result = await api.create({
      host: '',
      username: '',
      auth: { method: undefined }
    })
    expect(result).toMatchObject({
      ok: false,
      reason: 'invalid',
      fields: {
        host: 'Enter a host',
        username: 'Enter a username',
        auth: 'Choose an Authentication Method'
      }
    })
    await expect(readFile(join(dir, PRIMARY), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('warns on an exact duplicate and requires Save Anyway, copying configuration only', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const first = await api.create(passwordDraft({ displayName: 'prod db' }))
    expect(first.ok).toBe(true)
    if (!first.ok) {
      throw new Error('expected create to succeed')
    }
    const primary = join(dir, PRIMARY)
    const seeded = JSON.parse(await readFile(primary, 'utf8')) as {
      latestSnapshots: Record<string, unknown>
      latestAttempts: Record<string, unknown>
    }
    const originalId = first.workspace.selectedProfileId
    if (originalId === null) {
      throw new Error('expected a selected profile')
    }
    seeded.latestSnapshots[originalId] = { hostname: 'db' }
    seeded.latestAttempts[originalId] = SEEDED_ATTEMPT
    await writeFile(primary, `${JSON.stringify(seeded, null, 2)}\n`)

    api = createProfileApi({ userDataPath: dir })
    const blocked = await api.create(passwordDraft())
    expect(blocked).toMatchObject({
      ok: false,
      reason: 'duplicate',
      existingLabel: 'prod db'
    })
    if (blocked.ok || blocked.reason !== 'duplicate') {
      throw new Error('expected a duplicate warning')
    }
    expect(blocked.workspace.profiles).toHaveLength(1)

    const saved = await api.create(passwordDraft({ saveAnyway: true }))
    expect(saved.ok).toBe(true)
    if (!saved.ok) {
      throw new Error('expected Save Anyway to succeed')
    }
    expect(saved.workspace.profiles).toHaveLength(2)

    const document = JSON.parse(await readFile(primary, 'utf8')) as {
      profiles: Array<{ id: string }>
      latestSnapshots: Record<string, unknown>
      latestAttempts: Record<string, unknown>
    }
    const duplicateId = saved.workspace.selectedProfileId
    if (duplicateId === null) {
      throw new Error('expected the duplicate to be selected')
    }
    expect(document.latestSnapshots[originalId]).toEqual({ hostname: 'db' })
    expect(document.latestAttempts[originalId]).toEqual(SEEDED_ATTEMPT)
    expect(document.latestSnapshots[duplicateId]).toBeUndefined()
    expect(document.latestAttempts[duplicateId]).toBeUndefined()
  })

  it('never returns a private-key path to the caller and stores it only in the document', async () => {
    const dir = await tempUserData()
    const keyPath = join(dir, 'id_ed25519')
    await writeFile(keyPath, 'not-a-real-key')
    api = createProfileApi({
      userDataPath: dir,
      dialogs: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [keyPath] })
      }
    })
    const picked = await api.pickPrivateKey()
    expect(picked).toEqual({ keyRef: expect.any(String), label: 'id_ed25519' })
    if (picked === null) {
      throw new Error('expected a key pick')
    }
    expect(JSON.stringify(picked)).not.toContain(keyPath)

    const created = await api.create({
      host: '10.0.4.7',
      username: 'deploy',
      auth: { method: 'privateKey', keyRef: picked.keyRef }
    })
    expect(created.ok).toBe(true)
    if (!created.ok) {
      throw new Error('expected create to succeed')
    }
    expect(JSON.stringify(created.workspace)).not.toContain(keyPath)
    expect(created.workspace.profiles[0]?.auth).toEqual({
      method: 'privateKey',
      label: 'id_ed25519'
    })
    expect(await readFile(join(dir, PRIMARY), 'utf8')).toContain(keyPath)
  })

  it('rejects a private-key profile whose key ref is unknown', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const result = await api.create({
      host: '10.0.4.7',
      username: 'deploy',
      auth: { method: 'privateKey', keyRef: 'missing' }
    })
    expect(result).toMatchObject({
      ok: false,
      reason: 'invalid',
      fields: { auth: 'Choose a private-key file' }
    })
    await expect(readFile(join(dir, PRIMARY), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('restores the last-valid backup when the primary document is unreadable', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const first = await api.create(passwordDraft({ displayName: 'kept' }))
    expect(first.ok).toBe(true)
    const second = await api.create(passwordDraft({ displayName: 'newer', host: 'new.test' }))
    expect(second.ok).toBe(true)

    await writeFile(join(dir, PRIMARY), '{not-json')
    api = createProfileApi({ userDataPath: dir })
    const recovered = await api.load()
    expect(recovered.notice).toEqual({ kind: 'recovered-from-backup' })
    expect(recovered.profiles.map((profile) => profile.label)).toEqual(['kept'])
  })

  it('does not replace the last-valid backup with an unreadable primary on the next write', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    expect((await api.create(passwordDraft({ displayName: 'kept' }))).ok).toBe(true)
    expect((await api.create(passwordDraft({ displayName: 'newer', host: 'new.test' }))).ok).toBe(
      true
    )

    await writeFile(join(dir, PRIMARY), '{not-json')
    api = createProfileApi({ userDataPath: dir })
    const recovered = await api.load()
    expect(recovered.notice).toEqual({ kind: 'recovered-from-backup' })

    const written = await api.create(passwordDraft({ displayName: 'after', host: 'after.test' }))
    expect(written.ok).toBe(true)
    const backup = JSON.parse(await readFile(join(dir, BACKUP), 'utf8')) as {
      profiles: Array<{ displayName?: string }>
    }
    expect(backup.profiles.map((profile) => profile.displayName)).toEqual(['kept'])
    const primary = JSON.parse(await readFile(join(dir, PRIMARY), 'utf8')) as {
      profiles: Array<{ displayName?: string }>
    }
    expect(primary.profiles.map((profile) => profile.displayName).sort()).toEqual(['after', 'kept'])
  })

  it('loads an empty workspace without a recovery warning when no backup can be restored', async () => {
    const dir = await tempUserData()
    await mkdir(join(dir, WORKSPACE_DIR), { recursive: true })
    await writeFile(join(dir, PRIMARY), '{not-json')
    api = createProfileApi({ userDataPath: dir })
    await expect(api.load()).resolves.toEqual({
      profiles: [],
      selectedProfileId: null,
      sidebarCollapsed: false,
      notice: null
    })
  })

  it('rejects a failed write, keeps the last durable state, and never presents the mutation as saved', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const first = await api.create(passwordDraft({ displayName: 'kept' }))
    expect(first.ok).toBe(true)
    if (!first.ok) {
      throw new Error('expected create to succeed')
    }

    await mkdir(join(dir, WORKSPACE_DIR, 'workspace.json.tmp'))
    // Occupying the temp-file name makes the atomic write fail before replacing the primary.
    const failed = await api.create(passwordDraft({ displayName: 'lost', host: 'lost.test' }))
    expect(failed.ok).toBe(false)
    if (failed.ok || failed.reason !== 'write-failed') {
      throw new Error('expected write-failed')
    }
    expect(failed.workspace.profiles.map((profile) => profile.label)).toEqual(['kept'])
    expect(failed.workspace.notice?.kind).toBe('write-failed')
    expect(failed.workspace.selectedProfileId).toBe(first.workspace.selectedProfileId)

    await rm(join(dir, WORKSPACE_DIR, 'workspace.json.tmp'), { recursive: true, force: true })
    api = createProfileApi({ userDataPath: dir })
    const reloaded = await api.load()
    expect(reloaded.profiles.map((profile) => profile.label)).toEqual(['kept'])
    expect(reloaded.notice).toBe(null)
  })

  it('writes the workspace directory and files with restrictive permissions', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const created = await api.create(passwordDraft())
    expect(created.ok).toBe(true)

    const workspace = await stat(join(dir, WORKSPACE_DIR))
    const primary = await stat(join(dir, PRIMARY))
    expect(workspace.mode & 0o777).toBe(0o700)
    expect(primary.mode & 0o777).toBe(0o600)

    await api.create(passwordDraft({ displayName: 'second', host: 'second.test' }))
    const backup = await stat(join(dir, BACKUP))
    expect(backup.mode & 0o777).toBe(0o600)
  })

  it('treats an unknown schema version as unreadable and restores the backup', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const created = await api.create(passwordDraft({ displayName: 'v1' }))
    expect(created.ok).toBe(true)

    const primary = join(dir, PRIMARY)
    const v1 = await readFile(primary, 'utf8')
    await writeFile(join(dir, BACKUP), v1)
    const next = JSON.parse(v1) as { version: number }
    next.version = 99
    await writeFile(primary, `${JSON.stringify(next, null, 2)}\n`)

    api = createProfileApi({ userDataPath: dir })
    const recovered = await api.load()
    expect(recovered.notice).toEqual({ kind: 'recovered-from-backup' })
    expect(recovered.profiles.map((profile) => profile.label)).toEqual(['v1'])
  })

  it('records snapshot, attempt, selection, and sidebar slots in the versioned document', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const created = await api.create(passwordDraft())
    expect(created.ok).toBe(true)
    const document = JSON.parse(await readFile(join(dir, PRIMARY), 'utf8')) as Record<
      string,
      unknown
    >
    expect(document.version).toBe(1)
    expect(document.latestSnapshots).toEqual({})
    expect(document.latestAttempts).toEqual({})
    expect(document.lastSelectedProfileId).toEqual(
      created.ok ? created.workspace.selectedProfileId : null
    )
    expect(document.sidebarCollapsed).toBe(false)
  })

  it('persists sidebar collapsed state across relaunch', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const collapsed = await api.setSidebarCollapsed(true)
    expect(collapsed.ok).toBe(true)
    if (!collapsed.ok) {
      throw new Error('expected setSidebarCollapsed to succeed')
    }
    expect(collapsed.workspace.sidebarCollapsed).toBe(true)

    api = createProfileApi({ userDataPath: dir })
    const reloaded = await api.load()
    expect(reloaded.sidebarCollapsed).toBe(true)

    const expanded = await api.setSidebarCollapsed(false)
    expect(expanded.ok).toBe(true)
    if (!expanded.ok) {
      throw new Error('expected expand to succeed')
    }
    expect(expanded.workspace.sidebarCollapsed).toBe(false)
  })

  it('rejects a failed sidebar collapse write and keeps the last durable collapsed state', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const created = await api.create(passwordDraft())
    expect(created.ok).toBe(true)

    await mkdir(join(dir, WORKSPACE_DIR, 'workspace.json.tmp'))
    const failed = await api.setSidebarCollapsed(true)
    expect(failed.ok).toBe(false)
    if (failed.ok || failed.reason !== 'write-failed') {
      throw new Error('expected write-failed')
    }
    expect(failed.workspace.sidebarCollapsed).toBe(false)
    expect(failed.workspace.notice?.kind).toBe('write-failed')
  })
})

describe('createProfileApi update, delete, and replacePrivateKey', () => {
  let userDataPath: string | undefined
  let api: ProfileApi | undefined

  afterEach(async () => {
    api = undefined
    if (userDataPath !== undefined) {
      await chmod(join(userDataPath, WORKSPACE_DIR), 0o700).catch(() => undefined)
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = undefined
    }
  })

  async function tempUserData(): Promise<string> {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-profiles-edit-'))
    return userDataPath
  }

  async function seedFacts(
    dir: string,
    profileId: string,
    snapshot: unknown,
    attempt: unknown
  ): Promise<void> {
    const primary = join(dir, PRIMARY)
    const raw = JSON.parse(await readFile(primary, 'utf8')) as {
      latestSnapshots: Record<string, unknown>
      latestAttempts: Record<string, unknown>
    }
    raw.latestSnapshots[profileId] = snapshot
    raw.latestAttempts[profileId] = attempt
    await writeFile(primary, `${JSON.stringify(raw, null, 2)}\n`)
  }

  async function readDocument(dir: string): Promise<{
    profiles: Array<{
      id: string
      host: string
      port: number
      username: string
      auth: { method: string; filePath?: string }
      displayName?: string
      automaticDiscovery: boolean
    }>
    latestSnapshots: Record<string, unknown>
    latestAttempts: Record<string, unknown>
    lastSelectedProfileId: string | null
  }> {
    return JSON.parse(await readFile(join(dir, PRIMARY), 'utf8')) as Awaited<
      ReturnType<typeof readDocument>
    >
  }

  it('clears snapshot and latest Connection Attempt in the persisted document when host changes', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const created = await api.create(passwordDraft({ displayName: 'prod db' }))
    expect(created.ok).toBe(true)
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected create to succeed')
    }
    const profileId = created.workspace.selectedProfileId
    await seedFacts(dir, profileId, { hostname: 'db' }, SEEDED_ATTEMPT)
    api = createProfileApi({ userDataPath: dir })

    const updated = await api.update({
      profileId,
      host: 'other.test',
      username: 'deploy',
      auth: { method: 'password' },
      displayName: 'prod db'
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) {
      throw new Error('expected update to succeed')
    }
    expect(updated.workspace.profiles[0]).toMatchObject({
      host: 'other.test',
      label: 'prod db'
    })
    const document = await readDocument(dir)
    expect(document.latestSnapshots[profileId]).toBeUndefined()
    expect(document.latestAttempts[profileId]).toBeUndefined()
    expect(document.profiles[0]?.host).toBe('other.test')
  })

  it('clears snapshot and latest Connection Attempt in the persisted document when port changes', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const created = await api.create(passwordDraft({ displayName: 'prod db' }))
    expect(created.ok).toBe(true)
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected create to succeed')
    }
    const profileId = created.workspace.selectedProfileId
    await seedFacts(dir, profileId, { hostname: 'db' }, SEEDED_ATTEMPT)
    api = createProfileApi({ userDataPath: dir })

    const updated = await api.update({
      profileId,
      host: '10.0.4.7',
      port: 2222,
      username: 'deploy',
      auth: { method: 'password' },
      displayName: 'prod db'
    })
    expect(updated.ok).toBe(true)
    const document = await readDocument(dir)
    expect(document.latestSnapshots[profileId]).toBeUndefined()
    expect(document.latestAttempts[profileId]).toBeUndefined()
    expect(document.profiles[0]?.port).toBe(2222)
  })

  it('keeps snapshot and clears only latest Connection Attempt when username or Authentication Method changes', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const created = await api.create(passwordDraft())
    expect(created.ok).toBe(true)
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected create to succeed')
    }
    const profileId = created.workspace.selectedProfileId
    await seedFacts(dir, profileId, { hostname: 'db' }, SEEDED_ATTEMPT)
    api = createProfileApi({ userDataPath: dir })

    const updated = await api.update({
      profileId,
      host: '10.0.4.7',
      username: 'alice',
      auth: { method: 'password' }
    })
    expect(updated.ok).toBe(true)
    const document = await readDocument(dir)
    expect(document.latestSnapshots[profileId]).toEqual({ hostname: 'db' })
    expect(document.latestAttempts[profileId]).toBeUndefined()
    expect(document.profiles[0]?.username).toBe('alice')
  })

  it('keeps snapshot and latest Connection Attempt when only display name or discovery changes', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const created = await api.create(passwordDraft({ displayName: 'prod db' }))
    expect(created.ok).toBe(true)
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected create to succeed')
    }
    const profileId = created.workspace.selectedProfileId
    await seedFacts(dir, profileId, { hostname: 'db' }, SEEDED_ATTEMPT)
    api = createProfileApi({ userDataPath: dir })

    const updated = await api.update({
      profileId,
      host: '10.0.4.7',
      username: 'deploy',
      auth: { method: 'password' },
      displayName: 'staging db',
      automaticDiscovery: false
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) {
      throw new Error('expected update to succeed')
    }
    expect(updated.workspace.profiles[0]).toMatchObject({
      displayName: 'staging db',
      automaticDiscovery: false,
      label: 'staging db'
    })
    const document = await readDocument(dir)
    expect(document.latestSnapshots[profileId]).toEqual({ hostname: 'db' })
    expect(document.latestAttempts[profileId]).toEqual(SEEDED_ATTEMPT)
  })

  it('rejects host, port, username, and Authentication Method edits while an SSH Session is occupied and still allows display-name edits', async () => {
    const dir = await tempUserData()
    const occupied = new Set<string>()
    api = createProfileApi({
      userDataPath: dir,
      sessions: {
        isOccupied: (profileId) => occupied.has(profileId),
        dropSession: async () => undefined
      }
    })
    const created = await api.create(passwordDraft({ displayName: 'prod db' }))
    expect(created.ok).toBe(true)
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected create to succeed')
    }
    const profileId = created.workspace.selectedProfileId
    occupied.add(profileId)

    const locked = await api.update({
      profileId,
      host: 'other.test',
      username: 'deploy',
      auth: { method: 'password' },
      displayName: 'prod db'
    })
    expect(locked).toMatchObject({ ok: false, reason: 'session-locked' })
    expect((await readDocument(dir)).profiles[0]?.host).toBe('10.0.4.7')

    const renamed = await api.update({
      profileId,
      host: '10.0.4.7',
      username: 'deploy',
      auth: { method: 'password' },
      displayName: 'staging'
    })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) {
      throw new Error('expected display-name update to succeed')
    }
    expect(renamed.workspace.profiles[0]?.label).toBe('staging')
  })

  it('falls back to the next alphabetical profile, then the previous, then empty after delete', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const zeta = await api.create(passwordDraft({ displayName: 'zeta', host: 'z.test' }))
    const prod = await api.create(
      passwordDraft({ displayName: 'prod db', host: 'p.test', username: 'alice' })
    )
    const alpha = await api.create(passwordDraft({ host: 'alpha.test', username: 'alice' }))
    expect(zeta.ok && prod.ok && alpha.ok).toBe(true)
    if (!zeta.ok || !prod.ok || !alpha.ok) {
      throw new Error('expected creates to succeed')
    }
    const zetaId = zeta.workspace.selectedProfileId
    const prodId = prod.workspace.selectedProfileId
    const alphaId = alpha.workspace.selectedProfileId
    if (zetaId === null || prodId === null || alphaId === null) {
      throw new Error('expected selected ids')
    }

    await api.select(alphaId)
    const afterAlpha = await api.delete(alphaId)
    expect(afterAlpha.ok).toBe(true)
    if (!afterAlpha.ok) {
      throw new Error('expected delete to succeed')
    }
    expect(afterAlpha.workspace.selectedProfileId).toBe(prodId)
    expect(afterAlpha.workspace.profiles.map((profile) => profile.label)).toEqual([
      'prod db',
      'zeta'
    ])

    const afterZeta = await api.delete(zetaId)
    expect(afterZeta.ok).toBe(true)
    if (!afterZeta.ok) {
      throw new Error('expected second delete to succeed')
    }
    expect(afterZeta.workspace.selectedProfileId).toBe(prodId)

    const afterLast = await api.delete(prodId)
    expect(afterLast.ok).toBe(true)
    if (!afterLast.ok) {
      throw new Error('expected last delete to succeed')
    }
    expect(afterLast.workspace).toMatchObject({
      profiles: [],
      selectedProfileId: null
    })
  })

  it('keeps the current selection when a non-selected profile is deleted', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const zeta = await api.create(passwordDraft({ displayName: 'zeta', host: 'z.test' }))
    const prod = await api.create(
      passwordDraft({ displayName: 'prod db', host: 'p.test', username: 'alice' })
    )
    const alpha = await api.create(passwordDraft({ host: 'alpha.test', username: 'alice' }))
    expect(zeta.ok && prod.ok && alpha.ok).toBe(true)
    if (!zeta.ok || !prod.ok || !alpha.ok) {
      throw new Error('expected creates to succeed')
    }
    const zetaId = zeta.workspace.selectedProfileId
    const alphaId = alpha.workspace.selectedProfileId
    if (zetaId === null || alphaId === null) {
      throw new Error('expected ids')
    }
    await api.select(alphaId)
    const deleted = await api.delete(zetaId)
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) {
      throw new Error('expected delete to succeed')
    }
    expect(deleted.workspace.selectedProfileId).toBe(alphaId)
  })

  it('drops snapshot and attempt for the deleted profile without touching another profile’s facts', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const first = await api.create(passwordDraft({ displayName: 'keep', host: 'keep.test' }))
    const second = await api.create(passwordDraft({ displayName: 'gone', host: 'gone.test' }))
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) {
      throw new Error('expected creates to succeed')
    }
    const keepId = first.workspace.selectedProfileId
    const goneId = second.workspace.selectedProfileId
    if (keepId === null || goneId === null) {
      throw new Error('expected ids')
    }
    await seedFacts(dir, keepId, { hostname: 'keep' }, SEEDED_ATTEMPT)
    await seedFacts(dir, goneId, { hostname: 'gone' }, SEEDED_CANCELED)
    api = createProfileApi({ userDataPath: dir })

    const deleted = await api.delete(goneId)
    expect(deleted.ok).toBe(true)
    const document = await readDocument(dir)
    expect(document.latestSnapshots[keepId]).toEqual({ hostname: 'keep' })
    expect(document.latestAttempts[keepId]).toEqual(SEEDED_ATTEMPT)
    expect(document.latestSnapshots[goneId]).toBeUndefined()
    expect(document.latestAttempts[goneId]).toBeUndefined()
    expect(document.profiles.map((profile) => profile.displayName)).toEqual(['keep'])
  })

  it('disconnects a live SSH Session when deleting an occupied profile', async () => {
    const dir = await tempUserData()
    const ended: string[] = []
    api = createProfileApi({
      userDataPath: dir,
      sessions: {
        isOccupied: () => true,
        dropSession: async (profileId) => {
          ended.push(profileId)
        }
      }
    })
    const created = await api.create(passwordDraft({ displayName: 'live' }))
    expect(created.ok).toBe(true)
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected create to succeed')
    }
    const profileId = created.workspace.selectedProfileId
    const deleted = await api.delete(profileId)
    expect(deleted.ok).toBe(true)
    expect(ended).toEqual([profileId])
    expect((await api.load()).profiles).toEqual([])
  })

  it('replaces a private-key path in one action without returning the full path', async () => {
    const dir = await tempUserData()
    const firstKey = join(dir, 'id_ed25519')
    const secondKey = join(dir, 'replacement')
    await writeFile(firstKey, 'first-key')
    await writeFile(secondKey, 'second-key')
    let pickPath = firstKey
    api = createProfileApi({
      userDataPath: dir,
      dialogs: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [pickPath] })
      }
    })
    const picked = await api.pickPrivateKey()
    if (picked === null) {
      throw new Error('expected a key pick')
    }
    const created = await api.create({
      host: '10.0.4.7',
      username: 'deploy',
      auth: { method: 'privateKey', keyRef: picked.keyRef }
    })
    expect(created.ok).toBe(true)
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected create to succeed')
    }
    const profileId = created.workspace.selectedProfileId
    expect(JSON.stringify(created.workspace)).not.toContain(firstKey)

    pickPath = secondKey
    const replaced = await api.replacePrivateKey(profileId)
    expect(replaced.ok).toBe(true)
    if (!replaced.ok) {
      throw new Error('expected replace to succeed')
    }
    expect(JSON.stringify(replaced.workspace)).not.toContain(secondKey)
    expect(replaced.workspace.profiles[0]?.auth).toEqual({
      method: 'privateKey',
      label: 'replacement'
    })
    const document = await readDocument(dir)
    expect(document.profiles[0]?.auth).toEqual({ method: 'privateKey', filePath: secondKey })
    expect(document.latestAttempts[profileId]).toBeUndefined()
  })

  it('keeps the existing private-key path when an edit does not pick a replacement', async () => {
    const dir = await tempUserData()
    const keyPath = join(dir, 'id_ed25519')
    await writeFile(keyPath, 'key')
    api = createProfileApi({
      userDataPath: dir,
      dialogs: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [keyPath] })
      }
    })
    const picked = await api.pickPrivateKey()
    if (picked === null) {
      throw new Error('expected a key pick')
    }
    const created = await api.create({
      host: '10.0.4.7',
      username: 'deploy',
      auth: { method: 'privateKey', keyRef: picked.keyRef }
    })
    expect(created.ok).toBe(true)
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected create to succeed')
    }
    const profileId = created.workspace.selectedProfileId
    const updated = await api.update({
      profileId,
      host: '10.0.4.7',
      username: 'deploy',
      auth: { method: 'privateKey', keepExisting: true },
      displayName: 'named key'
    })
    expect(updated.ok).toBe(true)
    const document = await readDocument(dir)
    expect(document.profiles[0]?.auth).toEqual({ method: 'privateKey', filePath: keyPath })
    expect(document.profiles[0]?.displayName).toBe('named key')
  })

  it('warns on an update that matches another profile unless Save Anyway is set', async () => {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const first = await api.create(passwordDraft({ displayName: 'prod db' }))
    const second = await api.create(
      passwordDraft({ displayName: 'other', host: 'other.test', saveAnyway: true })
    )
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok || second.workspace.selectedProfileId === null) {
      throw new Error('expected creates to succeed')
    }
    const blocked = await api.update({
      profileId: second.workspace.selectedProfileId,
      host: '10.0.4.7',
      username: 'deploy',
      auth: { method: 'password' }
    })
    expect(blocked).toMatchObject({
      ok: false,
      reason: 'duplicate',
      existingLabel: 'prod db'
    })
    const saved = await api.update({
      profileId: second.workspace.selectedProfileId,
      host: '10.0.4.7',
      username: 'deploy',
      auth: { method: 'password' },
      saveAnyway: true
    })
    expect(saved.ok).toBe(true)
  })

  it('returns canceled when the replacement picker is dismissed', async () => {
    const dir = await tempUserData()
    api = createProfileApi({
      userDataPath: dir,
      dialogs: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] })
      }
    })
    const created = await api.create(passwordDraft({ displayName: 'prod db' }))
    expect(created.ok).toBe(true)
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected create to succeed')
    }
    const result = await api.replacePrivateKey(created.workspace.selectedProfileId)
    expect(result).toMatchObject({ ok: false, reason: 'not-private-key' })

    const keyPath = join(dir, 'id_ed25519')
    await writeFile(keyPath, 'key')
    api = createProfileApi({
      userDataPath: dir,
      dialogs: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [keyPath] })
      }
    })
    const picked = await api.pickPrivateKey()
    if (picked === null) {
      throw new Error('expected a key pick')
    }
    const keyProfile = await api.create({
      host: 'key.test',
      username: 'deploy',
      auth: { method: 'privateKey', keyRef: picked.keyRef }
    })
    expect(keyProfile.ok).toBe(true)
    if (!keyProfile.ok || keyProfile.workspace.selectedProfileId === null) {
      throw new Error('expected key profile')
    }
    api = createProfileApi({
      userDataPath: dir,
      dialogs: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] })
      }
    })
    const canceled = await api.replacePrivateKey(keyProfile.workspace.selectedProfileId)
    expect(canceled).toMatchObject({ ok: false, reason: 'canceled' })
    expect(
      (await readDocument(dir)).profiles.some((profile) => profile.auth.filePath === keyPath)
    ).toBe(true)
  })
})

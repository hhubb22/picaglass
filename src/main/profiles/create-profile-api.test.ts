import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProfileApi, type ProfileApi } from './create-profile-api'

const WORKSPACE_DIR = 'workspace'
const PRIMARY = join(WORKSPACE_DIR, 'workspace.json')
const BACKUP = join(WORKSPACE_DIR, 'workspace.json.bak')

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
    seeded.latestAttempts[originalId] = { outcome: 'remote-ended' }
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
    expect(document.latestAttempts[originalId]).toEqual({ outcome: 'remote-ended' })
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
})

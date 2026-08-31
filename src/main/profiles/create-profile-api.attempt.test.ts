import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConnectionAttemptSummary } from '../../shared/connection-attempt'
import { createProfileApi, type ProfileApi } from './create-profile-api'

const WORKSPACE_DIR = 'workspace'
const PRIMARY = join(WORKSPACE_DIR, 'workspace.json')

const FINISHED_ATTEMPT: ConnectionAttemptSummary = {
  startedAt: '2026-08-30T10:00:00.000Z',
  connectedAt: '2026-08-30T10:00:02.000Z',
  endedAt: '2026-08-30T10:05:00.000Z',
  outcome: 'remote-session-ended'
}

describe('createProfileApi Connection Attempt summaries', () => {
  let userDataPath: string | undefined
  let api: ProfileApi | undefined

  afterEach(async () => {
    api = undefined
    if (userDataPath !== undefined) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = undefined
    }
  })

  async function tempUserData(): Promise<string> {
    userDataPath = await mkdtemp(join(tmpdir(), 'picaglass-attempt-'))
    return userDataPath
  }

  async function savePassword(): Promise<{ dir: string; profileId: string }> {
    const dir = await tempUserData()
    api = createProfileApi({ userDataPath: dir })
    const created = await api.create({
      host: '10.0.4.7',
      username: 'deploy',
      auth: { method: 'password' },
      displayName: 'prod db'
    })
    if (!created.ok || created.workspace.selectedProfileId === null) {
      throw new Error('expected a saved profile')
    }
    return { dir, profileId: created.workspace.selectedProfileId }
  }

  async function seedAttempt(
    dir: string,
    profileId: string,
    attempt: ConnectionAttemptSummary
  ): Promise<void> {
    const primary = join(dir, PRIMARY)
    const raw = JSON.parse(await readFile(primary, 'utf8')) as {
      latestAttempts: Record<string, unknown>
    }
    raw.latestAttempts[profileId] = attempt
    await writeFile(primary, `${JSON.stringify(raw, null, 2)}\n`)
  }

  it('projects lastAttempt as null until a summary is recorded', async () => {
    const { profileId } = await savePassword()
    const loaded = await api!.load()
    expect(loaded.profiles.find((profile) => profile.id === profileId)?.lastAttempt).toBe(null)
  })

  it('replaces the latest summary for a profile and never keeps a transport message', async () => {
    const { profileId } = await savePassword()
    await api!.recordAttempt(profileId, FINISHED_ATTEMPT)
    const next: ConnectionAttemptSummary = {
      startedAt: '2026-08-31T12:00:00.000Z',
      endedAt: '2026-08-31T12:00:04.000Z',
      outcome: 'authentication-failed'
    }
    await api!.recordAttempt(profileId, {
      ...next,
      message: 'All configured authentication methods failed'
    } as ConnectionAttemptSummary)

    const loaded = await api!.load()
    expect(loaded.profiles.find((profile) => profile.id === profileId)?.lastAttempt).toEqual(next)

    const document = JSON.parse(await readFile(join(userDataPath!, PRIMARY), 'utf8')) as {
      latestAttempts: Record<string, unknown>
    }
    expect(Object.keys(document.latestAttempts)).toEqual([profileId])
    expect(document.latestAttempts[profileId]).toEqual(next)
    expect(JSON.stringify(document.latestAttempts)).not.toContain(
      'All configured authentication methods failed'
    )
  })

  it('finalizes a connected attempt with no end as interrupted on launch', async () => {
    const recoveredAt = new Date('2026-08-31T15:42:00.000Z')
    const { dir, profileId } = await savePassword()
    await seedAttempt(dir, profileId, {
      startedAt: '2026-08-31T12:00:00.000Z',
      connectedAt: '2026-08-31T12:00:01.000Z'
    })

    api = createProfileApi({
      userDataPath: dir,
      now: () => recoveredAt
    })
    const loaded = await api.load()
    expect(loaded.profiles.find((profile) => profile.id === profileId)?.lastAttempt).toEqual({
      startedAt: '2026-08-31T12:00:00.000Z',
      connectedAt: '2026-08-31T12:00:01.000Z',
      endedAt: '2026-08-31T15:42:00.000Z',
      outcome: 'interrupted-by-previous-app-exit'
    })

    const document = JSON.parse(await readFile(join(dir, PRIMARY), 'utf8')) as {
      latestAttempts: Record<string, ConnectionAttemptSummary>
    }
    expect(document.latestAttempts[profileId]).toEqual({
      startedAt: '2026-08-31T12:00:00.000Z',
      connectedAt: '2026-08-31T12:00:01.000Z',
      endedAt: '2026-08-31T15:42:00.000Z',
      outcome: 'interrupted-by-previous-app-exit'
    })
  })

  it('does not treat a never-connected start as interrupted', async () => {
    const { dir, profileId } = await savePassword()
    await seedAttempt(dir, profileId, { startedAt: '2026-08-31T12:00:00.000Z' })
    api = createProfileApi({
      userDataPath: dir,
      now: () => new Date('2026-08-31T15:42:00.000Z')
    })
    const loaded = await api.load()
    expect(loaded.profiles.find((profile) => profile.id === profileId)?.lastAttempt).toEqual({
      startedAt: '2026-08-31T12:00:00.000Z'
    })
  })

  it('ignores recordAttempt for an unknown profile', async () => {
    const { profileId } = await savePassword()
    await api!.recordAttempt('missing', FINISHED_ATTEMPT)
    const loaded = await api!.load()
    expect(loaded.profiles.find((profile) => profile.id === profileId)?.lastAttempt).toBe(null)
  })

  it('keeps the last durable attempt when interrupted recovery cannot be written', async () => {
    const dangling = {
      startedAt: '2026-08-31T12:00:00.000Z',
      connectedAt: '2026-08-31T12:00:01.000Z'
    }
    const { dir, profileId } = await savePassword()
    await seedAttempt(dir, profileId, dangling)
    await mkdir(join(dir, WORKSPACE_DIR, 'workspace.json.tmp'))

    api = createProfileApi({
      userDataPath: dir,
      now: () => new Date('2026-08-31T15:42:00.000Z')
    })
    const loaded = await api.load()
    expect(loaded.notice?.kind).toBe('write-failed')
    expect(loaded.profiles.find((profile) => profile.id === profileId)?.lastAttempt).toEqual(
      dangling
    )
  })
})

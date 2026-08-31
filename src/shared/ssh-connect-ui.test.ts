import { describe, expect, it } from 'vitest'
import { createSshEventInbox } from './ssh-event-inbox'
import { runSshConnect, syncSshConnectInbox } from './ssh-connect-ui'
import { SINGLE_FORM_PROFILE_ID, type SshConnectRequest, type SshConnectResult } from './ssh'

function req(): SshConnectRequest {
  return {
    profileId: SINGLE_FORM_PROFILE_ID,
    host: '127.0.0.1',
    username: 'tester',
    auth: { method: 'password', password: 'secret' },
    cols: 80,
    rows: 24
  }
}

describe('runSshConnect', () => {
  it('keeps the live session and inbox when reconnect is rejected as invalid', async () => {
    const chunks: Uint8Array[] = []
    const inbox = createSshEventInbox({
      onData: (_id, chunk) => {
        chunks.push(Uint8Array.from(chunk))
      },
      onStatus: () => undefined
    })
    inbox.activate('live')

    const previous = 'live'
    const next = await runSshConnect({
      sessionId: previous,
      currentSessionId: () => previous,
      req: req(),
      connect: async (): Promise<SshConnectResult> => ({
        ok: false,
        reason: 'invalid',
        message: 'invalid username'
      })
    })
    syncSshConnectInbox(inbox, next)

    expect(next).toEqual({
      sessionId: 'live',
      pending: null,
      error: 'invalid username'
    })

    inbox.handleData('live', Uint8Array.from([0x61]))
    expect(chunks).toEqual([Uint8Array.from([0x61])])
  })

  it('activates the new session after a successful connect', async () => {
    const chunks: Uint8Array[] = []
    const inbox = createSshEventInbox({
      onData: (_id, chunk) => {
        chunks.push(Uint8Array.from(chunk))
      },
      onStatus: () => undefined
    })
    inbox.activate('old')

    const previous = 'live'
    const next = await runSshConnect({
      sessionId: previous,
      currentSessionId: () => previous,
      req: req(),
      connect: async (): Promise<SshConnectResult> => ({ ok: true, sessionId: 'new' })
    })
    syncSshConnectInbox(inbox, next)

    expect(next.sessionId).toBe('new')
    inbox.handleData('new', Uint8Array.from([0x62]))
    expect(chunks).toEqual([Uint8Array.from([0x62])])
  })

  it('does not expose host-key trust controls when a host key changed', async () => {
    const next = await runSshConnect({
      sessionId: null,
      currentSessionId: () => null,
      req: req(),
      connect: async (): Promise<SshConnectResult> => ({
        ok: false,
        reason: 'host-changed',
        fingerprint: 'SHA256:changed',
        algorithm: 'ssh-ed25519'
      })
    })

    expect(next).toEqual({
      sessionId: null,
      pending: null,
      error: 'host-changed'
    })
  })

  it('does not resurrect a session after a queued closed is applied', async () => {
    let sessionId: string | null = 'old'
    const inbox = createSshEventInbox({
      onData: () => undefined,
      onStatus: (event) => {
        if (event.type === 'closed' || event.type === 'error') {
          sessionId = null
        }
      }
    })
    inbox.beginHandoff()
    inbox.handleStatus({ sessionId: 'new', type: 'closed' })

    const previous = sessionId
    const next = await runSshConnect({
      sessionId: previous,
      currentSessionId: () => sessionId,
      req: req(),
      connect: async (): Promise<SshConnectResult> => ({ ok: true, sessionId: 'new' })
    })
    sessionId = next.sessionId
    syncSshConnectInbox(inbox, next)

    expect(sessionId).toBe(null)
  })

  it('does not restore a closed session when invalid reconnect returns', async () => {
    let sessionId: string | null = 'live'
    const inbox = createSshEventInbox({
      onData: () => undefined,
      onStatus: (event) => {
        if (event.type === 'closed' || event.type === 'error') {
          sessionId = null
        }
      }
    })
    inbox.activate('live')

    const previous = sessionId
    const next = await runSshConnect({
      sessionId: previous,
      currentSessionId: () => sessionId,
      req: req(),
      connect: async (): Promise<SshConnectResult> => {
        inbox.handleStatus({ sessionId: 'live', type: 'closed' })
        return { ok: false, reason: 'invalid', message: 'invalid username' }
      }
    })
    sessionId = next.sessionId
    syncSshConnectInbox(inbox, next)

    expect(next).toEqual({
      sessionId: null,
      pending: null,
      error: 'invalid username'
    })
    expect(sessionId).toBe(null)
  })
})

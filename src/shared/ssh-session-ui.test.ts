import { describe, expect, it } from 'vitest'
import {
  applyConnectResult,
  applySessionStatus,
  beginConnect,
  beginDisconnect,
  cancelSecretPrompt,
  emptyProfileSession,
  friendlyAuthFailure,
  SESSION_STATE_LABEL,
  sessionIndicator,
  submitSecret,
  type ProfileSessionUi
} from './ssh-session-ui'

function connecting(overrides?: Partial<ProfileSessionUi>): ProfileSessionUi {
  return {
    ...emptyProfileSession(),
    state: 'connecting',
    secretKind: 'password',
    ...overrides
  }
}

describe('ssh session UI', () => {
  it('labels every visible session state and pairs it with a semantic indicator', () => {
    expect(SESSION_STATE_LABEL['no-active-session']).toBe('No active session')
    expect(sessionIndicator('no-active-session')).toBe('idle')
    expect(SESSION_STATE_LABEL.connecting).toBe('Connecting')
    expect(sessionIndicator('connecting')).toBe('pending')
    expect(SESSION_STATE_LABEL['verification-required']).toBe('Verification required')
    expect(sessionIndicator('verification-required')).toBe('attention')
    expect(SESSION_STATE_LABEL.connected).toBe('Connected')
    expect(sessionIndicator('connected')).toBe('live')
    expect(SESSION_STATE_LABEL.disconnecting).toBe('Disconnecting')
    expect(sessionIndicator('disconnecting')).toBe('ending')
  })

  it('prompts for a password without entering Connecting', () => {
    const next = beginConnect(emptyProfileSession(), { method: 'password' })
    expect(next.state).toBe('no-active-session')
    expect(next.secretPrompt).toEqual({ kind: 'password', message: null })
    expect(next.secretKind).toBe('password')
  })

  it('enters Connecting immediately for a private-key profile', () => {
    const next = beginConnect(emptyProfileSession(), { method: 'privateKey' })
    expect(next.state).toBe('connecting')
    expect(next.secretPrompt).toBe(null)
  })

  it('canceling the secret prompt starts no Connection Attempt', () => {
    const prompted = beginConnect(emptyProfileSession(), { method: 'password' })
    const next = cancelSecretPrompt(prompted)
    expect(next).toEqual(emptyProfileSession())
  })

  it('submitting a secret enters Connecting', () => {
    const prompted = beginConnect(emptyProfileSession(), { method: 'password' })
    const next = submitSecret(prompted)
    expect(next.state).toBe('connecting')
    expect(next.secretPrompt).toBe(null)
    expect(next.secretKind).toBe('password')
  })

  it('opens a passphrase prompt from secret-required without recording an attempt', () => {
    const connectingKey = beginConnect(emptyProfileSession(), { method: 'privateKey' })
    const next = applyConnectResult(connectingKey, {
      ok: false,
      reason: 'secret-required',
      kind: 'passphrase'
    })
    expect(next.state).toBe('no-active-session')
    expect(next.lastOutcome).toBe(null)
    expect(next.secretPrompt).toEqual({ kind: 'passphrase', message: null })
    expect(next.secretKind).toBe('passphrase')
  })

  it('shows Verification required for an unknown host', () => {
    const next = applyConnectResult(connecting(), {
      ok: false,
      reason: 'host-unknown',
      sessionId: 'pending-1',
      fingerprint: 'SHA256:abc',
      algorithm: 'ssh-ed25519'
    })
    expect(next.state).toBe('verification-required')
    expect(next.pendingHostKey).toEqual({
      sessionId: 'pending-1',
      fingerprint: 'SHA256:abc',
      algorithm: 'ssh-ed25519'
    })
  })

  it('marks Connected on a successful connect', () => {
    const next = applyConnectResult(connecting(), { ok: true, sessionId: 'live-1' })
    expect(next.state).toBe('connected')
    expect(next.sessionId).toBe('live-1')
    expect(next.secretPrompt).toBe(null)
  })

  it('reopens the secret prompt with friendly context after authentication failure', () => {
    const failed = applyConnectResult(connecting({ secretKind: 'password' }), {
      ok: false,
      reason: 'auth-failed',
      message: 'All configured authentication methods failed'
    })
    expect(failed.state).toBe('no-active-session')
    expect(failed.lastOutcome).toBe('authentication failed')
    expect(failed.secretPrompt).toEqual({
      kind: 'password',
      message: friendlyAuthFailure('password')
    })
    expect(failed.secretPrompt?.message).toBe(
      'Authentication failed. Check the password and try again.'
    )
  })

  it('does not reopen a secret prompt when an unencrypted key fails authentication', () => {
    const failed = applyConnectResult(connecting({ secretKind: null }), {
      ok: false,
      reason: 'auth-failed',
      message: 'All configured authentication methods failed'
    })
    expect(failed.secretPrompt).toBe(null)
    expect(failed.state).toBe('no-active-session')
    expect(failed.error).toBe('Authentication failed.')
  })

  it('keeps a live session when a conflicting connect is rejected as invalid', () => {
    const live: ProfileSessionUi = {
      ...emptyProfileSession(),
      state: 'connected',
      sessionId: 'live-1'
    }
    const next = applyConnectResult(live, {
      ok: false,
      reason: 'invalid',
      message: 'session already exists'
    })
    expect(next.state).toBe('connected')
    expect(next.sessionId).toBe('live-1')
    expect(next.error).toBe('session already exists')
  })

  it('returns to No active session when host verification is aborted', () => {
    const pending = applyConnectResult(connecting(), {
      ok: false,
      reason: 'host-unknown',
      sessionId: 'pending-1',
      fingerprint: 'SHA256:abc',
      algorithm: 'ssh-ed25519'
    })
    const next = applyConnectResult(pending, {
      ok: false,
      reason: 'invalid',
      message: 'aborted'
    })
    expect(next.state).toBe('no-active-session')
    expect(next.pendingHostKey).toBe(null)
  })

  it('enters Disconnecting then operator-disconnected on a local disconnect', () => {
    const live: ProfileSessionUi = {
      ...emptyProfileSession(),
      state: 'connected',
      sessionId: 'live-1'
    }
    const ending = beginDisconnect(live)
    expect(ending.state).toBe('disconnecting')
    const next = applySessionStatus(ending, { sessionId: 'live-1', type: 'closed' })
    expect(next.state).toBe('no-active-session')
    expect(next.sessionId).toBe(null)
    expect(next.lastOutcome).toBe('operator disconnected')
  })

  it('records a remote end with an ended-session outcome', () => {
    const live: ProfileSessionUi = {
      ...emptyProfileSession(),
      state: 'connected',
      sessionId: 'live-1'
    }
    const next = applySessionStatus(live, { sessionId: 'live-1', type: 'closed' })
    expect(next.state).toBe('no-active-session')
    expect(next.lastOutcome).toBe('remote session ended')
  })

  it('records a network failure from a session error', () => {
    const live: ProfileSessionUi = {
      ...emptyProfileSession(),
      state: 'connected',
      sessionId: 'live-1'
    }
    const next = applySessionStatus(live, {
      sessionId: 'live-1',
      type: 'error',
      message: 'ECONNRESET'
    })
    expect(next.lastOutcome).toBe('network failed')
  })
})

describe('applyConnectResult ignored statuses', () => {
  it('ignores a status for a different session', () => {
    const live: ProfileSessionUi = {
      ...emptyProfileSession(),
      state: 'connected',
      sessionId: 'live-1'
    }
    const next = applySessionStatus(live, { sessionId: 'other', type: 'closed' })
    expect(next).toEqual(live)
  })
})

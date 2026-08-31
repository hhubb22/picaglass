import { describe, expect, it } from 'vitest'
import {
  applyAttemptFailure,
  ATTEMPT_OUTCOME_LABEL,
  CONNECTION_ATTEMPT_OUTCOMES,
  dismissAttemptFailure,
  isFailedAttemptOutcome,
  parseConnectionAttempt,
  recoverInterruptedAttempt,
  viewAttemptFailure
} from './connection-attempt'

describe('Connection Attempt outcomes', () => {
  it('labels every stable outcome in the fixed set', () => {
    expect(ATTEMPT_OUTCOME_LABEL['remote-session-ended']).toBe('Remote session ended')
    expect(ATTEMPT_OUTCOME_LABEL['operator-disconnected']).toBe('Operator disconnected')
    expect(ATTEMPT_OUTCOME_LABEL['authentication-failed']).toBe('Authentication failed')
    expect(ATTEMPT_OUTCOME_LABEL['timed-out']).toBe('Timed out')
    expect(ATTEMPT_OUTCOME_LABEL['network-failed']).toBe('Network failed')
    expect(ATTEMPT_OUTCOME_LABEL['host-key-rejected']).toBe('Host key rejected')
    expect(ATTEMPT_OUTCOME_LABEL.canceled).toBe('Canceled')
    expect(ATTEMPT_OUTCOME_LABEL['interrupted-by-previous-app-exit']).toBe(
      'Interrupted by previous app exit'
    )
    expect(CONNECTION_ATTEMPT_OUTCOMES).toHaveLength(8)
  })

  it('treats auth, timeout, network, host-key, and canceled as failed attempts', () => {
    expect(isFailedAttemptOutcome('authentication-failed')).toBe(true)
    expect(isFailedAttemptOutcome('timed-out')).toBe(true)
    expect(isFailedAttemptOutcome('network-failed')).toBe(true)
    expect(isFailedAttemptOutcome('host-key-rejected')).toBe(true)
    expect(isFailedAttemptOutcome('canceled')).toBe(true)
    expect(isFailedAttemptOutcome('remote-session-ended')).toBe(false)
    expect(isFailedAttemptOutcome('operator-disconnected')).toBe(false)
    expect(isFailedAttemptOutcome('interrupted-by-previous-app-exit')).toBe(false)
  })
})

describe('parseConnectionAttempt', () => {
  it('accepts a complete summary and drops raw transport fields', () => {
    const parsed = parseConnectionAttempt({
      startedAt: '2026-08-31T12:00:00.000Z',
      connectedAt: '2026-08-31T12:00:01.000Z',
      endedAt: '2026-08-31T12:00:08.000Z',
      outcome: 'remote-session-ended',
      message: 'Connection reset by peer'
    })
    expect(parsed).toEqual({
      startedAt: '2026-08-31T12:00:00.000Z',
      connectedAt: '2026-08-31T12:00:01.000Z',
      endedAt: '2026-08-31T12:00:08.000Z',
      outcome: 'remote-session-ended'
    })
    expect(parsed).not.toHaveProperty('message')
  })

  it('accepts a connected attempt that has not ended yet', () => {
    expect(
      parseConnectionAttempt({
        startedAt: '2026-08-31T12:00:00.000Z',
        connectedAt: '2026-08-31T12:00:01.000Z'
      })
    ).toEqual({
      startedAt: '2026-08-31T12:00:00.000Z',
      connectedAt: '2026-08-31T12:00:01.000Z'
    })
  })

  it('rejects a record with no start time or an unknown outcome-only seed', () => {
    expect(parseConnectionAttempt({ outcome: 'remote-ended' })).toBeUndefined()
    expect(parseConnectionAttempt({ startedAt: 'not-a-date' })).toBeUndefined()
    expect(parseConnectionAttempt(null)).toBeUndefined()
  })
})

describe('recoverInterruptedAttempt', () => {
  it('finalizes a connected attempt with no end as interrupted, using recovery time as the end', () => {
    const recoveredAt = new Date('2026-08-31T15:00:00.000Z')
    expect(
      recoverInterruptedAttempt(
        {
          startedAt: '2026-08-31T12:00:00.000Z',
          connectedAt: '2026-08-31T12:00:01.000Z'
        },
        recoveredAt
      )
    ).toEqual({
      startedAt: '2026-08-31T12:00:00.000Z',
      connectedAt: '2026-08-31T12:00:01.000Z',
      endedAt: '2026-08-31T15:00:00.000Z',
      outcome: 'interrupted-by-previous-app-exit'
    })
  })

  it('leaves a finished attempt and a never-connected start alone', () => {
    const recoveredAt = new Date('2026-08-31T15:00:00.000Z')
    const finished = {
      startedAt: '2026-08-31T12:00:00.000Z',
      connectedAt: '2026-08-31T12:00:01.000Z',
      endedAt: '2026-08-31T12:05:00.000Z',
      outcome: 'operator-disconnected' as const
    }
    expect(recoverInterruptedAttempt(finished, recoveredAt)).toEqual(finished)
    const connecting = { startedAt: '2026-08-31T12:00:00.000Z' }
    expect(recoverInterruptedAttempt(connecting, recoveredAt)).toEqual(connecting)
  })
})

describe('attempt failure surface', () => {
  it('shows a dismissible banner without a sidebar badge for an on-screen failure', () => {
    const surface = applyAttemptFailure(true, 'network-failed', 'ECONNRESET')
    expect(surface).toEqual({
      banner: { outcome: 'network-failed', detail: 'ECONNRESET' },
      unseen: false
    })
  })

  it('keeps a red sidebar badge until an off-screen failure is viewed or dismissed', () => {
    const surface = applyAttemptFailure(false, 'timed-out', 'authentication timed out')
    expect(surface.unseen).toBe(true)
    expect(surface.banner?.outcome).toBe('timed-out')
    expect(viewAttemptFailure(surface).unseen).toBe(false)
    expect(viewAttemptFailure(surface).banner).toEqual(surface.banner)
    expect(dismissAttemptFailure()).toEqual({ banner: null, unseen: false })
  })

  it('does not open a failure banner for a remote session that ended normally', () => {
    expect(applyAttemptFailure(false, 'remote-session-ended', null)).toEqual({
      banner: null,
      unseen: false
    })
  })
})

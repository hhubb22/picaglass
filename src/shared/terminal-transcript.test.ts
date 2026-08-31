import { describe, expect, it } from 'vitest'
import {
  appendRemote,
  beginAttempt,
  clearTranscript,
  ENDED_NETWORK_MESSAGE,
  ENDED_REMOTE_MESSAGE,
  endSession,
  formatSeparatorText,
  isLocalTranscriptEntry
} from './terminal-transcript'

describe('terminal transcript', () => {
  it('records a local separator that remote output cannot forge', () => {
    const started = new Date('2026-08-31T12:00:00.000Z')
    let transcript = beginAttempt([], started, null)
    const [separator] = transcript
    if (separator === undefined || separator.source !== 'local' || separator.kind !== 'separator') {
      throw new Error('expected a local separator')
    }
    const fake = new TextEncoder().encode(formatSeparatorText(separator))
    transcript = appendRemote(transcript, fake)

    expect(transcript).toHaveLength(2)
    expect(isLocalTranscriptEntry(transcript[0])).toBe(true)
    expect(isLocalTranscriptEntry(transcript[1])).toBe(false)
    expect(transcript[0]).toMatchObject({
      source: 'local',
      kind: 'separator',
      previousOutcome: null
    })
    expect(transcript[1]).toMatchObject({ source: 'remote' })
  })

  it('includes the previous outcome on a later attempt separator', () => {
    const started = new Date('2026-08-31T13:00:00.000Z')
    const transcript = beginAttempt([], started, 'remote session ended')
    const [separator] = transcript
    if (separator === undefined || separator.source !== 'local' || separator.kind !== 'separator') {
      throw new Error('expected a local separator')
    }
    const text = formatSeparatorText(separator)
    expect(text).toContain('previous: remote session ended')
    expect(text).toContain('2026-08-31')
  })

  it('appends an ended-session banner as a local entry', () => {
    let transcript = appendRemote([], Uint8Array.from([0x61]))
    transcript = endSession(transcript, 'closed')
    expect(transcript[1]).toEqual({
      source: 'local',
      kind: 'ended',
      message: ENDED_REMOTE_MESSAGE
    })
    transcript = endSession([transcript[0]], 'error')
    expect(transcript[1]).toMatchObject({
      source: 'local',
      kind: 'ended',
      message: ENDED_NETWORK_MESSAGE
    })
  })

  it('clears local output immediately', () => {
    const transcript = clearTranscript()
    expect(transcript).toEqual([])
  })
})

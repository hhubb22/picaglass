export type TranscriptSeparator = {
  source: 'local'
  kind: 'separator'
  startedAt: string
  previousOutcome: string | null
}

export type TranscriptEnded = {
  source: 'local'
  kind: 'ended'
  message: string
}

export type TranscriptRemote = {
  source: 'remote'
  bytes: Uint8Array
}

export type TranscriptEntry = TranscriptSeparator | TranscriptEnded | TranscriptRemote

export const ENDED_REMOTE_MESSAGE = 'The remote session ended.'
export const ENDED_NETWORK_MESSAGE = 'The session ended because of a network failure.'

export function isLocalTranscriptEntry(
  entry: TranscriptEntry | undefined
): entry is TranscriptSeparator | TranscriptEnded {
  return entry !== undefined && entry.source === 'local'
}

export function formatSeparatorText(entry: TranscriptSeparator): string {
  const started = `Session started ${entry.startedAt}`
  if (entry.previousOutcome === null) {
    return started
  }
  return `${started} · previous: ${entry.previousOutcome}`
}

export function beginAttempt(
  log: readonly TranscriptEntry[],
  startedAt: Date,
  previousOutcome: string | null
): TranscriptEntry[] {
  return [
    ...log,
    {
      source: 'local',
      kind: 'separator',
      startedAt: startedAt.toISOString(),
      previousOutcome
    }
  ]
}

export function appendRemote(
  log: readonly TranscriptEntry[],
  bytes: Uint8Array
): TranscriptEntry[] {
  return [...log, { source: 'remote', bytes: Uint8Array.from(bytes) }]
}

export function endSession(
  log: readonly TranscriptEntry[],
  reason: 'closed' | 'error'
): TranscriptEntry[] {
  return [
    ...log,
    {
      source: 'local',
      kind: 'ended',
      message: reason === 'closed' ? ENDED_REMOTE_MESSAGE : ENDED_NETWORK_MESSAGE
    }
  ]
}

export function clearTranscript(): TranscriptEntry[] {
  return []
}

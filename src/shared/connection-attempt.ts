export const CONNECTION_ATTEMPT_OUTCOMES = [
  'remote-session-ended',
  'operator-disconnected',
  'authentication-failed',
  'timed-out',
  'network-failed',
  'host-key-rejected',
  'canceled',
  'interrupted-by-previous-app-exit'
] as const

export type ConnectionAttemptOutcome = (typeof CONNECTION_ATTEMPT_OUTCOMES)[number]

export type ConnectionAttemptSummary = {
  startedAt: string
  connectedAt?: string
  endedAt?: string
  outcome?: ConnectionAttemptOutcome
}

export const ATTEMPT_OUTCOME_LABEL: Record<ConnectionAttemptOutcome, string> = {
  'remote-session-ended': 'Remote session ended',
  'operator-disconnected': 'Operator disconnected',
  'authentication-failed': 'Authentication failed',
  'timed-out': 'Timed out',
  'network-failed': 'Network failed',
  'host-key-rejected': 'Host key rejected',
  canceled: 'Canceled',
  'interrupted-by-previous-app-exit': 'Interrupted by previous app exit'
}

const FAILED_ATTEMPT_OUTCOMES: ReadonlySet<ConnectionAttemptOutcome> = new Set([
  'authentication-failed',
  'timed-out',
  'network-failed',
  'host-key-rejected',
  'canceled'
])

export type AttemptFailureBanner = {
  outcome: ConnectionAttemptOutcome
  detail: string | null
}

export type AttemptFailureSurface = {
  banner: AttemptFailureBanner | null
  unseen: boolean
}

export function isConnectionAttemptOutcome(value: unknown): value is ConnectionAttemptOutcome {
  return (
    typeof value === 'string' && (CONNECTION_ATTEMPT_OUTCOMES as readonly string[]).includes(value)
  )
}

function isInstant(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

export function parseConnectionAttempt(value: unknown): ConnectionAttemptSummary | undefined {
  if (typeof value !== 'object' || value === null || !('startedAt' in value)) {
    return undefined
  }
  if (!isInstant(value.startedAt)) {
    return undefined
  }
  const summary: ConnectionAttemptSummary = { startedAt: value.startedAt }
  if ('connectedAt' in value && isInstant(value.connectedAt)) {
    summary.connectedAt = value.connectedAt
  }
  if ('endedAt' in value && isInstant(value.endedAt)) {
    summary.endedAt = value.endedAt
  }
  if ('outcome' in value && isConnectionAttemptOutcome(value.outcome)) {
    summary.outcome = value.outcome
  }
  return summary
}

export function recoverInterruptedAttempt(
  attempt: ConnectionAttemptSummary,
  recoveredAt: Date
): ConnectionAttemptSummary {
  if (attempt.connectedAt === undefined || attempt.endedAt !== undefined) {
    return attempt
  }
  return {
    ...attempt,
    endedAt: recoveredAt.toISOString(),
    outcome: 'interrupted-by-previous-app-exit'
  }
}

export function isFailedAttemptOutcome(
  outcome: ConnectionAttemptOutcome | null | undefined
): outcome is ConnectionAttemptOutcome {
  return outcome !== null && outcome !== undefined && FAILED_ATTEMPT_OUTCOMES.has(outcome)
}

export function emptyAttemptFailure(): AttemptFailureSurface {
  return { banner: null, unseen: false }
}

export function applyAttemptFailure(
  onScreen: boolean,
  outcome: ConnectionAttemptOutcome,
  detail: string | null
): AttemptFailureSurface {
  if (!isFailedAttemptOutcome(outcome)) {
    return emptyAttemptFailure()
  }
  return {
    banner: { outcome, detail },
    unseen: !onScreen
  }
}

export function viewAttemptFailure(surface: AttemptFailureSurface): AttemptFailureSurface {
  if (!surface.unseen) {
    return surface
  }
  return { ...surface, unseen: false }
}

export function dismissAttemptFailure(): AttemptFailureSurface {
  return emptyAttemptFailure()
}

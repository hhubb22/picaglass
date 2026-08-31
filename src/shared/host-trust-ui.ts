import type { HostTrustState } from './ssh'

export const HOST_TRUST_STATUS_LABEL: Record<HostTrustState['status'], string> = {
  'not-remembered': 'Not remembered',
  session: 'Trusted for this session',
  remembered: 'Remembered'
}

export const HOST_TRUST_ACTION_LABEL = {
  trustOnce: 'Trust once',
  trustAlways: 'Trust and remember',
  replace: 'Replace and Connect',
  forget: 'Forget trusted host key',
  cancel: 'Cancel'
} as const

export function formatTrustDestination(host: string, port: number): string {
  const hostPart = host.includes(':') ? `[${host}]` : host
  return `${hostPart}:${port}`
}

export type HostTrustCard = {
  statusLabel: string
  algorithm: string | null
  fingerprint: string | null
  canForget: boolean
}

export function hostTrustCard(state: HostTrustState): HostTrustCard {
  if (state.status === 'not-remembered') {
    return {
      statusLabel: HOST_TRUST_STATUS_LABEL['not-remembered'],
      algorithm: null,
      fingerprint: null,
      canForget: false
    }
  }
  return {
    statusLabel: HOST_TRUST_STATUS_LABEL[state.status],
    algorithm: state.algorithm,
    fingerprint: state.fingerprint,
    canForget: true
  }
}

export type PendingHostKey =
  | { kind: 'unknown'; sessionId: string; fingerprint: string; algorithm: string }
  | {
      kind: 'changed'
      sessionId: string
      fingerprint: string
      algorithm: string
      previousFingerprint: string
      previousAlgorithm: string
    }

export type HostTrustPrompt =
  | {
      kind: 'unknown'
      destination: string
      algorithm: string
      fingerprint: string
    }
  | {
      kind: 'changed'
      destination: string
      algorithm: string
      fingerprint: string
      previousAlgorithm: string
      previousFingerprint: string
    }
  | { kind: 'replace-confirm'; destination: string }
  | { kind: 'forget-confirm'; destination: string }

export function unknownHostPrompt(
  destination: string,
  pending: Extract<PendingHostKey, { kind: 'unknown' }>
): Extract<HostTrustPrompt, { kind: 'unknown' }> {
  return {
    kind: 'unknown',
    destination,
    algorithm: pending.algorithm,
    fingerprint: pending.fingerprint
  }
}

export function changedHostPrompt(
  destination: string,
  pending: Extract<PendingHostKey, { kind: 'changed' }>
): Extract<HostTrustPrompt, { kind: 'changed' }> {
  return {
    kind: 'changed',
    destination,
    algorithm: pending.algorithm,
    fingerprint: pending.fingerprint,
    previousAlgorithm: pending.previousAlgorithm,
    previousFingerprint: pending.previousFingerprint
  }
}

export function requestReplaceConfirm(
  prompt: Extract<HostTrustPrompt, { kind: 'changed' }>
): Extract<HostTrustPrompt, { kind: 'replace-confirm' }> {
  return { kind: 'replace-confirm', destination: prompt.destination }
}

export function forgetConfirmPrompt(
  destination: string
): Extract<HostTrustPrompt, { kind: 'forget-confirm' }> {
  return { kind: 'forget-confirm', destination }
}

export function replaceConfirmCopy(destination: string): string {
  return `Replace the trusted host key for ${destination}? This updates Host Trust for every Connection Profile that uses this destination. Live SSH Sessions stay connected.`
}

export function forgetConfirmCopy(destination: string): string {
  return `Forget the trusted host key for ${destination}? Every Connection Profile that uses this destination will verify the host key on the next connection. Live SSH Sessions stay connected.`
}

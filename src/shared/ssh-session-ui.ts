import type { SshConnectResult, SshStatusEvent } from './ssh'
import type { PendingHostKey } from './host-trust-ui'
import {
  applyAttemptFailure,
  dismissAttemptFailure,
  isFailedAttemptOutcome,
  viewAttemptFailure,
  type AttemptFailureBanner,
  type ConnectionAttemptOutcome
} from './connection-attempt'

export type VisibleSessionState =
  'no-active-session' | 'connecting' | 'verification-required' | 'connected' | 'disconnecting'

export type SessionIndicator = 'idle' | 'pending' | 'attention' | 'live' | 'ending'

export const SESSION_STATE_LABEL: Record<VisibleSessionState, string> = {
  'no-active-session': 'No active session',
  connecting: 'Connecting',
  'verification-required': 'Verification required',
  connected: 'Connected',
  disconnecting: 'Disconnecting'
}

export function sessionIndicator(state: VisibleSessionState): SessionIndicator {
  if (state === 'no-active-session') {
    return 'idle'
  }
  if (state === 'connecting') {
    return 'pending'
  }
  if (state === 'verification-required') {
    return 'attention'
  }
  if (state === 'connected') {
    return 'live'
  }
  return 'ending'
}

export type SecretKind = 'password' | 'passphrase'

export type SecretPrompt = {
  kind: SecretKind
  message: string | null
}

export type ProfileSessionUi = {
  state: VisibleSessionState
  sessionId: string | null
  pendingHostKey: PendingHostKey | null
  secretPrompt: SecretPrompt | null
  secretKind: SecretKind | null
  error: string | null
  lastOutcome: ConnectionAttemptOutcome | null
  missingPrivateKey: boolean
  failureBanner: AttemptFailureBanner | null
  unseenFailure: boolean
}

export function emptyProfileSession(): ProfileSessionUi {
  return {
    state: 'no-active-session',
    sessionId: null,
    pendingHostKey: null,
    secretPrompt: null,
    secretKind: null,
    error: null,
    lastOutcome: null,
    missingPrivateKey: false,
    failureBanner: null,
    unseenFailure: false
  }
}

export function connectionFieldsLocked(state: VisibleSessionState): boolean {
  return state !== 'no-active-session'
}

export const MISSING_PRIVATE_KEY_MESSAGE =
  'The private-key file could not be read. Choose a replacement to save the new path and continue.'

export function applyMissingPrivateKey(session: ProfileSessionUi): ProfileSessionUi {
  return {
    ...emptyProfileSession(),
    lastOutcome: session.lastOutcome,
    missingPrivateKey: true,
    error: MISSING_PRIVATE_KEY_MESSAGE
  }
}

export function friendlyAuthFailure(kind: SecretKind): string {
  if (kind === 'password') {
    return 'Authentication failed. Check the password and try again.'
  }
  return 'Authentication failed. Check the passphrase and try again.'
}

export function promptForSecret(
  session: ProfileSessionUi,
  kind: SecretKind,
  message: string | null = null
): ProfileSessionUi {
  return {
    ...session,
    secretPrompt: { kind, message },
    secretKind: kind,
    error: null,
    missingPrivateKey: false
  }
}

export function beginConnect(
  session: ProfileSessionUi,
  auth: { method: 'password' | 'privateKey' }
): ProfileSessionUi {
  if (auth.method === 'password') {
    return promptForSecret(session, 'password')
  }
  return {
    ...emptyProfileSession(),
    lastOutcome: session.lastOutcome,
    state: 'connecting'
  }
}

export function cancelSecretPrompt(session: ProfileSessionUi): ProfileSessionUi {
  if (session.secretPrompt === null) {
    return session
  }
  return {
    ...emptyProfileSession(),
    lastOutcome: session.lastOutcome,
    failureBanner: session.failureBanner,
    unseenFailure: session.unseenFailure
  }
}

export function submitSecret(session: ProfileSessionUi): ProfileSessionUi {
  return {
    ...session,
    state: 'connecting',
    secretPrompt: null,
    error: null
  }
}

export function applyConnectResult(
  session: ProfileSessionUi,
  result: SshConnectResult
): ProfileSessionUi {
  if (result.ok) {
    return {
      ...session,
      state: 'connected',
      sessionId: result.sessionId,
      pendingHostKey: null,
      secretPrompt: null,
      error: null,
      missingPrivateKey: false
    }
  }
  if (result.reason === 'secret-required') {
    return {
      ...emptyProfileSession(),
      secretPrompt: { kind: result.kind, message: null },
      secretKind: result.kind
    }
  }
  if (result.reason === 'host-unknown') {
    return {
      ...session,
      state: 'verification-required',
      sessionId: null,
      pendingHostKey: {
        kind: 'unknown',
        sessionId: result.sessionId,
        fingerprint: result.fingerprint,
        algorithm: result.algorithm
      },
      secretPrompt: null,
      error: null
    }
  }
  if (result.reason === 'host-changed') {
    return {
      ...session,
      state: 'verification-required',
      sessionId: null,
      pendingHostKey: {
        kind: 'changed',
        sessionId: result.sessionId,
        fingerprint: result.fingerprint,
        algorithm: result.algorithm,
        previousFingerprint: result.previousFingerprint,
        previousAlgorithm: result.previousAlgorithm
      },
      secretPrompt: null,
      error: null
    }
  }
  if (result.reason === 'invalid') {
    if (session.state === 'connected' || session.state === 'disconnecting') {
      return {
        ...session,
        error: result.message
      }
    }
    return {
      ...emptyProfileSession(),
      lastOutcome: session.lastOutcome,
      error: result.message
    }
  }
  if (result.reason === 'auth-failed') {
    if (session.secretKind !== null) {
      return {
        ...emptyProfileSession(),
        lastOutcome: 'authentication-failed',
        secretKind: session.secretKind,
        secretPrompt: {
          kind: session.secretKind,
          message: friendlyAuthFailure(session.secretKind)
        }
      }
    }
    return {
      ...emptyProfileSession(),
      lastOutcome: 'authentication-failed',
      error: 'Authentication failed.'
    }
  }
  if (result.reason === 'canceled') {
    const lastOutcome: ConnectionAttemptOutcome =
      session.pendingHostKey?.kind === 'changed' ? 'host-key-rejected' : 'canceled'
    return {
      ...emptyProfileSession(),
      lastOutcome
    }
  }
  const lastOutcome: ConnectionAttemptOutcome =
    result.reason === 'timeout' ? 'timed-out' : 'network-failed'
  return {
    ...emptyProfileSession(),
    lastOutcome,
    error: result.message
  }
}

export function beginDisconnect(session: ProfileSessionUi): ProfileSessionUi {
  if (session.state !== 'connected' || session.sessionId === null) {
    return session
  }
  return {
    ...session,
    state: 'disconnecting',
    error: null
  }
}

export function canCancelAttempt(state: VisibleSessionState): boolean {
  return state === 'connecting' || state === 'verification-required'
}

export function canDisconnectSession(state: VisibleSessionState): boolean {
  return state === 'connected'
}

function isActiveSession(state: VisibleSessionState): boolean {
  return state !== 'no-active-session'
}

export function activeSessionCount(sessions: Record<string, ProfileSessionUi>): number {
  let count = 0
  for (const session of Object.values(sessions)) {
    if (isActiveSession(session.state)) {
      count += 1
    }
  }
  return count
}

export type SessionConfirmation = {
  title: string
  confirmLabel: string
  body: string
}

export type UnsavedCloseKind = 'create' | 'edit'

function activeSessionPhrase(activeCount: number): string {
  if (activeCount === 1) {
    return '1 active SSH Session'
  }
  return `${activeCount} active SSH Sessions`
}

export function disconnectProfileConfirmation(label: string): SessionConfirmation {
  return {
    title: `Disconnect “${label}”?`,
    confirmLabel: 'Disconnect',
    body: `This ends the SSH Session for “${label}”.`
  }
}

export function disconnectAllConfirmation(activeCount: number): SessionConfirmation | null {
  if (activeCount < 1) {
    return null
  }
  return {
    title: 'Disconnect all sessions?',
    confirmLabel: 'Disconnect All',
    body: `This ends ${activeSessionPhrase(activeCount)}.`
  }
}

export function windowCloseConfirmation(input: {
  unsaved: UnsavedCloseKind | null
  activeCount: number
}): SessionConfirmation | null {
  const { unsaved, activeCount } = input
  if (unsaved === null && activeCount < 1) {
    return null
  }
  if (activeCount < 1) {
    if (unsaved === 'edit') {
      return {
        title: 'Discard unsaved edits?',
        confirmLabel: 'Discard',
        body: 'Navigating away or closing will not keep these edits.'
      }
    }
    return {
      title: 'Discard this unsaved Connection Profile?',
      confirmLabel: 'Discard',
      body: 'Navigating away or closing will not keep this profile.'
    }
  }
  if (unsaved === null) {
    return {
      title: 'Disconnect sessions and close?',
      confirmLabel: 'Disconnect and close',
      body: `Closing ends ${activeSessionPhrase(activeCount)}. No session stays alive after exit.`
    }
  }
  const unsavedSentence =
    unsaved === 'edit'
      ? 'Unsaved edits will be discarded.'
      : 'The unsaved Connection Profile will be discarded.'
  return {
    title: 'Discard unsaved work and disconnect sessions?',
    confirmLabel: 'Discard and close',
    body: `${unsavedSentence} Closing also ends ${activeSessionPhrase(activeCount)}. No session stays alive after exit.`
  }
}

function tracksSession(session: ProfileSessionUi, sessionId: string): boolean {
  return session.sessionId === sessionId || session.pendingHostKey?.sessionId === sessionId
}

export function applySessionStatus(
  session: ProfileSessionUi,
  event: SshStatusEvent
): ProfileSessionUi {
  if (!tracksSession(session, event.sessionId)) {
    return session
  }
  if (event.type === 'connected') {
    return {
      ...session,
      state: 'connected',
      sessionId: event.sessionId,
      pendingHostKey: null,
      error: null
    }
  }
  const lastOutcome: ConnectionAttemptOutcome =
    session.state === 'disconnecting'
      ? 'operator-disconnected'
      : event.type === 'error'
        ? 'network-failed'
        : 'remote-session-ended'
  return {
    ...emptyProfileSession(),
    lastOutcome
  }
}

export function withAttemptFailure(
  session: ProfileSessionUi,
  onScreen: boolean,
  detail: string | null = session.error
): ProfileSessionUi {
  if (session.state !== 'no-active-session' || !isFailedAttemptOutcome(session.lastOutcome)) {
    return {
      ...session,
      failureBanner: null,
      unseenFailure: false
    }
  }
  const surface = applyAttemptFailure(onScreen, session.lastOutcome, detail)
  return {
    ...session,
    failureBanner: surface.banner,
    unseenFailure: surface.unseen
  }
}

export function markAttemptFailureViewed(session: ProfileSessionUi): ProfileSessionUi {
  const surface = viewAttemptFailure({
    banner: session.failureBanner,
    unseen: session.unseenFailure
  })
  return {
    ...session,
    failureBanner: surface.banner,
    unseenFailure: surface.unseen
  }
}

export function dismissSessionFailure(session: ProfileSessionUi): ProfileSessionUi {
  const surface = dismissAttemptFailure()
  return {
    ...session,
    failureBanner: surface.banner,
    unseenFailure: surface.unseen,
    error: null
  }
}

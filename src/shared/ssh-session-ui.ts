import type { SshConnectResult, SshStatusEvent } from './ssh'
import type { PendingHostKey } from './host-trust-ui'

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
  lastOutcome: string | null
  missingPrivateKey: boolean
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
    missingPrivateKey: false
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
    lastOutcome: session.lastOutcome
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
        lastOutcome: 'authentication failed',
        secretKind: session.secretKind,
        secretPrompt: {
          kind: session.secretKind,
          message: friendlyAuthFailure(session.secretKind)
        }
      }
    }
    return {
      ...emptyProfileSession(),
      lastOutcome: 'authentication failed',
      error: 'Authentication failed.'
    }
  }
  if (result.reason === 'canceled') {
    return {
      ...emptyProfileSession(),
      lastOutcome: 'canceled',
      error: null
    }
  }
  const lastOutcome = result.reason === 'timeout' ? 'timed out' : 'network failed'
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
  const lastOutcome =
    session.state === 'disconnecting'
      ? 'operator disconnected'
      : event.type === 'error'
        ? 'network failed'
        : 'remote session ended'
  return {
    ...emptyProfileSession(),
    lastOutcome
  }
}

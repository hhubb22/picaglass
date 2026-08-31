import type { SshConnectRequest, SshConnectResult } from './ssh'
import type { SshEventInbox } from './ssh-event-inbox'

export type SshConnectUi = {
  sessionId: string | null
  pending: { sessionId: string; fingerprint: string; algorithm: string } | null
  error: string | null
}

function applyConnectResult(
  previous: string | null,
  current: string | null,
  result: SshConnectResult
): SshConnectUi {
  if (result.ok) {
    return { sessionId: result.sessionId, pending: null, error: null }
  }
  if (result.reason === 'host-unknown' || result.reason === 'host-changed') {
    return {
      sessionId: null,
      pending: {
        sessionId: result.sessionId,
        fingerprint: result.fingerprint,
        algorithm: result.algorithm
      },
      error: null
    }
  }
  const error = 'message' in result ? result.message : result.reason
  if (result.reason === 'invalid') {
    return {
      sessionId: current === previous ? previous : current,
      pending: null,
      error
    }
  }
  return { sessionId: null, pending: null, error }
}

export function syncSshConnectInbox(inbox: SshEventInbox, next: SshConnectUi): void {
  if (next.sessionId === null) {
    inbox.deactivate()
    return
  }
  inbox.activate(next.sessionId)
}

export async function runSshConnect(input: {
  connect: (req: SshConnectRequest) => Promise<SshConnectResult>
  req: SshConnectRequest
  sessionId: string | null
  currentSessionId: () => string | null
}): Promise<SshConnectUi> {
  const result = await input.connect(input.req)
  return applyConnectResult(input.sessionId, input.currentSessionId(), result)
}

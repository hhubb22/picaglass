import type { SshStatusEvent } from './ssh'

type QueuedSshEvent =
  | { kind: 'data'; sessionId: string; chunk: Uint8Array }
  | {
      kind: 'status'
      event: SshStatusEvent
    }

export const SSH_INBOX_MAX_QUEUED_EVENTS = 64
export const SSH_INBOX_MAX_HANDOFF_SESSIONS = 8

export type SshEventInbox = {
  beginHandoff: () => void
  endHandoff: () => void
  activate: (sessionId: string) => void
  deactivate: () => void
  handleData: (sessionId: string, chunk: Uint8Array) => void
  handleStatus: (event: SshStatusEvent) => void
}

export function createSshEventInbox(handlers: {
  onData: (sessionId: string, chunk: Uint8Array) => void
  onStatus: (event: SshStatusEvent) => void
}): SshEventInbox {
  let activeId: string | null = null
  let handoff = false
  const queued = new Map<string, QueuedSshEvent[]>()

  function deliverData(sessionId: string, chunk: Uint8Array): void {
    if (sessionId !== activeId) {
      return
    }
    handlers.onData(sessionId, chunk)
  }

  function deliverStatus(event: SshStatusEvent): void {
    if (event.sessionId !== activeId) {
      return
    }
    handlers.onStatus(event)
    if (event.type === 'closed' || event.type === 'error') {
      activeId = null
    }
  }

  function queueEvent(sessionId: string, item: QueuedSshEvent): void {
    if (!handoff) {
      return
    }
    let bucket = queued.get(sessionId)
    if (bucket === undefined) {
      if (queued.size >= SSH_INBOX_MAX_HANDOFF_SESSIONS) {
        return
      }
      bucket = []
      queued.set(sessionId, bucket)
    }
    if (bucket.length >= SSH_INBOX_MAX_QUEUED_EVENTS) {
      return
    }
    bucket.push(item)
  }

  function clearHandoff(): void {
    handoff = false
    queued.clear()
  }

  return {
    beginHandoff() {
      handoff = true
    },
    endHandoff() {
      clearHandoff()
    },
    activate(sessionId) {
      const pending = queued.get(sessionId) ?? []
      clearHandoff()
      activeId = sessionId
      for (const item of pending) {
        if (item.kind === 'data') {
          deliverData(item.sessionId, item.chunk)
        } else {
          deliverStatus(item.event)
        }
      }
    },
    deactivate() {
      clearHandoff()
      activeId = null
    },
    handleData(sessionId, chunk) {
      if (sessionId === activeId) {
        handlers.onData(sessionId, chunk)
        return
      }
      queueEvent(sessionId, { kind: 'data', sessionId, chunk })
    },
    handleStatus(event) {
      if (event.sessionId === activeId) {
        deliverStatus(event)
        return
      }
      queueEvent(event.sessionId, { kind: 'status', event })
    }
  }
}

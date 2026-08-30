import { describe, expect, it } from 'vitest'
import { createSshEventInbox, SSH_INBOX_MAX_QUEUED_EVENTS } from './ssh-event-inbox'

describe('createSshEventInbox', () => {
  it('delivers data that arrived before activate', () => {
    const chunks: Uint8Array[] = []
    const inbox = createSshEventInbox({
      onData: (_id, chunk) => {
        chunks.push(chunk)
      },
      onStatus: () => undefined
    })

    inbox.beginHandoff()
    inbox.handleData('s1', Uint8Array.from([0xff, 0x61]))
    expect(chunks).toEqual([])

    inbox.activate('s1')

    expect(chunks).toEqual([Uint8Array.from([0xff, 0x61])])
  })

  it('applies a close that arrived before activate so the session is not left live', () => {
    const statuses: string[] = []
    let live = false
    const inbox = createSshEventInbox({
      onData: () => undefined,
      onStatus: (event) => {
        statuses.push(event.type)
        if (event.type === 'closed') {
          live = false
        }
      }
    })

    inbox.beginHandoff()
    inbox.handleStatus({ sessionId: 's1', type: 'closed' })
    live = true
    inbox.activate('s1')

    expect(statuses).toEqual(['closed'])
    expect(live).toBe(false)
  })

  it('drops queued events for a different session', () => {
    const chunks: Uint8Array[] = []
    const inbox = createSshEventInbox({
      onData: (_id, chunk) => {
        chunks.push(chunk)
      },
      onStatus: () => undefined
    })

    inbox.beginHandoff()
    inbox.handleData('old', Uint8Array.from([1]))
    inbox.activate('s1')

    expect(chunks).toEqual([])
  })

  it('queues data for a new session while another session is still active', () => {
    const chunks: Uint8Array[] = []
    const inbox = createSshEventInbox({
      onData: (_id, chunk) => {
        chunks.push(chunk)
      },
      onStatus: () => undefined
    })

    inbox.activate('old')
    inbox.beginHandoff()
    inbox.handleData('new', Uint8Array.from([0xff, 0x61]))
    expect(chunks).toEqual([])

    inbox.activate('new')

    expect(chunks).toEqual([Uint8Array.from([0xff, 0x61])])
  })

  it('activate flushes only the new session and drops other queued ids', () => {
    const chunks: Uint8Array[] = []
    const inbox = createSshEventInbox({
      onData: (_id, chunk) => {
        chunks.push(chunk)
      },
      onStatus: () => undefined
    })

    inbox.activate('old')
    inbox.beginHandoff()
    inbox.handleData('other', Uint8Array.from([1]))
    inbox.handleData('new', Uint8Array.from([2]))
    inbox.activate('new')

    expect(chunks).toEqual([Uint8Array.from([2])])
  })

  it('drops data for a non-active session when not handing off', () => {
    const chunks: Uint8Array[] = []
    const inbox = createSshEventInbox({
      onData: (_id, chunk) => {
        chunks.push(chunk)
      },
      onStatus: () => undefined
    })

    inbox.activate('old')
    inbox.handleData('new', Uint8Array.from([0xff, 0x61]))
    inbox.activate('new')

    expect(chunks).toEqual([])
  })

  it('drops extra handoff events past the queue cap', () => {
    const chunks: Uint8Array[] = []
    const inbox = createSshEventInbox({
      onData: (_id, chunk) => {
        chunks.push(chunk)
      },
      onStatus: () => undefined
    })

    inbox.beginHandoff()
    for (let i = 0; i <= SSH_INBOX_MAX_QUEUED_EVENTS; i += 1) {
      inbox.handleData('s1', Uint8Array.from([i]))
    }
    inbox.activate('s1')

    expect(chunks).toHaveLength(SSH_INBOX_MAX_QUEUED_EVENTS)
    expect(chunks[0]).toEqual(Uint8Array.from([0]))
    expect(chunks[SSH_INBOX_MAX_QUEUED_EVENTS - 1]).toEqual(
      Uint8Array.from([SSH_INBOX_MAX_QUEUED_EVENTS - 1])
    )
  })
})

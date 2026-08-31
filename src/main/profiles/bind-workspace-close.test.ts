import { describe, expect, it } from 'vitest'
import {
  bindWorkspaceClose,
  confirmWorkspaceClose,
  setWorkspaceCloseGuard,
  type ClosableWorkspaceWindow
} from './bind-workspace-close'

function fakeWindow(): {
  window: ClosableWorkspaceWindow
  preventCount: () => number
  sent: string[]
  closeCount: () => number
  fireClose: () => void
} {
  const closeListeners: Array<(event?: { preventDefault: () => void }) => void> = []
  const closedListeners: Array<() => void> = []
  let preventCount = 0
  let closeCount = 0
  const sent: string[] = []
  const window: ClosableWorkspaceWindow = {
    webContents: {
      send(channel) {
        sent.push(channel)
      }
    },
    on(event, listener) {
      if (event === 'close') {
        closeListeners.push(listener)
        return
      }
      closedListeners.push(listener)
    },
    close() {
      closeCount += 1
      const event = {
        preventDefault() {
          preventCount += 1
        }
      }
      for (const listener of closeListeners) {
        listener(event)
      }
      if (preventCount === closeCount) {
        return
      }
      for (const listener of closedListeners) {
        listener()
      }
    }
  }
  return {
    window,
    preventCount: () => preventCount,
    sent,
    closeCount: () => closeCount,
    fireClose() {
      window.close()
    }
  }
}

describe('bindWorkspaceClose', () => {
  it('closes immediately when there is no dirty creation', () => {
    const fake = fakeWindow()
    bindWorkspaceClose(fake.window)

    fake.fireClose()
    expect(fake.sent).toEqual([])
    expect(fake.preventCount()).toBe(0)
    expect(fake.closeCount()).toBe(1)
  })

  it('blocks close while a dirty creation is open until the renderer confirms', () => {
    const fake = fakeWindow()
    bindWorkspaceClose(fake.window)
    setWorkspaceCloseGuard(fake.window, true)

    fake.fireClose()
    expect(fake.sent).toEqual(['workspace:close-requested'])
    expect(fake.preventCount()).toBe(1)
    expect(fake.closeCount()).toBe(1)

    confirmWorkspaceClose(fake.window)
    expect(fake.closeCount()).toBe(2)
    expect(fake.preventCount()).toBe(1)
  })

  it('blocks close while sessions are active even when the form is clean', () => {
    const fake = fakeWindow()
    bindWorkspaceClose(fake.window, { shouldBlock: () => true })

    fake.fireClose()
    expect(fake.sent).toEqual(['workspace:close-requested'])
    expect(fake.preventCount()).toBe(1)
    expect(fake.closeCount()).toBe(1)
  })

  it('runs beforeClose then closes when the renderer confirms', async () => {
    const fake = fakeWindow()
    const order: string[] = []
    bindWorkspaceClose(fake.window, {
      shouldBlock: () => true,
      beforeClose: async () => {
        order.push('disconnect')
      }
    })

    fake.fireClose()
    order.push('warned')
    await confirmWorkspaceClose(fake.window)
    order.push('closed')
    expect(order).toEqual(['warned', 'disconnect', 'closed'])
    expect(fake.closeCount()).toBe(2)
  })

  it('treats app quit like window close so macOS Cmd+Q also warns then disconnects', async () => {
    const fake = fakeWindow()
    const quitListeners: Array<(event: { preventDefault: () => void }) => void> = []
    let quitCount = 0
    let onQuitCount = 0
    const app = {
      on(_event: 'before-quit', listener: (event: { preventDefault: () => void }) => void) {
        quitListeners.push(listener)
      },
      quit() {
        quitCount += 1
        const event = {
          preventDefault() {
            return
          }
        }
        for (const listener of quitListeners) {
          listener(event)
        }
      }
    }
    bindWorkspaceClose(fake.window, {
      shouldBlock: () => true,
      beforeClose: async () => undefined,
      app,
      onQuit: () => {
        onQuitCount += 1
      }
    })

    app.quit()
    expect(fake.sent).toEqual(['workspace:close-requested'])
    expect(quitCount).toBe(1)
    expect(onQuitCount).toBe(0)

    await confirmWorkspaceClose(fake.window)
    expect(quitCount).toBe(2)
    expect(onQuitCount).toBe(1)
    expect(fake.closeCount()).toBe(0)
  })
})

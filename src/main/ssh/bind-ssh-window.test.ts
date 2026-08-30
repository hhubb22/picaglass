import { describe, expect, it } from 'vitest'
import { bindSshWindow, type SshWindow } from './bind-ssh-window'

function destroyableWindow(id: number): { window: SshWindow; close: () => void } {
  let destroyed = false
  const listeners: Array<() => void> = []
  const window: SshWindow = {
    get webContents() {
      if (destroyed) {
        throw new Error('Object has been destroyed')
      }
      return { id }
    },
    on(_event, listener) {
      listeners.push(listener)
    }
  }
  return {
    window,
    close: () => {
      destroyed = true
      for (const listener of listeners) {
        listener()
      }
    }
  }
}

describe('bindSshWindow', () => {
  it('disposes the window sender after the webContents is destroyed', () => {
    const disposed: number[] = []
    const fake = destroyableWindow(7)

    bindSshWindow(fake.window, {
      disposeSender: (senderId) => {
        disposed.push(senderId)
      }
    })
    fake.close()

    expect(disposed).toEqual([7])
  })
})

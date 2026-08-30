export type ClosableWorkspaceWindow = {
  webContents: {
    send: (channel: string) => void
  }
  on: (
    event: 'close' | 'closed',
    listener: (event?: { preventDefault: () => void }) => void
  ) => void
  close: () => void
}

const closeGuards = new WeakMap<
  object,
  {
    allowClose: boolean
    blockClose: boolean
    confirm: () => void
  }
>()

export function bindWorkspaceClose(window: ClosableWorkspaceWindow): void {
  const guard = {
    allowClose: false,
    blockClose: false,
    confirm: () => {
      guard.allowClose = true
      window.close()
    }
  }
  closeGuards.set(window, guard)
  window.on('close', (event) => {
    if (guard.allowClose || !guard.blockClose || event === undefined) {
      return
    }
    event.preventDefault()
    window.webContents.send('workspace:close-requested')
  })
  window.on('closed', () => {
    closeGuards.delete(window)
  })
}

export function setWorkspaceCloseGuard(window: object, blockClose: boolean): void {
  const guard = closeGuards.get(window)
  if (guard === undefined) {
    return
  }
  guard.blockClose = blockClose
}

export function confirmWorkspaceClose(window: object): void {
  closeGuards.get(window)?.confirm()
}

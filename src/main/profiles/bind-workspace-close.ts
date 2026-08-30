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

const sessions = new WeakMap<
  object,
  {
    allowClose: boolean
    blockClose: boolean
    confirm: () => void
  }
>()

export function bindWorkspaceClose(window: ClosableWorkspaceWindow): void {
  const session = {
    allowClose: false,
    blockClose: false,
    confirm: () => {
      session.allowClose = true
      window.close()
    }
  }
  sessions.set(window, session)
  window.on('close', (event) => {
    if (session.allowClose || !session.blockClose || event === undefined) {
      return
    }
    event.preventDefault()
    window.webContents.send('workspace:close-requested')
  })
  window.on('closed', () => {
    sessions.delete(window)
  })
}

export function setWorkspaceCloseGuard(window: object, blockClose: boolean): void {
  const session = sessions.get(window)
  if (session === undefined) {
    return
  }
  session.blockClose = blockClose
}

export function confirmWorkspaceClose(window: object): void {
  sessions.get(window)?.confirm()
}

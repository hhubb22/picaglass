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

export type WorkspaceCloseApp = {
  on: (event: 'before-quit', listener: (event: { preventDefault: () => void }) => void) => void
  quit: () => void
}

export type WorkspaceCloseOptions = {
  shouldBlock?: () => boolean
  beforeClose?: () => void | Promise<void>
  app?: WorkspaceCloseApp
  onQuit?: () => void
}

type CloseGuard = {
  allowClose: boolean
  blockClose: boolean
  quitRequested: boolean
  shouldBlock?: () => boolean
  confirm: () => void | Promise<void>
}

type ActiveClose = {
  window: ClosableWorkspaceWindow
  guard: CloseGuard
}

const closeGuards = new WeakMap<object, CloseGuard>()
const appsBound = new WeakSet<object>()
let activeClose: ActiveClose | undefined

function needsConfirm(guard: CloseGuard): boolean {
  if (guard.allowClose) {
    return false
  }
  return guard.blockClose || guard.shouldBlock?.() === true
}

function bindAppQuitOnce(app: WorkspaceCloseApp, onQuit: (() => void) | undefined): void {
  if (appsBound.has(app)) {
    return
  }
  appsBound.add(app)
  app.on('before-quit', (event) => {
    const current = activeClose
    if (current === undefined || !needsConfirm(current.guard)) {
      onQuit?.()
      return
    }
    current.guard.quitRequested = true
    event.preventDefault()
    current.window.webContents.send('workspace:close-requested')
  })
}

export function bindWorkspaceClose(
  window: ClosableWorkspaceWindow,
  options?: WorkspaceCloseOptions
): void {
  const guard: CloseGuard = {
    allowClose: false,
    blockClose: false,
    quitRequested: false,
    shouldBlock: options?.shouldBlock,
    confirm: () => {
      const finish = (): void => {
        guard.allowClose = true
        if (guard.quitRequested && options?.app !== undefined) {
          options.app.quit()
          return
        }
        window.close()
      }
      if (options?.beforeClose === undefined) {
        finish()
        return
      }
      return Promise.resolve(options.beforeClose()).then(finish)
    }
  }
  closeGuards.set(window, guard)
  activeClose = { window, guard }
  window.on('close', (event) => {
    if (!needsConfirm(guard) || event === undefined) {
      return
    }
    event.preventDefault()
    window.webContents.send('workspace:close-requested')
  })
  window.on('closed', () => {
    closeGuards.delete(window)
    if (activeClose?.window === window) {
      activeClose = undefined
    }
  })
  if (options?.app !== undefined) {
    bindAppQuitOnce(options.app, options.onQuit)
  }
}

export function setWorkspaceCloseGuard(window: object, blockClose: boolean): void {
  const guard = closeGuards.get(window)
  if (guard === undefined) {
    return
  }
  guard.blockClose = blockClose
}

export function confirmWorkspaceClose(window: object): void | Promise<void> {
  return closeGuards.get(window)?.confirm()
}

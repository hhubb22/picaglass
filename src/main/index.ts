import { app, shell, BrowserWindow, dialog, webContents, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { bindSshWindow } from './ssh/bind-ssh-window'
import { createSshApi } from './ssh/create-ssh-api'
import { registerSshIpc } from './ssh/register-ssh-ipc'
import { createDiagnosticsApi } from './diagnostics/create-diagnostics-api'
import { registerDiagnosticsIpc } from './diagnostics/register-diagnostics-ipc'
import { bindWorkspaceClose, type ClosableWorkspaceWindow } from './profiles/bind-workspace-close'
import { createProfileApi } from './profiles/create-profile-api'
import { registerProfileIpc } from './profiles/register-profile-ipc'
import { registerWorkspaceCloseIpc } from './profiles/register-workspace-close-ipc'

function openFileDialog(
  options: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  const parent = BrowserWindow.getFocusedWindow()
  if (parent) {
    return dialog.showOpenDialog(parent, options)
  }
  return dialog.showOpenDialog(options)
}

function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#161616' : '#ffffff'
}

function createWindow(sshApi: ReturnType<typeof createSshApi>): void {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: windowBackground(),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  const applyWindowBackground = (): void => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(windowBackground())
    }
  }
  nativeTheme.on('updated', applyWindowBackground)
  mainWindow.on('closed', () => {
    nativeTheme.off('updated', applyWindowBackground)
  })

  const senderId = mainWindow.webContents.id
  bindSshWindow(mainWindow, sshApi)
  bindWorkspaceClose(mainWindow as unknown as ClosableWorkspaceWindow, {
    shouldBlock: () => sshApi.activeSessionCount({ id: senderId }) > 0,
    activeCount: () => sshApi.activeSessionCount({ id: senderId }),
    beforeClose: () => sshApi.disconnectAll({ id: senderId }),
    app,
    onQuit: () => {
      sshApi.dispose()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.picaglass')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const profileApi = createProfileApi({
    userDataPath: app.getPath('userData'),
    dialogs: {
      showOpenDialog: openFileDialog
    }
  })
  const sshApi = createSshApi({
    userDataPath: app.getPath('userData'),
    dialogs: {
      showOpenDialog: openFileDialog
    },
    emitTo: (senderId, channel, payload) => {
      const contents = webContents.fromId(senderId)
      if (contents === undefined || contents.isDestroyed()) {
        return
      }
      contents.send(channel, structuredClone(payload))
    },
    resolveProfile: (profileId) => profileApi.getConnectTarget(profileId),
    recordAttempt: (profileId, summary) => profileApi.recordAttempt(profileId, summary),
    readSnapshot: (profileId) => profileApi.getSnapshot(profileId),
    recordSnapshot: async (profileId, snapshot) => {
      await profileApi.recordSnapshot(profileId, snapshot)
    }
  })
  profileApi.setSessionHooks({
    isOccupied: (profileId) => sshApi.hasSession(profileId),
    dropSession: async (profileId) => {
      sshApi.dropProfileSession(profileId)
    }
  })
  registerSshIpc(sshApi)
  registerDiagnosticsIpc(
    createDiagnosticsApi({
      hasLiveSession: (profileId) => sshApi.hasLiveSession(profileId),
      exec: (profileId, command) => sshApi.execOnSession(profileId, command)
    })
  )
  registerProfileIpc(profileApi)
  registerWorkspaceCloseIpc()

  createWindow(sshApi)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(sshApi)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

import { app, shell, BrowserWindow, dialog, webContents } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { createSshApi } from './ssh/create-ssh-api'
import { registerSshIpc } from './ssh/register-ssh-ipc'

function createWindow(sshApi: ReturnType<typeof createSshApi>): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    sshApi.disposeSender(mainWindow.webContents.id)
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

  const sshApi = createSshApi({
    userDataPath: app.getPath('userData'),
    dialogs: {
      showOpenDialog: (options) => {
        const parent = BrowserWindow.getFocusedWindow()
        if (parent) {
          return dialog.showOpenDialog(parent, options)
        }
        return dialog.showOpenDialog(options)
      },
      showMessageBox: (options) => {
        const parent = BrowserWindow.getFocusedWindow()
        if (parent) {
          return dialog.showMessageBox(parent, options)
        }
        return dialog.showMessageBox(options)
      }
    },
    emitTo: (senderId, channel, payload) => {
      const contents = webContents.fromId(senderId)
      if (contents === undefined || contents.isDestroyed()) {
        return
      }
      contents.send(channel, structuredClone(payload))
    }
  })
  registerSshIpc(sshApi)

  app.on('before-quit', () => {
    sshApi.dispose()
  })

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

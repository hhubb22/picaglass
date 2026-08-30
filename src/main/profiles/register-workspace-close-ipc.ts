import { BrowserWindow, ipcMain } from 'electron'
import { confirmWorkspaceClose, setWorkspaceCloseGuard } from './bind-workspace-close'

export function registerWorkspaceCloseIpc(): void {
  ipcMain.handle('workspace:confirmClose', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window === null) {
      return
    }
    confirmWorkspaceClose(window)
  })
  ipcMain.handle('workspace:setCloseGuard', (event, blockClose: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window === null) {
      return
    }
    setWorkspaceCloseGuard(window, blockClose === true)
  })
}

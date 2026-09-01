/**
 * Electron main for the baseline screenshot harness (ticket #56).
 *
 * Opens the built renderer (out/renderer) in a plain BrowserWindow with NO
 * preload: window.api comes from the baseline-mock.js script that capture.mjs
 * injects into out/renderer/index.html. No SSH, profile store, or MCP server
 * is touched.
 */
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: true
    }
  })
  window.on('ready-to-show', () => {
    window.show()
  })
  void window.loadFile(join(__dirname, '../../out/renderer/index.html'))
})

app.on('window-all-closed', () => {
  app.quit()
})

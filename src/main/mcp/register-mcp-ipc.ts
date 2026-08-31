import { ipcMain } from 'electron'
import type { McpConfigResult, McpConfigSnippets } from '../../shared/mcp-config'

export function registerMcpIpc(getSnippets: () => McpConfigSnippets | undefined): void {
  ipcMain.handle('mcp:getConfig', (): McpConfigResult => {
    const snippets = getSnippets()
    if (snippets === undefined) {
      return { available: false }
    }
    return { available: true, ...snippets }
  })
}

import { ipcMain } from 'electron'
import type { DiagnosticsApi } from './create-diagnostics-api'
import type { DeviceFactsRun } from '../../shared/picos/device-facts'

function noSession(): DeviceFactsRun {
  return { kind: 'no-session' }
}

export function registerDiagnosticsIpc(api: DiagnosticsApi): void {
  ipcMain.handle('diagnostics:runDeviceFacts', (_event, profileId: unknown) => {
    if (typeof profileId !== 'string' || profileId.trim().length === 0) {
      return noSession()
    }
    return api.runDeviceFacts(profileId)
  })
}

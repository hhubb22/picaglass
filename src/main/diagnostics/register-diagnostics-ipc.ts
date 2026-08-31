import { ipcMain } from 'electron'
import type { DiagnosticsApi } from './create-diagnostics-api'
import type { DeviceFactsRun } from '../../shared/picos/device-facts'
import type { InterfaceStatusRun } from '../../shared/picos/interface-status'
import type { L2Run } from '../../shared/picos/l2'

function noSession(): DeviceFactsRun {
  return { kind: 'no-session' }
}

function parseInterfaceList(value: unknown): string[] | { invalid: string } {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return { invalid: 'interface names must be a list of strings' }
  }
  return value
}

export function registerDiagnosticsIpc(api: DiagnosticsApi): void {
  ipcMain.handle('diagnostics:runDeviceFacts', (_event, profileId: unknown) => {
    if (typeof profileId !== 'string' || profileId.trim().length === 0) {
      return noSession()
    }
    return api.runDeviceFacts(profileId)
  })
  ipcMain.handle(
    'diagnostics:runInterfaceStatus',
    (
      _event,
      profileId: unknown,
      interfaces: unknown
    ): Promise<InterfaceStatusRun> | InterfaceStatusRun => {
      if (typeof profileId !== 'string' || profileId.trim().length === 0) {
        return { kind: 'no-session' }
      }
      const names = parseInterfaceList(interfaces)
      if (!Array.isArray(names)) {
        return { kind: 'invalid-interfaces', reason: names.invalid }
      }
      return api.runInterfaceStatus(profileId, names)
    }
  )
  ipcMain.handle('diagnostics:runL2', (_event, profileId: unknown): Promise<L2Run> | L2Run => {
    if (typeof profileId !== 'string' || profileId.trim().length === 0) {
      return { kind: 'no-session' }
    }
    return api.runL2(profileId)
  })
}

export type WorkspaceTab = 'overview' | 'terminal' | 'diagnostics'

export type WorkspacePane = 'empty' | 'create' | 'profile' | 'edit'

export type ConnectFocusContext = {
  connectingProfileId: string
  selectedProfileId: string | null
  pane: WorkspacePane
}

export function defaultTab(): WorkspaceTab {
  return 'overview'
}

export function isForegroundConnect(
  started: ConnectFocusContext,
  now: ConnectFocusContext
): boolean {
  return (
    now.pane === 'profile' &&
    now.selectedProfileId === started.connectingProfileId &&
    started.connectingProfileId === started.selectedProfileId
  )
}

export function tabAfterSuccessfulConnect(foreground: boolean): {
  changeSelection: boolean
  tab: WorkspaceTab
  focusTerminal: boolean
} {
  if (foreground) {
    return { changeSelection: true, tab: 'terminal', focusTerminal: true }
  }
  return { changeSelection: false, tab: 'terminal', focusTerminal: false }
}

export function tabWhenSelectingProfile(
  remembered: WorkspaceTab | undefined,
  selectTerminalOnReturn: boolean
): WorkspaceTab {
  if (selectTerminalOnReturn) {
    return 'terminal'
  }
  return remembered ?? defaultTab()
}

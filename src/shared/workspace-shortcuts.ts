export type ShortcutPlatform = 'darwin' | 'win32' | 'linux'

export type WorkspaceShortcut =
  'search' | 'toggle-sidebar' | 'overview' | 'terminal' | 'previous-profile' | 'next-profile'

export type ShortcutEvent = {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  isComposing: boolean
}

const SHORTCUT_CODES: Record<string, WorkspaceShortcut> = {
  KeyF: 'search',
  KeyB: 'toggle-sidebar',
  Digit1: 'overview',
  Digit2: 'terminal',
  BracketLeft: 'previous-profile',
  BracketRight: 'next-profile'
}

function hasAppModifier(event: ShortcutEvent, platform: ShortcutPlatform): boolean {
  if (event.altKey || event.isComposing) {
    return false
  }
  if (platform === 'darwin') {
    return event.metaKey && !event.ctrlKey && !event.shiftKey
  }
  return event.ctrlKey && event.shiftKey && !event.metaKey
}

export function shortcutPlatformFrom(navigatorPlatform: string): ShortcutPlatform {
  const value = navigatorPlatform.toLowerCase()
  if (value.includes('mac')) {
    return 'darwin'
  }
  if (value.includes('win')) {
    return 'win32'
  }
  return 'linux'
}

export function matchWorkspaceShortcut(
  event: ShortcutEvent,
  platform: ShortcutPlatform
): WorkspaceShortcut | null {
  if (!hasAppModifier(event, platform)) {
    return null
  }
  return SHORTCUT_CODES[event.code] ?? null
}

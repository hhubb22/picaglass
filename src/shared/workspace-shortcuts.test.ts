import { describe, expect, it } from 'vitest'
import {
  matchWorkspaceShortcut,
  shortcutPlatformFrom,
  type ShortcutEvent
} from './workspace-shortcuts'

function event(overrides: Partial<ShortcutEvent> & Pick<ShortcutEvent, 'code'>): ShortcutEvent {
  return {
    key: '',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    ...overrides
  }
}

describe('matchWorkspaceShortcut', () => {
  it('uses Cmd on macOS for search, sidebar, tabs, and previous/next profile', () => {
    expect(matchWorkspaceShortcut(event({ code: 'KeyF', metaKey: true }), 'darwin')).toBe('search')
    expect(matchWorkspaceShortcut(event({ code: 'KeyB', metaKey: true }), 'darwin')).toBe(
      'toggle-sidebar'
    )
    expect(matchWorkspaceShortcut(event({ code: 'Digit1', metaKey: true }), 'darwin')).toBe(
      'overview'
    )
    expect(matchWorkspaceShortcut(event({ code: 'Digit2', metaKey: true }), 'darwin')).toBe(
      'terminal'
    )
    expect(matchWorkspaceShortcut(event({ code: 'BracketLeft', metaKey: true }), 'darwin')).toBe(
      'previous-profile'
    )
    expect(matchWorkspaceShortcut(event({ code: 'BracketRight', metaKey: true }), 'darwin')).toBe(
      'next-profile'
    )
  })

  it('uses Ctrl+Shift on Windows and Linux so Ctrl-only shell keys are untouched', () => {
    expect(
      matchWorkspaceShortcut(event({ code: 'KeyF', ctrlKey: true, shiftKey: true }), 'linux')
    ).toBe('search')
    expect(
      matchWorkspaceShortcut(event({ code: 'KeyB', ctrlKey: true, shiftKey: true }), 'win32')
    ).toBe('toggle-sidebar')
    expect(
      matchWorkspaceShortcut(event({ code: 'Digit1', ctrlKey: true, shiftKey: true }), 'linux')
    ).toBe('overview')
    expect(
      matchWorkspaceShortcut(event({ code: 'Digit2', ctrlKey: true, shiftKey: true }), 'linux')
    ).toBe('terminal')
    expect(
      matchWorkspaceShortcut(event({ code: 'BracketLeft', ctrlKey: true, shiftKey: true }), 'linux')
    ).toBe('previous-profile')
    expect(
      matchWorkspaceShortcut(
        event({ code: 'BracketRight', ctrlKey: true, shiftKey: true }),
        'linux'
      )
    ).toBe('next-profile')
  })

  it('matches the physical key when Shift changes event.key on Windows/Linux', () => {
    expect(
      matchWorkspaceShortcut(
        event({ code: 'Digit1', key: '!', ctrlKey: true, shiftKey: true }),
        'linux'
      )
    ).toBe('overview')
    expect(
      matchWorkspaceShortcut(
        event({ code: 'BracketLeft', key: '{', ctrlKey: true, shiftKey: true }),
        'linux'
      )
    ).toBe('previous-profile')
  })

  it('does not intercept Ctrl+C, Ctrl+D, or Ctrl+F on Windows/Linux', () => {
    expect(matchWorkspaceShortcut(event({ code: 'KeyC', ctrlKey: true }), 'linux')).toBe(null)
    expect(matchWorkspaceShortcut(event({ code: 'KeyD', ctrlKey: true }), 'linux')).toBe(null)
    expect(matchWorkspaceShortcut(event({ code: 'KeyF', ctrlKey: true }), 'linux')).toBe(null)
    expect(matchWorkspaceShortcut(event({ code: 'KeyC', ctrlKey: true }), 'win32')).toBe(null)
  })

  it('ignores extra modifiers, composing input, and unmatched keys', () => {
    expect(
      matchWorkspaceShortcut(event({ code: 'KeyF', metaKey: true, shiftKey: true }), 'darwin')
    ).toBe(null)
    expect(
      matchWorkspaceShortcut(event({ code: 'KeyF', metaKey: true, altKey: true }), 'darwin')
    ).toBe(null)
    expect(
      matchWorkspaceShortcut(event({ code: 'KeyF', metaKey: true, isComposing: true }), 'darwin')
    ).toBe(null)
    expect(matchWorkspaceShortcut(event({ code: 'KeyC', metaKey: true }), 'darwin')).toBe(null)
    expect(matchWorkspaceShortcut(event({ code: 'KeyF', ctrlKey: true }), 'darwin')).toBe(null)
  })

  it('maps navigator.platform to Cmd on macOS and Ctrl+Shift elsewhere', () => {
    expect(shortcutPlatformFrom('MacIntel')).toBe('darwin')
    expect(shortcutPlatformFrom('Win32')).toBe('win32')
    expect(shortcutPlatformFrom('Linux x86_64')).toBe('linux')
  })
})

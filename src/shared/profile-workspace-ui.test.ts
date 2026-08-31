import { describe, expect, it } from 'vitest'
import {
  defaultTab,
  isForegroundConnect,
  tabAfterSuccessfulConnect,
  tabWhenSelectingProfile,
  type ConnectFocusContext
} from './profile-workspace-ui'

describe('profile workspace tabs and focus', () => {
  it('starts every relaunch on Overview', () => {
    expect(defaultTab()).toBe('overview')
  })

  it('selects and focuses Terminal when a foreground Connect succeeds', () => {
    const origin: ConnectFocusContext = {
      connectingProfileId: 'p1',
      selectedProfileId: 'p1',
      pane: 'profile'
    }
    expect(isForegroundConnect(origin, origin)).toBe(true)
    expect(tabAfterSuccessfulConnect(true)).toEqual({
      changeSelection: true,
      tab: 'terminal',
      focusTerminal: true
    })
  })

  it('does not steal selection or focus when the operator navigated elsewhere', () => {
    const started: ConnectFocusContext = {
      connectingProfileId: 'p1',
      selectedProfileId: 'p1',
      pane: 'profile'
    }
    const now: ConnectFocusContext = {
      connectingProfileId: 'p1',
      selectedProfileId: 'p2',
      pane: 'profile'
    }
    expect(isForegroundConnect(started, now)).toBe(false)
    expect(tabAfterSuccessfulConnect(false)).toEqual({
      changeSelection: false,
      tab: 'terminal',
      focusTerminal: false
    })
  })

  it('selects Terminal when returning to a profile that connected in the background', () => {
    expect(tabWhenSelectingProfile('overview', true)).toBe('terminal')
    expect(tabWhenSelectingProfile('overview', false)).toBe('overview')
    expect(tabWhenSelectingProfile(undefined, false)).toBe('overview')
  })

  it('treats create and empty panes as background', () => {
    expect(
      isForegroundConnect(
        { connectingProfileId: 'p1', selectedProfileId: 'p1', pane: 'profile' },
        { connectingProfileId: 'p1', selectedProfileId: 'p1', pane: 'create' }
      )
    ).toBe(false)
  })

  it('treats the edit pane as background so a pending connect does not steal the form', () => {
    expect(
      isForegroundConnect(
        { connectingProfileId: 'p1', selectedProfileId: 'p1', pane: 'profile' },
        { connectingProfileId: 'p1', selectedProfileId: 'p1', pane: 'edit' }
      )
    ).toBe(false)
  })
})

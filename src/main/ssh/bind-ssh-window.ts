import type { SshApi } from './create-ssh-api'

export type SshWindow = {
  webContents: { id: number }
  on: (event: 'closed', listener: () => void) => void
}

// The window and its webContents are gone by the time 'closed' fires, so the id is read up front.
export function bindSshWindow(window: SshWindow, api: Pick<SshApi, 'disposeSender'>): void {
  const senderId = window.webContents.id
  window.on('closed', () => {
    api.disposeSender(senderId)
  })
}

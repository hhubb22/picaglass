const NO_MORE_FILTER = /\s*\|\s*no-more\s*$/i

export function normalizeShowCommand(command: string): string {
  return command.trim().replace(NO_MORE_FILTER, '').trim()
}

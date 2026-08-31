const EXECUTE_COMMAND = /^\s*Execute command:\s*(.+?)\s*$/
const SYNC_LINE = /^\s*Synchronizing configuration\.\.\.OK\.\s*$/
const WELCOME_LINE = /^\s*Welcome to PICOS\s*$/i
const PROMPT_LINE = /^\s*\S+@\S+[>#]\s*$/
const ISOLATED_DOT = /^\s*\.\s*$/
const NOTICE_BANNER = /NOTICE TO USERS/i
const NO_MORE_FILTER = /\s*\|\s*no-more\s*$/i

export type FramedCommand = {
  command: string
  output: string
}

export type FrameCliOutput = {
  cleaned: string
  commands: FramedCommand[]
}

export function normalizeShowCommand(command: string): string {
  return command.trim().replace(NO_MORE_FILTER, '').trim()
}

function isBannerTerminator(line: string): boolean {
  return (
    SYNC_LINE.test(line) ||
    WELCOME_LINE.test(line) ||
    PROMPT_LINE.test(line) ||
    ISOLATED_DOT.test(line) ||
    EXECUTE_COMMAND.test(line)
  )
}

function isNoiseLine(line: string): boolean {
  return (
    SYNC_LINE.test(line) ||
    WELCOME_LINE.test(line) ||
    PROMPT_LINE.test(line) ||
    ISOLATED_DOT.test(line)
  )
}

function normalizeNewlines(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function stripNoiseLines(raw: string): string[] {
  const kept: string[] = []
  let inBanner = false
  for (const line of normalizeNewlines(raw).split('\n')) {
    if (inBanner) {
      if (isBannerTerminator(line)) {
        inBanner = false
      } else {
        continue
      }
    }
    if (NOTICE_BANNER.test(line)) {
      inBanner = true
      continue
    }
    if (isNoiseLine(line)) {
      continue
    }
    kept.push(line)
  }
  return kept
}

function trimOutput(lines: string[]): string {
  let start = 0
  let end = lines.length
  while (start < end && lines[start] === '') {
    start += 1
  }
  while (end > start && lines[end - 1] === '') {
    end -= 1
  }
  return lines.slice(start, end).join('\n')
}

export function frameCliOutput(raw: string): FrameCliOutput {
  const lines = stripNoiseLines(raw)
  const commands: FramedCommand[] = []
  let current: { command: string; lines: string[] } | undefined
  const preamble: string[] = []

  const flush = (): void => {
    if (current === undefined) {
      return
    }
    commands.push({ command: current.command, output: trimOutput(current.lines) })
    current = undefined
  }

  for (const line of lines) {
    const echo = EXECUTE_COMMAND.exec(line)
    if (echo !== null) {
      flush()
      const commandText = echo[1] ?? ''
      current = { command: normalizeShowCommand(commandText), lines: [] }
      continue
    }
    if (current !== undefined) {
      current.lines.push(line)
    } else {
      preamble.push(line)
    }
  }
  flush()

  const cleanedParts =
    commands.length > 0
      ? commands.map((entry) => entry.output).filter((part) => part.length > 0)
      : [trimOutput(preamble)]

  return {
    cleaned: cleanedParts.join('\n'),
    commands
  }
}

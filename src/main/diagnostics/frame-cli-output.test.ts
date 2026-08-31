import { describe, expect, it } from 'vitest'
import { frameCliOutput, normalizeShowCommand } from './frame-cli-output'

const VERSION_BODY = [
  'Copyright                     : Copyright (C) 2009-2026 Pica8, Inc. All Rights Reserved.',
  'Model                         : S5810-28FS'
].join('\n')

const FAN_BODY = ['Fan Status:', '    Fan  1 : speed = 5415 RPM, PWM = 76, Forward'].join('\n')

describe('normalizeShowCommand', () => {
  it('strips a trailing no-more filter and extra whitespace', () => {
    expect(normalizeShowCommand('show version | no-more')).toBe('show version')
    expect(normalizeShowCommand('  show system fan  |  no-more  ')).toBe('show system fan')
    expect(normalizeShowCommand('show version')).toBe('show version')
  })
})

describe('frameCliOutput', () => {
  it('normalizes CRLF and strips enumerated noise lines before splitting on Execute command', () => {
    const raw = [
      'Synchronizing configuration...OK.\r',
      'NOTICE TO USERS\r',
      'This is a trial license banner line.\r',
      'Unauthorized use is prohibited.\r',
      '\r',
      'Welcome to PICOS\r',
      'admin@PICOS> \r',
      '.\r',
      'Execute command: show version | no-more\r',
      `${VERSION_BODY.replaceAll('\n', '\r\n')}\r`,
      'admin@PICOS> \r',
      '.\r',
      'Execute command: show system fan | no-more\r',
      `${FAN_BODY.replaceAll('\n', '\r\n')}\r`,
      'admin@PICOS> \r'
    ].join('\n')

    const framed = frameCliOutput(raw)

    expect(framed.commands).toEqual([
      { command: 'show version', output: VERSION_BODY },
      { command: 'show system fan', output: FAN_BODY }
    ])
    expect(framed.cleaned).toBe(`${VERSION_BODY}\n${FAN_BODY}`)
    expect(framed.cleaned.includes('\r')).toBe(false)
    expect(framed.cleaned.includes('Synchronizing configuration')).toBe(false)
    expect(framed.cleaned.includes('NOTICE TO USERS')).toBe(false)
    expect(framed.cleaned.includes('Welcome to PICOS')).toBe(false)
    expect(framed.cleaned.includes('Execute command:')).toBe(false)
  })

  it('strips a configuration-mode prompt and an isolated dot between commands', () => {
    const raw = ['admin@PICOS# ', '.', 'Execute command: show version', VERSION_BODY].join('\n')

    expect(frameCliOutput(raw).commands).toEqual([
      { command: 'show version', output: VERSION_BODY }
    ])
  })

  it('returns the cleaned blob with no command splits when echo lines are absent', () => {
    const framed = frameCliOutput(`Synchronizing configuration...OK.\n${VERSION_BODY}\n`)
    expect(framed.commands).toEqual([])
    expect(framed.cleaned).toBe(VERSION_BODY)
  })
})

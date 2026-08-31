import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PARSE_FAILED_NOTICE, VIEW_RAW_LABEL } from './device-facts'
import {
  DEFAULT_LOG_LINES,
  LOGS_CORE_COMMAND,
  logsCard,
  logsCliCommand,
  logsSyslogCommand,
  parseCoreListing,
  parseLogLineCount,
  parseLogs,
  parseSyslog
} from './logs'

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures/picos', name), 'utf8')
}

describe('logs commands', () => {
  it('aggregates recent syslog and core listing with default 50 and no interpolation holes', () => {
    const built = logsCliCommand()
    expect(built).toEqual({
      ok: true,
      lines: 50,
      command: "cli -c 'show log last 50 | no-more; file list /pica/core | no-more'"
    })
    expect(DEFAULT_LOG_LINES).toBe(50)
    expect(logsSyslogCommand(50)).toBe('show log last 50')
    expect(LOGS_CORE_COMMAND).toBe('file list /pica/core')
    expect(built.ok && built.command.includes('${')).toBe(false)
    expect(built.ok && built.command.includes('%s')).toBe(false)
  })

  it('puts the requested line count into show log last', () => {
    expect(logsCliCommand(200)).toEqual({
      ok: true,
      lines: 200,
      command: "cli -c 'show log last 200 | no-more; file list /pica/core | no-more'"
    })
    expect(logsSyslogCommand(1)).toBe('show log last 1')
  })

  it('rejects a non-positive, non-integer, or oversized line count', () => {
    expect(parseLogLineCount(0)).toEqual({ ok: false, reason: 'invalid log line count: 0' })
    expect(parseLogLineCount(-1)).toEqual({ ok: false, reason: 'invalid log line count: -1' })
    expect(parseLogLineCount(1.5)).toEqual({ ok: false, reason: 'invalid log line count: 1.5' })
    expect(parseLogLineCount(10001)).toEqual({ ok: false, reason: 'invalid log line count: 10001' })
    expect(logsCliCommand(0)).toEqual({ ok: false, reason: 'invalid log line count: 0' })
  })
})

describe('parseSyslog', () => {
  it('parses the golden last-50 syslog lines including sshd and local0 forms', () => {
    const raw = fixture('show-log-last-50.txt')
    const result = parseSyslog(raw)
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') {
      return
    }
    expect(result.data.unparsedLines).toBe(0)
    expect(result.data.rows).toHaveLength(50)
    expect(result.data.rows[0]).toEqual({
      timestamp: 'Aug 31 2026 09:35:29',
      host: 'PICOS',
      facility: 'local0',
      severity: 'debug',
      message: '[SIF]Get port link status, interface: ae28'
    })
    expect(result.data.rows[15]).toEqual({
      timestamp: 'Aug 31 2026 09:35:29',
      host: 'PICOS',
      program: 'sshd',
      facility: 'auth',
      severity: 'info',
      message: 'Received disconnect from 192.0.2.1 port 57033:11: disconnected by user'
    })
    expect(result.data.rows[18]).toEqual({
      timestamp: 'Aug 31 2026 09:35:31',
      host: 'PICOS',
      facility: 'local0',
      severity: 'warning',
      message:
        '[RTRMGR][Operational Command File: /pica/etc/S5810-28FS/templates/xorpsh.cmds line 711]: Executable file not found: license'
    })
    expect(result.data.rows[49]?.timestamp).toBe('Aug 31 2026 09:35:43')
    expect(result.raw).toBe(raw)
  })

  it('treats empty syslog as parsed zero rows', () => {
    const raw = '\n'
    expect(parseSyslog(raw)).toEqual({
      status: 'parsed',
      data: { rows: [], unparsedLines: 0 },
      raw
    })
  })

  it('skips a bad syslog line and counts it without failing', () => {
    const raw = `${fixture('show-log-last-50.txt').trimEnd()}\nnot a log line\n`
    const result = parseSyslog(raw)
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') {
      return
    }
    expect(result.data.unparsedLines).toBe(1)
    expect(result.data.rows).toHaveLength(50)
  })

  it('fails when the syslog skeleton is absent', () => {
    const raw = 'log buffer unavailable\n'
    expect(parseSyslog(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing syslog skeleton'
    })
  })
})

describe('parseCoreListing', () => {
  it('parses the golden core symlink as success with no core dumps', () => {
    const raw = fixture('file-list-pica-core.txt')
    expect(parseCoreListing(raw)).toEqual({
      status: 'parsed',
      data: {
        path: '/pica/core',
        target: '/mnt/open/picos/support',
        symlink: true,
        cores: [],
        unparsedLines: 0
      },
      raw
    })
  })

  it('lists extra files beside the core symlink as core dumps', () => {
    const raw = [
      'lrwxrwxrwx 1 root root 23 Jan  1  1970 /pica/core -> /mnt/open/picos/support',
      '-rw-r--r-- 1 root root 1048576 Aug 31 09:00 core.xorp.1842'
    ].join('\n')
    expect(parseCoreListing(raw)).toEqual({
      status: 'parsed',
      data: {
        path: '/pica/core',
        target: '/mnt/open/picos/support',
        symlink: true,
        cores: [
          {
            name: 'core.xorp.1842',
            path: 'core.xorp.1842',
            size: '1048576',
            date: 'Aug 31 09:00',
            mode: '-rw-r--r--'
          }
        ],
        unparsedLines: 0
      },
      raw
    })
  })

  it('fails when the core listing skeleton is absent', () => {
    const raw = 'permission denied\n'
    expect(parseCoreListing(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing core listing skeleton'
    })
  })
})

describe('parseLogs', () => {
  it('parses framed syslog and core listing into one logs block', () => {
    const block = parseLogs([
      { command: 'show log last 50', output: fixture('show-log-last-50.txt') },
      { command: 'file list /pica/core', output: fixture('file-list-pica-core.txt') }
    ])
    expect(block.syslog.status).toBe('parsed')
    expect(block.core.status).toBe('parsed')
    if (block.syslog.status === 'parsed') {
      expect(block.syslog.data.rows).toHaveLength(50)
    }
    expect(block.core).toEqual({
      status: 'parsed',
      data: {
        path: '/pica/core',
        target: '/mnt/open/picos/support',
        symlink: true,
        cores: [],
        unparsedLines: 0
      },
      raw: fixture('file-list-pica-core.txt')
    })
  })
})

describe('logsCard', () => {
  it('projects recent syslog and a no-core symlink as normal data', () => {
    const block = parseLogs([
      { command: 'show log last 50', output: fixture('show-log-last-50.txt') },
      { command: 'file list /pica/core', output: fixture('file-list-pica-core.txt') }
    ])
    const card = logsCard(block, 'combined-raw')
    expect(card.parseFailed).toBe(false)
    expect(card.parseFailedNotice).toBeNull()
    expect(card.syslog).toHaveLength(50)
    expect(card.syslog?.[0]?.message).toBe('[SIF]Get port link status, interface: ae28')
    expect(card.cores).toEqual([])
    expect(card.emptySyslogNotice).toBeNull()
    expect(card.emptyCoresNotice).toBe('No core dumps.')
    expect(card.corePath).toBe('/pica/core')
    expect(card.coreTarget).toBe('/mnt/open/picos/support')
    expect(card.coreSymlink).toBe(true)
    expect(card.raw).toBe('combined-raw')
    expect(card.viewRawLabel).toBe(VIEW_RAW_LABEL)
  })

  it('puts parse-failed raw on the card notice', () => {
    const raw = 'garbled logs'
    const card = logsCard(
      {
        syslog: { status: 'parse-failed', raw, reason: 'missing syslog skeleton' },
        core: {
          status: 'parsed',
          data: { symlink: true, cores: [], unparsedLines: 0, path: '/pica/core' },
          raw: 'core-raw'
        }
      },
      raw
    )
    expect(card.parseFailed).toBe(true)
    expect(card.parseFailedNotice).toBe(PARSE_FAILED_NOTICE)
    expect(card.syslogFailure).toEqual({ reason: 'missing syslog skeleton', raw })
    expect(card.syslog).toBeNull()
    expect(card.cores).toEqual([])
    expect(card.emptyCoresNotice).toBe('No core dumps.')
  })
})

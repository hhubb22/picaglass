import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PARSE_FAILED_NOTICE, VIEW_RAW_LABEL } from './device-facts'
import {
  INTERFACE_STATUS_BRIEF_COMMAND,
  INTERFACE_STATUS_OPTICS_COMMAND,
  interfaceStatusCard,
  interfaceStatusCliCommand,
  parseInterfaceBrief,
  parseInterfaceDetail,
  parseInterfaceNames,
  parseInterfaceStatus,
  parseOptics
} from './interface-status'

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures/picos', name), 'utf8')
}

function opticsRow(cells: {
  name: string
  temperature: string
  voltage: string
  bias: string
  txPower: string
  rxPower: string
  moduleType: string
}): string {
  const header = fixture('show-interface-diagnostics-optics.txt').split('\n')[1] ?? ''
  const starts = [0, 15, 39, 53, 73, 95, 117]
  const values = [
    cells.name,
    cells.temperature,
    cells.voltage,
    cells.bias,
    cells.txPower,
    cells.rxPower,
    cells.moduleType
  ]
  let line = ''
  for (let i = 0; i < values.length; i += 1) {
    const start = starts[i] ?? 0
    const value = values[i] ?? ''
    line = line.padEnd(start, ' ') + value
  }
  return `${fixture('show-interface-diagnostics-optics.txt').trimEnd()}\n${line.padEnd(header.length)}\n`
}

describe('interface status commands', () => {
  it('aggregates brief and optics all, with no interpolation holes', () => {
    const built = interfaceStatusCliCommand()
    expect(built).toEqual({
      ok: true,
      names: [],
      command:
        "cli -c 'show interface brief | no-more; show interface diagnostics optics all | no-more'"
    })
    expect(INTERFACE_STATUS_BRIEF_COMMAND).toBe('show interface brief')
    expect(INTERFACE_STATUS_OPTICS_COMMAND).toBe('show interface diagnostics optics all')
    expect(built.ok && built.command?.includes('${')).toBe(false)
    expect(built.ok && built.command?.includes('%s')).toBe(false)
    expect(built.ok && built.command?.includes('show interface diagnostics optics |')).toBe(false)
    expect(built.ok && built.command?.includes('show interface detail')).toBe(false)
  })

  it('appends show interface detail only for a supplied interface list', () => {
    expect(interfaceStatusCliCommand(['ge-1/1/1', 'te-1/1/1(29)'])).toEqual({
      ok: true,
      names: ['ge-1/1/1', 'te-1/1/1(29)'],
      command:
        "cli -c 'show interface brief | no-more; show interface diagnostics optics all | no-more; show interface detail ge-1/1/1 | no-more; show interface detail te-1/1/1(29) | no-more'"
    })
  })

  it('rejects all, chaining, and reserved words so detail cannot dump every port', () => {
    expect(parseInterfaceNames(['all'])).toEqual({
      ok: false,
      reason: 'invalid interface name: "all"'
    })
    expect(parseInterfaceNames(['ge-1/1/1; show version'])).toEqual({
      ok: false,
      reason: 'invalid interface name: "ge-1/1/1; show version"'
    })
    expect(interfaceStatusCliCommand(["ge-1/1/1'"])).toEqual({
      ok: false,
      reason: 'invalid interface name: "ge-1/1/1\'"'
    })
  })

  it('dedupes trimmed names and keeps first-seen order', () => {
    expect(parseInterfaceNames([' ge-1/1/1 ', 'ae3', 'ge-1/1/1'])).toEqual({
      ok: true,
      names: ['ge-1/1/1', 'ae3']
    })
  })
})

describe('parseInterfaceBrief', () => {
  it('parses the golden brief fixture including all-Down trial-license ports as data', () => {
    const result = parseInterfaceBrief(fixture('show-interface-brief.txt'))
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') {
      return
    }
    expect(result.data.unparsedLines).toBe(0)
    expect(result.data.rows).toHaveLength(33)
    expect(result.data.rows[0]).toEqual({
      name: 'ge-1/1/1',
      management: 'Enabled',
      status: 'Down',
      flowControl: 'Disabled',
      duplex: 'Full',
      speed: 'Auto'
    })
    expect(result.data.rows.every((row) => row.status === 'Down')).toBe(true)
    expect(result.data.rows.find((row) => row.name === 'ge-1/1/5')).toEqual({
      name: 'ge-1/1/5',
      management: 'Disabled',
      status: 'Down',
      flowControl: 'Disabled',
      duplex: 'Full',
      speed: 'Auto'
    })
    expect(result.data.rows.find((row) => row.name === 'te-1/1/1(29)')).toMatchObject({
      name: 'te-1/1/1(29)',
      management: 'Enabled',
      status: 'Down',
      speed: 'Auto'
    })
    expect(result.data.rows.find((row) => row.name === 'ae3')).toEqual({
      name: 'ae3',
      management: 'Enabled',
      status: 'Down',
      flowControl: 'Disabled',
      duplex: 'Auto',
      speed: 'Auto'
    })
    expect(result.raw).toBe(fixture('show-interface-brief.txt'))
  })

  it('keeps a description when the last column is populated', () => {
    const raw = [
      'Interface       Management  Status  Flow Control  Duplex  Speed    Description',
      '--------------  ----------  ------  ------------  ------  -------  ------------------------------',
      'ge-1/1/1        Enabled     Up      Disabled      Full    1000     uplink to core'
    ].join('\n')
    expect(parseInterfaceBrief(raw)).toEqual({
      status: 'parsed',
      data: {
        rows: [
          {
            name: 'ge-1/1/1',
            management: 'Enabled',
            status: 'Up',
            flowControl: 'Disabled',
            duplex: 'Full',
            speed: '1000',
            description: 'uplink to core'
          }
        ],
        unparsedLines: 0
      },
      raw
    })
  })

  it('treats a header-only brief table as parsed zero rows', () => {
    const raw = [
      'Interface       Management  Status  Flow Control  Duplex  Speed    Description',
      '--------------  ----------  ------  ------------  ------  -------  ------------------------------'
    ].join('\n')
    expect(parseInterfaceBrief(raw)).toEqual({
      status: 'parsed',
      data: { rows: [], unparsedLines: 0 },
      raw
    })
  })

  it('skips a bad brief row and counts it without failing', () => {
    const raw = [
      'Interface       Management  Status  Flow Control  Duplex  Speed    Description',
      '--------------  ----------  ------  ------------  ------  -------  ------------------------------',
      '???',
      'ge-1/1/2        Enabled     Down    Disabled      Full    Auto'
    ].join('\n')
    const result = parseInterfaceBrief(raw)
    expect(result).toEqual({
      status: 'parsed',
      data: {
        rows: [
          {
            name: 'ge-1/1/2',
            management: 'Enabled',
            status: 'Down',
            flowControl: 'Disabled',
            duplex: 'Full',
            speed: 'Auto'
          }
        ],
        unparsedLines: 1
      },
      raw
    })
  })

  it('fails when the brief skeleton is absent', () => {
    const raw = 'not an interface table\n'
    expect(parseInterfaceBrief(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing interface brief skeleton'
    })
  })
})

describe('parseOptics', () => {
  it('parses the golden empty optics table as parsed zero rows, not an error', () => {
    expect(parseOptics(fixture('show-interface-diagnostics-optics.txt'))).toEqual({
      status: 'parsed',
      data: { rows: [], unparsedLines: 0 },
      raw: fixture('show-interface-diagnostics-optics.txt')
    })
  })

  it('parses a populated optics row aligned to the golden header', () => {
    const raw = opticsRow({
      name: 'te-1/1/1(49)',
      temperature: '27.78/82.00',
      voltage: '3.27',
      bias: '6.88',
      txPower: '-3.38',
      rxPower: '-20.00',
      moduleType: '10G_BASE_SR'
    })
    const result = parseOptics(raw)
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') {
      return
    }
    expect(result.data.rows).toEqual([
      {
        name: 'te-1/1/1(49)',
        temperature: '27.78/82.00',
        voltage: '3.27',
        bias: '6.88',
        txPower: '-3.38',
        rxPower: '-20.00',
        moduleType: '10G_BASE_SR'
      }
    ])
  })

  it('fails when the optics skeleton is absent', () => {
    const raw = 'no optical modules\n'
    expect(parseOptics(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing optics skeleton'
    })
  })
})

describe('parseInterfaceDetail', () => {
  it('parses the golden detail fixture without treating all-Down as failure', () => {
    const result = parseInterfaceDetail(fixture('show-interface-detail.txt'))
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') {
      return
    }
    expect(result.data.rows).toHaveLength(33)
    expect(result.data.rows[0]).toMatchObject({
      name: 'ge-1/1/1',
      management: 'Enabled',
      link: 'Down',
      errorDiscard: 'False',
      portMode: 'access',
      mtu: '1518',
      speed: 'Auto',
      duplex: 'Full',
      flowControl: 'Disabled',
      currentAddress: '02:00:00:00:00:01',
      hardwareAddress: '02:00:00:00:00:01',
      inputPackets: '451381',
      outputPackets: '355808',
      inputOctets: '100397754',
      outputOctets: '65249679'
    })
    expect(result.data.rows.find((row) => row.name === 'ge-1/1/5')).toMatchObject({
      name: 'ge-1/1/5',
      management: 'Disabled',
      link: 'Down'
    })
    expect(result.data.rows.find((row) => row.name === 'te-1/1/1(29)')).toMatchObject({
      name: 'te-1/1/1(29)',
      management: 'Enabled',
      link: 'Down'
    })
    expect(result.data.rows.find((row) => row.name === 'ae3')).toMatchObject({
      name: 'ae3',
      management: 'Enabled',
      link: 'Down',
      members: [
        { name: 'ge-1/1/1', status: 'Down', speed: 'Auto' },
        { name: 'ge-1/1/2', status: 'Down', speed: 'Auto' }
      ]
    })
    expect(result.data.rows.every((row) => row.link === 'Down')).toBe(true)
  })

  it('skips a bad member row and keeps later members', () => {
    const raw = [
      'Physical interface: ae3, Enabled, error-discard False, Physical link is Down',
      '  Members        Status          Port Speed',
      '  ---------      ----------      ----------',
      '  ???',
      '  ge-1/1/2       Down            Auto'
    ].join('\n')
    const result = parseInterfaceDetail(raw)
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') {
      return
    }
    expect(result.data.rows[0]).toMatchObject({
      name: 'ae3',
      members: [{ name: 'ge-1/1/2', status: 'Down', speed: 'Auto' }],
      unparsedLines: 1
    })
  })

  it('keeps a Physical interface skeleton when admin/link fields are absent', () => {
    const raw = 'Physical interface: ge-1/1/1\nDescription: uplink\n'
    expect(parseInterfaceDetail(raw)).toEqual({
      status: 'parsed',
      data: {
        rows: [
          {
            name: 'ge-1/1/1',
            description: 'uplink',
            members: [],
            unparsedLines: 0
          }
        ],
        unparsedLines: 0
      },
      raw
    })
  })

  it('fails when the detail skeleton is absent', () => {
    const raw = 'no physical interfaces\n'
    expect(parseInterfaceDetail(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing interface detail skeleton'
    })
  })
})

describe('parseInterfaceStatus', () => {
  it('parses framed brief and optics and omits detail until names are requested', () => {
    const block = parseInterfaceStatus([
      { command: 'show interface brief', output: fixture('show-interface-brief.txt') },
      {
        command: 'show interface diagnostics optics all',
        output: fixture('show-interface-diagnostics-optics.txt')
      }
    ])
    expect(block.brief.status).toBe('parsed')
    expect(block.optics).toEqual({
      status: 'parsed',
      data: { rows: [], unparsedLines: 0 },
      raw: fixture('show-interface-diagnostics-optics.txt')
    })
    expect(block.details).toBeNull()
    if (block.brief.status === 'parsed') {
      expect(block.brief.data.rows).toHaveLength(33)
    }
  })

  it('parses framed detail only when includeDetails is set', () => {
    const first = fixture('show-interface-detail.txt')
      .split(/(?=Physical interface:)/)
      .find((part) => part.includes('ge-1/1/1,'))
    if (first === undefined) {
      throw new Error('expected ge-1/1/1 in the detail fixture')
    }
    const block = parseInterfaceStatus(
      [
        { command: 'show interface brief', output: fixture('show-interface-brief.txt') },
        {
          command: 'show interface diagnostics optics all',
          output: fixture('show-interface-diagnostics-optics.txt')
        },
        { command: 'show interface detail ge-1/1/1 | no-more', output: first }
      ],
      '',
      { includeDetails: true }
    )
    expect(block.details?.status).toBe('parsed')
    if (block.details?.status === 'parsed') {
      expect(block.details.data.rows.map((row) => row.name)).toEqual(['ge-1/1/1'])
    }
  })
})

describe('interfaceStatusCard', () => {
  it('projects the brief table and an empty optics table as normal data', () => {
    const block = parseInterfaceStatus([
      { command: 'show interface brief', output: fixture('show-interface-brief.txt') },
      {
        command: 'show interface diagnostics optics all',
        output: fixture('show-interface-diagnostics-optics.txt')
      }
    ])
    const card = interfaceStatusCard(block, 'combined-raw')
    expect(card.parseFailed).toBe(false)
    expect(card.parseFailedNotice).toBeNull()
    expect(card.brief).toHaveLength(33)
    expect(card.optics).toEqual([])
    expect(card.emptyOpticsNotice).toBe('No optics rows.')
    expect(card.emptyBriefNotice).toBeNull()
    expect(card.details).toBeNull()
    expect(card.detailsRequested).toBe(false)
    expect(card.raw).toBe('combined-raw')
    expect(card.viewRawLabel).toBe(VIEW_RAW_LABEL)
  })

  it('puts parse-failed raw on the card notice', () => {
    const raw = 'garbled interface text'
    const card = interfaceStatusCard(
      {
        brief: { status: 'parse-failed', raw, reason: 'missing interface brief skeleton' },
        optics: { status: 'parsed', data: { rows: [], unparsedLines: 0 }, raw: 'optics' },
        details: null
      },
      raw
    )
    expect(card.parseFailed).toBe(true)
    expect(card.parseFailedNotice).toBe(PARSE_FAILED_NOTICE)
    expect(card.briefFailure).toEqual({ reason: 'missing interface brief skeleton', raw })
    expect(card.brief).toBeNull()
    expect(card.optics).toEqual([])
  })
})

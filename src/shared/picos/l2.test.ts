import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PARSE_FAILED_NOTICE, VIEW_RAW_LABEL } from './device-facts'
import {
  L2_FDB_COMMAND,
  L2_SWITCHING_COMMAND,
  L2_VLAN_COMMAND,
  l2Card,
  l2CliCommand,
  parseEthernetSwitching,
  parseFdb,
  parseL2,
  parseVlans
} from './l2'

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures/picos', name), 'utf8')
}

const VLAN1_UNTAGGED = [
  'te-1/1/1',
  'te-1/1/2',
  'te-1/1/3',
  'ge-1/1/3',
  'te-1/1/4',
  'ge-1/1/4',
  'ge-1/1/5',
  'ge-1/1/6',
  'ge-1/1/7',
  'ge-1/1/8',
  'ge-1/1/9',
  'ge-1/1/10',
  'ge-1/1/11',
  'ge-1/1/12',
  'ge-1/1/13',
  'ge-1/1/14',
  'ge-1/1/15',
  'ge-1/1/16',
  'ge-1/1/17',
  'ge-1/1/18',
  'ge-1/1/19',
  'ge-1/1/20',
  'ge-1/1/21',
  'ge-1/1/22',
  'ge-1/1/23',
  'ge-1/1/24',
  'ge-1/1/25',
  'ge-1/1/26',
  'ge-1/1/27',
  'ge-1/1/28',
  'ae3'
]

function fdbRow(cells: {
  vlan: string
  mac: string
  type: string
  age: string
  interfaces: string
}): string {
  const skeleton = fixture('show-mac-address.txt').trimEnd()
  const starts = [0, 10, 31, 44, 52]
  const values = [cells.vlan, cells.mac, cells.type, cells.age, cells.interfaces]
  let line = ''
  for (let i = 0; i < values.length; i += 1) {
    const start = starts[i] ?? 0
    const value = values[i] ?? ''
    line = line.padEnd(start, ' ') + value
  }
  return `${skeleton}\n${line}\n`
}

describe('L2 commands', () => {
  it('aggregates vlans, mac-address table, and ethernet-switching with no interpolation holes', () => {
    expect(l2CliCommand()).toBe(
      "cli -c 'show vlans | no-more; show mac-address table | no-more; show ethernet-switching interfaces | no-more'"
    )
    expect(L2_VLAN_COMMAND).toBe('show vlans')
    expect(L2_FDB_COMMAND).toBe('show mac-address table')
    expect(L2_SWITCHING_COMMAND).toBe('show ethernet-switching interfaces')
    expect(l2CliCommand().includes('${')).toBe(false)
    expect(l2CliCommand().includes('%s')).toBe(false)
    expect(l2CliCommand().includes('show mac-address |')).toBe(false)
  })
})

describe('parseVlans', () => {
  it('parses the golden VLAN fixture including wrapped interface lists', () => {
    const result = parseVlans(fixture('show-vlans.txt'))
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') {
      return
    }
    expect(result.data.unparsedLines).toBe(0)
    expect(result.data.rows).toHaveLength(5)
    expect(result.data.rows[0]).toEqual({
      id: '1',
      name: 'default',
      untagged: VLAN1_UNTAGGED,
      tagged: []
    })
    expect(result.data.rows.slice(1)).toEqual([
      { id: '15', name: 'default', untagged: [], tagged: ['ae3'] },
      { id: '16', name: 'default', untagged: [], tagged: ['ae3'] },
      { id: '17', name: 'default', untagged: [], tagged: ['ae3'] },
      { id: '18', name: 'default', untagged: [], tagged: ['ae3'] }
    ])
    expect(result.raw).toBe(fixture('show-vlans.txt'))
  })

  it('treats a header-only VLAN table as parsed zero rows', () => {
    const raw = [
      'VlanID  Vlan Name           Tag        Interfaces',
      '------  ------------------  --------   ------------------------------------------------------'
    ].join('\n')
    expect(parseVlans(raw)).toEqual({
      status: 'parsed',
      data: { rows: [], unparsedLines: 0 },
      raw
    })
  })

  it('skips a bad VLAN row and counts it without failing', () => {
    const raw = [
      'VlanID  Vlan Name           Tag        Interfaces',
      '------  ------------------  --------   ------------------------------------------------------',
      '???',
      '20      voice               tagged     ge-1/1/1'
    ].join('\n')
    expect(parseVlans(raw)).toEqual({
      status: 'parsed',
      data: {
        rows: [{ id: '20', name: 'voice', untagged: [], tagged: ['ge-1/1/1'] }],
        unparsedLines: 1
      },
      raw
    })
  })

  it('fails when the VLAN skeleton is absent', () => {
    const raw = 'no vlans configured\n'
    expect(parseVlans(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing vlan skeleton'
    })
  })
})

describe('parseFdb', () => {
  it('parses the golden empty FDB table as parsed zero rows, not an error', () => {
    expect(parseFdb(fixture('show-mac-address.txt'))).toEqual({
      status: 'parsed',
      data: {
        totalEntries: '0',
        staticEntries: '0',
        dynamicEntries: '0',
        rows: [],
        unparsedLines: 0
      },
      raw: fixture('show-mac-address.txt')
    })
  })

  it('parses a populated FDB row aligned to the golden header', () => {
    const raw = fdbRow({
      vlan: '1',
      mac: '02:00:00:00:00:01',
      type: 'Dynamic',
      age: '12',
      interfaces: 'ge-1/1/3'
    })
    const result = parseFdb(raw)
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') {
      return
    }
    expect(result.data.rows).toEqual([
      {
        vlan: '1',
        mac: '02:00:00:00:00:01',
        type: 'Dynamic',
        age: '12',
        interfaces: 'ge-1/1/3'
      }
    ])
    expect(result.data.totalEntries).toBe('0')
  })

  it('skips a bad FDB row and counts it without failing', () => {
    const skeleton = fixture('show-mac-address.txt').trimEnd()
    const raw = `${skeleton}\n???\n1         02:00:00:00:00:01    Dynamic      0       ge-1/1/3\n`
    const result = parseFdb(raw)
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') {
      return
    }
    expect(result.data.unparsedLines).toBe(1)
    expect(result.data.rows).toEqual([
      {
        vlan: '1',
        mac: '02:00:00:00:00:01',
        type: 'Dynamic',
        age: '0',
        interfaces: 'ge-1/1/3'
      }
    ])
  })

  it('fails when the FDB skeleton is absent', () => {
    const raw = 'switching table unavailable\n'
    expect(parseFdb(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing fdb skeleton'
    })
  })
})

describe('parseEthernetSwitching', () => {
  it('parses the golden per-port tagging and native VLAN table', () => {
    const result = parseEthernetSwitching(fixture('show-ethernet-switching-interfaces.txt'))
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') {
      return
    }
    expect(result.data.unparsedLines).toBe(0)
    expect(result.data.rows).toHaveLength(64)
    expect(result.data.rows[0]).toEqual({
      name: 'ge-1/1/1',
      state: 'down',
      tagging: 'untagged',
      nativeVlan: '1',
      vlanMembers: []
    })
    expect(result.data.rows.find((row) => row.name === 'ge-1/1/3')).toEqual({
      name: 'ge-1/1/3',
      state: 'down',
      tagging: 'untagged',
      nativeVlan: '1',
      vlanMembers: ['1']
    })
    expect(result.data.rows.find((row) => row.name === 'ae3')).toEqual({
      name: 'ae3',
      state: 'down',
      tagging: 'tagged',
      nativeVlan: '1',
      vlanMembers: ['1', '15', '16', '17', '18']
    })
    expect(result.data.rows.find((row) => row.name === 'ae4')).toEqual({
      name: 'ae4',
      state: 'down',
      tagging: 'untagged',
      nativeVlan: '1',
      vlanMembers: ['0']
    })
    expect(result.raw).toBe(fixture('show-ethernet-switching-interfaces.txt'))
  })

  it('treats a header-only switching table as parsed zero rows', () => {
    const raw = [
      'Interface    State    Tagging     Native VLAN    VLAN members',
      '---------    -----    --------    -----------    ------------------------------'
    ].join('\n')
    expect(parseEthernetSwitching(raw)).toEqual({
      status: 'parsed',
      data: { rows: [], unparsedLines: 0 },
      raw
    })
  })

  it('fails when the ethernet-switching skeleton is absent', () => {
    const raw = 'no switching interfaces\n'
    expect(parseEthernetSwitching(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing ethernet-switching skeleton'
    })
  })
})

describe('parseL2', () => {
  it('parses framed VLAN, empty FDB, and switching tables together', () => {
    const block = parseL2([
      { command: 'show vlans', output: fixture('show-vlans.txt') },
      { command: 'show mac-address table | no-more', output: fixture('show-mac-address.txt') },
      {
        command: 'show ethernet-switching interfaces',
        output: fixture('show-ethernet-switching-interfaces.txt')
      }
    ])
    expect(block.vlans.status).toBe('parsed')
    expect(block.fdb).toEqual({
      status: 'parsed',
      data: {
        totalEntries: '0',
        staticEntries: '0',
        dynamicEntries: '0',
        rows: [],
        unparsedLines: 0
      },
      raw: fixture('show-mac-address.txt')
    })
    expect(block.switching.status).toBe('parsed')
    if (block.vlans.status === 'parsed') {
      expect(block.vlans.data.rows).toHaveLength(5)
    }
    if (block.switching.status === 'parsed') {
      expect(block.switching.data.rows).toHaveLength(64)
    }
  })
})

describe('l2Card', () => {
  it('projects VLAN and switching tables and an empty FDB as normal data', () => {
    const block = parseL2([
      { command: 'show vlans', output: fixture('show-vlans.txt') },
      { command: 'show mac-address table', output: fixture('show-mac-address.txt') },
      {
        command: 'show ethernet-switching interfaces',
        output: fixture('show-ethernet-switching-interfaces.txt')
      }
    ])
    const card = l2Card(block, 'combined-raw')
    expect(card.parseFailed).toBe(false)
    expect(card.parseFailedNotice).toBeNull()
    expect(card.vlans).toHaveLength(5)
    expect(card.fdb).toEqual([])
    expect(card.emptyFdbNotice).toBe('No FDB rows.')
    expect(card.emptyVlansNotice).toBeNull()
    expect(card.emptySwitchingNotice).toBeNull()
    expect(card.fdbTotalEntries).toBe('0')
    expect(card.switching).toHaveLength(64)
    expect(card.raw).toBe('combined-raw')
    expect(card.viewRawLabel).toBe(VIEW_RAW_LABEL)
  })

  it('puts parse-failed raw on the card notice', () => {
    const raw = 'garbled l2 text'
    const card = l2Card(
      {
        vlans: { status: 'parse-failed', raw, reason: 'missing vlan skeleton' },
        fdb: {
          status: 'parsed',
          data: { rows: [], unparsedLines: 0 },
          raw: 'fdb'
        },
        switching: { status: 'parsed', data: { rows: [], unparsedLines: 0 }, raw: 'sw' }
      },
      raw
    )
    expect(card.parseFailed).toBe(true)
    expect(card.parseFailedNotice).toBe(PARSE_FAILED_NOTICE)
    expect(card.vlansFailure).toEqual({ reason: 'missing vlan skeleton', raw })
    expect(card.vlans).toBeNull()
    expect(card.fdb).toEqual([])
    expect(card.emptyFdbNotice).toBe('No FDB rows.')
  })
})

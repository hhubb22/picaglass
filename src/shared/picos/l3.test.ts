import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PARSE_FAILED_NOTICE, VIEW_RAW_LABEL } from './device-facts'
import {
  L3_ARP_COMMAND,
  L3_HARDWARE_HOST_COMMAND,
  L3_HARDWARE_ROUTE_COMMAND,
  L3_NEIGHBOR_COMMAND,
  L3_SOFTWARE_ROUTE_COMMAND,
  l3Card,
  l3CliCommand,
  parseArp,
  parseHardwareHosts,
  parseHardwareRoutes,
  parseL3,
  parseNeighbors,
  parseSoftwareRoutes
} from './l3'

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures/picos', name), 'utf8')
}

const POPULATED_ARP = [
  'Aging-time(seconds): 1200',
  'Total count        : 1',
  'Address          HW Address         Type     Interface   Age',
  '---------------  -----------------  -------  ----------  ---------',
  '192.0.2.5        02:00:00:00:00:01  dynamic  eth0        12'
].join('\n')

const POPULATED_NEIGHBORS = [
  'Aging-time(seconds): 1200',
  'Total count        : 1',
  'Address                                  HW Address         Type     Interface   Age',
  '---------------------------------------  -----------------  -------  ----------  ---------',
  '2001:db8::1                              02:00:00:00:00:01  dynamic  eth0        12'
].join('\n')

describe('L3 commands', () => {
  it('aggregates software, hardware route/host, ARP, and neighbors with no interpolation holes', () => {
    expect(l3CliCommand()).toBe(
      "cli -c 'show route ipv4 | no-more; show route forward-route ipv4 all | no-more; show route forward-host ipv4 all | no-more; show arp | no-more; show neighbors | no-more'"
    )
    expect(L3_SOFTWARE_ROUTE_COMMAND).toBe('show route ipv4')
    expect(L3_HARDWARE_ROUTE_COMMAND).toBe('show route forward-route ipv4 all')
    expect(L3_HARDWARE_HOST_COMMAND).toBe('show route forward-host ipv4 all')
    expect(L3_ARP_COMMAND).toBe('show arp')
    expect(L3_NEIGHBOR_COMMAND).toBe('show neighbors')
    expect(l3CliCommand().includes('${')).toBe(false)
    expect(l3CliCommand().includes('%s')).toBe(false)
  })
})

describe('parseSoftwareRoutes', () => {
  it('parses the golden FRR-style software routing table', () => {
    const result = parseSoftwareRoutes(fixture('show-route-ipv4.txt'))
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') {
      return
    }
    expect(result.data.unparsedLines).toBe(0)
    expect(result.data.rows).toEqual([
      {
        protocol: 'K',
        selected: true,
        fib: true,
        destination: '0.0.0.0/0',
        preference: '0',
        metric: '2',
        nexthop: '192.0.2.5',
        interface: 'eth0',
        weight: '1',
        age: '20w6d07h'
      },
      {
        protocol: 'K',
        selected: false,
        fib: true,
        destination: '0.0.0.0/0',
        preference: '255',
        metric: '8192',
        unreachable: true,
        nexthop: 'blackhole',
        weight: '1',
        age: '23w3d06h'
      },
      {
        protocol: 'C',
        selected: true,
        fib: true,
        destination: '192.0.2.0/24',
        connected: true,
        interface: 'eth0',
        weight: '1',
        age: '08w6d05h'
      },
      {
        protocol: 'L',
        selected: true,
        fib: true,
        destination: '192.0.2.4/32',
        connected: true,
        interface: 'eth0',
        weight: '1',
        age: '08w6d05h'
      }
    ])
    expect(result.raw).toBe(fixture('show-route-ipv4.txt'))
  })

  it('treats a Codes legend with no routes as parsed zero rows', () => {
    const raw = [
      'Codes: K - kernel route, C - connected, L - local, S - static,',
      '       > - selected route, * - FIB route'
    ].join('\n')
    expect(parseSoftwareRoutes(raw)).toEqual({
      status: 'parsed',
      data: { rows: [], unparsedLines: 0 },
      raw
    })
  })

  it('skips a bad software-route line and counts it without failing', () => {
    const raw = `${fixture('show-route-ipv4.txt').trimEnd()}\n???\n`
    const result = parseSoftwareRoutes(raw)
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') {
      return
    }
    expect(result.data.unparsedLines).toBe(1)
    expect(result.data.rows).toHaveLength(4)
  })

  it('fails when the software-route skeleton is absent', () => {
    const raw = 'no ip routes\n'
    expect(parseSoftwareRoutes(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing software route skeleton'
    })
  })
})

describe('parseHardwareRoutes', () => {
  it('parses the golden hardware forwarding table', () => {
    expect(parseHardwareRoutes(fixture('show-route-forward-route-ipv4-all.txt'))).toEqual({
      status: 'parsed',
      data: {
        totalRouteCount: '3',
        rows: [
          {
            destination: '192.0.2.4/32',
            nextHopMac: '02:00:00:00:00:01',
            port: 'connected'
          },
          {
            destination: '192.0.2.0/24',
            nextHopMac: '02:00:00:00:00:01',
            port: 'connected'
          },
          {
            destination: '0.0.0.0/0',
            nextHopMac: '02:00:00:00:00:01',
            port: 'connected'
          }
        ],
        unparsedLines: 0
      },
      raw: fixture('show-route-forward-route-ipv4-all.txt')
    })
  })

  it('treats a header-only hardware route table as parsed zero rows', () => {
    const raw = [
      'Destination          NextHopMac          Port',
      '---------------      -----------------   ---------',
      'Total route count:0'
    ].join('\n')
    expect(parseHardwareRoutes(raw)).toEqual({
      status: 'parsed',
      data: { totalRouteCount: '0', rows: [], unparsedLines: 0 },
      raw
    })
  })

  it('fails when the hardware-route skeleton is absent', () => {
    const raw = 'forwarding table unavailable\n'
    expect(parseHardwareRoutes(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing hardware route skeleton'
    })
  })
})

describe('parseHardwareHosts', () => {
  it('parses the golden empty hardware host table as parsed zero rows', () => {
    expect(parseHardwareHosts(fixture('show-route-forward-host-ipv4-all.txt'))).toEqual({
      status: 'parsed',
      data: {
        totalHostCount: '0',
        rows: [],
        unparsedLines: 0
      },
      raw: fixture('show-route-forward-host-ipv4-all.txt')
    })
  })

  it('parses a populated hardware host row aligned to the golden header', () => {
    const skeleton = fixture('show-route-forward-host-ipv4-all.txt').trimEnd()
    const raw = `${skeleton.replace('Total host count:0', '192.0.2.5         02:00:00:00:00:01   eth0\nTotal host count:1')}\n`
    const result = parseHardwareHosts(raw)
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') {
      return
    }
    expect(result.data.totalHostCount).toBe('1')
    expect(result.data.rows).toEqual([
      {
        address: '192.0.2.5',
        hwAddress: '02:00:00:00:00:01',
        port: 'eth0'
      }
    ])
  })

  it('fails when the hardware-host skeleton is absent', () => {
    const raw = 'no host entries\n'
    expect(parseHardwareHosts(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing hardware host skeleton'
    })
  })
})

describe('parseArp', () => {
  it('parses the golden empty ARP table as parsed zero rows, not an error', () => {
    expect(parseArp(fixture('show-arp.txt'))).toEqual({
      status: 'parsed',
      data: {
        agingTime: '1200',
        totalCount: '0',
        rows: [],
        unparsedLines: 0
      },
      raw: fixture('show-arp.txt')
    })
  })

  it('parses a populated ARP row under the documented Address/HW Address header', () => {
    expect(parseArp(POPULATED_ARP)).toEqual({
      status: 'parsed',
      data: {
        agingTime: '1200',
        totalCount: '1',
        rows: [
          {
            address: '192.0.2.5',
            hwAddress: '02:00:00:00:00:01',
            type: 'dynamic',
            interface: 'eth0',
            age: '12'
          }
        ],
        unparsedLines: 0
      },
      raw: POPULATED_ARP
    })
  })

  it('skips a bad ARP row and counts it without failing', () => {
    const raw = `${POPULATED_ARP}\n???\n`
    const result = parseArp(raw)
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') {
      return
    }
    expect(result.data.unparsedLines).toBe(1)
    expect(result.data.rows).toHaveLength(1)
  })

  it('fails when the ARP skeleton is absent', () => {
    const raw = 'arp table unavailable\n'
    expect(parseArp(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing arp skeleton'
    })
  })
})

describe('parseNeighbors', () => {
  it('parses the golden empty IPv6 neighbor table as parsed zero rows, not an error', () => {
    expect(parseNeighbors(fixture('show-neighbors.txt'))).toEqual({
      status: 'parsed',
      data: {
        agingTime: '1200',
        totalCount: '0',
        rows: [],
        unparsedLines: 0
      },
      raw: fixture('show-neighbors.txt')
    })
  })

  it('parses a populated IPv6 neighbor row', () => {
    expect(parseNeighbors(POPULATED_NEIGHBORS)).toEqual({
      status: 'parsed',
      data: {
        agingTime: '1200',
        totalCount: '1',
        rows: [
          {
            address: '2001:db8::1',
            hwAddress: '02:00:00:00:00:01',
            type: 'dynamic',
            interface: 'eth0',
            age: '12'
          }
        ],
        unparsedLines: 0
      },
      raw: POPULATED_NEIGHBORS
    })
  })

  it('fails when the neighbor skeleton is absent', () => {
    const raw = 'neighbor table unavailable\n'
    expect(parseNeighbors(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing neighbor skeleton'
    })
  })
})

describe('parseL3', () => {
  it('parses framed software/hardware routes with empty ARP and neighbors', () => {
    const block = parseL3([
      { command: 'show route ipv4 | no-more', output: fixture('show-route-ipv4.txt') },
      {
        command: 'show route forward-route ipv4 all',
        output: fixture('show-route-forward-route-ipv4-all.txt')
      },
      {
        command: 'show route forward-host ipv4 all | no-more',
        output: fixture('show-route-forward-host-ipv4-all.txt')
      },
      { command: 'show arp', output: fixture('show-arp.txt') },
      { command: 'show neighbors', output: fixture('show-neighbors.txt') }
    ])
    expect(block.softwareRoutes.status).toBe('parsed')
    expect(block.hardwareRoutes.status).toBe('parsed')
    expect(block.hardwareHosts).toEqual({
      status: 'parsed',
      data: { totalHostCount: '0', rows: [], unparsedLines: 0 },
      raw: fixture('show-route-forward-host-ipv4-all.txt')
    })
    expect(block.arp).toEqual({
      status: 'parsed',
      data: { agingTime: '1200', totalCount: '0', rows: [], unparsedLines: 0 },
      raw: fixture('show-arp.txt')
    })
    expect(block.neighbors).toEqual({
      status: 'parsed',
      data: { agingTime: '1200', totalCount: '0', rows: [], unparsedLines: 0 },
      raw: fixture('show-neighbors.txt')
    })
    if (block.softwareRoutes.status === 'parsed') {
      expect(block.softwareRoutes.data.rows).toHaveLength(4)
    }
    if (block.hardwareRoutes.status === 'parsed') {
      expect(block.hardwareRoutes.data.rows).toHaveLength(3)
    }
  })
})

describe('l3Card', () => {
  it('projects software and hardware routes side by side and empty ARP/neighbors as normal data', () => {
    const block = parseL3([
      { command: 'show route ipv4', output: fixture('show-route-ipv4.txt') },
      {
        command: 'show route forward-route ipv4 all',
        output: fixture('show-route-forward-route-ipv4-all.txt')
      },
      {
        command: 'show route forward-host ipv4 all',
        output: fixture('show-route-forward-host-ipv4-all.txt')
      },
      { command: 'show arp', output: fixture('show-arp.txt') },
      { command: 'show neighbors', output: fixture('show-neighbors.txt') }
    ])
    const card = l3Card(block, 'combined-raw')
    expect(card.parseFailed).toBe(false)
    expect(card.parseFailedNotice).toBeNull()
    expect(card.softwareRoutes).toHaveLength(4)
    expect(card.softwareRoutes?.[0]).toMatchObject({
      destination: '0.0.0.0/0',
      flags: '>*',
      prefMetric: '0/2',
      nexthopLabel: '192.0.2.5'
    })
    expect(card.softwareRoutes?.[1]).toMatchObject({
      flags: ' *',
      nexthopLabel: 'unreachable (blackhole)'
    })
    expect(card.softwareRoutes?.[2]).toMatchObject({
      nexthopLabel: 'connected'
    })
    expect(card.hardwareRoutes).toHaveLength(3)
    expect(card.hardwareHosts).toEqual([])
    expect(card.arp).toEqual([])
    expect(card.neighbors).toEqual([])
    expect(card.emptySoftwareRoutesNotice).toBeNull()
    expect(card.emptyHardwareRoutesNotice).toBeNull()
    expect(card.emptyHardwareHostsNotice).toBe('No hardware host rows.')
    expect(card.emptyArpNotice).toBe('No ARP rows.')
    expect(card.emptyNeighborsNotice).toBe('No neighbor rows.')
    expect(card.hardwareRouteCount).toBe('3')
    expect(card.hardwareHostCount).toBe('0')
    expect(card.arpAgingTime).toBe('1200')
    expect(card.arpTotalCount).toBe('0')
    expect(card.neighborAgingTime).toBe('1200')
    expect(card.neighborTotalCount).toBe('0')
    expect(card.raw).toBe('combined-raw')
    expect(card.viewRawLabel).toBe(VIEW_RAW_LABEL)
  })

  it('puts parse-failed raw on the card notice', () => {
    const raw = 'garbled l3 text'
    const empty = {
      status: 'parsed' as const,
      data: { rows: [], unparsedLines: 0 },
      raw: 'empty'
    }
    const card = l3Card(
      {
        softwareRoutes: { status: 'parse-failed', raw, reason: 'missing software route skeleton' },
        hardwareRoutes: empty,
        hardwareHosts: empty,
        arp: empty,
        neighbors: empty
      },
      raw
    )
    expect(card.parseFailed).toBe(true)
    expect(card.parseFailedNotice).toBe(PARSE_FAILED_NOTICE)
    expect(card.softwareRoutesFailure).toEqual({
      reason: 'missing software route skeleton',
      raw
    })
    expect(card.softwareRoutes).toBeNull()
    expect(card.arp).toEqual([])
    expect(card.emptyArpNotice).toBe('No ARP rows.')
  })
})

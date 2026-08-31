import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseVersion } from './device-facts'
import {
  DEFAULT_PING_COUNT,
  MAX_PING_COUNT,
  authorizeRunShow,
  parseRunShowOutput
} from './run-show'

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures/picos', name), 'utf8')
}

describe('authorizeRunShow', () => {
  it('allows a show command and appends the no-more filter', () => {
    expect(authorizeRunShow('show version')).toEqual({
      ok: true,
      verb: 'show',
      inner: 'show version | no-more',
      cliCommand: "cli -c 'show version | no-more'"
    })
  })

  it('does not duplicate no-more when the command already ends with it', () => {
    expect(authorizeRunShow('  SHOW VERSION |  NO-MORE  ')).toEqual({
      ok: true,
      verb: 'show',
      inner: 'show version | no-more',
      cliCommand: "cli -c 'show version | no-more'"
    })
  })

  it('allows the five known pipe filters and still appends no-more', () => {
    expect(
      authorizeRunShow('show log | match "BGP down" | except keep | find PICOS | count')
    ).toEqual({
      ok: true,
      verb: 'show',
      inner: 'show log | match "BGP down" | except keep | find PICOS | count | no-more',
      cliCommand:
        'cli -c \'show log | match "BGP down" | except keep | find PICOS | count | no-more\''
    })
  })

  it('allows an interface detail show with a parenthesized port', () => {
    expect(authorizeRunShow('show interface detail te-1/1/1(29)')).toEqual({
      ok: true,
      verb: 'show',
      inner: 'show interface detail te-1/1/1(29) | no-more',
      cliCommand: "cli -c 'show interface detail te-1/1/1(29) | no-more'"
    })
  })

  it('rejects a bare show with no arguments', () => {
    expect(authorizeRunShow('show')).toEqual({
      ok: false,
      reason: 'run_show only allows show and ping commands.'
    })
    expect(authorizeRunShow('')).toEqual({
      ok: false,
      reason: 'run_show only allows show and ping commands.'
    })
  })

  it('rejects configuration and write commands', () => {
    expect(authorizeRunShow('configure')).toEqual({
      ok: false,
      reason: 'run_show only allows show and ping commands.'
    })
    expect(authorizeRunShow('set vlans vlan-id 10')).toEqual({
      ok: false,
      reason: 'run_show only allows show and ping commands.'
    })
    expect(authorizeRunShow('file delete /tmp/x')).toEqual({
      ok: false,
      reason: 'run_show only allows show and ping commands.'
    })
    expect(authorizeRunShow('clear arp')).toEqual({
      ok: false,
      reason: 'run_show only allows show and ping commands.'
    })
    expect(authorizeRunShow("cli -c 'show version'")).toEqual({
      ok: false,
      reason: 'run_show only allows show and ping commands.'
    })
    expect(authorizeRunShow('run show arp')).toEqual({
      ok: false,
      reason: 'run_show only allows show and ping commands.'
    })
  })

  it('rejects command chaining', () => {
    expect(authorizeRunShow('show version; configure')).toEqual({
      ok: false,
      reason: 'run_show does not allow command chaining.'
    })
    expect(authorizeRunShow('show version ; show arp')).toEqual({
      ok: false,
      reason: 'run_show does not allow command chaining.'
    })
    expect(authorizeRunShow('show version && show arp')).toEqual({
      ok: false,
      reason: 'run_show does not allow command chaining.'
    })
    expect(authorizeRunShow('ping 192.0.2.1 &')).toEqual({
      ok: false,
      reason: 'run_show does not allow command chaining.'
    })
  })

  it('rejects non-whitelisted pipe filters', () => {
    expect(authorizeRunShow('show version | display xml')).toEqual({
      ok: false,
      reason: 'run_show does not allow the "display" pipe filter.'
    })
    expect(authorizeRunShow('show arp | json')).toEqual({
      ok: false,
      reason: 'run_show does not allow the "json" pipe filter.'
    })
    expect(authorizeRunShow('show version | compare')).toEqual({
      ok: false,
      reason: 'run_show does not allow the "compare" pipe filter.'
    })
    expect(authorizeRunShow('show log | save /tmp/x')).toEqual({
      ok: false,
      reason: 'run_show does not allow the "save" pipe filter.'
    })
  })

  it('rejects an empty pipe segment', () => {
    expect(authorizeRunShow('show version | | count')).toEqual({
      ok: false,
      reason: 'run_show does not allow command chaining.'
    })
  })

  it('allows ping with a valid IPv4 target and injects the default count', () => {
    expect(DEFAULT_PING_COUNT).toBe(5)
    expect(authorizeRunShow('ping 192.0.2.1')).toEqual({
      ok: true,
      verb: 'ping',
      inner: 'ping 192.0.2.1 count 5 | no-more',
      cliCommand: "cli -c 'ping 192.0.2.1 count 5 | no-more'"
    })
  })

  it('allows ping with a hostname and a count at the cap', () => {
    expect(MAX_PING_COUNT).toBe(20)
    expect(authorizeRunShow('ping lab-switch.example count 20')).toEqual({
      ok: true,
      verb: 'ping',
      inner: 'ping lab-switch.example count 20 | no-more',
      cliCommand: "cli -c 'ping lab-switch.example count 20 | no-more'"
    })
  })

  it('allows ping with a compressed IPv6 target', () => {
    expect(authorizeRunShow('ping 2001:db8::1 count 3')).toEqual({
      ok: true,
      verb: 'ping',
      inner: 'ping 2001:db8::1 count 3 | no-more',
      cliCommand: "cli -c 'ping 2001:db8::1 count 3 | no-more'"
    })
  })

  it('rejects ping without a valid target', () => {
    expect(authorizeRunShow('ping')).toEqual({
      ok: false,
      reason: 'invalid ping target: ""'
    })
    expect(authorizeRunShow('ping count 5')).toEqual({
      ok: false,
      reason: 'invalid ping target: ""'
    })
    expect(authorizeRunShow('ping not a host')).toEqual({
      ok: false,
      reason: 'run_show ping takes a single target and optional count.'
    })
    expect(authorizeRunShow('ping 999.999.999.999')).toEqual({
      ok: false,
      reason: 'invalid ping target: "999.999.999.999"'
    })
    expect(authorizeRunShow('ping -n 5')).toEqual({
      ok: false,
      reason: 'run_show ping takes a single target and optional count.'
    })
  })

  it('rejects a ping count of zero, a non-integer, or above the cap', () => {
    expect(authorizeRunShow('ping 192.0.2.1 count 0')).toEqual({
      ok: false,
      reason: 'invalid ping count: 0'
    })
    expect(authorizeRunShow('ping 192.0.2.1 count 21')).toEqual({
      ok: false,
      reason: 'invalid ping count: 21'
    })
    expect(authorizeRunShow('ping 192.0.2.1 count 1.5')).toEqual({
      ok: false,
      reason: 'invalid ping count: 1.5'
    })
  })

  it('escapes single quotes when wrapping cli -c', () => {
    expect(authorizeRunShow(`show log | match "it's down"`)).toEqual({
      ok: true,
      verb: 'show',
      inner: `show log | match "it's down" | no-more`,
      cliCommand: `cli -c 'show log | match "it'\\''s down" | no-more'`
    })
  })
})

describe('parseRunShowOutput', () => {
  it('returns structured data when a known show command hits an existing parser', () => {
    const raw = fixture('show-version.txt')
    expect(parseRunShowOutput('show version | no-more', raw)).toEqual(parseVersion(raw))
  })

  it('returns parse-failed with raw when a known show command does not match its skeleton', () => {
    const raw = 'not a version listing\n'
    expect(parseRunShowOutput('show version', raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing version skeleton'
    })
  })

  it('returns raw text when the show command has no parser', () => {
    const raw = 'some long-tail show output'
    expect(parseRunShowOutput('show spanning-tree | no-more', raw)).toEqual({
      status: 'raw',
      raw
    })
  })

  it('returns raw text when extra pipe filters would change the output shape', () => {
    const raw = fixture('show-version.txt')
    expect(parseRunShowOutput('show version | match PICOS | no-more', raw)).toEqual({
      status: 'raw',
      raw
    })
  })

  it('returns raw text for ping', () => {
    const raw = 'PING 192.0.2.1: 56 data bytes'
    expect(parseRunShowOutput('ping 192.0.2.1 count 5 | no-more', raw)).toEqual({
      status: 'raw',
      raw
    })
  })
})

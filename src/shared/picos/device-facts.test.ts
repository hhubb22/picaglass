import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEVICE_FACTS_COMMANDS,
  PARSE_FAILED_NOTICE,
  VIEW_RAW_LABEL,
  deviceFactsCard,
  deviceFactsCliCommand,
  parseDeviceFacts,
  parseFans,
  parsePowerSupplies,
  parseTemperatures,
  parseVersion
} from './device-facts'

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures/picos', name), 'utf8')
}

describe('device facts commands', () => {
  it('is a fixed aggregated cli invocation with no interpolation holes', () => {
    expect(DEVICE_FACTS_COMMANDS).toEqual([
      'show version',
      'show system fan',
      'show system temperature',
      'show system rpsu'
    ])
    expect(deviceFactsCliCommand()).toBe(
      "cli -c 'show version | no-more; show system fan | no-more; show system temperature | no-more; show system rpsu | no-more'"
    )
    expect(deviceFactsCliCommand().includes('${')).toBe(false)
    expect(deviceFactsCliCommand().includes('%s')).toBe(false)
  })
})

describe('parseVersion', () => {
  it('parses the golden fixture including the empty Hardware ID merge quirk', () => {
    expect(parseVersion(fixture('show-version.txt'))).toEqual({
      status: 'parsed',
      data: {
        copyright: 'Copyright (C) 2009-2026 Pica8, Inc. All Rights Reserved.',
        model: 'S5810-28FS',
        softwareVersion: '9.8.7-main-EC1/86c10a20e6',
        softwareReleasedDate: '03/19/2026',
        serialNumber: '<SERIAL>',
        systemUptime: '164 day 6 hour 43 minute',
        licenseType: 'Uninstalled',
        deviceMacAddress: '02:00:00:00:00:01',
        unparsedLines: 0
      },
      raw: fixture('show-version.txt')
    })
  })

  it('keeps a missing field absent when the skeleton is present', () => {
    const raw =
      'Model                         : S5810-28FS\nSoftware Version              : 9.8.7-main-EC1\n'
    expect(parseVersion(raw)).toEqual({
      status: 'parsed',
      data: {
        model: 'S5810-28FS',
        softwareVersion: '9.8.7-main-EC1',
        unparsedLines: 0
      },
      raw
    })
  })

  it('fails when the version skeleton is absent', () => {
    const raw = 'not a version listing\n'
    expect(parseVersion(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing version skeleton'
    })
  })
})

describe('parseFans', () => {
  it('parses the golden fan fixture', () => {
    expect(parseFans(fixture('show-system-fan.txt'))).toEqual({
      status: 'parsed',
      data: {
        rows: [
          { id: '1', speed: '5415 RPM', pwm: '76', direction: 'Forward' },
          { id: '2', speed: '5520 RPM', pwm: '76', direction: 'Forward' },
          { id: '3', speed: '5535 RPM', pwm: '76', direction: 'Forward' }
        ],
        unparsedLines: 0
      },
      raw: fixture('show-system-fan.txt')
    })
  })

  it('treats an empty Fan Status table as parsed zero rows', () => {
    const raw = 'Fan Status:\n'
    expect(parseFans(raw)).toEqual({
      status: 'parsed',
      data: { rows: [], unparsedLines: 0 },
      raw
    })
  })

  it('skips a bad fan row and counts it without failing', () => {
    const raw =
      'Fan Status:\n    Fan  1 : garbled\n    Fan  2 : speed = 100 RPM, PWM = 10, Reverse\n'
    expect(parseFans(raw)).toEqual({
      status: 'parsed',
      data: {
        rows: [{ id: '2', speed: '100 RPM', pwm: '10', direction: 'Reverse' }],
        unparsedLines: 1
      },
      raw
    })
  })

  it('fails when the fan skeleton is absent', () => {
    const raw = 'no fans here\n'
    expect(parseFans(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing fan skeleton'
    })
  })
})

describe('parseTemperatures', () => {
  it('parses the golden temperature fixture', () => {
    expect(parseTemperatures(fixture('show-system-temperature.txt'))).toEqual({
      status: 'parsed',
      data: {
        rows: [
          { sensor: 'CPU', celsius: '33.00', fahrenheit: '91.40' },
          { sensor: 'Switch Chip', celsius: '27.00', fahrenheit: '80.60' }
        ],
        unparsedLines: 0
      },
      raw: fixture('show-system-temperature.txt')
    })
  })

  it('treats an empty Temperature table as parsed zero rows', () => {
    const raw = 'Temperature:\n'
    expect(parseTemperatures(raw)).toEqual({
      status: 'parsed',
      data: { rows: [], unparsedLines: 0 },
      raw
    })
  })

  it('fails when the temperature skeleton is absent', () => {
    const raw = 'cpu is warm\n'
    expect(parseTemperatures(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing temperature skeleton'
    })
  })
})

describe('parsePowerSupplies', () => {
  it('parses the golden RPSU fixture', () => {
    expect(parsePowerSupplies(fixture('show-system-rpsu.txt'))).toEqual({
      status: 'parsed',
      data: {
        rows: [
          { id: '1', status: 'Powered on' },
          { id: '2', status: 'Present but powered off' }
        ],
        unparsedLines: 0
      },
      raw: fixture('show-system-rpsu.txt')
    })
  })

  it('fails when the RPSU skeleton is absent', () => {
    const raw = 'no power supplies\n'
    expect(parsePowerSupplies(raw)).toEqual({
      status: 'parse-failed',
      raw,
      reason: 'missing power supply skeleton'
    })
  })
})

describe('parseDeviceFacts', () => {
  it('parses each framed command independently', () => {
    const block = parseDeviceFacts([
      { command: 'show version', output: fixture('show-version.txt') },
      { command: 'show system fan', output: fixture('show-system-fan.txt') },
      { command: 'show system temperature', output: fixture('show-system-temperature.txt') },
      { command: 'show system rpsu', output: fixture('show-system-rpsu.txt') }
    ])
    expect(block.version.status).toBe('parsed')
    expect(block.fans.status).toBe('parsed')
    expect(block.temperatures.status).toBe('parsed')
    expect(block.powerSupplies.status).toBe('parsed')
    if (block.version.status === 'parsed') {
      expect(block.version.data.model).toBe('S5810-28FS')
      expect(block.version.data.hardwareId).toBeUndefined()
    }
  })

  it('falls back to parsing the cleaned blob when command echo lines are missing', () => {
    const blob = [
      fixture('show-version.txt').trimEnd(),
      fixture('show-system-fan.txt').trimEnd(),
      fixture('show-system-temperature.txt').trimEnd(),
      fixture('show-system-rpsu.txt').trimEnd()
    ].join('\n')
    const block = parseDeviceFacts([], blob)
    expect(block.version.status).toBe('parsed')
    expect(block.fans.status).toBe('parsed')
    expect(block.temperatures.status).toBe('parsed')
    expect(block.powerSupplies.status).toBe('parsed')
  })

  it('marks a missing framed command as parse-failed and keeps the cleaned blob as raw', () => {
    const version = fixture('show-version.txt')
    const block = parseDeviceFacts([{ command: 'show version', output: version }], version)
    expect(block.fans).toEqual({
      status: 'parse-failed',
      raw: version,
      reason: 'missing fan skeleton'
    })
  })
})

describe('deviceFactsCard', () => {
  it('projects parsed facts for the panel and keeps a raw toggle label', () => {
    const block = parseDeviceFacts([
      { command: 'show version', output: fixture('show-version.txt') },
      { command: 'show system fan', output: fixture('show-system-fan.txt') },
      { command: 'show system temperature', output: fixture('show-system-temperature.txt') },
      { command: 'show system rpsu', output: fixture('show-system-rpsu.txt') }
    ])
    const card = deviceFactsCard(block, 'combined-raw')
    expect(card.parseFailed).toBe(false)
    expect(card.parseFailedNotice).toBeNull()
    expect(card.model).toBe('S5810-28FS')
    expect(card.hardwareId).toBeUndefined()
    expect(card.licenseType).toBe('Uninstalled')
    expect(card.fans).toHaveLength(3)
    expect(card.temperatures).toHaveLength(2)
    expect(card.powerSupplies).toHaveLength(2)
    expect(card.raw).toBe('combined-raw')
    expect(card.viewRawLabel).toBe(VIEW_RAW_LABEL)
    expect(VIEW_RAW_LABEL).toBe('查看原文')
  })

  it('puts parse-failed raw on the card notice', () => {
    const raw = 'garbled version text'
    const card = deviceFactsCard(
      {
        version: { status: 'parse-failed', raw, reason: 'missing version skeleton' },
        fans: { status: 'parsed', data: { rows: [], unparsedLines: 0 }, raw: 'Fan Status:\n' },
        temperatures: { status: 'parse-failed', raw: '', reason: 'missing temperature skeleton' },
        powerSupplies: { status: 'parse-failed', raw: '', reason: 'missing power supply skeleton' }
      },
      raw
    )
    expect(card.parseFailed).toBe(true)
    expect(card.parseFailedNotice).toBe(PARSE_FAILED_NOTICE)
    expect(PARSE_FAILED_NOTICE).toBe('解析失败，以下为设备原文')
    expect(card.versionFailure).toEqual({ reason: 'missing version skeleton', raw })
    expect(card.model).toBeUndefined()
    expect(card.fans).toEqual([])
  })
})

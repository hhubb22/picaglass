import { describe, expect, it } from 'vitest'
import {
  MACHINE_SNAPSHOT_COMMAND,
  MACHINE_SNAPSHOT_FIELD_MAX_LENGTH,
  MACHINE_SNAPSHOT_OUTPUT_CAP_BYTES,
  MACHINE_SNAPSHOT_TIMEOUT_MS,
  applyDiscoveryRun,
  interpretDiscoveryOutput,
  machineSnapshotCard,
  sanitizeSnapshotField
} from './machine-snapshot'

describe('discovery command', () => {
  it('is a fixed POSIX probe with no interpolation holes', () => {
    expect(MACHINE_SNAPSHOT_COMMAND).toBe('uname -n; uname -s; uname -r; uname -m')
    expect(MACHINE_SNAPSHOT_COMMAND.includes('${')).toBe(false)
    expect(MACHINE_SNAPSHOT_COMMAND.includes('%s')).toBe(false)
    expect(MACHINE_SNAPSHOT_TIMEOUT_MS).toBe(5_000)
    expect(MACHINE_SNAPSHOT_OUTPUT_CAP_BYTES).toBe(32 * 1024)
  })
})

describe('sanitizeSnapshotField', () => {
  it('strips control characters, trims, and drops a blank result', () => {
    expect(sanitizeSnapshotField('  web-1\u0000\u0007  ')).toBe('web-1')
    expect(sanitizeSnapshotField('\u0001\u001f\u007f')).toBeUndefined()
    expect(sanitizeSnapshotField('   ')).toBeUndefined()
  })

  it('caps field length', () => {
    const raw = 'h'.repeat(MACHINE_SNAPSHOT_FIELD_MAX_LENGTH + 20)
    expect(sanitizeSnapshotField(raw)).toBe('h'.repeat(MACHINE_SNAPSHOT_FIELD_MAX_LENGTH))
  })
})

describe('interpretDiscoveryOutput', () => {
  it('reads hostname, kernel name, kernel release, and architecture from four lines', () => {
    expect(
      interpretDiscoveryOutput({
        stdout: 'web-1\nLinux\n6.8.0-1-amd64\nx86_64\n',
        stderr: ''
      })
    ).toEqual({
      status: 'observed',
      facts: {
        hostname: 'web-1',
        kernelName: 'Linux',
        kernelRelease: '6.8.0-1-amd64',
        architecture: 'x86_64'
      }
    })
  })

  it('keeps only fields present in this run after sanitizing', () => {
    expect(
      interpretDiscoveryOutput({
        stdout: 'web-1\x00\nLinux\n\n\n',
        stderr: ''
      })
    ).toEqual({
      status: 'observed',
      facts: {
        hostname: 'web-1',
        kernelName: 'Linux'
      }
    })
  })

  it('treats Windows and non-POSIX targets as unavailable', () => {
    expect(
      interpretDiscoveryOutput({
        stdout: 'DESKTOP-1\nWindows_NT\n10.0\nx64\n',
        stderr: ''
      })
    ).toEqual({ status: 'unavailable' })
    expect(
      interpretDiscoveryOutput({
        stdout: '',
        stderr: "'uname' is not recognized as an internal or external command"
      })
    ).toEqual({ status: 'unavailable' })
  })

  it('treats empty untrusted output as a total failure', () => {
    expect(interpretDiscoveryOutput({ stdout: '\x00\x07\n\n', stderr: '' })).toEqual({
      status: 'failed'
    })
  })
})

describe('applyDiscoveryRun', () => {
  const previous = {
    hostname: 'old-host',
    kernelName: 'Linux',
    kernelRelease: '5.10.0',
    architecture: 'x86_64',
    observedAt: '2024-01-01T00:00:00.000Z'
  }

  it('replaces the previous Machine Snapshot and never merges partial facts', () => {
    expect(
      applyDiscoveryRun(
        previous,
        { status: 'observed', facts: { hostname: 'web-1', kernelName: 'Linux' } },
        '2024-06-01T12:00:00.000Z'
      )
    ).toEqual({
      hostname: 'web-1',
      kernelName: 'Linux',
      observedAt: '2024-06-01T12:00:00.000Z'
    })
  })

  it('preserves the older snapshot on total failure and records the failed refresh time', () => {
    expect(applyDiscoveryRun(previous, { status: 'failed' }, '2024-06-01T12:00:00.000Z')).toEqual({
      hostname: 'old-host',
      kernelName: 'Linux',
      kernelRelease: '5.10.0',
      architecture: 'x86_64',
      observedAt: '2024-01-01T00:00:00.000Z',
      failedRefreshAt: '2024-06-01T12:00:00.000Z'
    })
  })

  it('marks discovery unavailable without inventing facts', () => {
    expect(
      applyDiscoveryRun(undefined, { status: 'unavailable' }, '2024-06-01T12:00:00.000Z')
    ).toEqual({
      unavailable: true
    })
  })
})

describe('machineSnapshotCard', () => {
  it('labels a preserved snapshot as Last observed when refresh failed', () => {
    expect(
      machineSnapshotCard({
        hostname: 'old-host',
        observedAt: '2024-01-01T00:00:00.000Z',
        failedRefreshAt: '2024-06-01T12:00:00.000Z'
      })
    ).toEqual({
      empty: false,
      unavailable: false,
      lastObserved: true,
      hasFacts: true,
      hostname: 'old-host',
      observedAt: '2024-01-01T00:00:00.000Z',
      failedRefreshAt: '2024-06-01T12:00:00.000Z'
    })
  })

  it('shows discovery unavailable when there are no POSIX facts', () => {
    expect(machineSnapshotCard({ unavailable: true })).toEqual({
      empty: false,
      unavailable: true,
      lastObserved: false,
      hasFacts: false
    })
  })
})

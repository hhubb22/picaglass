import type { ExecChannelResult } from '../ssh/create-ssh-api'
import { frameCliOutput } from './frame-cli-output'
import {
  deviceFactsCliCommand,
  parseDeviceFacts,
  type DeviceFactsRun
} from '../../shared/picos/device-facts'

export const DIAGNOSTICS_STDERR_HEAD_CHARS = 200

export type DiagnosticsApi = {
  runDeviceFacts: (profileId: string) => Promise<DeviceFactsRun>
}

export type CreateDiagnosticsApiDeps = {
  hasLiveSession: (profileId: string) => boolean
  exec: (profileId: string, command: string) => Promise<ExecChannelResult>
}

function head(text: string): string {
  return text.slice(0, DIAGNOSTICS_STDERR_HEAD_CHARS)
}

function stderrHead(stderr: string, stdout: string): string {
  if (stderr.length > 0) {
    return head(stderr)
  }
  return head(stdout)
}

function channelFailure(captured: ExecChannelResult): DeviceFactsRun {
  if (captured.ok) {
    throw new Error('expected a channel failure')
  }
  if (captured.reason === 'no-session') {
    return { kind: 'no-session' }
  }
  if (captured.reason === 'timeout') {
    return {
      kind: 'channel-failed',
      reason: 'timeout',
      stderrHead: stderrHead(captured.stderr, captured.stdout)
    }
  }
  if (captured.reason === 'rejected') {
    return {
      kind: 'channel-failed',
      reason: 'rejected',
      stderrHead: head(captured.message)
    }
  }
  return {
    kind: 'channel-failed',
    reason: 'nonzero-exit',
    exitCode: captured.exitCode,
    stderrHead: stderrHead(captured.stderr, captured.stdout)
  }
}

export function createDiagnosticsApi(deps: CreateDiagnosticsApiDeps): DiagnosticsApi {
  const inflight = new Map<string, Promise<DeviceFactsRun>>()

  async function runDeviceFactsOnce(profileId: string): Promise<DeviceFactsRun> {
    if (!deps.hasLiveSession(profileId)) {
      return { kind: 'no-session' }
    }
    const captured = await deps.exec(profileId, deviceFactsCliCommand())
    if (!captured.ok) {
      return channelFailure(captured)
    }
    const framed = frameCliOutput(captured.stdout)
    const block = parseDeviceFacts(framed.commands, framed.cleaned)
    return { kind: 'ok', block, raw: framed.cleaned }
  }

  return {
    runDeviceFacts(profileId) {
      const key = `device-facts:${profileId.trim()}`
      const existing = inflight.get(key)
      if (existing !== undefined) {
        return existing
      }
      const promise = runDeviceFactsOnce(profileId.trim()).finally(() => {
        inflight.delete(key)
      })
      inflight.set(key, promise)
      return promise
    }
  }
}

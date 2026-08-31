import type { ExecChannelResult } from '../ssh/create-ssh-api'
import { frameCliOutput } from './frame-cli-output'
import {
  deviceFactsCliCommand,
  parseDeviceFacts,
  type DeviceFactsChannelFailure,
  type DeviceFactsRun
} from '../../shared/picos/device-facts'
import {
  interfaceStatusCliCommand,
  parseInterfaceStatus,
  type InterfaceStatusChannelFailure,
  type InterfaceStatusRun
} from '../../shared/picos/interface-status'
import { l2CliCommand, parseL2, type L2ChannelFailure, type L2Run } from '../../shared/picos/l2'

export const DIAGNOSTICS_STDERR_HEAD_CHARS = 200

export type DiagnosticsApi = {
  runDeviceFacts: (profileId: string) => Promise<DeviceFactsRun>
  runInterfaceStatus: (
    profileId: string,
    interfaces?: readonly string[]
  ) => Promise<InterfaceStatusRun>
  runL2: (profileId: string) => Promise<L2Run>
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

type ChannelFailure = DeviceFactsChannelFailure & InterfaceStatusChannelFailure & L2ChannelFailure

function channelFailure(captured: ExecChannelResult): { kind: 'no-session' } | ChannelFailure {
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
  const inflight = new Map<string, Promise<DeviceFactsRun | InterfaceStatusRun | L2Run>>()

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

  async function runInterfaceStatusOnce(
    profileId: string,
    interfaces: readonly string[]
  ): Promise<InterfaceStatusRun> {
    const cli = interfaceStatusCliCommand(interfaces)
    if (!cli.ok) {
      return { kind: 'invalid-interfaces', reason: cli.reason }
    }
    if (!deps.hasLiveSession(profileId)) {
      return { kind: 'no-session' }
    }
    const captured = await deps.exec(profileId, cli.command)
    if (!captured.ok) {
      return channelFailure(captured)
    }
    const framed = frameCliOutput(captured.stdout)
    const block = parseInterfaceStatus(framed.commands, framed.cleaned, {
      includeDetails: cli.names.length > 0
    })
    return { kind: 'ok', block, raw: framed.cleaned }
  }

  async function runL2Once(profileId: string): Promise<L2Run> {
    if (!deps.hasLiveSession(profileId)) {
      return { kind: 'no-session' }
    }
    const captured = await deps.exec(profileId, l2CliCommand())
    if (!captured.ok) {
      return channelFailure(captured)
    }
    const framed = frameCliOutput(captured.stdout)
    const block = parseL2(framed.commands, framed.cleaned)
    return { kind: 'ok', block, raw: framed.cleaned }
  }

  function dedupe<T extends DeviceFactsRun | InterfaceStatusRun | L2Run>(
    key: string,
    start: () => Promise<T>
  ): Promise<T> {
    const existing = inflight.get(key)
    if (existing !== undefined) {
      return existing as Promise<T>
    }
    const promise = start().finally(() => {
      inflight.delete(key)
    })
    inflight.set(key, promise)
    return promise
  }

  return {
    runDeviceFacts(profileId) {
      const id = profileId.trim()
      return dedupe(`device-facts:${id}`, () => runDeviceFactsOnce(id))
    },
    runInterfaceStatus(profileId, interfaces = []) {
      const id = profileId.trim()
      const parsed = interfaceStatusCliCommand(interfaces)
      const namesKey = parsed.ok ? parsed.names.join('\0') : parsed.reason
      return dedupe(`interface-status:${id}:${namesKey}`, () =>
        runInterfaceStatusOnce(id, interfaces)
      )
    },
    runL2(profileId) {
      const id = profileId.trim()
      return dedupe(`l2:${id}`, () => runL2Once(id))
    }
  }
}

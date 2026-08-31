export const MACHINE_SNAPSHOT_COMMAND = 'uname -n; uname -s; uname -r; uname -m'
export const MACHINE_SNAPSHOT_TIMEOUT_MS = 5_000
export const MACHINE_SNAPSHOT_OUTPUT_CAP_BYTES = 32 * 1024
export const MACHINE_SNAPSHOT_FIELD_MAX_LENGTH = 255

export type MachineSnapshotFacts = {
  hostname?: string
  kernelName?: string
  kernelRelease?: string
  architecture?: string
}

export type MachineSnapshot = MachineSnapshotFacts & {
  observedAt?: string
  failedRefreshAt?: string
  unavailable?: boolean
}

export type DiscoveryRun =
  | { status: 'observed'; facts: MachineSnapshotFacts }
  | { status: 'failed' }
  | { status: 'unavailable' }

function isControlChar(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
}

export function sanitizeSnapshotField(raw: string): string | undefined {
  let stripped = ''
  for (const char of raw) {
    const code = char.codePointAt(0)
    if (code === undefined || isControlChar(code)) {
      continue
    }
    stripped += char
  }
  stripped = stripped.trim()
  if (stripped.length === 0) {
    return undefined
  }
  return stripped.slice(0, MACHINE_SNAPSHOT_FIELD_MAX_LENGTH)
}

const WINDOWS_KERNEL = /^(Windows_NT|MINGW|MSYS|CYGWIN)/i
const WINDOWS_ERROR =
  /is not recognized as an internal or external command|'uname' is not recognized/i

function factsFromLines(stdout: string): MachineSnapshotFacts {
  const lines = stdout.split(/\r?\n/)
  const facts: MachineSnapshotFacts = {}
  const hostname = sanitizeSnapshotField(lines[0] ?? '')
  const kernelName = sanitizeSnapshotField(lines[1] ?? '')
  const kernelRelease = sanitizeSnapshotField(lines[2] ?? '')
  const architecture = sanitizeSnapshotField(lines[3] ?? '')
  if (hostname !== undefined) {
    facts.hostname = hostname
  }
  if (kernelName !== undefined) {
    facts.kernelName = kernelName
  }
  if (kernelRelease !== undefined) {
    facts.kernelRelease = kernelRelease
  }
  if (architecture !== undefined) {
    facts.architecture = architecture
  }
  return facts
}

export function hasSnapshotFacts(facts: MachineSnapshotFacts): boolean {
  return (
    facts.hostname !== undefined ||
    facts.kernelName !== undefined ||
    facts.kernelRelease !== undefined ||
    facts.architecture !== undefined
  )
}

function isNonPosix(facts: MachineSnapshotFacts, stderr: string): boolean {
  if (facts.kernelName !== undefined && WINDOWS_KERNEL.test(facts.kernelName)) {
    return true
  }
  return WINDOWS_ERROR.test(stderr)
}

export function interpretDiscoveryOutput(input: {
  stdout: string
  stderr: string
}): DiscoveryRun {
  const facts = factsFromLines(input.stdout)
  if (isNonPosix(facts, input.stderr)) {
    return { status: 'unavailable' }
  }
  if (hasSnapshotFacts(facts)) {
    return { status: 'observed', facts }
  }
  return { status: 'failed' }
}

function copiedFacts(snapshot: MachineSnapshot): MachineSnapshotFacts {
  const facts: MachineSnapshotFacts = {}
  if (snapshot.hostname !== undefined) {
    facts.hostname = snapshot.hostname
  }
  if (snapshot.kernelName !== undefined) {
    facts.kernelName = snapshot.kernelName
  }
  if (snapshot.kernelRelease !== undefined) {
    facts.kernelRelease = snapshot.kernelRelease
  }
  if (snapshot.architecture !== undefined) {
    facts.architecture = snapshot.architecture
  }
  return facts
}

export function applyDiscoveryRun(
  previous: MachineSnapshot | undefined,
  run: DiscoveryRun,
  at: string
): MachineSnapshot {
  if (run.status === 'observed') {
    return { ...run.facts, observedAt: at }
  }
  const prior = previous !== undefined && hasSnapshotFacts(previous) ? previous : undefined
  if (prior === undefined) {
    return { unavailable: true }
  }
  const next: MachineSnapshot = {
    ...copiedFacts(prior),
    failedRefreshAt: at
  }
  if (prior.observedAt !== undefined) {
    next.observedAt = prior.observedAt
  }
  if (run.status === 'unavailable') {
    next.unavailable = true
  }
  return next
}

export type MachineSnapshotCard = {
  empty: boolean
  unavailable: boolean
  lastObserved: boolean
  hasFacts: boolean
  hostname?: string
  kernelName?: string
  kernelRelease?: string
  architecture?: string
  observedAt?: string
  failedRefreshAt?: string
}

export function machineSnapshotCard(
  snapshot: MachineSnapshot | null | undefined
): MachineSnapshotCard {
  if (snapshot === null || snapshot === undefined) {
    return { empty: true, unavailable: false, lastObserved: false, hasFacts: false }
  }
  const facts = copiedFacts(snapshot)
  const hasFacts = hasSnapshotFacts(facts)
  if (!hasFacts) {
    const emptyCard: MachineSnapshotCard = {
      empty: false,
      unavailable: snapshot.unavailable === true || snapshot.failedRefreshAt !== undefined,
      lastObserved: false,
      hasFacts: false
    }
    if (snapshot.failedRefreshAt !== undefined) {
      emptyCard.failedRefreshAt = snapshot.failedRefreshAt
    }
    return emptyCard
  }
  const card: MachineSnapshotCard = {
    empty: false,
    unavailable: snapshot.unavailable === true,
    lastObserved: snapshot.failedRefreshAt !== undefined,
    hasFacts: true,
    ...facts
  }
  if (snapshot.observedAt !== undefined) {
    card.observedAt = snapshot.observedAt
  }
  if (snapshot.failedRefreshAt !== undefined) {
    card.failedRefreshAt = snapshot.failedRefreshAt
  }
  return card
}

export function parseStoredSnapshot(value: unknown): MachineSnapshot | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const raw = value as Record<string, unknown>
  const snapshot: MachineSnapshot = {}
  if (typeof raw.hostname === 'string') {
    snapshot.hostname = raw.hostname
  }
  if (typeof raw.kernelName === 'string') {
    snapshot.kernelName = raw.kernelName
  }
  if (typeof raw.kernelRelease === 'string') {
    snapshot.kernelRelease = raw.kernelRelease
  }
  if (typeof raw.architecture === 'string') {
    snapshot.architecture = raw.architecture
  }
  if (typeof raw.observedAt === 'string') {
    snapshot.observedAt = raw.observedAt
  }
  if (typeof raw.failedRefreshAt === 'string') {
    snapshot.failedRefreshAt = raw.failedRefreshAt
  }
  if (raw.unavailable === true) {
    snapshot.unavailable = true
  }
  if (
    !hasSnapshotFacts(snapshot) &&
    snapshot.observedAt === undefined &&
    snapshot.unavailable !== true &&
    snapshot.failedRefreshAt === undefined
  ) {
    return undefined
  }
  return snapshot
}

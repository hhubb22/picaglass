<script lang="ts">
  import type { RendererProfile } from '../../shared/profile'
  import { machineSnapshotCard } from '../../shared/machine-snapshot'
  import type { WorkspaceTab } from '../../shared/profile-workspace-ui'
  import {
    SESSION_STATE_LABEL,
    canCancelAttempt,
    canDisconnectSession,
    sessionIndicator,
    type ProfileSessionUi
  } from '../../shared/ssh-session-ui'
  import type { TranscriptEntry } from '../../shared/terminal-transcript'
  import type { HostTrustState } from '../../shared/ssh'
  import { hostTrustCard, HOST_TRUST_ACTION_LABEL } from '../../shared/host-trust-ui'
  import {
    ATTEMPT_OUTCOME_LABEL,
    type ConnectionAttemptSummary
  } from '../../shared/connection-attempt'
  import type { TerminalRegistry } from './terminal-registry'
  import ProfileTerminalHost from './ProfileTerminalHost.svelte'

  let {
    profile,
    tab,
    session,
    transcript,
    terminalIds,
    registry,
    hostTrust,
    onTab,
    onConnect,
    onCancel,
    onDisconnect,
    onClearTerminal,
    onEdit,
    onDelete,
    onForgetHostKey,
    onDismissFailure,
    onRefreshSnapshot
  }: {
    profile: RendererProfile
    tab: WorkspaceTab
    session: ProfileSessionUi
    transcript: TranscriptEntry[]
    terminalIds: string[]
    registry: TerminalRegistry
    hostTrust: HostTrustState
    onTab: (tab: WorkspaceTab) => void
    onConnect: () => void
    onCancel: () => void
    onDisconnect: () => void
    onClearTerminal: () => void
    onEdit: () => void
    onDelete: () => void
    onForgetHostKey: () => void
    onDismissFailure: () => void
    onRefreshSnapshot: () => void
  } = $props()

  const authSummary = $derived(
    profile.auth.method === 'password' ? 'Password' : `Private-key file (${profile.auth.label})`
  )
  const indicator = $derived(sessionIndicator(session.state))
  const idle = $derived(session.state === 'no-active-session')
  const showTerminalEmpty = $derived(idle && transcript.length === 0)
  const canConnect = $derived(idle && session.secretPrompt === null && !session.missingPrivateKey)
  const canCancel = $derived(canCancelAttempt(session.state))
  const canDisconnect = $derived(canDisconnectSession(session.state))
  const trustCard = $derived(hostTrustCard(hostTrust))
  const lastAttempt = $derived(profile.lastAttempt)
  const snapshotCard = $derived(machineSnapshotCard(profile.snapshot))

  function formatAttemptTime(iso: string): string {
    return new Date(iso).toLocaleString()
  }

  function attemptValue(
    attempt: ConnectionAttemptSummary,
    field: 'connectedAt' | 'endedAt' | 'outcome'
  ): string {
    if (field === 'outcome') {
      return attempt.outcome === undefined ? '—' : ATTEMPT_OUTCOME_LABEL[attempt.outcome]
    }
    const value = attempt[field]
    return value === undefined ? '—' : formatAttemptTime(value)
  }

  function formatSnapshotTime(iso: string): string {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) {
      return iso
    }
    return date.toLocaleString()
  }
</script>

<section class="workspace">
  <nav class="tabs">
    <button type="button" class:selected={tab === 'overview'} onclick={() => onTab('overview')}>
      Overview
    </button>
    <button type="button" class:selected={tab === 'terminal'} onclick={() => onTab('terminal')}>
      Terminal
    </button>
  </nav>

  <div class="overview" class:hidden={tab !== 'overview'}>
    {#if session.failureBanner !== null}
      <div class="failure-banner" role="alert">
        <p>
          {ATTEMPT_OUTCOME_LABEL[session.failureBanner.outcome]}
        </p>
        {#if session.failureBanner.detail !== null && session.failureBanner.detail.length > 0}
          <details>
            <summary>Technical details</summary>
            <p>{session.failureBanner.detail}</p>
          </details>
        {/if}
        <button type="button" onclick={onDismissFailure}>Dismiss</button>
      </div>
    {/if}
    <div class="header">
      <h1>{profile.label}</h1>
      <div class="rail">
        <button type="button" onclick={onEdit}>Edit</button>
        <button type="button" onclick={onDelete}>Delete</button>
      </div>
    </div>
    <article class="card">
      <h2>Session</h2>
      <p class="status">
        <span class="indicator {indicator}" aria-hidden="true"></span>
        <span>{SESSION_STATE_LABEL[session.state]}</span>
      </p>
      {#if session.error !== null && session.failureBanner === null}
        <p class="error" role="alert">{session.error}</p>
      {/if}
      <dl>
        <div>
          <dt>Host</dt>
          <dd>{profile.host}</dd>
        </div>
        <div>
          <dt>Port</dt>
          <dd>{profile.port}</dd>
        </div>
        <div>
          <dt>Username</dt>
          <dd>{profile.username}</dd>
        </div>
        <div>
          <dt>Authentication Method</dt>
          <dd>{authSummary}</dd>
        </div>
      </dl>
      {#if canConnect}
        <button type="button" onclick={onConnect}>Connect</button>
      {/if}
      {#if canCancel}
        <button type="button" onclick={onCancel}>Cancel</button>
      {/if}
      {#if canDisconnect}
        <button type="button" onclick={onDisconnect}>Disconnect</button>
      {/if}
    </article>
    <article class="card">
      <h2>Machine Snapshot</h2>
      {#if snapshotCard.empty}
        <p>No Machine Snapshot yet.</p>
      {:else if snapshotCard.unavailable && !snapshotCard.hasFacts}
        <p>Discovery unavailable</p>
        {#if snapshotCard.failedRefreshAt}
          <p class="meta">Refresh failed {formatSnapshotTime(snapshotCard.failedRefreshAt)}</p>
        {/if}
      {:else}
        {#if snapshotCard.lastObserved}
          <p class="meta">Last observed</p>
        {/if}
        {#if snapshotCard.unavailable}
          <p>Discovery unavailable</p>
        {/if}
        <dl>
          {#if snapshotCard.hostname}
            <div>
              <dt>Hostname</dt>
              <dd>{snapshotCard.hostname}</dd>
            </div>
          {/if}
          {#if snapshotCard.kernelName}
            <div>
              <dt>Kernel name</dt>
              <dd>{snapshotCard.kernelName}</dd>
            </div>
          {/if}
          {#if snapshotCard.kernelRelease}
            <div>
              <dt>Kernel release</dt>
              <dd>{snapshotCard.kernelRelease}</dd>
            </div>
          {/if}
          {#if snapshotCard.architecture}
            <div>
              <dt>Architecture</dt>
              <dd>{snapshotCard.architecture}</dd>
            </div>
          {/if}
        </dl>
        {#if snapshotCard.observedAt}
          <p class="meta">
            {#if snapshotCard.lastObserved}
              {formatSnapshotTime(snapshotCard.observedAt)}
            {:else}
              Observed {formatSnapshotTime(snapshotCard.observedAt)}
            {/if}
          </p>
        {/if}
        {#if snapshotCard.failedRefreshAt}
          <p class="meta">Refresh failed {formatSnapshotTime(snapshotCard.failedRefreshAt)}</p>
        {/if}
      {/if}
      {#if canDisconnect}
        <button type="button" onclick={onRefreshSnapshot}>Refresh</button>
      {/if}
    </article>
    <article class="card">
      <h2>Last Attempt</h2>
      {#if lastAttempt === null}
        <p>No Connection Attempt yet.</p>
      {:else}
        <dl>
          <div>
            <dt>Started</dt>
            <dd>{formatAttemptTime(lastAttempt.startedAt)}</dd>
          </div>
          <div>
            <dt>Connected</dt>
            <dd>{attemptValue(lastAttempt, 'connectedAt')}</dd>
          </div>
          <div>
            <dt>Ended</dt>
            <dd>{attemptValue(lastAttempt, 'endedAt')}</dd>
          </div>
          <div>
            <dt>Outcome</dt>
            <dd>{attemptValue(lastAttempt, 'outcome')}</dd>
          </div>
        </dl>
      {/if}
    </article>
    <article class="card">
      <h2>Host Trust</h2>
      <p>{trustCard.statusLabel}</p>
      {#if trustCard.algorithm !== null && trustCard.fingerprint !== null}
        <dl>
          <div>
            <dt>Algorithm</dt>
            <dd>{trustCard.algorithm}</dd>
          </div>
          <div>
            <dt>Fingerprint</dt>
            <dd class="fingerprint">{trustCard.fingerprint}</dd>
          </div>
        </dl>
      {/if}
      {#if trustCard.canForget}
        <button type="button" onclick={onForgetHostKey}>{HOST_TRUST_ACTION_LABEL.forget}</button>
      {/if}
    </article>
  </div>

  <div class="terminal-pane" class:hidden={tab !== 'terminal'}>
    {#if showTerminalEmpty}
      <div class="empty">
        <p>Connect to open an SSH Session for this Connection Profile.</p>
        {#if canConnect}
          <button type="button" onclick={onConnect}>Connect</button>
        {/if}
      </div>
    {:else}
      <div class="toolbar">
        {#if canCancel}
          <button type="button" onclick={onCancel}>Cancel</button>
        {/if}
        <button type="button" onclick={onClearTerminal}>Clear Terminal</button>
      </div>
    {/if}
    <div class="term-pool" class:hidden={showTerminalEmpty}>
      {#each terminalIds as id (id)}
        <ProfileTerminalHost
          profileId={id}
          {registry}
          hidden={id !== profile.id || tab !== 'terminal' || showTerminalEmpty}
        />
      {/each}
    </div>
  </div>
</section>

<style>
  .workspace {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    height: 100%;
  }

  .tabs {
    display: flex;
    gap: 8px;
    padding: 16px 24px 0;
  }

  .tabs button {
    font: inherit;
    padding: 8px 10px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
  }

  .tabs button.selected,
  .tabs button:focus-visible {
    border-color: #111;
    background: #f3f3f3;
  }

  .overview {
    display: grid;
    align-content: start;
    gap: 16px;
    padding: 24px;
    overflow: auto;
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 600;
  }

  .header {
    display: flex;
    gap: 12px;
    align-items: start;
    justify-content: space-between;
    max-width: 36rem;
  }

  .rail {
    display: flex;
    gap: 8px;
  }

  h2 {
    font-size: 1rem;
    font-weight: 600;
  }

  .card {
    display: grid;
    gap: 12px;
    border: 1px solid #d0d0d0;
    padding: 16px;
    max-width: 36rem;
  }

  .status {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .indicator {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: #888;
  }

  .indicator.pending,
  .indicator.attention {
    background: #c9a227;
  }

  .indicator.live {
    background: #2f7d32;
  }

  dl {
    display: grid;
    gap: 12px;
    margin: 0;
  }

  dl div {
    display: grid;
    gap: 2px;
  }

  dt {
    font-size: 0.8rem;
    color: #555;
  }

  dd {
    margin: 0;
  }

  .fingerprint {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    word-break: break-all;
  }

  .error {
    color: #b00020;
  }

  .failure-banner {
    display: grid;
    gap: 8px;
    border: 1px solid #b00020;
    padding: 12px 16px;
    max-width: 36rem;
  }

  .failure-banner p {
    color: #b00020;
  }

  .meta {
    margin: 0;
    font-size: 0.8rem;
    color: #555;
  }

  .terminal-pane {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    padding: 8px 8px 8px;
  }

  .toolbar {
    display: flex;
    justify-content: end;
    gap: 8px;
    padding: 4px 8px;
  }

  .empty {
    display: grid;
    gap: 12px;
    align-content: start;
    padding: 24px;
    max-width: 36rem;
  }

  .term-pool {
    position: relative;
    min-height: 0;
    background: #111;
  }

  .hidden {
    display: none;
  }

  button {
    font: inherit;
    padding: 8px 10px;
    justify-self: start;
  }
</style>

<script lang="ts">
  import type { RendererProfile } from '../../shared/profile'
  import type { WorkspaceTab } from '../../shared/profile-workspace-ui'
  import {
    SESSION_STATE_LABEL,
    sessionIndicator,
    type ProfileSessionUi
  } from '../../shared/ssh-session-ui'
  import type { TranscriptEntry } from '../../shared/terminal-transcript'
  import type { TerminalRegistry } from './terminal-registry'
  import ProfileTerminalHost from './ProfileTerminalHost.svelte'

  let {
    profile,
    tab,
    session,
    transcript,
    terminalIds,
    registry,
    onTab,
    onConnect,
    onDisconnect,
    onClearTerminal
  }: {
    profile: RendererProfile
    tab: WorkspaceTab
    session: ProfileSessionUi
    transcript: TranscriptEntry[]
    terminalIds: string[]
    registry: TerminalRegistry
    onTab: (tab: WorkspaceTab) => void
    onConnect: () => void
    onDisconnect: () => void
    onClearTerminal: () => void
  } = $props()

  const authSummary = $derived(
    profile.auth.method === 'password' ? 'Password' : `Private-key file (${profile.auth.label})`
  )
  const indicator = $derived(sessionIndicator(session.state))
  const idle = $derived(session.state === 'no-active-session')
  const showTerminalEmpty = $derived(idle && transcript.length === 0)
  const canConnect = $derived(idle && session.secretPrompt === null)
  const canDisconnect = $derived(session.state === 'connected')
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
    <h1>{profile.label}</h1>
    <article class="card">
      <h2>Session</h2>
      <p class="status">
        <span class="indicator {indicator}" aria-hidden="true"></span>
        <span>{SESSION_STATE_LABEL[session.state]}</span>
      </p>
      {#if session.error !== null}
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
      {#if canDisconnect}
        <button type="button" onclick={onDisconnect}>Disconnect</button>
      {/if}
    </article>
  </div>

  <div class="terminal-pane" class:hidden={tab !== 'terminal'}>
    {#if showTerminalEmpty}
      <div class="empty">
        <p>Connect to open an SSH Session for this Connection Profile.</p>
        <button type="button" onclick={onConnect}>Connect</button>
      </div>
    {:else}
      <div class="toolbar">
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

  .error {
    color: #b00020;
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

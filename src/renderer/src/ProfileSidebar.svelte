<script lang="ts">
  import type { RendererProfile } from '../../shared/profile'
  import { COPY_MCP_CONFIG_LABEL } from '../../shared/mcp-config'
  import {
    SESSION_STATE_LABEL,
    activeSessionCount,
    emptyProfileSession,
    sessionIndicator,
    type ProfileSessionUi
  } from '../../shared/ssh-session-ui'
  import SessionStateMark from './SessionStateMark.svelte'

  let {
    profiles,
    selectedProfileId,
    creating,
    sessions,
    collapsed,
    searchQuery = $bindable(''),
    onCreate,
    onSelect,
    onDisconnectAll,
    onToggleCollapsed,
    onCopyMcpConfig
  }: {
    profiles: RendererProfile[]
    selectedProfileId: string | null
    creating: boolean
    sessions: Record<string, ProfileSessionUi>
    collapsed: boolean
    searchQuery: string
    onCreate: () => void
    onSelect: (profileId: string) => void
    onDisconnectAll: () => void
    onToggleCollapsed: () => void
    onCopyMcpConfig: () => void
  } = $props()

  let searchInput = $state<HTMLInputElement | undefined>()

  function view(profileId: string): ProfileSessionUi {
    return sessions[profileId] ?? emptyProfileSession()
  }

  const liveCount = $derived(activeSessionCount(sessions))

  export function focusSearch(): void {
    searchInput?.focus()
    searchInput?.select()
  }
</script>

{#if collapsed}
  <button type="button" class="reveal" onclick={onToggleCollapsed} aria-expanded="false">
    Show sidebar
  </button>
{:else}
  <aside class="sidebar" id="profile-sidebar">
    <div class="brand">
      <div>
        <p class="name">Picaglass</p>
        <p class="hint">Connection Profiles</p>
      </div>
      <button type="button" class="collapse" onclick={onToggleCollapsed} aria-expanded="true">
        Hide sidebar
      </button>
    </div>

    <div class="search" role="search">
      <label>
        <span class="visually-hidden">Search Connection Profiles</span>
        <input
          bind:this={searchInput}
          bind:value={searchQuery}
          type="search"
          name="profile-search"
          placeholder="Search by label, username, or destination"
        />
      </label>
    </div>

    {#if profiles.length === 0}
      <p class="empty-list">
        {searchQuery.trim().length === 0 ? 'No saved profiles yet.' : 'No matching profiles.'}
      </p>
    {:else}
      <ul>
        {#each profiles as profile (profile.id)}
          {@const session = view(profile.id)}
          {@const indicator = sessionIndicator(session.state)}
          <li>
            <button
              type="button"
              class:selected={profile.id === selectedProfileId && !creating}
              aria-current={profile.id === selectedProfileId && !creating ? 'true' : undefined}
              onclick={() => onSelect(profile.id)}
            >
              <svg class="glyph" viewBox="0 0 16 16" aria-hidden="true">
                <rect
                  x="2.5"
                  y="3"
                  width="11"
                  height="8"
                  rx="1.2"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.25"
                />
                <path
                  d="M5 13h6"
                  stroke="currentColor"
                  stroke-width="1.25"
                  stroke-linecap="round"
                />
              </svg>
              <span class="copy">
                <span class="label">{profile.label}</span>
                <span class="state">
                  <SessionStateMark {indicator} label={SESSION_STATE_LABEL[session.state]} />
                </span>
              </span>
              {#if session.unseenFailure}
                <span class="failure-badge">
                  <svg class="badge-icon" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M6 1.5 11 10.5H1Z" fill="currentColor" />
                  </svg>
                  <span>Failed</span>
                </span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="menu">
      <button type="button" class="create" class:selected={creating} onclick={onCreate}>
        Create Connection Profile
      </button>
      <button type="button" disabled={liveCount === 0} onclick={onDisconnectAll}>
        Disconnect All
      </button>
      <button type="button" onclick={onCopyMcpConfig}>{COPY_MCP_CONFIG_LABEL}</button>
    </div>
  </aside>
{/if}

<style>
  .sidebar {
    display: grid;
    align-content: start;
    gap: 16px;
    padding: 20px 16px;
    border-right: 1px solid var(--border);
    overflow: auto;
    min-width: 18rem;
    background: var(--bg);
  }

  .brand {
    display: flex;
    gap: 8px;
    align-items: start;
    justify-content: space-between;
  }

  .name {
    font-size: 1.1rem;
    font-weight: 600;
  }

  .hint,
  .empty-list,
  .state {
    color: var(--muted);
    font-size: 0.875rem;
  }

  .collapse,
  .reveal {
    font: inherit;
    padding: 6px 8px;
    border: 1px solid var(--border);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .reveal {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    padding: 12px 8px;
    border: none;
    border-right: 1px solid var(--border);
    background: var(--bg);
    cursor: pointer;
  }

  .search input {
    font: inherit;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: inherit;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 4px;
  }

  button {
    font: inherit;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  li button {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 8px;
    align-items: start;
  }

  .glyph {
    width: 1rem;
    height: 1rem;
    margin-top: 0.2rem;
    color: var(--fg);
  }

  .copy {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .failure-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--status-danger);
    font-size: 0.75rem;
    margin-top: 0.2rem;
  }

  .badge-icon {
    width: 0.7rem;
    height: 0.7rem;
  }

  button.selected,
  button:focus-visible {
    border-color: var(--fg);
    background: var(--hover);
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .create {
    border-color: var(--fg);
  }

  .menu {
    display: grid;
    gap: 8px;
  }
</style>

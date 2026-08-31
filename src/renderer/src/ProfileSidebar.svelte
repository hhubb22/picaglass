<script lang="ts">
  import type { RendererProfile } from '../../shared/profile'
  import {
    SESSION_STATE_LABEL,
    emptyProfileSession,
    sessionIndicator,
    type ProfileSessionUi
  } from '../../shared/ssh-session-ui'

  let {
    profiles,
    selectedProfileId,
    creating,
    sessions,
    onCreate,
    onSelect
  }: {
    profiles: RendererProfile[]
    selectedProfileId: string | null
    creating: boolean
    sessions: Record<string, ProfileSessionUi>
    onCreate: () => void
    onSelect: (profileId: string) => void
  } = $props()

  function view(profileId: string): ProfileSessionUi {
    return sessions[profileId] ?? emptyProfileSession()
  }
</script>

<aside class="sidebar">
  <div class="brand">
    <p class="name">Picaglass</p>
    <p class="hint">Connection Profiles</p>
  </div>

  {#if profiles.length === 0}
    <p class="empty-list">No saved profiles yet.</p>
  {:else}
    <ul>
      {#each profiles as profile (profile.id)}
        {@const session = view(profile.id)}
        {@const indicator = sessionIndicator(session.state)}
        <li>
          <button
            type="button"
            class:selected={profile.id === selectedProfileId && !creating}
            onclick={() => onSelect(profile.id)}
          >
            <span class="indicator {indicator}" aria-hidden="true"></span>
            <span class="copy">
              <span class="label">{profile.label}</span>
              <span class="state">{SESSION_STATE_LABEL[session.state]}</span>
            </span>
            {#if session.unseenFailure}
              <span class="failure-badge" aria-label="Failed">
                <span class="badge-icon" aria-hidden="true"></span>
                <span>Failed</span>
              </span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <button type="button" class="create" class:selected={creating} onclick={onCreate}>
    Create Connection Profile
  </button>
</aside>

<style>
  .sidebar {
    display: grid;
    align-content: start;
    gap: 16px;
    padding: 20px 16px;
    border-right: 1px solid #d0d0d0;
    overflow: auto;
  }

  .name {
    font-size: 1.1rem;
    font-weight: 600;
  }

  .hint,
  .empty-list,
  .state {
    color: #555;
    font-size: 0.875rem;
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
    cursor: pointer;
  }

  li button {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 8px;
    align-items: start;
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

  .indicator {
    width: 0.55rem;
    height: 0.55rem;
    margin-top: 0.4rem;
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

  .failure-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #b00020;
    font-size: 0.75rem;
    margin-top: 0.2rem;
  }

  .badge-icon {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: #b00020;
  }

  button.selected,
  button:focus-visible {
    border-color: #111;
    background: #f3f3f3;
  }

  .create {
    border-color: #111;
  }
</style>

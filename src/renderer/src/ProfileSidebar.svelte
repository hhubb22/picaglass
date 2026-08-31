<script lang="ts">
  import type { RendererProfile } from '../../shared/profile'

  let {
    profiles,
    selectedProfileId,
    creating,
    onCreate,
    onSelect
  }: {
    profiles: RendererProfile[]
    selectedProfileId: string | null
    creating: boolean
    onCreate: () => void
    onSelect: (profileId: string) => void
  } = $props()
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
        <li>
          <button
            type="button"
            class:selected={profile.id === selectedProfileId && !creating}
            onclick={() => onSelect(profile.id)}
          >
            {profile.label}
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
  .empty-list {
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

  button.selected,
  button:focus-visible {
    border-color: #111;
    background: #f3f3f3;
  }

  .create {
    border-color: #111;
  }
</style>

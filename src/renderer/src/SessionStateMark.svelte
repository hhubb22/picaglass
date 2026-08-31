<script lang="ts">
  import type { SessionIndicator } from '../../shared/ssh-session-ui'

  let { indicator, label }: { indicator: SessionIndicator; label: string } = $props()
</script>

<span class="mark">
  <svg class="icon {indicator}" viewBox="0 0 12 12" aria-hidden="true">
    {#if indicator === 'idle'}
      <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="1.5" />
    {:else if indicator === 'pending'}
      <rect
        x="2.2"
        y="2.2"
        width="7.6"
        height="7.6"
        transform="rotate(45 6 6)"
        fill="currentColor"
      />
    {:else if indicator === 'attention'}
      <path d="M6 1.5 11 10.5H1Z" fill="currentColor" />
    {:else if indicator === 'live'}
      <circle cx="6" cy="6" r="4" fill="currentColor" />
    {:else}
      <path
        d="M2 6a4 4 0 0 1 8 0"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    {/if}
  </svg>
  <span>{label}</span>
</span>

<style>
  .mark {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }

  .icon {
    width: 0.75rem;
    height: 0.75rem;
    flex: none;
    color: var(--status-idle);
  }

  .icon.pending,
  .icon.attention {
    color: var(--status-pending);
  }

  .icon.live {
    color: var(--status-live);
  }
</style>

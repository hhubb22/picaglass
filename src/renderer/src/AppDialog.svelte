<script lang="ts">
  import { onMount } from 'svelte'
  import type { Snippet } from 'svelte'
  import { bindDialogFocus } from './dialog-focus'

  let {
    title,
    confirmLabel,
    extraLabel,
    onConfirm,
    onExtra,
    onCancel,
    children
  }: {
    title: string
    confirmLabel: string
    extraLabel?: string
    onConfirm: () => void
    onExtra?: () => void
    onCancel: () => void
    children: Snippet
  } = $props()

  let dialog = $state<HTMLDivElement | undefined>()

  onMount(() => {
    const root = dialog
    if (root === undefined) {
      return
    }
    return bindDialogFocus(root, onCancel)
  })
</script>

<div class="overlay" role="presentation">
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="dialog-title"
    bind:this={dialog}
  >
    <p id="dialog-title">{title}</p>
    {@render children()}
    <div class="actions">
      {#if extraLabel !== undefined && onExtra !== undefined}
        <button type="button" onclick={onExtra}>{extraLabel}</button>
      {/if}
      <button type="button" onclick={onConfirm}>{confirmLabel}</button>
      <button type="button" onclick={onCancel}>Cancel</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    display: grid;
    place-items: center;
    padding: 24px;
    z-index: 2;
  }

  .dialog {
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--fg);
    box-shadow: var(--shadow);
    padding: 20px;
    display: grid;
    gap: 12px;
    max-width: 28rem;
    width: 100%;
  }

  #dialog-title,
  p {
    font-weight: 600;
  }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: end;
  }

  button {
    font: inherit;
    padding: 8px 10px;
    color: inherit;
    background: var(--bg);
    border: 1px solid var(--border);
    cursor: pointer;
  }
</style>

<script lang="ts">
  import type { Snippet } from 'svelte'

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
</script>

<div class="overlay" role="presentation">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
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
    background: rgb(0 0 0 / 35%);
    display: grid;
    place-items: center;
    padding: 24px;
  }

  .dialog {
    background: #fff;
    border: 1px solid #111;
    box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
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
  }
</style>

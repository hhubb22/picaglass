<script lang="ts">
  import { onMount } from 'svelte'
  import type { Snippet } from 'svelte'
  import { bindDialogFocus } from './dialog-focus'

  let {
    title,
    confirmLabel,
    extraLabel,
    tone = 'primary',
    onConfirm,
    onExtra,
    onCancel,
    children
  }: {
    title: string
    confirmLabel: string
    extraLabel?: string
    /** 规格 §4.3：主行动的按钮层级（primary 或 danger） */
    tone?: 'primary' | 'danger'
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
      <button type="button" data-kind={tone} onclick={onConfirm}>{confirmLabel}</button>
      <button type="button" data-kind="quiet" onclick={onCancel}>Cancel</button>
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

  /* 规格 §4.3 对话框：白卡 r8 + 细边 + 软阴影 */
  .dialog {
    background: var(--bg-surface);
    color: var(--text-base);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-dialog);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
    max-width: 28rem;
    width: 100%;
  }

  #dialog-title {
    font-size: var(--font-md);
    font-weight: 600;
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    justify-content: end;
  }
</style>

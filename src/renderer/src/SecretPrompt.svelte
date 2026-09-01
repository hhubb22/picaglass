<script lang="ts">
  import { onMount } from 'svelte'
  import { bindDialogFocus } from './dialog-focus'

  let {
    title,
    confirmLabel,
    message,
    busy = false,
    onConfirm,
    onCancel
  }: {
    title: string
    confirmLabel: string
    message: string | null
    busy?: boolean
    onConfirm: (secret: string) => void
    onCancel: () => void
  } = $props()

  let secret = $state('')
  let dialog = $state<HTMLDivElement | undefined>()

  function submit(): void {
    const value = secret
    secret = ''
    onConfirm(value)
  }

  onMount(() => {
    const root = dialog
    if (root === undefined) {
      return
    }
    return bindDialogFocus(root, onCancel, 'first')
  })
</script>

<div class="overlay" role="presentation">
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="secret-title"
    bind:this={dialog}
  >
    <form
      onsubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <p id="secret-title">{title}</p>
      {#if message !== null}
        <p class="error" role="alert">{message}</p>
      {/if}
      <label>
        Authentication Secret
        <input bind:value={secret} type="password" autocomplete="off" disabled={busy} />
      </label>
      <div class="actions">
        <button type="submit" data-kind="primary" disabled={busy}>{confirmLabel}</button>
        <button type="button" data-kind="quiet" disabled={busy} onclick={onCancel}>Cancel</button>
      </div>
    </form>
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

  form {
    display: grid;
    gap: 12px;
  }

  #secret-title {
    font-size: var(--font-md);
    font-weight: 600;
  }

  label {
    display: grid;
    gap: var(--space-1);
  }


  .error {
    color: var(--status-danger);
  }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: end;
  }
</style>

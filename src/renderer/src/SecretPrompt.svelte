<script lang="ts">
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

  function submit(): void {
    const value = secret
    secret = ''
    onConfirm(value)
  }
</script>

<div class="overlay" role="presentation">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="secret-title">
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
        <button type="submit" disabled={busy}>{confirmLabel}</button>
        <button type="button" disabled={busy} onclick={onCancel}>Cancel</button>
      </div>
    </form>
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
    z-index: 2;
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

  form {
    display: grid;
    gap: 12px;
  }

  #secret-title {
    font-weight: 600;
  }

  label {
    display: grid;
    gap: 4px;
    font-size: 0.875rem;
  }

  input,
  button {
    font: inherit;
    padding: 8px 10px;
  }

  .error {
    color: #b00020;
  }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: end;
  }
</style>

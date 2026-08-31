<script lang="ts">
  import type { ProfileDraftForm, ProfileFieldErrors } from '../../shared/profile'

  let {
    draft = $bindable(),
    keyLabel,
    fields,
    busy,
    onPickKey,
    onSave,
    onCancel
  }: {
    draft: ProfileDraftForm
    keyLabel: string | null
    fields: ProfileFieldErrors
    busy: boolean
    onPickKey: () => void
    onSave: () => void
    onCancel: () => void
  } = $props()
</script>

<form
  class="form"
  onsubmit={(event) => {
    event.preventDefault()
    onSave()
  }}
>
  <h1>Create Connection Profile</h1>

  <label>
    Display name
    <input bind:value={draft.displayName} name="displayName" autocomplete="off" disabled={busy} />
    <span class="hint">Optional. Used as the Profile Label when set.</span>
  </label>

  <label>
    Host
    <input bind:value={draft.host} name="host" autocomplete="off" disabled={busy} />
    {#if fields.host}
      <span class="error">{fields.host}</span>
    {/if}
  </label>

  <label>
    Port
    <input
      bind:value={draft.port}
      name="port"
      inputmode="numeric"
      placeholder="22"
      disabled={busy}
    />
    {#if fields.port}
      <span class="error">{fields.port}</span>
    {/if}
  </label>

  <label>
    Username
    <input bind:value={draft.username} name="username" autocomplete="username" disabled={busy} />
    {#if fields.username}
      <span class="error">{fields.username}</span>
    {/if}
  </label>

  <fieldset>
    <legend>Authentication Method</legend>
    <label class="choice">
      <input
        type="radio"
        name="authMethod"
        checked={draft.authMethod === 'password'}
        disabled={busy}
        onchange={() => {
          draft.authMethod = 'password'
        }}
      />
      Password
    </label>
    <label class="choice">
      <input
        type="radio"
        name="authMethod"
        checked={draft.authMethod === 'privateKey'}
        disabled={busy}
        onchange={() => {
          draft.authMethod = 'privateKey'
        }}
      />
      Private-key file
    </label>
    {#if draft.authMethod === 'privateKey'}
      <div class="key-row">
        <span class="key-label">{keyLabel === null ? 'No file chosen' : keyLabel}</span>
        <button type="button" onclick={onPickKey} disabled={busy}>Choose private-key file</button>
      </div>
    {/if}
    {#if fields.auth}
      <span class="error">{fields.auth}</span>
    {/if}
  </fieldset>

  <label class="choice">
    <input type="checkbox" bind:checked={draft.automaticDiscovery} disabled={busy} />
    Automatic discovery
  </label>
  <p class="hint">
    When enabled, Picaglass runs a fixed command after a successful connection to collect hostname,
    kernel name, kernel release, and architecture.
  </p>

  <div class="actions">
    <button type="submit" disabled={busy}>Save</button>
    <button type="button" onclick={onCancel} disabled={busy}>Cancel</button>
  </div>
</form>

<style>
  .form {
    display: grid;
    gap: 14px;
    max-width: 32rem;
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 600;
  }

  label,
  fieldset {
    display: grid;
    gap: 6px;
    font-size: 0.875rem;
  }

  fieldset {
    border: 1px solid #d0d0d0;
    padding: 12px;
  }

  input,
  button {
    font: inherit;
    padding: 8px 10px;
  }

  .choice {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .choice input {
    width: auto;
    padding: 0;
  }

  .key-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: center;
  }

  .key-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint {
    color: #555;
    font-size: 0.8rem;
  }

  .error {
    color: #b00020;
  }

  .actions {
    display: flex;
    gap: 8px;
  }
</style>

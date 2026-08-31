<script lang="ts">
  import type { ProfileDraftForm, ProfileFieldErrors } from '../../shared/profile'
  import { MACHINE_SNAPSHOT_COMMAND } from '../../shared/machine-snapshot'

  let {
    draft = $bindable(),
    title = 'Create Connection Profile',
    keyLabel,
    fields,
    busy,
    connectionLocked = false,
    onPickKey,
    onSave,
    onCancel
  }: {
    draft: ProfileDraftForm
    title?: string
    keyLabel: string | null
    fields: ProfileFieldErrors
    busy: boolean
    connectionLocked?: boolean
    onPickKey: () => void
    onSave: () => void
    onCancel: () => void
  } = $props()

  const connectionDisabled = $derived(busy || connectionLocked)
</script>

<form
  class="form"
  onsubmit={(event) => {
    event.preventDefault()
    onSave()
  }}
>
  <h1>{title}</h1>
  {#if connectionLocked}
    <p class="hint">
      Host, port, username, and Authentication Method are locked while this profile has a pending or
      live SSH Session. Display name and discovery stay editable.
    </p>
  {/if}

  <label>
    Display name
    <input bind:value={draft.displayName} name="displayName" autocomplete="off" disabled={busy} />
    <span class="hint">Optional. Used as the Profile Label when set.</span>
  </label>

  <label>
    Host
    <input bind:value={draft.host} name="host" autocomplete="off" disabled={connectionDisabled} />
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
      disabled={connectionDisabled}
    />
    {#if fields.port}
      <span class="error">{fields.port}</span>
    {/if}
  </label>

  <label>
    Username
    <input
      bind:value={draft.username}
      name="username"
      autocomplete="username"
      disabled={connectionDisabled}
    />
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
        disabled={connectionDisabled}
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
        disabled={connectionDisabled}
        onchange={() => {
          draft.authMethod = 'privateKey'
        }}
      />
      Private-key file
    </label>
    {#if draft.authMethod === 'privateKey'}
      <div class="key-row">
        <span class="key-label">{keyLabel === null ? 'No file chosen' : keyLabel}</span>
        <button type="button" onclick={onPickKey} disabled={connectionDisabled}>
          Choose private-key file
        </button>
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
  <details class="disclosure">
    <summary>What automatic discovery runs</summary>
    <p class="hint">
      When enabled, Picaglass runs a remote command automatically after each successful connection.
      It collects hostname, kernel name, kernel release, and architecture. The command is fixed and
      does not include any Connection Profile or user text.
    </p>
    <pre class="command">{MACHINE_SNAPSHOT_COMMAND}</pre>
  </details>

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
    padding: 24px;
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
    border: 1px solid var(--border);
    padding: 12px;
  }

  input,
  button {
    font: inherit;
    padding: 8px 10px;
    color: inherit;
    background: var(--bg);
    border: 1px solid var(--border);
  }

  button {
    cursor: pointer;
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
    color: var(--muted);
    font-size: 0.8rem;
  }

  .disclosure {
    display: grid;
    gap: 8px;
    font-size: 0.875rem;
  }

  .command {
    margin: 0;
    padding: 8px 10px;
    border: 1px solid var(--border);
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
  }

  .error {
    color: var(--status-danger);
  }

  .actions {
    display: flex;
    gap: 8px;
  }
</style>

<script lang="ts">
  let host = $state('')
  let port = $state('')
  let username = $state('')
  let password = $state('')
  let passphrase = $state('')
  let key = $state<{ keyRef: string; label: string } | null>(null)
  let busy = $state(false)
  let error = $state<string | null>(null)
  let pending = $state<{
    sessionId: string
    fingerprint: string
    algorithm: string
  } | null>(null)

  async function pickKey(): Promise<void> {
    error = null
    key = await window.api.ssh.pickPrivateKey()
  }

  function connectAuth(
    picked: { keyRef: string } | null,
    passwordValue: string,
    passphraseValue: string
  ):
    | { method: 'password'; password: string }
    | { method: 'privateKey'; keyRef: string; passphrase?: string } {
    if (picked === null) {
      return { method: 'password', password: passwordValue }
    }
    if (passphraseValue.length > 0) {
      return { method: 'privateKey', keyRef: picked.keyRef, passphrase: passphraseValue }
    }
    return { method: 'privateKey', keyRef: picked.keyRef }
  }

  async function connect(): Promise<void> {
    busy = true
    error = null
    pending = null
    const result = await window.api.ssh.connect({
      host,
      port: port.trim() === '' ? undefined : Number(port),
      username,
      auth: connectAuth(key, password, passphrase),
      cols: 80,
      rows: 24
    })
    password = ''
    busy = false
    if (result.ok) {
      return
    }
    if (result.reason === 'host-unknown') {
      pending = {
        sessionId: result.sessionId,
        fingerprint: result.fingerprint,
        algorithm: result.algorithm
      }
      return
    }
    error = 'message' in result ? result.message : result.reason
  }

  async function abort(): Promise<void> {
    if (pending === null) {
      return
    }
    busy = true
    await window.api.ssh.confirmHostKey(pending.sessionId, 'abort')
    pending = null
    busy = false
  }
</script>

<main>
  <form
    onsubmit={(event) => {
      event.preventDefault()
      void connect()
    }}
  >
    <h1>连接</h1>

    <label>
      主机
      <input
        bind:value={host}
        name="host"
        autocomplete="off"
        required
        disabled={busy || pending !== null}
      />
    </label>

    <label>
      端口
      <input
        bind:value={port}
        name="port"
        inputmode="numeric"
        placeholder="22"
        disabled={busy || pending !== null}
      />
    </label>

    <label>
      用户名
      <input
        bind:value={username}
        name="username"
        autocomplete="username"
        required
        disabled={busy || pending !== null}
      />
    </label>

    <label>
      密码
      <input
        bind:value={password}
        name="password"
        type="password"
        autocomplete="current-password"
        disabled={busy || pending !== null}
      />
    </label>

    <div class="key-row">
      <span>私钥</span>
      <span class="key-label">{key === null ? '未选择' : key.label}</span>
      <button type="button" onclick={() => void pickKey()} disabled={busy || pending !== null}
        >选择私钥</button
      >
    </div>

    <label>
      密钥口令
      <input
        bind:value={passphrase}
        name="passphrase"
        type="password"
        autocomplete="off"
        disabled={busy || pending !== null || key === null}
      />
    </label>

    <button type="submit" disabled={busy || pending !== null}>连接</button>
  </form>

  {#if pending}
    <section class="host-key">
      <h2>未知主机</h2>
      <p>指纹</p>
      <p class="fingerprint">{pending.fingerprint}</p>
      <p>算法 {pending.algorithm}</p>
      <button type="button" onclick={() => void abort()} disabled={busy}>中止</button>
    </section>
  {/if}

  {#if error}
    <p class="error">{error}</p>
  {/if}
</main>

<style>
  main {
    min-height: 100%;
    padding: 24px;
  }

  form,
  .host-key {
    display: grid;
    gap: 12px;
    max-width: 28rem;
  }

  h1,
  h2 {
    font-size: 1.25rem;
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

  .key-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 8px;
    align-items: center;
    font-size: 0.875rem;
  }

  .key-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fingerprint {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    word-break: break-all;
  }

  .host-key {
    margin-top: 24px;
  }

  .error {
    margin-top: 16px;
    color: #b00020;
  }
</style>

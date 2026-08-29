<script lang="ts">
  import { onMount } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import '@xterm/xterm/css/xterm.css'

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
  let sessionId = $state<string | null>(null)
  let termEl: HTMLDivElement | undefined = $state()

  const encoder = new TextEncoder()
  let terminal: Terminal | undefined
  let fitAddon: FitAddon | undefined

  function formLocked(): boolean {
    return busy || pending !== null
  }

  function queueFit(): void {
    requestAnimationFrame(() => {
      fitAddon?.fit()
      if (sessionId !== null && terminal !== undefined) {
        window.api.ssh.resize(sessionId, terminal.cols, terminal.rows)
      }
    })
  }

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
      cols: terminal?.cols ?? 80,
      rows: terminal?.rows ?? 24
    })
    password = ''
    busy = false
    if (result.ok) {
      sessionId = result.sessionId
      queueFit()
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

  async function trust(): Promise<void> {
    if (pending === null) {
      return
    }
    busy = true
    error = null
    const result = await window.api.ssh.confirmHostKey(pending.sessionId, 'trust-always')
    pending = null
    busy = false
    if (result.ok) {
      sessionId = result.sessionId
      queueFit()
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

  async function disconnect(): Promise<void> {
    if (sessionId === null) {
      return
    }
    busy = true
    await window.api.ssh.disconnect(sessionId)
    sessionId = null
    busy = false
  }

  onMount(() => {
    const hostEl = termEl
    if (hostEl === undefined) {
      return
    }
    const term = new Terminal({ cursorBlink: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    terminal = term
    fitAddon = fit
    term.open(hostEl)
    queueFit()

    const dataInput = term.onData((data) => {
      if (sessionId === null) {
        return
      }
      window.api.ssh.write(sessionId, encoder.encode(data))
    })
    const stopData = window.api.ssh.onData((id, chunk) => {
      if (id !== sessionId) {
        return
      }
      term.write(chunk)
    })
    const stopStatus = window.api.ssh.onStatus((event) => {
      if (event.sessionId !== sessionId) {
        return
      }
      if (event.type === 'closed' || event.type === 'error') {
        sessionId = null
        if (event.type === 'error') {
          error = event.message ?? event.type
        }
      }
    })
    const observer = new ResizeObserver(() => {
      queueFit()
    })
    observer.observe(hostEl)

    return () => {
      dataInput.dispose()
      stopData()
      stopStatus()
      observer.disconnect()
      term.dispose()
      terminal = undefined
      fitAddon = undefined
    }
  })
</script>

<main>
  <section class="side">
    <form
      onsubmit={(event) => {
        event.preventDefault()
        void connect()
      }}
    >
      <h1>连接</h1>

      <label>
        主机
        <input bind:value={host} name="host" autocomplete="off" required disabled={formLocked()} />
      </label>

      <label>
        端口
        <input
          bind:value={port}
          name="port"
          inputmode="numeric"
          placeholder="22"
          disabled={formLocked()}
        />
      </label>

      <label>
        用户名
        <input
          bind:value={username}
          name="username"
          autocomplete="username"
          required
          disabled={formLocked()}
        />
      </label>

      <label>
        密码
        <input
          bind:value={password}
          name="password"
          type="password"
          autocomplete="current-password"
          disabled={formLocked()}
        />
      </label>

      <div class="key-row">
        <span>私钥</span>
        <span class="key-label">{key === null ? '未选择' : key.label}</span>
        <button type="button" onclick={() => void pickKey()} disabled={formLocked()}
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
          disabled={formLocked() || key === null}
        />
      </label>

      <button type="submit" disabled={formLocked()}>连接</button>
      {#if sessionId !== null}
        <button type="button" onclick={() => void disconnect()} disabled={busy}>断开</button>
      {/if}
    </form>

    {#if pending}
      <section class="host-key">
        <h2>未知主机</h2>
        <p>指纹</p>
        <p class="fingerprint">{pending.fingerprint}</p>
        <p>算法 {pending.algorithm}</p>
        <div class="host-actions">
          <button type="button" onclick={() => void trust()} disabled={busy}>信任</button>
          <button type="button" onclick={() => void abort()} disabled={busy}>中止</button>
        </div>
      </section>
    {/if}

    {#if error}
      <p class="error">{error}</p>
    {/if}
  </section>

  <section class="term-wrap">
    <div class="terminal" bind:this={termEl}></div>
  </section>
</main>

<style>
  main {
    display: grid;
    grid-template-columns: 20rem minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }

  .side {
    display: grid;
    align-content: start;
    gap: 16px;
    padding: 24px;
    overflow: auto;
  }

  form,
  .host-key {
    display: grid;
    gap: 12px;
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

  .host-actions {
    display: flex;
    gap: 8px;
  }

  .error {
    color: #b00020;
  }

  .term-wrap {
    min-width: 0;
    min-height: 0;
    height: 100%;
    background: #111;
  }

  .terminal {
    height: 100%;
    width: 100%;
    padding: 8px;
  }
</style>

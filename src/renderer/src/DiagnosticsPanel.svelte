<script lang="ts">
  import type { DeviceFactsRun } from '../../shared/picos/device-facts'
  import {
    diagnosticBlockTabs,
    deviceFactsPanelView,
    type DiagnosticBlockId
  } from '../../shared/picos/diagnostics-panel'
  import type { ProfileSessionUi } from '../../shared/ssh-session-ui'

  let {
    profileId,
    session
  }: {
    profileId: string
    session: ProfileSessionUi
  } = $props()

  const tabs = diagnosticBlockTabs()
  let collapsed = $state(false)
  let selectedBlock = $state<DiagnosticBlockId>('device-facts')
  let showRaw = $state(false)
  let loading = $state(false)
  let run = $state<DeviceFactsRun | null>(null)
  let loadedSessionId = $state<string | null>(null)
  let request = 0

  const connected = $derived(session.state === 'connected' && session.sessionId !== null)
  const view = $derived(run === null ? null : deviceFactsPanelView(run))

  async function loadDeviceFacts(sessionId: string): Promise<void> {
    const seq = ++request
    loading = true
    try {
      const next = await window.api.diagnostics.runDeviceFacts(profileId)
      if (seq !== request) {
        return
      }
      run = next
      loadedSessionId = sessionId
    } finally {
      if (seq === request) {
        loading = false
      }
    }
  }

  $effect(() => {
    const sessionId = session.sessionId
    const state = session.state
    if (state !== 'connected' || sessionId === null) {
      if (loading) {
        request += 1
        loading = false
      }
      loadedSessionId = null
      run = null
      return
    }
    if (collapsed || selectedBlock !== 'device-facts') {
      return
    }
    if (loadedSessionId === sessionId || loading) {
      return
    }
    run = null
    void loadDeviceFacts(sessionId)
  })

  function refresh(): void {
    if (session.sessionId === null || session.state !== 'connected') {
      return
    }
    loadedSessionId = null
    void loadDeviceFacts(session.sessionId)
  }

  function selectBlock(id: DiagnosticBlockId): void {
    selectedBlock = id
    showRaw = false
  }
</script>

<section class="panel" class:collapsed>
  <div class="bar">
    {#if collapsed}
      <button type="button" class="toggle" onclick={() => (collapsed = false)}>诊断</button>
    {:else}
      <div class="tabs" role="tablist" aria-label="诊断块">
        {#each tabs as tab (tab.id)}
          <button
            type="button"
            role="tab"
            aria-selected={selectedBlock === tab.id}
            class:selected={selectedBlock === tab.id}
            onclick={() => selectBlock(tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </div>
      <button type="button" class="toggle" onclick={() => (collapsed = true)}>收起</button>
    {/if}
  </div>

  {#if !collapsed}
    <div class="body">
      {#if !connected}
        <p role="status">请先连接</p>
      {:else if selectedBlock === 'device-facts' && (view === null || view.status === 'need-session')}
        <p>{view === null ? 'Loading…' : view.message}</p>
      {:else if selectedBlock === 'device-facts' && view !== null && view.status === 'channel-failed'}
        <div class="notice channel" role="alert">
          <p>{view.message}</p>
          {#if view.stderrHead.length > 0}
            <pre>{view.stderrHead}</pre>
          {/if}
        </div>
        <button type="button" onclick={refresh}>Refresh</button>
      {:else if selectedBlock === 'device-facts' && view !== null && view.status === 'ready'}
        <div class="toolbar">
          <button type="button" onclick={refresh} disabled={loading}>Refresh</button>
          <button type="button" aria-pressed={showRaw} onclick={() => (showRaw = !showRaw)}>
            {view.viewRawLabel}
          </button>
        </div>
        {#if view.parseFailed}
          <div class="notice parse" role="status">
            <p>{view.parseFailedNotice}</p>
          </div>
        {/if}
        {#if showRaw || view.parseFailed}
          <pre class="raw">{view.raw}</pre>
        {/if}
        {#if !showRaw}
          {#if view.versionFailure}
            <div class="notice parse" role="status">
              <p>{view.versionFailure.reason}</p>
              <pre class="raw">{view.versionFailure.raw}</pre>
            </div>
          {:else}
            <dl>
              {#if view.model}
                <div>
                  <dt>Model</dt>
                  <dd>{view.model}</dd>
                </div>
              {/if}
              {#if view.softwareVersion}
                <div>
                  <dt>Software Version</dt>
                  <dd>{view.softwareVersion}</dd>
                </div>
              {/if}
              {#if view.serialNumber}
                <div>
                  <dt>Serial Number</dt>
                  <dd>{view.serialNumber}</dd>
                </div>
              {/if}
              {#if view.licenseType}
                <div>
                  <dt>License Type</dt>
                  <dd>{view.licenseType}</dd>
                </div>
              {/if}
              {#if view.systemUptime}
                <div>
                  <dt>System Uptime</dt>
                  <dd>{view.systemUptime}</dd>
                </div>
              {/if}
              {#if view.hardwareId}
                <div>
                  <dt>Hardware ID</dt>
                  <dd>{view.hardwareId}</dd>
                </div>
              {/if}
              {#if view.deviceMacAddress}
                <div>
                  <dt>Device MAC Address</dt>
                  <dd>{view.deviceMacAddress}</dd>
                </div>
              {/if}
            </dl>
          {/if}

          <h3>Fans</h3>
          {#if view.fansFailure}
            <div class="notice parse" role="status">
              <p>{view.fansFailure.reason}</p>
              <pre class="raw">{view.fansFailure.raw}</pre>
            </div>
          {:else if view.fans !== null && view.fans.length === 0}
            <p class="muted">No fan rows.</p>
          {:else if view.fans !== null}
            <table>
              <thead>
                <tr>
                  <th>Fan</th>
                  <th>Speed</th>
                  <th>PWM</th>
                  <th>Direction</th>
                </tr>
              </thead>
              <tbody>
                {#each view.fans as fan (fan.id)}
                  <tr>
                    <td>{fan.id}</td>
                    <td>{fan.speed ?? '—'}</td>
                    <td>{fan.pwm ?? '—'}</td>
                    <td>{fan.direction ?? '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}

          <h3>Temperature</h3>
          {#if view.temperaturesFailure}
            <div class="notice parse" role="status">
              <p>{view.temperaturesFailure.reason}</p>
              <pre class="raw">{view.temperaturesFailure.raw}</pre>
            </div>
          {:else if view.temperatures !== null && view.temperatures.length === 0}
            <p class="muted">No temperature rows.</p>
          {:else if view.temperatures !== null}
            <table>
              <thead>
                <tr>
                  <th>Sensor</th>
                  <th>°C</th>
                  <th>°F</th>
                </tr>
              </thead>
              <tbody>
                {#each view.temperatures as row (row.sensor)}
                  <tr>
                    <td>{row.sensor}</td>
                    <td>{row.celsius ?? '—'}</td>
                    <td>{row.fahrenheit ?? '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}

          <h3>Power</h3>
          {#if view.powerSuppliesFailure}
            <div class="notice parse" role="status">
              <p>{view.powerSuppliesFailure.reason}</p>
              <pre class="raw">{view.powerSuppliesFailure.raw}</pre>
            </div>
          {:else if view.powerSupplies !== null && view.powerSupplies.length === 0}
            <p class="muted">No power supply rows.</p>
          {:else if view.powerSupplies !== null}
            <table>
              <thead>
                <tr>
                  <th>RPSU</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {#each view.powerSupplies as row (row.id)}
                  <tr>
                    <td>{row.id}</td>
                    <td>{row.status}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        {/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    flex: 0 0 46%;
    margin-top: auto;
    min-height: 0;
    border-top: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
  }

  .panel.collapsed {
    flex: 0 0 auto;
    grid-template-rows: auto;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
  }

  .collapsed .bar {
    border-bottom: none;
  }

  .tabs {
    display: flex;
    flex: 1;
    gap: 4px;
    overflow: auto;
  }

  .tabs button {
    font: inherit;
    padding: 6px 8px;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
  }

  .tabs button.selected,
  .tabs button:focus-visible {
    border-color: var(--fg);
    background: var(--hover);
  }

  .toggle {
    font: inherit;
    padding: 6px 8px;
    margin-left: auto;
    color: inherit;
    background: var(--bg);
    border: 1px solid var(--border);
    cursor: pointer;
  }

  .body {
    overflow: auto;
    padding: 12px;
    display: grid;
    gap: 12px;
    align-content: start;
  }

  .toolbar {
    display: flex;
    gap: 8px;
  }

  .notice {
    display: grid;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--border);
  }

  .notice.channel {
    border-color: var(--status-danger);
  }

  .notice.channel p {
    color: var(--status-danger);
  }

  .notice.parse {
    background: var(--hover);
  }

  .muted {
    color: var(--muted);
    margin: 0;
  }

  h3 {
    font-size: 0.9rem;
    font-weight: 600;
    margin: 0;
  }

  dl {
    display: grid;
    gap: 8px;
    margin: 0;
  }

  dl div {
    display: grid;
    gap: 2px;
  }

  dt {
    font-size: 0.8rem;
    color: var(--muted);
  }

  dd {
    margin: 0;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  th,
  td {
    text-align: left;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
  }

  pre {
    margin: 0;
    white-space: pre-wrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
  }

  .raw {
    max-height: 12rem;
    overflow: auto;
  }

  button {
    font: inherit;
    padding: 8px 10px;
    justify-self: start;
    color: inherit;
    background: var(--bg);
    border: 1px solid var(--border);
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>

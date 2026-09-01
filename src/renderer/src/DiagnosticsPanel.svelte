<script lang="ts">
  import type { DeviceFactsRun } from '../../shared/picos/device-facts'
  import type { InterfaceStatusRun } from '../../shared/picos/interface-status'
  import type { L2Run } from '../../shared/picos/l2'
  import type { L3Run } from '../../shared/picos/l3'
  import {
    DEFAULT_LOG_LINES,
    MAX_LOG_LINES,
    MIN_LOG_LINES,
    type LogsRun
  } from '../../shared/picos/logs'
  import {
    diagnosticBlockTabs,
    deviceFactsPanelView,
    interfaceStatusPanelView,
    l2PanelView,
    l3PanelView,
    logsPanelView,
    techSupportPanelView,
    type DiagnosticBlockId
  } from '../../shared/picos/diagnostics-panel'
  import type { TechSupportSnapshot } from '../../shared/picos/tech-support'
  import type { ProfileSessionUi } from '../../shared/ssh-session-ui'

  let {
    profileId,
    session
  }: {
    profileId: string
    session: ProfileSessionUi
  } = $props()

  const tabs = diagnosticBlockTabs()
  let selectedBlock = $state<DiagnosticBlockId>('device-facts')
  let showRaw = $state(false)
  let deviceFactsLoading = $state(false)
  let interfaceStatusLoading = $state(false)
  let l2Loading = $state(false)
  let l3Loading = $state(false)
  let logsLoading = $state(false)
  let techSupportLoading = $state(false)
  let deviceFactsRun = $state<DeviceFactsRun | null>(null)
  let interfaceStatusRun = $state<InterfaceStatusRun | null>(null)
  let l2Run = $state<L2Run | null>(null)
  let l3Run = $state<L3Run | null>(null)
  let logsRun = $state<LogsRun | null>(null)
  let techSupportSnapshot = $state<TechSupportSnapshot | null>(null)
  let loadedDeviceFactsSessionId = $state<string | null>(null)
  let loadedInterfaceStatusKey = $state<string | null>(null)
  let loadedL2SessionId = $state<string | null>(null)
  let loadedL3SessionId = $state<string | null>(null)
  let loadedLogsKey = $state<string | null>(null)
  let selectedNames = $state<string[]>([])
  let requestedDetailNames = $state<string[]>([])
  let logLinesDraft = $state(DEFAULT_LOG_LINES)
  let requestedLogLines = $state(DEFAULT_LOG_LINES)
  let deviceFactsRequest = 0
  let interfaceStatusRequest = 0
  let l2Request = 0
  let l3Request = 0
  let logsRequest = 0
  let interfaceStatusLoadingKey = $state<string | null>(null)
  let logsLoadingKey = $state<string | null>(null)

  const connected = $derived(session.state === 'connected' && session.sessionId !== null)
  const deviceFactsView = $derived(
    deviceFactsRun === null ? null : deviceFactsPanelView(deviceFactsRun)
  )
  const interfaceStatusView = $derived(
    interfaceStatusRun === null ? null : interfaceStatusPanelView(interfaceStatusRun)
  )
  const l2View = $derived(l2Run === null ? null : l2PanelView(l2Run))
  const l3View = $derived(l3Run === null ? null : l3PanelView(l3Run))
  const logsView = $derived(logsRun === null ? null : logsPanelView(logsRun))
  const techSupportView = $derived(
    techSupportSnapshot === null ? null : techSupportPanelView(techSupportSnapshot, { connected })
  )
  const loading = $derived(
    selectedBlock === 'interface-status'
      ? interfaceStatusLoading
      : selectedBlock === 'l2'
        ? l2Loading
        : selectedBlock === 'l3'
          ? l3Loading
          : selectedBlock === 'logs'
            ? logsLoading
            : selectedBlock === 'tech-support'
              ? techSupportLoading
              : deviceFactsLoading
  )

  function namesKey(names: string[]): string {
    return names.join('\0')
  }

  async function loadDeviceFacts(sessionId: string): Promise<void> {
    const seq = ++deviceFactsRequest
    deviceFactsLoading = true
    try {
      const next = await window.api.diagnostics.runDeviceFacts(profileId)
      if (seq !== deviceFactsRequest) {
        return
      }
      deviceFactsRun = next
      loadedDeviceFactsSessionId = sessionId
    } finally {
      if (seq === deviceFactsRequest) {
        deviceFactsLoading = false
      }
    }
  }

  async function loadInterfaceStatus(sessionId: string, names: string[]): Promise<void> {
    const seq = ++interfaceStatusRequest
    const key = `${sessionId}:${namesKey(names)}`
    interfaceStatusLoading = true
    interfaceStatusLoadingKey = key
    try {
      const next = await window.api.diagnostics.runInterfaceStatus(profileId, names)
      if (seq !== interfaceStatusRequest) {
        return
      }
      interfaceStatusRun = next
      loadedInterfaceStatusKey = key
    } finally {
      if (seq === interfaceStatusRequest) {
        interfaceStatusLoading = false
        interfaceStatusLoadingKey = null
      }
    }
  }

  async function loadL2(sessionId: string): Promise<void> {
    const seq = ++l2Request
    l2Loading = true
    try {
      const next = await window.api.diagnostics.runL2(profileId)
      if (seq !== l2Request) {
        return
      }
      l2Run = next
      loadedL2SessionId = sessionId
    } finally {
      if (seq === l2Request) {
        l2Loading = false
      }
    }
  }

  async function loadL3(sessionId: string): Promise<void> {
    const seq = ++l3Request
    l3Loading = true
    try {
      const next = await window.api.diagnostics.runL3(profileId)
      if (seq !== l3Request) {
        return
      }
      l3Run = next
      loadedL3SessionId = sessionId
    } finally {
      if (seq === l3Request) {
        l3Loading = false
      }
    }
  }

  function logsKey(sessionId: string, lines: number): string {
    return `${sessionId}:${String(lines)}`
  }

  async function loadLogs(sessionId: string, lines: number): Promise<void> {
    const seq = ++logsRequest
    const key = logsKey(sessionId, lines)
    logsLoading = true
    logsLoadingKey = key
    try {
      const next = await window.api.diagnostics.runLogs(profileId, lines)
      if (seq !== logsRequest) {
        return
      }
      logsRun = next
      loadedLogsKey = key
    } finally {
      if (seq === logsRequest) {
        logsLoading = false
        logsLoadingKey = null
      }
    }
  }

  $effect(() => {
    const sessionId = session.sessionId
    const state = session.state
    if (state !== 'connected' || sessionId === null) {
      if (deviceFactsLoading) {
        deviceFactsRequest += 1
        deviceFactsLoading = false
      }
      loadedDeviceFactsSessionId = null
      deviceFactsRun = null
      return
    }
    if (selectedBlock !== 'device-facts') {
      return
    }
    if (loadedDeviceFactsSessionId === sessionId || deviceFactsLoading) {
      return
    }
    deviceFactsRun = null
    void loadDeviceFacts(sessionId)
  })

  $effect(() => {
    const sessionId = session.sessionId
    const state = session.state
    if (state !== 'connected' || sessionId === null) {
      if (interfaceStatusLoading) {
        interfaceStatusRequest += 1
        interfaceStatusLoading = false
      }
      loadedInterfaceStatusKey = null
      interfaceStatusRun = null
      return
    }
    if (selectedBlock !== 'interface-status') {
      return
    }
    const names = requestedDetailNames
    const key = `${sessionId}:${namesKey(names)}`
    if (loadedInterfaceStatusKey === key) {
      return
    }
    if (interfaceStatusLoading && interfaceStatusLoadingKey === key) {
      return
    }
    interfaceStatusRun = null
    void loadInterfaceStatus(sessionId, names)
  })

  $effect(() => {
    const sessionId = session.sessionId
    const state = session.state
    if (state !== 'connected' || sessionId === null) {
      if (l2Loading) {
        l2Request += 1
        l2Loading = false
      }
      loadedL2SessionId = null
      l2Run = null
      return
    }
    if (selectedBlock !== 'l2') {
      return
    }
    if (loadedL2SessionId === sessionId || l2Loading) {
      return
    }
    l2Run = null
    void loadL2(sessionId)
  })

  $effect(() => {
    const sessionId = session.sessionId
    const state = session.state
    if (state !== 'connected' || sessionId === null) {
      if (l3Loading) {
        l3Request += 1
        l3Loading = false
      }
      loadedL3SessionId = null
      l3Run = null
      return
    }
    if (selectedBlock !== 'l3') {
      return
    }
    if (loadedL3SessionId === sessionId || l3Loading) {
      return
    }
    l3Run = null
    void loadL3(sessionId)
  })

  $effect(() => {
    const sessionId = session.sessionId
    const state = session.state
    if (state !== 'connected' || sessionId === null) {
      if (logsLoading) {
        logsRequest += 1
        logsLoading = false
      }
      loadedLogsKey = null
      logsRun = null
      return
    }
    if (selectedBlock !== 'logs') {
      return
    }
    const lines = requestedLogLines
    const key = logsKey(sessionId, lines)
    if (loadedLogsKey === key) {
      return
    }
    if (logsLoading && logsLoadingKey === key) {
      return
    }
    logsRun = null
    void loadLogs(sessionId, lines)
  })

  function refresh(): void {
    if (session.sessionId === null || session.state !== 'connected') {
      return
    }
    if (selectedBlock === 'interface-status') {
      loadedInterfaceStatusKey = null
      void loadInterfaceStatus(session.sessionId, requestedDetailNames)
      return
    }
    if (selectedBlock === 'l2') {
      loadedL2SessionId = null
      void loadL2(session.sessionId)
      return
    }
    if (selectedBlock === 'l3') {
      loadedL3SessionId = null
      void loadL3(session.sessionId)
      return
    }
    if (selectedBlock === 'logs') {
      loadedLogsKey = null
      void loadLogs(session.sessionId, requestedLogLines)
      return
    }
    loadedDeviceFactsSessionId = null
    void loadDeviceFacts(session.sessionId)
  }

  function selectBlock(id: DiagnosticBlockId): void {
    selectedBlock = id
    showRaw = false
  }

  function toggleName(name: string): void {
    if (selectedNames.includes(name)) {
      selectedNames = selectedNames.filter((entry) => entry !== name)
      return
    }
    selectedNames = [...selectedNames, name]
  }

  function loadSelectedDetail(): void {
    requestedDetailNames = [...selectedNames]
  }

  function applyLogLines(): void {
    requestedLogLines = logLinesDraft
  }

  async function refreshTechSupport(): Promise<void> {
    techSupportSnapshot = await window.api.diagnostics.getTechSupport(profileId)
  }

  async function startTechSupport(): Promise<void> {
    techSupportLoading = true
    try {
      const started = await window.api.diagnostics.startTechSupport(profileId)
      if (started.kind === 'ok') {
        techSupportSnapshot = started.snapshot
      } else {
        await refreshTechSupport()
      }
    } finally {
      techSupportLoading = false
    }
  }

  async function deleteTechSupportRemote(): Promise<void> {
    techSupportLoading = true
    try {
      const deleted = await window.api.diagnostics.deleteTechSupportRemote(profileId)
      if (deleted.kind === 'ok') {
        techSupportSnapshot = deleted.snapshot
      } else {
        await refreshTechSupport()
      }
    } finally {
      techSupportLoading = false
    }
  }

  async function revealTechSupportArtifact(): Promise<void> {
    await window.api.diagnostics.revealTechSupportArtifact(profileId)
  }

  $effect(() => {
    if (selectedBlock !== 'tech-support') {
      return
    }
    void refreshTechSupport()
    const timer = setInterval(() => {
      void refreshTechSupport()
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  })
</script>

<section class="panel">
  <!-- 规格 §3.3：块 tab 栏（导航样式，非按钮）+ 白卡面板 -->
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

  <div class="card">
    <div class="body">
      {#if selectedBlock === 'tech-support'}
        {#if techSupportView === null || techSupportView.status === 'need-session'}
          <p role="status">{techSupportView === null ? 'Loading…' : techSupportView.message}</p>
        {:else if techSupportView.status === 'idle'}
          <button
            type="button"
            data-kind="primary"
            onclick={startTechSupport}
            disabled={techSupportLoading || !connected}
          >
            {techSupportView.startLabel}
          </button>
        {:else if techSupportView.status === 'in-progress'}
          <h3>{techSupportView.phaseLabel}</h3>
          {#if techSupportView.waitingForSession && techSupportView.waitingForSessionMessage}
            <p class="muted">{techSupportView.waitingForSessionMessage}</p>
          {/if}
          <ol class="progress">
            {#each techSupportView.progress as event, index (`${event.at}:${index}`)}
              <li>
                <time datetime={event.at}>{event.at}</time>
                {event.message}
              </li>
            {/each}
          </ol>
        {:else if techSupportView.status === 'done'}
          <h3>{techSupportView.phaseLabel}</h3>
          <dl class="artifact">
            <div>
              <dt>文件名</dt>
              <dd>{techSupportView.artifact.fileName}</dd>
            </div>
            <div>
              <dt>大小</dt>
              <dd>{techSupportView.artifact.byteSizeLabel}</dd>
            </div>
            <div>
              <dt>保存位置</dt>
              <dd>{techSupportView.artifact.localPath}</dd>
            </div>
          </dl>
          {#if techSupportView.cleanupError}
            <div class="notice channel" role="status">
              <p>{techSupportView.cleanupError}</p>
            </div>
          {/if}
          <ol class="progress">
            {#each techSupportView.progress as event, index (`${event.at}:${index}`)}
              <li>
                <time datetime={event.at}>{event.at}</time>
                {event.message}
              </li>
            {/each}
          </ol>
          <div class="toolbar">
            <button type="button" onclick={revealTechSupportArtifact}>
              {techSupportView.openDirectoryLabel}
            </button>
            {#if techSupportView.canDeleteRemote}
              <button
                type="button"
                onclick={deleteTechSupportRemote}
                disabled={techSupportLoading || !connected}
              >
                {techSupportView.deleteRemoteLabel}
              </button>
            {/if}
            <button
              type="button"
              onclick={startTechSupport}
              disabled={techSupportLoading || !connected}
            >
              {techSupportView.recollectLabel}
            </button>
          </div>
        {:else if techSupportView.status === 'failed'}
          <div class="notice channel" role="alert">
            <p>{techSupportView.phaseLabel}</p>
            <p>{techSupportView.message}</p>
            {#if techSupportView.lastRemotePath}
              <p class="muted">
                {techSupportView.lastRemotePath}
                {#if techSupportView.lastRemoteBytes !== null}
                  · {techSupportView.lastRemoteBytes} 字节
                {/if}
                {#if techSupportView.lastProcessLabel}
                  · {techSupportView.lastProcessLabel}
                {/if}
              </p>
            {/if}
            {#if techSupportView.artifact}
              <p class="muted">
                {techSupportView.artifact.fileName} · {techSupportView.artifact.byteSizeLabel} · {techSupportView
                  .artifact.localPath}
              </p>
            {/if}
          </div>
          <ol class="progress">
            {#each techSupportView.progress as event, index (`${event.at}:${index}`)}
              <li>
                <time datetime={event.at}>{event.at}</time>
                {event.message}
              </li>
            {/each}
          </ol>
          <button
            type="button"
            data-kind="primary"
            onclick={startTechSupport}
            disabled={techSupportLoading || !connected}
          >
            {techSupportView.recollectLabel}
          </button>
        {/if}
      {:else if !connected}
        <p role="status">请先连接</p>
      {:else if selectedBlock === 'device-facts' && (deviceFactsView === null || deviceFactsView.status === 'need-session')}
        <p>{deviceFactsView === null ? 'Loading…' : deviceFactsView.message}</p>
      {:else if selectedBlock === 'device-facts' && deviceFactsView !== null && deviceFactsView.status === 'channel-failed'}
        <div class="notice channel" role="alert">
          <p>{deviceFactsView.message}</p>
          {#if deviceFactsView.stderrHead.length > 0}
            <pre>{deviceFactsView.stderrHead}</pre>
          {/if}
        </div>
        <button type="button" onclick={refresh}>Refresh</button>
      {:else if selectedBlock === 'device-facts' && deviceFactsView !== null && deviceFactsView.status === 'ready'}
        <div class="toolbar">
          <button type="button" onclick={refresh} disabled={loading}>Refresh</button>
          <button type="button" aria-pressed={showRaw} onclick={() => (showRaw = !showRaw)}>
            {deviceFactsView.viewRawLabel}
          </button>
        </div>
        {#if deviceFactsView.parseFailed}
          <div class="notice parse" role="status">
            <p>{deviceFactsView.parseFailedNotice}</p>
          </div>
        {/if}
        {#if showRaw || deviceFactsView.parseFailed}
          <pre class="raw">{deviceFactsView.raw}</pre>
        {/if}
        {#if !showRaw}
          {#if deviceFactsView.versionFailure}
            <div class="notice parse" role="status">
              <p>{deviceFactsView.versionFailure.reason}</p>
              <pre class="raw">{deviceFactsView.versionFailure.raw}</pre>
            </div>
          {:else}
            <dl>
              {#if deviceFactsView.model}
                <div>
                  <dt>Model</dt>
                  <dd>{deviceFactsView.model}</dd>
                </div>
              {/if}
              {#if deviceFactsView.softwareVersion}
                <div>
                  <dt>Software Version</dt>
                  <dd>{deviceFactsView.softwareVersion}</dd>
                </div>
              {/if}
              {#if deviceFactsView.serialNumber}
                <div>
                  <dt>Serial Number</dt>
                  <dd>{deviceFactsView.serialNumber}</dd>
                </div>
              {/if}
              {#if deviceFactsView.licenseType}
                <div>
                  <dt>License Type</dt>
                  <dd>{deviceFactsView.licenseType}</dd>
                </div>
              {/if}
              {#if deviceFactsView.systemUptime}
                <div>
                  <dt>System Uptime</dt>
                  <dd>{deviceFactsView.systemUptime}</dd>
                </div>
              {/if}
              {#if deviceFactsView.hardwareId}
                <div>
                  <dt>Hardware ID</dt>
                  <dd>{deviceFactsView.hardwareId}</dd>
                </div>
              {/if}
              {#if deviceFactsView.deviceMacAddress}
                <div>
                  <dt>Device MAC Address</dt>
                  <dd>{deviceFactsView.deviceMacAddress}</dd>
                </div>
              {/if}
            </dl>
          {/if}

          <h3>Fans</h3>
          {#if deviceFactsView.fansFailure}
            <div class="notice parse" role="status">
              <p>{deviceFactsView.fansFailure.reason}</p>
              <pre class="raw">{deviceFactsView.fansFailure.raw}</pre>
            </div>
          {:else if deviceFactsView.fans !== null && deviceFactsView.fans.length === 0}
            <p class="muted">No fan rows.</p>
          {:else if deviceFactsView.fans !== null}
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
                {#each deviceFactsView.fans as fan (fan.id)}
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
          {#if deviceFactsView.temperaturesFailure}
            <div class="notice parse" role="status">
              <p>{deviceFactsView.temperaturesFailure.reason}</p>
              <pre class="raw">{deviceFactsView.temperaturesFailure.raw}</pre>
            </div>
          {:else if deviceFactsView.temperatures !== null && deviceFactsView.temperatures.length === 0}
            <p class="muted">No temperature rows.</p>
          {:else if deviceFactsView.temperatures !== null}
            <table>
              <thead>
                <tr>
                  <th>Sensor</th>
                  <th>°C</th>
                  <th>°F</th>
                </tr>
              </thead>
              <tbody>
                {#each deviceFactsView.temperatures as row (row.sensor)}
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
          {#if deviceFactsView.powerSuppliesFailure}
            <div class="notice parse" role="status">
              <p>{deviceFactsView.powerSuppliesFailure.reason}</p>
              <pre class="raw">{deviceFactsView.powerSuppliesFailure.raw}</pre>
            </div>
          {:else if deviceFactsView.powerSupplies !== null && deviceFactsView.powerSupplies.length === 0}
            <p class="muted">No power supply rows.</p>
          {:else if deviceFactsView.powerSupplies !== null}
            <table>
              <thead>
                <tr>
                  <th>RPSU</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {#each deviceFactsView.powerSupplies as row (row.id)}
                  <tr>
                    <td>{row.id}</td>
                    <td>{row.status}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        {/if}
      {:else if selectedBlock === 'interface-status' && (interfaceStatusView === null || interfaceStatusView.status === 'need-session')}
        <p>{interfaceStatusView === null ? 'Loading…' : interfaceStatusView.message}</p>
      {:else if selectedBlock === 'interface-status' && interfaceStatusView !== null && interfaceStatusView.status === 'channel-failed'}
        <div class="notice channel" role="alert">
          <p>{interfaceStatusView.message}</p>
          {#if interfaceStatusView.stderrHead.length > 0}
            <pre>{interfaceStatusView.stderrHead}</pre>
          {/if}
        </div>
        <button type="button" onclick={refresh}>Refresh</button>
      {:else if selectedBlock === 'interface-status' && interfaceStatusView !== null && interfaceStatusView.status === 'invalid-interfaces'}
        <div class="notice channel" role="alert">
          <p>{interfaceStatusView.message}</p>
        </div>
        <button type="button" onclick={refresh}>Refresh</button>
      {:else if selectedBlock === 'interface-status' && interfaceStatusView !== null && interfaceStatusView.status === 'ready'}
        <div class="toolbar">
          <button type="button" onclick={refresh} disabled={loading}>Refresh</button>
          <button
            type="button"
            onclick={loadSelectedDetail}
            disabled={loading || selectedNames.length === 0}
          >
            Load detail
          </button>
          <button type="button" aria-pressed={showRaw} onclick={() => (showRaw = !showRaw)}>
            {interfaceStatusView.viewRawLabel}
          </button>
        </div>
        {#if interfaceStatusView.parseFailed}
          <div class="notice parse" role="status">
            <p>{interfaceStatusView.parseFailedNotice}</p>
          </div>
        {/if}
        {#if showRaw || interfaceStatusView.parseFailed}
          <pre class="raw">{interfaceStatusView.raw}</pre>
        {/if}
        {#if !showRaw}
          <h3>Ports</h3>
          {#if interfaceStatusView.briefFailure}
            <div class="notice parse" role="status">
              <p>{interfaceStatusView.briefFailure.reason}</p>
              <pre class="raw">{interfaceStatusView.briefFailure.raw}</pre>
            </div>
          {:else if interfaceStatusView.emptyBriefNotice}
            <p class="muted">{interfaceStatusView.emptyBriefNotice}</p>
          {:else if interfaceStatusView.brief !== null}
            <p class="muted">
              Select ports, then Load detail. Detail is not fetched for every port.
            </p>
            <table class="ports">
              <thead>
                <tr>
                  <th>Interface</th>
                  <th>Status</th>
                  <th>Management</th>
                  <th>Speed</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {#each interfaceStatusView.brief as row (row.name)}
                  <tr
                    class:picked={selectedNames.includes(row.name)}
                    aria-selected={selectedNames.includes(row.name)}
                    onclick={() => toggleName(row.name)}
                  >
                    <td>{row.name}</td>
                    <td>{row.status ?? '—'}</td>
                    <td>{row.management ?? '—'}</td>
                    <td>{row.speed ?? '—'}</td>
                    <td>{row.description ?? '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}

          <h3>Optics</h3>
          {#if interfaceStatusView.opticsFailure}
            <div class="notice parse" role="status">
              <p>{interfaceStatusView.opticsFailure.reason}</p>
              <pre class="raw">{interfaceStatusView.opticsFailure.raw}</pre>
            </div>
          {:else if interfaceStatusView.emptyOpticsNotice}
            <p class="muted">{interfaceStatusView.emptyOpticsNotice}</p>
          {:else if interfaceStatusView.optics !== null}
            <table>
              <thead>
                <tr>
                  <th>Interface</th>
                  <th>Temp (C/F)</th>
                  <th>Voltage</th>
                  <th>Bias</th>
                  <th>Tx Power</th>
                  <th>Rx Power</th>
                  <th>Module Type</th>
                </tr>
              </thead>
              <tbody>
                {#each interfaceStatusView.optics as row (row.name)}
                  <tr>
                    <td>{row.name}</td>
                    <td>{row.temperature ?? '—'}</td>
                    <td>{row.voltage ?? '—'}</td>
                    <td>{row.bias ?? '—'}</td>
                    <td>{row.txPower ?? '—'}</td>
                    <td>{row.rxPower ?? '—'}</td>
                    <td>{row.moduleType ?? '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}

          {#if interfaceStatusView.detailsRequested}
            <h3>Detail</h3>
            {#if interfaceStatusView.detailsFailure}
              <div class="notice parse" role="status">
                <p>{interfaceStatusView.detailsFailure.reason}</p>
                <pre class="raw">{interfaceStatusView.detailsFailure.raw}</pre>
              </div>
            {:else if interfaceStatusView.details !== null && interfaceStatusView.details.length === 0}
              <p class="muted">No interface detail.</p>
            {:else if interfaceStatusView.details !== null}
              {#each interfaceStatusView.details as detail (detail.name)}
                <article class="detail">
                  <h4>{detail.name}</h4>
                  <dl>
                    {#if detail.link}
                      <div>
                        <dt>Link</dt>
                        <dd>{detail.link}</dd>
                      </div>
                    {/if}
                    {#if detail.management}
                      <div>
                        <dt>Management</dt>
                        <dd>{detail.management}</dd>
                      </div>
                    {/if}
                    {#if detail.speed}
                      <div>
                        <dt>Speed</dt>
                        <dd>{detail.speed}</dd>
                      </div>
                    {/if}
                    {#if detail.mtu}
                      <div>
                        <dt>MTU</dt>
                        <dd>{detail.mtu}</dd>
                      </div>
                    {/if}
                    {#if detail.portMode}
                      <div>
                        <dt>Port mode</dt>
                        <dd>{detail.portMode}</dd>
                      </div>
                    {/if}
                    {#if detail.inputPackets}
                      <div>
                        <dt>Input packets</dt>
                        <dd>{detail.inputPackets}</dd>
                      </div>
                    {/if}
                    {#if detail.outputPackets}
                      <div>
                        <dt>Output packets</dt>
                        <dd>{detail.outputPackets}</dd>
                      </div>
                    {/if}
                  </dl>
                  {#if detail.members.length > 0}
                    <table>
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Status</th>
                          <th>Speed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each detail.members as member (member.name)}
                          <tr>
                            <td>{member.name}</td>
                            <td>{member.status ?? '—'}</td>
                            <td>{member.speed ?? '—'}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  {/if}
                </article>
              {/each}
            {/if}
          {/if}
        {/if}
      {:else if selectedBlock === 'l2' && (l2View === null || l2View.status === 'need-session')}
        <p>{l2View === null ? 'Loading…' : l2View.message}</p>
      {:else if selectedBlock === 'l2' && l2View !== null && l2View.status === 'channel-failed'}
        <div class="notice channel" role="alert">
          <p>{l2View.message}</p>
          {#if l2View.stderrHead.length > 0}
            <pre>{l2View.stderrHead}</pre>
          {/if}
        </div>
        <button type="button" onclick={refresh}>Refresh</button>
      {:else if selectedBlock === 'l2' && l2View !== null && l2View.status === 'ready'}
        <div class="toolbar">
          <button type="button" onclick={refresh} disabled={loading}>Refresh</button>
          <button type="button" aria-pressed={showRaw} onclick={() => (showRaw = !showRaw)}>
            {l2View.viewRawLabel}
          </button>
        </div>
        {#if l2View.parseFailed}
          <div class="notice parse" role="status">
            <p>{l2View.parseFailedNotice}</p>
          </div>
        {/if}
        {#if showRaw || l2View.parseFailed}
          <pre class="raw">{l2View.raw}</pre>
        {/if}
        {#if !showRaw}
          <h3>VLANs</h3>
          {#if l2View.vlansFailure}
            <div class="notice parse" role="status">
              <p>{l2View.vlansFailure.reason}</p>
              <pre class="raw">{l2View.vlansFailure.raw}</pre>
            </div>
          {:else if l2View.emptyVlansNotice}
            <p class="muted">{l2View.emptyVlansNotice}</p>
          {:else if l2View.vlans !== null}
            <table>
              <thead>
                <tr>
                  <th>VLAN</th>
                  <th>Name</th>
                  <th>Untagged</th>
                  <th>Tagged</th>
                </tr>
              </thead>
              <tbody>
                {#each l2View.vlans as row (row.id)}
                  <tr>
                    <td>{row.id}</td>
                    <td>{row.name ?? '—'}</td>
                    <td>{row.untagged.length > 0 ? row.untagged.join(', ') : '—'}</td>
                    <td>{row.tagged.length > 0 ? row.tagged.join(', ') : '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}

          <h3>FDB</h3>
          {#if l2View.fdbTotalEntries !== undefined || l2View.fdbStaticEntries !== undefined || l2View.fdbDynamicEntries !== undefined}
            <p class="muted">
              {#if l2View.fdbTotalEntries !== undefined}Total {l2View.fdbTotalEntries}{/if}
              {#if l2View.fdbStaticEntries !== undefined}
                · static {l2View.fdbStaticEntries}{/if}
              {#if l2View.fdbDynamicEntries !== undefined}
                · dynamic {l2View.fdbDynamicEntries}{/if}
            </p>
          {/if}
          {#if l2View.fdbFailure}
            <div class="notice parse" role="status">
              <p>{l2View.fdbFailure.reason}</p>
              <pre class="raw">{l2View.fdbFailure.raw}</pre>
            </div>
          {:else if l2View.emptyFdbNotice}
            <p class="muted">{l2View.emptyFdbNotice}</p>
          {:else if l2View.fdb !== null}
            <table>
              <thead>
                <tr>
                  <th>VLAN</th>
                  <th>MAC address</th>
                  <th>Type</th>
                  <th>Age</th>
                  <th>Interfaces</th>
                </tr>
              </thead>
              <tbody>
                {#each l2View.fdb as row, index (`${row.vlan ?? ''}:${row.mac ?? ''}:${index}`)}
                  <tr>
                    <td>{row.vlan ?? '—'}</td>
                    <td>{row.mac ?? '—'}</td>
                    <td>{row.type ?? '—'}</td>
                    <td>{row.age ?? '—'}</td>
                    <td>{row.interfaces ?? '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}

          <h3>Switching</h3>
          {#if l2View.switchingFailure}
            <div class="notice parse" role="status">
              <p>{l2View.switchingFailure.reason}</p>
              <pre class="raw">{l2View.switchingFailure.raw}</pre>
            </div>
          {:else if l2View.emptySwitchingNotice}
            <p class="muted">{l2View.emptySwitchingNotice}</p>
          {:else if l2View.switching !== null}
            <table>
              <thead>
                <tr>
                  <th>Interface</th>
                  <th>State</th>
                  <th>Tagging</th>
                  <th>Native VLAN</th>
                  <th>VLAN members</th>
                </tr>
              </thead>
              <tbody>
                {#each l2View.switching as row (row.name)}
                  <tr>
                    <td>{row.name}</td>
                    <td>{row.state ?? '—'}</td>
                    <td>{row.tagging ?? '—'}</td>
                    <td>{row.nativeVlan ?? '—'}</td>
                    <td>{row.vlanMembers.length > 0 ? row.vlanMembers.join(', ') : '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        {/if}
      {:else if selectedBlock === 'l3' && (l3View === null || l3View.status === 'need-session')}
        <p>{l3View === null ? 'Loading…' : l3View.message}</p>
      {:else if selectedBlock === 'l3' && l3View !== null && l3View.status === 'channel-failed'}
        <div class="notice channel" role="alert">
          <p>{l3View.message}</p>
          {#if l3View.stderrHead.length > 0}
            <pre>{l3View.stderrHead}</pre>
          {/if}
        </div>
        <button type="button" onclick={refresh}>Refresh</button>
      {:else if selectedBlock === 'l3' && l3View !== null && l3View.status === 'ready'}
        <div class="toolbar">
          <button type="button" onclick={refresh} disabled={loading}>Refresh</button>
          <button type="button" aria-pressed={showRaw} onclick={() => (showRaw = !showRaw)}>
            {l3View.viewRawLabel}
          </button>
        </div>
        {#if l3View.parseFailed}
          <div class="notice parse" role="status">
            <p>{l3View.parseFailedNotice}</p>
          </div>
        {/if}
        {#if showRaw || l3View.parseFailed}
          <pre class="raw">{l3View.raw}</pre>
        {/if}
        {#if !showRaw}
          <div class="compare">
            <section class="compare-pane">
              <h3>Software routes</h3>
              {#if l3View.softwareRoutesFailure}
                <div class="notice parse" role="status">
                  <p>{l3View.softwareRoutesFailure.reason}</p>
                  <pre class="raw">{l3View.softwareRoutesFailure.raw}</pre>
                </div>
              {:else if l3View.emptySoftwareRoutesNotice}
                <p class="muted">{l3View.emptySoftwareRoutesNotice}</p>
              {:else if l3View.softwareRoutes !== null}
                <table>
                  <thead>
                    <tr>
                      <th>Proto</th>
                      <th>Flags</th>
                      <th>Destination</th>
                      <th>Pref/Metric</th>
                      <th>Nexthop</th>
                      <th>Interface</th>
                      <th>Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each l3View.softwareRoutes as row, index (`${row.protocol}:${row.destination}:${index}`)}
                      <tr>
                        <td>{row.protocol}</td>
                        <td>{row.flags}</td>
                        <td>{row.destination}</td>
                        <td>{row.prefMetric}</td>
                        <td>{row.nexthopLabel}</td>
                        <td>{row.interface ?? '—'}</td>
                        <td>{row.age ?? '—'}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
            </section>
            <section class="compare-pane">
              <h3>Hardware routes</h3>
              {#if l3View.hardwareRouteCount !== undefined}
                <p class="muted">Total {l3View.hardwareRouteCount}</p>
              {/if}
              {#if l3View.hardwareRoutesFailure}
                <div class="notice parse" role="status">
                  <p>{l3View.hardwareRoutesFailure.reason}</p>
                  <pre class="raw">{l3View.hardwareRoutesFailure.raw}</pre>
                </div>
              {:else if l3View.emptyHardwareRoutesNotice}
                <p class="muted">{l3View.emptyHardwareRoutesNotice}</p>
              {:else if l3View.hardwareRoutes !== null}
                <table>
                  <thead>
                    <tr>
                      <th>Destination</th>
                      <th>Next-hop MAC</th>
                      <th>Port</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each l3View.hardwareRoutes as row, index (`${row.destination}:${index}`)}
                      <tr>
                        <td>{row.destination}</td>
                        <td>{row.nextHopMac ?? '—'}</td>
                        <td>{row.port ?? '—'}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}

              <h3>Hardware hosts</h3>
              {#if l3View.hardwareHostCount !== undefined}
                <p class="muted">Total {l3View.hardwareHostCount}</p>
              {/if}
              {#if l3View.hardwareHostsFailure}
                <div class="notice parse" role="status">
                  <p>{l3View.hardwareHostsFailure.reason}</p>
                  <pre class="raw">{l3View.hardwareHostsFailure.raw}</pre>
                </div>
              {:else if l3View.emptyHardwareHostsNotice}
                <p class="muted">{l3View.emptyHardwareHostsNotice}</p>
              {:else if l3View.hardwareHosts !== null}
                <table>
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>HW address</th>
                      <th>Port</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each l3View.hardwareHosts as row, index (`${row.address}:${index}`)}
                      <tr>
                        <td>{row.address}</td>
                        <td>{row.hwAddress ?? '—'}</td>
                        <td>{row.port ?? '—'}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
            </section>
          </div>

          <h3>ARP</h3>
          {#if l3View.arpAgingTime !== undefined || l3View.arpTotalCount !== undefined}
            <p class="muted">
              {#if l3View.arpAgingTime !== undefined}Aging {l3View.arpAgingTime}s{/if}
              {#if l3View.arpTotalCount !== undefined}
                · total {l3View.arpTotalCount}{/if}
            </p>
          {/if}
          {#if l3View.arpFailure}
            <div class="notice parse" role="status">
              <p>{l3View.arpFailure.reason}</p>
              <pre class="raw">{l3View.arpFailure.raw}</pre>
            </div>
          {:else if l3View.emptyArpNotice}
            <p class="muted">{l3View.emptyArpNotice}</p>
          {:else if l3View.arp !== null}
            <table>
              <thead>
                <tr>
                  <th>Address</th>
                  <th>HW address</th>
                  <th>Type</th>
                  <th>Interface</th>
                  <th>Age</th>
                </tr>
              </thead>
              <tbody>
                {#each l3View.arp as row, index (`${row.address ?? ''}:${row.hwAddress ?? ''}:${index}`)}
                  <tr>
                    <td>{row.address ?? '—'}</td>
                    <td>{row.hwAddress ?? '—'}</td>
                    <td>{row.type ?? '—'}</td>
                    <td>{row.interface ?? '—'}</td>
                    <td>{row.age ?? '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}

          <h3>IPv6 neighbors</h3>
          {#if l3View.neighborAgingTime !== undefined || l3View.neighborTotalCount !== undefined}
            <p class="muted">
              {#if l3View.neighborAgingTime !== undefined}Aging {l3View.neighborAgingTime}s{/if}
              {#if l3View.neighborTotalCount !== undefined}
                · total {l3View.neighborTotalCount}{/if}
            </p>
          {/if}
          {#if l3View.neighborsFailure}
            <div class="notice parse" role="status">
              <p>{l3View.neighborsFailure.reason}</p>
              <pre class="raw">{l3View.neighborsFailure.raw}</pre>
            </div>
          {:else if l3View.emptyNeighborsNotice}
            <p class="muted">{l3View.emptyNeighborsNotice}</p>
          {:else if l3View.neighbors !== null}
            <table>
              <thead>
                <tr>
                  <th>Address</th>
                  <th>HW address</th>
                  <th>Type</th>
                  <th>Interface</th>
                  <th>Age</th>
                </tr>
              </thead>
              <tbody>
                {#each l3View.neighbors as row, index (`${row.address ?? ''}:${row.hwAddress ?? ''}:${index}`)}
                  <tr>
                    <td>{row.address ?? '—'}</td>
                    <td>{row.hwAddress ?? '—'}</td>
                    <td>{row.type ?? '—'}</td>
                    <td>{row.interface ?? '—'}</td>
                    <td>{row.age ?? '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        {/if}
      {:else if selectedBlock === 'logs' && (logsView === null || logsView.status === 'need-session')}
        <p>{logsView === null ? 'Loading…' : logsView.message}</p>
      {:else if selectedBlock === 'logs' && logsView !== null && logsView.status === 'channel-failed'}
        <div class="notice channel" role="alert">
          <p>{logsView.message}</p>
          {#if logsView.stderrHead.length > 0}
            <pre>{logsView.stderrHead}</pre>
          {/if}
        </div>
        <button type="button" onclick={refresh}>Refresh</button>
      {:else if selectedBlock === 'logs' && logsView !== null && logsView.status === 'invalid-lines'}
        <div class="notice channel" role="alert">
          <p>{logsView.message}</p>
        </div>
        <div class="toolbar">
          <label class="lines">
            Lines
            <input
              type="number"
              min={MIN_LOG_LINES}
              max={MAX_LOG_LINES}
              bind:value={logLinesDraft}
            />
          </label>
          <button type="button" onclick={applyLogLines}>Apply</button>
        </div>
      {:else if selectedBlock === 'logs' && logsView !== null && logsView.status === 'ready'}
        <div class="toolbar">
          <button type="button" onclick={refresh} disabled={loading}>Refresh</button>
          <label class="lines">
            Lines
            <input
              type="number"
              min={MIN_LOG_LINES}
              max={MAX_LOG_LINES}
              bind:value={logLinesDraft}
            />
          </label>
          <button type="button" onclick={applyLogLines} disabled={loading}>Apply</button>
          <button type="button" aria-pressed={showRaw} onclick={() => (showRaw = !showRaw)}>
            {logsView.viewRawLabel}
          </button>
        </div>
        {#if logsView.parseFailed}
          <div class="notice parse" role="status">
            <p>{logsView.parseFailedNotice}</p>
          </div>
        {/if}
        {#if showRaw || logsView.parseFailed}
          <pre class="raw">{logsView.raw}</pre>
        {/if}
        {#if !showRaw}
          <h3>Recent syslog</h3>
          {#if logsView.syslogFailure}
            <div class="notice parse" role="status">
              <p>{logsView.syslogFailure.reason}</p>
              <pre class="raw">{logsView.syslogFailure.raw}</pre>
            </div>
          {:else if logsView.emptySyslogNotice}
            <p class="muted">{logsView.emptySyslogNotice}</p>
          {:else if logsView.syslog !== null}
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Host</th>
                  <th>Program</th>
                  <th>Facility</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {#each logsView.syslog as row, index (`${row.timestamp}:${row.message}:${index}`)}
                  <tr>
                    <td>{row.timestamp}</td>
                    <td>{row.host}</td>
                    <td>{row.program ?? '—'}</td>
                    <td>{row.facility}.{row.severity}</td>
                    <td>{row.message}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}

          <h3>Core dumps</h3>
          {#if logsView.corePath}
            <p class="muted">
              {logsView.corePath}{logsView.coreTarget
                ? ` → ${logsView.coreTarget}`
                : ''}{logsView.coreSymlink ? ' (symlink)' : ''}
            </p>
          {/if}
          {#if logsView.coreFailure}
            <div class="notice parse" role="status">
              <p>{logsView.coreFailure.reason}</p>
              <pre class="raw">{logsView.coreFailure.raw}</pre>
            </div>
          {:else if logsView.emptyCoresNotice}
            <p class="muted">{logsView.emptyCoresNotice}</p>
          {:else if logsView.cores !== null}
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {#each logsView.cores as row, index (`${row.name}:${index}`)}
                  <tr>
                    <td>{row.name}</td>
                    <td>{row.size ?? '—'}</td>
                    <td>{row.date ?? '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        {/if}
      {/if}
    </div>
  </div>
</section>

<style>
  /* 规格 §3.3：面板占满诊断页，块 tab 栏 + 白卡 */
  .panel {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 0;
    color: var(--text-base);
  }

  /* 规格 §4.7 tab 导航 */
  .tabs {
    display: flex;
    gap: 16px;
    padding: 0 16px;
    height: 40px;
    align-items: stretch;
    overflow: auto;
  }

  .tabs button {
    font-size: var(--font-sm);
    font-weight: 500;
    padding: 0 2px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
  }

  .tabs button:hover {
    color: var(--text-base);
  }

  .tabs button.selected {
    color: var(--text-base);
    border-bottom-color: var(--text-base);
  }

  .card {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    flex: 1 1 0;
    min-height: 0;
    background: var(--bg-surface);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-card);
    overflow: hidden;
  }

  .body {
    overflow: auto;
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
    align-content: start;
  }

  .toolbar {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }

  .lines {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.9rem;
  }

  .lines input {
    width: 5rem;
    font: inherit;
    padding: 6px 8px;
    color: inherit;
    background: var(--bg);
    border: 1px solid var(--border);
  }

  .compare {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }

  .compare-pane {
    display: grid;
    gap: 12px;
    min-width: 0;
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

  h3,
  h4 {
    font-size: var(--font-md);
    font-weight: 600;
    margin: 0;
  }

  .detail {
    display: grid;
    gap: 8px;
  }

  .artifact {
    display: grid;
    gap: 8px;
  }

  .progress {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }

  .progress time {
    display: block;
    color: var(--muted);
    font-size: 0.75rem;
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

  tr.picked {
    background: var(--bg-hover);
  }

  table.ports tbody tr {
    cursor: pointer;
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

</style>

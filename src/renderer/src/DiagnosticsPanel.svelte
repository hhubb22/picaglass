<script lang="ts">
  import type { DeviceFactsRun } from '../../shared/picos/device-facts'
  import type { InterfaceStatusRun } from '../../shared/picos/interface-status'
  import type { L2Run } from '../../shared/picos/l2'
  import type { L3Run } from '../../shared/picos/l3'
  import {
    diagnosticBlockTabs,
    deviceFactsPanelView,
    interfaceStatusPanelView,
    l2PanelView,
    l3PanelView,
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
  let deviceFactsLoading = $state(false)
  let interfaceStatusLoading = $state(false)
  let l2Loading = $state(false)
  let l3Loading = $state(false)
  let deviceFactsRun = $state<DeviceFactsRun | null>(null)
  let interfaceStatusRun = $state<InterfaceStatusRun | null>(null)
  let l2Run = $state<L2Run | null>(null)
  let l3Run = $state<L3Run | null>(null)
  let loadedDeviceFactsSessionId = $state<string | null>(null)
  let loadedInterfaceStatusKey = $state<string | null>(null)
  let loadedL2SessionId = $state<string | null>(null)
  let loadedL3SessionId = $state<string | null>(null)
  let selectedNames = $state<string[]>([])
  let requestedDetailNames = $state<string[]>([])
  let deviceFactsRequest = 0
  let interfaceStatusRequest = 0
  let l2Request = 0
  let l3Request = 0
  let interfaceStatusLoadingKey = $state<string | null>(null)

  const connected = $derived(session.state === 'connected' && session.sessionId !== null)
  const deviceFactsView = $derived(
    deviceFactsRun === null ? null : deviceFactsPanelView(deviceFactsRun)
  )
  const interfaceStatusView = $derived(
    interfaceStatusRun === null ? null : interfaceStatusPanelView(interfaceStatusRun)
  )
  const l2View = $derived(l2Run === null ? null : l2PanelView(l2Run))
  const l3View = $derived(l3Run === null ? null : l3PanelView(l3Run))
  const loading = $derived(
    selectedBlock === 'interface-status'
      ? interfaceStatusLoading
      : selectedBlock === 'l2'
        ? l2Loading
        : selectedBlock === 'l3'
          ? l3Loading
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
    if (collapsed || selectedBlock !== 'device-facts') {
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
    if (collapsed || selectedBlock !== 'interface-status') {
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
    if (collapsed || selectedBlock !== 'l2') {
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
    if (collapsed || selectedBlock !== 'l3') {
      return
    }
    if (loadedL3SessionId === sessionId || l3Loading) {
      return
    }
    l3Run = null
    void loadL3(sessionId)
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
    font-size: 0.9rem;
    font-weight: 600;
    margin: 0;
  }

  .detail {
    display: grid;
    gap: 8px;
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

  tr.picked {
    background: var(--hover);
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

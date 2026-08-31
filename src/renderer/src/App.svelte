<script lang="ts">
  import { onMount, tick } from 'svelte'
  import {
    deleteProfileConfirmation,
    draftFromProfile,
    isProfileDraftDirty,
    isProfileEditDirty,
    parseProfileDraft,
    type CreateProfileInput,
    type ProfileDraftForm,
    type ProfileFieldErrors,
    type ProfileWorkspace,
    type UpdateProfileInput
  } from '../../shared/profile'
  import {
    defaultTab,
    isForegroundConnect,
    tabAfterSuccessfulConnect,
    tabWhenSelectingProfile,
    type ConnectFocusContext,
    type WorkspacePane,
    type WorkspaceTab
  } from '../../shared/profile-workspace-ui'
  import {
    applyConnectResult,
    applyMissingPrivateKey,
    applySessionStatus,
    beginDisconnect,
    cancelSecretPrompt,
    connectionFieldsLocked,
    emptyProfileSession,
    promptForSecret,
    submitSecret,
    type ProfileSessionUi
  } from '../../shared/ssh-session-ui'
  import type { HostTrustState, SshHostKeyAction } from '../../shared/ssh'
  import {
    HOST_TRUST_ACTION_LABEL,
    changedHostPrompt,
    forgetConfirmCopy,
    formatTrustDestination,
    replaceConfirmCopy,
    requestReplaceConfirm,
    unknownHostPrompt
  } from '../../shared/host-trust-ui'
  import {
    appendRemote,
    beginAttempt,
    clearTranscript,
    endSession,
    formatSeparatorText,
    type TranscriptEntry
  } from '../../shared/terminal-transcript'
  import AppDialog from './AppDialog.svelte'
  import ProfileCreateForm from './ProfileCreateForm.svelte'
  import ProfileSidebar from './ProfileSidebar.svelte'
  import ProfileWorkspaceView from './ProfileWorkspace.svelte'
  import SecretPrompt from './SecretPrompt.svelte'
  import { createTerminalRegistry } from './terminal-registry'
  import '@xterm/xterm/css/xterm.css'

  let workspace = $state<ProfileWorkspace>({
    profiles: [],
    selectedProfileId: null,
    notice: null
  })
  let pane = $state<WorkspacePane>('empty')
  let draft = $state(emptyDraft())
  let keyRef = $state<string | null>(null)
  let keyLabel = $state<string | null>(null)
  let fields = $state<ProfileFieldErrors>({})
  let busy = $state(false)
  let duplicateLabel = $state<string | null>(null)
  let discard = $state<
    | null
    | { kind: 'cancel' }
    | { kind: 'select'; profileId: string }
    | { kind: 'close' }
    | { kind: 'create' }
  >(null)
  let deleteConfirm = $state<null | { profileId: string; label: string; occupied: boolean }>(null)
  let sessions = $state<Record<string, ProfileSessionUi>>({})
  let tabs = $state<Record<string, WorkspaceTab>>({})
  let deferredTerminal = $state<Record<string, boolean>>({})
  let transcripts = $state<Record<string, TranscriptEntry[]>>({})
  let terminalIds = $state<string[]>([])
  let hostTrust = $state<HostTrustState>({ status: 'not-remembered' })
  let replaceConfirm = $state(false)
  let forgetConfirm = $state(false)

  const selected = $derived(
    workspace.profiles.find((profile) => profile.id === workspace.selectedProfileId) ?? null
  )
  const dirtyCreation = $derived(pane === 'create' && isProfileDraftDirty(draft))
  const selectedSession = $derived(
    selected === null ? emptyProfileSession() : (sessions[selected.id] ?? emptyProfileSession())
  )
  const dirtyEdit = $derived(
    pane === 'edit' && selected !== null && isProfileEditDirty(draft, selected, keyRef !== null)
  )
  const dirtyForm = $derived(dirtyCreation || dirtyEdit)
  const connectionLocked = $derived(connectionFieldsLocked(selectedSession.state))
  const selectedTab = $derived(
    selected === null ? defaultTab() : (tabs[selected.id] ?? defaultTab())
  )
  const selectedTranscript = $derived(selected === null ? [] : (transcripts[selected.id] ?? []))

  const registry = createTerminalRegistry({
    onInput(profileId, data) {
      const sessionId = sessions[profileId]?.sessionId
      if (sessionId === undefined || sessionId === null) {
        return
      }
      window.api.ssh.write(sessionId, data)
    },
    onResize(profileId, cols, rows) {
      const ui = sessions[profileId]
      const sessionId = ui?.sessionId ?? ui?.pendingHostKey?.sessionId
      if (sessionId === undefined) {
        return
      }
      window.api.ssh.resize(sessionId, cols, rows)
    }
  })

  $effect(() => {
    void window.api.workspace.setCloseGuard(dirtyForm)
  })

  function emptyDraft(): ProfileDraftForm {
    return {
      displayName: '',
      host: '',
      port: '',
      username: '',
      authMethod: null,
      automaticDiscovery: true
    }
  }

  function resetDraft(): void {
    draft = emptyDraft()
    keyRef = null
    keyLabel = null
    fields = {}
    duplicateLabel = null
  }

  function draftInput(saveAnyway = false): CreateProfileInput {
    const input: CreateProfileInput = {
      displayName: draft.displayName,
      host: draft.host,
      port: draft.port,
      username: draft.username,
      auth:
        draft.authMethod === 'password'
          ? { method: 'password' }
          : draft.authMethod === 'privateKey'
            ? keyRef !== null
              ? { method: 'privateKey', keyRef }
              : pane === 'edit'
                ? { method: 'privateKey', keepExisting: true }
                : { method: 'privateKey', keyRef: '' }
            : { method: undefined },
      automaticDiscovery: draft.automaticDiscovery
    }
    if (saveAnyway) {
      input.saveAnyway = true
    }
    return input
  }

  function sessionOf(profileId: string): ProfileSessionUi {
    return sessions[profileId] ?? emptyProfileSession()
  }

  function setSession(profileId: string, next: ProfileSessionUi): void {
    sessions[profileId] = next
  }

  function ensureTerminalId(profileId: string): void {
    if (!terminalIds.includes(profileId)) {
      terminalIds = [...terminalIds, profileId]
    }
  }

  function focusContext(profileId: string): ConnectFocusContext {
    return {
      connectingProfileId: profileId,
      selectedProfileId: workspace.selectedProfileId,
      pane
    }
  }

  function profileIdForSession(sessionId: string): string | undefined {
    for (const [profileId, ui] of Object.entries(sessions)) {
      if (ui.sessionId === sessionId || ui.pendingHostKey?.sessionId === sessionId) {
        return profileId
      }
    }
    return undefined
  }

  async function refreshHostTrust(host: string, port: number): Promise<void> {
    hostTrust = await window.api.ssh.hostTrust(host, port)
  }

  async function refreshSelectedTrust(): Promise<void> {
    if (selected === null) {
      hostTrust = { status: 'not-remembered' }
      return
    }
    await refreshHostTrust(selected.host, selected.port)
  }

  function beginCreate(): void {
    if (pane === 'create' && dirtyCreation) {
      return
    }
    if (dirtyEdit) {
      discard = { kind: 'create' }
      return
    }
    resetDraft()
    pane = 'create'
  }

  function beginEdit(): void {
    if (selected === null || dirtyCreation) {
      return
    }
    draft = draftFromProfile(selected)
    keyRef = null
    keyLabel = selected.auth.method === 'privateKey' ? selected.auth.label : null
    fields = {}
    duplicateLabel = null
    pane = 'edit'
  }

  function forgetDeletedProfile(profileId: string): void {
    const nextSessions = { ...sessions }
    delete nextSessions[profileId]
    sessions = nextSessions
    const nextTabs = { ...tabs }
    delete nextTabs[profileId]
    tabs = nextTabs
    const nextDeferred = { ...deferredTerminal }
    delete nextDeferred[profileId]
    deferredTerminal = nextDeferred
    const nextTranscripts = { ...transcripts }
    delete nextTranscripts[profileId]
    transcripts = nextTranscripts
    terminalIds = terminalIds.filter((id) => id !== profileId)
    registry.forget(profileId)
  }

  async function selectProfile(profileId: string): Promise<void> {
    if (dirtyForm) {
      discard = { kind: 'select', profileId }
      return
    }
    busy = true
    try {
      const result = await window.api.profiles.select(profileId)
      workspace = result.workspace
      pane = result.ok ? 'profile' : pane
      if (result.ok) {
        const tab = tabWhenSelectingProfile(tabs[profileId], deferredTerminal[profileId] === true)
        tabs[profileId] = tab
        deferredTerminal[profileId] = false
        const profile = workspace.profiles.find((item) => item.id === profileId)
        if (profile !== undefined) {
          await refreshHostTrust(profile.host, profile.port)
        }
        if (tab === 'terminal' && sessions[profileId]?.state === 'connected') {
          ensureTerminalId(profileId)
          await tick()
          registry.fit(profileId)
          registry.focus(profileId)
        }
      }
    } finally {
      busy = false
    }
  }

  function chooseTab(tab: WorkspaceTab): void {
    if (selected === null) {
      return
    }
    tabs[selected.id] = tab
    if (tab === 'terminal') {
      ensureTerminalId(selected.id)
      void tick().then(() => {
        registry.fit(selected.id)
        if (sessionOf(selected.id).state === 'connected') {
          registry.focus(selected.id)
        }
      })
    }
  }

  async function requestConnect(profileId: string): Promise<void> {
    const current = sessionOf(profileId)
    if (current.state !== 'no-active-session' || current.secretPrompt !== null) {
      return
    }
    const need = await window.api.ssh.secretRequirement(profileId)
    if (!need.ok) {
      setSession(profileId, applyMissingPrivateKey(current))
      return
    }
    if (need.kind === 'password' || need.kind === 'passphrase') {
      setSession(profileId, promptForSecret(current, need.kind))
      return
    }
    await runConnect(profileId)
  }

  async function submitAuthSecret(profileId: string, secret: string): Promise<void> {
    if (secret.length === 0) {
      return
    }
    setSession(profileId, submitSecret(sessionOf(profileId)))
    await runConnect(profileId, secret)
  }

  function cancelAuthSecret(profileId: string): void {
    setSession(profileId, cancelSecretPrompt(sessionOf(profileId)))
  }

  async function runConnect(profileId: string, secret?: string): Promise<void> {
    const origin = focusContext(profileId)
    const previous = sessionOf(profileId).lastOutcome
    setSession(profileId, {
      ...sessionOf(profileId),
      state: 'connecting',
      secretPrompt: null,
      error: null
    })
    ensureTerminalId(profileId)
    await tick()
    const nextTranscript = beginAttempt(transcripts[profileId] ?? [], new Date(), previous)
    transcripts[profileId] = nextTranscript
    const separator = nextTranscript[nextTranscript.length - 1]
    if (separator !== undefined && separator.source === 'local' && separator.kind === 'separator') {
      registry.writeLocal(profileId, formatSeparatorText(separator))
    }
    const size = registry.size(profileId)
    const result = await window.api.ssh.connect({
      profileId,
      secret,
      cols: size?.cols ?? 80,
      rows: size?.rows ?? 24
    })
    const next = applyConnectResult(sessionOf(profileId), result)
    setSession(profileId, next)
    await refreshSelectedTrust()
    if (next.sessionId !== null) {
      registry.setWritable(profileId, next.sessionId)
    }
    if (!result.ok) {
      return
    }
    const decision = tabAfterSuccessfulConnect(isForegroundConnect(origin, focusContext(profileId)))
    if (decision.changeSelection) {
      tabs[profileId] = decision.tab
      if (decision.focusTerminal) {
        await tick()
        registry.fit(profileId)
        registry.focus(profileId)
      }
      return
    }
    deferredTerminal[profileId] = true
  }

  async function decideHost(profileId: string, action: SshHostKeyAction): Promise<void> {
    const pending = sessionOf(profileId).pendingHostKey
    if (pending === null) {
      return
    }
    replaceConfirm = false
    const result = await window.api.ssh.confirmHostKey(pending.sessionId, action)
    const next = applyConnectResult({ ...sessionOf(profileId), state: 'connecting' }, result)
    setSession(profileId, next)
    await refreshSelectedTrust()
    if (next.sessionId !== null) {
      registry.setWritable(profileId, next.sessionId)
      const origin = {
        connectingProfileId: profileId,
        selectedProfileId: profileId,
        pane: 'profile' as const
      }
      if (isForegroundConnect(origin, focusContext(profileId))) {
        tabs[profileId] = 'terminal'
        await tick()
        registry.fit(profileId)
        registry.focus(profileId)
      } else {
        deferredTerminal[profileId] = true
      }
    }
  }

  async function abortHost(profileId: string): Promise<void> {
    const pending = sessionOf(profileId).pendingHostKey
    if (pending === null) {
      return
    }
    replaceConfirm = false
    const result = await window.api.ssh.confirmHostKey(pending.sessionId, 'abort')
    setSession(profileId, applyConnectResult(sessionOf(profileId), result))
    await refreshSelectedTrust()
  }

  function requestReplace(profileId: string): void {
    const pending = sessionOf(profileId).pendingHostKey
    if (pending === null || pending.kind !== 'changed') {
      return
    }
    replaceConfirm = true
  }

  async function confirmForget(): Promise<void> {
    if (selected === null) {
      return
    }
    forgetConfirm = false
    await window.api.ssh.forgetHostKey(selected.host, selected.port)
    await refreshHostTrust(selected.host, selected.port)
  }

  async function disconnectProfile(profileId: string): Promise<void> {
    const current = sessionOf(profileId)
    if (current.sessionId === null) {
      return
    }
    const sessionId = current.sessionId
    setSession(profileId, beginDisconnect(current))
    registry.setWritable(profileId, null)
    await window.api.ssh.disconnect(sessionId)
    if (sessionOf(profileId).state === 'disconnecting') {
      setSession(profileId, applySessionStatus(sessionOf(profileId), { sessionId, type: 'closed' }))
    }
    await refreshSelectedTrust()
  }

  function clearProfileTerminal(profileId: string): void {
    transcripts[profileId] = clearTranscript()
    registry.clear(profileId)
  }

  async function saveEdit(saveAnyway = false): Promise<void> {
    if (selected === null) {
      return
    }
    const base = draftInput(saveAnyway)
    const input: UpdateProfileInput = { ...base, profileId: selected.id }
    const parsed = parseProfileDraft(input)
    if (!parsed.ok) {
      fields = parsed.fields
      return
    }
    fields = {}
    busy = true
    try {
      const result = await window.api.profiles.update(input)
      workspace = result.workspace
      if (result.ok) {
        resetDraft()
        pane = 'profile'
        return
      }
      if (result.reason === 'duplicate') {
        duplicateLabel = result.existingLabel
        return
      }
      if (result.reason === 'invalid') {
        fields = result.fields
      }
    } finally {
      busy = false
    }
  }

  function requestDelete(): void {
    if (selected === null) {
      return
    }
    deleteConfirm = {
      profileId: selected.id,
      label: selected.label,
      occupied: connectionFieldsLocked(sessionOf(selected.id).state)
    }
  }

  async function confirmDelete(): Promise<void> {
    const pending = deleteConfirm
    deleteConfirm = null
    if (pending === null) {
      return
    }
    busy = true
    try {
      const result = await window.api.profiles.delete(pending.profileId)
      workspace = result.workspace
      if (result.ok) {
        forgetDeletedProfile(pending.profileId)
        resetDraft()
        pane = result.workspace.selectedProfileId === null ? 'empty' : 'profile'
      }
    } finally {
      busy = false
    }
  }

  async function replaceMissingKey(profileId: string): Promise<void> {
    const result = await window.api.profiles.replacePrivateKey(profileId)
    workspace = result.workspace
    if (!result.ok) {
      return
    }
    setSession(profileId, {
      ...sessionOf(profileId),
      missingPrivateKey: false,
      error: null
    })
    await requestConnect(profileId)
  }

  function dismissMissingKey(profileId: string): void {
    const current = sessionOf(profileId)
    setSession(profileId, {
      ...emptyProfileSession(),
      lastOutcome: current.lastOutcome
    })
  }

  async function save(saveAnyway = false): Promise<void> {
    if (pane === 'edit') {
      await saveEdit(saveAnyway)
      return
    }
    const input = draftInput(saveAnyway)
    const parsed = parseProfileDraft(input)
    if (!parsed.ok) {
      fields = parsed.fields
      return
    }
    fields = {}
    busy = true
    try {
      const result = await window.api.profiles.create(input)
      if (result.ok) {
        workspace = result.workspace
        resetDraft()
        pane = 'profile'
        const created = result.workspace.profiles.find(
          (profile) => profile.id === result.workspace.selectedProfileId
        )
        if (created !== undefined) {
          await refreshHostTrust(created.host, created.port)
        }
        return
      }
      workspace = result.workspace
      if (result.reason === 'duplicate') {
        duplicateLabel = result.existingLabel
        return
      }
      if (result.reason === 'invalid') {
        fields = result.fields
      }
    } finally {
      busy = false
    }
  }

  async function pickKey(): Promise<void> {
    const picked = await window.api.profiles.pickPrivateKey()
    if (picked === null) {
      return
    }
    keyRef = picked.keyRef
    keyLabel = picked.label
    draft.authMethod = 'privateKey'
  }

  function requestCancel(): void {
    if (dirtyForm) {
      discard = { kind: 'cancel' }
      return
    }
    leaveForm()
  }

  function leaveForm(): void {
    resetDraft()
    const selectedId = workspace.selectedProfileId
    pane = selectedId === null ? 'empty' : 'profile'
    if (selectedId !== null && deferredTerminal[selectedId] === true) {
      tabs[selectedId] = tabWhenSelectingProfile(tabs[selectedId], true)
      deferredTerminal[selectedId] = false
    }
  }

  function confirmDiscard(): void {
    const intent = discard
    discard = null
    if (intent?.kind === 'close') {
      leaveForm()
      void window.api.workspace.confirmClose()
      return
    }
    leaveForm()
    if (intent?.kind === 'select') {
      void selectProfile(intent.profileId)
    }
    if (intent?.kind === 'create') {
      beginCreate()
    }
  }

  onMount(() => {
    void window.api.profiles.load().then(async (loaded) => {
      workspace = loaded
      pane = loaded.selectedProfileId === null ? 'empty' : 'profile'
      const profile = loaded.profiles.find((item) => item.id === loaded.selectedProfileId)
      if (profile !== undefined) {
        await refreshHostTrust(profile.host, profile.port)
      }
    })
    const stopData = window.api.ssh.onData((sessionId, chunk, profileId) => {
      const id = profileId.length > 0 ? profileId : profileIdForSession(sessionId)
      if (id === undefined || !workspace.profiles.some((profile) => profile.id === id)) {
        return
      }
      transcripts[id] = appendRemote(transcripts[id] ?? [], chunk)
      registry.writeRemote(id, chunk)
    })
    const stopStatus = window.api.ssh.onStatus((event) => {
      const profileId =
        event.profileId !== undefined && event.profileId.length > 0
          ? event.profileId
          : profileIdForSession(event.sessionId)
      if (
        profileId === undefined ||
        !workspace.profiles.some((profile) => profile.id === profileId)
      ) {
        return
      }
      const previous = sessionOf(profileId)
      const next = applySessionStatus(previous, event)
      setSession(profileId, next)
      if (event.type === 'closed' || event.type === 'error') {
        registry.setWritable(profileId, null)
        transcripts[profileId] = endSession(
          transcripts[profileId] ?? [],
          event.type === 'error' ? 'error' : 'closed'
        )
        const ended = transcripts[profileId][transcripts[profileId].length - 1]
        if (ended !== undefined && ended.source === 'local' && ended.kind === 'ended') {
          registry.writeLocal(profileId, ended.message)
        }
        void refreshSelectedTrust()
      }
    })
    const stopClose = window.api.workspace.onCloseRequested(() => {
      if (dirtyForm) {
        discard = { kind: 'close' }
        return
      }
      void window.api.workspace.confirmClose()
    })
    return () => {
      stopData()
      stopStatus()
      stopClose()
      registry.dispose()
    }
  })
</script>

<div class="app">
  <ProfileSidebar
    profiles={workspace.profiles}
    selectedProfileId={workspace.selectedProfileId}
    creating={pane === 'create'}
    {sessions}
    onCreate={beginCreate}
    onSelect={(profileId) => void selectProfile(profileId)}
  />

  <main>
    {#if workspace.notice?.kind === 'recovered-from-backup'}
      <p class="notice" role="status">
        The profile store was unreadable and was restored from the last-valid backup. Recent changes
        may be missing.
      </p>
    {/if}
    {#if workspace.notice?.kind === 'write-failed'}
      <p class="notice" role="alert">
        The profile could not be saved. {workspace.notice.message} The last saved workspace is unchanged.
      </p>
    {/if}

    {#if pane === 'empty'}
      <section class="empty">
        <h1>Connection Profiles</h1>
        <p>
          A Connection Profile saves an SSH destination and its login preferences so you do not
          re-enter them. Profiles stay on this computer; passwords and key passphrases are never
          stored.
        </p>
        <button type="button" onclick={beginCreate}>Create Connection Profile</button>
      </section>
    {/if}

    {#if pane === 'create' || pane === 'edit'}
      <ProfileCreateForm
        bind:draft
        title={pane === 'edit' ? 'Edit Connection Profile' : 'Create Connection Profile'}
        {keyLabel}
        {fields}
        {busy}
        connectionLocked={pane === 'edit' && connectionLocked}
        onPickKey={() => void pickKey()}
        onSave={() => void save()}
        onCancel={requestCancel}
      />
    {/if}

    {#if selected !== null}
      <div class="workspace-hold" class:hidden={pane !== 'profile'}>
        <ProfileWorkspaceView
          profile={selected}
          tab={selectedTab}
          session={selectedSession}
          transcript={selectedTranscript}
          {terminalIds}
          {registry}
          {hostTrust}
          onTab={chooseTab}
          onConnect={() => void requestConnect(selected.id)}
          onDisconnect={() => void disconnectProfile(selected.id)}
          onClearTerminal={() => clearProfileTerminal(selected.id)}
          onEdit={beginEdit}
          onDelete={requestDelete}
          onForgetHostKey={() => {
            forgetConfirm = true
          }}
        />
      </div>
    {/if}
  </main>
</div>

{#if selected !== null && selectedSession.secretPrompt !== null}
  <SecretPrompt
    title={selectedSession.secretPrompt.kind === 'password'
      ? `Password for ${selected.label}`
      : `Passphrase for ${selected.label}`}
    confirmLabel="Connect"
    message={selectedSession.secretPrompt.message}
    onConfirm={(secret) => void submitAuthSecret(selected.id, secret)}
    onCancel={() => cancelAuthSecret(selected.id)}
  />
{/if}

{#if selected !== null && selectedSession.pendingHostKey !== null && selectedSession.pendingHostKey.kind === 'unknown'}
  {@const prompt = unknownHostPrompt(
    formatTrustDestination(selected.host, selected.port),
    selectedSession.pendingHostKey
  )}
  <AppDialog
    title="Unknown host"
    confirmLabel={HOST_TRUST_ACTION_LABEL.trustAlways}
    extraLabel={HOST_TRUST_ACTION_LABEL.trustOnce}
    onConfirm={() => void decideHost(selected.id, 'trust-always')}
    onExtra={() => void decideHost(selected.id, 'trust-once')}
    onCancel={() => void abortHost(selected.id)}
  >
    <p>Destination {prompt.destination}</p>
    <p>Algorithm {prompt.algorithm}</p>
    <p>Fingerprint</p>
    <p class="fingerprint">{prompt.fingerprint}</p>
  </AppDialog>
{/if}

{#if selected !== null && selectedSession.pendingHostKey !== null && selectedSession.pendingHostKey.kind === 'changed' && !replaceConfirm}
  {@const prompt = changedHostPrompt(
    formatTrustDestination(selected.host, selected.port),
    selectedSession.pendingHostKey
  )}
  <AppDialog
    title="Host key changed"
    confirmLabel={HOST_TRUST_ACTION_LABEL.replace}
    onConfirm={() => requestReplace(selected.id)}
    onCancel={() => void abortHost(selected.id)}
  >
    <p>Destination {prompt.destination}</p>
    <p>Remembered algorithm {prompt.previousAlgorithm}</p>
    <p>Remembered fingerprint</p>
    <p class="fingerprint">{prompt.previousFingerprint}</p>
    <p>New algorithm {prompt.algorithm}</p>
    <p>New fingerprint</p>
    <p class="fingerprint">{prompt.fingerprint}</p>
  </AppDialog>
{/if}

{#if selected !== null && selectedSession.pendingHostKey !== null && selectedSession.pendingHostKey.kind === 'changed' && replaceConfirm}
  {@const prompt = requestReplaceConfirm(
    changedHostPrompt(
      formatTrustDestination(selected.host, selected.port),
      selectedSession.pendingHostKey
    )
  )}
  <AppDialog
    title="Replace trusted host key?"
    confirmLabel={HOST_TRUST_ACTION_LABEL.replace}
    onConfirm={() => void decideHost(selected.id, 'replace')}
    onCancel={() => {
      replaceConfirm = false
    }}
  >
    <p>{replaceConfirmCopy(prompt.destination)}</p>
  </AppDialog>
{/if}

{#if forgetConfirm && selected !== null && selectedSession.pendingHostKey === null}
  <AppDialog
    title="Forget trusted host key?"
    confirmLabel={HOST_TRUST_ACTION_LABEL.forget}
    onConfirm={() => void confirmForget()}
    onCancel={() => {
      forgetConfirm = false
    }}
  >
    <p>{forgetConfirmCopy(formatTrustDestination(selected.host, selected.port))}</p>
  </AppDialog>
{/if}

{#if duplicateLabel !== null}
  <AppDialog
    title="A Connection Profile with this configuration already exists"
    confirmLabel="Save Anyway"
    onConfirm={() => {
      duplicateLabel = null
      void save(true)
    }}
    onCancel={() => {
      duplicateLabel = null
    }}
  >
    <p>
      “{duplicateLabel}” already uses this host, port, username, and Authentication Method.
      {#if pane === 'edit'}
        Saving anyway keeps this profile with that configuration.
      {:else}
        Saving anyway creates a new profile with configuration only.
      {/if}
    </p>
  </AppDialog>
{/if}

{#if discard !== null}
  <AppDialog
    title={pane === 'edit' ? 'Discard unsaved edits?' : 'Discard this unsaved Connection Profile?'}
    confirmLabel="Discard"
    onConfirm={confirmDiscard}
    onCancel={() => {
      discard = null
    }}
  >
    {#if pane === 'edit'}
      <p>Navigating away or closing will not keep these edits.</p>
    {:else}
      <p>Navigating away or closing will not keep this profile.</p>
    {/if}
  </AppDialog>
{/if}

{#if deleteConfirm !== null}
  {@const confirmation = deleteProfileConfirmation(deleteConfirm.label, deleteConfirm.occupied)}
  <AppDialog
    title={confirmation.title}
    confirmLabel={confirmation.confirmLabel}
    onConfirm={() => void confirmDelete()}
    onCancel={() => {
      deleteConfirm = null
    }}
  >
    <p>{confirmation.body}</p>
  </AppDialog>
{/if}

{#if selected !== null && selectedSession.missingPrivateKey}
  <AppDialog
    title="Private-key file missing"
    confirmLabel="Replace private-key file"
    onConfirm={() => void replaceMissingKey(selected.id)}
    onCancel={() => dismissMissingKey(selected.id)}
  >
    <p>{selectedSession.error}</p>
  </AppDialog>
{/if}

<style>
  .app {
    display: grid;
    grid-template-columns: 18rem minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }

  main {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }

  .workspace-hold {
    flex: 1;
    min-height: 0;
    min-width: 0;
  }

  .workspace-hold.hidden {
    display: none;
  }

  .empty {
    display: grid;
    align-content: start;
    gap: 12px;
    max-width: 36rem;
    padding: 24px;
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 600;
  }

  .notice {
    border: 1px solid #111;
    padding: 10px 12px;
    background: #f3f3f3;
    margin: 16px 24px 0;
  }

  button {
    font: inherit;
    padding: 8px 10px;
    justify-self: start;
  }

  .fingerprint {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    word-break: break-all;
  }
</style>

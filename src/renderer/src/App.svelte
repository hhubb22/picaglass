<script lang="ts">
  import { onMount, tick } from 'svelte'
  import {
    adjacentProfileId,
    deleteProfileConfirmation,
    draftFromProfile,
    filterProfiles,
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
    activeSessionCount,
    applyConnectResult,
    applyMissingPrivateKey,
    applySessionStatus,
    beginDisconnect,
    canCancelAttempt,
    canDisconnectSession,
    cancelSecretPrompt,
    connectionFieldsLocked,
    disconnectAllConfirmation,
    disconnectProfileConfirmation,
    dismissSessionFailure,
    emptyProfileSession,
    markAttemptFailureViewed,
    promptForSecret,
    submitSecret,
    windowCloseConfirmation,
    withAttemptFailure,
    workspaceLiveAnnouncement,
    type ProfileSessionUi,
    type SessionConfirmation
  } from '../../shared/ssh-session-ui'
  import { ATTEMPT_OUTCOME_LABEL } from '../../shared/connection-attempt'
  import type { HostTrustState, SshConnectResult, SshHostKeyAction } from '../../shared/ssh'
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
  import {
    matchWorkspaceShortcut,
    shortcutPlatformFrom,
    type ShortcutEvent
  } from '../../shared/workspace-shortcuts'
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
    sidebarCollapsed: false,
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
    null | { kind: 'cancel' } | { kind: 'select'; profileId: string } | { kind: 'create' }
  >(null)
  let deleteConfirm = $state<null | { profileId: string; label: string; occupied: boolean }>(null)
  let disconnectConfirm = $state<string | null>(null)
  let disconnectAllPrompt = $state<SessionConfirmation | null>(null)
  let closePrompt = $state<SessionConfirmation | null>(null)
  let sessions = $state<Record<string, ProfileSessionUi>>({})
  let tabs = $state<Record<string, WorkspaceTab>>({})
  let deferredTerminal = $state<Record<string, boolean>>({})
  let transcripts = $state<Record<string, TranscriptEntry[]>>({})
  let terminalIds = $state<string[]>([])
  let hostTrust = $state<HostTrustState>({ status: 'not-remembered' })
  let replaceConfirm = $state(false)
  let forgetConfirm = $state(false)
  let searchQuery = $state('')
  let liveAnnouncement = $state('')
  let sidebar = $state<{ focusSearch: () => void } | null>(null)

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
  const liveCount = $derived(activeSessionCount(sessions))
  const unsavedKind = $derived(
    dirtyEdit ? ('edit' as const) : dirtyCreation ? ('create' as const) : null
  )
  const connectionLocked = $derived(connectionFieldsLocked(selectedSession.state))
  const selectedTab = $derived(
    selected === null ? defaultTab() : (tabs[selected.id] ?? defaultTab())
  )
  const selectedTranscript = $derived(selected === null ? [] : (transcripts[selected.id] ?? []))
  const visibleProfiles = $derived(filterProfiles(workspace.profiles, searchQuery))

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
    void window.api.workspace.setCloseGuard(dirtyForm || liveCount > 0)
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

  function isOnScreen(profileId: string): boolean {
    // The failure banner lives on Overview. Terminal of the same profile has not viewed it.
    return (
      pane === 'profile' &&
      workspace.selectedProfileId === profileId &&
      (tabs[profileId] ?? defaultTab()) === 'overview'
    )
  }

  function applySessionUi(
    profileId: string,
    next: ProfileSessionUi,
    detail: string | null = next.error
  ): void {
    const previous = sessionOf(profileId)
    const applied = withAttemptFailure(next, isOnScreen(profileId), detail)
    setSession(profileId, applied)
    const label = workspace.profiles.find((profile) => profile.id === profileId)?.label ?? ''
    const text = workspaceLiveAnnouncement({
      label,
      previousState: previous.state,
      nextState: applied.state,
      becameUnseenFailure: applied.unseenFailure && !previous.unseenFailure,
      failureOutcome: applied.lastOutcome
    })
    if (text !== null) {
      liveAnnouncement = text
    }
  }

  function connectFailureDetail(result: SshConnectResult, next: ProfileSessionUi): string | null {
    return !result.ok && 'message' in result ? result.message : next.error
  }

  async function refreshAttempts(): Promise<void> {
    workspace = await window.api.profiles.load()
  }

  function dismissFailure(profileId: string): void {
    setSession(profileId, dismissSessionFailure(sessionOf(profileId)))
  }

  function viewFailureIfOverview(profileId: string): void {
    if (!isOnScreen(profileId)) {
      return
    }
    const current = sessionOf(profileId)
    if (!current.unseenFailure) {
      return
    }
    setSession(profileId, markAttemptFailureViewed(current))
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
        viewFailureIfOverview(profileId)
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
    if (tab === 'overview') {
      viewFailureIfOverview(selected.id)
    }
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
    applySessionUi(profileId, {
      ...sessionOf(profileId),
      state: 'connecting',
      secretPrompt: null,
      error: null
    })
    ensureTerminalId(profileId)
    await tick()
    const nextTranscript = beginAttempt(
      transcripts[profileId] ?? [],
      new Date(),
      previous === null ? null : ATTEMPT_OUTCOME_LABEL[previous]
    )
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
    applySessionUi(profileId, next, connectFailureDetail(result, next))
    await refreshAttempts()
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
    applySessionUi(profileId, next, connectFailureDetail(result, next))
    await refreshAttempts()
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
    const next = applyConnectResult(sessionOf(profileId), result)
    applySessionUi(profileId, next, connectFailureDetail(result, next))
    await refreshAttempts()
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
      applySessionUi(
        profileId,
        applySessionStatus(sessionOf(profileId), { sessionId, type: 'closed' })
      )
    }
    await refreshAttempts()
    await refreshSelectedTrust()
  }

  function requestDisconnect(profileId: string): void {
    if (!canDisconnectSession(sessionOf(profileId).state)) {
      return
    }
    disconnectConfirm = profileId
  }

  async function confirmDisconnect(): Promise<void> {
    const profileId = disconnectConfirm
    disconnectConfirm = null
    if (profileId === null) {
      return
    }
    await disconnectProfile(profileId)
  }

  function requestDisconnectAll(): void {
    disconnectAllPrompt = disconnectAllConfirmation(liveCount)
  }

  async function confirmDisconnectAll(): Promise<void> {
    disconnectAllPrompt = null
    const snapshot = { ...sessions }
    for (const [profileId, ui] of Object.entries(snapshot)) {
      if (ui.state === 'connected' && ui.sessionId !== null) {
        setSession(profileId, beginDisconnect(ui))
        registry.setWritable(profileId, null)
      }
    }
    await window.api.ssh.disconnectAll()
    for (const [profileId, ui] of Object.entries(sessions)) {
      if (canCancelAttempt(ui.state)) {
        applySessionUi(
          profileId,
          applyConnectResult(ui, { ok: false, reason: 'canceled', message: 'canceled' })
        )
      } else if (ui.state === 'disconnecting' && ui.sessionId !== null) {
        applySessionUi(
          profileId,
          applySessionStatus(ui, { sessionId: ui.sessionId, type: 'closed' })
        )
      }
    }
    await refreshAttempts()
    await refreshSelectedTrust()
  }

  async function cancelPending(profileId: string): Promise<void> {
    const current = sessionOf(profileId)
    if (!canCancelAttempt(current.state)) {
      return
    }
    await window.api.ssh.cancel(profileId)
    const next = sessionOf(profileId)
    if (canCancelAttempt(next.state)) {
      applySessionUi(
        profileId,
        applyConnectResult(next, { ok: false, reason: 'canceled', message: 'canceled' })
      )
      await refreshAttempts()
      await refreshSelectedTrust()
    }
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
        viewFailureIfOverview(selected.id)
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
    if (selectedId !== null) {
      viewFailureIfOverview(selectedId)
    }
    if (selectedId !== null && deferredTerminal[selectedId] === true) {
      tabs[selectedId] = tabWhenSelectingProfile(tabs[selectedId], true)
      deferredTerminal[selectedId] = false
    }
  }

  function confirmDiscard(): void {
    const intent = discard
    discard = null
    leaveForm()
    if (intent?.kind === 'select') {
      void selectProfile(intent.profileId)
    }
    if (intent?.kind === 'create') {
      beginCreate()
    }
  }

  function confirmClosePrompt(): void {
    closePrompt = null
    if (dirtyForm) {
      leaveForm()
    }
    void window.api.workspace.confirmClose()
  }

  function dialogIsOpen(): boolean {
    return (
      duplicateLabel !== null ||
      discard !== null ||
      deleteConfirm !== null ||
      disconnectConfirm !== null ||
      disconnectAllPrompt !== null ||
      closePrompt !== null ||
      forgetConfirm ||
      replaceConfirm ||
      (selected !== null && selectedSession.secretPrompt !== null) ||
      (selected !== null && selectedSession.pendingHostKey !== null) ||
      (selected !== null && selectedSession.missingPrivateKey)
    )
  }

  async function toggleSidebar(): Promise<void> {
    const result = await window.api.profiles.setSidebarCollapsed(!workspace.sidebarCollapsed)
    workspace = result.workspace
  }

  async function revealAndFocusSearch(): Promise<void> {
    if (workspace.sidebarCollapsed) {
      const result = await window.api.profiles.setSidebarCollapsed(false)
      workspace = result.workspace
      await tick()
    }
    sidebar?.focusSearch()
  }

  function onWorkspaceKeydown(event: KeyboardEvent): void {
    if (dialogIsOpen()) {
      return
    }
    const shortcutEvent: ShortcutEvent = {
      key: event.key,
      code: event.code,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      isComposing: event.isComposing
    }
    const action = matchWorkspaceShortcut(shortcutEvent, shortcutPlatformFrom(navigator.platform))
    if (action === null) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (action === 'search') {
      void revealAndFocusSearch()
      return
    }
    if (action === 'toggle-sidebar') {
      void toggleSidebar()
      return
    }
    if (action === 'overview' && pane === 'profile') {
      chooseTab('overview')
      return
    }
    if (action === 'terminal' && pane === 'profile') {
      chooseTab('terminal')
      return
    }
    if (action === 'previous-profile' || action === 'next-profile') {
      const nextId = adjacentProfileId(
        visibleProfiles,
        workspace.selectedProfileId,
        action === 'previous-profile' ? 'previous' : 'next'
      )
      if (nextId !== null) {
        void selectProfile(nextId)
      }
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
      const detail = event.type === 'error' ? (event.message ?? next.error) : next.error
      applySessionUi(profileId, next, detail)
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
        void refreshAttempts()
        void refreshSelectedTrust()
      }
    })
    const stopSnapshot = window.api.ssh.onSnapshot((event) => {
      if (!workspace.profiles.some((profile) => profile.id === event.profileId)) {
        return
      }
      workspace = {
        ...workspace,
        profiles: workspace.profiles.map((profile) =>
          profile.id === event.profileId ? { ...profile, snapshot: event.snapshot } : profile
        )
      }
    })
    const stopClose = window.api.workspace.onCloseRequested((info) => {
      const confirmation = windowCloseConfirmation({
        unsaved: unsavedKind,
        activeCount: Math.max(liveCount, info.activeCount)
      })
      if (confirmation === null) {
        void window.api.workspace.confirmClose()
        return
      }
      closePrompt = confirmation
    })
    window.addEventListener('keydown', onWorkspaceKeydown, true)
    return () => {
      stopData()
      stopStatus()
      stopSnapshot()
      stopClose()
      window.removeEventListener('keydown', onWorkspaceKeydown, true)
      registry.dispose()
    }
  })
</script>

<div class="app" class:collapsed={workspace.sidebarCollapsed}>
  <ProfileSidebar
    bind:this={sidebar}
    profiles={visibleProfiles}
    selectedProfileId={workspace.selectedProfileId}
    creating={pane === 'create'}
    {sessions}
    collapsed={workspace.sidebarCollapsed}
    bind:searchQuery
    onCreate={beginCreate}
    onSelect={(profileId) => void selectProfile(profileId)}
    onDisconnectAll={requestDisconnectAll}
    onToggleCollapsed={() => void toggleSidebar()}
  />

  <main>
    <p class="visually-hidden" aria-live="polite" aria-atomic="true">{liveAnnouncement}</p>
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
          onCancel={() => void cancelPending(selected.id)}
          onDisconnect={() => requestDisconnect(selected.id)}
          onClearTerminal={() => clearProfileTerminal(selected.id)}
          onEdit={beginEdit}
          onDelete={requestDelete}
          onForgetHostKey={() => {
            forgetConfirm = true
          }}
          onDismissFailure={() => dismissFailure(selected.id)}
          onRefreshSnapshot={() => void window.api.ssh.refreshDiscovery(selected.id)}
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

{#if closePrompt !== null}
  <AppDialog
    title={closePrompt.title}
    confirmLabel={closePrompt.confirmLabel}
    onConfirm={confirmClosePrompt}
    onCancel={() => {
      closePrompt = null
    }}
  >
    <p>{closePrompt.body}</p>
  </AppDialog>
{/if}

{#if disconnectConfirm !== null}
  {@const profile = workspace.profiles.find((item) => item.id === disconnectConfirm)}
  {#if profile !== undefined}
    {@const confirmation = disconnectProfileConfirmation(profile.label)}
    <AppDialog
      title={confirmation.title}
      confirmLabel={confirmation.confirmLabel}
      onConfirm={() => void confirmDisconnect()}
      onCancel={() => {
        disconnectConfirm = null
      }}
    >
      <p>{confirmation.body}</p>
    </AppDialog>
  {/if}
{/if}

{#if disconnectAllPrompt !== null}
  <AppDialog
    title={disconnectAllPrompt.title}
    confirmLabel={disconnectAllPrompt.confirmLabel}
    onConfirm={() => void confirmDisconnectAll()}
    onCancel={() => {
      disconnectAllPrompt = null
    }}
  >
    <p>{disconnectAllPrompt.body}</p>
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
    background: var(--bg);
    color: var(--fg);
    transition: grid-template-columns var(--motion);
  }

  .app.collapsed {
    grid-template-columns: auto minmax(0, 1fr);
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
    border: 1px solid var(--fg);
    padding: 10px 12px;
    background: var(--hover);
    margin: 16px 24px 0;
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

  .fingerprint {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    word-break: break-all;
  }
</style>

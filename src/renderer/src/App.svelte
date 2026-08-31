<script lang="ts">
  import { onMount } from 'svelte'
  import {
    isProfileDraftDirty,
    parseProfileDraft,
    type CreateProfileInput,
    type ProfileDraftForm,
    type ProfileFieldErrors,
    type ProfileWorkspace
  } from '../../shared/profile'
  import AppDialog from './AppDialog.svelte'
  import ProfileCreateForm from './ProfileCreateForm.svelte'
  import ProfileSidebar from './ProfileSidebar.svelte'
  import ProfileSummary from './ProfileSummary.svelte'

  let workspace = $state<ProfileWorkspace>({
    profiles: [],
    selectedProfileId: null,
    notice: null
  })
  let pane = $state<'empty' | 'create' | 'profile'>('empty')
  let draft = $state(emptyDraft())
  let keyRef = $state<string | null>(null)
  let keyLabel = $state<string | null>(null)
  let fields = $state<ProfileFieldErrors>({})
  let busy = $state(false)
  let duplicateLabel = $state<string | null>(null)
  let discard = $state<
    null | { kind: 'cancel' } | { kind: 'select'; profileId: string } | { kind: 'close' }
  >(null)

  const selected = $derived(
    workspace.profiles.find((profile) => profile.id === workspace.selectedProfileId) ?? null
  )
  const dirtyCreation = $derived(pane === 'create' && isProfileDraftDirty(draft))

  $effect(() => {
    void window.api.workspace.setCloseGuard(dirtyCreation)
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
            ? { method: 'privateKey', keyRef: keyRef ?? '' }
            : { method: undefined },
      automaticDiscovery: draft.automaticDiscovery
    }
    if (saveAnyway) {
      input.saveAnyway = true
    }
    return input
  }

  function beginCreate(): void {
    if (pane === 'create' && isProfileDraftDirty(draft)) {
      return
    }
    resetDraft()
    pane = 'create'
  }

  async function selectProfile(profileId: string): Promise<void> {
    if (pane === 'create' && isProfileDraftDirty(draft)) {
      discard = { kind: 'select', profileId }
      return
    }
    busy = true
    try {
      const result = await window.api.profiles.select(profileId)
      workspace = result.workspace
      pane = result.ok ? 'profile' : pane
    } finally {
      busy = false
    }
  }

  async function save(saveAnyway = false): Promise<void> {
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
    if (isProfileDraftDirty(draft)) {
      discard = { kind: 'cancel' }
      return
    }
    leaveCreate()
  }

  function leaveCreate(): void {
    resetDraft()
    pane = workspace.selectedProfileId === null ? 'empty' : 'profile'
  }

  function confirmDiscard(): void {
    const intent = discard
    discard = null
    if (intent?.kind === 'close') {
      leaveCreate()
      void window.api.workspace.confirmClose()
      return
    }
    leaveCreate()
    if (intent?.kind === 'select') {
      void selectProfile(intent.profileId)
    }
  }

  onMount(() => {
    void window.api.profiles.load().then((loaded) => {
      workspace = loaded
      pane = loaded.selectedProfileId === null ? 'empty' : 'profile'
    })
    return window.api.workspace.onCloseRequested(() => {
      if (pane === 'create' && isProfileDraftDirty(draft)) {
        discard = { kind: 'close' }
        return
      }
      void window.api.workspace.confirmClose()
    })
  })
</script>

<div class="app">
  <ProfileSidebar
    profiles={workspace.profiles}
    selectedProfileId={workspace.selectedProfileId}
    creating={pane === 'create'}
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
    {:else if pane === 'create'}
      <ProfileCreateForm
        bind:draft
        {keyLabel}
        {fields}
        {busy}
        onPickKey={() => void pickKey()}
        onSave={() => void save()}
        onCancel={requestCancel}
      />
    {:else if selected !== null}
      <ProfileSummary profile={selected} />
    {/if}
  </main>
</div>

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
      “{duplicateLabel}” already uses this host, port, username, and Authentication Method. Saving
      anyway creates a new profile with configuration only.
    </p>
  </AppDialog>
{/if}

{#if discard !== null}
  <AppDialog
    title="Discard this unsaved Connection Profile?"
    confirmLabel="Discard"
    onConfirm={confirmDiscard}
    onCancel={() => {
      discard = null
    }}
  >
    <p>Navigating away or closing will not keep this profile.</p>
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
    display: grid;
    align-content: start;
    gap: 16px;
    padding: 24px;
    overflow: auto;
  }

  .empty {
    display: grid;
    gap: 12px;
    max-width: 36rem;
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 600;
  }

  .notice {
    border: 1px solid #111;
    padding: 10px 12px;
    background: #f3f3f3;
  }

  button {
    font: inherit;
    padding: 8px 10px;
    justify-self: start;
  }
</style>

# Saved Connection Profile Workspaces

## Status

Proposed, awaiting implementation approval.

## Goal

Turn Picaglass from a one-off SSH form into a local desktop workspace for an individual operator. Every SSH Session originates from an explicitly saved Connection Profile. The reference products guide the page hierarchy: identity and primary actions on the left, scannable operational cards on the right.

The canonical language lives in [`CONTEXT.md`](../../CONTEXT.md).

## Non-goals

- Team accounts, ownership, sharing, policy, or a backend service
- Ad hoc or Quick Connect sessions
- `~/.ssh/config` synchronization, import, or export
- Password, passphrase, or terminal-transcript persistence
- Multiple sessions per profile, detached windows, or restored sessions
- Endpoint reachability monitoring, automatic reconnect, or OS notifications
- Windows machine discovery, remote telemetry agents, or discovery history
- Tags, groups, descriptions, custom icons, proxy jumps, or advanced SSH tuning

## Connection Profile

A profile has a stable UUID and these user-editable fields:

- optional display name
- host
- port, defaulting to `22`
- username
- exactly one Authentication Method:
  - password, with no stored password
  - private-key file, with a main-process-owned full path and renderer-safe label
- automatic discovery toggle, enabled by default

Username and Authentication Method have no creation defaults. The Profile Label is the display name when present, otherwise `username@host`, including `:port` only for a non-default port. IPv6 destinations use unambiguous bracket formatting.

Profiles are ordered alphabetically by Profile Label. Search filters label, username, and destination and is focused with the application search shortcut.

Exact duplicates are allowed only after a warning names the existing profile and the operator chooses **Save Anyway**. A duplicate receives configuration only, never a snapshot, attempt summary, transcript, or session.

## Persistence

The Electron main process owns a schema-versioned JSON document in `userData`. It contains profiles, latest Machine Snapshots, latest Connection Attempt summaries, last-selected profile ID, and sidebar collapsed state.

- Write a temporary file, flush it, preserve one last-valid backup, and atomically replace the primary document.
- Apply restrictive operating-system permissions to the storage directory and files.
- Store no Authentication Secret or Terminal Transcript.
- Never send a full private-key path to the renderer.
- On unreadable primary storage, restore the last-valid backup and show a persistent recovery warning.
- If a write fails, keep the last durable state, reject the proposed mutation, and show a persistent error. Never present optimistic state as saved.
- On launch, finalize any attempt that connected but has no end as **Interrupted by previous app exit**, using recovery time as the end time.

See [ADR 0003](../adr/0003-own-profile-persistence-in-the-main-process.md).

## Navigation and layout

Picaglass has one main window, initially about 1180×760 and usable down to 800×600.

### Profile sidebar

The persistent sidebar contains:

- Picaglass identity and collapse control
- search
- alphabetical profile list
- per-profile icon, Profile Label, textual state, and semantic state indicator
- create-profile action
- menu containing **Disconnect All**

Collapsed state persists. Collapsing hides the sidebar completely and leaves a reveal control. At narrower widths the Overview columns stack; the terminal keeps the available main-pane width.

On first launch, the main pane explains Connection Profiles and offers **Create Connection Profile**. On later launches, select the last-selected profile if it still exists, otherwise the first alphabetical profile.

Deleting the selected profile selects the next alphabetical profile, then the previous profile, then the empty state.

### Profile workspace

Every selected profile has stable **Overview** and **Terminal** tabs. Each profile remembers its selected tab only for the current app run; every relaunch starts on Overview.

Overview uses two columns:

1. Summary rail: generic terminal/server glyph, semantic status badge, Profile Label, current session status, Connect/Cancel/Disconnect action, Edit, and overflow actions.
2. Detail cards:
   - **Session**: current state and destination/login/authentication summary
   - **Machine Snapshot**: last observed POSIX facts and refresh state
   - **Host Trust**: remembered or session-only algorithm and fingerprint
   - **Last Attempt**: start, connected, and end times plus stable outcome

Terminal is always visible as a tab. When disconnected it shows a Connect empty state.

If a foreground Connect succeeds, select Terminal and focus it. If the operator navigated elsewhere while connection was pending, do not steal selection or focus; mark the profile connected in the sidebar and select its Terminal when they return.

## Create, edit, and delete

Creation and editing use an explicit form with **Save** and **Cancel**, never auto-save.

- Dirty creation is not retained. Navigating away or closing asks whether to discard it.
- Connection and authentication fields are locked while the profile has a live or pending session. Display name and discovery toggle remain editable.
- Changing host or port clears Machine Snapshot and Last Attempt, then resolves Host Trust for the new endpoint.
- Changing username, Authentication Method, or key path keeps Machine Snapshot but clears Last Attempt.
- A missing private-key file blocks Connect and offers a native replacement picker. Saving the replacement path and continuing is one explicit action.
- Deleting a disconnected profile requires confirmation naming its Profile Label.
- Deleting a connected profile requires confirmation of the combined disconnect-and-delete action.
- Deleting a profile never removes shared Host Trust.

Invalid fields are shown inline and do not create or replace a Connection Attempt.

## Session lifecycle

The main process owns a profile-keyed session manager. Each profile has at most one pending or live SSH Session; different profiles may connect concurrently without an application-level cap. There is no automatic reconnect.

Visible current states are:

- No active session
- Connecting
- Verification required
- Connected
- Disconnecting

A failed attempt returns to **No active session**, shows a dismissible failure banner, and updates Last Attempt. An off-screen failure also shows a red, textual/icon sidebar badge until the banner is viewed or dismissed.

While an attempt is pending, **Cancel** is available. Profile switching does not cancel the attempt. Manual Disconnect always requires confirmation. **Disconnect All** confirms with the active count.

Closing the main window with active sessions warns and disconnects all sessions on every platform, including macOS. If unsaved edits also exist, one consolidated dialog describes both consequences. No session remains alive invisibly and no session is restored after launch.

See [ADR 0001](../adr/0001-key-live-sessions-by-connection-profile.md).

## Authentication

Clicking Connect opens a focused in-app prompt only when an Authentication Secret is needed.

- Password profiles always prompt for a password.
- Unencrypted private keys connect without a secret prompt.
- Encrypted private keys prompt for a passphrase.
- Authentication failure reopens the prompt with friendly error context and permits retry.
- Canceling the local secret prompt does not start a Connection Attempt.
- Authentication Secrets remain only in memory for the immediate attempt.

The native operating-system file picker is the only native product dialog. Secret, trust, disconnect, delete, recovery, and discard prompts are accessible in-app dialogs.

## Host trust

Host Trust remains in one app-level OpenSSH-compatible `known_hosts` store keyed by host and port and shared by every matching profile.

Unknown-host verification is a blocking dialog showing destination, algorithm, and fingerprint. It offers:

- Cancel
- Trust once
- Trust and remember

Trust once appears as **Trusted for this session** on Overview and returns to **Not remembered** after disconnect.

A changed host key shows old and new algorithms/fingerprints. **Replace and Connect** requires a second explicit confirmation, updates shared trust for future connections, and leaves existing live sessions untouched. Canceling does not replace trust.

**Forget trusted host key** is available from Overview. It confirms the endpoint scope, affects every matching profile’s future connections, and does not terminate existing sessions. The next connection verifies again.

## Connection Attempt

A durable Connection Attempt begins only after any local secret prompt completes and network connection starts. Only the latest summary persists.

The summary records:

- start time
- connected time, when a shell opens
- end time
- one stable outcome:
  - remote session ended
  - operator disconnected
  - authentication failed
  - timed out
  - network failed
  - host key rejected
  - canceled
  - interrupted by previous app exit

Raw transport text is never persisted. The UI shows a friendly stable category and may expose transient technical detail in a disclosure.

## Machine Snapshot

After every successful connection, automatic discovery runs when enabled for the profile. It uses one fixed, non-interpolated, no-PTY POSIX command channel to collect:

- hostname
- kernel name
- kernel release
- architecture

The profile toggle explains that remote commands run automatically, lists the collected facts, and reveals the fixed command. Windows and non-POSIX targets report discovery unavailable without affecting the terminal.

Discovery behavior:

- one automatic run per successful session
- one discovery request in flight per profile
- explicit **Refresh** while connected
- five-second timeout
- 32 KiB combined stdout/stderr cap
- fixed commands only, with no profile or user text interpolation
- control-character stripping and length limits on every field
- discovery-channel failure never closes or changes the SSH Session

A complete or partial result replaces the previous Machine Snapshot and records observation time. Partial results contain only fields observed in that run and never merge with older values. A total failure preserves the older snapshot, labels it **Last observed**, and separately shows the failed refresh time. Snapshots never rename or relabel a Connection Profile.

See [ADR 0002](../adr/0002-discover-a-bounded-posix-machine-snapshot.md).

## Terminal Transcript

Each profile lazily owns one xterm instance for the current app run.

- Terminal palette is always dark.
- Scrollback is fixed at 10,000 lines per profile.
- Switching profiles preserves each transcript and live terminal.
- Remote close or network loss preserves output read-only with an ended-session banner.
- A new attempt appends to existing output rather than clearing it.
- A non-editable local separator records attempt start time and the previous stable outcome so it cannot be mistaken for remote output.
- **Clear Terminal** immediately clears local output without confirmation.
- No transcript is written to disk or prompted for export.

## Visual and accessibility contract

- App chrome follows the operating system’s light/dark appearance.
- Controls and focus treatment are grayscale; green, amber, and red are reserved for semantic status.
- State always uses icon, text, and color, with live-region announcements for changes.
- Cards are flat with subtle one-pixel borders; shadows are reserved for dialogs.
- Brief functional motion honors reduced-motion settings.
- Every sidebar item, tab, dialog, action, and form field is keyboard accessible with visible focus.
- Successful connection and opening a connected Terminal tab move focus into the terminal.
- macOS application shortcuts use `Cmd`; Windows/Linux use `Ctrl+Shift` so shell control keys are not intercepted.
- Fixed shortcuts cover search, sidebar toggle, Overview/Terminal tabs, and previous/next profile.

## Implementation shape

1. Add shared profile, attempt, snapshot, trust, lifecycle, and IPC contracts.
2. Add a main-process profile repository with schema validation, atomic persistence, backup recovery, and main-only key paths.
3. Refactor the SSH API from “one sender replaces its previous session” to a profile-keyed concurrent session manager while preserving sender ownership checks.
4. Add trust-once, changed-key replacement, trust removal, pending cancelation, and categorized attempt events.
5. Add bounded discovery over a separate exec channel on the authenticated SSH client.
6. Expose narrow profile/session methods and typed events through preload; never expose filesystem access or raw key paths.
7. Split the renderer into profile sidebar, profile form, workspace tabs, Overview cards, dialogs, and a lazy per-profile terminal registry.
8. Add responsive system-theme styling and accessible keyboard/focus behavior.

## Validation

Automated coverage must include:

- profile validation, fallback labels, sorting, search, duplicate detection, and edit invalidation rules
- atomic writes, restrictive permissions, backup recovery, failed writes, schema migration, and crash recovery
- main-only key paths and preload/API boundary tests
- one session per profile, concurrent sessions across profiles, sender ownership, cancelation, disconnect-all, deletion, and shutdown
- unknown, once-trusted, remembered, forgotten, changed, and replaced host keys across shared endpoints
- secret retry and missing-key replacement flows
- every stable attempt outcome and transient diagnostic handling
- discovery success, partial output, timeout, output limits, untrusted output sanitization, stale preservation, and terminal isolation
- transcript separation, per-profile routing, scrollback configuration, and background failure state
- responsive layout, system themes, reduced motion, keyboard shortcuts, focus movement, and accessible state labels

Before completion, `pnpm test` and `pnpm build` must both pass, per repository instructions.

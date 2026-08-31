# Workspace navigation, theming, and accessibility — manual pass

Renderer behavior is excluded from Vitest. Run this pass after `pnpm build` (or `pnpm dev`) against a local window at about 1180×760 and again at 800×600.

## Search

- Type into the sidebar search. Matching uses Profile Label, username, and destination (including a non-default port and a bracketed IPv6 host).
- Empty query shows every profile. A query with no matches shows “No matching profiles.”
- Application search shortcut focuses the field: **⌘F** on macOS, **Ctrl+Shift+F** on Windows/Linux. If the sidebar is collapsed, the shortcut expands it first.

## Sidebar collapse

- **Hide sidebar** hides the list completely and leaves a **Show sidebar** reveal control.
- Collapsed state survives quit and relaunch.
- Toggle shortcut: **⌘B** on macOS, **Ctrl+Shift+B** on Windows/Linux.

## Fixed shortcuts

Modifiers: **⌘** on macOS; **Ctrl+Shift** on Windows/Linux (plain Ctrl is never intercepted).

| Action           | Key |
| ---------------- | --- |
| Focus search     | F   |
| Toggle sidebar   | B   |
| Overview tab     | 1   |
| Terminal tab     | 2   |
| Previous profile | [   |
| Next profile     | ]   |

- Previous/next walk the **filtered** list and wrap.
- With a live terminal focused, **Ctrl+C** / **Ctrl+D** reach the shell. They must not be claimed by Picaglass.

## Appearance and motion

- Chrome follows the OS light/dark appearance. Controls and focus rings stay grayscale.
- Green, amber, and red appear only on session/failure status (icon + text + color together).
- Enable OS reduced-motion: sidebar grid motion should not animate.

## Keyboard, focus, and live region

- Tab through sidebar items, tabs, Overview actions, the create/edit form, and dialog buttons. Focus is always visible.
- Dialogs trap Tab, **Escape** cancels, and focus returns to the opener. The secret prompt focuses the secret field.
- A successful foreground Connect, or opening a connected Terminal tab, moves focus into the terminal. Connecting in the background must not steal focus.
- Session state changes (and off-screen failures) update the polite live region (inspect via a screen reader or the visually hidden `aria-live` node).

## Layout at 800×600

- Window opens near 1180×760 and cannot shrink below 800×600.
- At a narrow main pane, Overview’s summary rail stacks above the detail cards.
- The terminal tab keeps the full main-pane width (sidebar collapsed or expanded).

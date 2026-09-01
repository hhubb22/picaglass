/**
 * Baseline screenshot harness for the UI/UX redesign (wayfinder ticket #56).
 *
 * Drives the real built app with a mocked window.api (no SSH needed) and
 * captures every screen/state into docs/design/baseline/{light,dark}/.
 *
 * Usage (from repo root):
 *   pnpm build
 *   node_modules/.bin/esbuild scripts/baseline/generate-payloads.ts --bundle \
 *     --platform=node --format=cjs --outfile=/tmp/picaglass-gen-payloads.cjs
 *   node /tmp/picaglass-gen-payloads.cjs
 *   node scripts/baseline/capture.mjs
 *
 * The harness injects out/renderer/baseline-mock.js into the built renderer
 * (build output only; index.html is restored on exit) and drives the window
 * over the Chrome DevTools Protocol.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
// PROTOTYPE(#58/#59): BASELINE_VARIANT/BASELINE_LAYOUT/BASELINE_ONLY/BASELINE_OUT 让同一回路按变体出图
const VARIANT = process.env.BASELINE_VARIANT ?? null
const LAYOUT = process.env.BASELINE_LAYOUT ?? 'current'
const ONLY = (process.env.BASELINE_ONLY ?? '').split(',').filter(Boolean)
const OUT_DIR = process.env.BASELINE_OUT ?? join(ROOT, 'docs/design/baseline')
const RENDERER_DIR = join(ROOT, 'out/renderer')
const PORT = 9333
const payloads = JSON.parse(readFileSync(join(ROOT, 'scripts/baseline/payloads.json'), 'utf8'))

// ---------------------------------------------------------------------------
// Mock page script: installed into out/renderer as baseline-mock.js. Runs as a
// classic script after the preload and before the deferred Svelte module, so
// overwriting window.api here is deterministic.
// ---------------------------------------------------------------------------
const MOCK_SOURCE = `(() => {
  const P = ${JSON.stringify(payloads)};
  const encoder = new TextEncoder();
  const never = () => new Promise(() => {});
  const override = localStorage.getItem('__baselineWorkspace');
  const state = {
    workspace: override === 'empty' ? P.workspaceEmpty : P.workspace,
    secretRequirement: { ok: true, kind: 'none' },
    connectResult: { ok: true, sessionId: 'sess-leaf01' },
    connectPending: false,
    diag: {},
    techSupport: P.techSupport.idle,
    snapshot: P.snapshot,
    handlers: { data: [], status: [], snapshot: [], close: [] }
  };
  const diag = (id, fallback) => {
    const entry = state.diag[id];
    if (entry === 'pending') {
      // Stays in flight until the driver swaps the entry, so the panel shows
      // its pristine Loading… view; resolving un-wedges the block.
      return new Promise((resolve) => {
        const timer = setInterval(() => {
          if (state.diag[id] !== 'pending') {
            clearInterval(timer);
            resolve(state.diag[id] ?? fallback);
          }
        }, 100);
      });
    }
    if (entry !== undefined) return Promise.resolve(entry);
    return Promise.resolve(fallback);
  };
  const api = {
    __isBaselineMock: true,
    ssh: {
      pickPrivateKey: async () => null,
      secretRequirement: async () => state.secretRequirement,
      connect: async () => {
        if (state.connectPending) return never();
        return state.connectResult;
      },
      confirmHostKey: async () => ({ ok: false, reason: 'canceled', message: 'canceled' }),
      hostTrust: async () => ({ status: 'not-remembered' }),
      forgetHostKey: async () => ({ ok: true }),
      write: () => {},
      resize: () => {},
      disconnect: async () => {},
      cancel: async () => {},
      disconnectAll: async () => {},
      refreshDiscovery: async () => {},
      onData: (h) => { state.handlers.data.push(h); return () => {}; },
      onStatus: (h) => { state.handlers.status.push(h); return () => {}; },
      onSnapshot: (h) => { state.handlers.snapshot.push(h); return () => {}; }
    },
    diagnostics: {
      runDeviceFacts: () => diag('device-facts', P.runs['device-facts']),
      runInterfaceStatus: () => diag('interface-status', P.runs['interface-status']),
      runL2: () => diag('l2', P.runs.l2),
      runL3: () => diag('l3', P.runs.l3),
      runLogs: () => diag('logs', P.runs.logs),
      startTechSupport: async () => ({ kind: 'ok', snapshot: state.techSupport }),
      getTechSupport: async () => state.techSupport,
      deleteTechSupportRemote: async () => ({ kind: 'ok', snapshot: state.techSupport }),
      revealTechSupportArtifact: async () => ({ kind: 'ok' })
    },
    mcp: { getConfig: async () => P.mcpConfig },
    profiles: {
      load: async () => state.workspace,
      create: async () => ({ ok: false, reason: 'invalid', fields: {}, workspace: state.workspace }),
      update: async () => ({ ok: false, reason: 'invalid', fields: {}, workspace: state.workspace }),
      select: async (profileId) => {
        state.workspace = { ...state.workspace, selectedProfileId: profileId };
        return { ok: true, workspace: state.workspace };
      },
      delete: async () => ({ ok: true, workspace: state.workspace }),
      pickPrivateKey: async () => null,
      replacePrivateKey: async () => ({ ok: false, workspace: state.workspace }),
      setSidebarCollapsed: async (sidebarCollapsed) => ({
        ok: true,
        workspace: { ...state.workspace, sidebarCollapsed }
      })
    },
    workspace: {
      onCloseRequested: (h) => { state.handlers.close.push(h); return () => {}; },
      confirmClose: async () => {},
      setCloseGuard: async () => {}
    }
  };
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
  window.__baseline = {
    state,
    payloads: P,
    set(patch) { Object.assign(state, patch); },
    setDiag(id, value) { state.diag[id] = value; },
    clearDiag() { state.diag = {}; },
    emitData(profileId, sessionId, text) {
      for (const h of state.handlers.data) {
        try { h(sessionId, encoder.encode(text), profileId); } catch {}
      }
    },
    emitStatus(event) {
      for (const h of state.handlers.status) {
        try { h(event); } catch {}
      }
    },
    emitSnapshot(profileId) {
      for (const h of state.handlers.snapshot) h({ profileId, snapshot: state.snapshot });
    }
  };
})();
`

// ---------------------------------------------------------------------------
// CDP plumbing
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForPageTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((target) => target.type === 'page' && target.url.includes('index.html'))
      if (page !== undefined) {
        return page
      }
    } catch {
      // not up yet
    }
    await sleep(250)
  }
  throw new Error('renderer page target never appeared')
}

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let nextId = 0
  const pendingCalls = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined && pendingCalls.has(message.id)) {
      const { resolve, reject } = pendingCalls.get(message.id)
      pendingCalls.delete(message.id)
      if (message.error !== undefined) {
        reject(new Error(message.error.message))
      } else {
        resolve(message.result)
      }
    }
  })
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  const send = (method, params = {}) => {
    nextId += 1
    const id = nextId
    return new Promise((resolve, reject) => {
      pendingCalls.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  }
  return { opened, send, close: () => ws.close() }
}

// ---------------------------------------------------------------------------
// Driver helpers (run inside the page)
// ---------------------------------------------------------------------------
let cdp

async function ev(expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails !== undefined) {
    throw new Error(`page evaluation failed: ${JSON.stringify(result.exceptionDetails)} :: ${expression.slice(0, 120)}`)
  }
  return result.result.value
}

async function shot(theme, name) {
  if (ONLY.length > 0 && !ONLY.some((prefix) => name.startsWith(prefix))) {
    return
  }
  const dir = join(OUT_DIR, theme)
  mkdirSync(dir, { recursive: true })
  const result = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const file = join(dir, `${name}.png`)
  writeFileSync(file, Buffer.from(result.data, 'base64'))
  console.log(`  ${theme}/${name}.png`)
}

const CLICK_JS = (text) => `(() => {
  const button = [...document.querySelectorAll('button')]
    .find((b) => b.textContent.trim() === ${JSON.stringify(text)} && b.offsetParent !== null);
  if (button === undefined) return false;
  button.click();
  return true;
})()`

async function clickButton(text) {
  const found = await ev(CLICK_JS(text))
  if (!found) {
    throw new Error(`button not found or not visible: ${text}`)
  }
  await sleep(120)
}

async function clickSidebarProfile(label) {
  const found = await ev(`(() => {
    const button = [...document.querySelectorAll('#profile-sidebar li button')]
      .find((b) => b.querySelector('.label')?.textContent.trim() === ${JSON.stringify(label)});
    if (button === undefined) return false;
    button.click();
    return true;
  })()`)
  if (!found) {
    throw new Error(`sidebar profile not found: ${label}`)
  }
  await sleep(250)
}

async function reloadApp() {
  await cdp.send('Page.reload', { ignoreCache: true })
  await sleep(1200)
  const mocked = await ev('window.api?.__isBaselineMock === true')
  if (!mocked) {
    throw new Error('baseline mock did not install')
  }
}

async function useWorkspace(kind) {
  await ev(`localStorage.setItem('__baselineWorkspace', ${JSON.stringify(kind)})`)
  await reloadApp()
}

const TERMINAL_TEXT =
  '\r\nWelcome to PICOS\r\n\r\nadmin@leaf01$ show version\r\n' +
  'Software Version      : 4.4.2B\r\nModel                 : AS5835-54X\r\n' +
  'System Uptime         : 63 days, 4:12:33\r\nadmin@leaf01$ show interface brief | match up\r\n' +
  'te-1/1/1    up    10G   uplink-spine01\r\nte-1/1/2    up    10G   uplink-spine02\r\n' +
  'admin@leaf01$ '

const DIAG_BLOCKS = [
  { id: 'device-facts', tab: '设备事实' },
  { id: 'interface-status', tab: '接口状态' },
  { id: 'l2', tab: 'L2' },
  { id: 'l3', tab: 'L3' },
  { id: 'logs', tab: '日志' }
]

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
async function captureAll(theme) {
  // Sidebar: empty workspace (also covers the empty workspace pane).
  await useWorkspace('empty')
  await shot(theme, '01-sidebar-empty')

  // Sidebar: multiple profiles + workspace overview with no session.
  await useWorkspace('default')
  await shot(theme, '02-workspace-overview-no-session')

  // Connect p-leaf01 (selected by default) from the overview, with device
  // facts wedged in flight so the panel opens on its pristine Loading… view.
  await ev(`window.__baseline.setDiag('device-facts', 'pending')`)
  await ev(`window.__baseline.set({
    connectPending: false,
    connectResult: { ok: true, sessionId: 'sess-leaf01' }
  })`)
  await clickButton('Connect')
  await sleep(600)
  await ev(`window.__baseline.emitSnapshot('p-leaf01')`)
  await ev(`window.__baseline.emitData('p-leaf01', 'sess-leaf01', ${JSON.stringify(TERMINAL_TEXT)})`)
  await sleep(400)

  // Connected overview (snapshot card populated).
  await clickButton('Overview')
  await shot(theme, '03-workspace-overview-connected')

  // Terminal tab: diagnostics panel is still waiting on device facts.
  await clickButton('Terminal')
  await sleep(600)
  // PROTOTYPE(#59): B 变体诊断在独立 tab；C 变体默认折叠，先拍折叠态再用块 chip 展开
  if (LAYOUT === 'B') {
    await clickButton('诊断')
    await sleep(600)
  } else if (LAYOUT === 'C') {
    await shot(theme, 'layout-c-collapsed')
    await clickButton('设备事实')
    await sleep(600)
  }
  await shot(theme, 'diag-device-facts-loading')
  await ev(`window.__baseline.setDiag('device-facts', window.__baseline.payloads.runs['device-facts'])`)
  await sleep(600)
  await shot(theme, '04-diag-device-facts-loaded')
  await ev(`window.__baseline.setDiag('device-facts', window.__baseline.payloads.runs['device-facts-empty'])`)
  await clickButton('Refresh')
  await sleep(500)
  await shot(theme, 'diag-device-facts-empty')
  await ev(`window.__baseline.setDiag('device-facts', window.__baseline.payloads.runs['device-facts'])`)

  // Diagnostics for the remaining blocks: pristine Loading… (first visit
  // wedged in flight), then loaded, then empty.
  for (const block of DIAG_BLOCKS) {
    if (block.id === 'device-facts') {
      continue
    }
    await ev(`window.__baseline.setDiag(${JSON.stringify(block.id)}, 'pending')`)
    await clickButton(block.tab)
    await sleep(500)
    await shot(theme, `diag-${block.id}-loading`)
    await ev(`window.__baseline.setDiag(${JSON.stringify(block.id)}, window.__baseline.payloads.runs[${JSON.stringify(block.id)}])`)
    await sleep(600)
    await shot(theme, `diag-${block.id}-loaded`)
    await ev(`window.__baseline.setDiag(${JSON.stringify(block.id)}, window.__baseline.payloads.runs[${JSON.stringify(`${block.id}-empty`)}])`)
    await clickButton('Refresh')
    await sleep(500)
    await shot(theme, `diag-${block.id}-empty`)
    await ev(`window.__baseline.setDiag(${JSON.stringify(block.id)}, window.__baseline.payloads.runs[${JSON.stringify(block.id)}])`)
  }

  // tech_support: idle / collecting / done / failed (panel polls every 1s).
  await clickButton('tech_support 采集')
  await sleep(1300)
  await shot(theme, '05-diag-tech-support-idle')
  await ev(`window.__baseline.set({ techSupport: window.__baseline.payloads.techSupport.collecting })`)
  await sleep(1300)
  await shot(theme, '05-diag-tech-support-collecting')
  await ev(`window.__baseline.set({ techSupport: window.__baseline.payloads.techSupport.done })`)
  await sleep(1300)
  await shot(theme, '05-diag-tech-support-done')
  await ev(`window.__baseline.set({ techSupport: window.__baseline.payloads.techSupport.failed })`)
  await sleep(1300)
  await shot(theme, '05-diag-tech-support-failed')

  // Terminal alone: collapse the diagnostics panel (B 变体终端页无面板；
  // C 变体折叠后用块 chip 展开，没有「诊断」toggle)。
  if (LAYOUT === 'B') {
    await clickButton('Terminal')
    await sleep(400)
    await shot(theme, '06-terminal')
  } else {
    await clickButton('收起')
    await sleep(300)
    await shot(theme, '06-terminal')
    if (LAYOUT === 'C') {
      await clickButton('设备事实')
    } else {
      await clickButton('诊断')
    }
    await sleep(300)
  }

  // Dialog: create profile form.
  await clickButton('Create Connection Profile')
  await sleep(300)
  await shot(theme, '07-dialog-create-profile')
  await clickButton('Cancel')

  // Dialog: secret prompt (password profile, fresh session state).
  await clickSidebarProfile('lab-sw')
  await sleep(200)
  await ev(`window.__baseline.set({ secretRequirement: { ok: true, kind: 'password' } })`)
  await clickButton('Connect')
  await sleep(300)
  await shot(theme, '08-dialog-secret-prompt')
  await clickButton('Cancel')
  await sleep(200)

  // Dialog: unknown host fingerprint.
  await clickSidebarProfile('core01')
  await ev(`window.__baseline.set({
    secretRequirement: { ok: true, kind: 'none' },
    connectResult: {
      ok: false, reason: 'host-unknown', sessionId: 'sess-hk',
      fingerprint: 'SHA256:uNyp8kF3vV3YrZ0y8k3J1m0r7vXwq2pQ6l0h4jK8f1A',
      algorithm: 'ssh-ed25519'
    }
  })`)
  await clickButton('Connect')
  await sleep(400)
  await shot(theme, '09-dialog-host-unknown')
  await clickButton('Cancel')
  await sleep(300)

  // Dialog: changed host key.
  await ev(`window.__baseline.set({
    connectResult: {
      ok: false, reason: 'host-changed', sessionId: 'sess-hk2',
      fingerprint: 'SHA256:uNyp8kF3vV3YrZ0y8k3J1m0r7vXwq2pQ6l0h4jK8f1A',
      algorithm: 'ssh-ed25519',
      previousFingerprint: 'SHA256:AAAAB3NzaC1yc2EAAAADAQABAAABAQC7vXwq2pQ6l0h4',
      previousAlgorithm: 'rsa-sha2-256'
    }
  })`)
  await clickButton('Connect')
  await sleep(400)
  await shot(theme, '10-dialog-host-changed')
  await clickButton('Cancel')
  await sleep(300)

  // Overview failure banner (auth failure on a foreground connect).
  await clickSidebarProfile('edge-gw')
  await ev(`window.__baseline.set({
    connectResult: { ok: false, reason: 'auth-failed', message: 'Authentication failed. Check the password and try again.' }
  })`)
  await clickButton('Connect')
  await sleep(500)
  await shot(theme, '11-workspace-overview-failure')

  // Sidebar with every session state: connected (leaf01), connecting
  // (spine02), unseen failure (lab-sw via a dropped session), idle (others).
  // Runs last: it leaves the app in a mixed session state.
  await clickSidebarProfile('spine02.dc1')
  await ev(`window.__baseline.set({ connectPending: true })`)
  await clickButton('Connect')
  await sleep(300)
  await clickSidebarProfile('lab-sw')
  await ev(`window.__baseline.set({
    connectPending: false,
    connectResult: { ok: true, sessionId: 'sess-labsw' }
  })`)
  await clickButton('Connect')
  await sleep(500)
  await clickSidebarProfile('leaf01.dc1')
  await sleep(300)
  await ev(`window.__baseline.emitStatus({
    sessionId: 'sess-labsw', profileId: 'p-lab-sw', type: 'error',
    message: 'Connection reset by peer'
  })`)
  await sleep(400)
  await shot(theme, '12-sidebar-states')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const indexHtml = join(RENDERER_DIR, 'index.html')
  const originalHtml = readFileSync(indexHtml, 'utf8')
  if (!originalHtml.includes('<script type="module"')) {
    throw new Error('out/renderer/index.html has no module script tag; run pnpm build first')
  }
  writeFileSync(join(RENDERER_DIR, 'baseline-mock.js'), MOCK_SOURCE)
  writeFileSync(
    indexHtml,
    originalHtml.replace(
      '<script type="module"',
      '<script src="./baseline-mock.js"></script>\n    <script type="module"'
    )
  )

  const electron = spawn(
    join(ROOT, 'node_modules/.bin/electron'),
    ['scripts/baseline/harness-main.cjs', `--remote-debugging-port=${PORT}`],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] }
  )
  electron.stderr.on('data', () => {})

  const restore = () => {
    writeFileSync(indexHtml, originalHtml)
    try {
      electron.kill('SIGTERM')
    } catch {
      // already gone
    }
  }
  process.on('SIGINT', () => {
    restore()
    process.exit(130)
  })

  try {
    const target = await waitForPageTarget()
    cdp = connectCdp(target.webSocketDebuggerUrl)
    await cdp.opened
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await sleep(800)

    const mocked = await ev('window.api?.__isBaselineMock === true')
    if (!mocked) {
      await reloadApp()
    }
    await ev(`localStorage.setItem('__controlsVariant', ${JSON.stringify(VARIANT ?? 'A')}); localStorage.setItem('__layoutVariant', ${JSON.stringify(LAYOUT)}); localStorage.setItem('__controlsBar', 'hidden')`)
    await reloadApp()

    for (const theme of ['light', 'dark']) {
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-color-scheme', value: theme },
          { name: 'prefers-reduced-motion', value: 'reduce' }
        ]
      })
      console.log(`theme: ${theme}`)
      await captureAll(theme)
    }
  } finally {
    restore()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

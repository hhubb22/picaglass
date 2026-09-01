# UI 基线截图

UI/UX 重设计（wayfinder map [#55](https://github.com/hhubb22/picaglass/issues/55)，票
[#56](https://github.com/hhubb22/picaglass/issues/56)）的对比基线：重设计开始前现有全部界面
的截图。`light/` 与 `dark/` 两套，窗口 1180×760，内容数据来自 `tests/fixtures/picos/` 的
golden 样本（经真实解析器渲染）。

## 覆盖清单

| 文件 | 内容 |
| --- | --- |
| `01-sidebar-empty` | 侧栏空态（无 profile）+ 空工作区引导页 |
| `02-workspace-overview-no-session` | profile 工作区 Overview，无会话 |
| `03-workspace-overview-connected` | Overview，已连接 + Machine Snapshot 已填充 |
| `04-diag-device-facts-loaded` | 诊断面板·设备事实 loaded（终端+面板真实布局） |
| `diag-<block>-loaded` | 各诊断块 loaded：device-facts / interface-status / l2 / l3 / logs |
| `diag-<block>-empty` | 各诊断块空态（解析成功但无数据行） |
| `diag-<block>-loading` | 各诊断块首次加载 Loading… 态 |
| `05-diag-tech-support-{idle,collecting,done,failed}` | tech_support 采集四态 |
| `06-terminal` | 终端（诊断面板收起） |
| `07-dialog-create-profile` | 新建 Connection Profile 表单 |
| `08-dialog-secret-prompt` | 密码输入对话框（SecretPrompt） |
| `09-dialog-host-unknown` | Host Trust：未知主机指纹 |
| `10-dialog-host-changed` | Host Trust：主机密钥变更 |
| `11-workspace-overview-failure` | Overview 连接失败横幅（auth failed） |
| `12-sidebar-states` | 侧栏多 profile + 各会话状态（connected / connecting / failed 未读 / idle） |

未覆盖：「查看原文」原文视图、parse-failed 降级视图、窗口关闭确认、Disconnect All 确认、
MCP 配置对话框。需要时按下面方式扩展 `scripts/baseline/capture.mjs`。

## 重新生成

截图由 mock 驱动真实构建产物生成（无 SSH、不碰真实 profile 存储）：

```sh
pnpm build
node_modules/.bin/esbuild scripts/baseline/generate-payloads.ts --bundle \
  --platform=node --format=cjs --outfile=/tmp/picaglass-gen-payloads.cjs
node /tmp/picaglass-gen-payloads.cjs
node scripts/baseline/capture.mjs
```

- `generate-payloads.ts` 用真实解析器把 golden fixtures 转成诊断 run 对象，写入
  `scripts/baseline/payloads.json`。
- `capture.mjs` 把 mock `window.api` 注入 `out/renderer/`（构建产物，结束后恢复
  `index.html`），用 `scripts/baseline/harness-main.cjs`（无 preload 的 BrowserWindow）
  启动，经 CDP 驱动界面并截图。

已知边界：真实 app 的 preload 用 contextBridge 暴露的 `window.api` 是 frozen 的，无法在外部
替换，因此 harness 用一个不带 preload 的窗口加载同一份构建产物。

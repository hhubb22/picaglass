# 调研：Electron 主进程内嵌 MCP server（Wayfinder #30）

> 目的：为 picaglass「MCP 工具面细化」决策（地图 #26）提供事实基础。
> 场景：GUI app 长驻（Electron 主进程）+ 本地 coding agent（Claude Code、pi 等 MCP client）接入，只读诊断能力面。

## 结论速览（推荐方案）

- **SDK**：用 v1 稳定线 `@modelcontextprotocol/sdk`（npm `latest` = 1.30.0）。main 分支已是 v2（拆分为 `@modelcontextprotocol/server` / `@modelcontextprotocol/client`，对应 2026-07-28 spec），但 npm `latest` 仍指向 v1，v1 官方承诺在 v2 发布后至少 6 个月内继续修 bug 与安全更新。picaglass 用量浅（少量只读 tool），v1 足够，升级路径清楚。
- **传输**：Electron 主进程内嵌 **Streamable HTTP on 127.0.0.1**，单 endpoint（如 `/mcp`），stateful 模式 + `enableJsonResponse: true`（避免为简单请求-响应维护 SSE 长流）。stdio 不适用：app 已长驻，不能让 client 去 spawn 它。
- **发现/接入**：MCP 没有服务发现机制，client 一律靠配置文件注册 server。推荐「动态端口 + 端口文件」：app 启动时绑 127.0.0.1 的随机可用端口，把 `{ url, token }` 写到 userData 下的端口文件；接入靠用户把一条 MCP 配置贴进 client（`claude mcp add --transport http ...` / pi 的 `mcp.json` `url` 条目）。GUI 里放一个「复制 MCP 配置」按钮。
- **安全**：绑 127.0.0.1（spec SHOULD）+ 每个 HTTP 请求校验 Host/Origin（spec MUST，防 DNS rebinding）+ bearer token（spec SHOULD auth）。只读能力面在 tool 注册处强制：只注册只读 tool，加上 `run_show` 白名单在工具实现内二次校验。
- **打包影响**：基本为零。SDK 是纯 JS、无原生依赖，走 electron-vite 正常 bundle；唯一注意点是 dependencies（picaglass 现已有 ssh2 先例）会被 electron-builder 打进 app 的 node_modules。

## 事实与来源

### 1. MCP 传输现状：Streamable HTTP 是现行标准

- MCP spec 2025-06-18 定义两种标准传输：stdio 与 Streamable HTTP。Streamable HTTP **取代**了 2024-11-05 版的 HTTP+SSE 传输（spec 原文："This replaces the HTTP+SSE transport"）。
  - 来源：`modelcontextprotocol/modelcontextprotocol` 仓库 `docs/specification/2025-06-18/basic/transports.mdx`（<https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/basic/transports.mdx>）
- Streamable HTTP 语义：client 用 HTTP POST 发 JSON-RPC；server 可回 `application/json` 单次响应，也可升级成 SSE 流；可选 standalone GET SSE 流用于 server 主动通知；支持 stateful（session id + 断线恢复）与 stateless 两种模式。
  - 来源：同上 spec 文件，Streamable HTTP 一节。
- **spec 的安全要求（关键，直接引用）**：
  1. "Servers **MUST** validate the `Origin` header on all incoming connections to prevent DNS rebinding attacks"
  2. "When running locally, servers **SHOULD** bind only to localhost (127.0.0.1)"
  3. "Servers **SHOULD** implement proper authentication for all connections"
  - 来源：同上 spec 文件，"Security Warning" 一节。原文明确解释动机："Without these protections, attackers could use DNS rebinding to interact with local MCP servers from remote websites."

### 2. TypeScript SDK 版本格局与 API

- npm `@modelcontextprotocol/sdk` `dist-tags.latest` = **1.30.0**（实测 registry）。SDK 仓库 main 分支已切到 v2：拆包为 `@modelcontextprotocol/server` / `@modelcontextprotocol/client`，实现 2026-07-28 spec，并附 express/fastify/hono/node 中间件包（含 Host header 校验助手）。README 原文："v1.x continues to receive bug fixes and security updates for at least 6 months after v2's release."
  - 来源：<https://registry.npmjs.org/@modelcontextprotocol/sdk>（dist-tags）；<https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md>
- v1 SDK（1.30.0，实测 npm tarball typings）：
  - `StreamableHTTPServerTransport`（`server/streamableHttp.js`）：Node `IncomingMessage/ServerResponse` 包装，内部委托 `WebStandardStreamableHTTPServerTransport`。用法：`new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })` 为 stateful；`sessionIdGenerator: undefined` 为 stateless。`handleRequest(req, res, parsedBody?)` 直接挂进任何 Node http server。
  - 选项里有 `enableJsonResponse`（"Default is false (SSE streams are preferred)"）——本地桌面场景简单请求-响应建议开。
  - DNS rebinding 三个选项 `allowedHosts` / `allowedOrigins` / `enableDnsRebindingProtection` **仍可用但已标 @deprecated**，注释指向"Use external middleware"（包内确有 `server/middleware/hostHeaderValidation.js`）。即：SDK 仍提供校验能力，但官方把责任挪向应用层中间件——我们的薄 HTTP 层里自己做 Host/Origin 白名单即可，不被 deprecation 阻塞。
  - 来源：`npm @modelcontextprotocol/sdk@1.30.0` tarball 内 `dist/esm/server/streamableHttp.d.ts`、`webStandardStreamableHttp.d.ts`、`middleware/hostHeaderValidation.d.ts`
- stdio 传输也在包内（`server/stdio.js`），但需要 client 以子进程方式启动 server——不适合长驻 GUI app。
  - 来源：同上 tarball 文件列表与 SDK README。

### 3. Client 侧的发现与接入机制

**MCP 没有自动发现**；所有主流 client 都靠显式配置注册 server。因此桌面 app 的接入动作 = 生成/注入一段配置。

- **Claude Code**：官方文档支持 stdio 与 HTTP server；注册方式为 `claude mcp add` 命令或项目级 `.mcp.json` / 用户级配置文件。
  - 来源：<https://code.claude.com/docs/en/mcp>（实测页面，`.mcp.json` 与 `claude mcp add` 均为文档内一手内容）
- **pi**：本机安装的 pi MCP 适配器（`pi-mcp-adapter`）README 显示配置面同时支持 `command`（stdio）与 `url`（"HTTP endpoint (StreamableHTTP with SSE fallback)"），并支持 `headers`（可放 bearer token，值支持 `!command` 动态获取）与 `auth: "bearer" | "oauth"`。配置文件为 `.mcp.json` / `~/.config/mcp/mcp.json`。
  - 来源：本机 `/Users/doby/.pi/agent/npm/node_modules/pi-mcp-adapter/README.md`（Server Options 表）
- 桌面 app 内嵌 MCP 的通行做法（与上述 client 行为互为印证）：app 在 localhost 起 HTTP endpoint，向用户输出一段可粘贴的配置（或提供"一键写入 client 配置"）。因为 client 无发现协议，**端口文件 + 配置注入**是事实标准；固定端口不是好选择（多实例冲突、被其他进程占用）。

### 4. 安全姿态（本地威胁模型）

威胁模型：本机恶意网页/进程试图调用 MCP endpoint。攻击面与对策：

| 威胁 | 对策 | 依据 |
|---|---|---|
| 浏览器 DNS rebinding（网页经受害者浏览器访问 127.0.0.1 endpoint） | 校验 `Origin`（拒绝带非预期 Origin 的请求）+ 校验 `Host` 只允许 `127.0.0.1:<port>`/`localhost:<port>` | spec MUST/SHOULD（见 §1）；SDK hostHeaderValidation 中间件 |
| 本机任意进程直接调用 | 启动时生成随机 bearer token，写端口文件（0600 权限，userData 目录）；client 配置里带 `Authorization: Bearer`（pi `headers`、Claude Code HTTP server 均支持 headers） | spec SHOULD auth；pi adapter `headers`/`auth: "bearer"` |
| 网络面暴露 | 只绑 127.0.0.1，绝不 0.0.0.0 | spec SHOULD |
| 只读承诺被破坏 | 在 MCP 层只注册只读 tool；`run_show` 兜底工具内部再做一次命令白名单校验（纵深防御，不依赖注册处单点） | 目的地决策（#26）"严格只读" |

### 5. Electron / electron-vite / electron-builder 影响

- SDK 为纯 JS（Node http），无原生模块——`electron-builder install-app-deps` 之类无需为它做额外事；与现有 `ssh2`（已是 dependency 并正常打包）同模式。
- electron-vite 默认把主进程 dependencies 外置为 `require`（打进 app.asar 的 node_modules），SDK 无需进 bundle；若选择 bundle 也无障碍。
- macOS：监听 127.0.0.1 端口通常不触发应用防火墙提示（防火墙提示针对接受外部连接；loopback-only 监听在默认配置下不弹）。无需 entitlements 变更（listener 不需要特殊 entitlement；现有 ssh2 已是出站连接）。
- 端口选择：`server.listen(0, '127.0.0.1')` 取随机空闲端口，写端口文件 `userData/mcp-endpoint.json`（`{ url, token, pid, startedAt }`），app 退出时删除。
  - 来源：Electron 官方文档无相反约束；socket 监听为主进程普通 Node API。此条为工程推断（无原生依赖、asar 打包模式），非外部文档断言。

## 风险清单

1. **SDK 代际切换中**：v1 已进维护模式，v2（新包名）是稳定线。选 v1 是低风险短期选择；规格里应写明"升级 v2 为后续 ticket"，避免 v1 停更后被动。
2. **DNS rebinding 校验是应用责任**：SDK v1 的内建选项已 deprecated，必须在我们自己的薄 HTTP 层落实 Host/Origin 白名单，且要做进验收测试（模拟恶意 Origin 的请求应 403）。
3. **token 流转依赖 client 配置**：用户粘贴配置时 token 会落在 client 配置文件中（`.mcp.json` 等）——明文但本机文件，与 SSH 私钥同级风险；规格中注明即可。port 文件与 token 不应进仓库/日志。
4. **stateful session 的内存持有**：Streamable HTTP stateful 模式在内存中持有 session 状态；app 长驻、单用户、少量 tool 调用下无压力，但规格可定"允许 stateless 降级"作为简化退路。
5. **SSE 与 Electron 主进程事件循环**：长 SSE 流挂在主进程上是常规 Node IO，无阻塞风险；开 `enableJsonResponse` 可进一步减少常驻流。
6. **多 client 并发**：spec/SDK 支持多 client；v1 规格只需声明"不限制 client 数，但能力面只读、无副作用冲突"，无需额外工作。

## 给「MCP 工具面细化」ticket 的输入

- 传输定型：Streamable HTTP，`POST /mcp`，stateful + `enableJsonResponse: true`，随机端口 + userData 端口文件 + bearer token。
- 六个语义化 tool + `run_show` 透传（白名单 + 强制 `| no-more`）均可在此传输上直接注册；工具结果大输出用 MCP 的 content 分块/截断策略在工具实现内控制。
- 接入 UX：GUI「复制 MCP 配置」按钮生成 Claude Code 与 pi 两种配置片段。

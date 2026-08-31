# picaglass PicOS 排障能力 v1 规格

> 本文档是 [Wayfinder 地图 #26](https://github.com/hhubb22/picaglass/issues/26) 的终点交付物：把地图上全部已决决策（#27–#35）汇编为实现依据。每条决策的来源在文末「决策溯源」。
>
> 术语以根目录 [CONTEXT.md](../CONTEXT.md) 为准（Diagnostic Block / Parsed Result / Agent Interface / Connection Profile / SSH Session / Authentication Secret 等）。

## 1. 范围

v1 交付：在 picaglass 现有 app 上演进一层 **PicOS 只读排障能力**，同一份能力面同时暴露给两个人口——

- **人类入口**：终端 tab 内的诊断面板（§8）
- **Agent 入口**：内嵌 MCP server（§7）

**六个诊断块**（Diagnostic Block）：设备事实、接口状态、L2、L3、日志、tech_support 采集。

**保证基线**：PicOS 9.8.x（FS 盒，go2cli 时代）。PicOS 4.x 不做主动支持——格式漂移实测极小（仅 `show version` 字段 schema 确认有代差），遇到 4.x 设备时由降级语义兜底（§6）。

### 非范围（v1 明确排除）

- 写操作：配置变更、traceoptions、syslog 落盘修改、`clear`。唯一例外见 §5.4（tech_support 清理）。
- 多设备 / 机群诊断与对比视图。
- 诊断结果历史持久化与对比（结果瞬态；tech_support 打包文件落盘是唯一落盘物）。
- 故障路径工作流 UI（按「端口不通」等故障路径组织的检查清单）。
- OVS 模式命令组（实验室验证机为 xorp L2/L3 模式）。
- Agent 无人类在场的全自主排障（需凭据缓存，放松 Authentication Secret 瞬态规则，属另一 effort）。

## 2. 关键实机事实（规格的硬约束）

以下来自实验室 FS S5810-28FS（PicOS 9.8.7-main-EC1，armv7l，xorp L2/L3 模式，trial license）的实测，详见 `docs/research/picos-exec-channel.md` 与 `docs/research/picos-tech-support-transfer.md`：

1. **show 输出无 JSON**（4.x 与 9.8.x 两代皆然）。结构化只能靠文本解析。
2. 非交互执行：`ssh -T <box> "cli -c '<cmd>'"` 可用；无 PTY 时分页 / ANSI / 行内回显天然消失。仍需剥离的噪音：`Synchronizing configuration...OK.`、trial-license banner、`Welcome to PICOS`、提示符行、`Execute command: <cmd>` 回显、命令前单独一行的 `.`；行尾 CRLF。
3. 退出码可靠：成功 0，语法/执行错误 1。配置模式等价物：`cli -c 'configure; run show ...'`。
4. 每次 `cli` 启动约 2s 开销；8 个并发 exec channel 实测无设备侧限制。
5. `show tech_support`：采集约 7 分钟、产物约 2.5MB 落 `/tmp/<hostname>-<时间戳>-techSupport.log`；**采集进程随 SSH 断开被杀**，必须 nohup 脱离会话；完成判定只能看采集进程退出（文件内无完成标记）；scp/sftp 拉取可用，CLI 无推送能力；产物需提权的 `file delete` 清理（/tmp 为 50MB tmpfs）。
6. 命令怪癖（有 fixture 佐证）：`show interface diagnostics optics` 与 `show mac-address` 裸写为语法错误，须带 `all`/接口名 与 `table` 子命令；`show version` 在 Hardware ID 为空时字段并入上一行；trial license 下 FDB / ARP / optics 为空表是**正常形态**。

## 3. 总体架构

```
renderer (Svelte)                main process (Electron)
┌──────────────────┐   IPC   ┌────────────────────────────────────┐
│ 诊断面板（底部）   │ ────── │ 诊断服务                             │
│ 六块 tab，可收起   │        │  ├─ framing：噪音剥离 / 块输出切分     │
└──────────────────┘        │  ├─ parser 调用（src/shared/picos/）  │
                            │  └─ tech_support 采集状态机           │
┌──────────────────┐        │                                      │
│ MCP client（Agent）│ ────── │ MCP server（Streamable HTTP, §7）    │
└──────────────────┘  HTTP  └───┬──────────────────────────────────┘
                                │ 复用活跃 SSH Session 的 ssh2 Client
                                ▼
                          exec channel（{pty:false}，cli -c '…'）
```

- parser 为纯函数，放 `src/shared/picos/`，renderer 与 main 共同消费（§6）。
- MCP 工具与 GUI 面板调用**同一份**诊断服务，行为一致只是载荷裁剪不同（§7.3）。

## 4. 命令面

每个诊断块一次 `cli -c 'cmd1; cmd2; …'` 聚合调用（摊薄 2s 启动开销）；每条命令自动补 `| no-more` 作防御。

| 块 | 命令 | 备注 |
|---|---|---|
| 设备事实 | `show version`、`show system fan`、`show system temperature`、`show system rpsu` | version 的 Hardware ID 空字段怪癖见 §6.3 |
| 接口状态 | `show interface brief`、`show interface diagnostics optics all` | detail 不默认全量拉取（实机 2000+ 行），按接口名单取：`show interface detail <ifname>`（GUI 与 MCP 同） |
| L2 | `show vlans`、`show mac-address table`、`show ethernet-switching interfaces` | mac-address 必须带 `table` |
| L3 | `show route ipv4`、`show route forward-route ipv4 all`、`show route forward-host ipv4 all`、`show arp`、`show neighbors` | 软硬表对比是本块的核心排障动作 |
| 日志 | `show log last 50`、`file list /pica/core` | core 目录是符号链接；无 core 为一行正常输出 |
| tech_support | `show tech_support` | 完整流程见 §5.4 |

`ping` 不进任何诊断块，仅经 `run_show` 白名单暴露（§7.4）。

## 5. 执行通道模型

### 5.1 通道

诊断命令走 **exec channel**：在活跃 SSH Session 的同一个 ssh2 `Client` 上开 `{pty: false}` 的 exec channel，沿用 Machine Snapshot 已实现的输出上限 / 超时 / 通道隔离语义（`src/main/ssh/create-ssh-api.ts` 中 `MACHINE_SNAPSHOT_*` 一带）。**不做持久 PTY 抓取。**

### 5.2 连接来源

v1 诊断挂在该 profile **已打开的 SSH Session** 上，复用其 client。无活跃会话时，GUI 面板显示「请先连接」、MCP 工具返回明确错误（§7.5）。Authentication Secret 瞬态规则不变。

### 5.3 块聚合与输出切分（framing）

- 一个诊断块 = 一次 `cli -c 'cmd1 | no-more; cmd2 | no-more; …'`。
- 块内命令边界用非交互模式下每条命令前的 `Execute command: <cmd>` 回显行切分。
- framing 层负责：剥离 §2.2 列出的全部噪音行、CRLF→LF、按回显行切分出每条命令的干净输出，再交给对应 parser。
- 并发：允许同 client 上多个 exec channel 并行（实机 8 并发无压力）；同一块的重复触发在 UI 层去重。

### 5.4 tech_support 采集状态机

`idle → starting → collecting → transferring → done / failed`

1. **starting**：进 shell 用 `nohup` 后台启动采集（采集进程随 SSH 断开被杀，必须脱离会话）。
2. **collecting**：每 3–5 分钟以独立 exec 轮询产物文件大小与采集进程是否退出（无文件内完成标记）。
3. **transferring**：scp/sftp 拉回本机（仅拉取方向；CLI 无推送能力），校验大小一致。
4. **done**：产物呈现（文件名 / 大小 / 保存位置）；随后用提权 `cli -c 'file delete …'` 清理设备侧副本。
5. 各阶段失败进入 `failed`，保留已得事实（部分产物、最后轮询状态）供展示。

**`file delete` 是全能力面唯一写操作例外**，作为本状态机内部实现，规格明文标注，不向 `run_show` 暴露。

## 6. 解析层与 Parsed Result

### 6.1 组织

`src/shared/picos/` 下每块一模块：`device-facts.ts`、`interface-status.ts`、`l2.ts`、`l3.ts`、`logs.ts`、`tech-support.ts`。模块解剖沿用 `src/shared/machine-snapshot.ts` 先例：命令常量、结果类型、纯 parse 函数、UI card 投影、colocated vitest 单测。

### 6.2 Parsed Result 形状

```ts
type ParsedResult<T> =
  | { status: 'parsed'; data: T; raw: string }
  | { status: 'parse-failed'; raw: string; reason: string }
```

- `raw` 恒在（清洗后、未解析的文本）。
- **空表是 `parsed` 且 `rows: []`**，不是 failure。
- 通道层失败（exit≠0 / 超时 / 传输错误）**不进 parser**，走工具/面板层的错误形状。

### 6.3 容忍边界

1. **skeleton 锚定**：每个 parser 认自己的骨架（表头行 / `Key : value` 区段等锚点）；骨架缺席 = `parse-failed`。
2. **字段级漂移静默容忍**：预期字段缺失即缺席（全部可选）；表格坏行跳过并计 `unparsedLines`；仅当零行且骨架未认出才算失败。
3. `show version` 的 Hardware ID 空字段并入上一行属于**已知形态**，parser 必须处理（有 fixture）。
4. v1 不主动实现 4.x 变体；未知变体由 `parse-failed` 降级兜底。

### 6.4 测试策略

- golden fixtures 驱动：`tests/fixtures/picos/`（17 份，已脱敏）每命令一个 describe，断言解析结构，含空表与 version 怪癖。
- framing 层用**合成 raw-frame** 测试（噪音行确切文本见 §2.2 与 `docs/research/picos-exec-channel.md`），含块聚合输出的切分用例。

## 7. MCP 工具面（Agent Interface）

### 7.1 传输与生命周期

- `@modelcontextprotocol/sdk` v1 稳定线（^1.30.0），主进程内嵌 **Streamable HTTP**：`POST /mcp`，stateful + `enableJsonResponse: true`。
- `server.listen(0, '127.0.0.1')` 随机端口；端口文件写到 userData（`mcp-endpoint.json`，内容 `{ url, token, pid, startedAt }`，权限 0600，app 退出即删）。
- SDK v2（新包名 `@modelcontextprotocol/server`）升级为后续项，实现时另行立案。

### 7.2 安全模型

- 只绑 127.0.0.1。
- 每个请求校验 Host（仅允许 `127.0.0.1:<port>` / `localhost:<port>`）与 Origin（拒绝非预期来源）——在自有薄 HTTP 层实现，**恶意 Origin 应 403 进验收测试**。
- 启动生成随机 bearer token；client 配置经 `Authorization: Bearer` 携带（token 落在 client 配置文件属可接受风险，规格注明）。
- 只读承诺双层强制：MCP 注册处只注册只读工具 + `run_show` 实现内白名单二次校验。

### 7.3 工具清单

| 工具 | 内容 | 关键参数 |
|---|---|---|
| `picos_list_profiles` | 发现：哪些 profile 存在、哪些有活跃会话 | — |
| `picos_get_device_facts` | 设备事实块 | `profile`，`includeRaw?` |
| `picos_get_interface_status` | 接口状态块 | `profile`，`interface?`（给了才取 detail），`includeRaw?` |
| `picos_get_l2_tables` | L2 块 | `profile`，`includeRaw?` |
| `picos_get_l3_tables` | L3 块 | `profile`，`includeRaw?` |
| `picos_get_recent_logs` | 日志块 | `profile`，`lines?`（默认 50），`includeRaw?` |
| `picos_collect_tech_support` | tech_support 状态机（§5.4）；长任务，返回任务句柄 + 状态查询/结果 | `profile` |
| `run_show` | 兜底透传（§7.4） | `profile`，`command` |

设备寻址显式化：诊断工具必带 `profile`（label 或 id）；「当前聚焦会话」只作 GUI 默认值，不进工具面。

### 7.4 `run_show` 白名单

- 仅放行以 `show ` 开头的命令与 `ping`（ping 校验目标合法性、count 上限）。
- 管道只允许 `count / except / find / match / no-more` 五过滤器；禁 `;` 串联；自动补 `| no-more`。

### 7.5 结果载荷与错误形状

- 默认只回 parsed 结构化数据；`parse-failed` **必带** `raw` + `reason`；parsed 成功时 raw 经 `includeRaw: true` 可选召回。
- `isError: true` 只用于：前置失败（profile 无活跃会话）与通道失败（exit≠0 / 超时，附 exit code 与 stderr 头部）。
- `parse-failed` 是**正常结果载荷**——raw 文本对 Agent 仍是有效诊断材料。

### 7.6 接入 UX

GUI 提供「复制 MCP 配置」按钮，生成 Claude Code 与 pi 两种配置片段（含 url 与 bearer token）。

## 8. 人类界面

原型裁决（[#35](https://github.com/hhubb22/picaglass/issues/35)）：**底部面板**——终端与诊断同视野。原型全貌存于 throwaway 分支 `prototype/diagnostics-ui`（commit `07e3620`），实现时按此形态重写，不直接提升原型代码。

- 诊断区 = 终端 tab 内的**底部面板**（约 46% 高），六个诊断块横排 tab，整排可收起。
- 每块内容：结构化结果表格 + 「查看原文」切换；`parse-failed` 显示降级提示条 + 原文；空表显示正常说明。
- tech_support 块：面板内启动 → 进度流（采集阶段回显）→ 产物卡（文件名 / 大小 / 已保存位置 / 打开所在目录 / 删除设备侧副本 / 重新采集）。
- 面板仅在 profile 有活跃会话时可操作，否则显示「请先连接」。

## 9. 错误与降级行为汇总

| 情形 | 行为 |
|---|---|
| profile 无活跃会话 | GUI「请先连接」；MCP `isError` + 明确文本 |
| 命令 exit≠1（如语法错误） | 工具/面板层错误，附 exit code 与 stderr 头部；不进 parser |
| 输出格式未识别 | `parse-failed`：原文 + 原因，正常呈现/返回 |
| 字段缺失 / 坏行 | 静默容忍；表格坏行计 `unparsedLines` |
| 空表 | `parsed`，rows 0 行，UI 正常说明 |
| tech_support 采集/回传失败 | 状态机进 `failed`，保留已得事实 |
| MCP 恶意 Origin / Host | 403（验收测试覆盖） |

## 10. 决策溯源

| 决策 | 来源 |
|---|---|
| 目的地与范围（同 app 演进 / 内嵌 MCP / 只读 / 六块 / 单设备 / 9.8.x 基线 / 瞬态） | 地图 #26 两轮 grilling |
| exec 通道可行性与实机事实 | [#27](https://github.com/hhubb22/picaglass/issues/27) → `docs/research/picos-exec-channel.md` |
| tech_support 流程 | [#28](https://github.com/hhubb22/picaglass/issues/28) → `docs/research/picos-tech-support-transfer.md` |
| 格式漂移与 JSON 考证 | [#29](https://github.com/hhubb22/picaglass/issues/29) → `docs/research/picos4-format-drift.md` |
| MCP 传输/安全/打包 | [#30](https://github.com/hhubb22/picaglass/issues/30) → `docs/research/electron-embedded-mcp.md` |
| golden fixtures 与命令怪癖 | [#31](https://github.com/hhubb22/picaglass/issues/31) → `tests/fixtures/picos/` |
| 通道模型 / 连接来源 / 块聚合 | [#32](https://github.com/hhubb22/picaglass/issues/32) |
| 解析层与 Parsed Result / 测试策略 | [#33](https://github.com/hhubb22/picaglass/issues/33) |
| MCP 工具面 / 载荷 / 白名单 | [#34](https://github.com/hhubb22/picaglass/issues/34) |
| 人类界面形态 | [#35](https://github.com/hhubb22/picaglass/issues/35) → 分支 `prototype/diagnostics-ui` |

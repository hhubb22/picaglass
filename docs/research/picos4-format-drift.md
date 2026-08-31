# PicOS 4.x 与 9.8.x show 输出格式差异研究

对应 ticket：hhubb22/picaglass#29（wayfinder 地图 #26 的 research ticket）。
研究日期：2026-08-31。方法：仅公开一手来源（Pica8/FS 官方 Confluence wiki、FS 官方 Troubleshooting Guide PDF），不接触设备。9.8.x 侧格式以实验室测试机实机输出为准（已在地图 Notes 记录，本文件不含任何地址或凭据）。

## 来源

- [Using Pipe (|) Filter Functions — PicOS 4.4.5](https://pica8-fs.atlassian.net/wiki/spaces/PicOS445/pages/153023908/Using+Pipe+Filter+Functions)
- [Using the show tech-support Command — PicOS 4.4.5](https://pica8-fs.atlassian.net/wiki/spaces/PicOS445/pages/153023918/Using+the+show+tech-support+Command)
- [show interface brief — PicOS 4.4.5](https://pica8-fs.atlassian.net/wiki/spaces/PicOS445/pages/153011554/show+interface+brief)
- [run show vlans — PicOS 4.4.5](https://pica8-fs.atlassian.net/wiki/spaces/PicOS445/pages/153012860/run+show+vlans)
- [run show system fan — PicOS 4.4.5](https://pica8-fs.atlassian.net/wiki/spaces/PicOS445/pages/153009235/run+show+system+fan)
- [show interface diagnostics optics all — PicOS 4.4.5](https://pica8-fs.atlassian.net/wiki/spaces/PicOS445/pages/153011574/show+interface+diagnostics+optics+all)
- [run show route forward-route — PicOS 4.4.5](https://pica8-fs.atlassian.net/wiki/spaces/PicOS445/pages/4469253/run+show+route+forward-route)
- [run show route forward-host — PicOS 4.4.5](https://pica8-fs.atlassian.net/wiki/spaces/PicOS445/pages/4469243/run+show+route+forward-host)
- [run show neighbors — PicOS 4.4.5](https://pica8-fs.atlassian.net/wiki/spaces/PicOS445/pages/4469223/run+show+neighbors)
- [run show arp — PicOS 4.4.5](https://pica8-fs.atlassian.net/wiki/spaces/PicOS445/pages/153014912/run+show+arp)
- [Changing PicOS Mode from CLI — PicOS 4.4.5](https://pica8-fs.atlassian.net/wiki/spaces/PicOS445/pages/152997869/Changing+PicOS+Mode+from+CLI)（含 go2cli 说明）
- [Displaying the Debugging Message — PicOS 4.4.5](https://pica8-fs.atlassian.net/wiki/spaces/PicOS445/pages/153024101/Displaying+the+Debugging+Message)
- [Troubleshooting Switch Crashes — PicOS 4.4.5](https://pica8-fs.atlassian.net/wiki/spaces/PicOS445/pages/153023984/Troubleshooting+Switch+Crashes)
- [Upgrading PICOS by Using Upgrade2 — PicOS 4.4.5](https://pica8-fs.atlassian.net/wiki/spaces/PicOS445/pages/232652801)（含 4.3.3 的 `run show version` 输出样本）
- [PicOS Troubleshooting Guide（FS 官方 PDF，2026 版）](https://resource.fs.com/mall/resource/picos-troubleshooting-guide-20260116155439.pdf)
- 官方 wiki 的 space 列表确认：wiki 上的 PicOS 配置指南最晚到 4.8（`Picos48white`），**没有 9.8.x 的 wiki space**；9.8.x 文档形态为 resource.fs.com 的 PDF。

## 逐块对比

### 1. 设备事实（device facts）——存在实质性漂移

`show version` 两代输出 schema 不同：

- 4.3.3（go2cli，S5860-24XB-U，来自 Upgrade2 文档样本）：`Copyright (C) ...` 横幅 + `===================================`，字段为 `Base ethernet MAC Address` / `Hardware Model` / `Linux System Version/Revision` / `L2/L3 Version/Revision` / `OVS/OF Version/Revision`（版本按组件拆成多行）。
- 9.8.7（实验室测试机实机）：单列表 `字段名 : 值`，字段为 `Copyright` / `Model` / `Software Version` / `Software Released Date` / `Serial Number` / `System Uptime` / `Hardware ID` / `License Type` / `Device MAC Address`（单一 Software Version 字段）。

→ 设备事实块的 parser 需要至少两套字段映射；这是六块中唯一确认有代际漂移的块。

`show system fan`：4.4.5 文档样本输出为 `Sensor Temperature:` 段 + `Fan Status:` 段（`Fan 1 speed = 9747 RPM, PWM = 59, Forward`）。9.8.x 侧需以 golden fixture（task #31）对照确认。

### 2. 接口状态（interface status）——格式一致

`show interface brief`：4.4.5 文档样本的表头与列（`Interface / Management / Status / Flow Control / Duplex / Speed / Description`，含 `te-1/1/1(49)` 物理端口标签括号记法）与 9.8.7 实机输出**逐列一致**。

`show interface diagnostics optics`：4.4.5 样本表头 `Interface / Temp(C/F) / Voltage(V) / Bias(mA) / Tx Power(dBm) / Rx Power(dBm) / Module Type`。

### 3. L2（vlans / mac-address / ethernet-switching）——基本一致

`run show vlans`：4.4.5 样本 `VlanID / Vlan Name / Tag / Interfaces` 表 + 长接口列表折行续排的版式。FDB 表命令（`show mac-address`）在 4.4.5 wiki 中未检索到独立输出样本页（见「局限」）。

### 4. L3（route / arp / neighbors）——命令语法与输出一致

- `show route forward-route ipv4 all`、`show route forward-host ipv4 all`：4.4.5 wiki 样本与 FS Troubleshooting Guide 样本（`Destination / NextHopMac / Port` + `Total route count:N`）一致，命令写法与 9.8.7 实机完全一致。
- `run show arp`：4.4.5 样本头部 `Aging-time(seconds): 1200` + `Total count : N` + `Address / HW Address / Type / Interface / Age` 表——与 9.8.7 实机 `run show arp` 的头部逐字一致。
- `run show neighbors`：同样的 `Aging-time/Total count` 头部。

### 5. 日志（logs）——机制与命令一致

- `file list /pica/core`、`file show /var/log/last_death | count|match`：4.4.5 wiki 与 FS Troubleshooting Guide 一致。
- syslog 机制一致：默认 RAM（`/tmp/log/messages`），`set system syslog local-file disk` 落盘到 `/var/log/messages`；`syslog monitor on` 实时监视。两代文档描述相同。

### 6. tech_support 采集——流程与产物一致

4.4.5 wiki 与 FS Troubleshooting Guide 描述一致：`show tech_support` 输出 37 项采集进度，产物写入 `/tmp/<hostname>-<时间戳>-techSupport.log`，官方建议用 SCP 回传。与 9.8.7 行为相同。

## JSON 输出能力：两代均无

- 9.8.7 实机（2026-08-31 验证）：op 模式与 go2cli 配置模式的管道均只接受 `count / except / find / match / no-more`，`display json`、`| json` 为语法错误。
- 4.4.5 官方 pipe filter 文档列出 7 个过滤器：`compare / count / display / except / find / match / no-more`——同样**无 JSON**。FS Troubleshooting Guide（2026 版）列出的也是这 7 个。
- 唯一的 JSON 踪迹：4.x Linux shell 的 `license -s` 命令输出 JSON（Upgrade2 文档样本），但这是 shell 工具而非 CLI show 管道，不在六个诊断块范围内。
- 全 wiki（各 PicOS space）检索 "json" 命中的均为 ISIS 命令文档与 RESTCONF 北向接口页，与 show 管道无关。

**结论：结构化只能走文本解析，两代皆然。**

## 传统操作模式 vs go2cli

- go2cli **不是 9.x 新引入**：4.4.5 文档已存在 go2cli 的专门说明（登录直达 CLI、`start shell sh` 进 Linux、`run show ...` 前缀）。
- 两者是同一 XorPlus/go2cli CLI 引擎的两个入口：op 模式 `show ...` 与配置模式 `run show ...` 对同一信息的输出文本相同（4.4.5 文档中 "run show" 页面展示的表格与 op 模式一致；9.8.7 实机确认两种入口输出相同）。
- `compare`、`display` 两个过滤器只在配置模式有意义（`show | compare rollback nn`、`show running-config | display set`），这解释了 9.8.7 实机 op 模式只列 5 个过滤器的现象——两代一致，不是版本差异。

## 总结论（对「解析层架构与降级策略」ticket 的输入）

1. **解析层实际需要容忍的格式变体很少**：六个诊断块中五块（接口、L2、L3、日志、tech_support）在 4.4.x ↔ 9.8.x 之间输出格式基本一致（同一 CLI 引擎血脉）；唯一确认的代际漂移是 `show version` 的字段 schema。
2. **「只保 9.8.x + 解析失败降级兜底」策略成本成立**：两代无 JSON 使解析层无法绕过文本解析；漂移风险集中在设备事实块一处，Parsed Result 的「原文 + 失败标记」降级语义足以覆盖未知变体。
3. **支持 4.x 的增量代价量级：小但不可验证**。技术上是「show version 增加一套 4.x 字段映射 + 每块补 4.x golden fixture」量级；但实验室无 4.x 实机，fixtures 只能来自文档样本（可信度低于实机采集），无法达到与 9.8.x 同等的验证强度。建议维持「保 9.8.x，4.x 尽力解析 + 降级」。

## 局限

- 4.x 考证集中在 4.3.3–4.4.5（wiki 文档样本最完整的末代 4.x）；更早的 4.0/4.2 未逐页考证。
- 4.4.5 wiki 中未找到 FDB 表（`show mac-address` 系）与 `show log last` 的独立输出样本页；这两处以「格式推测一致 + 降级兜底」处理。
- 文档样本可能经过编辑美化（如表头空格），可信度低于实机 fixture。

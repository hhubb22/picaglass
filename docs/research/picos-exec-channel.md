# PicOS 非交互 exec 通道行为（实机验证）

对应 GitHub issue: hhubb22/picaglass#27（Wayfinder 地图 #26 的 research ticket）

实验对象：实验室测试机（FS S5810-28FS，PicOS 9.8.7-main-EC1，armv7l，xorp L2/L3 模式，trial license）。所有实验均通过 `ssh -T`（显式禁用 PTY 分配）执行，即真实 exec channel 场景。

## 结论速览

非交互 exec channel 上执行 PicOS CLI 的推荐方式是：

```
ssh -T admin@<box> "cli -c '<cmd>'"
```

- `cli` 位于 `/usr/bin/cli`（实为 `/pica/bin/pica_sh`，xorp 的 pica_sh）。
- 退出码可靠：成功 0，语法/执行错误 1。
- 分页、回显、ANSI 控制序列在无 PTY 下天然不出现，无需 `| no-more`。
- 但「NOTICE TO USERS」banner、`Synchronizing configuration...OK.`、提示符行、`Execute command: <cmd>` 回显、提示行首的 `.` 等噪音仍会出现，**必须由采集端剥离**。

## 详细发现

### 1. 非交互调用方式与 CLI 二进制

- 裸 `ssh -T admin@<box> "show version"` **不行**：默认 shell 是 bash，报错 `bash: line 1: show: command not found`（退出码 127）。
- 正确方式：`ssh -T admin@<box> "cli -c 'show version'"`。
- `cli -h` 输出（原样引用）：

  ```
  Usage: pica_sh [options]
  Options:
    -c        Specify command(s) to execute
    -e        Exit immediately if cannot connect to the rtrmgr
    -h        Display this information
    -v        Print verbose information
    -t <dir>  Specify templates directory
    -x <dir>  Specify Xrl targets directory
    -F <finder_hostname>[:<finder_port>]  Finder hostname and port
  Defaults:
    Templates directory        := /pica/etc/S5810-28FS/templates
    Xrl targets directory      := /pica/xrl/targets
  ```

- 单条命令：`cli -c 'show version'`。多条命令：可用多个 `-c`，也可在一个 `-c` 里用 `;` 或 `\n` 分隔（后者在配置模式 `run show` 下验证可用）。

### 2. 输出干净度（无 PTY 下）

以下噪音**仍然存在**，采集端必须剥离：

1. 首行 `Synchronizing configuration...OK.` —— 每次 `cli` 启动都有。
2. 「NOTICE TO USERS」trial-license banner 整段 —— 每次 `cli` 启动一次（banner 文本存在于 `/pica/bin/pica_sh` 与 `/pica/bin/xorp_rtrmgr` 二进制内，未发现可关闭的开关）。
3. `Welcome to PICOS`。
4. 提示符行 `admin@PICOS> `（操作模式）或 `admin@PICOS# `（配置模式）。
5. `Execute command: <cmd>` 回显行。
6. 命令执行前的 `.` 单独一行（pica_sh 表示"正在执行"的指示符）。

以下噪音**不出现**（已实测确认）：

- `--More--` 分页：无 PTY 时 cli 自己关掉了 pager，`show interface brief`（33 行）一次出完，无 `--More--`。
- ANSI 转义序列（`[J` 等）：无 PTY 时未观察到。
- 行尾为 `\r\n`（CRLF），解析器须按 `\r?\n` 切行。

`| no-more` 管道在无 PTY 下不是必须的（实测不带它也完整出完），但**保留它作为防御**没有代价，建议保留。

### 3. 失败行为与退出码

- 语法错误命令（`show boguscmd`）：stderr/stdout 均输出错误文本，**进程退出码 1**。输出含：
  - 指位符 `                  ^`
  - `syntax error, expecting 'analyzer', 'arp', ...`（完整候选词列表）
  - `Failed to execute command line "show boguscmd\n"`
- 成功命令：退出码 0。
- `cli -e` 与不带 `-e` 在命令失败场景下退出码一致（都是 1）；`-e` 的差别只在"连不上 rtrmgr 时立即退出"，未实测此路径（需 rtrmgr down，风险大，未做）。

### 4. 配置模式 `run show ...` 的非交互等价物

- 单个 `cli -c` 里用 `;` 串联：`cli -c 'configure; run show arp'` 实测成功，输出配置模式提示符 `#` 下的 `run show arp` 结果。
- 多个 `-c` 分次传入 `configure` 与 `run show arp` 的组合在第一种形态（`cli -c 'configure' -c 'run show arp'`）下验证可行；同一 `-c` 内 `;` 串联亦可。
- 注意：`cli -c 'configure; run show arp'` 的 EC 是 0；但 `cli -c 'configure' 'run show arp'`（两个独立 `-c`）的第二个命令如果失败会把整个 cli 退出码置 1（见 B 节测试）。

### 5. 并发 exec channel

- 4 个并发 `ssh -T ... "cli -c 'show arp'"`：全部成功，总耗时约 5s（单条串行约 2s）。
- 8 个并发同样全部成功，总耗时约 10s，8/8 拿到 `Total count` 输出。
- 未观察到设备侧会话限制报错；>8 未测。
- 设备 `Synchronizing configuration...OK.` 与 banner 每次都出现，意味着每次 cli 启动都要和 rtrmgr 做一次配置同步，高频并发下的开销不可忽略。

## 对「命令执行通道模型」决策（issue #32）的输入

- 非交互 exec channel **可行**，且比持久 PTY 抓取干净得多（无 pager、无 ANSI、有可靠退出码）。
- 代价：每条命令都要付一次 cli 启动开销（~1.5–2s，含配置同步 + banner），banner 噪音需要剥离。
- 若 GUI/MCP 侧需要批量下发多条命令，可考虑单条 SSH 会话内 `cli -c 'c1; c2; c3'` 复用，或在采集端按块（Diagnostic Block）聚合命令，一次 cli 调用跑完一个块。

## 来源

- 全部结论来自实验室测试机实测（`ssh -T admin@<box> "..."`，expect 驱动输入密码），2026-08-31。
- `cli -h` 帮助文本为 `/usr/bin/cli`（pica_sh）自身输出，引用见上。

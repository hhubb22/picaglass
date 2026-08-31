# tech_support 采集与回传路径（PicOS 9.8.7 实机验证）

> Wayfinder ticket #28 的 findings。2026-08-31 在实验室测试机（FS S5810-28FS，PicOS 9.8.7-main-EC1，armv7l，xorp L2/L3 模式，trial license）上实测；命令行为与官方 FS PicOS Troubleshooting Guide 的描述逐条对照。

## 1. 采集：耗时、产物、完成判定

- **耗时约 7 分钟**（09:01 启动 → 09:08 文件停止增长、采集进程退出）。官方 Troubleshooting Guide 未给出时长承诺，仅描述 37 项采集内容；实测值以本机为准，会随配置规模/拓扑变化。
- **产物**：`/tmp/<hostname>-<yyyymmddhhmm>-techSupport.log`，本次 2,572,353 字节（约 2.5MB）；同机历史产物 288KB–2.5MB 不等，大小取决于配置与表项规模。
- **文件内无完成标记**：完整产物以 LLDP 邻居表打印收尾（本机 65 个 `==========` 分节），但结尾没有 "complete/done" 之类的标志行。**完成判定只能看采集进程是否退出**（`ps aux | grep 'show tech_support'` 中 `pica_sh` 进程消失），不能靠文件内容或「大小不再增长」单独断定（采集中途也有几十秒的静默期）。
- **必须脱离 SSH 会话运行**：上一轮验证中采集随 SSH 会话断开而被杀，留下半截产物。正确做法是 shell 里 `nohup cli -c 'show tech_support' >/dev/null 2>&1 &`，之后用独立的非交互 exec 轮询。这也决定了 app 侧的交互模型：tech_support 不是「一条命令等结果」，而是「后台启动 → 轮询 → 回传」的三段式。

## 2. 回传：拉取可用，推送不可用

- **scp 拉取可用**：从管理机 `scp admin@<box>:/tmp/<file> .` 实测 2.5MB 一秒内完成（约 8MB/s），md5 与设备侧一致。
- **sftp 可用**：设备 sshd 的 sftp 子系统就绪，交互式会话正常列目录/取文件。注意 OpenSSH 已知行为：`sftp -b` 批处理模式下密码提示次数为 0，密码认证会直接 `Permission denied`——自动化要么用 expect 驱动交互式 sftp，要么用 scp。**推荐 scp**，单文件场景最简单。
- **CLI `file copy` 不支持 URL 推送**：9.8.7 实机上 `file copy /tmp/x scp://...` 把目标当本地路径直接报 `cp: cannot create regular file 'scp://...'`——该命令只做本地拷贝。官方文档中提到的 SCP 回传指的就是从管理机侧拉。**结论：回传通道按「管理机主动拉取（scp/sftp）」设计，不依赖设备推送。**

## 3. /tmp 容量与清理

- /tmp 为 **50MB tmpfs**；单份产物约 2.5MB（约 5%），单次采集空间余量充足。
- **产物不会自动清理**：设备 /tmp 里累积了多份历史/中断产物。中断的采集同样留下半截文件，需主动清理。
- **清理权限坑**：/tmp 带 sticky bit（`drwxrwxrwt`），产物属 root:xorp，admin 在 shell 里 `rm` 会 `Operation not permitted`；可用 `sudo rm`（admin 有免密 sudo）或 **CLI `file delete /tmp/<file>`**（经 pica_sh 提权执行，实测可删 root 属主的产物）。
- **建议的 app 语义**：回传校验（如 md5/size 比对）成功后，用 `cli -c 'file delete ...'` 清理设备侧产物；采集前可先 `file list /tmp` 检查残留与余量。

## 4. trial license 的影响

**无功能差异**：`show tech_support` 在 trial license 设备上完整跑完 65 个分节（含硬件诊断、BCM 表、光模块、日志打包等），未发现任何一项因 license 被裁剪。

## 5. 对规格的输入（结论汇总）

1. tech_support 诊断块 = 后台启动（nohup 脱会话）+ 进程退出轮询 + scp 拉取 + 校验后 `file delete` 清理。
2. 完成信号是「`pica_sh -c show tech_support` 进程消失」，不是文件内容。
3. 回传只设计拉取方向；设备侧无可用推送命令。
4. 轮询间隔 3–5 分钟、总时长预算（本机约 7 分钟，建议规格写「典型 5–15 分钟，超时 30 分钟告警」）需容忍慢设备。

## 来源

- 实机验证（2026-08-31）：本文所有命令行为、耗时、文件大小、权限观察均来自实验室测试机实测。
- FS《PicOS Troubleshooting Guide》（resource.fs.com）：37 项采集内容、产物命名与 SCP 回传建议的官方描述。
- Pica8 wiki「Using the show tech-support Command」（PicOS423sp space）：产物路径 `/tmp/<hostname>-<time>-techSupport.log` 与「连同系统日志一并提交厂商」的官方建议。

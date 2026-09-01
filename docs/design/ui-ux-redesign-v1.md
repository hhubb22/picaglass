# UI/UX 重设计规格 v1

> Wayfinder 地图 [#55](https://github.com/hhubb22/picaglass/issues/55) 的 destination。
> 决策来源：[#57 研究](https://github.com/hhubb22/picaglass/issues/57)（`docs/research/design-tokens-console-style.md`）、
> [#58 控件粗稿](https://github.com/hhubb22/picaglass/issues/58)、[#59 布局粗稿](https://github.com/hhubb22/picaglass/issues/59)、
> [#60 token 定稿](https://github.com/hhubb22/picaglass/issues/60)。
> 现状基线截图：`docs/design/baseline/`；风格参考图：`docs/design/references/`。
> 本文档自包含：实施 agent 只需本文档 + 代码库，不需要回溯上述票据。

## 1. 目标与设计原则

现状症结：控件层级弱（所有按钮一个样）、窗口拥挤（终端与诊断面板上下互抢）、
浅色"console"风格目标未达成（参照 Twingate / Tailscale / Linear）。

原则（每条都可检验）：

1. **边框优先，阴影极浅**：卡片靠 1px 浅灰边，不用投影；阴影只允许出现在控件微投影与对话框。
2. **层级靠灰度与字重，不靠颜色**：正文/次要/禁用三层灰；标题靠 500/600 字重，不靠字号跳跃。
3. **状态色只画"点"不铺"块"**：在线/警告/错误用 8–10px 圆点或小图标 + 常规灰黑文字。
4. **accent 唯一且克制**：全站只有一个 accent 蓝，只给 focus ring、文字链接、选中态。
5. **primary 按钮全屏最多一个**：深色实心只给当前主行动；其余用描边 secondary 或文字 quiet。
6. **4px 基网**：所有间距/内边距收敛到间距阶梯，禁止自由值。

## 2. Token 表（浅色）

```css
:root {
  /* ── 画布与表面 ── */
  --bg-app: #F7F5F4;            /* 页面画布、侧栏（暖灰） */
  --bg-surface: #FFFFFF;        /* 卡片 / 面板 / 输入框 / 对话框 */
  --bg-disabled: #FAF9F8;       /* 禁用输入框底 */
  --bg-hover: #EEEBEA;          /* 列表 / 菜单 / quiet 按钮 hover */
  --bg-active: #FFFFFF;         /* 侧栏选中项（白卡 + --border-base 描边） */

  /* ── 文字 ── */
  --text-base: #232222;         /* 正文 / 标题 */
  --text-muted: #706E6D;        /* 标签 / 次要 / quiet 按钮 */
  --text-disabled: #AFACAB;     /* 禁用 / placeholder */
  --text-on-primary: #FFFFFF;

  /* ── 边框 ── */
  --border-base: #EEEBEA;       /* 结构分隔 / 卡片 / 表格行 */
  --border-control: #DAD6D5;    /* 按钮 / 输入框 */
  --border-control-hover: #AFACAB;

  /* ── accent ── */
  --accent: #3F5DB3;            /* focus ring 第二圈 / 链接 / 选中态 */
  --accent-hover: #324994;

  /* ── 主按钮 ── */
  --primary-bg: #232222;
  --primary-bg-hover: #444342;

  /* ── 状态色 ── */
  --status-ok: #33C27F;         /* 在线 / 成功 点 */
  --status-warn: #D9A21B;       /* 警告 点 */
  --status-danger: #D04841;     /* 错误 点 / 图标 */
  --status-info: #4B70CC;       /* 进行中 / 信息 */
  --text-danger: #940821;       /* 危险文字 / 错误文案 */
  --danger-fill: #FDECEC;       /* 危险按钮底 */
  --danger-fill-hover: #FBDCDC;

  /* ── 圆角 ── */
  --radius-control: 6px;        /* 按钮 / 输入框 */
  --radius-card: 8px;           /* 卡片 / 对话框 / 面板 */
  --radius-full: 999px;         /* pill / 状态徽章 */

  /* ── 阴影（只有这两种） ── */
  --shadow-control: 0 1px 1px rgba(0, 0, 0, 0.04);
  --shadow-dialog: 0 10px 40px rgba(0, 0, 0, 0.12), 0 0 16px rgba(0, 0, 0, 0.08);

  /* ── 间距（4px 基网七档） ── */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-7: 32px;

  /* ── 字号 ── */
  --font-xs: 12px;  /* 表单标签（uppercase）/ 表头 / 小按钮 / 辅助行 */
  --font-sm: 13px;  /* 控件 / 表格 / hint */
  --font-md: 14px;  /* 正文 / 表单值 / 侧栏列表 / 对话框标题(600) */
  --font-xl: 20px;  /* 设备名 / 页标题（600） */

  /* ── 控件尺寸 ── */
  --control-h: 32px;
  --control-h-sm: 28px;

  --transition-fast: 120ms ease;
}
```

规则：

- 字重只用 400 / 500 / 600；行高 1.4。
- `uppercase` 只允许两处：表单标签（`--font-xs` + 0.04em 字距 + `--text-muted`）。表头同字号字色但**不** uppercase。
- 终端专属 `--terminal-bg` / `--terminal-fg` 独立维护，不并入本表。
- 单层语义变量，无 primitive 层；深色模式将来只改值、不改名。

## 3. 布局

### 3.1 App 骨架

```
┌────────────────────────────────────────────────────────────────┐
│ 侧栏（固定 288px，--bg-app） │ 内容区（flex 1，--bg-app）        │
│ ┌──────────────────────────┐ ┌───────────────────────────────┐ │
│ │ Picaglass  20px/600      │ │ 工作区 nav（高 46px）          │ │
│ │ [Hide sidebar]           │ │ Overview │ Terminal │ 诊断    │ │
│ │ "Connection Profiles"    │ ├───────────────────────────────┤ │
│ │ 搜索框 32px              │ │                               │ │
│ │ ┌ 列表项 ──────────────┐ │ │        tab 内容区             │ │
│ │ │ 设备名 14px/500      │ │ │   （padding --space-2=8px）   │ │
│ │ │ ● 状态行 12px        │ │ │                               │ │
│ │ └──────────────────────┘ │ │                               │ │
│ │ …（gap --space-2）       │ │                               │ │
│ ├──────────────────────────┤ │                               │ │
│ │ 底部菜单三钮（32px 高）   │ │                               │ │
│ └──────────────────────────┘ └───────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
侧栏内边距 --space-4；列表项 padding 8px 12px、圆角 --radius-card。
侧栏与内容区之间：1px --border-base（不要近黑边）。
```

### 3.2 Profile 工作区（三 tab）

`WorkspaceTab` 扩为 `'overview' | 'terminal' | 'diagnostics'`。
tab 切换保持各 tab 的组件挂载状态（终端不卸载重开）。

- **Terminal**：终端独占全部内容区（诊断面板从此页移除）。
  右上角工具行：Cancel（连接中时）/ Clear Terminal，28px 档。
- **诊断**：诊断面板独占内容区（见 3.3）。
- **Overview**：现有卡片排布保留（Session / Machine Snapshot / Host Trust /
  Last Attempt 两列 grid，gap `--space-4`），仅样式 token 化。

### 3.3 诊断页（#59 收敛的 B 方向）

```
┌ 诊断 tab ──────────────────────────────────────────────────┐
│ [设备事实] [接口状态] [L2] [L3] [日志] [tech_support 采集]  │ ← 块 tab 栏
│ ┌────────────────────────────────────────────────────────┐ │
│ │ 面板：--bg-surface 白卡，1px --border-base，r8，全宽全高│ │
│ │ ┌ 块操作行（padding 8px 16px，1px --border-base 下边框）┐│ │
│ │ │ [Refresh 32px] [Load detail] [查看原文]    （按块）   ││ │
│ │ ├──────────────────────────────────────────────────────┤│ │
│ │ │ 块内容区 padding --space-4=16px，组内 gap --space-3   ││ │
│ │ │  ┌ 子卡（如 Device Facts 分组）：白卡 r8 1px 边，     ││ │
│ │ │  │  padding 16px，定义列表行距 --space-2=8px          ││ │
│ │ │  └──────────────────────────────────────────────────┘││ │
│ │ └──────────────────────────────────────────────────────┘│ │
│ └────────────────────────────────────────────────────────┘ │
```

- 诊断面板不再有"收起/展开"（无收起态，也不需要默认折叠）。
- 块 tab 栏与块操作行的间距：tab 栏下缘贴面板顶边。
- 表格行高按内容自撑，单元格 padding `--space-1 --space-2`（4px 8px）。

## 4. 组件约定

### 4.1 按钮

四级 kind × 两档尺寸。标注方式：`data-kind="primary|danger|quiet"`，
缺省为 secondary；`data-size="sm"` 选 28px 档（工具条/行内操作），缺省 32px。

| kind | 背景 | 边框 | 文字 | hover | disabled |
|---|---|---|---|---|---|
| secondary（默认） | `--bg-surface` | 1px `--border-control` | `--text-base` | 边框升 `--border-control-hover` | opacity .45 |
| primary | `--primary-bg` | 无 | `--text-on-primary` | `--primary-bg-hover` | opacity .45 |
| danger | `--danger-fill` | 无 | `--text-danger` | `--danger-fill-hover` | opacity .45 |
| quiet | transparent | 无 | `--text-muted` | 底 `--bg-hover` | opacity .45 |

- 尺寸：32px 档 `padding: 5px 12px; font: 13px/500`；28px 档 `padding: 3px 10px; font: 12px/500`。
- 圆角 `--radius-control`；投影 `--shadow-control`（quiet 无投影）；过渡 `--transition-fast`。
- focus（全部 kind 统一）：`outline: 2px solid var(--accent); outline-offset: 2px`（白底上呈双层 ring 观感）。
- 导航性按钮（侧栏列表项、tab）**不**套按钮样式，走各自约定。

### 4.2 输入框与表单

- 输入框：高 `--control-h`，白底，1px `--border-control`，r6，padding `0 12px`，14px 字。
  hover 边框 `--border-control-hover`；focus 同按钮 ring；disabled 底 `--bg-disabled` 字 `--text-disabled`；
  校验错误边框 `--status-danger`、错误文案 13px `--text-danger`。
- 表单标签：12px / uppercase / 0.04em / `--text-muted`，与输入框间距 `--space-1`。
- 表单行距 `--space-3`（12px）；hint 13px `--text-muted`（不 uppercase）。

### 4.3 对话框

白卡 r8，1px `--border-base`，`--shadow-dialog`，遮罩 `rgba(0,0,0,0.3)`，
padding `--space-4`，宽度 `fit-content`（max 90vw）。标题 14px/600 `--text-base`。
按钮区右排、gap `--space-2`：主行动（primary 或 danger）在前，`Cancel` 恒为 quiet 殿后。

### 4.4 状态指示

- 连接/诊断状态 = 8px 圆点（`--radius-full`）+ 常规文字，圆点色取 `--status-*`，文字不铺色。
- "Verification required" 等提示：13px `--text-muted` + 警告点，不用横幅色块。

### 4.5 卡片

`--bg-surface`，1px `--border-base`，r8，**无阴影**，padding `--space-4`。
卡标题 14px/600；卡内定义列表：标签 `--text-muted`、值 `--text-base`，均 14px，行距 `--space-2`。

### 4.6 表格

13px；表头 12px/500/`--text-muted`（不 uppercase），底边框 1px `--border-base`；
行间 1px `--border-base`；单元格 padding `--space-1 --space-2`；
数值/接口名等列可用等宽字体栈。

### 4.7 tab 导航（工作区 nav 与诊断块 tab 通用）

未选中：13px/500 `--text-muted`，无边无底；选中：`--text-base` + 底部 2px `--text-base` 下划线；
hover：`--text-base`。高 46px 栏内垂直居中。

### 4.8 侧栏

底 `--bg-app`；列表项圆角 r8、padding `8px 12px`；hover 底 `--bg-hover`；
选中项 = 白卡（`--bg-surface` + 1px `--border-base`），不要灰块。
设备名 14px/500 `--text-base`；状态行 12px `--text-muted` + 状态点。

### 4.9 终端岛

终端保持深色直角方块直接置于画布，不加卡片包装、不加圆角；`--terminal-bg`/`--terminal-fg` 不变。

## 5. 深色映射原则（数值留待后续票）

1. 只改 `:root` 语义变量的值，不改名、不加组件分支。
2. 保留双背景分层：深色画布比卡片**更深**（如画布 `#1F1E1E`、卡片 `#232222` 级），层级方向与浅色相反。
3. 状态色同色相提明度保对比；`--text-danger` 类文字色同步调亮。
4. 边框优先原则不变；深色下阴影权重更低，浮起表面靠 1px 边框。
5. 终端岛不动。

## 6. 实施约定

- 顺序：(1) token 落地与旧变量重命名 → (2) 按钮/表单控件 → (3) 布局 B（诊断独立 tab）→
  (4) 卡片/表格/侧栏/对话框 → (5) 深色映射。
- 旧 → 新映射（现状全部变量只有这些）：`--fg`→`--text-base`；`--muted`→`--text-muted`；
  `--bg`→按用途分 `--bg-app`（画布/侧栏）与 `--bg-surface`（卡片/面板/输入框/对话框）；
  `--hover`→`--bg-hover`；`--border`→结构分隔处 `--border-base`、控件处 `--border-control`；
  `--status-live`→`--status-ok`；`--status-pending`→`--status-warn`；`--status-danger` 改名留用、值换 `#D04841`；
  `--status-idle`→`--text-disabled`；`--overlay` 保留（值微调 `rgba(0,0,0,0.3)`）；
  `--shadow`→`--shadow-dialog`；`--motion`→`--transition-fast`；`--terminal-bg` 保留不动。
  全局 `:focus-visible` 的 `outline` 由 `var(--fg)` 改 `var(--accent)`。
  一次性重命名，不留兼容别名。
- 正式实现直接改各组件 scoped 样式；**禁止 `!important`**（粗稿的覆盖手段不得进 main）。
- 每步用 `scripts/baseline/capture.mjs` 出图与 `docs/design/baseline/` 对比
  （支持 `BASELINE_ONLY`/`BASELINE_OUT` 筛选场景；mock payload 由 `generate-payloads.ts` 生成）。

## 7. 验收

任挑一个诊断块，agent 仅凭本文档实施，出截图由用户确认无需返工（本票已用「接口状态」块验证）。

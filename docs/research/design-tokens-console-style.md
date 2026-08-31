# 调研：浅色控制台设计 token 参照（Wayfinder #57）

> 目的：为「token 定稿票」提供带来源的对照表——从 Tailscale、Twingate、Linear 等"冷静控制台"风格产品提炼浅色管理控制台的设计 token 惯例。
> 资料分级：**一手** = Tailscale 官方开源源码（`client/web` 设计 token）、Tailscale 官方博客、Linear 官方品牌页、Vercel Geist 公开文档站 CSS 变量；**截图估算** = 本仓库 `docs/design/references/` 三张参考图（Twingate 控制台无公开样式表，其色值/尺寸为像素级目测估算，标注"≈"）。

## 结论速览

- **中性色板是"暖灰 + 双背景"**：页面用浅暖灰（Tailscale `#F7F5F4`）或纯白（Twingate），卡片纯白，边框用比背景深一档的灰（`#EEEBEA`/`#E5E7EB` 级）。Tailscale 浅色模式**只用两个背景色**（white + gray-100）构建层级。
- **语义化三层文字色是通例**：`text-base`（近黑，`#232222`/`#222326` 级）/ `text-muted`（中灰标签，`#706E6D` 级）/ `text-disabled`（浅灰，`#AFACAB` 级）；链接/主操作另设一个低饱和蓝（Tailscale `#3F5DB3`，Linear 品牌蓝同为"desaturated blue"）。
- **字号阶梯小、字重克制**：正文 14–16px，详情标签/值同号（14px）仅靠灰度区分；标题 18–28px 用 medium(500)/semibold(600)，**不用 700+ 粗黑**；小节标题用 11–12px 全大写 + 加宽字距的中灰文字。
- **边框优先、阴影极浅**：卡片靠 1px 浅灰边界而非投影；阴影最高只到 `rgba(0,0,0,0.04)–0.12`，圆角控件 6–8px、卡片 8–16px。
- **状态色只做"点"不做"块"**：成功/在线 = 亮绿小圆点（Tailscale green `#33C27F` 级、Twingate ≈`#22C55E`），危险 = 深红文字 `#940821` 级，警告 = 深橙文字 `#7E1E23` 级，进行中/信息 = 品牌蓝；状态以 8–12px 圆点或小图标 + 常规灰黑文字呈现，不大面积铺色。
- **按钮矮小紧凑**：高 32–38px、`py-2 px-4`（8×16px）级内边距、font-medium、`rounded-md`，次按钮用浅灰填充或 1px 边框，图标按钮用同高方形描边按钮。
- **定义列表式详情排版**：标签列灰（`gray-500`）、值列近黑（`gray-800`），同字号同行高，行距 8px 级，可复制值后跟蓝色 `Copy` 文字链接，分组用全大写小字标题。

## 事实与来源

### 1. 中性色板层级

**Tailscale（一手源码，`client/web/src/index.css` 的 `:root`）**——暖灰阶梯，全部以 CSS 变量定义，语义色引用阶梯色：

| 层级 | 值 | 语义用途 |
|---|---|---|
| white | `#FFFFFF` | 卡片/输入框表面 |
| gray-0 | `#FAF9F8` | 禁用输入框底 |
| gray-50 | `#F9F7F6` | — |
| gray-100 | `#F7F5F4` | **`bg-app` 页面画布**、菜单 hover |
| gray-200 | `#EEEBEA` | **`border-base` 默认边框** |
| gray-300 | `#DAD6D5` | 输入框边框 |
| gray-400 | `#AFACAB` | **`text-disabled`**、placeholder、输入框 hover 边框 |
| gray-500 | `#706E6D` | **`text-muted`（标签/次要文字）** |
| gray-600 | `#444342` | — |
| gray-700 | `#2E2D2D` | — |
| gray-800 | `#232222` | **`text-base` 正文/标题** |
| gray-900 | `#1F1E1E` | 最深文字（深色模式基底） |

来源：<https://github.com/tailscale/tailscale/blob/main/client/web/src/index.css>（`:root` 变量块）。Tailscale 官方博客证实浅色模式层级策略："we only use two background colors"，"what we have between `white` and `gray-100` has worked well"，并明确文字只用 `-text-base` / `-text-muted` / `-text-disabled` 三个语义色（经过对比度测试）。来源：<https://tailscale.com/blog/heart-of-dark-mode>。

注：`client/web` 是节点内嵌 Web UI，但与 admin console 共享同一设计系统——官方博客原文："the admin console is where all the web components are hosted, and all the design system 'logic' is encoded (like color definitions and relationships, typographic rules…)"（<https://tailscale.com/blog/heart-of-dark-mode>）。

**Twingate（截图估算，`twingate-device-detail.png` / `twingate-connector-detail.png`）**：画布纯白 `#FFFFFF`；标签灰 ≈`#6B7280`；正文近黑 ≈`#171717`；次按钮浅灰填充 ≈`#F3F4F5`；卡片边框 ≈`#E7E7EA`；头像底灰圆 ≈`#F1F1F2`。整体阶梯与 Tailscale 同构，只是更偏纯灰（不暖）。

**Linear（官方品牌页）**：浅色基准 Mercury White `#F4F5F8`（RGB 244,245,248），深色基准 Nordic Gray `#222326`（RGB 35,35,38），品牌主色自述为"a subtle desaturated blue"。来源：<https://linear.app/brand>（页面实测 HTML 中的色票数据）。与 Tailscale `#232222` 几乎相同的近黑印证"文字近黑 ≠ 纯黑"惯例。

**Vercel Geist（公开文档站实测变量，佐证命名惯例）**：`--ds-background-100`（页面）/ `--ds-background-200`（次级底）、`--ds-gray-100…1000` 阶梯、`--ds-gray-alpha-*` 半透明边框。来源：<https://vercel.com/geist/colors>（实测页面 HTML 中的 utility class）。

### 2. 字号阶梯与字重

**Tailscale（一手源码）**：

- 全局：Inter（可变字体），`font-size: 16px; line-height: 1.4; letter-spacing: -0.015em`（注释："Inter is a little loose by default"）；字重只定义 400/500/600/700 四档。
- 页标题 h1：**22px / medium(500)** / gray-800 / 行高 30.8px。
- 区块标题 h2：**14px / medium / 全大写 / tracking-wide** / gray-500；详情卡内 h2 降到 **12px / semibold / 全大写 / tracking-wide**。
- 详情卡 h1：18px / medium。
- 定义列表：标签与值**同为 14px**（`text-sm leading-tight`），仅靠 gray-500 vs gray-800 区分。
- 等宽字体栈（SFMono-Regular → Consolas → Menlo）用于 key、tag 等技术值。

来源：<https://github.com/tailscale/tailscale/blob/main/client/web/src/index.css>（base/components 层）；字重表见 <https://github.com/tailscale/tailscale/blob/main/client/web/tailwind.config.js>。

**Linear（一手）**：`linear.app` 全站 preload `InterVariable.woff2`，即官方 UI 字体为 Inter Variable。来源：<https://linear.app/brand> 实测 HTML `<link rel="preload" … InterVariable.woff2>`。

**截图印证**：`tailscale-machine-details.png` 中 "Machine Details" ≈20px semibold、"ATTRIBUTES/ADDRESSES" 等分组头为 ≈11–12px 全大写加宽字距灰字——与源码规则一致；`twingate-device-detail.png` 页标题 "Sam's Device" ≈28px semibold，副标题 "Last signed in 15 hours ago" 为同族灰字。

**惯例提炼**：14/16px 正文基准；标题 18→22→28px 阶梯；层级靠**字重 500/600 + 灰度**而非字号跳跃；全大写小字标题是详情页分组的通用手法。

### 3. 间距阶梯

- Tailscale 全部基于 Tailwind 4px 基线：定义列表行距 `gap-2`（8px）、输入框 `px-3`（12px）、按钮 `py-2 px-4`（8×16px）。来源：同上 index.css。
- Vercel Geist 文档站实测：区块 padding `p-4`（16px）、导航/工具条 `gap-4`（16px）、搜索框高 32px。来源：<https://vercel.com/geist/colors> 实测 class。
- 截图估算：Twingate 详情页卡片内边距 ≈24px、区块间垂直节奏 ≈32–48px、定义列表行距 ≈20–24px（值行更高容纳两行）；Tailscale 详情卡行距紧凑 ≈8px。

**惯例提炼**：4px 基线，常用阶梯 4/8/12/16/24/32/48；详情列表行距 8–12px，卡片内边距 16–24px，大区块间隔 32–48px。

### 4. 圆角

- Tailscale：按钮/输入框 `rounded-md`（6px）；截图中详情卡 ≈8px。来源：index.css、`tailscale-machine-details.png`。
- Twingate（截图估算）：按钮 ≈8px；状态/安全卡片 ≈12–16px；头像与状态点为全圆。
- Geist：控件 `rounded`（≈5–6px），kbd/头像 `rounded-full`。来源：<https://vercel.com/geist/colors> 实测 class。

**惯例提炼**：控件 6–8px，卡片 8–16px，头像/状态点/键帽 full；同一页面圆角不超过 2–3 档。

### 5. 边框与阴影的克制用法

**Tailscale（一手源码，tailwind.config.js boxShadow）**：

| 名称 | 值 | 用途 |
|---|---|---|
| form | `0 1px 1px rgba(0,0,0,0.04)` | 按钮/输入框微投影 |
| soft | `0 4px 12px 0 rgba(0,0,0,0.03)` | 轻量浮起 |
| dialog | `0 10px 40px rgba(0,0,0,0.12), 0 0 16px rgba(0,0,0,0.08)` | 对话框（最重） |
| popover | `0 0 0 1px rgba(136,152,170,0.1), 0 15px 35px 0 rgba(49,49,93,0.1), 0 5px 15px 0 rgba(0,0,0,0.08)` | 浮层先加 1px 半透明描边再叠影 |

来源：<https://github.com/tailscale/tailscale/blob/main/client/web/tailwind.config.js>。官方博客补充设计原则：浅色模式靠 white vs gray-100 的亮度差分层，"a black shadow at 10% opacity easily adds enough depth in light mode"；浮起表面**加 1px border** 是关键手法。来源：<https://tailscale.com/blog/heart-of-dark-mode>。

**焦点样式**：按钮/开关用 1px 级 ring，admin console 后来统一改为 `outline`（"we chose `outline`, as it's a little more accessible"）。来源：index.css `.button:focus-visible`、博客 "Who's afraid of the dark?" 一节。Geist 焦点环为三层叠加 `0 0 0 1px border, 0 0 0 2px background, 0 0 0 4px focus-color`。来源：<https://vercel.com/geist/colors> 实测 class。

**截图印证**：Twingate 两张参考图的卡片只有 1px 浅灰边、无可见投影；Tailscale 详情卡同为描边而非投影。

### 6. 状态色（成功/警告/危险/进行中）

**Tailscale 语义映射（一手源码）**：

| 状态 | 语义 token | 值 | 使用场景（源码实证） |
|---|---|---|---|
| 主操作/链接/进行中 | `text-primary` = blue-600 | `#3F5DB3` | 链接文字（hover 升 blue-700 `#324994`）；toggle 选中用 blue-500 `#4B70CC`；选区底色 `rgba(97,122,255,0.2)` |
| 成功/在线 | green 阶梯 | 亮点绿 `#33C27F`（green-200）、文字级 `#09825D`（green-400）/`#0E6245`（green-500） | 截图中 "● Connected" 绿点 |
| 警告 | `text-warning` = orange-600 | `#7E1E23` | 警告文字（深橙，保证浅底对比度） |
| 危险/错误 | `text-danger` = red-600 | `#940821` | 危险文字/破坏性链接（hover red-700）；图标级红 `#D04841`（red-400）；输入错误边框 red-200 `#F68F87` |

来源：<https://github.com/tailscale/tailscale/blob/main/client/web/src/index.css>（`:root` 语义映射 + `.link-destructive` + `.input-error`）。阶梯中段饱和、两端分别向低饱和提亮/加深——官方博客说明这是为了在深浅主题下都保住颜色性格。来源：<https://tailscale.com/blog/heart-of-dark-mode>。

**Twingate（截图估算）**：在线/正常 = 亮绿圆点 ≈`#22C55E`（头像角标、Controller/Relay 的 Connected、底部 "All Systems Operational"）；品牌橙 ≈`#F4801F` 只用于头像/身份性强调，**不参与状态语义**；安全检查列表用 ✓/✕ 小图标 + 常规文字，失败的项不加红底。

**Tailscale 截图印证**：`tailscale-machine-details.png` 中状态色只以 ≈10px 圆点（Connected 绿点）和蓝色 `Copy` 文字链接出现；acl tag 用描边 pill + 等宽字体，不填色。

**惯例提炼**：状态色三件套 = 小圆点/小图标 + 近黑文字 + （可选）浅色底 pill；文字级状态色取阶梯 600 档（深、对比度达标），图形级取 300–400 档（亮、可辨识）；品牌色与状态色严格分离。

### 7. 按钮尺寸与内边距

**Tailscale（一手源码 `.button` / `.input`）**：

- 按钮：`inline-flex items-center justify-center; font-medium; padding: 8px 16px; border-radius: 6px; box-shadow: 0 1px 1px rgba(0,0,0,0.04); transition: 120ms`；`border: 1px solid transparent` 预留描边位；按钮组内 `min-width: 60px`。
- 输入框与按钮**同高同圆角**：高 38px（`h-input: 2.375rem`）、`px-3`、`rounded-md`、白底、gray-300 边框 → hover gray-400（注释：".input … should correspond to .button, sharing a similar height and rounding, since .input and .button are commonly used together"）。

来源：<https://github.com/tailscale/tailscale/blob/main/client/web/src/index.css>（`.button`、`.button-group`、`.input`、`.h-input`）。

**Twingate（截图估算）**：次按钮（"Edit"/"Unverify Serial Number"）浅灰填充、高 ≈36–40px、padding ≈8×16px、radius ≈8px、14px medium 文字；溢出操作用同高方形 `…` 描边图标按钮（≈40×40px）。

**Geist（佐证）**：small 按钮高 32px、14px 字、圆角、用 `0 0 0 1px` 描边影代替投影。来源：<https://vercel.com/geist/colors> 实测 class（`--height:32px`、`--geist-form-small-*`）。

**惯例提炼**：主高度档 32px（紧凑工具条）与 36–38px（表单/详情页）；padding 8×16px；font-medium 14px；次按钮 = 灰填充或描边，图标按钮 = 同高方形描边；按钮与输入框共享高度/圆角。

### 8. 定义列表式详情排版

**Tailscale（一手源码 `.details-card`）**：表格实现的两栏定义列表——标签列 `gray-500 text-sm truncate`，值列 `gray-800 text-sm` 且占 2 倍列宽（`grid-cols-3` + 值 `col-span-2`），行距 `gap-2`（8px）；卡内分组标题 12px 全大写 semibold tracking-wide gray-500。来源：<https://github.com/tailscale/tailscale/blob/main/client/web/src/index.css>。

**截图印证**：

- `tailscale-machine-details.png`：标签带 ⓘ tooltip 图标；可复制值后跟蓝色 `Copy` 文字链接；多行值（Endpoints、Relay 延迟列表）留在值列内换行；分组头 ADDRESSES / CLIENT CONNECTIVITY / ATTRIBUTES / RELAYS 全大写。
- `twingate-device-detail.png`：标签（Owner / Client Version / Make / Model…）灰字单列，值可带图标 + 一行灰色小注（"Client up to date"）；关键值（版本号）用 semibold。
- `twingate-connector-detail.png`：部分标签带**点状下划线**（Uptime、STUN Discovery）表示有 tooltip；技术值（IP、hostname）不刻意等宽。

**惯例提炼**：标签/值同字号（14px）靠灰度分工；值列宽 ≈ 标签列 2 倍；行距 8px（紧凑卡）–20px（宽松页）；tooltip 用 ⓘ 图标或点状下划线；可复制值配蓝色 `Copy` 文字按钮；分组用全大写小标题分隔。

## 给 token 定稿票的输入（建议默认值）

> Picaglass 为 Electron + Svelte（无 Tailwind），建议以 CSS 自定义属性落地下列 token；数值以 Tailscale 公开源码为基线（暖灰系），可按品牌微调。

```css
:root {
  /* 中性色板（暖灰，Tailscale 同构） */
  --gray-0: #FAF9F8;  --gray-100: #F7F5F4; --gray-200: #EEEBEA;
  --gray-300: #DAD6D5; --gray-400: #AFACAB; --gray-500: #706E6D;
  --gray-600: #444342; --gray-800: #232222;
  /* 语义 */
  --bg-app: var(--gray-100);  --bg-surface: #FFFFFF;
  --border-base: var(--gray-200);
  --text-base: var(--gray-800); --text-muted: var(--gray-500); --text-disabled: var(--gray-400);
  --text-primary: #3F5DB3; /* link/action 蓝 */
  --text-warning: #7E1E23; --text-danger: #940821;
  --status-success: #33C27F; --status-info: #4B70CC;
  /* 阴影（克制） */
  --shadow-form: 0 1px 1px rgba(0,0,0,0.04);
  --shadow-soft: 0 4px 12px 0 rgba(0,0,0,0.03);
  --shadow-dialog: 0 10px 40px rgba(0,0,0,0.12), 0 0 16px rgba(0,0,0,0.08);
  /* 圆角 */ --radius-control: 6px; --radius-card: 8px; --radius-full: 9999px;
  /* 间距（4px 基线） */ --space-1: 4px; --space-2: 8px; --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-8: 32px; --space-12: 48px;
  /* 控件 */ --control-height: 38px; --control-height-sm: 32px;
}
```

- 字体：Inter（可变）+ 系统等宽栈；正文 14–16px / 1.4 / -0.015em；字重限 400/500/600。
- 标题：页 22px/500、卡 18px/500、分组 12px/600 全大写 tracking-wide muted。
- 状态一律「圆点 + --text-base 文字」，不铺色块。

## 风险与注意

1. **Twingate 数值为截图估算**：其控制台无公开样式表，色值（绿点、灰阶、边框）为 PNG 目测近似，定稿时建议以对比度实测校准。
2. **Tailscale token 取自 `client/web`（节点内嵌 UI）**：官方博客确认 admin console 是设计系统宿主且两者共享组件，但 admin console 本体源码未公开，个别组件（如导航条）可能存在差异。
3. **Linear 品牌蓝具体色值未在其品牌页以文本形式给出**（仅描述为 "subtle desaturated blue"）；第三方测量一致指向 `#5E6AD2`，非一手，未纳入建议值。
4. **字重建议按字体落地方式调整**：若打包 Inter 可变字体可用 500/550 细分档；若用系统字体栈，500 档在部分平台渲染差异大，需实测。
5. 截图来自 Mobbin 收录（图底有水印条），页面顶部升级横幅等营销元素不应纳入 token 依据。

## 来源清单

采用（一手）：

- Tailscale `client/web/src/index.css`：<https://github.com/tailscale/tailscale/blob/main/client/web/src/index.css> — 全部色板/语义 token/组件样式实测值
- Tailscale `client/web/tailwind.config.js` 与 `styles.json`：<https://github.com/tailscale/tailscale/blob/main/client/web/tailwind.config.js> — 字重表、阴影 token、字体栈
- Tailscale 官方博客 Heart of dark mode：<https://tailscale.com/blog/heart-of-dark-mode> — 双背景分层、语义类、阴影/边框原则的一手阐述
- Linear Brand Guidelines：<https://linear.app/brand> — Mercury White / Nordic Gray 官方色票、Inter Variable preload
- Vercel Geist 文档站：<https://vercel.com/geist/colors> — `--ds-*` 命名与焦点环惯例（佐证）
- 本仓库截图：`docs/design/references/twingate-device-detail.png`、`twingate-connector-detail.png`、`tailscale-machine-details.png`

弃用（非一手/SEO 聚合）：Refero Styles、Duply、DesignMD、Copycats、shadcn.io design、webdesignhot 等对营销站的第三方拆解（非控制台、无溯源）；`vlados/filament-tailscale-theme`（第三方仿制主题）；SaaSFrame/together.agency（案例展示性质）。

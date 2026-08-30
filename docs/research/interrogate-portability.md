# `pstack/skills/interrogate` 去 Cursor 化研究笔记

## Summary

结论很明确。`interrogate` 的审查方法本身可以移植。它的范围识别、意图陈述、独立审查、共识归并、主审判断和不自动修改结果，都是 Agent Skills 的 Markdown 指令可以表达的通用流程。

原文件不能原样移植。真正的硬耦合集中在 `SKILL.md` 的 Step 3。该步骤要求 Cursor 的 `Task` 工具、`subagent_type: generalPurpose`、`model`、`readonly` 参数、`~/.cursor/rules/pstack-models.mdc` 和 Cursor 模型 slug。`disable-model-invocation` 也不是开放 Agent Skills 字段，但它不是 Cursor 独有功能，Claude Code 和 Pi 也实现了类似扩展。

推荐把核心做成只含标准 frontmatter、相对引用和 host-neutral 调度语句的单 skill 包。将并行 reviewer、模型选择、只读沙箱和手动调用策略放入 Cursor、Claude Code、Codex CLI 或 pi 的适配层。不要把 Cursor 配置文件或 Cursor 插件 manifest 复制进核心包。

## 1. 研究范围和原始证据

### 1.1 逐文件清单

GitHub API 返回的 `pstack/skills/interrogate` 目录只有一个入口文件和四个引用文件。以下内容均读取了原始文件，而不是搜索摘要。

| 文件 | 原始内容 | 结论 |
| --- | --- | --- |
| `pstack/skills/interrogate/SKILL.md` | Skill 元数据、范围和意图步骤、Cursor Task 调度步骤、汇总步骤、输出格式 | 核心流程可移植。Step 3 存在高风险 Cursor 运行时耦合。 |
| `pstack/skills/interrogate/references/reviewer-prompt.md` | reviewer prompt 模板和四个待替换占位符 | 内容基本通用。需要 host 填充占位符，属于隐含运行时契约。 |
| `pstack/skills/interrogate/references/rubric.md` | 正确性、根因、结构、验证、复杂度和安全审查标准 | 内容通用。一个句子列出了 `Read`、`Grep`、`Glob`，应改为抽象工具名称。 |
| `pstack/skills/interrogate/references/code-quality-review.md` | 代码结构、复杂度、边界、类型和编排质量标准 | 未发现 Cursor、pstack 或特定工具依赖，可以保留。 |
| `pstack/skills/interrogate/references/lead-judgment.md` | 主审过滤、分类、上下文和结论校准框架 | 未发现 Cursor、pstack 或特定工具依赖，可以保留。 |

原始文件链接如下。

* [`SKILL.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/interrogate/SKILL.md)
* [`reviewer-prompt.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/interrogate/references/reviewer-prompt.md)
* [`rubric.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/interrogate/references/rubric.md)
* [`code-quality-review.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/interrogate/references/code-quality-review.md)
* [`lead-judgment.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/interrogate/references/lead-judgment.md)
* [GitHub API 目录清单](https://api.github.com/repos/cursor/plugins/contents/pstack/skills/interrogate?ref=main)

`main` 会继续变化。读取本次研究时，分支 API 返回的 commit 是 [`68836ddaf5697224520f1847d90cdb90ca8babaa`](https://github.com/cursor/plugins/commit/68836ddaf5697224520f1847d90cdb90ca8babaa)。

### 1.2 入口文件的外部引用

`SKILL.md` 直接或间接依赖以下内容。

1. `references/reviewer-prompt.md`、`references/rubric.md`、`references/code-quality-review.md` 和 `references/lead-judgment.md`。这些文件都在 skill 根目录下，符合 Agent Skills 对相对引用的建议。
2. `~/.cursor/rules/pstack-models.mdc`。它不在 skill 包内，由 [`setup-pstack/SKILL.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/setup-pstack/SKILL.md) 写入。配置文件用逗号分隔的角色到模型映射，包含 `interrogate reviewers` 这一行。
3. Cursor 的 `Task` 工具。入口文件要求一次消息发出所有 reviewer，并传入 `subagent_type`、`model` 和 `readonly`。
4. 四个默认模型 slug。它们是 `claude-fable-5-thinking-max`、`gpt-5.6-sol-max`、`grok-4.6-fast-xhigh` 和 `claude-opus-5-thinking-xhigh`。这些不是 Agent Skills 标准字段，也不能假设其他客户端接受。
5. Git 和可能存在的 PR 元数据。入口文件把 Git 分支、commit message 和 PR description 当作审查意图的来源，但没有规定无法访问时的降级行为。

## 2. 四类依赖的区分

### 2.1 真正的 Cursor 专属依赖

以下依赖会让同一份文件在没有 Cursor 适配器的客户端中无法按原意执行。严重度针对“直接复制原文件到其他 host”，不是针对 Cursor 本身。

| 严重度 | 文件位置 | 证据 | 判断和处理 |
| --- | --- | --- | --- |
| P0，功能阻断 | `SKILL.md` 的 `Step 3, Spawn Reviewers` | `Launch all reviewers in a single message using the Task tool`。随后固定要求 `subagent_type: generalPurpose`、`model` 和 `readonly: true`。 | 这是 Cursor 工具调用契约，不是 skill 文件格式。改为“使用 host 原生的并行 subagent 或 worker 机制”，并定义不能调度时的单 agent 降级。 |
| P0，配置不可用 | 同一 Step 3 | 读取 `~/.cursor/rules/pstack-models.mdc`，使用 `interrogate reviewers` 配置。 | 这是 Cursor 路径和 `.mdc` 规则约定。核心 skill 不应读取该路径。模型池应由 host adapter 提供。 |
| P1，模型绑定 | 同一 Step 3 的默认表 | 固定 Cursor 模型 slug，并在 slug 被拒绝时要求查看 Task 错误和另开 PR 更新配置。 | 逻辑上的“多模型 reviewer”可保留。具体模型 ID、探测方法和更新 PR 的动作必须移出核心 skill。 |
| P1，只读语义绑定 | 同一 Step 3 | `readonly: true` 是 Cursor subagent 调用字段。 | 核心正文只能要求 reviewer 不修改。Cursor 用 `readonly`，Claude 用工具限制，Codex 用 `sandbox_mode = "read-only"`。没有 host enforcement 时不能声称安全只读。 |
| P1，Cursor 包装绑定 | 包装整个 pstack 时的 `pstack/.cursor-plugin/plugin.json` | 当前 manifest 位于 `.cursor-plugin/plugin.json`，并使用 `skills`、`agents`、`category`、`tags` 等 Cursor Plugin 字段。原文件见 [`plugin.json`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/.cursor-plugin/plugin.json)。 | 该 manifest 可以留在 Cursor 专用发行包，不能作为开放 Agent Plugins v1 的核心 manifest。 |

Cursor 官方 subagent 文档确认了 Cursor 有独立上下文、前后台执行、批量并行 Task、`model` 和 `readonly` 配置。它同时说明这些是 Cursor 的 subagent 能力，而非 Agent Skills 格式的一部分。见 [Cursor Subagents](https://cursor.com/docs/subagents)。

### 2.2 Agent Skills 开放格式或通用 shell/git 依赖

这些内容不应被误删。它们属于标准格式或跨 host 的工作内容，但仍需对环境可用性做检查。

| 内容 | 类型 | 证据和边界 |
| --- | --- | --- |
| `name: interrogate` | Agent Skills 标准 | 目录名是 `interrogate`，与 `name` 一致。Agent Skills 规范要求 `name` 使用小写字母、数字和连字符，并匹配父目录。见 [Agent Skills Specification](https://agentskills.io/specification)。 |
| `description` | Agent Skills 标准 | 原描述同时说明功能和触发词。它满足渐进式发现所需的用途信号。 |
| `references/` 和相对文件引用 | Agent Skills 标准约定 | 规范允许 `references/`、`scripts/` 和 `assets/`，并建议从 skill 根目录使用相对引用。四个引用文件只在一层之内。 |
| Markdown 正文、审查 rubric、输出模板 | Agent Skills 标准 | 规范对正文没有固定 DSL。审查顺序、分类和输出结构是普通指令内容。 |
| `git diff`、分支、commit message | 通用 Git | `git diff main...HEAD` 是 Git 语法，但 `main` 是否存在、是否是正确 base branch 属于运行时条件。应使用 host 或用户提供的已知 base，不要硬编码 `main`。 |
| 读取文件、读取差异、读取上下文 | 通用 agent 能力 | 不需要 Cursor。不同 host 的工具名字不同，所以应说“使用可用的文件和搜索工具”。 |
| 不自动应用修改 | 通用安全意图 | 这是工作流策略。可以在所有 host 的正文中保留。真正的只读权限仍要由 host 负责。 |

Agent Skills 规范明确要求入口文件带 `name` 和 `description`，允许可选 `license`、`compatibility`、`metadata` 和实验性的 `allowed-tools`。它还建议把长内容拆入 references，并把 `SKILL.md` 控制在 500 行以内。原 `SKILL.md` 和四个小引用文件符合这一组织方式。见 [Agent Skills Specification](https://agentskills.io/specification)。

### 2.3 只是 Cursor 品牌措辞

这类内容不产生运行时依赖，可以按需要改名，不需要为了去品牌而重写审查逻辑。

1. `interrogate` 是中性工作流名称。它不是 Cursor API 名称。
2. `pstack` 只出现在外部配置路径、pstack manifest 和 pstack 文档中。四个 `references` 文件不依赖 pstack 名称。
3. `SKILL.md` 的主体没有面向用户的“Cursor”宣传语。`Cursor` 出现于 `~/.cursor/rules/...` 路径，那里同时也是实际依赖，因此不能只做文字替换。
4. reviewer 标签 `Reviewer A`、`Reviewer B` 等是输出标签，不是品牌。
5. “adversarial review”“blind spots”“lone-model findings”等是方法术语，可以保留。

如果要发布独立包，建议改用不含 pstack 的包名，例如 `interrogate` 或 `adversarial-code-review`。这只影响发现和调用名称，不改变功能。

### 2.4 隐含运行时假设

这些假设可能在 Cursor 中成立，也可能在其他 host 中部分成立。它们不是 frontmatter 语法问题，因此应该在正文中显式写出降级规则。

| 严重度 | 假设 | 可能的失效 | 推荐的显式契约 |
| --- | --- | --- | --- |
| P0 | 当前 agent 能创建多个 reviewer，并能收回结果 | skill 可能只会输出“已启动”，实际没有 reviewer | 检测并行能力。不可用时运行多个独立审查 pass，标注为单 host 或单模型，不伪造模型共识。 |
| P0 | reviewer 拥有同一份 diff 和必要的上下文 | Cursor 文档说明 subagent 从干净上下文启动。其他 host 可能只传入 skill 正文 | 每个 reviewer 接收相同的意图、审查对象路径或内容、rubric 和 quality lens。无法提供对象时返回 `BLOCKED`。 |
| P1 | `readonly: true` 能阻止写文件和有副作用的 shell | 普通 Markdown 中的“不要修改”不是权限边界 | 每个 host adapter 明确设置只读工具或沙箱。无法 enforce 时禁止并行共享 checkout，或改为只做当前上下文审查。 |
| P1 | 所有 reviewer 会在 parent 汇总前完成 | 后台任务可能超时、失败或只返回部分结果 | 等待可等待的结果，记录 dropout 和 partial 状态。共识只统计真正独立且完成的结果。 |
| P1 | 多模型差异带来有意义的独立信号 | 四个默认 slug 可能没有权限、已重命名或实际落到同一模型 | 记录 host 实际使用的模型或 agent 名称。无法知道模型时只声称“独立 reviewer”，不声称“模型多样性”。 |
| P1 | 配置文件值是合法模型 | pstack 配置可能指向不可用 slug | adapter 只使用 host 已确认的模型。没有配置时使用 host 默认，不把 Cursor 默认表当成跨 host 默认。 |
| P2 | `main` 是正确的 base | fork、monorepo 或默认分支改名会产生错误 diff | 优先使用用户指定 diff。否则探测默认分支或要求 host 提供 base，并在报告中写明选择。 |
| P2 | PR description 和 forge 元数据可读 | Codex CLI、pi 或本地 checkout 可能没有 PR 上下文 | 把 PR 信息作为可选证据。不可用时使用用户请求、commit message 和代码本身。 |
| P2 | reviewer 可以直接读取 references | 某些 host 只把 SKILL.md 注入上下文，不自动加载旁边文件 | 在 reviewer prompt 中给出 skill 根目录下的相对路径，并要求读取失败时报告缺失，不凭空补齐 rubric。 |
| P2 | diff 内容能放进每个 reviewer 上下文 | 大 diff 会重复消耗 token，可能超出 context window | 优先传文件或 diff 路径，让 reviewer 做定向读取。必要时按文件范围拆分，但所有 reviewer 的范围必须一致。 |
| P2 | parent 能按结构化格式解析结果 | 原模板只规定 Markdown 标题，没有机器可验证 schema | 要求每个 reviewer 输出 `critical`、`warning`、`nit`、位置、证据和建议字段。解析失败时作为未结构化结果并标记。 |

## 3. 四个引用文件的逐项判断

### 3.1 `references/code-quality-review.md`

**严重度：无阻断问题。建议原样保留。**

全文是通用的质量审查 lens。它讨论结构简化、文件大小、spaghetti branching、类型边界、canonical layer、并行编排和原子性。没有 Cursor 路径、Task 参数、模型 slug、MCP 名称或特定工具名。

它可以直接被 Claude Code、Codex CLI、pi 和 Cursor 读取。它只表达审查标准，不决定 reviewer 如何启动。其“审查应积极寻找 code judo”的措辞是风格要求，不是品牌绑定。

原始文件见 [`code-quality-review.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/interrogate/references/code-quality-review.md)。

### 3.2 `references/lead-judgment.md`

**严重度：无阻断问题。建议原样保留。**

全文说明主审如何过滤 nitpick、区分假设和实际路径、处理上下文缺失，并把 finding 分为 `Act On`、`Consider`、`Noted` 和 `Dismissed`。这些概念独立于 host。

文件没有要求调用工具，也没有假设结果存放位置。只需让 portable `SKILL.md` 保持“主 agent 负责最终判断”的责任分界即可。

原始文件见 [`lead-judgment.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/interrogate/references/lead-judgment.md)。

### 3.3 `references/reviewer-prompt.md`

**严重度：P2。可保留，但应补充 host-neutral 输入契约。**

模板的四个占位符是：

* `{INTENT}`
* `{DIFF_OR_FILES}`
* `{RUBRIC_CONTENTS}`
* `{CODE_QUALITY_CONTENTS}`

模板没有写 Cursor API。它要求 reviewer 返回 `critical`、`warning` 或 `nit`，并提供位置、finding、evidence 和可选 suggestion。这是可移植的结构。

隐含契约是 parent 必须在 dispatch 前替换四个占位符，并为 reviewer 提供代码对象。模板还默认每个 reviewer 能读取被注入的内容。建议在模板中增加以下两条通用规则，而不改其核心 rubric。

```md
- The host must replace every `{...}` placeholder before dispatch.
- If the review artifact or a required reference is unavailable, report `BLOCKED` with the missing path instead of guessing.
```

`{DIFF_OR_FILES}` 这个名字可以继续使用。它同时涵盖内联 diff 和文件路径。若 host 为了节省 context 传路径，应明确要求 reviewer 在自己的工作目录中读取路径。

原始文件见 [`reviewer-prompt.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/interrogate/references/reviewer-prompt.md)。

### 3.4 `references/rubric.md`

**严重度：P2。必须做一个措辞级 portability 修改。**

“Root Causes vs. Symptoms”小节包含这句原文：

```text
Use the tools available to you (Read, Grep, Glob) to explore.
```

`Read`、`Grep` 和 `Glob` 在 Cursor、Claude Code 等产品中常见，但不是 Agent Skills 标准工具名称。Codex 和 pi 都可能提供等价能力，但不能依赖这三个标识符。

建议改为：

```text
Use the host's available file and search tools to explore. If those tools are unavailable, use the host's documented shell or report the missing evidence.
```

其余 rubric 是通用审查内容，可以保留。特别是 `git`、安全 sink、TOCTOU、测试和异步委派检查都属于通用工程概念，不应被误判为 Cursor 依赖。

原始文件见 [`rubric.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/interrogate/references/rubric.md)。

## 4. 推荐的最小可移植包

### 4.1 作为独立 skill 分发

Agent Skills 规范要求的是一个包含 `SKILL.md` 的目录。最小可用目录如下。

```text
interrogate/
├── SKILL.md
└── references/
    ├── reviewer-prompt.md
    ├── rubric.md
    ├── code-quality-review.md
    └── lead-judgment.md
```

如果这是从 pstack 重新分发的实质代码，应额外携带 MIT 许可证和归属信息。

```text
interrogate/
├── SKILL.md
├── LICENSE
└── references/
    ├── reviewer-prompt.md
    ├── rubric.md
    ├── code-quality-review.md
    └── lead-judgment.md
```

`LICENSE` 不是 skill 格式的必需文件，但 pstack manifest 声明了 MIT，原始许可证见 [`pstack/LICENSE`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/LICENSE)。不要把 pstack 的 `README.md`、`setup-pstack`、`.cursor` 规则、其他 skill、agent 文件或 automation pack 放进这个最小包。

### 4.2 作为开放 Agent Plugin 分发

如果需要一个带 manifest 的可安装包，采用 Agent Plugins v1 的结构。

```text
interrogate-plugin/
├── plugin.json
├── LICENSE
└── skills/
    └── interrogate/
        ├── SKILL.md
        └── references/
            ├── reviewer-prompt.md
            ├── rubric.md
            ├── code-quality-review.md
            └── lead-judgment.md
```

`plugin.json` 最小示例如下。

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "interrogate",
  "version": "0.1.0",
  "description": "Read-only adversarial review of code changes with independent findings and a lead judgment.",
  "license": "MIT"
}
```

Agent Plugins v1 要求根目录 `plugin.json`，把 skill 固定发现于 `skills/` 的直接子目录，并且 manifest 的顶层字段是封闭集合。当前 pstack 的 `.cursor-plugin/plugin.json` 不能直接拿来当这个 manifest，因为其中的 `skills`、`agents`、`category` 和 `tags` 属于 Cursor Plugin 扩展。见 [Agent Plugins Specification 1.0.0](https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md) 的 Manifest、Component discovery 和 Skills 小节，以及 [Cursor Plugins Reference](https://prod.cursor.com/docs/reference/plugins)。

Cursor 官方说明支持根目录 `plugin.json` 的 Agent Plugins open standard，并称符合标准的 plugin 可以在 Cursor 中不改动加载。见 [Cursor Plugins](https://prod.cursor.com/docs/plugins)。这不意味着同一 manifest 会被 Claude Code 或 Codex CLI 当作它们自己的 plugin manifest。它们各自有包装格式，见下文。

### 4.3 推荐的 portable `SKILL.md` 示例

下面的版本只使用标准字段。它保留原方法，但把 Cursor API、模型 slug 和 Cursor 配置路径抽成 host contract。

```md
---
name: interrogate
description: Run a read-only adversarial review of a diff or selected files. Use when the user asks to interrogate, stress-test, challenge, or find blind spots in code changes.
compatibility: Requires file access. Multi-reviewer mode requires a host that can run independent read-only reviewers; Git is recommended but optional.
---

# Interrogate

Run an adversarial review of the requested code changes. Do not edit files or apply fixes. Return a synthesized verdict.

## Host contract

Use the host's native subagent, worker, or parallel-agent mechanism. Do not assume a tool name, a model field, a model ID, or a configuration path.

If the host can run independent read-only reviewers, run one reviewer per configured reviewer entry with the same intent, review artifact, rubric, and code-quality lens. If the host cannot fan out, run at least two independent review passes in the current context when practical. Label the result as single-host or single-model review. Never claim model-diversity consensus when the host did not provide it.

The host should enforce read-only access for reviewers. A written instruction not to edit is not a permission boundary. If read-only enforcement is unavailable, do not run concurrent workers against a shared writable checkout.

## Step 1. Determine scope

1. Use files or a diff named by the user.
2. Otherwise, if Git is available, identify the correct base branch or commit before running a diff. Do not assume that the base is named `main`.
3. Gather only the surrounding files needed to understand the changed code.
4. Treat commit messages and pull request metadata as optional evidence. Record when either is unavailable.
5. Package the review artifact as file paths or a bounded diff. Avoid duplicating an oversized payload when reviewers can read the same paths.

## Step 2. State intent

Write one paragraph describing what the change is trying to accomplish. Derive it from the user request, available change metadata, and the code. Reviewers judge whether the implementation achieves that intent. They do not judge whether the intent itself is desirable.

## Step 3. Prepare reviewers

Read these files relative to this skill directory:

- `references/reviewer-prompt.md`
- `references/rubric.md`
- `references/code-quality-review.md`
- `references/lead-judgment.md`

Replace every placeholder in `reviewer-prompt.md` before dispatch. Give every reviewer the same review artifact, intent, rubric, and quality lens. If a reviewer cannot access a required artifact or reference, record `BLOCKED` instead of guessing.

## Step 4. Collect and synthesize

Wait for all available reviewers or record a timeout, failure, or partial result. Parse findings by severity, location, evidence, and suggestion. Deduplicate overlapping findings. Give the highest confidence to independently repeated findings, while preserving credible lone findings and explicit disagreements.

Use `lead-judgment.md` to decide which findings are `Act On`, `Consider`, `Noted`, or `Dismissed`. The lead agent owns the final judgment.

## Output

### Intent
> [One paragraph]

### Reviewers
- Reviewer [label]: [host or model name if available], [result status and finding count]

### Act On
[Concrete findings with locations, evidence, and why they matter]

### Consider
[Legitimate tradeoffs and their cost]

### Noted
[Valid but low-priority observations]

### Dismissed
[Rejected findings with a short reason]

### Agreement Map
[Consensus, disagreement, failures, and what the pattern means]
```

这份示例没有要求使用 `Task`、`generalPurpose`、`TaskOutput`、`~/.cursor` 或任何模型 slug。它仍然允许 Cursor 使用 Task，也允许 Claude、Codex 或未来 host 使用自己的调度 API。

### 4.4 具体修改清单

| 文件 | 是否修改 | 修改内容 |
| --- | --- | --- |
| `SKILL.md` | 必须 | 从核心 frontmatter 删除 `disable-model-invocation`。删除 Cursor Task 调用字段、Cursor 配置路径、默认 Cursor 模型表和“另开 PR 更新 slug”规则。增加 host contract、Git base fallback、reviewer 失败状态和无并行能力 fallback。保留审查流程和输出结构。 |
| `references/rubric.md` | 必须 | 把 `Read, Grep, Glob` 改成 host-neutral 的文件和搜索工具表述。 |
| `references/reviewer-prompt.md` | 建议 | 增加占位符必须替换、review artifact 或引用文件缺失时输出 `BLOCKED` 的两条规则。不要在模板中写 Cursor 工具名。 |
| `references/code-quality-review.md` | 不改 | 全文通用，直接保留。 |
| `references/lead-judgment.md` | 不改 | 全文通用，直接保留。 |
| `.cursor-plugin/plugin.json` | 不进入核心包 | 仅在需要 Cursor Plugin 发行时保留为 adapter。不要把它当作 Agent Plugins 根 manifest。 |
| `~/.cursor/rules/pstack-models.mdc` | 不复制 | 它是 pstack 的用户级 Cursor 配置，不是 skill 资源。其他 host 应使用各自配置。 |

## 5. Host 适配边界

### 5.1 Cursor

**发现和调用。** Cursor 从 `.cursor/skills/`、`.agents/skills/`、用户级目录以及 plugin 中发现 skill。Cursor 官方还说明它兼容 Claude 和 Codex 的 skill 目录。手动调用形式是 `/skill-name`。见 [Cursor Agent Skills](https://prod.cursor.com/docs/skills)。

**最小适配。** 直接把 portable skill 放入 `.cursor/skills/interrogate/`，或把它放到 Agent Plugin 的 `skills/interrogate/`。若要保留原来的显式调用语义，可以在 Cursor 专用副本的 frontmatter 加回 `disable-model-invocation: true`。不要把这个扩展字段放入需要严格遵守开放规范的 canonical 文件。

**多 reviewer。** Cursor 可以把 Step 3 映射为 Task 批量并行调用。模型池和只读权限由 Cursor adapter 负责。可以继续读取 `~/.cursor/rules/pstack-models.mdc`，但那是 adapter 行为，不应出现在 portable `SKILL.md`。

**限制。** 原 pstack 默认模型 slug 可能过时或受计划、团队策略限制。Cursor 官方说明被限制的模型会被替换或回退。portable skill 不应把“模型 slug 被拒绝后另开 PR”写成通用行为。

### 5.2 Claude Code

**发现和调用。** 项目级独立 skill 放在 `.claude/skills/interrogate/SKILL.md`，个人级放在 `~/.claude/skills/interrogate/SKILL.md`。plugin skill 放在 `<plugin>/skills/interrogate/SKILL.md`，plugin 调用名带 plugin namespace，例如 `/plugin-name:interrogate`。见 [Claude Code Extend Claude with skills](https://code.claude.com/docs/en/slash-commands) 和 [Claude Code Plugins](https://code.claude.com/docs/en/plugins)。

**frontmatter。** Claude Code 支持 `disable-model-invocation`、`context: fork`、`agent`、`background` 等扩展。Claude 官方同时说明，上传到 claude.ai、Skills API 或使用 package tool 时只能使用 Agent Skills 标准字段。标准字段包括 `name`、`description`、`license`、`compatibility`、`metadata` 和 `allowed-tools`。因此 canonical 文件删除 `disable-model-invocation` 最稳妥。

**多 reviewer。** `context: fork` 适合把一次 skill 运行放进一个 forked subagent，但它不能单独表达“每个配置模型一个 reviewer”。要保留 N 路 panel，应由 Claude Code 的 parent 使用 Agent 工具，或提供 `.claude/agents/` 下的 reviewer 定义。每个 reviewer 的 `tools` 或 `disallowedTools` 应限制为读取和搜索，模型用 Claude 支持的 alias 或完整 ID。见 [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)。

**限制。** 同名 plugin skill 会带 namespace。Claude Code 本地 skill、plugin skill、claude.ai skill 和 API 上传 skill 的 frontmatter 支持集合不完全相同。不能把 Cursor 的 Task 字段或 Cursor 模型 slug 放进 Claude 的 reviewer 定义。

### 5.3 Codex CLI

**发现和调用。** Codex CLI 的仓库级路径是 `.agents/skills/`，用户级路径是 `~/.agents/skills/`。可通过 `/skills` 或 `$interrogate` 显式选择，也可以按 description 隐式选择。见 [OpenAI Build skills](https://developers.openai.com/codex/skills)。

**最小适配。** 把 canonical skill 放到 `.agents/skills/interrogate/` 即可。若要做 Codex plugin，Codex 官方 plugin manifest 放在 `.codex-plugin/plugin.json`，skill 仍放在根目录的 `skills/interrogate/`。

```text
interrogate-codex-plugin/
├── .codex-plugin/
│   └── plugin.json
└── skills/
    └── interrogate/
        ├── SKILL.md
        └── references/
```

最小 Codex plugin manifest 示例如下。

```json
{
  "name": "interrogate",
  "version": "0.1.0",
  "description": "Read-only adversarial review of code changes.",
  "skills": "./skills/"
}
```

**显式调用策略。** Codex skill 的 `agents/openai.yaml` 可以声明 UI 信息和 `policy.allow_implicit_invocation: false`。这是 Codex adapter 文件，不是 Agent Skills 标准字段。

```yaml
interface:
  display_name: "Interrogate"
  short_description: "Run a read-only adversarial code review"

policy:
  allow_implicit_invocation: false
```

**多 reviewer。** Codex 支持 subagent workflow 和并行 agent。自定义 reviewer 可以放在 `.codex/agents/*.toml`，用 `sandbox_mode = "read-only"`，并在 parent prompt 中要求一 reviewer 一职责。Codex 的 skill 正文不应假设 Cursor `Task`。见 [OpenAI Codex subagents](https://developers.openai.com/codex/subagents)。

**限制。** Codex plugin 的 `.codex-plugin/plugin.json` 与 Agent Plugins v1 的根 `plugin.json` 是不同包装格式。不要把一个 manifest 同时当成两个 host 的 manifest。skill 正文本身仍可共用。

### 5.4 pi

**发现和调用。** pi 支持 `.pi/skills/`、`.agents/skills/`、用户级目录、settings、package 和重复的 `--skill <path>`。显式命令是 `/skill:interrogate`。它按 Agent Skills 标准读取 `SKILL.md`，并按需读取 references。见 [pi Skills](https://pi.dev/docs/latest/skills)。

**最小适配。** 把 canonical skill 放入 `.agents/skills/interrogate/`，可以同时被 Codex、Cursor 和 pi 发现。在 pi 专用项目中也可以放入 `.pi/skills/interrogate/`。不需要 plugin manifest。

**frontmatter。** pi 文档说明它对大多数规范问题只警告，并接受 `disable-model-invocation` 这一扩展。为了让同一份文件也能通过严格 validator，canonical 文件仍应只用标准字段。需要显式调用时使用 pi 的 `/skill:interrogate`，或在 pi settings 中控制技能命令。

**多 reviewer。** pi 的 skill 文档定义了发现、加载和命令机制，没有定义 `Task`、模型池或统一的只读 subagent 参数。因此 portable skill 在 pi 中能可靠复用的是审查方法，不是四模型并行保证。若 pi 的当前扩展或 package 提供并行 agent，再由 pi adapter 执行 panel。否则执行单 parent 的多个独立 pass，并在结果中标注真实能力。

## 6. 开放格式与 host 包装的决策

建议采用两层设计，而不是在一个 `SKILL.md` 中堆叠四种产品的字段。

### Canonical 层

* 只有标准 `name`、`description`，必要时使用标准 `license` 和 `compatibility`。
* 只引用 skill 根目录下的相对 references。
* 不写 `Task`、`subagent_type`、`model`、`readonly`、`~/.cursor`、`.mdc`、`context: fork`、`agents/openai.yaml` 或产品命令。
* 把 host 能力写成抽象 contract，并规定不可用时的降级和标注。
* reviewer 只读要求保留在正文，但把真正的权限限制交给 host。

### Adapter 层

* Cursor adapter 负责 Task fan-out、Cursor 模型配置、Cursor `readonly` 和可选的 `disable-model-invocation`。
* Claude adapter 负责 Agent 工具或 `.claude/agents/` reviewer、`tools` 限制以及可选的 Claude Code-only frontmatter。
* Codex adapter 负责 subagent workflow、`.codex/agents/*.toml`、Codex plugin manifest 和 `agents/openai.yaml`。
* pi adapter 负责 `/skill:interrogate`、settings、package 或可用的 pi 扩展。

这种分层保留了原流程的行为目标，但避免把某个客户端的 API 假装成 Agent Skills 标准。

## 7. 验证清单

### 7.1 静态验证

在独立 canonical skill 目录上运行 Agent Skills 官方参考 validator。

```bash
skills-ref validate interrogate
skills-ref read-properties interrogate
```

`skills-ref` 的用法见 [agentskills/skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref)。应验证以下条件。

* `SKILL.md` 第一行就是 `---`。
* `name` 是 `interrogate`，目录名也是 `interrogate`。
* `description` 非空，并同时描述用途和触发场景。
* 不存在 Cursor-only frontmatter 或硬编码 Cursor 模型。
* 四个 references 使用相对路径，且没有向包外逃逸的路径。
* 许可证和归属信息随重新分发内容保留。

可补充一个文本门禁，防止 canonical 文件重新引入 host 绑定。

```bash
grep -R -n -E 'Task|subagent_type|pstack-models|\.cursor|generalPurpose|claude-fable|gpt-5\.6-sol|grok-4\.6|claude-opus' interrogate
```

这个 grep 在 canonical package 上应无命中。对应字符串可以出现在未提交的 host adapter 中。

### 7.2 行为验证

对每个 host 做一次小型 smoke test。

1. 给 skill 一个小 diff 和一个明确意图。
2. 验证 reviewer 能读到相同的 diff、四个引用文件和相同的 intent。
3. 在 Cursor 中确认 Task reviewer 使用实际可用模型，并且 `readonly` 阻止写入。
4. 在 Claude Code 中确认项目 skill 和 plugin skill 的命令名，确认限制工具后的 reviewer 仍能读取文件。
5. 在 Codex CLI 中确认 `.agents/skills` 发现、`$interrogate` 调用和 read-only sandbox。
6. 在 pi 中确认 `.agents/skills` 或 `.pi/skills` 发现、`/skill:interrogate` 调用和 references 按需加载。
7. 人为制造一个 reviewer 失败或超时，确认最终报告列出 dropout，不把它算入共识。
8. 确认最终过程没有修改工作树。若 host 无法提供权限级只读，使用隔离 worktree 或仅做单 parent pass。

### 7.3 完成判定

移植完成必须同时满足以下条件。

* 核心 skill 在没有 Cursor 安装、Cursor 配置或 Cursor 模型 slug 时仍能加载。
* 没有并行 subagent 的 host 仍能得到诚实的审查结果，而不是失败或虚构共识。
* 有并行能力的 host 可以把同一份 reviewer prompt 发给多个独立 reviewer。
* 只读是权限设置和正文约束的双重结果，而不是只依赖模型听话。
* 输出会区分 consensus、lone finding、disagreement、partial 和 blocked。
* Host-specific 调用策略在 adapter 中，canonical 文件通过标准 validator。

## Sources

### Kept

* [Cursor `interrogate/SKILL.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/interrogate/SKILL.md)。被审查的原始入口文件。
* [Cursor `reviewer-prompt.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/interrogate/references/reviewer-prompt.md)。被入口文件读取的 prompt 模板。
* [Cursor `rubric.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/interrogate/references/rubric.md)。被入口文件读取的审查标准。
* [Cursor `code-quality-review.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/interrogate/references/code-quality-review.md)。被入口文件读取的质量 lens。
* [Cursor `lead-judgment.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/interrogate/references/lead-judgment.md)。被入口文件读取的主审框架。
* [Cursor `setup-pstack/SKILL.md`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/setup-pstack/SKILL.md)。证明 `~/.cursor/rules/pstack-models.mdc` 的生成方式和角色格式。
* [Cursor pstack `plugin.json`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/.cursor-plugin/plugin.json)。证明当前 pstack 使用 Cursor Plugin manifest，而不是开放 plugin manifest。
* [Cursor Agent Skills 文档](https://prod.cursor.com/docs/skills)。证明 Cursor 的 discovery 路径、Skill frontmatter、脚本和手动调用方式。
* [Cursor Plugins Reference](https://prod.cursor.com/docs/reference/plugins)。证明 Agent Plugin 根 `plugin.json` 与 Cursor Plugin `.cursor-plugin/plugin.json` 的区分。
* [Cursor Plugins](https://prod.cursor.com/docs/plugins)。证明 Cursor 支持 Agent Plugins open standard。
* [Cursor Subagents](https://cursor.com/docs/subagents)。证明 Cursor 的 Task、并行、模型和只读 subagent 能力。
* [Agent Skills Specification](https://agentskills.io/specification)。证明标准 frontmatter、相对 references、可选目录和渐进披露规则。
* [Agent Plugins Specification 1.0.0](https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md)。证明根 `plugin.json`、固定 `skills/` 发现位置和封闭 manifest 字段。
* [Claude Code Extend Claude with skills](https://code.claude.com/docs/en/slash-commands)。证明 Claude Code 的 skill 位置、frontmatter 扩展和标准字段边界。
* [Claude Code Plugins](https://code.claude.com/docs/en/plugins)。证明 Claude plugin 的 `.claude-plugin/plugin.json` 和 `skills/` 布局。
* [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)。证明 Claude 的 Agent 工具、工具限制、模型和自定义 subagent 配置。
* [OpenAI Build skills](https://developers.openai.com/codex/skills)。证明 Codex CLI 的 `.agents/skills`、渐进披露、`agents/openai.yaml` 和显式调用方式。
* [OpenAI Codex Plugins](https://developers.openai.com/plugins/build/plugins)。证明 Codex plugin 的 `.codex-plugin/plugin.json`、`skills` 字段和本地 plugin 布局。
* [OpenAI Codex subagents](https://developers.openai.com/codex/subagents)。证明 Codex 的并行 subagent workflow、read-only sandbox 和自定义 agent 配置。
* [pi Skills](https://pi.dev/docs/latest/skills)。证明 pi 的 discovery 路径、`/skill:name`、标准 frontmatter、相对资源和跨 harness 读取方式。

### Dropped

* 搜索引擎生成的摘要。它们只用于定位原始 URL，没有作为事实证据。
* 社区帖子、博客和二手兼容性列表。它们没有用于判断 manifest、frontmatter 或 host 能力。
* pstack 其他 workflow skill。它们会引入 `poteto-mode`、`swarm`、`arena` 或更多 Cursor 配置，不属于 `interrogate` 的最小引用闭包。

## Gaps

本笔记没有在四个产品中实际执行 reviewer。原因是当前工作只提供文件读写和网页读取能力，没有四个产品的运行时、模型 entitlement 或统一 shell 执行器。因此，对并行、权限、超时和命令名的判断以读取到的官方文档为准，并在建议中把未验证能力显式降级。

`cursor/plugins` 的 `main` 分支和各产品文档会变化。发布前应固定 Cursor 源文件 commit，并重新运行 `skills-ref validate` 和四个 host smoke test。模型 ID、默认分支名称和组织策略仍需由部署环境确认。

/**
 * 7 个 hook 事件的中文名（`EVENT_LABEL`）与触发时机（`EVENT_HINT`）。
 *
 * ## 为什么单独一个模块（两个理由，都不是"为了好看"）
 *   1. **只在客户端半边**：宿主/共享的 `src/shared/constants.ts` 是**运行层**的白名单，
 *      改它要重建 `lib/index.js` ⇒ 用户得**重启 DSH**（AGENTS §1.2/§1.3）。这一轮是纯呈现层，
 *      所以中文名只落在 `src/client/**`（会被 `lib/client.js` 内联，客户端半边 HMR 就能换）。
 *   2. **必须有 import**：esbuild 只沿 import 打包，没有任何模块 import 的文件会被**静默丢掉**
 *      （§4.8）。本文件由 `hook-card.tsx` / `section.tsx` / `new-hook.tsx` 三处 import，
 *      且自检 `D` 区在**产物** `lib/client.js` 里断言这几个中文字符串真的存在。
 *
 * ## 名字的来源（取证，不是编的）
 *   - 官方中文 README 的「你的钩子 / 运行时机」表（asar 内
 *     `@deepseek-ai/dsh-hooks-claude-code/README.zh.md` 第 56–64 行）给了 7 个事件的**触发时机**：
 *     `SessionStart`=会话开始时、`UserPromptSubmit`=agent 收到提示词时、`PreToolUse`=工具运行前、
 *     `PostToolUse`=工具运行后、`Stop`=运行即将停止时、`SubagentStart`=subagent 启动时、
 *     `SubagentStop`=subagent 结束时 —— `EVENT_HINT` **逐字照抄**这一列。
 *   - 官方没有给这 7 个事件**名词式**中文名（locale 里查不到：全 asar 里含 CJK 且含
 *     `PreToolUse` 的文件只有 3 个中文 README，都是"运行时机"这种描述句）。
 *     所以 `EVENT_LABEL` 是本仓库自定的，取法是把上面那列时机词**名词化**、并沿用
 *     `@deepseek-ai/dsh-hooks-codex/README.zh.md` 第 12 行「会话开始、提示词提交、工具执行前后
 *     以及停止」这套叫法（那是官方中文里最接近"事件名"的一处用词）：
 *     会话开始 / 提示词提交 / 工具运行前 / 工具运行后 / 停止 / 子代理启动 / 子代理结束。
 *
 * ⚠️ 两列都不许出现 markdown 记号（`**` / 反引号 / `##`）或盘符路径 —— 它们会被渲染成文本
 * 节点，自检的渲染护栏逐节点检查这件事。
 */

/** 事件 → 中文名（卡片标题 / 折叠事件行 / 新建表单的事件下拉都用它）。 */
export const EVENT_LABEL: Record<string, string> = {
  SessionStart: '会话开始',
  UserPromptSubmit: '提示词提交',
  PreToolUse: '工具运行前',
  PostToolUse: '工具运行后',
  Stop: '停止',
  SubagentStart: '子代理启动',
  SubagentStop: '子代理结束',
}

/** 事件 → 触发时机（作 `title`；官方 README 的「运行时机」一列，逐字照抄）。 */
export const EVENT_HINT: Record<string, string> = {
  SessionStart: '会话开始时',
  UserPromptSubmit: 'agent 收到提示词时',
  PreToolUse: '工具运行前',
  PostToolUse: '工具运行后',
  Stop: '运行即将停止时',
  SubagentStart: 'subagent 启动时',
  SubagentStop: 'subagent 结束时',
}

/**
 * 认不出来就**原样返回**（不编一个名字）：`HOOK_EVENTS` 白名单外的字符串只可能来自宿主
 * 新增的事件 —— 那时宁可显示英文枚举，也不要显示一个猜出来的中文名（§3.9：不许猜）。
 */
export function eventLabel(event: string): string {
  return EVENT_LABEL[event] ?? event
}

/** 同上：认不出来就退回英文枚举（`title` 里至少有个能查的字符串）。 */
export function eventHint(event: string): string {
  return EVENT_HINT[event] ?? event
}

/** 事件 → `title`：中文时机 + 英文原文（用户查文档 / 配 `hooks.json` 时需要原文）。 */
export function eventTitle(event: string): string {
  return `${eventHint(event)} · ${event}`
}

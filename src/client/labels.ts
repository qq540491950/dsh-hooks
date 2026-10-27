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
import type { RejectedReason } from '../shared/types.ts'

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

/**
 * 「多久之前」——状态点的**时间维度**（12 票）。
 *
 * 只有 `exit 0 · 12ms` 的时候，用户没法把"三天前的通过"和"刚刚的通过"分开；而台账是**进程级**
 * 记忆（重启即空），所以"未运行"也可能只是"这次还没跑"。
 */
export function relativeTime(at: number, now: number): string {
  const diff = Math.max(0, now - at)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${String(minutes)} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} 小时前`
  return `${String(Math.floor(hours / 24))} 天前`
}

/** `cwd` 的来源（诊断行用；内部枚举不进正文）。 */
export function cwdSourceText(source: string): string {
  switch (source) {
    case 'session':
      return '来自当前会话'
    case 'initiator':
      return '来自当前发起者（会话未知）'
    default:
      return '无法确定（没有会话上下文）'
  }
}

/** 被跳过的不支持 handler → 一句人话（诊断行用；`PreToolUse:prompt` 这种拼接不进正文）。 */
export function skippedText(skipped: Array<{ event: string; type: string; reason?: string }>): string {
  if (skipped.length === 0) return '无'
  return skipped
    .map((item) =>
      item.reason === 'empty-command'
        ? `${eventLabel(item.event)} 里有一条没有命令的 command`
        : `${eventLabel(item.event)} 里有一个不支持的 ${item.type}`,
    )
    .join('；')
}

/**
 * 「这一组为什么不会运行」——**一句人话**（06 票）。
 *
 * 这句话是"空 vs 不存在 vs 跑不了"三种情形里第三种的全部内容：以前这些组被解析器静默丢掉，
 * 页面于是把"有 4 条、全跑不了"说成"文件里还没有任何 hook"。原因取值来自宿主的解析器
 * （`invalid-matcher` / `malformed-group` / `no-command`），页面只负责翻译，不自己判断合法性。
 */
export function rejectedReasonText(reason: RejectedReason, matcher: string | null): string {
  switch (reason) {
    case 'invalid-matcher':
      // 把用户写的原文摆出来：他才知道自己少打了什么（比如漏了一个右括号）。
      return matcher === null ? '匹配范围不合法，这一组不会运行' : `匹配范围不合法（${matcher}），这一组不会运行`
    case 'malformed-group':
      return '这一组的结构不合法（缺少 hooks 数组），不会运行'
    case 'no-command':
      return '这一组里没有可运行的命令'
    case 'unsupported-type':
      return '这一组里只有本插件不支持的处理器类型（只运行 command），不会运行'
  }
}

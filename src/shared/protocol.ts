/**
 * 纯协议区：**无副作用、可独立测试**。
 *
 * 语义对齐 `@deepseek-ai/dsh-hook-protocol`（wire 字段名与判决优先级都逐条对齐）。
 * 这一层不允许 import node 内建模块、不允许碰 ctx —— 它的全部输入都是参数，
 * 所以自检可以直接 `import` 它跑单测，不必挂载插件。
 */

import { HOOK_EVENTS, LITERAL_ALTERNATIVES, type HookEvent } from './constants.ts'
import { isObject, strField, boolField } from './guards.ts'
import type {
  CommandVars,
  Decision,
  ExitCode,
  HookOutput,
  InjectionMessage,
  MergedOutput,
  ParsedGroup,
  ParsedGroups,
  ParsedHook,
  ParseResult,
  SkippedHandler,
} from './types.ts'

/** `mergeHookOutputs` 能返回的判决（不含 approve/block 这两个 wire 侧的同义词）。 */
export type MergedDecision = Exclude<Decision, 'approve' | 'block'>

/** 生成一个消息 id。`crypto` 是 Node 全局对象，不需要 import node 内建模块。 */
export function newMessageId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto !== undefined && typeof g.crypto.randomUUID === 'function') return g.crypto.randomUUID()
  return `dsh-hooks-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 平台无关的路径拼接（不 import node:path）。 */
export function joinPath(base: string, ...parts: Array<string | number>): string {
  const text = base
  // 只看 base 本身是 Windows 形状还是 POSIX 形状；不能因为出现 '/' 就当成有分隔符。
  const sep = text.includes('\\') || /^[A-Za-z]:/.test(text) ? '\\' : '/'
  let out = text.replace(/[\\/]+$/, '')
  for (const part of parts) out += sep + String(part).replace(/^[\\/]+|[\\/]+$/g, '')
  return out
}

/**
 * 取父目录；到根（`C:\` / `/`）时返回 undefined。
 * 纯字符串运算，避免依赖 node:path。
 */
export function parentOf(p: string): string | undefined {
  const s = p.replace(/[\\/]+$/, '')
  const idx = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
  if (idx < 0) return undefined
  let parent = s.slice(0, idx)
  if (parent === '') return undefined
  if (/^[A-Za-z]:$/.test(parent)) parent += '\\'
  return parent
}

/**
 * `unknown` → 日志/理由文本。
 *
 * 刻意保留 JS 的默认字符串化行为：codec 的入参来自宿主 Service，理论上任何形状都可能出现，
 * 而"非字符串就抛"会让 hook 结果解码变成新的崩溃点。字符串原样、null/undefined 当空串，
 * 其余走 `String()`（与改造前的 `String(stderr == null ? '' : stderr)` 逐字等价）。
 */
function rawText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- 这里就是要默认字符串化，见上方注释
  return String(value)
}

/** `$DSH_PLUGIN_ROOT` / `$DSH_PROJECT_DIR` 占位符替换。 */
export function substituteCommand(command: string, vars: CommandVars): string {
  let out = command
  if (vars.projectDir !== undefined) out = out.split('${DSH_PROJECT_DIR}').join(vars.projectDir)
  if (vars.pluginRoot !== undefined) out = out.split('${DSH_PLUGIN_ROOT}').join(vars.pluginRoot)
  return out
}

/** 缺省 / 空串 / `*` = 全匹配。 */
export function isMatchAll(matcher: string | undefined): boolean {
  return matcher === undefined || matcher === '' || matcher === '*'
}

/** 校验一个 matcher；返回 undefined 表示合法，否则返回诊断字符串。 */
export function matcherDiagnostic(matcher: string | undefined): string | undefined {
  // 显式三连判断（而不是调 isMatchAll）是为了让 TS 在这一行之后就收窄成 string。
  if (matcher === undefined || matcher === '' || matcher === '*') return undefined
  if (LITERAL_ALTERNATIVES.test(matcher)) return undefined
  try {
    new RegExp(matcher)
    return undefined
  } catch {
    return `invalid regex matcher ${JSON.stringify(matcher)}`
  }
}

/** matcher 是否选中 query。非法正则按"不匹配"处理，绝不抛。 */
export function matchesMatcher(matcher: string | undefined, query: string): boolean {
  if (matcher === undefined || matcher === '' || matcher === '*') return true
  if (LITERAL_ALTERNATIVES.test(matcher)) return matcher.split('|').includes(query)
  try {
    return new RegExp(matcher).test(query)
  } catch {
    return false
  }
}

/**
 * 解析通用 hooks 配置。
 *
 * 接受两种输入：含 `hooks` key 的 settings 对象，或裸事件映射。
 * 只跑 `type: "command"`（缺省即 command）；其余 handler 跳过并记入 `skipped`。
 * 单条 matcher 非法**只跳过该 group**（官方桥是拒绝整份配置，这里的取舍是
 * "一份配置里的一个笔误不该让全部 hook 失效"，诊断会以 warn 打到日志）。
 */
export function parseHookConfig(raw: unknown, vars: CommandVars = {}): ParseResult {
  const groups: ParsedGroups = {}
  const skipped: SkippedHandler[] = []
  const errors: string[] = []
  if (!isObject(raw)) return { groups, skipped, errors }
  const hooksMap = hooksMapOf(raw)

  for (const event of HOOK_EVENTS) {
    const rawGroups = hooksMap[event]
    if (!Array.isArray(rawGroups)) continue
    const parsedGroups: ParsedGroup[] = []
    // 用**文件下标**遍历：解析会跳过若干条目，而 rawIndex 必须指向文件里的真实位置。
    for (let groupIndex = 0; groupIndex < rawGroups.length; groupIndex++) {
      const rawGroup: unknown = rawGroups[groupIndex]
      if (!isObject(rawGroup) || !Array.isArray(rawGroup.hooks)) continue
      const commands: ParsedHook[] = []
      for (let hookIndex = 0; hookIndex < rawGroup.hooks.length; hookIndex++) {
        const rawHook: unknown = rawGroup.hooks[hookIndex]
        if (!isObject(rawHook)) continue
        const type = typeof rawHook.type === 'string' ? rawHook.type : 'command'
        if (type !== 'command') {
          skipped.push({ event, type })
          continue
        }
        const command = rawHook.command
        if (typeof command !== 'string' || command.length === 0) continue
        const timeoutSec = typeof rawHook.timeout === 'number' && rawHook.timeout > 0 ? rawHook.timeout : undefined
        // `disabled` 由**解析层保留**、由**执行层跳过**：页面需要看见停用的 hook（用户才能重新启用），
        // 而 runner 不能跑它。在解析层就丢掉的话，页面只能显示"这条不存在"。
        const disabled = rawHook.disabled === true
        commands.push({
          command: substituteCommand(command, vars),
          ...(timeoutSec !== undefined ? { timeoutSec } : {}),
          ...(disabled ? { disabled: true } : {}),
          rawIndex: hookIndex,
        })
      }
      if (commands.length === 0) continue
      // UserPromptSubmit / Stop 没有 matcher 主语，这两个事件的 matcher 一律丢弃。
      const matcher =
        event === 'UserPromptSubmit' || event === 'Stop'
          ? undefined
          : typeof rawGroup.matcher === 'string'
            ? rawGroup.matcher
            : undefined
      const diagnostic = matcherDiagnostic(matcher)
      if (diagnostic !== undefined) {
        errors.push(`${diagnostic} on event ${JSON.stringify(event)}`)
        continue
      }
      parsedGroups.push({ ...(matcher !== undefined ? { matcher } : {}), hooks: commands, rawIndex: groupIndex })
    }
    if (parsedGroups.length > 0) groups[event] = parsedGroups
  }
  return { groups, skipped, errors }
}

/**
 * 取"事件映射"层：含 `hooks` 键的 settings 对象，或裸事件映射。
 *
 * 导出给写路径用 —— **解析与写入必须用同一条判定**，否则会出现"页面按 A 布局寻址、写盘按
 * B 布局落笔"这种静默改错位置的 bug（AGENTS §2.6 的单规则纪律）。
 */
export function hooksMapOf(raw: Record<string, unknown>): Record<string, unknown> {
  return isObject(raw.hooks) ? raw.hooks : raw
}

/** 用户级在前、项目级在后；同一事件的数组拼接（通用的合并语义）。 */
export function mergeHookGroups(userGroups: ParsedGroups, projectGroups: ParsedGroups): ParsedGroups {
  const out: ParsedGroups = {}
  for (const event of HOOK_EVENTS) {
    const list = [...(userGroups[event] ?? []), ...(projectGroups[event] ?? [])]
    if (list.length > 0) out[event] = list
  }
  return out
}

/** 顶层 decision 只认 approve / block。 */
function topLevelDecisionOf(value: string | undefined): 'approve' | 'block' | undefined {
  return value === 'approve' || value === 'block' ? value : undefined
}

/** permissionDecision 只认 allow / deny / ask。 */
function permissionDecisionOf(value: string | undefined): 'allow' | 'deny' | 'ask' | undefined {
  return value === 'allow' || value === 'deny' || value === 'ask' ? value : undefined
}

/**
 * 把结构化 stdout 折进 outcome（原地修改）。
 * `expectedEventName` 守卫 `hookSpecificOutput`：字段缺失或与当前事件不符时丢弃该块
 * 的事件级字段（与官方 codec 同语义）。
 */
export function applyStructured(output: HookOutput, parsed: Record<string, unknown>, expectedEventName?: string): void {
  const cont = boolField(parsed, 'continue')
  if (cont !== undefined) output.continue = cont
  const stopReason = strField(parsed, 'stopReason')
  if (stopReason !== undefined) output.stopReason = stopReason
  const sysMsg = strField(parsed, 'systemMessage')
  if (sysMsg !== undefined) output.systemMessage = sysMsg
  const topDecision = topLevelDecisionOf(strField(parsed, 'decision'))
  if (topDecision !== undefined) output.decision = topDecision
  const topReason = strField(parsed, 'reason')
  if (topReason !== undefined) output.reason = topReason

  if (!isObject(parsed.hookSpecificOutput)) return
  const hso = parsed.hookSpecificOutput
  const eventName = strField(hso, 'hookEventName')
  if (eventName !== undefined) output.hookEventName = eventName
  if (expectedEventName !== undefined && eventName !== expectedEventName) return
  const permission = permissionDecisionOf(strField(hso, 'permissionDecision'))
  if (permission !== undefined) output.decision = permission
  const permissionReason = strField(hso, 'permissionDecisionReason')
  if (permissionReason !== undefined) output.reason = permissionReason
  const addCtx = strField(hso, 'additionalContext')
  if (addCtx !== undefined) output.additionalContext = addCtx
  if (isObject(hso.updatedInput)) output.updatedInput = hso.updatedInput
}

/**
 * 解码 hook 进程结果。全函数，永不抛。
 * exit 2 = 阻断（stderr 作理由）；exit 0 且 stdout 以 `{` 开头才尝试解析 JSON；
 * 其余情况是非阻断失败。
 */
export function parseHookOutput(
  exitCode: ExitCode,
  stdout: unknown,
  stderr: unknown,
  expectedEventName?: string,
): HookOutput {
  const trimmedErr = rawText(stderr).trim()
  const trimmedOut = rawText(stdout).trim()
  const output: HookOutput = { exitCode, stderr: trimmedErr, stdout: trimmedOut }
  if (exitCode === 2) {
    output.decision = 'block'
    if (trimmedErr.length > 0) output.reason = trimmedErr
  }
  if (exitCode === 0 && trimmedOut.startsWith('{')) {
    let parsed: Record<string, unknown> | undefined
    try {
      const candidate: unknown = JSON.parse(trimmedOut)
      parsed = isObject(candidate) ? candidate : undefined
    } catch {
      parsed = undefined
    }
    if (parsed !== undefined) applyStructured(output, parsed, expectedEventName)
  }
  return output
}

/** 单个 hook 的 decision 排序：deny > ask > allow。 */
export function rank(decision: Decision | undefined): number {
  switch (decision) {
    case 'deny':
    case 'block':
      return 3
    case 'ask':
      return 2
    case 'approve':
    case 'allow':
      return 1
    default:
      return 0
  }
}

/** 排名折回枚举。 */
export function decisionForRank(maxRank: number): MergedDecision {
  switch (maxRank) {
    case 3:
      return 'deny'
    case 2:
      return 'ask'
    case 1:
      return 'allow'
    default:
      return 'none'
  }
}

/**
 * 把同一事件下所有匹配 hook 的输出折成一份最严结果。
 * 权限取 `deny > ask > allow`；`continue:false` 粘住首个；additionalContext 按顺序累积。
 */
export function mergeHookOutputs(outputs: HookOutput[]): MergedOutput {
  let maxRank = 0
  const reasonsByRank = new Map<number, string[]>()
  let stop = false
  let stopReason: string | undefined
  const additionalContext: string[] = []
  const systemMessages: string[] = []
  for (const out of outputs) {
    const r = rank(out.decision)
    if (r > maxRank) maxRank = r
    if ((r === 3 || r === 2) && out.reason !== undefined && out.reason.length > 0) {
      const list = reasonsByRank.get(r) ?? []
      list.push(out.reason)
      reasonsByRank.set(r, list)
    }
    if (out.continue === false && !stop) {
      stop = true
      if (out.stopReason !== undefined) stopReason = out.stopReason
    }
    if (out.additionalContext !== undefined && out.additionalContext.length > 0) {
      additionalContext.push(out.additionalContext)
    }
    if (out.systemMessage !== undefined && out.systemMessage.length > 0) systemMessages.push(out.systemMessage)
  }
  const reasons = reasonsByRank.get(maxRank) ?? []
  return {
    decision: decisionForRank(maxRank),
    ...(reasons.length > 0 ? { reason: reasons.join('\n\n') } : {}),
    stop,
    ...(stopReason !== undefined ? { stopReason } : {}),
    additionalContext,
    systemMessages,
  }
}

/** 把内容块拍平成文本（hook payload 的公共做法）。 */
export function blocksToText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        isObject(block) && block.type === 'text' && typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('')
}

/** 构造一条注入了 hook 上下文的 user 消息（形状对齐 dsh-llm 的 createUserMessage）。 */
export function contextMessage(merged: MergedOutput): InjectionMessage | undefined {
  if (merged.additionalContext.length === 0) return undefined
  return {
    id: newMessageId(),
    role: 'user',
    content: merged.additionalContext.map((text) => ({ type: 'text' as const, text })),
    source: { kind: 'dsh-hooks' },
  }
}

/** 事件名索引 helper（宿主侧按事件查组时用，避免各处重复 `?? []`）。 */
export function groupsForEvent(groups: ParsedGroups, event: HookEvent): ParsedGroup[] {
  return groups[event] ?? []
}

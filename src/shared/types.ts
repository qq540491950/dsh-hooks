/**
 * wire 类型与规范化后的类型。
 *
 * 分两层是刻意的：**外部（磁盘上的 JSON）永远是不可信输入**，先按 `unknown` 收窄；
 * 只有规范化后的 `ParsedHook` / `ParsedGroup` 才允许在插件内部流通。
 */

import type { HookEvent } from './constants.ts'

/** 命令里的占位符替换值。 */
export interface CommandVars {
  projectDir?: string
  pluginRoot?: string
}

/** 规范化后的单条 hook：只保留我们真正会用的字段。 */
export interface ParsedHook {
  command: string
  timeoutSec?: number
  /**
   * `disabled: true` = 这条 hook 被停用（runner 跳过它）。
   *
   * 刻意**只在为 true 时**出现这个键：解析结果会被自检做 `deepStrictEqual`，
   * 而"键存在但为 undefined"与"没有这个键"在那边是两个不同的东西。
   *
   * 已核实（P4a）：`@deepseek-ai/dsh-hook-protocol` **根本不解析配置文件**
   * （它只有 matcher 语义、输出 codec、`runCommandHook` 与判决合并），所以"未知字段被拒"的
   * 担心在协议层不成立。真正的要求是**我们自己的 runner 必须认它** —— 否则就成了
   * "UI 显示已停用、别的路径照跑"（AGENTS §2.5）。
   */
  disabled?: boolean
  /**
   * **在文件里的真实下标**（`group.hooks` 数组中的位置）。
   *
   * 为什么必须单独记：解析会跳过"非 command handler"和"没有 command 的条目"，所以
   * `parsedIndex !== rawIndex`。写入操作必须按**文件下标**寻址，否则一个被跳过的条目就会让
   * 编辑落到错误的 hook 上 —— 那是"静默改错用户配置"，比写失败严重得多。
   */
  rawIndex: number
}

/** 规范化后的 group：matcher 属于 group，command/timeout 属于 hook（这是文件本身的形状）。 */
export interface ParsedGroup {
  matcher?: string
  hooks: ParsedHook[]
  /** **在文件里的真实下标**（该事件数组中的位置）。理由同 {@link ParsedHook.rawIndex}。 */
  rawIndex: number
}

/** 一个 projectRoot 的解析结果（按事件分组）。 */
export type ParsedGroups = Partial<Record<HookEvent, ParsedGroup[]>>

/** 被跳过的条目（只做诊断与"跑不了"计数用）。 */
export interface SkippedHandler {
  event: HookEvent
  /** 条目上写的 handler 类型（`command` 也可能是"空命令"那条路）。 */
  type: string
  /** **在文件里的真实下标**（哪个组的第几条）—— 页面要能说清"哪一条跑不了"。 */
  groupIndex: number
  hookIndex: number
  /**
   * 为什么跳过。
   *
   * `empty-command` 这条是 06 复查时补的：一个 `type:"command"` 但 `command` 为空串的条目
   * 以前**不留任何记录**，于是 `hookCount + unrunnable` 比文件里真实条目数少 —— 页面那个
   * "文件里有 N 条"因此会说小。
   */
  reason: 'unsupported-type' | 'empty-command'
}

/**
 * 一组**不会运行**的配置：它在文件里存在，但一条都跑不了。
 *
 * 为什么必须记下来（06 票）：这三类东西以前被解析器**静默丢掉** —— 于是页面上什么都没有，
 * 用户合理地得出"我没有配置"（其实是"有 4 条，全跑不了"）。空 vs 不存在 vs 跑不了，是三件事。
 */
export interface RejectedGroup {
  event: HookEvent
  /** **文件里的真实下标**（该事件数组中的位置）。 */
  groupIndex: number
  /** 该组写的 matcher（非法时原样保留，页面要能把它显示出来让人改）。 */
  matcher?: string
  reason: RejectedReason
  /** 这一组里有几条跑不了（用于"文件里有 N 条，其中 M 条跑不了"）。 */
  hookCount: number
}

/** 跑不了的原因（机器可读；人话由页面自己写，见 `rejectedReasonText`）。 */
export type RejectedReason =
  /** matcher 不是合法正则（该组被跳过，与 AGENTS §2.7 的取舍一致）。 */
  | 'invalid-matcher'
  /** 这一组的结构不合法（不是对象，或缺 `hooks` 数组）。 */
  | 'malformed-group'
  /** 这一组里没有任何可运行的 command（空数组 / 只有空 command）。 */
  | 'no-command'
  /**
   * 这一组里**全是本插件不支持的处理器类型**（`prompt` / `http` / `mcp_tool` …）。
   *
   * 与 `no-command` 分开：它们**有内容**，只是我们只跑 `command`。以前这类组一条记录都不留，
   * 于是页面把它算进"空"，同时又在条数里说"另有 N 条跑不了" —— 用户看到的是自相矛盾的两句话。
   * 这条记录的 `hookCount` 恒为 0：那些条目已经在 `skipped` 里计过数，不许重复计。
   */
  | 'unsupported-type'

/** `parseHookConfig` 的结果。 */
export interface ParseResult {
  /** **只含可运行的组**（执行语义的唯一来源）。 */
  groups: ParsedGroups
  skipped: SkippedHandler[]
  /** 结构在、但一条都跑不了的组（**不参与执行**，只用于让页面说真话）。 */
  rejected: RejectedGroup[]
  errors: string[]
}

/** 单条 hook 的判决（协议里的枚举，外加我们自己合成的 `none`）。 */
export type Decision = 'approve' | 'block' | 'allow' | 'deny' | 'ask' | 'none'

/** 解码后的 hook 进程输出。 */
export interface HookOutput {
  exitCode: number | undefined
  stderr: string
  stdout: string
  decision?: Decision
  reason?: string
  continue?: boolean
  stopReason?: string
  systemMessage?: string
  hookEventName?: string
  additionalContext?: string
  updatedInput?: Record<string, unknown>
}

/** 同一事件下所有匹配 hook 折叠出的最严结果。 */
export interface MergedOutput {
  decision: Exclude<Decision, 'approve' | 'block'>
  reason?: string
  stop: boolean
  stopReason?: string
  additionalContext: string[]
  systemMessages: string[]
}

/** hook 子进程 stdin 上收到的 payload（字段名对齐官方桥）。 */
export interface HookPayload {
  session_id: string
  transcript_path: string
  cwd: string
  hook_event_name: string
  [key: string]: unknown
}

/** 注入进会话上下文的消息（形状对齐 dsh-llm 的 createUserMessage）。 */
export interface InjectionMessage {
  id: string
  role: 'user'
  content: Array<{ type: 'text'; text: string }>
  source: { kind: string }
}

/** `parseHookOutput` 的入参：`exitCode` 在"进程起不来"时是 `undefined`。 */
export type ExitCode = number | undefined

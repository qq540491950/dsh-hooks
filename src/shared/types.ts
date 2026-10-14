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
}

/** 规范化后的 group：matcher 属于 group，command/timeout 属于 hook（这是文件本身的形状）。 */
export interface ParsedGroup {
  matcher?: string
  hooks: ParsedHook[]
}

/** 一个 projectRoot 的解析结果（按事件分组）。 */
export type ParsedGroups = Partial<Record<HookEvent, ParsedGroup[]>>

/** 被跳过的非 command handler（只做诊断用）。 */
export interface SkippedHandler {
  event: HookEvent
  type: string
}

/** `parseHookConfig` 的结果。 */
export interface ParseResult {
  groups: ParsedGroups
  skipped: SkippedHandler[]
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

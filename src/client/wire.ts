/**
 * 客户端**读取侧**的 wire 视图。
 *
 * ⚠️ 这是"只声明页面读到的字段"，**不是第二套解析器**（AGENTS §2.6 禁的是后者：页面不许自己
 * 解析 `hooks.json`，不许自己判断 matcher 合法性、不许自己合并两个来源）。所有语义都来自宿主的
 * `GET /api/hooks`，这里只描述 JSON 形状。
 *
 * 为什么不直接 import 宿主的 `HooksSnapshot`：那会把 `src/host/**` 拉进客户端的类型图（而客户端
 * 半边**没有 node types**），语义上也反了 —— 客户端不该依赖宿主模块。
 *
 * 字段名漂移的防线：P5b 的渲染断言会在字段读不到时当场红（"页面显示空"是断言失败，不是静默降级）。
 */

/** 一个文件的状态（三态 + 版本）。 */
export interface FileView {
  kind: 'project' | 'user'
  path: string
  state: 'absent' | 'ok' | 'error'
  /** `state === 'error'` 时的技术原文；页面**主文案不许直接用它**（§3.9）。 */
  message: string | null
  version: string | null
  hookCount: number
  skipped: Array<{ event: string; type: string }>
  matcherErrors: string[]
  events: FileEventView[]
}

/** 文件自己的事件视图（可寻址）。 */
export interface FileEventView {
  event: string
  groups: GroupView[]
  hookCount: number
  disabledCount: number
  runCount: number
}

/** 一条 hook 的最近执行记录（**状态色的唯一依据**，§3.8）。 */
export interface RunView {
  at: number
  exitCode: number | null
  decision: string
  durationMs: number
  stdout: string
  stderr: string
}

/** 一条 hook。 */
export interface HookView {
  command: string
  timeoutSec: number | null
  defaultTimeoutSec: number
  disabled: boolean
  rawIndex: number
  lastRun: RunView | null
}

/** 一个 group。 */
export interface GroupView {
  file: 'project' | 'user' | null
  rawIndex: number
  matcher: string | null
  matcherOk: boolean
  matcherProblem: string | null
  hooks: HookView[]
}

/** 一个事件分组（生效视图）。 */
export interface EventView {
  event: string
  groups: GroupView[]
  hookCount: number
  disabledCount: number
  fromProject: number
  fromUser: number
  runCount: number
}

/** 实际生效的作用域（宿主回显）。页面所有写请求都必须按它构造（§2.2）。 */
export interface ScopeView {
  kind: 'user' | 'workspace'
  requested: 'current' | 'user' | 'workspace'
  workspaceId: string | null
  workspaceTitle: string | null
  /** 工作区路径。**它不等于项目根**（见下面 `projectRoot`）。 */
  workspacePath: string | null
  /** 这份 project 文件的**项目根**（最近含 `.git` 的祖先）；`kind === 'user'` 时为 null。 */
  projectRoot: string | null
  /** 选中的工作区是不是当前会话的项目根；`null` = **当前会话未知**（不编造）。 */
  isCurrentSession: boolean | null
}

/** 工作区清单里的一项（下拉框用）。 */
export interface WorkspaceItemView {
  id: string
  title: string
  path: string
  projectRoot: string
  isCurrent: boolean
}

/**
 * 「当前会话实际会跑什么」的条数口径（AGENTS §2.6）。
 *
 * ⚠️ **三态**：null = 当前会话未知（没有 sessionId / 它的项目根拿不到）——
 * 页面必须说"当前会话未知，无法判断实际会跑什么"，**绝不许**显示"当前会话生效 0 条"。
 */
export interface SessionEffectView {
  projectRoot: string
  hookCount: number
  disabledCount: number
  groupCount: number
  fromUser: number
  fromProject: number
  staleInUse: boolean
}

/** `GET /api/hooks` 的成功载荷。 */
export interface HooksSnapshot {
  route: string
  projectRoot: string | null
  cwd: string | null
  cwdSource: 'session' | 'initiator' | 'none'
  /** 宿主回显的作用域（页面用它做"我是不是在看当前会话的项目"的判断）。 */
  scope: ScopeView
  workspaces: WorkspaceItemView[]
  /** `false` = 宿主没有工作区清单（≠ 没有工作区）—— 页面必须明说，不许渲染成空下拉。 */
  workspacesAvailable: boolean
  /** null = 当前会话未知（三态）。 */
  session: SessionEffectView | null
  files: FileView[]
  events: EventView[]
  total: { hookCount: number; disabledCount: number; groupCount: number }
  staleInUse: boolean
  capabilities: { writable: boolean }
}

/** 失败信封（**没有 `data`**）。 */
export interface HooksErrorBody {
  ok: false
  error: string
  detail?: string
}

/** `GET /api/hooks` 的响应：成功与失败两种形状。 */
export type HooksResponse = { ok: true; data: HooksSnapshot } | HooksErrorBody

/** `POST /api/hooks` 的响应：成功给出写后的新版本，失败**没有 `data`**。 */
export interface HooksWriteResponse {
  ok: boolean
  data?: { file: string; version: string | null }
  error?: string
  detail?: string
}

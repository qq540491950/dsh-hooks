/**
 * 设置页的数据面：**只读快照 + 精确路由**。
 *
 * 分成两层是刻意的：
 *   - `buildSnapshot()` 是**纯函数**（不碰 ctx、不碰 fs）→ 可以直接单测快照形状与"7 个事件永远全列"。
 *   - `registerHooksRoute()` 只做 HTTP 适配（取参、错误信封、状态码），业务语义全在宿主的 `inspect`。
 *
 * 依据见 [docs/design-notes.md](../../docs/design-notes.md) §1（通道选型：为什么是
 * `ctx.connection.fetch.register()` 而不是 Remote / `$events` / client-store）。
 *
 * 契约纪律（AGENTS §2.6）：快照里的分组**必须**由宿主用同一个 `parseHookConfig` 产出 ——
 * 页面不允许自己解析 JSON，否则两套解析器必然漂移成"页面说配好了、运行时不认"。
 */

import { HOOKS_ROUTE, HOOK_EVENTS, DEFAULT_TIMEOUT_MS, type HookEvent } from '../shared/constants.ts'
import { hostErrorCodeOf } from '../shared/errors.ts'
import type { HostErrorCode } from '../shared/errors.ts'
import { messageOf, isObject } from '../shared/guards.ts'
import { matcherDiagnostic } from '../shared/protocol.ts'
import type { ParsedGroup, ParsedGroups, RejectedGroup, RejectedReason, SkippedHandler } from '../shared/types.ts'
import { latestRunFor, type LedgerEntry } from './ledger.ts'
import { isHookEvent, parseHooksRequest, type FileKind, type HooksRequest } from './write.ts'

/**
 * 本插件注册的浏览器路由 —— 定义在 `src/shared/constants.ts`，**两半共用同一个字面量**
 * （宿主注册它、客户端 fetch 它；不一致就是静默 404）。这里只是转出，方便调用方 import。
 */
export { HOOKS_ROUTE }

/** 一个来源（项目级 / 用户级）的磁盘状态 + 解析结果。 */
export interface SourceInspection {
  kind: 'project' | 'user'
  path: string
  /** 三态：`absent` 是合法的空配置，`error` **绝不许**当成空配置（AGENTS §2.9）。 */
  state: 'absent' | 'ok' | 'error'
  /** `error` 时的技术原文。放详情用，**不作为页面主文案**（AGENTS §3.9）。 */
  message: string | null
  /** 写入时的乐观锁；`null` = 文件不存在（那时用 `createIfAbsent`）。 */
  version: string | null
  /** 这份文件解析出来的事件分组。 */
  groups: ParsedGroups
  /** 被跳过的非 command handler。 */
  skipped: SkippedHandler[]
  /** 结构在、但一条都不会跑的组（matcher 非法 / 结构坏了 / 没有 command）。 */
  rejected: RejectedGroup[]
  /** matcher 诊断（非法 matcher 只跳过该 group，不整份拒绝）。 */
  matcherErrors: string[]
}

/** 宿主提供的一次完整检视结果。 */
export interface HooksInspection {
  /**
   * 当前会话的项目根。**`null` = 无法确定当前项目**（没有会话上下文）——
   * 这时只列用户级配置，绝不编造一个 workspace 路径（AGENTS §2.8）。
   *
   * ⚠️ 它**永远是"当前会话在哪里"**，与所选作用域无关 —— 页面据此判断"我是不是在看
   * 当前会话的项目"（见 {@link ScopeView.isCurrentSession}）。
   */
  projectRoot: string | null
  /** 会话 cwd；**拿不到就是 null，不编造**。 */
  cwd: string | null
  /** cwd 是从哪来的 —— 如实报告来源，页面才能说清"这个项目是怎么定的"。 */
  cwdSource: 'session' | 'initiator' | 'none'
  /** 实际生效的作用域（回显）—— 页面所有写操作都必须按它构造请求体（§2.2）。 */
  scope: ScopeView
  /** 可选的工作区清单（下拉框用）。`workspacesAvailable === false` 时它恒为空数组。 */
  workspaces: WorkspaceItemView[]
  /** **`false` = 宿主没有 `workspaceRegistry`**（≠ 没有工作区）：页面必须明说，不许渲染空下拉。 */
  workspacesAvailable: boolean
  /**
   * 「当前会话实际会跑的是什么」——**与所选作用域无关**（AGENTS §2.6）。
   *
   * ⚠️ **三态**（AGENTS §2.8/§2.9：「读不到」≠「没有」）：`null` = 当前会话的项目根拿不到
   * （没有 sessionId / agent 查不到），此时**一个数字都不许编** —— 页面必须说"当前会话未知，
   * 无法判断实际会跑什么"，而不是显示"当前会话生效 0 条"。
   *
   * 作用域是"看/改哪一份文件"，运行时是"用户级 + 会话自己项目级的合并"；两个问题不同源，
   * 所以答案也必须分开给（`scope=user` 时生效视图只有用户级，光看它回答不了"实际会跑什么"）。
   */
  session: SessionEffectView | null
  /** 正常情况恒为 2 项（项目级、用户级）；项目无法确定或 `scope=user` 时只有用户级 1 项。 */
  sources: SourceInspection[]
  /** 所选作用域的生效配置（用户级在前 + 项目级在后，跨来源同事件拼接）。 */
  effective: ParsedGroups
  /**
   * **参与合并**的两份（就是 `effective` 的来源，磁盘或 last-good 由同一条路径决定）。
   *
   * 页面要回答"每条生效 hook 来自哪个文件"、"用户级几条 / 项目级几条" —— 那两个数字必须取自
   * 这里。用"新鲜读"会在 stale（沿用上一份可用配置）时得到 0 / 0，与 `effective` 的条数打架
   * （`fromUser + fromProject === hookCount` 是必须成立的不变式）。
   * `files[]` 的条数与 state 仍用**新鲜读** —— 那是"这份文件此刻长什么样"，本来就该新鲜。
   */
  effectiveUserGroups: ParsedGroups
  effectiveProjectGroups: ParsedGroups
  /** 生效配置是否来自"沿用上一份可用配置"（磁盘当前读不出来）。 */
  staleInUse: boolean
  /**
   * 宿主声明"这个数据面能不能写"。
   *
   * 由宿主给而不是由路由猜：路由注册了 POST 才为 true，页面据此显示可编辑 / 只读横幅 ——
   * 而不是让用户点了没反应。
   */
  writable: boolean
  /** 有界执行台账（§2.11）。**状态色的唯一证据来源**（§3.8）。 */
  ledger: LedgerEntry[]
}

/** 实际生效的作用域（回显给页面）。 */
export interface ScopeView {
  /** 解析后的种类：`current` 归一成这两者之一（没有会话上下文的 `current` 等于 `user`）。 */
  kind: 'user' | 'workspace'
  /** 客户端**请求**的作用域（原始值，便于页面说清"为什么落到这里"）。 */
  requested: 'current' | 'user' | 'workspace'
  /** `kind === 'workspace'` 时是工作区 id；工作区信息不可知（`current` 会话）时为 null。 */
  workspaceId: string | null
  workspaceTitle: string | null
  /** 工作区路径。**它不等于项目根**（见 {@link ScopeView.projectRoot}）。 */
  workspacePath: string | null
  /**
   * 这份 project 文件的**项目根**（最近含 `.git` 的祖先）；`kind === 'user'` 时为 null。
   * 与 `workspacePath` 不同时页面必须**分别显示**（否则用户会问"我改的是 A，为什么落到 B"）。
   */
  projectRoot: string | null
  /** 选中的工作区是不是当前会话的项目根；`null` = 当前会话未知（**不编造**，AGENTS §2.8）。 */
  isCurrentSession: boolean | null
}

/** 工作区清单里的一项（下拉框用）。 */
export interface WorkspaceItemView {
  id: string
  title: string
  /** 工作区路径（realpath 规范化过的绝对路径）。 */
  path: string
  /** 该工作区解析出的项目根（最近含 `.git` 的祖先）。 */
  projectRoot: string
  /** 是不是当前会话的项目根。 */
  isCurrent: boolean
}

/**
 * 当前会话真正会跑的合并配置的**条数口径**（不重复给 groups：页面要的是那两个数字）。
 *
 * `hookCount` **不含** `disabled`（停用单独计数，否则页面会把"已停用"显示成"在跑"）。
 * 整块为 `null` 表示"当前会话未知"（见 {@link HooksInspection.session}）—— 计数一律不编。
 */
export interface SessionEffectView {
  /** 当前会话的项目根。**一定有值**：拿不到时整块为 `null`（三态，不填 `null` 假值）。 */
  projectRoot: string
  hookCount: number
  disabledCount: number
  groupCount: number
  /** 用户级贡献的启用条数。 */
  fromUser: number
  /** 项目级贡献的启用条数。 */
  fromProject: number
  /** 这份合并配置是不是 last-good 兜底。 */
  staleInUse: boolean
}

/** 最近一次**真实**执行的证据（每条都来自台账，绝不是"没报错"推出来的）。 */
export interface RunView {
  at: number
  /** `null` = 子进程没起来（infra 失败），这本身也是正面证据。 */
  exitCode: number | null
  decision: string
  durationMs: number
  stdout: string
  stderr: string
}

/** 单条 hook 的呈现。 */
export interface HookView {
  command: string
  /** `null` = 用默认超时；非 null 是文件里写的秒数。 */
  timeoutSec: number | null
  /** 默认超时（秒），供页面显示"未写 timeout → 用 600s"。 */
  defaultTimeoutSec: number
  /** 文件里是否写了 `disabled: true`（停用）。runner 会跳过它。 */
  disabled: boolean
  /** **文件里的真实下标** —— 页面发写操作时要原样回传（AGENTS §2.3）。 */
  rawIndex: number
  /**
   * 最近一次真实执行；`null` = **没有记录**（页面显示灰"未运行"，**不许**报绿）。
   *
   * 注意：命令改过之后这里会变回 `null`（匹配条件是 event + command），
   * 所以"旧记录"绝不会给新命令上色。
   */
  lastRun: RunView | null
}

/**
 * 一组**跑不了**的配置在快照里的形状（06 票）。
 *
 * 与 `GroupView` 分开是刻意的：`GroupView` 是"会运行的东西"，而这一份是"文件里有、但一条都不会跑"。
 * 页面用它们在主列表里画一行灰化的「不会运行」，而不是让这些内容凭空消失。
 */
export interface RejectedGroupView {
  event: HookEvent
  /** **文件里的真实下标**（页面要能原样回传给"改匹配范围 / 删这一组"）。 */
  groupIndex: number
  /** 该组写的 matcher（非法时原样保留，用户要看到自己写错成了什么）。 */
  matcher: string | null
  reason: RejectedReason
  /** 这一组里有几条（用于"文件里有 N 条，其中 M 条跑不了"）。 */
  hookCount: number
}

/** 一个 group 的呈现。matcher 属于 group，command/timeout 属于 hook。 */
export interface GroupView {
  /**
   * 这个 group 来自哪个文件。合并视图（顶层 `events`）里，`staleInUse` 时为 `null`
   * （来源无法确定）→ 页面据此**禁用编辑**，而不是猜一个文件写进去。
   */
  file: FileKind | null
  /** **文件里的真实下标**（该文件该事件数组中的位置）。 */
  rawIndex: number
  matcher: string | null
  /** `matcher` 非法时该 group 不会运行 —— 页面必须能分别说清（AGENTS §3.9）。 */
  matcherOk: boolean
  matcherProblem: string | null
  hooks: HookView[]
}

/** 一个事件分组的呈现。 */
export interface EventView {
  event: HookEvent
  /** 生效配置里该事件的组（可能是空数组 —— 但**事件本身永远在列表里**）。 */
  groups: GroupView[]
  /** 该事件生效的 hook 条数（不含 disabled）。 */
  hookCount: number
  /** 停用条数单独计数：页面要能说"3 条，其中 1 条已停用"。 */
  disabledCount: number
  /** 生效条数来自哪个来源（诊断"我改的用户级为什么不生效"）。 */
  fromProject: number
  fromUser: number
  /** 台账里这个事件被真实执行过几次（解释"为什么每一行都是灰的"）。 */
  runCount: number
}

/** 一个文件**自己**的事件视图：这是**可寻址**的那一份（页面拿 `file + rawIndex` 发写操作）。 */
export interface FileEventView {
  event: HookEvent
  groups: GroupView[]
  hookCount: number
  disabledCount: number
  runCount: number
}

/** 一个文件在 `/api/hooks` 响应里的呈现。 */
export interface FileView {
  kind: 'project' | 'user'
  path: string
  state: 'absent' | 'ok' | 'error'
  message: string | null
  version: string | null
  /** 该文件里的 hook 条数（含 disabled）。 */
  hookCount: number
  /**
   * 文件里有、但**一条都跑不了**的组（matcher 非法 / 结构坏了 / 没有 command）。
   *
   * 这是"空"与"跑不了"分开说的唯一依据：以前它们被解析器静默丢掉，页面于是把
   * "有 4 条、全跑不了"说成"文件里还没有任何 hook"。
   */
  rejected: RejectedGroupView[]
  /**
   * 这个文件里跑不了的**条数**（= rejected 的 hookCount 之和 + 被跳过的 handler 条数）。
   *
   * 页面用它说"文件里有 N 条，其中 M 条跑不了"。`hookCount + unrunnable` = 文件里真实条目数。
   */
  unrunnable: number
  skipped: SkippedHandler[]
  matcherErrors: string[]
  /**
   * 这个文件自己的 7 个事件视图（含 0 条）。
   *
   * 顶层 `events` 是**生效视图**（合并后、可能来自 last-good），而这里是**可寻址视图**：
   * 页面要编辑哪一行，就用这里的 `file + group.rawIndex + hook.rawIndex` 去发定点操作。
   */
  events: FileEventView[]
}

/** `GET /api/hooks` 的 `data` 形状。 */
export interface HooksSnapshot {
  route: string
  /** `null` = 无法确定当前项目（见 {@link HooksInspection.projectRoot}）。 */
  projectRoot: string | null
  cwd: string | null
  cwdSource: 'session' | 'initiator' | 'none'
  /** 实际生效的作用域（回显）。**页面每次写请求都必须按它带 `workspaceId`**（§2.2）。 */
  scope: ScopeView
  /** 可选的工作区清单。 */
  workspaces: WorkspaceItemView[]
  /** `false` = 宿主没有工作区清单（≠ 没有工作区）。 */
  workspacesAvailable: boolean
  /** 当前会话实际会跑的合并配置（与所选作用域无关，AGENTS §2.6）；`null` = 当前会话未知。 */
  session: SessionEffectView | null
  files: FileView[]
  /** **固定 7 项**，顺序即事件表顺序，含 0 条的事件（AGENTS §3.6）。 */
  events: EventView[]
  total: { hookCount: number; disabledCount: number; groupCount: number; unrunnable: number }
  /** 生效配置是否为"沿用上一份可用配置"（磁盘坏了但运行中的 hook 还在）。 */
  staleInUse: boolean
  /** 页面据此决定要不要显示"只读"横幅与禁用写入控件。 */
  capabilities: { writable: boolean }
}

/** 错误信封：失败**没有 `data`**（AGENTS §4.4 要求自检先补空形状，别一解引用就崩）。 */
export interface HooksErrorBody {
  ok: false
  /** 机器可读的原因码。 */
  error: string
  /** 技术细节（可能为空）。页面主文案不该直接用它。 */
  detail?: string
}

/** 把解析结果里的一个 group 折成可渲染形状（含**文件下标**与最近执行证据）。 */
function groupViewOf(
  group: ParsedGroup,
  options: { file: FileKind | null; event: HookEvent; ledger: LedgerEntry[]; projectRoot: string },
): GroupView {
  const matcher = group.matcher ?? null
  const problem = matcherDiagnostic(matcher ?? undefined)
  return {
    file: options.file,
    rawIndex: group.rawIndex,
    matcher,
    matcherOk: problem === undefined,
    matcherProblem: problem ?? null,
    hooks: group.hooks.map((hook) => {
      // 匹配条件是 `event + command + projectRoot` **三者都要**：命令改过之后旧记录不再匹配
      // （行退回"未运行"的灰色），别的项目里跑过的同命令也不会给这一行上色（AGENTS §3.8 + §2.3）。
      const record = latestRunFor(options.ledger, {
        event: options.event,
        command: hook.command,
        projectRoot: options.projectRoot,
      })
      return {
        rawIndex: hook.rawIndex,
        command: hook.command,
        timeoutSec: hook.timeoutSec ?? null,
        defaultTimeoutSec: DEFAULT_TIMEOUT_MS / 1000,
        disabled: hook.disabled === true,
        lastRun:
          record === undefined
            ? null
            : {
                at: record.at,
                exitCode: record.exitCode ?? null,
                decision: record.decision,
                durationMs: record.durationMs,
                stdout: record.stdout,
                stderr: record.stderr,
              },
      }
    }),
  }
}

/** 统计一份 ParsedGroups 里某个事件的条数。 */
function countsFor(groups: ParsedGroups, event: HookEvent): { hookCount: number; disabledCount: number } {
  let hookCount = 0
  let disabledCount = 0
  for (const group of groups[event] ?? []) {
    for (const hook of group.hooks) {
      if (hook.disabled === true) disabledCount++
      else hookCount++
    }
  }
  return { hookCount, disabledCount }
}

/** 台账里某个事件被真实执行过几次（用来解释"为什么每一行都是灰的"）。 */
function runCountFor(ledger: LedgerEntry[], event: HookEvent): number {
  let count = 0
  for (const entry of ledger) if (entry.event === event) count++
  return count
}

/**
 * 构造只读快照。**纯函数** —— 输入是宿主检视出来的事实，输出是页面的渲染模型。
 *
 * 不变式（都有断言）：
 *   - 顶层 `events` **恒为 7 项**（含 0 条），顺序 = `HOOK_EVENTS`；它是**生效视图**（合并后）。
 *   - 每个 `files[]` 也各带 7 个事件视图，那是**可寻址视图**：页面拿 `file + rawIndex` 去发写操作。
 *   - `hookCount` 不含 `disabled`，停用单独计数（否则页面会把"已停用"显示成"在跑"）。
 *   - 绝不因为某个来源是 `error` 就把它的分组**并进**生效配置 —— 生效配置由宿主给
 *     （可能是 last-good），页面只负责显示并标注 `staleInUse`。
 */
export function buildSnapshot(inspection: HooksInspection): HooksSnapshot {
  const ledger = inspection.ledger
  // 台账匹配用的项目根：**所选作用域**的项目根（工作区作用域下就是那个工作区的根）。
  // 这是"别的项目的绿点不许给这一行上色"的落地（§2.3）。
  const projectRoot = inspection.scope.projectRoot ?? inspection.projectRoot ?? ''

  const files: FileView[] = inspection.sources.map((source) => {
    let hookCount = 0
    const rejected: RejectedGroupView[] = source.rejected.map((one) => ({
      event: one.event,
      groupIndex: one.groupIndex,
      matcher: one.matcher ?? null,
      reason: one.reason,
      hookCount: one.hookCount,
    }))
    const unrunnable = rejected.reduce((sum, one) => sum + one.hookCount, 0) + source.skipped.length
    const events: FileEventView[] = HOOK_EVENTS.map((event) => {
      const parsed = source.groups[event] ?? []
      const count = countsFor(source.groups, event)
      hookCount += count.hookCount + count.disabledCount
      return {
        event,
        groups: parsed.map((group) => groupViewOf(group, { file: source.kind, event, ledger, projectRoot })),
        hookCount: count.hookCount,
        disabledCount: count.disabledCount,
        runCount: runCountFor(ledger, event),
      }
    })
    return {
      kind: source.kind,
      path: source.path,
      state: source.state,
      message: source.message,
      version: source.version,
      hookCount,
      rejected,
      unrunnable,
      skipped: source.skipped,
      matcherErrors: source.matcherErrors,
      events,
    }
  })

  let totalHooks = 0
  let totalDisabled = 0
  let totalGroups = 0
  let totalUnrunnable = 0
  for (const file of files) totalUnrunnable += file.unrunnable
  const events: EventView[] = HOOK_EVENTS.map((event) => {
    const count = countsFor(inspection.effective, event)
    // 来源条数取自**参与合并的两份**（与 `hookCount` 同源）：`fromUser + fromProject === hookCount`
    // 是结构性的。旧的写法遍历 `sources`（**新鲜读**），stale 时会得到 0 / 0 而生效条数是 5
    // —— 页面于是显示"生效 5 条（用户级 0 + 项目级 0）"，与 stale 横幅自相矛盾。
    const fromUser = countsFor(inspection.effectiveUserGroups, event).hookCount
    const fromProject = countsFor(inspection.effectiveProjectGroups, event).hookCount
    // 生效视图的来源（合并顺序 = 用户级在前 + 项目级在后，所以按用户级组数切一刀就能定来源）。
    // `staleInUse` 时生效配置来自 last-good，与磁盘上的来源对不上 → 给 `null`，
    // 页面据此**禁用编辑**（它本来就是读不懂的状态），而不是猜一个文件出来。
    const userCount = (inspection.effectiveUserGroups[event] ?? []).length
    const groups = (inspection.effective[event] ?? []).map((group, index) =>
      groupViewOf(group, {
        file: inspection.staleInUse ? null : index < userCount ? 'user' : 'project',
        event,
        ledger,
        projectRoot,
      }),
    )
    totalHooks += count.hookCount
    totalDisabled += count.disabledCount
    totalGroups += groups.length
    return {
      event,
      groups,
      hookCount: count.hookCount,
      disabledCount: count.disabledCount,
      fromProject,
      fromUser,
      runCount: runCountFor(ledger, event),
    }
  })

  return {
    route: HOOKS_ROUTE,
    projectRoot: inspection.projectRoot,
    cwd: inspection.cwd,
    cwdSource: inspection.cwdSource,
    // 作用域三件套原样透传（纯函数不做任何推导：它是宿主的答案，页面只负责显示与回传）。
    scope: inspection.scope,
    workspaces: inspection.workspaces,
    workspacesAvailable: inspection.workspacesAvailable,
    session: inspection.session,
    files,
    events,
    total: {
      hookCount: totalHooks,
      disabledCount: totalDisabled,
      groupCount: totalGroups,
      unrunnable: totalUnrunnable,
    },
    staleInUse: inspection.staleInUse,
    // 由宿主的 inspection 决定（路由注册了 POST 才为 true）。
    capabilities: { writable: inspection.writable },
  }
}

/** 统一 JSON 响应（`charset=utf-8`：错误与命令里全是中文）。 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** 宿主 `scope.connection.fetch.register()` 的入参形状（只声明我们用的字段）。 */
export interface RouteRegistration {
  path: string
  methods: string[]
  requestBody: 'buffered'
  fetch: (request: Request) => Promise<Response>
}

/** 宿主 `connection.fetch` 桥（只声明我们用的那一件事）。 */
export interface ConnectionFetchBridge {
  readonly fetch: { register(route: RouteRegistration): unknown }
}

/** 取 query 里的 sessionId（页面用它告诉宿主"我在看哪个会话的项目"）。 */
function sessionIdOf(request: Request): string | undefined {
  try {
    const url = new URL(request.url)
    const value = url.searchParams.get('sessionId')
    return value === null || value.length === 0 ? undefined : value
  } catch {
    // 相对 URL（客户端忘了给绝对地址）会让 `new URL` 抛。这不该让请求失败：
    // 没有 sessionId 就退回"宿主当前会话"这条路径，比 500 有用。
    return undefined
  }
}

/**
 * "看/改**哪一份**文件"的显式作用域参数。
 *
 * 路由只做**字符串收窄**（语义在宿主）：
 *   - `current`：会话 cwd 解析出的那份项目文件（**缺省值** —— 保住旧客户端的语义）；
 *   - `user`：`$DSH_HOME/hooks.json`；
 *   - `workspace`：`root(workspaceId)/.dsh/hooks.json`，`workspaceId` 必给。
 *
 * ⚠️ 这是**编辑**作用域，不是运行时开关：hook 仍然按触发事件的会话 cwd 跑（AGENTS §2.6）。
 */
export type ScopeTarget = { kind: 'current' } | { kind: 'user' } | { kind: 'workspace'; workspaceId: string }

/** 作用域参数解析结果。 */
type ScopeParse = { ok: true; target: ScopeTarget } | { ok: false; reason: string }

/** 从 query 解析作用域（`scope` 缺省 = `current`）。**只做字符串收窄**，不认识的一律 400。 */
function scopeOf(request: Request): ScopeParse {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    // 相对 URL：与 sessionId 同理，退回缺省语义比 500 有用。
    return { ok: true, target: { kind: 'current' } }
  }
  const scope = url.searchParams.get('scope')
  if (scope === null || scope === '' || scope === 'current') return { ok: true, target: { kind: 'current' } }
  if (scope === 'user') return { ok: true, target: { kind: 'user' } }
  if (scope === 'workspace') {
    const workspaceId = url.searchParams.get('workspaceId')
    if (workspaceId === null || workspaceId.length === 0) {
      return { ok: false, reason: 'scope=workspace 时必须给 workspaceId' }
    }
    return { ok: true, target: { kind: 'workspace', workspaceId } }
  }
  return { ok: false, reason: `未知的 scope ${JSON.stringify(scope)}（只认 current / user / workspace）` }
}

/** 把写请求的 `file` + `workspaceId` 归一成作用域（写路径与读路径**同一个**类型）。 */
function writeTargetOf(file: FileKind, workspaceId: string | undefined): ScopeTarget {
  if (file === 'user') return { kind: 'user' }
  // 给了 workspaceId 就必须按它解析 —— 解析不到就拒写，**绝不回落**会话项目（§2.2）。
  return workspaceId === undefined ? { kind: 'current' } : { kind: 'workspace', workspaceId }
}

/**
 * 作用域解析失败（工作区不在清单里、宿主没有清单…）。
 *
 * 用异常而不是返回值：`inspect` 要么给出一份完整快照，要么**明确失败**，没有第三种形状 ——
 * 返回值联合会让每个调用点都要多判一次，而漏判的那次就是把"看不到"糊成"空配置"。
 * 路由捕获它并翻成**精确**状态码（不是 500）。
 */
export class ScopeError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ScopeError'
    this.code = code
  }
}

/** 一次写入的结果（宿主给，路由只负责翻成 HTTP）。 */
export interface WriteOutcome {
  ok: boolean
  error?: string
  detail?: string
  version?: string
}

/** 试运行请求。**不是写操作**：它不碰文件，也不进执行台账。 */
export interface DryRunRequest {
  file: FileKind
  event: HookEvent
  /** **文件里的** group 下标（`rawIndex`），不是解析后的数组位置。 */
  groupIndex: number
  /** **文件里的** hook 下标（`rawIndex`）。 */
  hookIndex: number
  /** 与写请求同一套作用域字段：`file:'project'` + 选中工作区时必须给（§2.2）。 */
  workspaceId?: string
}

/** 试运行结果。`exitCode: null` = 子进程没起来（与台账里的语义一致）。 */
export interface DryRunOutcome {
  ok: boolean
  error?: string
  detail?: string
  run?: {
    command: string
    exitCode: number | null
    decision: string
    durationMs: number
    stdout: string
    stderr: string
  }
}

/** 校验试运行请求。畸形请求一律 400，绝不让它走到执行路径。 */
function parseDryRunRequest(
  body: unknown,
): { ok: true; request: DryRunRequest; target: ScopeTarget } | { ok: false; reason: string } {
  if (!isObject(body)) return { ok: false, reason: '请求体不是对象' }
  const { file, event, groupIndex, hookIndex, workspaceId } = body
  if (file !== 'project' && file !== 'user') return { ok: false, reason: 'file 必须是 project / user' }
  if (typeof event !== 'string') return { ok: false, reason: 'event 不是支持的 7 个事件之一' }
  if (!isHookEvent(event)) return { ok: false, reason: 'event 不是支持的 7 个事件之一' }
  if (typeof groupIndex !== 'number' || !Number.isInteger(groupIndex) || groupIndex < 0) {
    return { ok: false, reason: 'groupIndex 必须是非负整数' }
  }
  if (typeof hookIndex !== 'number' || !Number.isInteger(hookIndex) || hookIndex < 0) {
    return { ok: false, reason: 'hookIndex 必须是非负整数' }
  }
  // 与写路径同一条纪律（§2.2）：试运行也要定点到被选中的作用域，绝不回落会话项目。
  if (workspaceId !== undefined) {
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      return { ok: false, reason: 'workspaceId 必须是非空字符串' }
    }
    if (file === 'user') return { ok: false, reason: 'file 为 user 时不许带 workspaceId' }
  }
  const request: DryRunRequest =
    workspaceId === undefined
      ? { file, event, groupIndex, hookIndex }
      : { file, event, groupIndex, hookIndex, workspaceId }
  return { ok: true, request, target: writeTargetOf(file, workspaceId) }
}

/** 路由需要的三个能力：读快照、定点写、试运行。**都带显式作用域**（`target`）。 */
export interface RouteDeps {
  inspect(sessionId: string | undefined, target: ScopeTarget): Promise<HooksInspection>
  write(
    request: HooksRequest,
    target: ScopeTarget,
    sessionId: string | undefined,
    signal: AbortSignal,
  ): Promise<WriteOutcome>
  dryRun(
    request: DryRunRequest,
    target: ScopeTarget,
    sessionId: string | undefined,
    signal: AbortSignal,
  ): Promise<DryRunOutcome>
}

/**
 * 错误码 → HTTP 状态码。
 *
 * 写成 `Record<HostErrorCode, number>`：**漏一个码就是编译错误**（以前是个 switch，新增的
 * `rejected` / `malformed-event` 会静默掉进 500，而页面会显示"插件内部出错了"）。
 * 页面据此把失败**分别**说清（AGENTS §3.9）：`stale` = "文件被别处改过了，请刷新"，
 * `sandbox` = "当前会话权限不允许写"，`invalid-json` = "文件读不出来，为避免覆盖所以没写"。
 * 全用 4xx 表达"你的请求/环境的问题"，5xx 只留给真正的插件内部错误。
 */
const STATUS_OF: Readonly<Record<HostErrorCode, number>> = {
  stale: 409,
  exists: 409,
  'not-preservable': 409,
  'invalid-json': 409,
  'no-project': 409,
  'no-version': 409,
  // 目标组在文件里，但它不会运行（matcher 非法 / 结构坏了）—— 与"真的不在了"分开。
  rejected: 409,
  // 事件键存在但不是数组：文件结构坏了，先修文件再改。
  'malformed-event': 409,
  // 宿主没有工作区清单：不是"你的请求错了"，而是"这个宿主给不了那个能力"。
  'no-workspace-registry': 409,
  absent: 404,
  'not-found': 404,
  // 工作区已经不在清单里（可能被删过）—— 当成"目标不存在"，与 not-found 同档。
  'unknown-workspace': 404,
  sandbox: 403,
  'bad-op': 400,
  'bad-json': 400,
  'out-of-range': 400,
  'resolve-failed': 500,
  'write-failed': 500,
  internal: 500,
}

function statusFor(error: HostErrorCode): number {
  return STATUS_OF[error]
}

/**
 * 注册 `/api/hooks`。**只做 HTTP 适配**：读的语义在 `deps.inspect`、写的语义在 `deps.write`。
 *
 * 错误信封：`{ok:false, error, detail?}` **没有 `data`**；成功是 `{ok:true, data}`。
 * `detail` 只放技术原文，页面主文案要用自己的话（AGENTS §3.9）。
 */
export function registerHooksRoute(connection: ConnectionFetchBridge, deps: RouteDeps): void {
  connection.fetch.register({
    path: HOOKS_ROUTE,
    // POST 与 GET 同时在册：页面用 `capabilities.writable` 决定要不要真的发写请求。
    methods: ['GET', 'POST'],
    // 必须在 bridge 读任何字节**之前**声明（官方契约）。body 只有几百字节，不必流式。
    requestBody: 'buffered',
    async fetch(request: Request): Promise<Response> {
      const sessionId = sessionIdOf(request)
      try {
        if (request.method === 'POST') {
          let body: unknown
          try {
            body = await request.json()
          } catch {
            return jsonResponse(400, { ok: false, error: 'bad-json' })
          }
          // 试运行**不是写操作**：它在写路径之前分流，走的是"读 + 执行"，不碰文件也不进台账。
          if (isObject(body) && body.op === 'dryRun') {
            const parsedDryRun = parseDryRunRequest(body)
            if (!parsedDryRun.ok) return jsonResponse(400, { ok: false, error: 'bad-op', detail: parsedDryRun.reason })
            const outcome = await deps.dryRun(parsedDryRun.request, parsedDryRun.target, sessionId, request.signal)
            if (!outcome.ok) {
              // 目录之外的码一律归成 `internal`：这样"客户端一定有文案"是结构性的，不靠两边手工同步。
              const code = hostErrorCodeOf(outcome.error)
              return jsonResponse(statusFor(code), {
                ok: false,
                error: code,
                ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
              })
            }
            return jsonResponse(200, { ok: true, data: { run: outcome.run } })
          }
          const parsed = parseHooksRequest(body)
          if (!parsed.ok) return jsonResponse(400, { ok: false, error: 'bad-op', detail: parsed.reason })
          // `request.signal`：客户端断开时中止这次写入（官方契约里桥接器会中止处理函数的信号）。
          const outcome = await deps.write(
            parsed.request,
            writeTargetOf(parsed.request.file, parsed.request.workspaceId),
            sessionId,
            request.signal,
          )
          if (!outcome.ok) {
            const code = hostErrorCodeOf(outcome.error)
            return jsonResponse(statusFor(code), {
              ok: false,
              error: code,
              ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
            })
          }
          return jsonResponse(200, {
            ok: true,
            data: { file: parsed.request.file, version: outcome.version ?? null },
          })
        }
        const scope = scopeOf(request)
        if (!scope.ok) return jsonResponse(400, { ok: false, error: 'bad-op', detail: scope.reason })
        const inspection = await deps.inspect(sessionId, scope.target)
        return jsonResponse(200, { ok: true, data: buildSnapshot(inspection) })
      } catch (error) {
        // 作用域解析失败要**精确**说清（404 工作区不在清单 / 409 宿主没有清单），不许糊成 500。
        if (error instanceof ScopeError) {
          const code = hostErrorCodeOf(error.code)
          return jsonResponse(statusFor(code), { ok: false, error: code, detail: error.message })
        }
        // 技术原文留在 detail 里，页面自己决定怎么措辞 —— 绝不把 FsError 原文当主文案。
        return jsonResponse(500, { ok: false, error: 'internal', detail: messageOf(error) })
      }
    },
  })
}

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

import { HOOK_EVENTS, DEFAULT_TIMEOUT_MS, type HookEvent } from '../shared/constants.ts'
import { messageOf } from '../shared/guards.ts'
import { matcherDiagnostic } from '../shared/protocol.ts'
import type { ParsedGroups, SkippedHandler } from '../shared/types.ts'

/**
 * 本插件注册的浏览器路由。
 *
 * 宿主 `register()` 与客户端 `fetch()` 必须**逐字一致**，所以它是唯一常量而不是两处字面量。
 * 必须以 `/api/` 开头（`connection.fetch` 自己校验），并因此自带 Host/Origin 围栏（403）与
 * 浏览器鉴权（401）。
 */
export const HOOKS_ROUTE = '/api/hooks'

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
  /** matcher 诊断（非法 matcher 只跳过该 group，不整份拒绝）。 */
  matcherErrors: string[]
}

/** 宿主提供的一次完整检视结果。 */
export interface HooksInspection {
  /**
   * 当前项目根。**`null` = 无法确定当前项目**（没有会话上下文）——
   * 这时只列用户级配置，绝不编造一个 workspace 路径（AGENTS §2.8）。
   */
  projectRoot: string | null
  /** 会话 cwd；**拿不到就是 null，不编造**。 */
  cwd: string | null
  /** cwd 是从哪来的 —— 如实报告来源，页面才能说清"这个项目是怎么定的"。 */
  cwdSource: 'session' | 'initiator' | 'none'
  /** 正常情况恒为 2 项（项目级、用户级）；项目无法确定时只有用户级 1 项。 */
  sources: SourceInspection[]
  /** 生效配置（用户级在前 + 项目级在后，跨来源同事件拼接）。 */
  effective: ParsedGroups
  /** 生效配置是否来自"沿用上一份可用配置"（磁盘当前读不出来）。 */
  staleInUse: boolean
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
}

/** 一个 group 的呈现。matcher 属于 group，command/timeout 属于 hook。 */
export interface GroupView {
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
  skipped: SkippedHandler[]
  matcherErrors: string[]
}

/** `GET /api/hooks` 的 `data` 形状。 */
export interface HooksSnapshot {
  route: string
  /** `null` = 无法确定当前项目（见 {@link HooksInspection.projectRoot}）。 */
  projectRoot: string | null
  cwd: string | null
  cwdSource: 'session' | 'initiator' | 'none'
  files: FileView[]
  /** **固定 7 项**，顺序即事件表顺序，含 0 条的事件（AGENTS §3.6）。 */
  events: EventView[]
  total: { hookCount: number; disabledCount: number; groupCount: number }
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

/** 把解析结果里的一个 group 折成可渲染形状。 */
function groupViewOf(group: {
  matcher?: string
  hooks: Array<{ command: string; timeoutSec?: number; disabled?: boolean }>
}): GroupView {
  const matcher = group.matcher ?? null
  const problem = matcherDiagnostic(matcher ?? undefined)
  return {
    matcher,
    matcherOk: problem === undefined,
    matcherProblem: problem ?? null,
    hooks: group.hooks.map((hook) => ({
      command: hook.command,
      timeoutSec: hook.timeoutSec ?? null,
      defaultTimeoutSec: DEFAULT_TIMEOUT_MS / 1000,
      disabled: hook.disabled === true,
    })),
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

/**
 * 构造只读快照。**纯函数** —— 输入是宿主检视出来的事实，输出是页面的渲染模型。
 *
 * 不变式（都有断言）：
 *   - `events` **恒为 7 项**（含 0 条），顺序 = `HOOK_EVENTS`；
 *   - `files` **恒为 2 项**（项目级、用户级），含 `absent`；
 *   - `hookCount` 不含 `disabled`，停用单独计数（否则页面会把"已停用"显示成"在跑"）；
 *   - 绝不因为某个来源是 `error` 就把它的分组 **并进** 生效配置 —— 生效配置由宿主给
 *     （可能是 last-good），页面只负责显示并标注 `staleInUse`。
 */
export function buildSnapshot(inspection: HooksInspection): HooksSnapshot {
  const files: FileView[] = inspection.sources.map((source) => {
    let hookCount = 0
    for (const event of HOOK_EVENTS)
      hookCount += countsFor(source.groups, event).hookCount + countsFor(source.groups, event).disabledCount
    return {
      kind: source.kind,
      path: source.path,
      state: source.state,
      message: source.message,
      version: source.version,
      hookCount,
      skipped: source.skipped,
      matcherErrors: source.matcherErrors,
    }
  })

  let totalHooks = 0
  let totalDisabled = 0
  let totalGroups = 0
  const events: EventView[] = HOOK_EVENTS.map((event) => {
    const count = countsFor(inspection.effective, event)
    let fromUser = 0
    let fromProject = 0
    for (const source of inspection.sources) {
      const hits = countsFor(source.groups, event).hookCount
      if (source.kind === 'user') fromUser += hits
      else fromProject += hits
    }
    const groups = (inspection.effective[event] ?? []).map(groupViewOf)
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
    }
  })

  return {
    route: HOOKS_ROUTE,
    projectRoot: inspection.projectRoot,
    cwd: inspection.cwd,
    cwdSource: inspection.cwdSource,
    files,
    events,
    total: { hookCount: totalHooks, disabledCount: totalDisabled, groupCount: totalGroups },
    staleInUse: inspection.staleInUse,
    // P4b 接上写入后改成 true；在那之前页面显示只读横幅，而不是让用户点了没反应。
    capabilities: { writable: false },
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
 * 注册 `/api/hooks`。**只做 HTTP 适配**：真正的语义（读文件、合并、判定 stale）在 `inspect` 里。
 *
 * 错误信封：`{ok:false, error, detail?}` **没有 `data`**；成功是 `{ok:true, data}`。
 * 500 的 `detail` 只放技术原文，页面主文案要用自己的话（AGENTS §3.9）。
 */
export function registerHooksRoute(
  connection: ConnectionFetchBridge,
  inspect: (sessionId: string | undefined) => Promise<HooksInspection>,
): void {
  connection.fetch.register({
    path: HOOKS_ROUTE,
    methods: ['GET'],
    // 必须在 bridge 读任何字节**之前**声明（官方契约）。body 只有几百字节，不必流式。
    requestBody: 'buffered',
    async fetch(request: Request): Promise<Response> {
      try {
        const inspection = await inspect(sessionIdOf(request))
        return jsonResponse(200, { ok: true, data: buildSnapshot(inspection) })
      } catch (error) {
        // 技术原文留在 detail 里，页面自己决定怎么措辞 —— 绝不把 FsError 原文当主文案。
        return jsonResponse(500, { ok: false, error: 'internal', detail: messageOf(error) })
      }
    },
  })
}

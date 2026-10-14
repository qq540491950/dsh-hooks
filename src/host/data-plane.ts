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
import { messageOf } from '../shared/guards.ts'
import { matcherDiagnostic } from '../shared/protocol.ts'
import type { ParsedGroup, ParsedGroups, SkippedHandler } from '../shared/types.ts'
import { latestRunFor, type LedgerEntry } from './ledger.ts'
import { parseHooksRequest, type FileKind, type HooksRequest } from './write.ts'

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

/** 把解析结果里的一个 group 折成可渲染形状（含**文件下标**与最近执行证据）。 */
function groupViewOf(
  group: ParsedGroup,
  options: { file: FileKind | null; event: HookEvent; ledger: LedgerEntry[] },
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
      // 匹配条件是 `event + command` **两者都要**：命令改过之后旧记录不再匹配 → 行退回"未运行"
      // 的灰色，而不是拿**旧命令**的结果给新命令画绿（AGENTS §3.8）。
      const record = latestRunFor(options.ledger, options.event, hook.command)
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
  const userSource = inspection.sources.find((source) => source.kind === 'user')

  const files: FileView[] = inspection.sources.map((source) => {
    let hookCount = 0
    const events: FileEventView[] = HOOK_EVENTS.map((event) => {
      const parsed = source.groups[event] ?? []
      const count = countsFor(source.groups, event)
      hookCount += count.hookCount + count.disabledCount
      return {
        event,
        groups: parsed.map((group) => groupViewOf(group, { file: source.kind, event, ledger })),
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
      skipped: source.skipped,
      matcherErrors: source.matcherErrors,
      events,
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
    // 生效视图的来源（合并顺序 = 用户级在前 + 项目级在后，所以按用户级条数切一刀就能定来源）。
    // `staleInUse` 时生效配置来自 last-good，与磁盘上的来源对不上 → 给 `null`，
    // 页面据此**禁用编辑**（它本来就是读不懂的状态），而不是猜一个文件出来。
    const userCount = (userSource?.groups[event] ?? []).length
    const groups = (inspection.effective[event] ?? []).map((group, index) =>
      groupViewOf(group, {
        file: inspection.staleInUse ? null : index < userCount ? 'user' : 'project',
        event,
        ledger,
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
    files,
    events,
    total: { hookCount: totalHooks, disabledCount: totalDisabled, groupCount: totalGroups },
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

/** 一次写入的结果（宿主给，路由只负责翻成 HTTP）。 */
export interface WriteOutcome {
  ok: boolean
  error?: string
  detail?: string
  version?: string
}

/** 路由需要的两个能力：读快照、定点写。 */
export interface RouteDeps {
  inspect(sessionId: string | undefined): Promise<HooksInspection>
  write(request: HooksRequest, sessionId: string | undefined, signal: AbortSignal): Promise<WriteOutcome>
}

/**
 * 错误码 → HTTP 状态码。
 *
 * 页面据此把失败**分别**说清（AGENTS §3.9）：`stale` = "文件被别处改过了，请刷新"，
 * `sandbox` = "当前会话权限不允许写"，`invalid-json` = "文件读不出来，为避免覆盖所以没写"。
 * 全用 4xx 表达"你的请求/环境的问题"，5xx 只留给真正的插件内部错误。
 */
function statusFor(error: string | undefined): number {
  switch (error) {
    case 'stale':
    case 'exists':
    case 'not-preservable':
    case 'invalid-json':
    case 'no-project':
    case 'no-version':
      return 409
    case 'absent':
    case 'not-found':
      return 404
    case 'sandbox':
      return 403
    case 'bad-op':
    case 'bad-json':
      return 400
    default:
      return 500
  }
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
          const parsed = parseHooksRequest(body)
          if (!parsed.ok) return jsonResponse(400, { ok: false, error: 'bad-op', detail: parsed.reason })
          // `request.signal`：客户端断开时中止这次写入（官方契约里桥接器会中止处理函数的信号）。
          const outcome = await deps.write(parsed.request, sessionId, request.signal)
          if (!outcome.ok) {
            return jsonResponse(statusFor(outcome.error), {
              ok: false,
              error: outcome.error ?? 'write-failed',
              ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
            })
          }
          return jsonResponse(200, {
            ok: true,
            data: { file: parsed.request.file, version: outcome.version ?? null },
          })
        }
        const inspection = await deps.inspect(sessionId)
        return jsonResponse(200, { ok: true, data: buildSnapshot(inspection) })
      } catch (error) {
        // 技术原文留在 detail 里，页面自己决定怎么措辞 —— 绝不把 FsError 原文当主文案。
        return jsonResponse(500, { ok: false, error: 'internal', detail: messageOf(error) })
      }
    },
  })
}

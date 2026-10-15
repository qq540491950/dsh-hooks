/**
 * 客户端的写请求层。
 *
 * ## 两条铁律
 *   1. **只发定点操作**，绝不回传整份文件（AGENTS §2.3）：回传整份 = 静默丢字段的老事故。
 *      所以请求体只有"改哪一份文件的哪一处、改成什么"。
 *   2. `requestWrite` **永不抛**：网络错误、非 JSON 响应都折叠成同一个结果形状，调用方只判 `ok`。
 *      否则每个调用点都要写一遍 try/catch，迟早漏一个 —— 漏掉的那次就是"点了没反应"。
 */

import { HOOKS_ROUTE } from '../shared/constants.ts'
import type { HooksWriteResponse } from './wire.ts'

/**
 * 作用域的取值：`'user'`、`'current'`（**当前会话的项目**）或**工作区 id**。
 *
 * `'current'` 是刻意保留的第三种值：会话所在的项目**不一定**在 `workspaceRegistry` 清单里
 * （本机正在开发的插件项目就是这样）。它由宿主按"会话 cwd → 最近 `.git` 祖先"解析 —— 与旧页面
 * 的语义完全一致，而且**不能**伪装成一个工作区 id（伪装了宿主只会回 404）。
 */
export type ScopeValue = string

/** 作用域取值：当前会话的项目（宿主按会话 cwd 解析，不涉及工作区清单）。 */
export const CURRENT_SCOPE = 'current'

/** 作用域 → 请求体的定位字段。**这是唯一的构造点**（§2.2：禁止各调用点自己拼）。 */
export function scopeTargetOf(scope: ScopeValue): { file: 'project' | 'user'; workspaceId?: string } {
  if (scope === 'user') return { file: 'user' }
  // `'current'` **必须不带** `workspaceId`：带上就等于谎称"它是某个工作区"，宿主会照白名单去查
  // → `unknown-workspace`（404）。不带时宿主按会话 cwd 解析（就是旧页面的语义）。
  if (scope === CURRENT_SCOPE) return { file: 'project' }
  return { file: 'project', workspaceId: scope }
}

/**
 * `GET /api/hooks` 的 query（读也必须定点到作用域，否则页面看的是"当前会话的项目"，
 * 而写的是选中的那个工作区 —— 那就是另一条"看着 A 改到 B"的路）。
 */
export function scopeQuery(scope: ScopeValue): string {
  if (scope === 'user') return '?scope=user'
  if (scope === CURRENT_SCOPE) return '?scope=current'
  return `?scope=workspace&workspaceId=${encodeURIComponent(scope)}`
}

/** 一次写操作的**意图**（不含 `file`：那一项由作用域决定，见 `intentFor`）。 */
export type WriteOp =
  | { op: 'createFile' }
  | { op: 'setHookDisabled'; event: string; groupIndex: number; hookIndex: number; disabled: boolean }
  | { op: 'setHookCommand'; event: string; groupIndex: number; hookIndex: number; command: string }
  | { op: 'setHookTimeout'; event: string; groupIndex: number; hookIndex: number; timeoutSec: number | null }
  | { op: 'setGroupMatcher'; event: string; groupIndex: number; matcher: string | null }
  | { op: 'addHook'; event: string; groupIndex: number; command: string; timeoutSec: number | null }
  | { op: 'addGroup'; event: string; matcher: string | null; command: string; timeoutSec: number | null }
  | { op: 'removeHook'; event: string; groupIndex: number; hookIndex: number }
  | { op: 'moveHook'; event: string; groupIndex: number; hookIndex: number; direction: -1 | 1 }
  | { op: 'removeGroup'; event: string; groupIndex: number }

/** 真正发出去的请求体（字段与宿主 `write.ts` 的 `HooksRequest` 一一对应）。 */
export type WriteIntent = WriteOp & { file: 'project' | 'user'; workspaceId?: string }

/**
 * **唯一**的请求体构造函数：`(作用域, 操作) → WriteIntent`。
 *
 * 为什么必须是函数而不是"各调用点自己写 file/workspaceId"：只要有一个调用点忘了带
 * `workspaceId`，宿主就会按**会话 cwd** 落笔 —— 页面看着 A 项目、改到 B 项目，而且是静默的
 * （§2.2 里最重的一条）。收成一个构造点之后，"选中工作区却没带 id"在结构上不可能发生。
 */
export function intentFor(scope: ScopeValue, op: WriteOp): WriteIntent {
  return { ...scopeTargetOf(scope), ...op }
}

/** 写请求的结果（永不抛，所以调用方只需判 `ok`）。 */
export interface WriteOutcome {
  ok: boolean
  error?: string
  detail?: string
  version?: string
}

/**
 * 错误码 → 人话：**每个码一句不同的话**（AGENTS §3.9）。
 *
 * 糊成一句"保存失败"是不允许的：用户据此分不清"该刷新页面"、"该去修文件"、"该换权限"。
 * 宿主返回的 `detail` 是技术原文，只作补充，**绝不**当主文案。
 */
export function writeErrorSentence(error: string): string {
  switch (error) {
    case 'stale':
      return '这个文件刚被别处改过了，页面上的内容已经不是最新的。请刷新后再改。'
    case 'invalid-json':
      return '文件现在读不出来（内容不是合法 JSON）。为避免覆盖你的内容，这次**没有写入**，请先手工修好文件。'
    case 'not-preservable':
      return '这次改动会动到目标以外的字段。为避免破坏文件，已拒绝写入。'
    case 'sandbox':
      return '当前会话的权限不允许写这个文件（沙箱限制）。'
    case 'absent':
      return '这份配置文件还不存在。'
    case 'exists':
      return '文件已经存在，不能再"新建"。'
    case 'not-found':
      return '要改的那一条已经不在了（文件可能刚被改过），请刷新。'
    case 'bad-op':
      return '这次请求不合法（界面与宿主的版本可能不一致）。'
    case 'bad-timeout':
      // 纯前端校验：还没发请求就被拦下了（表单内错误通道，§3.7）。
      return '超时必须是正数秒；留空就用默认 600s。'
    case 'no-project':
      return '无法确定当前项目，所以不能写项目级配置。'
    case 'unknown-workspace':
      return '这个工作区已经不在宿主的清单里了（可能被删过），请刷新页面后重试。'
    case 'no-workspace-registry':
      return '宿主没有提供工作区清单，只能改当前项目和用户级配置。'
    case 'network':
      return '连不上宿主，写入没有发生。'
    default:
      return `写入失败（${error}）。`
  }
}

/** 发一次写请求。`signal` 用于组件卸载/超时中断。 */
export async function requestWrite(intent: WriteIntent, signal?: AbortSignal): Promise<WriteOutcome> {
  try {
    const response = await fetch(HOOKS_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // 鉴权是 host-only 的同源 cookie（官方 connection 层管），带上同源凭据即可。
      credentials: 'same-origin',
      body: JSON.stringify(intent),
      ...(signal === undefined ? {} : { signal }),
    })
    const body = (await response.json()) as HooksWriteResponse
    if (body.ok) {
      const version = body.data === undefined ? null : body.data.version
      return version === null ? { ok: true } : { ok: true, version }
    }
    const outcome: WriteOutcome = { ok: false, error: typeof body.error === 'string' ? body.error : 'internal' }
    return typeof body.detail === 'string' ? { ...outcome, detail: body.detail } : outcome
  } catch (error) {
    return { ok: false, error: 'network', detail: error instanceof Error ? error.message : String(error) }
  }
}

/** 试运行要改哪一条（**文件 + 事件 + 两个文件下标**，与写操作同一套寻址）。 */
export type DryRunIntent = { event: string; groupIndex: number; hookIndex: number } & {
  file: 'project' | 'user'
  workspaceId?: string
}

/** 试运行的寻址（同样经**唯一**构造点：作用域 → file + workspaceId）。 */
export function dryRunFor(
  scope: ScopeValue,
  address: { event: string; groupIndex: number; hookIndex: number },
): DryRunIntent {
  return { ...scopeTargetOf(scope), ...address }
}

/** 试运行的结果（宿主 `DryRunOutcome.run`）。 */
export interface DryRunView {
  command: string
  /** `null` = 子进程没起来（与台账里的语义一致，页面据此说"启动失败"而不是绿）。 */
  exitCode: number | null
  decision: string
  durationMs: number
  stdout: string
  stderr: string
}

/** 一次试运行的结果。同样**永不抛**。 */
export interface DryRunResult {
  ok: boolean
  error?: string
  detail?: string
  run?: DryRunView
}

/**
 * 试运行一条 hook。
 *
 * **不是写操作**：它不碰文件，也**不进执行台账**（§3.8 —— 一次预演不该把那一行画绿），
 * 所以它走独立的响应形状，不套用 `WriteOutcome`。
 */
export async function requestDryRun(intent: DryRunIntent, signal?: AbortSignal): Promise<DryRunResult> {
  try {
    const response = await fetch(HOOKS_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ op: 'dryRun', ...intent }),
      ...(signal === undefined ? {} : { signal }),
    })
    const body = (await response.json()) as {
      ok: boolean
      data?: { run?: DryRunView }
      error?: string
      detail?: string
    }
    if (body.ok) {
      const run = body.data === undefined ? undefined : body.data.run
      return run === undefined ? { ok: false, error: 'internal' } : { ok: true, run }
    }
    const outcome: DryRunResult = { ok: false, error: typeof body.error === 'string' ? body.error : 'internal' }
    return typeof body.detail === 'string' ? { ...outcome, detail: body.detail } : outcome
  } catch (error) {
    return { ok: false, error: 'network', detail: error instanceof Error ? error.message : String(error) }
  }
}

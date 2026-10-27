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
import { ERROR_SENTENCES } from '../shared/errors.ts'
import type { SentenceErrorCode } from '../shared/errors.ts'
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

/**
 * `sessionId` 的 query 片段（空串 = 不带）。
 *
 * 为什么必须带：**设置页拿不到"当前会话"**，宿主侧只能退回 `currentInitiator()` —— 而设置页里
 * 它取不到，于是整页"当前会话未知"：项目根解析不出来、`scope=current` 不可用、
 * 「当前会话生效 N 条」也没意义。会话 id 由 root kit 的 `useSessions` 交给页面（见 `section.tsx`）。
 */
export function sessionQuery(sessionId: string | undefined): string {
  return sessionId === undefined || sessionId === '' ? '' : `?sessionId=${encodeURIComponent(sessionId)}`
}

/** `GET /api/hooks` 的完整相对路径：**作用域 + 会话**两件事都要定点（缺一个页面就在撒谎）。 */
export function snapshotPath(scope: ScopeValue, sessionId: string | undefined): string {
  const scopePart = scopeQuery(scope).slice(1)
  const sessionPart = sessionQuery(sessionId).slice(1)
  return `${HOOKS_ROUTE}?${[scopePart, sessionPart].filter((part) => part !== '').join('&')}`
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
  | {
      op: 'moveHook'
      event: string
      groupIndex: number
      hookIndex: number
      direction: -1 | 1
      /**
       * 目标位置的**文件下标**（邻居的真实下标）。
       *
       * 页面上"上一条"是**解析后**的邻居，而解析会跳过非 command 条目 —— 于是"相邻"在文件里
       * 可能是 0 和 2。只发 `direction` 会与文件里的 1 号互换，用户点了上移却看不出变化。
       */
      toIndex?: number
    }
  | { op: 'removeGroup'; event: string; groupIndex: number }

/** 真正发出去的请求体（字段与宿主 `write.ts` 的 `HooksRequest` 一一对应）。 */
export type WriteIntent = WriteOp & {
  file: 'project' | 'user'
  workspaceId?: string
  /**
   * 页面看到的那份文件的版本（乐观锁的**页面侧**那一半）。
   *
   * - 字符串 = "我看到的是这个版本" → 宿主按它做 `replaceIfVersion`，不符就 `stale`；
   * - `null` = "我以为它还不存在" → 宿主要求目标**确实不存在**；
   * - 缺省 = 旧页面的语义（宿主读后写），只为向后兼容而保留。
   *
   * 为什么必须有：`groupIndex` / `hookIndex` 是**文件下标**。别处插/删一条之后，同一个下标会指向
   * 另一条 hook —— 而保留性证明只证明"我只改了声明的那一处"，证明不了"那一处还是原来那条"。
   * 没有这一半，删除/启停会静默落到别的 hook 上（且不可撤销）。
   */
  expectedVersion?: string | null
}

/**
 * **唯一**的请求体构造函数：`(作用域, 操作, 页面版本) → WriteIntent`。
 *
 * 为什么必须是函数而不是"各调用点自己写 file/workspaceId"：只要有一个调用点忘了带
 * `workspaceId`，宿主就会按**会话 cwd** 落笔 —— 页面看着 A 项目、改到 B 项目，而且是静默的
 * （§2.2 里最重的一条）。收成一个构造点之后，"选中工作区却没带 id"在结构上不可能发生。
 */
export function intentFor(scope: ScopeValue, op: WriteOp, expectedVersion?: string | null): WriteIntent {
  const base: WriteIntent = { ...scopeTargetOf(scope), ...op }
  return expectedVersion === undefined ? base : { ...base, expectedVersion }
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
 *
 * 表本身在 `src/shared/errors.ts`（与"宿主能返回哪些码"同一份目录）：加一个码而忘了写文案，
 * 自检的表驱动断言会当场红 —— 这条以前是**静默**的（页面会显示"写入失败（no-version）。"）。
 */
export function writeErrorSentence(error: string): string {
  const known = ERROR_SENTENCES[error as SentenceErrorCode]
  return typeof known === 'string' ? known : `写入失败（${error}）。`
}

/**
 * 发一次写请求。
 *
 * `sessionId` 也走 **query**（宿主从 URL 取它，见 `data-plane.ts` 的 `sessionIdOf`）——
 * 宿主据此解析调用会话的 cwd 与沙箱策略；不带时它会退回"当前发起者"，设置页里常常取不到。
 * `signal` 用于组件卸载/超时中断。
 */
export async function requestWrite(
  intent: WriteIntent,
  sessionId: string | undefined,
  signal?: AbortSignal,
): Promise<WriteOutcome> {
  try {
    const response = await fetch(`${HOOKS_ROUTE}${sessionQuery(sessionId)}`, {
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
    // 中止（时间预算用完 / 组件卸载）与"连不上"要分开说：前者用户可以重试，后者多半是宿主没起。
    const aborted = error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message))
    return {
      ok: false,
      error: aborted ? 'timeout' : 'network',
      detail: error instanceof Error ? error.message : String(error),
    }
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
export async function requestDryRun(
  intent: DryRunIntent,
  sessionId: string | undefined,
  signal?: AbortSignal,
): Promise<DryRunResult> {
  try {
    const response = await fetch(`${HOOKS_ROUTE}${sessionQuery(sessionId)}`, {
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
    const aborted = error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message))
    return {
      ok: false,
      error: aborted ? 'timeout' : 'network',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

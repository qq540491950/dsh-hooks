/**
 * 执行台账：**状态色的唯一证据来源**（AGENTS §3.8）。
 *
 * 没有这一层的话，页面只能靠"没报错就报绿"来上色 —— 那正是 `dsh-mcp-manager` 被
 * `failOnStartupError:false` 骗过绿的同一条失效路径。
 *
 * 两条硬约束（§2.11）：
 *   - **有界**：全局 {@link MAX_GLOBAL} 条、单会话 {@link MAX_PER_SESSION} 条，超出丢最旧的；
 *   - **截断**：stdout/stderr 按字符数截断后再进快照，**绝不许**把 hook 的完整输出塞进 HTTP 响应。
 *
 * 台账里的每一条都是一次**真实执行**的事实（真实的 `exitCode` / `decision` / 耗时），
 * 所以"有记录"本身就是正面证据。
 */

import type { HookEvent } from '../shared/constants.ts'

/** 全局上限（条）。 */
export const MAX_GLOBAL = 500
/** 单会话上限（条）。 */
export const MAX_PER_SESSION = 200
/** 单段输出保留的最大字符数（stdout / stderr 各一份）。 */
export const MAX_TEXT_CHARS = 2_000

/** 一次真实执行的记录。 */
export interface LedgerEntry {
  /** 何时执行（`Date.now()`）。 */
  at: number
  /** 哪个会话触发的（拿不到就是空串，不要编造）。 */
  sessionId: string
  event: HookEvent
  /** 执行的那条命令（**完整**，匹配用；输出才截断）。 */
  command: string
  /** `undefined` = 子进程没起来（infra 失败），这本身是正面证据。 */
  exitCode: number | undefined
  /** 解码后的判决：`deny` / `ask` / `allow` / `block` / `none` / `pass`。 */
  decision: string
  durationMs: number
  stdout: string
  stderr: string
}

/** 截断（超长加一个明确的省略标记，而不是静默切掉）。 */
export function truncateText(text: string, max = MAX_TEXT_CHARS): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…（已截断 ${text.length - max} 字符）`
}

/**
 * 有界环形台账。
 *
 * 用"超出就丢最旧的"而不是拒绝新的：最新的执行才是用户要看的那一条。
 */
export class ExecutionLedger {
  private readonly items: LedgerEntry[] = []

  /** 记一次执行（stdout/stderr 在这里就截断，快照里天然不会超限）。 */
  push(entry: LedgerEntry): void {
    this.items.push({ ...entry, stdout: truncateText(entry.stdout), stderr: truncateText(entry.stderr) })
    this.enforceSessionCap(entry.sessionId)
    while (this.items.length > MAX_GLOBAL) this.items.shift()
  }

  /** 当前所有记录（从旧到新）。 */
  entries(): LedgerEntry[] {
    return [...this.items]
  }

  get size(): number {
    return this.items.length
  }

  /** 清空（fiber 释放时用）。 */
  clear(): void {
    this.items.length = 0
  }

  /** 单会话超限时丢该会话最旧的一条。 */
  private enforceSessionCap(sessionId: string): void {
    let count = 0
    for (const item of this.items) if (item.sessionId === sessionId) count++
    while (count > MAX_PER_SESSION) {
      const index = this.items.findIndex((item) => item.sessionId === sessionId)
      if (index < 0) return
      this.items.splice(index, 1)
      count--
    }
  }
}

/**
 * 找某条 hook 的最近一次**真实**执行记录。
 *
 * 匹配条件是 `event + command` **两者都要**：命令改过之后旧记录就不再匹配 ——
 * 于是行会退回"未运行"的灰色，而不是拿**旧命令**的结果给新命令画绿。
 * 这是 §3.8 里"缓存记录不能给不同 command 上色"的落地方式。
 */
export function latestRunFor(entries: LedgerEntry[], event: HookEvent, command: string): LedgerEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry !== undefined && entry.event === event && entry.command === command) return entry
  }
  return undefined
}

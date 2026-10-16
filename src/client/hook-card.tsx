/**
 * 一张卡 = **一条 hook**（v4：ZCode 密度）。
 *
 * ```
 * ●  工具运行前 PreToolUse            未运行                [ ●—— ]  ⋯
 *    node -e const fs=require('node:fs')…
 * ```
 *   - 第一行：28×28 槽位里的**状态点** + 中文名主/英文枚举次要 + 作用域标签 + **一个状态词** +
 *     开关 + `⋯`（更多）；
 *   - 第二行：command（mono、省略号）；
 *   - `⋯` 展开后才有第三块：`匹配 X · 超时 Y` + 三个动作（试运行 / 编辑 / 删除）。
 *
 * ## v4 相对 v3 砍掉了什么（用户原话："非要使用一堆说明和检测"）
 *   - **整条 meta 行消失**：`匹配 pwsh|bash` / `默认 600 秒` / `未运行（没有执行记录）` 全部
 *     退出首屏 —— 前两者进 `⋯` 菜单，后者的原因本来就在状态点 `title` 里；
 *   - **三个动作按钮不再常驻**（它们以前是 hover 才显形，但仍然占着一行），现在收进 `⋯`；
 *   - 标题行只留**一个**状态词（`未运行` / `通过` / `失败` / `已阻断`），`exit N · 12ms` 这种
 *     技术串只进 `title`——**颜色和词都还在**（§3.8 要求状态必须有正面证据），只是不再把证据
 *     摆在正文里。
 *
 * ## 不许砍的三样（都在这一屏上，砍了就是撒谎）
 *   1. **状态点**：颜色只来自执行台账 / `disabled`（§3.8）。无记录 = 灰。
 *   2. **状态词**：只有颜色的话，色觉障碍用户与纯文本渲染都拿不到"跑没跑"这个答案。
 *   3. **`已停用` / `不会运行`**：停用与 matcher 非法都是"这条根本不会跑"，必须看得见
 *      （matcher 非法是**例外态**，所以它允许在这一屏多占一个标签：默认不占屏 ≠ 出事也不说）。
 *
 * ## 纯 props，零 hook（硬约束）
 * `tools/verify.ts` 的假 React 只能展开**不用 hook 的子组件**。所以这里不持有任何状态：
 * 菜单是否展开、正在编辑哪一条、草稿、删除确认态、试运行结果全部由 `HooksSection` 传下来。
 *
 * ## 文本纪律（修过的真 bug）
 * 页面上**不许出现 markdown 语法**（截图里 `**agent-go**` 把星号原样渲染出来了）。
 * 要强调就用 `<strong className="dsh-hooks__strong">`，**不要**在字符串里写星号对。
 */

import { h } from './react.ts'
import type { Jsx } from './react.ts'
import { eventLabel, eventTitle } from './labels.ts'
import type { HookView } from './wire.ts'

/**
 * 行状态：**颜色与词都只能来自真实执行记录或 `disabled`**（§3.8）。
 *
 * - `label` 是正文里那**一个词**（`未运行` / `通过` / `失败` / `已阻断`）；停用时是空串 ——
 *   那时标题行上已经有 `已停用` 标签，再写一个词就是同一句话说两遍；
 * - `evidence` 是它凭什么这么说的**短证据**，只作 `title`（v3 起就不进正文：用户说那是字段 dump）。
 */
export function statusOf(hook: HookView): { className: string; label: string; evidence: string } {
  const run = hook.lastRun
  const last =
    run === null
      ? ''
      : `exit ${run.exitCode === null ? 'spawn-failed' : String(run.exitCode)} · ${String(run.durationMs)}ms`
  if (hook.disabled) {
    return {
      className: 'dsh-hooks__dot',
      label: '',
      evidence: last === '' ? '已停用，不会运行' : `已停用，不会运行（上次 ${last}）`,
    }
  }
  if (run === null) return { className: 'dsh-hooks__dot', label: '未运行', evidence: '没有执行记录' }
  if (run.decision === 'deny' || run.decision === 'block') {
    return {
      className: 'dsh-hooks__dot dsh-hooks__dot--deny',
      label: '已阻断',
      evidence: `decision ${run.decision} · ${last}`,
    }
  }
  if (run.exitCode === 0) {
    return {
      className: 'dsh-hooks__dot dsh-hooks__dot--ok',
      label: '通过',
      evidence: `exit 0 · ${String(run.durationMs)}ms`,
    }
  }
  return {
    className: 'dsh-hooks__dot dsh-hooks__dot--warn',
    label: '失败',
    evidence: `exit ${String(run.exitCode)} · ${String(run.durationMs)}ms`,
  }
}

/**
 * 一条 hook 的卡片。全部动作都是外面传进来的回调（本组件不知道怎么写盘）。
 *
 * `menuOpen` 由外层持有（与"正在编辑哪一条"同一个 key）——编辑与删除确认都在菜单里完成，
 * 所以外层在进入编辑/确认时会**同时把菜单打开**，否则用户点完"编辑"就找不到"保存"。
 */
export function HookCard(props: {
  hook: HookView
  event: string
  /** group 上的 matcher（`null` = 匹配全部）。 */
  matcher: string | null
  matcherProblem: string | null
  writable: boolean
  busy: boolean
  editing: boolean
  draft: string
  confirming: boolean
  /** `⋯` 是否展开（匹配范围 / 超时 / 三个动作都在这块里）。 */
  menuOpen: boolean
  /** 刚试运行完的结果文案（空串 = 没有）。**不进台账**：预演不该给状态上色（§3.8）。 */
  dryText: string
  onToggle: () => void
  onToggleMenu: () => void
  onStartEdit: () => void
  onDraftChange: (value: string) => void
  onCancelEdit: () => void
  onSave: () => void
  onAskRemove: () => void
  onCancelRemove: () => void
  onRemove: () => void
  onDryRun: () => void
}): Jsx {
  const { hook, event, matcher, matcherProblem, writable, busy, editing, draft, confirming, menuOpen, dryText } = props
  const status = statusOf(hook)
  const run = hook.lastRun
  // 点的 `title` 必须**自己解释自己**：一个词（未运行 / 通过 / …）+ 为什么这么说 + 最近一次输出。
  // 停用时没有那个词（标题行上已经有 `已停用` 标签），title 就是证据本身。
  const dotTitle = `${status.label === '' ? status.evidence : `${status.label}（${status.evidence}）`}${
    run === null ? '' : `\n${run.stderr || run.stdout || '(无输出)'}`
  }`
  // 匹配范围与超时（v4 起只出现在 `⋯` 菜单里）：说人话，接口字段名不进正文（§3.9）。
  const matchText =
    matcherProblem !== null ? '匹配范围非法，这一组不会运行' : matcher === null ? '匹配全部' : `匹配 ${matcher}`
  const timeoutText =
    hook.timeoutSec === null ? `默认 ${String(hook.defaultTimeoutSec)} 秒` : `${String(hook.timeoutSec)} 秒`
  return (
    <div className="dsh-hooks__hookcard">
      <div className="dsh-hooks__cardmain">
        {/* 28×28 槽位：装状态点（颜色只来自台账 / disabled）。槽位本身没有颜色语义，
            所以 `aria-hidden` —— 状态的词与证据在右边那一格和它的 title 里。 */}
        <span className="dsh-hooks__slot" aria-hidden="true">
          <span className={status.className} title={dotTitle} />
        </span>
        <span className="dsh-hooks__cardtext">
          <span className="dsh-hooks__eventname" title={eventTitle(event)}>
            {eventLabel(event)}
            <span className="dsh-hooks__eventid">{event}</span>
            {hook.disabled ? <span className="dsh-hooks__tag">已停用</span> : null}
            {matcherProblem === null ? null : <span className="dsh-hooks__tag dsh-hooks__tag--warn">不会运行</span>}
          </span>
          {editing ? (
            // command 是 mono + multiline（§3.10）：真 `<textarea>`，不是 input。
            <textarea
              className="dsh-hooks__editor"
              value={draft}
              rows={1}
              onChange={(changeEvent) => {
                props.onDraftChange(changeEvent.target.value)
              }}
            />
          ) : (
            <span className="dsh-hooks__cmd" title={hook.command}>
              {hook.command}
            </span>
          )}
        </span>
        {/* 正文里**只有一个状态词**（v4）：证据在左边那个点的 title 里。 */}
        {status.label === '' ? null : (
          <span className="dsh-hooks__status" title={status.evidence}>
            {status.label}
          </span>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={!hook.disabled}
          className={hook.disabled ? 'dsh-hooks__switch' : 'dsh-hooks__switch dsh-hooks__switch--on'}
          title={hook.disabled ? '启用' : '停用'}
          disabled={busy}
          onClick={props.onToggle}
        >
          <span className="dsh-hooks__knob" />
        </button>
        {/* `⋯`：匹配范围 / 超时 / 三个动作都收在这里（默认不占屏，但一键可达）。
            刻意**不用** `__btn` 类：`tools/verify.ts` 的 D 区按 `__btn` 数"这一行有几个动作按钮"，
            把 `⋯` 混进去会让那条计数断言测到一个不存在的界面（v4 起动作按钮只在菜单里）。 */}
        <button
          type="button"
          className="dsh-hooks__morebtn"
          title="更多"
          aria-label={`更多操作：${eventLabel(event)}`}
          aria-expanded={menuOpen}
          disabled={busy}
          onClick={props.onToggleMenu}
        >
          ⋯
        </button>
      </div>
      {menuOpen ? (
        <div className="dsh-hooks__cardmenu">
          {/* 这一条 hook 的"怎么才算命中 / 等多久"：v3 里它是常驻的一行，v4 收进这里。 */}
          <span className="dsh-hooks__meta" title={matcherProblem ?? `${matchText} · 超时 ${timeoutText}`}>
            {matchText} · {timeoutText}
          </span>
          <span className="dsh-hooks__spacer" />
          {writable ? (
            editing ? (
              <span className="dsh-hooks__actions">
                <button
                  type="button"
                  className="dsh-hooks__btn dsh-hooks__btn--ghost"
                  title="保存"
                  disabled={busy}
                  onClick={props.onSave}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="dsh-hooks__btn dsh-hooks__btn--ghost"
                  title="取消编辑"
                  disabled={busy}
                  onClick={props.onCancelEdit}
                >
                  取消
                </button>
              </span>
            ) : confirming ? (
              <span className="dsh-hooks__actions">
                <span className="dsh-hooks__meta">删除这一条？</span>
                <button
                  type="button"
                  className="dsh-hooks__btn dsh-hooks__btn--ghost"
                  title="确认删除"
                  disabled={busy}
                  onClick={props.onRemove}
                >
                  确认删除
                </button>
                <button
                  type="button"
                  className="dsh-hooks__btn dsh-hooks__btn--ghost"
                  title="取消删除"
                  disabled={busy}
                  onClick={props.onCancelRemove}
                >
                  取消
                </button>
              </span>
            ) : (
              <span className="dsh-hooks__actions">
                <button
                  type="button"
                  className="dsh-hooks__btn dsh-hooks__btn--ghost"
                  title="试运行"
                  disabled={busy}
                  onClick={props.onDryRun}
                >
                  试运行
                </button>
                <button
                  type="button"
                  className="dsh-hooks__btn dsh-hooks__btn--ghost"
                  title="编辑"
                  disabled={busy}
                  onClick={props.onStartEdit}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="dsh-hooks__btn dsh-hooks__btn--ghost"
                  title="删除"
                  disabled={busy}
                  onClick={props.onAskRemove}
                >
                  删除
                </button>
              </span>
            )
          ) : null}
        </div>
      ) : null}
      {/* 试运行的结果**贴着这一条**显示：它是这一条的动作结果，不是页面级错误（§3.7）。 */}
      {dryText === '' ? null : <span className="dsh-hooks__dry">{dryText}</span>}
    </div>
  )
}

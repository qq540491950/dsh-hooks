/**
 * 一张卡 = **一条 hook**（参考图的形态）。
 *
 * ```
 * ▣  PreToolUse                                   [ ●—— ]
 *    node -e const fs=require('node:fs')…
 * ```
 *   - 左侧 28×28 圆角图标格 = 事件首字母（一眼看出事件，不靠颜色）；
 *   - 标题 = 事件名（`disabled` 时带"已停用"标签）；副标题 = command（mono、省略号）；
 *   - 右侧 = 开关（`role="switch"` + `aria-checked`，36×20）；
 *   - 第二行 = 状态点 + 状态文案 + matcher/timeout + 动作按钮。动作按钮在 CSS 里 hover/聚焦
 *     才显形（视觉更安静），但**始终在 DOM 里** —— 键盘用户能 Tab 到，离线渲染测试也看得见。
 *
 * ## 纯 props，零 hook（硬约束）
 * `tools/verify.ts` 的假 React 只能展开**不用 hook 的子组件**（它按位置发 `useState` 的值，
 * 只对最外层成立）。所以这里不持有任何状态：正在编辑哪一条、草稿、删除确认态、试运行结果
 * 全部由 `HooksSection` 通过 props 传下来 —— 状态只有一处，行组件只负责画与回调。
 *
 * ## 文本纪律（本轮修的真 bug）
 * 页面上**不许出现 markdown 语法**（截图里 `**agent-go**` 把星号原样渲染出来了）。
 * 要强调就用 `<strong className="dsh-hooks__strong">`，**不要**在字符串里写星号对。
 */

import { h } from './react.ts'
import type { Jsx } from './react.ts'
import type { HookView } from './wire.ts'

/** 行状态：**颜色只能来自真实执行记录或 `disabled`**（§3.8）。 */
export function statusOf(hook: HookView): { className: string; label: string } {
  if (hook.disabled) return { className: 'dsh-hooks__dot', label: '已停用（不会运行）' }
  const run = hook.lastRun
  if (run === null) return { className: 'dsh-hooks__dot', label: '未运行（没有执行记录）' }
  const where = `exit ${run.exitCode === null ? 'spawn-failed' : String(run.exitCode)} · ${run.durationMs}ms`
  if (run.decision === 'deny' || run.decision === 'block') {
    return { className: 'dsh-hooks__dot dsh-hooks__dot--deny', label: `已阻断 · ${where}` }
  }
  if (run.exitCode === 0) return { className: 'dsh-hooks__dot dsh-hooks__dot--ok', label: `通过 · ${where}` }
  return { className: 'dsh-hooks__dot dsh-hooks__dot--warn', label: `失败 · ${where}` }
}

/** 事件首字母（图标格里的那个字符）。 */
function initialOf(event: string): string {
  return event.slice(0, 1).toUpperCase()
}

/** 一条 hook 的卡片。全部动作都是外面传进来的回调（本组件不知道怎么写盘）。 */
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
  /** 刚试运行完的结果文案（空串 = 没有）。**不进台账**：预演不该给状态上色（§3.8）。 */
  dryText: string
  onToggle: () => void
  onStartEdit: () => void
  onDraftChange: (value: string) => void
  onCancelEdit: () => void
  onSave: () => void
  onAskRemove: () => void
  onCancelRemove: () => void
  onRemove: () => void
  onDryRun: () => void
}): Jsx {
  const { hook, event, matcher, matcherProblem, writable, busy, editing, draft, confirming, dryText } = props
  const status = statusOf(hook)
  const run = hook.lastRun
  const dotTitle = run === null ? status.label : `${status.label}\n${run.stderr || run.stdout || '(无输出)'}`
  return (
    <div className="dsh-hooks__hookcard">
      <div className="dsh-hooks__cardmain">
        <span className="dsh-hooks__icon" aria-hidden="true" title={event}>
          {initialOf(event)}
        </span>
        <span className="dsh-hooks__cardtext">
          <span className="dsh-hooks__eventname" title={event}>
            {event}
            {hook.disabled ? <span className="dsh-hooks__tag">已停用</span> : null}
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
      </div>
      <div className="dsh-hooks__detailRow">
        {/* 状态点：没有记录就是灰色 —— 且必须能解释自己（title 里有原因） */}
        <span className={status.className} title={dotTitle} />
        <span className="dsh-hooks__meta">{status.label}</span>
        {matcher === null ? null : (
          <span className="dsh-hooks__meta" title={matcherProblem ?? 'matcher'}>
            matcher: {matcher}
          </span>
        )}
        <span className="dsh-hooks__meta" title="超时（未写则为默认值）">
          {hook.timeoutSec === null ? `${String(hook.defaultTimeoutSec)}s 默认` : `${String(hook.timeoutSec)}s`}
        </span>
        {matcherProblem === null ? null : <span className="dsh-hooks__tag">matcher 非法，这一组不会运行</span>}
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
      {/* 试运行的结果**贴着这一条**显示：它是这一条的动作结果，不是页面级错误（§3.7）。 */}
      {dryText === '' ? null : <span className="dsh-hooks__dry">{dryText}</span>}
    </div>
  )
}

/**
 * 一条 hook 的卡片：状态点 / 开关 / 命令 / 展开区（编辑·试运行·删除）。
 *
 * ## 纯 props，零 hook（硬约束）
 * `tools/verify.ts` 的假 React 只能展开**不用 hook 的子组件**（它按位置发 `useState` 的值，
 * 只对最外层成立）。所以这里不持有任何状态：正在编辑哪一行、草稿是什么、删除确认态、
 * 试运行结果全部由 `HooksSection` 通过 props 传下来。这也是本插件一贯的分层——
 * 状态只有一处，行组件只负责画与回调。
 *
 * ## 开关为什么是 `role="switch"` 的 button
 * 原生 `<input type=checkbox>` 在深色主题下难统一（各家浏览器给的默认外观不同），
 * 而 `role="switch"` + 样式表里的旋钮把**语义**（无障碍）与**外观**都握在自己手里（§3.2/§6.4）。
 * 尺寸/配色一律进 `styles.ts`，组件里没有任何 inline 样式。
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

/** 一条 hook 的卡片。全部动作都是外面传进来的回调（本组件不知道怎么写盘）。 */
export function HookCard(props: {
  hook: HookView
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
  const { hook, writable, busy, editing, draft, confirming, dryText } = props
  const status = statusOf(hook)
  const run = hook.lastRun
  const dotTitle = run === null ? status.label : `${status.label}\n${run.stderr || run.stdout || '(无输出)'}`
  return (
    <div className="dsh-hooks__hookcard">
      <div className="dsh-hooks__cardmain">
        {/* 状态点：没有记录就是灰色 —— 且必须能解释自己（title 里有原因） */}
        <span className={status.className} title={dotTitle} />
        {editing ? null : (
          <span className="dsh-hooks__cmd" title={hook.command}>
            {hook.command}
          </span>
        )}
        {hook.disabled ? <span className="dsh-hooks__tag">已停用</span> : null}
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
      {editing ? (
        <div className="dsh-hooks__detailRow">
          {/* command 是 mono + multiline（§3.10）：真 `<textarea>`，不是 input。 */}
          <textarea
            className="dsh-hooks__editor"
            value={draft}
            rows={1}
            onChange={(changeEvent) => {
              props.onDraftChange(changeEvent.target.value)
            }}
          />
          <button type="button" className="dsh-hooks__btn" title="保存" disabled={busy} onClick={props.onSave}>
            保存
          </button>
          <button type="button" className="dsh-hooks__btn" disabled={busy} onClick={props.onCancelEdit}>
            取消
          </button>
        </div>
      ) : confirming ? (
        <div className="dsh-hooks__detailRow">
          <span className="dsh-hooks__meta">删除这一条？</span>
          <button type="button" className="dsh-hooks__btn" title="确认删除" disabled={busy} onClick={props.onRemove}>
            确认删除
          </button>
          <button type="button" className="dsh-hooks__btn" disabled={busy} onClick={props.onCancelRemove}>
            取消
          </button>
        </div>
      ) : (
        <div className="dsh-hooks__detailRow">
          <span className="dsh-hooks__meta" title="超时（未写则为默认值）">
            {hook.timeoutSec === null ? `${String(hook.defaultTimeoutSec)}s 默认` : `${String(hook.timeoutSec)}s`}
          </span>
          <span className="dsh-hooks__meta">{status.label}</span>
          {writable ? (
            <span className="dsh-hooks__actions">
              <button type="button" className="dsh-hooks__btn" title="试运行" disabled={busy} onClick={props.onDryRun}>
                试运行
              </button>
              <button type="button" className="dsh-hooks__btn" title="编辑" disabled={busy} onClick={props.onStartEdit}>
                编辑
              </button>
              <button type="button" className="dsh-hooks__btn" title="删除" disabled={busy} onClick={props.onAskRemove}>
                删除
              </button>
            </span>
          ) : null}
        </div>
      )}
      {/* 试运行的结果**贴着这一行**显示：它是这一行的动作结果，不是页面级错误（§3.7）。 */}
      {dryText === '' ? null : <span className="dsh-hooks__dry">{dryText}</span>}
    </div>
  )
}

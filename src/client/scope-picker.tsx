/**
 * 作用域选择器：**自绘 popover**（不是原生 `<select>`）。
 *
 * 为什么自绘（用户明确要求参考图那种带分组与勾选的形态）：
 *   - 原生 `<select>` 的选项**不能**放图标/勾选标记，分组只能靠 `<optgroup>`；
 *   - 自绘之后分组标题、当前项打勾、键盘导航都在我们手里，且**不依赖官方 DOM 结构**
 *     （AGENTS §3.3 的反面教材就是"打官方 data 属性 + CSS 覆盖"）。
 *
 * ## 纯 props，零 hook（硬约束）
 * `tools/verify.ts` 的假 React 只能展开**不用 hook 的子组件**（它按位置发 `useState` 的值）。
 * 打开/关闭、键盘高亮位置全部由 `HooksSection` 持有并通过 props 传下来 —— 这样"交互状态只有
 * 一处"这条纪律也顺带成立（与 `hook-card.tsx` / `new-hook.tsx` 同款）。
 *
 * ## 键盘（全部挂在**触发器**上，焦点不离开它）
 *   - `Enter` / `Space`：收起时展开；展开时选中高亮项
 *   - `↓` / `↑`：收起时展开并定位到当前项；展开时上下移动（到边界**环绕**）
 *   - `Esc`：收起
 * 焦点留在触发器上是刻意的：`role="listbox"` 的常规做法（`aria-activedescendant` 指高亮项），
 * 也省掉"焦点进列表后 Tab 语义变复杂"的问题。点外部关闭用一个铺满屏幕的透明背板实现 ——
 * 不用 `document` 监听器（那在离线渲染测试里根本不存在，且卸载时容易漏解绑）。
 */

import { h, Fragment } from './react.ts'
import type { Jsx } from './react.ts'

/** 一个作用域选项（顺序即显示顺序；`group` 相同的连续项归到同一个分组标题下）。 */
export interface ScopeOption {
  value: string
  label: string
  group: string
}

/** 键盘事件的**最小**形状：只要求 `key`（离线测试用假事件就能驱动）。 */
export interface KeyLike {
  key: string
  preventDefault?: () => void
}

/** 作用域选择器。 */
export function ScopePicker(props: {
  /** 触发器上显示的文字（当前作用域的名字）—— **同样来自宿主回显**，见下面的 `value`。 */
  label: string
  /** 鼠标悬停时的完整说明（§2.1 那句话；用户反馈"别老占一行"）。 */
  hint: string
  options: ScopeOption[]
  /**
   * 当前作用域值 —— **必须来自宿主回显**（`snapshot.scope` 推导），不是本地 state。
   *
   * 本组件用它找当前项（`current`），于是触发器的 label 与 popover 里的勾选都从它来。
   * 传本地 state 会在"宿主把 `scope=current` 归一成 `user`（没有会话上下文）"这类情况下说谎：
   * 触发器写着「当前会话项目」，数据却是用户级的。见 `section.tsx` 的 `echoedScopeOf`。
   */
  value: string
  open: boolean
  /** 键盘高亮的下标（`open` 为 false 时无意义）。 */
  active: number
  busy: boolean
  onToggle: () => void
  onMove: (delta: number) => void
  onPick: (value: string) => void
  onKey: (event: KeyLike) => void
  onClose: () => void
}): Jsx {
  const { label, hint, options, value, open, active, busy } = props
  const current = options.find((option) => option.value === value)
  return (
    <div className="dsh-hooks__field">
      <span className="dsh-hooks__label">作用域</span>
      <div className="dsh-hooks__popoverwrap">
        {/* `aria-expanded` / `aria-haspopup` 是组合控件的标准语义；`title` 带上 §2.1 那句说明。 */}
        <button
          type="button"
          className="dsh-hooks__trigger"
          title={hint}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={busy}
          onClick={props.onToggle}
          onKeyDown={(event: KeyLike) => {
            props.onKey(event)
          }}
        >
          <span className="dsh-hooks__triggerlabel">{current === undefined ? label : current.label}</span>
          <span className="dsh-hooks__caret" aria-hidden="true">
            ▾
          </span>
        </button>
        {open ? (
          <Fragment>
            {/* 点外部关闭：透明背板；它自己不吃键盘（列表项的键盘处理在触发器上）。 */}
            <div
              className="dsh-hooks__backdrop"
              onClick={() => {
                props.onClose()
              }}
            />
            <div className="dsh-hooks__popover" role="listbox" aria-label="作用域">
              {options.map((option, index) => (
                <Fragment key={option.value}>
                  {/* 分组标题：与上一项不同组时才画（分组是"连续段"而不是嵌套容器，
                      这样 popover 的键盘/索引模型只有一个一维列表）。 */}
                  {index === 0 || options[index - 1]?.group !== option.group ? (
                    <div className="dsh-hooks__group">{option.group}</div>
                  ) : null}
                  <button
                    type="button"
                    className={index === active ? 'dsh-hooks__option dsh-hooks__option--active' : 'dsh-hooks__option'}
                    role="option"
                    aria-selected={option.value === value}
                    value={option.value}
                    onClick={() => {
                      props.onPick(option.value)
                    }}
                    onMouseEnter={() => {
                      props.onMove(index - active)
                    }}
                  >
                    <span className="dsh-hooks__optionlabel">{option.label}</span>
                    {/* 当前项右侧打勾（参考图） */}
                    <span className="dsh-hooks__check" aria-hidden="true">
                      {option.value === value ? '✓' : ''}
                    </span>
                  </button>
                </Fragment>
              ))}
            </div>
          </Fragment>
        ) : null}
      </div>
    </div>
  )
}

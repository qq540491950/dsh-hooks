/**
 * 「＋新建」表单：事件 / matcher / command / timeout → 一个 `addGroup` 定点操作。
 *
 * ## 三条纪律
 *   1. **纯 props，零 hook**（与 `hook-card.tsx` 同一条：假 React 只支持无 hook 的子组件）；
 *   2. **错误只渲染在这里**（§3.7）：提交失败由 `HooksSection` 写进 `formError`，渲染在表单内部；
 *      行内操作（启停 / 删除 / 试运行）的失败走**页面级**横幅。两条通道不许互相写；
 *   3. 表单**不解析任何文件**：事件清单来自 `src/shared/constants.ts` 的 `HOOK_EVENTS`（与宿主
 *      同一份白名单），matcher 合法性、命令是否真的写进去都由宿主说了算（§2.6）。
 *
 * 事件为 `UserPromptSubmit` / `Stop` 时**隐藏 matcher 输入**：协议层本来就丢弃这两个事件的
 * matcher（`parseHookConfig` 的行为），让用户填了却不生效是界面的错。
 */

import { Fragment, h } from './react.ts'
import type { Jsx } from './react.ts'
import { HOOK_EVENTS } from '../shared/constants.ts'

/** 哪些事件没有 matcher（与宿主解析器的行为一致，不在这里另写一套判断规则）。 */
const MATCHERLESS = new Set(['UserPromptSubmit', 'Stop'])

/** 新建表单的字段值（状态由最外层持有）。 */
export interface NewHookDraft {
  event: string
  matcher: string
  command: string
  timeout: string
}

/** 表单渲染 + 回调。 */
export function NewHookForm(props: {
  draft: NewHookDraft
  /** **表单内**的错误（已翻成人话）；null = 没有错误。 */
  error: string | null
  /** 技术原文，只作补充（排查用），绝不作为主文案（§3.9）。 */
  errorDetail: string
  busy: boolean
  writable: boolean
  onEvent: (value: string) => void
  onMatcher: (value: string) => void
  onCommand: (value: string) => void
  onTimeout: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}): Jsx {
  const { draft, error, errorDetail, busy, writable } = props
  return (
    <div className="dsh-hooks__newform">
      <div className="dsh-hooks__newfield">
        <span className="dsh-hooks__newlabel">事件</span>
        {/* 原生 <select>：键盘与无障碍免费，且不依赖官方 DOM 结构（§6.2）。
            刻意多一个 `__newselect` 类：页面上同时有两个下拉框（作用域 / 事件），
            断言与样式都不该靠"第几个"来区分。 */}
        <select
          className="dsh-hooks__select dsh-hooks__newselect"
          value={draft.event}
          onChange={(changeEvent) => {
            props.onEvent(changeEvent.target.value)
          }}
        >
          {HOOK_EVENTS.map((event) => (
            <option key={event} value={event}>
              {event}
            </option>
          ))}
        </select>
        {MATCHERLESS.has(draft.event) ? (
          <span className="dsh-hooks__muted">这个事件没有 matcher（写了也不生效）</span>
        ) : (
          <>
            <span className="dsh-hooks__newlabel">matcher</span>
            <input
              className="dsh-hooks__input"
              type="text"
              value={draft.matcher}
              placeholder="留空 = 匹配全部"
              onChange={(changeEvent) => {
                props.onMatcher(changeEvent.target.value)
              }}
            />
          </>
        )}
      </div>
      <div className="dsh-hooks__newfield">
        <span className="dsh-hooks__newlabel">命令</span>
        <textarea
          className="dsh-hooks__editor"
          value={draft.command}
          rows={2}
          onChange={(changeEvent) => {
            props.onCommand(changeEvent.target.value)
          }}
        />
      </div>
      <div className="dsh-hooks__newfield">
        <span className="dsh-hooks__newlabel">超时</span>
        <input
          className="dsh-hooks__input"
          type="text"
          value={draft.timeout}
          placeholder="秒；留空用默认 600s"
          onChange={(changeEvent) => {
            props.onTimeout(changeEvent.target.value)
          }}
        />
      </div>
      {/* §3.7：表单错误**只**在这里渲染（页面级横幅不会写它）。 */}
      {error === null ? null : (
        <div className="dsh-hooks__newerror">
          {error}
          {errorDetail === '' ? null : <span className="dsh-hooks__muted">（{errorDetail}）</span>}
        </div>
      )}
      <div className="dsh-hooks__newfield">
        {/* 提交是**填充**按钮（这一屏唯一的主动作）；取消是 ghost —— 内容区不许出现描边按钮
            （描边只允许在工具条，见 styles.ts 的纪律注释与 D 区的计数断言）。 */}
        <button
          type="button"
          className="dsh-hooks__btn dsh-hooks__btn--primary"
          title="创建"
          disabled={busy || !writable || draft.command.trim() === ''}
          onClick={props.onSubmit}
        >
          创建
        </button>
        <button type="button" className="dsh-hooks__btn dsh-hooks__btn--ghost" disabled={busy} onClick={props.onCancel}>
          取消
        </button>
      </div>
    </div>
  )
}

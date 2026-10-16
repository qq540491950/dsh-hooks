/**
 * 「＋新建」表单：模板 / 事件 / matcher / command / timeout → 一个 `addGroup` 定点操作。
 *
 * ## v4：先给模板，再给字段
 * 第一行是**三个模板**（`templates.ts`）：点一下把四个字段填好，用户只需要看一遍、改一改。
 * 用户不该为了配一条 hook 去手写 `node -e "…"`（真机上那条 300 字符的命令就是这么来的）。
 * 模板只**填**字段、不锁字段 —— 命令仍然明文可见可改（不做黑盒预设）。
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

import { h } from './react.ts'
import type { Jsx } from './react.ts'
import { HOOK_EVENTS } from '../shared/constants.ts'
import { eventHint, eventLabel } from './labels.ts'
import { HOOK_TEMPLATES } from './templates.ts'

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
  onTemplate: (id: string) => void
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
      {/* 模板行：**不是字段容器**（没有 label + 控件的配对），所以用 `__tplrow` 而不是 `__newfield`
          —— D37 的结构断言按"每个 __newfield 恰好一个 label + 一个控件"来守 F1，混进来会失真。 */}
      <div className="dsh-hooks__tplrow">
        <span className="dsh-hooks__hint">模板</span>
        {HOOK_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className="dsh-hooks__tplbtn"
            title={`${template.hint}（会覆盖当前四个字段）`}
            disabled={busy}
            onClick={() => {
              props.onTemplate(template.id)
            }}
          >
            {template.label}
          </button>
        ))}
      </div>
      {/* ⚠️ F1（审查者在放大图上抓到的真布局缺陷）：**每个字段自己是一个容器**，
          label + 控件同进同出（容器内部 `flex-wrap:nowrap`），只有容器**之间**才允许换行。
          过去 5 个兄弟节点平铺在同一个 `flex-wrap:wrap` 行里，564px 下换行时
          `匹配` 的 label 与它的输入框被拆到了两行。 */}
      <div className="dsh-hooks__newrow">
        <div className="dsh-hooks__newfield dsh-hooks__newfield--event">
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
            {/* 选项文字是**中文名 + 英文枚举**（`value` 仍是英文枚举 —— 请求体与文件里都是它）：
                用户按中文挑，要写进 hooks.json / 查文档的人又能看到原文。 */}
            {HOOK_EVENTS.map((event) => (
              <option key={event} value={event} title={eventHint(event)}>
                {eventLabel(event)}（{event}）
              </option>
            ))}
          </select>
          {/* 选中的事件**什么时候触发**（官方 README 的「运行时机」，见 labels.ts 的出处） */}
          <span className="dsh-hooks__hint">{eventHint(draft.event)}</span>
        </div>
        {MATCHERLESS.has(draft.event) ? (
          // 这一句里**不许出现** `matcher`：表单是给用户看的，接口字段名只留在诊断折叠里。
          <span className="dsh-hooks__hint">这个事件不看匹配范围（填了也不生效）</span>
        ) : (
          <div className="dsh-hooks__newfield dsh-hooks__newfield--matcher">
            {/* F2：标签是中文「匹配」，与卡片里的 `匹配 pwsh|bash` 同一套用词 */}
            <span className="dsh-hooks__newlabel">匹配</span>
            <input
              className="dsh-hooks__input"
              type="text"
              value={draft.matcher}
              placeholder="留空 = 匹配全部"
              onChange={(changeEvent) => {
                props.onMatcher(changeEvent.target.value)
              }}
            />
          </div>
        )}
      </div>
      <div className="dsh-hooks__newfield dsh-hooks__newfield--command">
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
      <div className="dsh-hooks__newfield dsh-hooks__newfield--timeout">
        <span className="dsh-hooks__newlabel">超时</span>
        <input
          className="dsh-hooks__input"
          type="text"
          value={draft.timeout}
          placeholder="秒；留空用默认 600 秒"
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
      {/* 动作区**不是字段容器**（没有 label / 控件），所以它有自己的一层类 — 别混进 `__newfield`：
          那会让"每个字段容器恰好一个 label + 一个控件"这条结构断言失去意义。 */}
      <div className="dsh-hooks__newactions">
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

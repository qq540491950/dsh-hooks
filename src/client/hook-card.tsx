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
import { eventHasMatcher } from '../shared/constants.ts'
import { eventLabel, eventTitle, rejectedReasonText, relativeTime } from './labels.ts'
import type { HookView, RejectedGroupView } from './wire.ts'

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
 * 一组**跑不了**的配置：灰化的「不会运行」行。
 *
 * 它出现的原因只有一个 —— 文件里确实写着这一组，但一条都不会跑（matcher 非法 / 结构坏了 /
 * 没有 command）。所以：
 *   - **必须在主列表里占一行**（凭空消失会让用户以为配置被删了）；
 *   - 原因写在正文里（用户据此知道要改哪里）；
 *   - **不提供试运行**：它根本不会运行，跑它只会得到一句假话（v4 的教训：试运行曾报
 *     "这一条已经不在了"）。
 *
 * 纯 props、零 hook（假 React 只支持无 hook 的子组件）。
 */
export function BlockedRow(props: {
  row: RejectedGroupView
  writable: boolean
  busy: boolean
  /** `⋯` 是否展开（与 `HookCard` 共用同一个"哪一行开着"的状态）。 */
  menuOpen: boolean
  /** 正在改的那一栏（被拒组只允许改匹配范围 —— 改好了它就能跑）。 */
  field: '' | 'matcher' | 'timeout'
  fieldDraft: string
  fieldProblem: string | null
  onToggleMenu: () => void
  onField: (field: 'matcher' | 'timeout') => void
  onFieldDraft: (value: string) => void
  onSaveField: () => void
  onCancelField: () => void
}): Jsx {
  const { row, writable, busy, menuOpen, field, fieldDraft, fieldProblem } = props
  const reason = rejectedReasonText(row.reason, row.matcher)
  return (
    <div className="dsh-hooks__hookcard dsh-hooks__hookcard--blocked">
      <div className="dsh-hooks__cardmain">
        <span className="dsh-hooks__slot" aria-hidden="true">
          <span className="dsh-hooks__dot" title={reason} />
        </span>
        <span className="dsh-hooks__cardtext">
          <span className="dsh-hooks__eventname" title={eventTitle(row.event)}>
            {eventLabel(row.event)}
            <span className="dsh-hooks__eventid">{row.event}</span>
            <span className="dsh-hooks__tag dsh-hooks__tag--warn">不会运行</span>
          </span>
          <span className="dsh-hooks__muted">{reason}</span>
        </span>
        <button
          type="button"
          className="dsh-hooks__morebtn"
          title="更多"
          aria-label={`更多操作：${eventLabel(row.event)}`}
          aria-expanded={menuOpen}
          disabled={busy}
          onClick={props.onToggleMenu}
        >
          ⋯
        </button>
      </div>
      {menuOpen ? (
        <div className="dsh-hooks__cardmenuwrap">
          <div className="dsh-hooks__cardmenu">
            <span className="dsh-hooks__meta">
              {String(row.hookCount)} 条 · {row.matcher === null ? '没有写匹配范围' : `匹配 ${row.matcher}`}
            </span>
            <span className="dsh-hooks__spacer" />
            {/* 唯一能让这一组"活过来"的动作：把匹配范围改回合法写法。
             **不提供试运行** —— 它现在根本不会运行，跑它只会得到一句假话。 */}
            {writable && field === '' && row.reason === 'invalid-matcher' && eventHasMatcher(row.event) ? (
              // 只有 `invalid-matcher` 这一种**能靠改匹配范围修好**：`malformed-group` / `no-command` /
              // `unsupported-type` 改 matcher 也不会让它跑起来（那只会误导用户白改一遍）。
              <span className="dsh-hooks__actions">
                <button
                  type="button"
                  className="dsh-hooks__fieldbtn"
                  title="改匹配范围"
                  disabled={busy}
                  onClick={() => {
                    props.onField('matcher')
                  }}
                >
                  改匹配范围
                </button>
              </span>
            ) : null}
          </div>
          {field === '' ? null : (
            <div className="dsh-hooks__cardmenu">
              <span className="dsh-hooks__meta">匹配范围</span>
              <input
                className="dsh-hooks__input"
                type="text"
                value={fieldDraft}
                autoFocus
                placeholder="留空 = 匹配全部"
                onChange={(changeEvent: { target: { value: string } }) => {
                  props.onFieldDraft(changeEvent.target.value)
                }}
              />
              <span className="dsh-hooks__spacer" />
              <span className="dsh-hooks__actions">
                <button
                  type="button"
                  className="dsh-hooks__btn dsh-hooks__btn--ghost"
                  title="保存"
                  disabled={busy || fieldProblem !== null}
                  onClick={props.onSaveField}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="dsh-hooks__btn dsh-hooks__btn--ghost"
                  title="取消"
                  disabled={busy}
                  onClick={props.onCancelField}
                >
                  取消
                </button>
              </span>
              {fieldProblem === null ? null : <span className="dsh-hooks__newerror">{fieldProblem}</span>}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 「⋯」菜单里那**一组**编辑态（06/07/08/09 票）。
 *
 * 打包成一个对象而不是六个平铺 prop：它们是同一件事的六个侧面（正在改哪一栏、草稿、校验结论、
 * 顺序边界、整组确认），平铺进 `HookCard` 会把它撑成二十多个参数，而且改动时总是一起改。
 */
export interface CardMenuState {
  /** 正在改哪一栏（`''` = 没在改）。匹配范围与超时从这里变可编辑。 */
  field: '' | 'matcher' | 'timeout'
  /** 那一栏的草稿（状态由最外层持有）。 */
  draft: string
  /** 草稿不合法时的一句话（就地校验，禁用保存）。 */
  problem: string | null
  /** 顺序：这是不是组内第一条 / 最后一条（顺序即执行顺序）。 */
  canMoveUp: boolean
  canMoveDown: boolean
  /** 整组删除的第二步确认（与单条删除同一套两步确认）。 */
  confirmingGroup: boolean
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
  /** `⋯` 是否展开（匹配范围 / 超时 / 动作都在这块里）。 */
  menuOpen: boolean
  /** 刚试运行完的结果文案（空串 = 没有）。**不进台账**：预演不该给状态上色（§3.8）。 */
  dryText: string
  /** 试运行输出的**全文**（只在被截断时非空；给「查看全文」用）。 */
  dryFull: string
  /** 菜单里那一组编辑态（字段 / 草稿 / 校验 / 顺序边界 / 整组确认）。 */
  menu: CardMenuState
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
  onField: (field: 'matcher' | 'timeout') => void
  onFieldDraft: (value: string) => void
  onSaveField: () => void
  onCancelField: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onAskRemoveGroup: () => void
  onRemoveGroup: () => void
  onCancelRemoveGroup: () => void
}): Jsx {
  const { hook, event, matcher, matcherProblem, writable, busy, editing, draft, confirming, menuOpen, dryText, menu } =
    props
  // 菜单那一组的六个字段（见 `CardMenuState`）：本地解构，读起来仍是一个词。
  const { field, draft: fieldDraft, problem: fieldProblem, canMoveUp, canMoveDown, confirmingGroup } = menu
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
  // 这两个事件**不看 matcher**（协议层丢弃）：给它们一个"改匹配范围"的入口等于让用户白改。
  const hasMatcher = eventHasMatcher(event)
  /**
   * 「多久之前 · exit N · Xms」——状态点的**时间维度**。
   *
   * 只有 `exit 0 · 12ms` 的话，"三天前的通过"和"刚刚的通过"长得一模一样；而台账是进程级记忆，
   * "未运行"也可能只是"这次还没跑"。这句话进「⋯」的第一排（首屏仍然只有一个状态词）。
   */
  const ranText =
    run === null
      ? ''
      : `${relativeTime(run.at, Date.now())} · ${
          run.exitCode === null ? '启动失败' : `exit ${String(run.exitCode)}`
        } · ${String(run.durationMs)}ms`
  /** 开关的可访问名要能分辨"是哪一条"（十个开关都叫"启用/停用"等于没有名字）。 */
  const switchName = `${eventLabel(event)} · ${
    hook.command.length > 24 ? `${hook.command.slice(0, 24)}…` : hook.command
  }`
  /** 菜单里那两栏的**可点开**按钮（以前它们是纯文本 —— "看得见改不了"的那一块）。 */
  const fieldButton = (target: 'matcher' | 'timeout', text: string, label: string): Jsx => (
    <button
      type="button"
      className="dsh-hooks__fieldbtn"
      title={label}
      disabled={busy || !writable}
      onClick={() => {
        props.onField(target)
      }}
    >
      {text}
    </button>
  )
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
          aria-label={`${switchName}：启用开关`}
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
        <div className="dsh-hooks__cardmenuwrap">
          {/* 第一排：两栏元信息（匹配范围 / 超时）。它们现在是**可点开的字段**，
              以前只是纯文本 —— 用户照着看一眼就得离开设置页去手改 JSON。 */}
          <div className="dsh-hooks__cardmenu">
            {hasMatcher ? (
              fieldButton('matcher', matchText, '改匹配范围')
            ) : (
              <span className="dsh-hooks__meta">{matchText}</span>
            )}
            {field === 'timeout' ? null : fieldButton('timeout', timeoutText, '改超时秒数')}
            {/* 状态的时间维度：与 exit 码 / 耗时放在同一处（user 反馈"这是三天前的还是刚才的？"）。 */}
            {ranText === '' ? null : <span className="dsh-hooks__meta">{ranText}</span>}
            <span className="dsh-hooks__spacer" />
            {writable && field === '' ? (
              <span className="dsh-hooks__actions">
                {/* 顺序即执行顺序：把守卫挪到最前只能在这里做。边界处禁用（不发请求）。 */}
                <button
                  type="button"
                  className="dsh-hooks__glyphbtn dsh-hooks__fieldbtn"
                  title="上移"
                  aria-label="上移这一条"
                  disabled={busy || !canMoveUp}
                  onClick={props.onMoveUp}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="dsh-hooks__glyphbtn dsh-hooks__fieldbtn"
                  title="下移"
                  aria-label="下移这一条"
                  disabled={busy || !canMoveDown}
                  onClick={props.onMoveDown}
                >
                  ↓
                </button>
              </span>
            ) : null}
          </div>

          {/* 就地编辑某一栏：校验用共享协议那一份判定（禁止另写一套），非法时保存禁用。 */}
          {field === '' ? null : (
            <div className="dsh-hooks__cardmenu">
              <span className="dsh-hooks__meta">{field === 'matcher' ? '匹配范围' : '超时（秒）'}</span>
              <input
                className="dsh-hooks__input"
                type="text"
                value={fieldDraft}
                autoFocus
                placeholder={field === 'matcher' ? '留空 = 匹配全部' : '留空 = 默认 600 秒'}
                onChange={(changeEvent: { target: { value: string } }) => {
                  props.onFieldDraft(changeEvent.target.value)
                }}
              />
              <span className="dsh-hooks__spacer" />
              <span className="dsh-hooks__actions">
                <button
                  type="button"
                  className="dsh-hooks__btn dsh-hooks__btn--ghost"
                  title="保存"
                  disabled={busy || fieldProblem !== null}
                  onClick={props.onSaveField}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="dsh-hooks__btn dsh-hooks__btn--ghost"
                  title="取消"
                  disabled={busy}
                  onClick={props.onCancelField}
                >
                  取消
                </button>
              </span>
              {fieldProblem === null ? null : <span className="dsh-hooks__newerror">{fieldProblem}</span>}
            </div>
          )}

          {/* 第二排：动作（试运行 / 编辑命令 / 删除 / 删除整组）。 */}
          {field !== '' ? null : (
            <div className="dsh-hooks__cardmenu">
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
                ) : confirmingGroup ? (
                  <span className="dsh-hooks__actions">
                    <span className="dsh-hooks__meta">删除这一组（连同匹配范围）？</span>
                    <button
                      type="button"
                      className="dsh-hooks__btn dsh-hooks__btn--ghost"
                      title="确认删除整组"
                      disabled={busy}
                      onClick={props.onRemoveGroup}
                    >
                      确认删除整组
                    </button>
                    <button
                      type="button"
                      className="dsh-hooks__btn dsh-hooks__btn--ghost"
                      title="取消删除整组"
                      disabled={busy}
                      onClick={props.onCancelRemoveGroup}
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
                    <button
                      type="button"
                      className="dsh-hooks__btn dsh-hooks__btn--ghost"
                      title="删除整组"
                      disabled={busy}
                      onClick={props.onAskRemoveGroup}
                    >
                      删除整组
                    </button>
                  </span>
                )
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {/* 试运行的结果**贴着这一条**显示：它是这一条的动作结果，不是页面级错误（§3.7）。
          `role="status" aria-live="polite"`：异步结论要播报（17 票）。
          被截断时给一个「查看全文」（长输出曾把整张卡撑成一大片糊字）。 */}
      {dryText === '' ? null : (
        <div className="dsh-hooks__dry" role="status" aria-live="polite">
          <span className="dsh-hooks__drysummary">{dryText}</span>
          {/* 预演结论与指示灯**并排**时看起来自相矛盾（"试运行通过" + 灰「未运行」），而原因只藏在
              圆点的 title 里。这句就在动作结果里说清：它不是装饰，只是不认预演（§3.8）。
              放在这里＝**只有跑过试运行才出现**，首屏没有噪音（§3.13）。 */}
          <span className="dsh-hooks__dryhint">预演不写进执行记录 —— 指示灯只反映真实工具调用。</span>
          {props.dryFull === '' ? null : (
            <details className="dsh-hooks__drymore">
              <summary className="dsh-hooks__drytoggle">查看全文</summary>
              <pre className="dsh-hooks__drytext">{props.dryFull}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

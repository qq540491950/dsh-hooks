/**
 * 设置页「Hooks」。
 *
 * ## 它显示什么、由谁决定
 * 全部内容来自宿主 `GET /api/hooks`（AGENTS §2.6：**页面不许自己解析 `hooks.json`**，
 * 那些分组、条数、matcher 诊断、来源都是宿主用同一个 `parseHookConfig` 算出来的）。
 * 写入只发**定点操作**（§2.3），宿主读→改→写并带版本锁（页面看到的版本就是锁的版本）。
 *
 * ## UI 纪律在这里的体现
 *   - §3.6：**7 个事件永远全列**（含 0 条），两个来源也永远都列 ——"空"和"不存在"必须长得不一样；
 *   - §3.7：**一条错误只允许一个渲染点** —— 行内操作（启停 / 编辑 / 新建）的失败写进**页面级**通道；
 *   - §3.8：每行的颜色**只**来自执行台账（`lastRun`）与 `disabled`；没有记录就是灰"未运行"；
 *   - §3.9：文件不存在 / JSON 非法 / 沙箱拒绝 / matcher 非法**分别说清**，且不把内部错误原文当主文案；
 *   - §3.10：`command` 是 **mono + multiline**（真 `<textarea>`），`timeout` 只要 mono。
 *
 * ## 状态都放在最外层
 * 子组件**不许用 hook**（`tools/verify.ts` 的假 React 只支持无 hook 的子组件）。这不是巧合：
 * 行内编辑的状态（正在编辑哪一行、草稿是什么）由 `HooksSection` 持有，行组件只收 props。
 */

import { Fragment, h, useEffect, useState } from './react.ts'
import type { Jsx } from './react.ts'
import { HOOKS_ROUTE } from '../shared/constants.ts'
import { styles } from './styles.ts'
import { requestWrite, writeErrorSentence, type WriteIntent } from './write.ts'
import type { FileEventView, FileView, GroupView, HooksResponse, HooksSnapshot, HookView } from './wire.ts'

/**
 * 请求超时预算。
 *
 * 没有它的话，宿主一旦卡住 `fetch` 永不 settle，页面会永远停在"读取中…"，用户只能刷新整页。
 */
const REQUEST_TIMEOUT_MS = 10_000

/** 页面状态：三种，互斥；**不做"猜测式"降级**。 */
type Phase =
  { kind: 'loading' } | { kind: 'ready'; snapshot: HooksSnapshot } | { kind: 'failed'; code: string; detail: string }

/** 行内操作的失败（**页面级**通道，§3.7）。 */
type Banner = { code: string; detail: string }

/** 机器错误码 → 人话。**技术原文只进 detail**，主文案用自己的话（AGENTS §3.9）。 */
function sentenceFor(code: string): string {
  switch (code) {
    case 'network':
      return '连不上宿主。可能是宿主刚重启，或者这个页面是旧标签页。'
    case 'internal':
      return '宿主在读取配置时出错了（这是插件的问题，不是你的配置写错了）。'
    case 'bad-json':
      return '宿主返回的内容不是合法 JSON（版本不匹配？）。'
    default:
      return `读取失败（${code}）。`
  }
}

/** 文件状态 → 人话。三态必须**分别**说清：不存在 ≠ 读不出来（AGENTS §2.9/§3.9）。 */
function fileStateText(file: FileView): string {
  switch (file.state) {
    case 'absent':
      return '文件不存在（这表示"这份配置是空的"，不是出错）'
    case 'ok':
      return '已读取'
    default:
      return '读不出来 —— 文件内容不是合法 JSON，请手工修好；运行中的 hook 仍在沿用上一份可用配置'
  }
}

/** 行状态：**颜色只能来自真实执行记录或 `disabled`**（§3.8）。 */
function statusOf(hook: HookView): { className: string; label: string } {
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

/** 行内操作的回调：行组件自己不知道怎么写，由最外层统一发请求并处理错误。 */
type Toggle = (file: FileView, event: string, groupRawIndex: number, hook: HookView) => void

/** 一条 hook 的身份键：**文件 + 事件 + 两个原始下标**（就是寻址用的那三元组）。 */
function rowKey(file: FileView, event: string, groupRawIndex: number, hookIndex: number): string {
  return `${file.kind}|${event}|${String(groupRawIndex)}|${String(hookIndex)}`
}

/** 行内编辑命令的状态与动作。 */
type Editor = {
  /** 正在编辑的那一行的身份键（空串 = 没有在编辑）。**一次只编辑一行**：简单、可断言。 */
  key: string
  draft: string
  start: (key: string, command: string) => void
  change: (value: string) => void
  cancel: () => void
  save: (file: FileView, event: string, groupRawIndex: number, hook: HookView) => void
}

/** 一条 hook。 */
function HookRow(props: {
  hook: HookView
  file: FileView
  event: string
  groupRawIndex: number
  writable: boolean
  busy: boolean
  onToggle: Toggle
  editor: Editor
}): Jsx {
  const { hook, file, event, groupRawIndex, writable, busy, onToggle, editor } = props
  const key = rowKey(file, event, groupRawIndex, hook.rawIndex)
  const editing = editor.key === key
  const status = statusOf(hook)
  const run = hook.lastRun
  const title = run === null ? status.label : `${status.label}\n${run.stderr || run.stdout || '(无输出)'}`
  return (
    <div className="dsh-hooks__hook">
      <span className={status.className} title={title} />
      {editing ? null : (
        <>
          <span className="dsh-hooks__cmd" title={hook.command}>
            {hook.command}
          </span>
          {hook.disabled ? <span className="dsh-hooks__tag">已停用</span> : null}
          <span className="dsh-hooks__meta" title="超时（未写则为默认值）">
            {hook.timeoutSec === null ? `${String(hook.defaultTimeoutSec)}s 默认` : `${String(hook.timeoutSec)}s`}
          </span>
        </>
      )}
      {writable && editing ? (
        <span className="dsh-hooks__actions">
          {/* command 是 mono + multiline（§3.10）：真 `<textarea>`，不是 input。 */}
          <textarea
            className="dsh-hooks__editor"
            value={editor.draft}
            rows={1}
            onChange={(changeEvent) => {
              editor.change(changeEvent.target.value)
            }}
          />
          <button
            type="button"
            className="dsh-hooks__btn"
            disabled={busy}
            onClick={() => {
              editor.save(file, event, groupRawIndex, hook)
            }}
          >
            保存
          </button>
          <button
            type="button"
            className="dsh-hooks__btn"
            disabled={busy}
            onClick={() => {
              editor.cancel()
            }}
          >
            取消
          </button>
        </span>
      ) : null}
      {writable && !editing ? (
        <span className="dsh-hooks__actions">
          <button
            type="button"
            className="dsh-hooks__btn"
            disabled={busy}
            onClick={() => {
              editor.start(key, hook.command)
            }}
          >
            编辑
          </button>
          <button
            type="button"
            className="dsh-hooks__btn"
            disabled={busy}
            onClick={() => {
              onToggle(file, event, groupRawIndex, hook)
            }}
          >
            {hook.disabled ? '启用' : '停用'}
          </button>
        </span>
      ) : null}
    </div>
  )
}

/** 一个 group（matcher 属于 group，command/timeout 属于 hook）。 */
function GroupBlock(props: {
  group: GroupView
  file: FileView
  event: string
  writable: boolean
  busy: boolean
  onToggle: Toggle
  editor: Editor
}): Jsx {
  const { group, file, event, writable, busy, onToggle, editor } = props
  return (
    <div className="dsh-hooks__groups">
      <div className="dsh-hooks__matcher">
        {group.matcher === null ? '匹配全部' : `matcher: ${group.matcher}`}
        {group.matcherOk ? null : <span className="dsh-hooks__tag">matcher 非法，这一组不会运行</span>}
      </div>
      {group.hooks.map((hook) => (
        <HookRow
          key={`${String(group.rawIndex)}:${String(hook.rawIndex)}`}
          hook={hook}
          file={file}
          event={event}
          groupRawIndex={group.rawIndex}
          writable={writable}
          busy={busy}
          onToggle={onToggle}
          editor={editor}
        />
      ))}
    </div>
  )
}

/** 一个事件的呈现：**永远渲染**，没有内容时说"没有配置"，而不是消失（§3.6）。 */
function EventRow({ view }: { view: FileEventView }): Jsx {
  return (
    <div className="dsh-hooks__event">
      <span className="dsh-hooks__eventname">{view.event}</span>
      {view.groups.length === 0 ? (
        <span className="dsh-hooks__empty">
          没有配置
          {view.runCount > 0 ? `（但历史上跑过 ${String(view.runCount)} 次）` : ''}
        </span>
      ) : (
        <span className="dsh-hooks__count">
          {String(view.hookCount)} 条{view.disabledCount > 0 ? `（另有 ${String(view.disabledCount)} 条已停用）` : ''}
        </span>
      )}
    </div>
  )
}

/** 一个来源（项目级 / 用户级）：**永远都列**，含"文件不存在"和"读不出来"（§3.6/§3.9）。 */
function SourceCard(props: {
  file: FileView
  writable: boolean
  busy: boolean
  onToggle: Toggle
  onCreate: (file: FileView) => void
  editor: Editor
}): Jsx {
  const { file, writable, busy, onToggle, onCreate, editor } = props
  return (
    <div className="dsh-hooks__card">
      <div className="dsh-hooks__cardhead">
        <strong>{file.kind === 'project' ? '项目级' : '用户级'}</strong>
        <span className="dsh-hooks__path">{file.path}</span>
        <span className="dsh-hooks__count">{String(file.hookCount)} 条</span>
        {writable && file.state === 'absent' ? (
          <span className="dsh-hooks__actions">
            <button
              type="button"
              className="dsh-hooks__btn"
              disabled={busy}
              onClick={() => {
                onCreate(file)
              }}
            >
              新建这个文件
            </button>
          </span>
        ) : null}
      </div>
      <div className="dsh-hooks__muted">{fileStateText(file)}</div>
      {file.matcherErrors.length > 0 ? (
        <div className="dsh-hooks__banner dsh-hooks__banner--warn">
          {file.matcherErrors.length} 处 matcher 非法（那些组不会运行）：{file.matcherErrors.join('；')}
        </div>
      ) : null}
      {file.skipped.length > 0 ? (
        <div className="dsh-hooks__muted">
          跳过 {file.skipped.length} 个非 command handler（本插件只运行 `type: "command"`）
        </div>
      ) : null}
      <div className="dsh-hooks__events">
        {file.events.map((view) => (
          <Fragment key={view.event}>
            <EventRow view={view} />
            {view.groups.map((group) => (
              <GroupBlock
                key={String(group.rawIndex)}
                group={group}
                file={file}
                event={view.event}
                writable={writable}
                busy={busy}
                onToggle={onToggle}
                editor={editor}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/** 设置页「Hooks」的整节内容。 */
export function HooksSection(): Jsx {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [banner, setBanner] = useState<Banner | null>(null)
  const [busy, setBusy] = useState(false)
  /** 写成功后 +1 → 重新取数，保证页面显示的是**写完之后**的状态。 */
  const [nonce, setNonce] = useState(0)
  /** 正在编辑哪一行（空串 = 没有）。**一次只编辑一行**。 */
  const [editingKey, setEditingKey] = useState('')
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
    void (async () => {
      try {
        const response = await fetch(HOOKS_ROUTE, {
          method: 'GET',
          signal: controller.signal,
          // 鉴权是 host-only 的同源 cookie（官方 connection 层管），这里只需带上同源凭据。
          credentials: 'same-origin',
        })
        const body = (await response.json()) as HooksResponse
        if (body.ok) setPhase({ kind: 'ready', snapshot: body.data })
        else setPhase({ kind: 'failed', code: body.error, detail: body.detail ?? '' })
      } catch (error) {
        setPhase({
          kind: 'failed',
          code: 'network',
          detail: error instanceof Error ? error.message : String(error),
        })
      } finally {
        clearTimeout(timer)
      }
    })()
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [nonce])

  /**
   * 行内操作统一入口。
   *
   * - 失败写进**页面级**通道（§3.7），且**不清空**已有内容 —— 用户要能对着旧内容判断
   *   该刷新还是该去改文件；
   * - 成功后 `nonce + 1` 重新取数（绝不自己在本地猜新状态：那会和宿主的答案漂移）。
   */
  const runWrite = (intent: WriteIntent): void => {
    if (busy) return
    setBusy(true)
    setBanner(null)
    void (async () => {
      const outcome = await requestWrite(intent)
      if (outcome.ok) {
        setNonce((value) => value + 1)
        setEditingKey('')
      } else {
        setBanner({ code: outcome.error ?? 'internal', detail: outcome.detail ?? '' })
      }
      setBusy(false)
    })()
  }

  const onToggle: Toggle = (file, event, groupRawIndex, hook) => {
    runWrite({
      file: file.kind,
      op: 'setHookDisabled',
      event,
      groupIndex: groupRawIndex,
      hookIndex: hook.rawIndex,
      disabled: !hook.disabled,
    })
  }

  const onCreate = (file: FileView): void => {
    runWrite({ file: file.kind, op: 'createFile' })
  }

  const editor: Editor = {
    key: editingKey,
    draft,
    start: (key, command) => {
      setEditingKey(key)
      setDraft(command)
    },
    change: (value) => {
      setDraft(value)
    },
    cancel: () => {
      setEditingKey('')
      setDraft('')
    },
    save: (file, event, groupRawIndex, hook) => {
      // **只发定点操作**：命令是唯一被改的字段，其余一切由宿主原样保留（§2.3/§2.4）。
      runWrite({
        file: file.kind,
        op: 'setHookCommand',
        event,
        groupIndex: groupRawIndex,
        hookIndex: hook.rawIndex,
        command: draft,
      })
    },
  }

  if (phase.kind === 'loading') {
    return (
      <div className="dsh-hooks">
        <style>{styles}</style>
        <div className="dsh-hooks__muted">读取中…</div>
      </div>
    )
  }

  if (phase.kind === 'failed') {
    return (
      <div className="dsh-hooks">
        <style>{styles}</style>
        <div className="dsh-hooks__banner dsh-hooks__banner--error">{sentenceFor(phase.code)}</div>
        {phase.detail === '' ? null : <div className="dsh-hooks__muted">{phase.detail}</div>}
      </div>
    )
  }

  const { snapshot } = phase
  return (
    <div className="dsh-hooks">
      <style>{styles}</style>
      <div className="dsh-hooks__head">
        <div className="dsh-hooks__row">
          <span className="dsh-hooks__count">
            生效 {String(snapshot.total.hookCount)} 条 · 分组 {String(snapshot.total.groupCount)} 个
            {snapshot.total.disabledCount > 0 ? ` · 已停用 ${String(snapshot.total.disabledCount)} 条` : ''}
          </span>
        </div>
        {snapshot.projectRoot === null ? (
          <div className="dsh-hooks__banner">
            无法确定当前项目（没有会话上下文）—— 只显示用户级配置。请从某个项目的会话里打开设置。
          </div>
        ) : (
          <div className="dsh-hooks__root">项目根：{snapshot.projectRoot}</div>
        )}
        {snapshot.staleInUse ? (
          <div className="dsh-hooks__banner dsh-hooks__banner--warn">
            磁盘上的配置当前读不出来，运行中的 hook 仍在沿用**上一份可用配置**。修好文件后会自动恢复。
          </div>
        ) : null}
        {snapshot.capabilities.writable ? null : (
          <div className="dsh-hooks__banner">本页当前是只读模式（宿主没有提供写入能力）。</div>
        )}
        {/* 行内操作的失败**只在这里**渲染（§3.7：一条错误只允许一个渲染点）。 */}
        {banner === null ? null : (
          <div className="dsh-hooks__banner dsh-hooks__banner--error">
            {writeErrorSentence(banner.code)}
            {banner.detail === '' ? null : <span className="dsh-hooks__muted">（{banner.detail}）</span>}
          </div>
        )}
      </div>
      {snapshot.files.map((file) => (
        <SourceCard
          key={file.kind}
          file={file}
          writable={snapshot.capabilities.writable}
          busy={busy}
          onToggle={onToggle}
          onCreate={onCreate}
          editor={editor}
        />
      ))}
    </div>
  )
}

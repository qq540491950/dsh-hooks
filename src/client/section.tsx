/**
 * 设置页「Hooks」——**作用域选择 + 工具条 + hook 卡列表**。
 *
 * ## 作用域是什么、不是什么（最重要的一条）
 * 下拉框只决定**页面读哪份文件、写哪份文件**；它**不改变运行时**：hook 仍然按触发事件的会话
 * cwd → 最近 `.git` 祖先解析，用户级永远参与合并（AGENTS §2.6）。所以页面必须同时说清两件事：
 *   ① 选中的作用域是哪个文件（横幅 + 文件路径）；
 *   ② **当前会话实际会跑的是什么**（折叠的只读那一行，数据来自宿主 `snapshot.session`）。
 *
 * ## 它显示什么、由谁决定
 * 全部内容来自宿主 `GET /api/hooks?scope=…`（AGENTS §2.6：**页面不许自己解析 `hooks.json`**，
 * 那些分组、条数、matcher 诊断、来源、条数口径都是宿主算出来的；搜索只是**过滤已加载的列表**）。
 * 写入只发定点操作（§2.3），且**必须**经 `intentFor(scope, op)` 构造（§2.2：选中工作区时
 * 请求体必须带 `workspaceId`，宿主拿不到就拒写、绝不回落会话项目）。
 *
 * ## UI 纪律在这里的体现
 *   - §3.6：**7 个事件永远全列**（含 0 条）；「空」和「不存在」必须长得不一样；
 *   - §3.7：**一条错误只允许一个渲染点** —— 行内操作失败进**页面级** banner，
 *     新建表单失败进**表单内**（两条通道由调用方一次选定，绝不互相写）；
 *   - §3.8：每行的颜色**只**来自执行台账（`lastRun`）与 `disabled`；没有记录就是灰「未运行」；
 *   - §3.9：文件不存在 / JSON 非法 / 沙箱拒绝 / matcher 非法**分别说清**，不把内部错误原文当主文案；
 *   - §2.8：当前会话未知时**不编造**，也不显示"生效 0 条"（读不到 ≠ 没有）。
 *
 * ## 状态顺序（假 React 按位置发值，改顺序就要同步改自检）
 * `phase`→`banner`→`busy`→`nonce`→`scope`→`query`→`editingKey`→`draft`→`confirmKey`→`dryKey`→
 * `dryText`→`newOpen`→`newEvent`→`newMatcher`→`newCommand`→`newTimeout`（方案 §6.2 的顺序）
 * → 追加 `formError`（表单内错误通道）→ `showEffective`（D3 那个折叠块）。
 *
 * 子组件（`hook-card.tsx` / `new-hook.tsx`）**必须是纯 props、不带任何 hook**（见各自文件头）。
 */

import { Fragment, h, useEffect, useState } from './react.ts'
import type { Jsx } from './react.ts'
import { HOOKS_ROUTE } from '../shared/constants.ts'
import { styles } from './styles.ts'
import { HookCard } from './hook-card.tsx'
import { NewHookForm } from './new-hook.tsx'
import {
  CURRENT_SCOPE,
  dryRunFor,
  intentFor,
  requestDryRun,
  requestWrite,
  scopeQuery,
  writeErrorSentence,
  type DryRunView,
  type ScopeValue,
  type WriteOp,
} from './write.ts'
import type { EventView, FileView, GroupView, HooksResponse, HooksSnapshot, HookView } from './wire.ts'

/**
 * 请求超时预算。
 *
 * 没有它的话，宿主一旦卡住 `fetch` 永不 settle，页面会永远停在"读取中…"，用户只能刷新整页。
 */
const REQUEST_TIMEOUT_MS = 10_000

/** 页面状态：三种，互斥；**不做"猜测式"降级**。 */
type Phase =
  { kind: 'loading' } | { kind: 'ready'; snapshot: HooksSnapshot } | { kind: 'failed'; code: string; detail: string }

/** 一条错误（`code` 是人话的键，`detail` 只作补充）。 */
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
    case 'unknown-workspace':
      return '这个工作区已经不在宿主的清单里了（可能被删过），请刷新页面后重试。'
    case 'no-workspace-registry':
      return '宿主没有提供工作区清单，只能改当前项目和用户级配置。'
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

/**
 * 试运行结果 → 一行字。
 *
 * **不猜**（§3.8）：`exitCode === null`（子进程没起来）与"非零退出"是两件事，各自说清；
 * `deny`/`block` 单独点名。输出优先显示 stderr（钩子通常把原因写在 stderr）。
 */
function formatDryRun(run: DryRunView): string {
  const outcome =
    run.exitCode === null
      ? '启动失败（子进程没起来）'
      : run.decision === 'deny' || run.decision === 'block'
        ? `已阻断（exit ${String(run.exitCode)}）`
        : run.exitCode === 0
          ? '通过（exit 0）'
          : `失败（exit ${String(run.exitCode)}）`
  const text = run.stderr.trim() === '' ? run.stdout.trim() : run.stderr.trim()
  return `试运行：${outcome} · ${String(run.durationMs)}ms${text === '' ? '' : ` · ${text}`}`
}

/** 一条 hook 的身份键：**文件 + 事件 + 两个原始下标**（就是寻址用的那三元组）。 */
function rowKey(kind: string, event: string, groupRawIndex: number, hookIndex: number): string {
  return `${kind}|${event}|${String(groupRawIndex)}|${String(hookIndex)}`
}

/** 选中的工作区/用户级的显示名（说清"我在看哪一份"）。 */
function scopeLabel(snapshot: HooksSnapshot, scope: ScopeValue): string {
  if (scope === 'user') return '用户级'
  if (scope === CURRENT_SCOPE) return '当前会话项目'
  const found = snapshot.workspaces.find((workspace) => workspace.id === scope)
  return found === undefined ? scope : found.title
}

/** 路径的最后一段（给"当前会话项目（dsh-hooks）"这种 label 用；Windows / POSIX 分隔符都认）。 */
function lastSegment(value: string): string {
  const parts = value.split(/[\\/]+/).filter((part) => part !== '')
  const last = parts[parts.length - 1]
  return last === undefined ? value : last
}

/**
 * 当前会话的项目**是不是**已经在工作区清单里（用 `projectRoot` 比，而不是路径字符串）。
 *
 * 不在清单里时下拉框必须补一个「当前会话项目」选项 —— 否则用户改不到自己正在开发的项目的
 * 项目级配置（旧页面本有这个能力，这是实打实的能力回归）。
 */
function currentProjectMissing(snapshot: HooksSnapshot): boolean {
  if (snapshot.projectRoot === null) return false
  return !snapshot.workspaces.some((workspace) => workspace.projectRoot === snapshot.projectRoot)
}

/**
 * 作用域横幅：**每一句都必须在事实上有依据**（§2.1）。
 *
 *   - 用户级：对所有项目生效（叠加关系必须说清）；
 *   - 选中当前会话所在的项目：改动立即生效；
 *   - 选中别的工作区：改动**不会**影响当前会话，且当前会话的沙箱权限可能拒绝写它；
 *   - 会话未知：如实说"不知道"，不许拿工作区清单里的某一条代称当前项目。
 */
function scopeBanner(snapshot: HooksSnapshot, scope: ScopeValue): { tone: 'info' | 'warn'; text: string } | null {
  const { scope: view } = snapshot
  if (view.kind === 'user') {
    return {
      tone: 'info',
      text: '用户级配置：对**所有**项目生效；每个项目还会叠加它自己的项目级配置（用户级先跑）。',
    }
  }
  // 工作区路径与项目根不同时必须**分别**说清，否则用户会问"我改的是 A，为什么落到 B/.dsh"。
  const roots =
    view.workspacePath !== null && view.workspacePath !== view.projectRoot
      ? `；工作区路径 ${view.workspacePath}，项目根 ${String(view.projectRoot)}（配置落在项目根的 .dsh/hooks.json）`
      : view.projectRoot === null
        ? ''
        : `（项目根 ${view.projectRoot}）`
  // `workspaceId` / `workspacePath` 都是 null = 这是「当前会话项目」那条路（会话 cwd 解析出来的），
  // 不是清单里的某个工作区 —— 此时说"这个工作区"就是在编造一个不存在的东西。
  const viaCurrent = view.workspaceId === null && view.workspacePath === null
  if (view.isCurrentSession === true) {
    return {
      tone: 'info',
      text: `当前会话就在${viaCurrent ? '这个项目' : '这个工作区'}${roots}，改动对之后的调用**立即**生效。`,
    }
  }
  const where = viaCurrent ? '当前会话的项目' : (view.workspaceTitle ?? view.workspaceId ?? scope)
  if (view.isCurrentSession === false) {
    return {
      tone: 'warn',
      text:
        `你正在看/改 **${where}**${roots}；当前会话的项目根是 ${String(snapshot.projectRoot)}。` +
        '这次改动**不会**影响当前会话，只影响以后在它里面打开的会话。' +
        '另外，当前会话的沙箱权限可能不允许写这个文件（那会报 sandbox）—— 那是预期行为，不是 bug。',
    }
  }
  return {
    tone: 'warn',
    text: `你正在看/改 **${where}**${roots}；但**当前会话未知**，无法判断它是不是当前会话的项目。`,
  }
}

/** 选中作用域里"主文件"（要编辑的那份）：用户级作用域 → 用户文件；工作区作用域 → 项目文件。 */
function primaryFileOf(snapshot: HooksSnapshot): FileView | undefined {
  const wanted = snapshot.scope.kind === 'user' ? 'user' : 'project'
  return snapshot.files.find((file) => file.kind === wanted) ?? snapshot.files[0]
}

/** 设置页「Hooks」的整节内容。 */
export function HooksSection(): Jsx {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [banner, setBanner] = useState<Banner | null>(null)
  const [busy, setBusy] = useState(false)
  /** 写成功后 +1 → 重新取数，保证页面显示的是**写完之后**的状态。 */
  const [nonce, setNonce] = useState(0)
  /** 作用域：`'user'` 或工作区 id（**页面默认 = 用户**，用户要求；GET 的缺省仍是 `current`）。 */
  const [scope, setScope] = useState<ScopeValue>('user')
  /** 搜索框（**纯前端过滤**：不发请求、不改原始下标）。 */
  const [query, setQuery] = useState('')
  /** 正在编辑哪一行（空串 = 没有）。**一次只编辑一行**。 */
  const [editingKey, setEditingKey] = useState('')
  const [draft, setDraft] = useState('')
  /** 正在等"确认删除"的那一行（空串 = 没有）。 */
  const [confirmKey, setConfirmKey] = useState('')
  /** 刚试运行完的那一行 + 结果文案（**不进台账**，只给人看一眼）。 */
  const [dryKey, setDryKey] = useState('')
  const [dryText, setDryText] = useState('')
  /** 新建表单是否展开 + 它的四个字段。 */
  const [newOpen, setNewOpen] = useState(false)
  const [newEvent, setNewEvent] = useState('PreToolUse')
  const [newMatcher, setNewMatcher] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [newTimeout, setNewTimeout] = useState('')
  /** **表单内**的错误通道（§3.7）：只由新建/编辑提交写入，只渲染在表单里。 */
  const [formError, setFormError] = useState<Banner | null>(null)
  /** 折叠的「当前会话生效」（D3）：默认**折叠**。 */
  const [showEffective, setShowEffective] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
    void (async () => {
      try {
        // 读也必须带作用域：否则页面看的是"当前会话的项目"、写的是选中那个工作区（另一条"看着 A 改到 B"）。
        const response = await fetch(`${HOOKS_ROUTE}${scopeQuery(scope)}`, {
          method: 'GET',
          signal: controller.signal,
          // 鉴权是 host-only 的同源 cookie（官方 connection 层管），这里只需带上同源凭据。
          credentials: 'same-origin',
        })
        const body = (await response.json()) as HooksResponse
        if (body.ok) {
          setPhase({ kind: 'ready', snapshot: body.data })
        } else {
          // 选中的工作区已经不在清单里了（宿主换了 / 被删过）：退回用户级重取一次，
          // 别把页面卡在一个用户改不动的错误上（下拉框只在 ready 相位渲染）。
          if (body.error === 'unknown-workspace' || body.error === 'no-workspace-registry') setScope('user')
          setPhase({ kind: 'failed', code: body.error, detail: body.detail ?? '' })
        }
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
  }, [nonce, scope])

  /**
   * 所有写请求的唯一入口。
   *
   * - 请求体一律由 `intentFor(scope, op)` 产出（选中工作区时**一定**带 `workspaceId`，§2.2）；
   * - `channel` **一次选定**：`page` = 页面级横幅（行内操作），`form` = 表单内（新建/编辑）——
   *   §3.7 要求"一条错误只允许一个渲染点"，绝不允许两条通道都写；
   * - 成功后 `nonce + 1` 重新取数（绝不自己在本地猜新状态：那会和宿主的答案漂移）。
   */
  const runRequest = (op: WriteOp, channel: 'page' | 'form', onSuccess: () => void): void => {
    if (busy) return
    setBusy(true)
    if (channel === 'page') setBanner(null)
    else setFormError(null)
    void (async () => {
      const outcome = await requestWrite(intentFor(scope, op))
      if (outcome.ok) {
        setNonce((value) => value + 1)
        onSuccess()
      } else {
        const problem: Banner = { code: outcome.error ?? 'internal', detail: outcome.detail ?? '' }
        if (channel === 'page') setBanner(problem)
        else setFormError(problem)
      }
      setBusy(false)
    })()
  }

  /** 行内操作：失败进**页面级**通道（§3.7）。 */
  const runWrite = (op: WriteOp): void => {
    runRequest(op, 'page', () => {
      setEditingKey('')
      setConfirmKey('')
    })
  }

  /** 切作用域：**必须**清掉行内编辑 / 确认 / 试运行态（否者旧文件的行下标会打到新文件上）。 */
  const changeScope = (next: ScopeValue): void => {
    if (next === scope) return
    setScope(next)
    setEditingKey('')
    setDraft('')
    setConfirmKey('')
    setDryKey('')
    setDryText('')
    setFormError(null)
    setNewOpen(false)
  }

  const dryRun = (kind: string, event: string, groupRawIndex: number, hook: HookView): void => {
    if (busy) return
    setBusy(true)
    setBanner(null)
    void (async () => {
      // 试运行**不是写操作**：不碰文件、不进台账（§3.8），但寻址同样必须定点到作用域。
      const outcome = await requestDryRun(
        dryRunFor(scope, { event, groupIndex: groupRawIndex, hookIndex: hook.rawIndex }),
      )
      if (outcome.ok && outcome.run !== undefined) {
        setDryKey(rowKey(kind, event, groupRawIndex, hook.rawIndex))
        setDryText(formatDryRun(outcome.run))
      } else {
        setBanner({ code: outcome.error ?? 'internal', detail: outcome.detail ?? '' })
      }
      setBusy(false)
    })()
  }

  /** 新建表单提交：错误进**表单内**通道（§3.7）。 */
  const submitNew = (): void => {
    const timeoutText = newTimeout.trim()
    let timeoutSec: number | null = null
    if (timeoutText !== '') {
      const value = Number(timeoutText)
      if (!Number.isFinite(value) || value <= 0) {
        setFormError({ code: 'bad-timeout', detail: '' })
        return
      }
      timeoutSec = value
    }
    runRequest(
      { op: 'addGroup', event: newEvent, matcher: newMatcher, command: newCommand, timeoutSec },
      'form',
      () => {
        setNewOpen(false)
        setNewCommand('')
        setNewMatcher('')
        setNewTimeout('')
      },
    )
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
    // 失败态**必须**给恢复控件：选择器引入后"工作区被删掉"会拿到 404 unknown-workspace，
    // 而选作用域的控件本身只在 ready 相位渲染 —— 没有这两个按钮，用户就只能整页刷新。
    const prefersUser = phase.code === 'unknown-workspace' || phase.code === 'no-workspace-registry'
    return (
      <div className="dsh-hooks">
        <style>{styles}</style>
        <div className="dsh-hooks__banner dsh-hooks__banner--error">{sentenceFor(phase.code)}</div>
        {phase.detail === '' ? null : <div className="dsh-hooks__muted">{phase.detail}</div>}
        <div className="dsh-hooks__toolbar">
          <button
            type="button"
            className={prefersUser ? 'dsh-hooks__toolbtn' : 'dsh-hooks__toolbtn dsh-hooks__toolbtn--primary'}
            title="重试"
            onClick={() => {
              setNonce((value) => value + 1)
            }}
          >
            ↻ 重试
          </button>
          <button
            type="button"
            className={prefersUser ? 'dsh-hooks__toolbtn dsh-hooks__toolbtn--primary' : 'dsh-hooks__toolbtn'}
            title="回到用户级配置"
            onClick={() => {
              // 清掉错误态 + 换回用户级（`nonce + 1` 保证"本来就是 user"时也会重新取数）。
              setPhase({ kind: 'loading' })
              setScope('user')
              setNonce((value) => value + 1)
            }}
          >
            回到用户级配置
          </button>
        </div>
      </div>
    )
  }

  const { snapshot } = phase
  const writable = snapshot.capabilities.writable
  const primary = primaryFileOf(snapshot)
  const others = snapshot.files.filter((file) => file !== primary)
  const needle = query.trim().toLowerCase()
  const matches = (hook: HookView, group: GroupView, event: string): boolean => {
    if (needle === '') return true
    return (
      hook.command.toLowerCase().includes(needle) ||
      (group.matcher ?? '').toLowerCase().includes(needle) ||
      event.toLowerCase().includes(needle)
    )
  }
  const installed = primary === undefined ? 0 : primary.hookCount - primaryDisabled(primary)
  const scopeSentence = scopeBanner(snapshot, scope)

  /** 一个事件分组（含搜索过滤后的组/条数）。 */
  const renderEvent = (view: EventView | { event: string; groups: GroupView[] }, file: FileView): Jsx => {
    const groups = view.groups
      .map((group) => ({ group, hooks: group.hooks.filter((hook) => matches(hook, group, view.event)) }))
      .filter((entry) => entry.hooks.length > 0)
    const shown = groups.reduce((sum, entry) => sum + entry.hooks.length, 0)
    return (
      <Fragment key={view.event}>
        <div className="dsh-hooks__event">
          <span className="dsh-hooks__eventname">{view.event}</span>
          {groups.length === 0 ? (
            <span className="dsh-hooks__empty">
              {needle === '' ? '没有配置' : '没有匹配的 hook'}
              {needle === '' && 'runCount' in view && view.runCount > 0
                ? `（但历史上跑过 ${String(view.runCount)} 次）`
                : ''}
            </span>
          ) : (
            <span className="dsh-hooks__count">{String(shown)} 条</span>
          )}
          {writable ? (
            <button
              type="button"
              className="dsh-hooks__toolbtn"
              title={`在 ${view.event} 下新建`}
              disabled={busy}
              onClick={() => {
                setNewEvent(view.event)
                setNewOpen(true)
                setFormError(null)
              }}
            >
              ＋新建
            </button>
          ) : null}
        </div>
        {groups.map(({ group, hooks }) => (
          <Fragment key={`${view.event}:${String(group.rawIndex)}`}>
            <div className="dsh-hooks__matcher">
              {group.matcher === null ? '匹配全部' : `matcher: ${group.matcher}`}
              {group.matcherOk ? null : <span className="dsh-hooks__tag">matcher 非法，这一组不会运行</span>}
              {group.file === null ? <span className="dsh-hooks__tag">来源无法确定（正在沿用上一份配置）</span> : null}
            </div>
            <div className="dsh-hooks__list">
              {hooks.map((hook) => {
                const kind = group.file ?? file.kind
                const key = rowKey(kind, view.event, group.rawIndex, hook.rawIndex)
                return (
                  <HookCard
                    key={`${String(group.rawIndex)}:${String(hook.rawIndex)}`}
                    hook={hook}
                    // `staleInUse` 时来源无法确定（`file === null`）→ **禁用编辑**，而不是猜一个文件写进去。
                    writable={writable && group.file !== null}
                    busy={busy}
                    editing={editingKey === key}
                    draft={draft}
                    confirming={confirmKey === key}
                    dryText={dryKey === key ? dryText : ''}
                    onToggle={() => {
                      runWrite({
                        op: 'setHookDisabled',
                        event: view.event,
                        groupIndex: group.rawIndex,
                        hookIndex: hook.rawIndex,
                        disabled: !hook.disabled,
                      })
                    }}
                    onStartEdit={() => {
                      setEditingKey(key)
                      setDraft(hook.command)
                      setConfirmKey('')
                    }}
                    onDraftChange={(value) => {
                      setDraft(value)
                    }}
                    onCancelEdit={() => {
                      setEditingKey('')
                      setDraft('')
                    }}
                    onSave={() => {
                      // **只发定点操作**：命令是唯一被改的字段（§2.3/§2.4）。
                      runWrite({
                        op: 'setHookCommand',
                        event: view.event,
                        groupIndex: group.rawIndex,
                        hookIndex: hook.rawIndex,
                        command: draft,
                      })
                    }}
                    onAskRemove={() => {
                      // **第一步只改状态、不发请求** —— 删除是唯一丢数据的操作。
                      setConfirmKey(key)
                      setEditingKey('')
                    }}
                    onCancelRemove={() => {
                      setConfirmKey('')
                    }}
                    onRemove={() => {
                      runWrite({
                        op: 'removeHook',
                        event: view.event,
                        groupIndex: group.rawIndex,
                        hookIndex: hook.rawIndex,
                      })
                    }}
                    onDryRun={() => {
                      dryRun(kind, view.event, group.rawIndex, hook)
                    }}
                  />
                )
              })}
            </div>
          </Fragment>
        ))}
      </Fragment>
    )
  }

  return (
    <div className="dsh-hooks">
      <style>{styles}</style>

      {/* ── 工具条：作用域下拉 + 条数 + 搜索 + 刷新 / 新建 ── */}
      <div className="dsh-hooks__toolbar">
        <span className="dsh-hooks__scope">
          <span className="dsh-hooks__newlabel">作用域</span>
          {/* 原生 <select> + <optgroup>：键盘与无障碍免费，不依赖官方 DOM 结构（§6.2）。 */}
          <select
            className="dsh-hooks__select"
            value={scope}
            onChange={(changeEvent) => {
              changeScope(changeEvent.target.value)
            }}
          >
            <option value="user">用户（全局）</option>
            {/* 会话项目**不在**工作区清单里时，必须能选它 —— 否则正在开发的这个项目改不到
                （旧页面本有这个能力）。`scope=current` 由宿主按会话 cwd 解析，不带 workspaceId。 */}
            {currentProjectMissing(snapshot) ? (
              <option value={CURRENT_SCOPE}>当前会话项目（{lastSegment(String(snapshot.projectRoot))}）</option>
            ) : null}
            {snapshot.workspaces.length === 0 ? null : (
              <optgroup label="工作区">
                {snapshot.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.title}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </span>
        {primary === undefined ? null : (
          <span className="dsh-hooks__count" title="这个文件里的 hook 条数（含已停用）">
            钩子 {String(primary.hookCount)}
          </span>
        )}
        <input
          className="dsh-hooks__search"
          type="text"
          value={query}
          placeholder="搜索钩子…"
          onChange={(changeEvent) => {
            setQuery(changeEvent.target.value)
          }}
        />
        <span className="dsh-hooks__toolbarActions">
          <button
            type="button"
            className="dsh-hooks__toolbtn"
            title="刷新"
            disabled={busy}
            onClick={() => {
              setNonce((value) => value + 1)
            }}
          >
            ↻ 刷新
          </button>
          <button
            type="button"
            className="dsh-hooks__toolbtn"
            title="新建"
            disabled={busy || !writable}
            onClick={() => {
              setNewOpen(!newOpen)
              setFormError(null)
            }}
          >
            ＋ 新建
          </button>
        </span>
      </div>
      <div className="dsh-hooks__toolbar">
        {/* 口径（D4）：`已安装` = 启用中条数；`钩子 N`（下拉框右边）= 文件总条数（含已停用）。 */}
        <span className="dsh-hooks__installed">
          已安装 {String(installed)}
          {primary !== undefined && primary.hookCount - installed > 0
            ? ` · 已停用 ${String(primary.hookCount - installed)}`
            : ''}
        </span>
        {primary === undefined ? null : <span className="dsh-hooks__path">{primary.path}</span>}
      </div>

      {/* 当前会话的项目根：与所选作用域**无关**的事实（AGENTS §2.8：拿不到就不写）。 */}
      {snapshot.projectRoot === null ? (
        <div className="dsh-hooks__muted">当前会话的项目根未知（没有会话上下文）—— 不编造一个路径。</div>
      ) : (
        <div className="dsh-hooks__root" title="当前会话的项目根（hook 运行时按它解析）">
          当前会话项目根：{snapshot.projectRoot}
        </div>
      )}

      {/* 宿主没有工作区清单：必须**明说**，绝不许渲染成一个空下拉（§3.6/§3.9）。 */}
      {snapshot.workspacesAvailable ? null : (
        <div className="dsh-hooks__muted">
          宿主没有提供工作区清单（只能改用户级配置）—— 这是"这个宿主给不了这个能力"，不是"你没有工作区"。
        </div>
      )}
      {snapshot.workspacesAvailable && snapshot.workspaces.length === 0 ? (
        <div className="dsh-hooks__muted">还没有工作区。</div>
      ) : null}
      {snapshot.workspacesAvailable && currentProjectMissing(snapshot) ? (
        <div className="dsh-hooks__muted">
          当前会话的项目（{snapshot.projectRoot}）不在工作区清单里：用上面下拉框里的「当前会话项目（
          {lastSegment(String(snapshot.projectRoot))}）」就能编辑它 —— 它一直照常参与运行时合并。
        </div>
      ) : null}

      {/* 作用域横幅（§2.1）：用户级 / 当前工作区 / 非当前工作区，三种话必须不同。 */}
      {scopeSentence === null ? null : (
        <div
          className={scopeSentence.tone === 'warn' ? 'dsh-hooks__banner dsh-hooks__banner--warn' : 'dsh-hooks__banner'}
        >
          {scopeSentence.text}
        </div>
      )}
      {snapshot.staleInUse ? (
        <div className="dsh-hooks__banner dsh-hooks__banner--warn">
          磁盘上的配置当前读不出来，运行中的 hook 仍在沿用**上一份可用配置**。修好文件后会自动恢复。
        </div>
      ) : null}
      {writable ? null : <div className="dsh-hooks__banner">本页当前是只读模式（宿主没有提供写入能力）。</div>}
      {/* 行内操作的失败**只在这里**渲染（§3.7：一条错误只允许一个渲染点）。 */}
      {banner === null ? null : (
        <div className="dsh-hooks__banner dsh-hooks__banner--error">
          {writeErrorSentence(banner.code)}
          {banner.detail === '' ? null : <span className="dsh-hooks__muted">（{banner.detail}）</span>}
        </div>
      )}

      {/* ── 折叠的只读「当前会话生效」（D3；AGENTS §2.6：页面必须能回答"实际会跑的是什么"） ── */}
      <div className="dsh-hooks__effective">
        <button
          type="button"
          className="dsh-hooks__toolbtn"
          title="展开/收起所选作用域的生效视图"
          onClick={() => {
            setShowEffective(!showEffective)
          }}
        >
          {/* ⚠️ 三态（§2.8/§2.9）：读不到 ≠ 没有 —— `session === null` 时**绝不**显示"生效 0 条"。 */}
          {sessionSentence(snapshot)}
          {showEffective ? ' ▾' : ' ▸'}
        </button>
        {showEffective ? (
          <div className="dsh-hooks__effectivelist">
            <div className="dsh-hooks__muted">
              下面是**所选作用域**（{scopeLabel(snapshot, scope)}
              ）的生效视图：宿主给的合并顺序是用户级在前、项目级在后。
            </div>
            {snapshot.events.map((view) => (
              <div className="dsh-hooks__event" key={view.event}>
                <span className="dsh-hooks__eventname">{view.event}</span>
                <span className="dsh-hooks__count">
                  {String(view.hookCount)} 条（用户级 {String(view.fromUser)} + 项目级 {String(view.fromProject)}）
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── 新建表单（错误只渲染在表单内部，§3.7） ── */}
      {newOpen ? (
        <NewHookForm
          draft={{ event: newEvent, matcher: newMatcher, command: newCommand, timeout: newTimeout }}
          error={formError === null ? null : writeErrorSentence(formError.code)}
          errorDetail={formError === null ? '' : formError.detail}
          busy={busy}
          writable={writable}
          onEvent={setNewEvent}
          onMatcher={setNewMatcher}
          onCommand={setNewCommand}
          onTimeout={setNewTimeout}
          onSubmit={submitNew}
          onCancel={() => {
            setNewOpen(false)
            setFormError(null)
          }}
        />
      ) : null}

      {/* ── 选中的作用域那一份文件：状态 + 7 个事件（含 0 条）+ hook 卡 ── */}
      {primary === undefined ? (
        <div className="dsh-hooks__muted">宿主没有给出这个作用域的文件（不该发生，请刷新）。</div>
      ) : (
        <div className="dsh-hooks__card">
          <div className="dsh-hooks__cardhead">
            <strong>{primary.kind === 'project' ? '项目级（选中的工作区）' : '用户级（全局）'}</strong>
            <span className="dsh-hooks__path">{primary.path}</span>
            <span className="dsh-hooks__count">{String(primary.hookCount)} 条</span>
            {writable && primary.state === 'absent' ? (
              <span className="dsh-hooks__actions">
                <button
                  type="button"
                  className="dsh-hooks__btn"
                  title="新建这个文件"
                  disabled={busy}
                  onClick={() => {
                    runWrite({ op: 'createFile' })
                  }}
                >
                  新建这个文件
                </button>
              </span>
            ) : null}
          </div>
          <div className="dsh-hooks__muted">{fileStateText(primary)}</div>
          {needle === '' ? null : (
            <div className="dsh-hooks__muted">
              筛选后 {String(countShown(primary, matches))} / 共 {String(primary.hookCount)}
            </div>
          )}
          {primary.matcherErrors.length > 0 ? (
            <div className="dsh-hooks__banner dsh-hooks__banner--warn">
              {primary.matcherErrors.length} 处 matcher 非法（那些组不会运行）：{primary.matcherErrors.join('；')}
            </div>
          ) : null}
          {primary.skipped.length > 0 ? (
            <div className="dsh-hooks__muted">
              跳过 {primary.skipped.length} 个非 command handler（本插件只运行 `type: "command"`）
            </div>
          ) : null}
          <div className="dsh-hooks__events">{primary.events.map((view) => renderEvent(view, primary))}</div>
        </div>
      )}

      {/* 另一个来源：**永远都列**（§3.6），但只读 —— 它的写操作要去对应的作用域里做。 */}
      {others.map((file) => (
        <div className="dsh-hooks__card" key={file.kind}>
          <div className="dsh-hooks__cardhead">
            <strong>{file.kind === 'user' ? '用户级（全局）' : '项目级'}</strong>
            <span className="dsh-hooks__path">{file.path}</span>
            <span className="dsh-hooks__count">{String(file.hookCount)} 条</span>
          </div>
          <div className="dsh-hooks__muted">
            {fileStateText(file)} —— 这份配置同样会参与合并运行；要编辑它请把上面的作用域切到
            {file.kind === 'user' ? '「用户（全局）」' : '对应的工作区'}。
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * 「当前会话生效」那一行的文案（D3 + §2.6 + 三态）。
 *
 * `session === null` 时**必须**说"不知道"：读不到会话上下文 ≠ 没有 hook（AGENTS §2.8/§2.9）。
 * 显示"当前会话生效 0 条"就是把"不知道"说成"没有"，这正是本仓库最危险的那条失效路径。
 */
function sessionSentence(snapshot: HooksSnapshot): string {
  const session = snapshot.session
  if (session === null) return '当前会话未知，无法判断实际会跑什么'
  const counts = `${String(session.hookCount)} 条（用户级 ${String(session.fromUser)} + 项目级 ${String(
    session.fromProject,
  )}）`
  return session.staleInUse ? `当前会话生效 ${counts}· 正在沿用上一份可用配置` : `当前会话生效 ${counts}`
}

/** 一份文件里已停用的条数（口径与宿主一致：`hookCount` 不含 disabled）。 */ function primaryDisabled(
  file: FileView,
): number {
  let disabled = 0
  for (const view of file.events) disabled += view.disabledCount
  return disabled
}

/** 搜索过滤后还剩几条（**不改任何原始下标**：过滤只影响渲染）。 */
function countShown(file: FileView, matches: (hook: HookView, group: GroupView, event: string) => boolean): number {
  let shown = 0
  for (const view of file.events) {
    for (const group of view.groups) {
      for (const hook of group.hooks) {
        if (matches(hook, group, view.event)) shown++
      }
    }
  }
  return shown
}

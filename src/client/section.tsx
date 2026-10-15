/**
 * 设置页「Hooks」——**两行工具条 + 一条 hook 一张卡 + 两个折叠区**。
 *
 * ## 这一层的布局契约（用户按参考图定下的形态）
 * ```
 * 作用域 [ 当前会话项目（dsh-hooks） ▾ ]  钩子 3            [🔍 搜索钩子…]
 * 已安装 2 · 已停用 1 · 会话将跑 4 条                        [↻ 刷新]  [＋ 新建]
 * ─────────────────────────────────────────────────────────
 * ▣  PreToolUse                                     [ ●—— ]
 *    node -e const fs=require('node:fs')…
 * ▸ 查看全部事件（7）   ▸ 诊断
 * ```
 *   - **一张卡 = 一条 hook**（不是"一个事件一张卡"）：标题=事件名、副标题=命令、右侧开关；
 *   - 工具条**两行**：第一行 作用域 + 条数 + 搜索；第二行 计数 + 刷新/新建（对齐参考图）；
 *   - **0 条的事件不进主列表**，收进底部折叠 `查看全部事件（7）`；
 *   - **主列表为空时渲染空状态块**（真机那一屏就是它）：标题 + **分别说清**的副文案
 *     （文件不存在 = "这份 hooks.json 还不存在（这是空的，不是出错）"；存在但 0 条 =
 *     "文件里没有任何 hook"）+ 路径 + 主按钮 `＋ 新建第一条 hook` + **仅**文件不存在时的
 *     `新建配置文件` + **引导条**（`当前会话项目（dsh-hooks）里有 1 条 · [切换过去]`）。
 *     用户默认落在空空的**用户级**上，而真正有内容的是当前会话项目 —— 没有这条引导，
 *     他看到的就只有"这个作用域还没有 hook"。**文件读不出来是第三种情形**，如实说"无法判断"，
 *     绝不冒充"空的"（§2.9 那条最危险的失效路径）。
 *   - **作用域的一切"当前是谁"都跟宿主回显**（`snapshot.scope`，见 `echoedScopeOf`）：
 *     触发器 label / popover 勾选 / 写与试运行的落点 / 底部摘要的引导句，全从回显推导；
 *     本地 `scope` state 只表示"我请求了什么"（宿主把 `current` 归一成 `user` 时页面必须跟着变）。
 *     这条是 AGENTS §2.6 的落地：**页面显示的就是宿主实际给的那一份**。
 *   - **描边按钮只允许出现在工具条**（`↻ 刷新` / `＋ 新建`）：内容区（卡片动作 / 折叠事件行 /
 *     空状态 / 新建表单）一律 ghost 文字按钮。折叠收起时全页 `__btn--outline` 计数必须是 **0**
 *     （D 区有断言；真机上"7 个事件行各一个描边小按钮"就是"乱"的来源）；
 *   - **诊断收进底部折叠**（项目根 / 路径 / 状态 / 版本 / 清单 / matcher 诊断…）；
 *   - 页面级提示**最多一条**（页面错误 > 文件坏了 > 非当前工作区 > 只读），不再堆叠横幅。
 *
 * ## ⚠️ 对 AGENTS §3.6 的有意偏离（写在明处）
 * §3.6 要求"7 个事件分组永远全部渲染（含 0 条）"。本轮按用户明确要求改成"主列表只显示有内容的
 * 事件，全部 7 个事件收进**默认折叠**的 `查看全部事件（7）`"。偏离的理由与代价：
 *   - 理由：一屏 7 行里通常 5 行是"没有配置"，用户读到的全是噪音（原话"冗余内容很多"）；
 *   - 代价：**默认不动手就看不到"空"**。所以折叠里必须**永远**列全 7 个事件（含 0 条，并明说
 *     "没有配置"、并给出该事件的「＋新建」）——"空"没有变得**不可达**，只是不再默认占一屏。
 *   - 自检里对这条的断言两半都留着：折叠**收起**时主列表不含 0 条事件；**展开**后 7 个都在。
 *
 * ## 会话上下文（本轮修的真 bug）
 * 页面过去**从不带 `sessionId`**，宿主只能退回 `currentInitiator()`（设置页里拿不到）→ 整页
 * "当前会话未知"、项目根解析不出来。现在走 root kit 的 `props.useSessions(findMainSessionId)`
 * （判据与 `dsh-skill-manager` / 官方 `CordisPanel` 同一份：`retainedBy.mainView > 0`），
 * 并把它并进 GET 与写请求的 query（宿主从 URL 取，见 `data-plane.ts`）。
 * `useSessions` 缺失时用 no-op 替身 —— **不做条件式 hook 调用**（那会改变 hook 位，把后面所有
 * `useState` 的取值错位）。
 *
 * ## 状态都放在最外层
 * 子组件（`scope-picker.tsx` / `hook-card.tsx` / `new-hook.tsx`）一律**纯 props、零 hook**：
 * `tools/verify.ts` 的假 React 按位置发 `useState` 的值，只支持无 hook 的子组件。
 * `useState` 顺序（改顺序要同步改自检的场景）：`phase`→`banner`→`busy`→`nonce`→`scope`→`query`
 * →`editingKey`→`draft`→`confirmKey`→`dryKey`→`dryText`→`newOpen`→`newEvent`→`newMatcher`
 * →`newCommand`→`newTimeout`→`formError`→`scopeOpen`→`scopeActive`→`allEventsOpen`→`diagOpen`。
 */

import { Fragment, h, useEffect, useState } from './react.ts'
import type { Jsx } from './react.ts'
import { HOOK_EVENTS } from '../shared/constants.ts'
import { styles } from './styles.ts'
import { HookCard } from './hook-card.tsx'
import { NewHookForm } from './new-hook.tsx'
import { ScopePicker, type KeyLike, type ScopeOption } from './scope-picker.tsx'
import {
  CURRENT_SCOPE,
  dryRunFor,
  intentFor,
  requestDryRun,
  requestWrite,
  snapshotPath,
  writeErrorSentence,
  type DryRunView,
  type ScopeValue,
  type WriteOp,
} from './write.ts'
import type { FileView, GroupView, HooksResponse, HooksSnapshot, HookView } from './wire.ts'

/**
 * 请求超时预算。
 *
 * 没有它的话，宿主一旦卡住 `fetch` 永不 settle，页面会永远停在"读取中…"，用户只能刷新整页。
 */
const REQUEST_TIMEOUT_MS = 10_000

/** root standard kit 里本组件用到的那一件事（`settings.section` 是 root scope 座位）。 */
export interface HooksSectionProps {
  useSessions?: (selector: (state: unknown) => unknown) => unknown
}

/**
 * 官方的「当前 session」判据：sessions 快照里 `retainedBy.mainView > 0` 的那一行。
 *
 * 这是**约定**而非字段：`ClientSessions` 不管选中态，选中态落在 uiWorkspace/uiSession；
 * `mainView` 这个 retention source 由 `dsh-client-ui-workspace` 的 `replaceMain()` 写入。
 * 全仓 6 处官方代码用同一判据（settings-general / layout / session / workspace / cordis），
 * 同目录 `dsh-skill-manager` 也是这么写的 —— 这里照抄，不另发明。
 */
function findMainSessionId(state: unknown): unknown {
  if (typeof state !== 'object' || state === null) return undefined
  const byId = (state as { byId?: unknown }).byId
  if (typeof byId !== 'object' || byId === null) return undefined
  for (const [key, value] of Object.entries(byId as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const row = value as { id?: unknown; retainedBy?: { mainView?: unknown } }
    const retained = typeof row.retainedBy?.mainView === 'number' ? row.retainedBy.mainView : 0
    if (retained > 0) return typeof row.id === 'string' && row.id !== '' ? row.id : key
  }
  return undefined
}

/**
 * `useSessions` 缺失时的替身。
 *
 * 它**不是** React hook（不调用任何 hook），所以调用它不影响 hook 计数；存在的意义是让
 * "拿到 root kit"与"没拿到"两条路径在源码上长得一样，免得为了省一次调用而写出条件式 hook 调用。
 * 实现上把"空快照"交给**同一个** selector（等价于"查不到主会话"），而不是丢掉参数 ——
 * 两条路径连判据都是同一份代码。
 */
function useNoSession(selector: (state: unknown) => unknown): unknown {
  return selector({ byId: undefined })
}

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

/**
 * 文件状态 → 一个**短**词（长句子已经全删：用户反馈"冗余"）。
 *
 * 三态必须**分别**说清（§2.9/§3.9）：不存在 ≠ 读不出来 ≠ 好的。
 */
function stateToken(file: FileView): string {
  switch (file.state) {
    case 'absent':
      return '文件不存在'
    case 'ok':
      return '已读取'
    default:
      return '读不出来'
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

/** 路径的最后一段（给"当前会话项目（dsh-hooks）"这种标签用；两种分隔符都认）。 */
function lastSegment(value: string): string {
  const parts = value.split(/[\\/]+/).filter((part) => part !== '')
  const last = parts[parts.length - 1]
  return last === undefined ? value : last
}

/**
 * 当前会话的项目**是不是**已经在工作区清单里（用 `projectRoot` 比，而不是路径字符串）。
 *
 * 不在清单里时下拉必须补一个「当前会话项目」选项 —— 否则用户改不到自己正在开发的项目的
 * 项目级配置（旧页面本有这个能力）。
 */
function currentProjectMissing(snapshot: HooksSnapshot): boolean {
  if (snapshot.projectRoot === null) return false
  return !snapshot.workspaces.some((workspace) => workspace.projectRoot === snapshot.projectRoot)
}

/**
 * 「当前会话项目（<目录名>）」那一行字：**只有一个出处**（options 与触发器共用，避免两处分叉）。
 *
 * ⚠️ 用的是**会话**的项目根（顶层 `projectRoot`），**不是** `scope.projectRoot` —— 后者是
 * "当前选中的那份"的项目根，切到别的工作区时它就变成那个工作区的路径了。用错会把选项写成
 * 「当前会话项目（agent-go）」（跟下面的 `agent-go` 那一项看着一模一样，等于骗人；
 * 真机截图里抓到过一次）。
 */
function currentProjectLabel(snapshot: HooksSnapshot): string {
  const root = snapshot.projectRoot ?? snapshot.scope.projectRoot
  return `当前会话项目（${lastSegment(String(root))}）`
}

/** 下拉的分组/选项（顺序即显示顺序；`group` 变化处画一个分组标题）。 */
function scopeOptions(snapshot: HooksSnapshot): ScopeOption[] {
  const options: ScopeOption[] = [{ value: 'user', label: '用户（全局）', group: '用户' }]
  if (currentProjectMissing(snapshot)) {
    options.push({ value: CURRENT_SCOPE, label: currentProjectLabel(snapshot), group: '工作区' })
  }
  for (const workspace of snapshot.workspaces) {
    options.push({ value: workspace.id, label: workspace.title, group: '工作区' })
  }
  return options
}

/**
 * 宿主**回显**的作用域 → 页面用来"说自己是哪一份"的取值。
 *
 * ⚠️ 这是本页最重要的一条纪律（AGENTS §2.6 的落地）：**页面显示的就是宿主实际给的那一份**。
 * 触发器的 label、popover 里的勾选（`aria-selected` / `✓`）、以及**每一个写请求**都必须按回显
 * 推导；本地 `scope` state 只表示"我发起过什么请求"。
 *
 * 反面教材（真机截图与预览都被抓到过）：触发器写着「用户（全局）」，而卡片是项目级的、
 * 横幅说"你在看/改 agent-go"、底部摘要说"要编辑请切到「用户（全局）」" —— 同一屏自相矛盾。
 * 根因就是触发器 label 用了本地 state（初始 `'user'`），而数据来自回显。
 *
 * 宿主把 `scope=current` **归一化**成 `user`（没有会话上下文）时，这里自然也回落到
 * `'user'` ⇒ 页面显示「用户（全局）」，**不许**继续标"当前会话项目"。
 */
function echoedScopeOf(snapshot: HooksSnapshot): ScopeValue {
  if (snapshot.scope.kind === 'user') return 'user'
  return snapshot.scope.workspaceId === null ? CURRENT_SCOPE : snapshot.scope.workspaceId
}

/** 回显 → 触发器上那行字（格式与 `scopeOptions` 完全一致：两处都从回显推）。 */
function echoedLabelOf(snapshot: HooksSnapshot): string {
  if (snapshot.scope.kind === 'user') return '用户（全局）'
  if (snapshot.scope.workspaceId !== null) {
    return snapshot.scope.workspaceTitle ?? snapshot.scope.workspaceId
  }
  return currentProjectLabel(snapshot)
}

/**
 * 作用域语义（§2.1 那句"必须说清"的话）。
 *
 * ⚠️ 它是**纯文本**，不带 markdown 标记 —— 要强调由调用方包 `<strong>`（本轮修的真 bug：
 * 截图里 `**agent-go**` 把星号原样渲染出来了）。
 */
function scopeHelp(snapshot: HooksSnapshot, scope: ScopeValue): string {
  const { scope: view } = snapshot
  if (view.kind === 'user') {
    return '用户级配置对所有项目生效；每个项目还会叠加它自己的项目级配置（用户级先跑）。'
  }
  const viaCurrent = view.workspaceId === null && view.workspacePath === null
  if (view.isCurrentSession === true) {
    return viaCurrent
      ? `当前会话就在这个项目（项目根 ${String(view.projectRoot)}），改动对之后的调用立即生效。`
      : `当前会话就在这个工作区（项目根 ${String(view.projectRoot)}），改动对之后的调用立即生效。`
  }
  const where = viaCurrent ? '当前会话的项目' : (view.workspaceTitle ?? view.workspaceId ?? scope)
  if (view.isCurrentSession === false) {
    // ⚠️ 这一条是**一回事两句话**（用户反馈"横幅堆了三四行"）：压到 2 行以内，
    //    但两件事一件都不许丢 ——「改动不会作用于当前会话」+「可能被当前会话的沙箱拒绝」。
    //    自检里有一条"句子数 ≤ 2"的断言守着它别涨回去（D17）。
    return (
      `你正在看/改 ${where}；改动不会作用于当前会话（项目根 ${String(snapshot.projectRoot)}），` +
      `只影响以后在 ${where} 里打开的会话。写入还可能被当前会话的沙箱拒绝（报 sandbox 属预期）。`
    )
  }
  return `你正在看/改 ${where}；但当前会话未知，无法判断它是不是当前会话的项目。`
}

/**
 * 「另一个来源」那一行摘要里的引导句：**只在目标作用域 ≠ 当前作用域时出现**。
 *
 * 否则就是"自己指自己"（真机截图里选中用户级，底部却写"要编辑请把作用域切到「用户（全局）」"）
 * —— 那种话会让用户以为页面坏了。目标 = 当前时退化成中性描述（只有路径 / 条数 / 状态）。
 */
function otherFileGuide(selected: 'user' | 'workspace', file: 'project' | 'user'): string | null {
  if (file === 'user') return selected === 'user' ? null : '用户（全局）'
  return selected === 'workspace' ? null : '对应的工作区'
}

/** 选中作用域里"主文件"（要编辑的那份）：用户级作用域 → 用户文件；工作区作用域 → 项目文件。 */
function primaryFileOf(snapshot: HooksSnapshot): FileView | undefined {
  const wanted = snapshot.scope.kind === 'user' ? 'user' : 'project'
  return snapshot.files.find((file) => file.kind === wanted) ?? snapshot.files[0]
}

/** 一份文件里已停用的条数（口径与宿主一致：`hookCount` 不含 disabled）。 */
function disabledCountOf(file: FileView): number {
  let disabled = 0
  for (const view of file.events) disabled += view.disabledCount
  return disabled
}

/**
 * 空状态块要说的两件事 + 一条**引导**。
 *
 * `guide` 是这一屏最关键的一条路：页面默认落在**用户（全局）**，而真机上用户级文件根本不存在
 * （`~/.dsh/hooks.json` 没建过），于是用户第一眼看到的是一个空页面 —— 而真正有内容的是
 * "当前会话项目"。没有这条引导，他只能看到"这个作用域还没有 hook"然后自己猜。
 */
interface EmptyBlock {
  /** 文件不存在 / 文件在但 0 条 —— **两种情形分开说**（§2.9/§3.9：空 ≠ 不存在）。 */
  body: string
  path: string
  /** 「新建配置文件」**只在文件不存在时**出现。 */
  canCreateFile: boolean
  guide: { text: string; action: string; target: ScopeValue } | null
}

/**
 * 会话项目在清单里就用那个工作区 id，不在就用 `current`（宿主按会话 cwd 解析）。
 *
 * 两条路都**不带**伪造的 workspaceId —— `current` 那条一旦带上 id 就是谎称"它是某个工作区"，
 * 宿主照白名单查会 404（见 `write.ts` 的 `CURRENT_SCOPE` 注释）。
 */
function currentScopeTarget(snapshot: HooksSnapshot): ScopeValue {
  const root = snapshot.projectRoot
  const known = snapshot.workspaces.find((workspace) => workspace.projectRoot === root)
  return known === undefined ? CURRENT_SCOPE : known.id
}

/**
 * 引导条：把用户从"空的作用域"带到"真的有内容的地方"。
 *
 * 证据只用**宿主给的**两份：① 用户级作用域下看 `session`（宿主只回用户级那份文件，
 * 所以"当前会话项目有几条"只能从 `session.fromProject` 来）；② 项目级作用域下看 `files` 里的
 * 用户级那份。**不许猜**：拿不到证据（会话未知）就不给引导，而不是编一个"也许有"。
 */
function emptyGuideOf(snapshot: HooksSnapshot): { text: string; action: string; target: ScopeValue } | null {
  const raw = rawEmptyGuideOf(snapshot)
  // ★ 引导条存在的唯一意义是"把用户带到**别处**"：目标 = 当前作用域时直接不给（自己指自己）。
  //   正常情况下不会走到这一步（空状态就意味着当前这一份是空的），但规则必须钉死 ——
  //   它和底部摘要那条 `otherFileGuide` 是同一条纪律的两半。
  if (raw === null || raw.target === echoedScopeOf(snapshot)) return null
  return raw
}

/** 引导条的原始推导（不判"自己指自己"，那条在 `emptyGuideOf` 里统一处理）。 */
function rawEmptyGuideOf(snapshot: HooksSnapshot): { text: string; action: string; target: ScopeValue } | null {
  if (snapshot.scope.kind === 'user') {
    const session = snapshot.session
    if (session === null || session.fromProject <= 0) return null
    return {
      text: `当前会话项目（${lastSegment(session.projectRoot)}）里有 ${String(session.fromProject)} 条。`,
      action: '切换过去',
      target: currentScopeTarget(snapshot),
    }
  }
  const userFile = snapshot.files.find((file) => file.kind === 'user')
  if (userFile === undefined || userFile.state !== 'ok' || userFile.hookCount <= 0) return null
  return {
    text: `用户级（全局）里有 ${String(userFile.hookCount)} 条。`,
    action: '切换过去',
    target: 'user',
  }
}

/** 空状态的文案（两种情形分开说；第三种"读不出来"**绝不**冒充"空的"）。 */
function emptyBlockOf(snapshot: HooksSnapshot, file: FileView): EmptyBlock {
  const absent = file.state === 'absent'
  return {
    body: absent ? '这份 hooks.json 还不存在（这是“空的”，不是出错）。' : '文件里没有任何 hook。',
    path: file.path,
    canCreateFile: absent,
    guide: emptyGuideOf(snapshot),
  }
}

/**
 * 空状态块：标题 + 分别说清的副文案 + 路径 + 主按钮（＋ 新建第一条 hook）+ 仅文件不存在时的
 * 次按钮（新建配置文件）+ 引导条。**纯 props、零 hook**（假 React 只支持无 hook 的子组件）。
 */
function EmptyState(props: {
  block: EmptyBlock
  writable: boolean
  busy: boolean
  onCreateHook: () => void
  onCreateFile: () => void
  onGuide: (target: ScopeValue) => void
}): Jsx {
  const { block, writable, busy } = props
  // `guide` 先取成局部常量：闭包里才留得住收窄（直接写 `props.block.guide.x` 会被判可能为 null）。
  const guide = block.guide
  return (
    <div className="dsh-hooks__empty">
      <span className="dsh-hooks__emptytitle">这个作用域还没有 hook</span>
      <span className="dsh-hooks__muted">{block.body}</span>
      <span className="dsh-hooks__path">{block.path}</span>
      {writable ? (
        <span className="dsh-hooks__emptyactions">
          <button
            type="button"
            className="dsh-hooks__btn dsh-hooks__btn--primary"
            title="新建第一条 hook"
            disabled={busy}
            onClick={props.onCreateHook}
          >
            ＋ 新建第一条 hook
          </button>
          {block.canCreateFile ? (
            <button
              type="button"
              className="dsh-hooks__btn dsh-hooks__btn--ghost"
              title="新建配置文件"
              disabled={busy}
              onClick={props.onCreateFile}
            >
              新建配置文件
            </button>
          ) : null}
        </span>
      ) : null}
      {guide === null ? null : (
        <div className="dsh-hooks__emptyguide">
          <span className="dsh-hooks__muted">{guide.text}</span>
          <button
            type="button"
            className="dsh-hooks__btn dsh-hooks__btn--ghost"
            title={guide.action}
            disabled={busy}
            onClick={() => {
              props.onGuide(guide.target)
            }}
          >
            {guide.action}
          </button>
        </div>
      )}
    </div>
  )
}

/** 一条 hook 卡片要画的全部东西（把 group 的 matcher 带下来）。 */
interface CardRow {
  event: string
  groupRawIndex: number
  matcher: string | null
  matcherProblem: string | null
  hook: HookView
}

/** 按事件顺序铺平"有内容的 hook"（主列表用；0 条的事件不进主列表 —— 见文件头的偏离说明）。 */
function cardRows(file: FileView, matches: (hook: HookView, group: GroupView, event: string) => boolean): CardRow[] {
  const rows: CardRow[] = []
  for (const view of file.events) {
    for (const group of view.groups) {
      for (const hook of group.hooks) {
        if (!matches(hook, group, view.event)) continue
        rows.push({
          event: view.event,
          groupRawIndex: group.rawIndex,
          matcher: group.matcher,
          matcherProblem: group.matcherOk ? null : (group.matcherProblem ?? 'matcher 非法'),
          hook,
        })
      }
    }
  }
  return rows
}

/** 设置页「Hooks」的整节内容。 */
export function HooksSection(props?: HooksSectionProps): Jsx {
  // 无论有没有 root kit，都走**同一个调用序列**（见 useNoSession 的注释）——
  // 条件式 hook 调用会改变 hook 位，把后面所有 useState 的取值错位。
  const useSessions = typeof props?.useSessions === 'function' ? props.useSessions : useNoSession
  const mainSession = useSessions(findMainSessionId)
  const sessionId = typeof mainSession === 'string' && mainSession !== '' ? mainSession : undefined

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [banner, setBanner] = useState<Banner | null>(null)
  const [busy, setBusy] = useState(false)
  /** 写成功后 +1 → 重新取数，保证页面显示的是**写完之后**的状态。 */
  const [nonce, setNonce] = useState(0)
  /** 作用域：`'user'` / `'current'`（会话项目）/ 工作区 id。**页面默认 = 用户**（D6）。 */
  const [scope, setScope] = useState<ScopeValue>('user')
  /** 搜索框（**纯前端过滤**：不发请求、不改原始下标）。 */
  const [query, setQuery] = useState('')
  const [editingKey, setEditingKey] = useState('')
  const [draft, setDraft] = useState('')
  const [confirmKey, setConfirmKey] = useState('')
  const [dryKey, setDryKey] = useState('')
  const [dryText, setDryText] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [newEvent, setNewEvent] = useState('PreToolUse')
  const [newMatcher, setNewMatcher] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [newTimeout, setNewTimeout] = useState('')
  /** **表单内**的错误通道（§3.7）：只由新建表单的提交写入，只渲染在表单里。 */
  const [formError, setFormError] = useState<Banner | null>(null)
  /** 作用域 popover 是否展开 + 键盘高亮的下标。 */
  const [scopeOpen, setScopeOpen] = useState(false)
  const [scopeActive, setScopeActive] = useState(0)
  /** 底部两个折叠区：**默认都收起**（"空"与诊断收在折叠里，见文件头）。 */
  const [allEventsOpen, setAllEventsOpen] = useState(false)
  const [diagOpen, setDiagOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
    void (async () => {
      try {
        // 读也必须**作用域 + 会话**都带上：缺作用域会看着 A 改到 B；缺 sessionId 会整页"会话未知"。
        const response = await fetch(snapshotPath(scope, sessionId), {
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
          // 别把页面卡在一个用户改不动的错误上（下拉只在 ready 相位渲染）。
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
  }, [nonce, scope, sessionId])

  /**
   * **页面正在显示的那一份作用域** = 宿主回显（ready 相位）；请求在飞时退回"我请求了什么"。
   *
   * ⚠️ 写请求与试运行也必须用它，而不是本地 `scope`：按钮挂在**屏幕上那些行**上，
   * 所以它们该动的是"屏幕上这一份文件"。用本地 state 会出现"看着 A 的行、发给 B"的窗口
   * （宿主把 `current` 归一成 `user` 时尤其明显）。
   */
  const displayScope: ScopeValue = phase.kind === 'ready' ? echoedScopeOf(phase.snapshot) : scope

  /**
   * 所有写请求的唯一入口。
   *
   * - 请求体一律由 `intentFor(displayScope, op)` 产出（选中工作区时**一定**带 `workspaceId`，§2.2）；
   * - `sessionId` 走 query（宿主据此解析调用会话的 cwd 与沙箱策略）；
   * - `channel` **一次选定**：`page` = 页面级提示行，`form` = 表单内 —— §3.7 要求
   *   "一条错误只允许一个渲染点"，绝不两条都写；
   * - 成功后 `nonce + 1` 重新取数（绝不自己在本地猜新状态：那会和宿主的答案漂移）。
   */
  const runRequest = (op: WriteOp, channel: 'page' | 'form', onSuccess: () => void): void => {
    if (busy) return
    setBusy(true)
    if (channel === 'page') setBanner(null)
    else setFormError(null)
    void (async () => {
      const outcome = await requestWrite(intentFor(displayScope, op), sessionId)
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

  /** 切作用域：**必须**清掉行内编辑 / 确认 / 试运行态（否则旧文件的行下标会打到新文件上）。 */
  const changeScope = (next: ScopeValue): void => {
    setScopeOpen(false)
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
        dryRunFor(displayScope, { event, groupIndex: groupRawIndex, hookIndex: hook.rawIndex }),
        sessionId,
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
        <div className="dsh-hooks__alert dsh-hooks__alert--error">{sentenceFor(phase.code)}</div>
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
  const options = scopeOptions(snapshot)
  const rows = primary === undefined ? [] : cardRows(primary, matches)
  const fileTotal = primary === undefined ? 0 : primary.hookCount
  const installed = fileTotal - (primary === undefined ? 0 : disabledCountOf(primary))
  const shown = rows.length
  // 触发器 label / 勾选位置 / 说明文字全部按**回显**（`displayScope`），不按本地 state：
  // 否则同屏会出现"触发器说用户级、数据是项目级"（AGENTS §2.6）。
  const displayLabel = echoedLabelOf(snapshot)
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === displayScope),
  )
  const help = scopeHelp(snapshot, displayScope)

  // ── 页面级提示**最多一条**（Fix A2）：页面错误 > 配置文件读不出来 > 非当前工作区 > 只读。
  const brokenFile = snapshot.files.find((file) => file.state === 'error')
  const alert: { tone: 'error' | 'warn' | 'info'; text: string; detail: string } | null =
    banner !== null
      ? // 技术原文只作**补充**（§3.9：绝不作为主文案，但排查要用得上）
        { tone: 'error', text: writeErrorSentence(banner.code), detail: banner.detail }
      : brokenFile !== undefined || snapshot.staleInUse
        ? {
            tone: 'error',
            text: '有配置文件现在读不出来（内容不是合法 JSON）—— 运行中的 hook 仍在沿用上一份可用配置。',
            detail: brokenFile?.message ?? '',
          }
        : snapshot.scope.kind === 'workspace' && snapshot.scope.isCurrentSession === false
          ? { tone: 'warn', text: help, detail: '' }
          : writable
            ? null
            : { tone: 'info', text: '本页当前是只读模式（宿主没有提供写入能力）。', detail: '' }

  /** 全部事件折叠区的行（含 0 条 —— 这是"空"的可达路径）。 */
  const eventRows =
    primary === undefined
      ? HOOK_EVENTS.map((event) => ({ event, file: undefined }))
      : primary.events.map((view) => ({ event: view.event, file: view }))

  const moveActive = (delta: number): void => {
    const total = options.length
    if (total === 0) return
    const next = scopeActive + delta
    setScopeActive(((next % total) + total) % total)
  }

  /** 触发器的键盘模型（详见 `scope-picker.tsx` 的文件注释）。 */
  const onScopeKey = (event: KeyLike): void => {
    if (event.key === 'Escape') {
      setScopeOpen(false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault?.()
      if (!scopeOpen) {
        setScopeActive(currentIndex)
        setScopeOpen(true)
        return
      }
      const picked = options[scopeActive]
      if (picked !== undefined) changeScope(picked.value)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault?.()
      if (!scopeOpen) {
        setScopeActive(currentIndex)
        setScopeOpen(true)
        return
      }
      moveActive(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  return (
    <div className="dsh-hooks">
      <style>{styles}</style>

      {/* ── 第一行工具条：作用域 + 条数 + 搜索 ── */}
      <div className="dsh-hooks__toolbar">
        <ScopePicker
          label={displayLabel}
          hint={help}
          options={options}
          value={displayScope}
          open={scopeOpen}
          active={scopeActive}
          busy={busy}
          onToggle={() => {
            setScopeActive(currentIndex)
            setScopeOpen(!scopeOpen)
          }}
          onMove={moveActive}
          onPick={changeScope}
          onKey={onScopeKey}
          onClose={() => {
            setScopeOpen(false)
          }}
        />
        <span className="dsh-hooks__count" title="这个作用域文件里的 hook 条数（含已停用）">
          钩子 {String(fileTotal)}
        </span>
        <span className="dsh-hooks__spacer" />
        <input
          className="dsh-hooks__search"
          type="search"
          value={query}
          placeholder="搜索钩子…"
          onChange={(changeEvent) => {
            setQuery(changeEvent.target.value)
          }}
        />
      </div>

      {/* ── 第二行工具条：计数（左）+ 刷新 / 新建（右） ── */}
      <div className="dsh-hooks__toolbar">
        <span className="dsh-hooks__installed">
          已安装 {String(installed)}
          {fileTotal - installed > 0 ? ` · 已停用 ${String(fileTotal - installed)}` : ''}
          {needle === '' ? '' : ` · 筛选后 ${String(shown)} / 共 ${String(fileTotal)}`}
        </span>
        <span className="dsh-hooks__session" title="当前会话实际会跑的那一份（与所选作用域无关）">
          {sessionLine(snapshot)}
        </span>
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

      {/* 唯一的提示行（§2.1 / §2.9 / §3.9 的话都在这里，不再堆叠） */}
      {alert === null ? null : (
        <div
          className={`dsh-hooks__alert${alert.tone === 'error' ? ' dsh-hooks__alert--error' : alert.tone === 'info' ? ' dsh-hooks__alert--info' : ''}`}
        >
          {alert.text}
          {alert.detail === '' ? null : <span className="dsh-hooks__muted">（{alert.detail}）</span>}
        </div>
      )}

      {/* 新建表单（错误只渲染在表单内部，§3.7） */}
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

      {/* ── 主列表：一张卡 = 一条 hook；0 条的事件不在这里（收进下面的折叠） ──
          主列表为空时有四种情形，**分别**说清（"空"与"读不出来"绝不许混，§2.9/§3.9）：
          ① 搜索没命中 → "没有匹配的 hook"；② 文件不存在 → 空状态块（附"新建配置文件"）；
          ③ 文件在但 0 条 → 空状态块；④ 文件读不出来 → 如实说"无法判断"，**不冒充空的**。 */}
      {needle !== '' && rows.length === 0 ? (
        <div className="dsh-hooks__muted">没有匹配的 hook</div>
      ) : rows.length === 0 && primary !== undefined ? (
        primary.state === 'error' ? (
          <div className="dsh-hooks__muted">文件读不出来，无法判断里面有没有 hook（见上面的提示）。</div>
        ) : (
          <EmptyState
            block={emptyBlockOf(snapshot, primary)}
            writable={writable}
            busy={busy}
            onCreateHook={() => {
              setNewOpen(true)
              setFormError(null)
            }}
            onCreateFile={() => {
              runWrite({ op: 'createFile' })
            }}
            onGuide={changeScope}
          />
        )
      ) : rows.length === 0 ? (
        <div className="dsh-hooks__muted">这个作用域没有可编辑的文件。</div>
      ) : (
        <div className="dsh-hooks__list">
          {rows.map((row) => {
            const kind = primary === undefined ? 'project' : primary.kind
            const key = rowKey(kind, row.event, row.groupRawIndex, row.hook.rawIndex)
            return (
              <HookCard
                key={key}
                hook={row.hook}
                event={row.event}
                matcher={row.matcher}
                matcherProblem={row.matcherProblem}
                writable={writable}
                busy={busy}
                editing={editingKey === key}
                draft={draft}
                confirming={confirmKey === key}
                dryText={dryKey === key ? dryText : ''}
                onToggle={() => {
                  runWrite({
                    op: 'setHookDisabled',
                    event: row.event,
                    groupIndex: row.groupRawIndex,
                    hookIndex: row.hook.rawIndex,
                    disabled: !row.hook.disabled,
                  })
                }}
                onStartEdit={() => {
                  setEditingKey(key)
                  setDraft(row.hook.command)
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
                    event: row.event,
                    groupIndex: row.groupRawIndex,
                    hookIndex: row.hook.rawIndex,
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
                    event: row.event,
                    groupIndex: row.groupRawIndex,
                    hookIndex: row.hook.rawIndex,
                  })
                }}
                onDryRun={() => {
                  dryRun(kind, row.event, row.groupRawIndex, row.hook)
                }}
              />
            )
          })}
        </div>
      )}

      {/* 另一个来源：**一行只读摘要**（不再渲染第二张完整卡）。
          末尾那句引导**只在目标 ≠ 当前作用域时**出现（`otherFileGuide`）：回显说当前就是用户级时，
          绝不能再写"要编辑请把作用域切到「用户（全局）」" —— 那是自己指自己。 */}
      {others.map((file) => {
        const guide = otherFileGuide(snapshot.scope.kind, file.kind)
        return (
          <div className="dsh-hooks__muted" key={file.kind}>
            {file.kind === 'user' ? '用户级（全局）' : '项目级'} · <span className="dsh-hooks__path">{file.path}</span>{' '}
            · {String(file.hookCount)} 条 · {stateToken(file)}
            {guide === null ? null : <> · 要编辑请把作用域切到「{guide}」</>}
          </div>
        )
      })}

      {/* ── 底部两个折叠区：全部事件（含 0 条）+ 诊断 ── */}
      <div className="dsh-hooks__folds">
        <button
          type="button"
          className="dsh-hooks__disclosure"
          title="查看全部事件"
          aria-expanded={allEventsOpen}
          onClick={() => {
            setAllEventsOpen(!allEventsOpen)
          }}
        >
          {allEventsOpen ? '▾' : '▸'} 查看全部事件（{String(HOOK_EVENTS.length)}）
        </button>
        <button
          type="button"
          className="dsh-hooks__disclosure"
          title="诊断"
          aria-expanded={diagOpen}
          onClick={() => {
            setDiagOpen(!diagOpen)
          }}
        >
          {diagOpen ? '▾' : '▸'} 诊断
        </button>
      </div>

      {/* 全部事件：**7 个永远都在这里**（含 0 条）——"空"没有变得不可达（见文件头的偏离说明） */}
      {allEventsOpen ? (
        <div className="dsh-hooks__foldbody">
          {eventRows.map(({ event, file }) => (
            <div className="dsh-hooks__eventrow" key={event}>
              <span className="dsh-hooks__eventname dsh-hooks__eventname--fold">{event}</span>
              {file === undefined || file.groups.length === 0 ? (
                <span className="dsh-hooks__muted">
                  没有配置
                  {file !== undefined && file.runCount > 0 ? `（但历史上跑过 ${String(file.runCount)} 次）` : ''}
                </span>
              ) : (
                <span className="dsh-hooks__count">
                  {String(file.hookCount)} 条
                  {file.disabledCount > 0 ? `（另有 ${String(file.disabledCount)} 条已停用）` : ''}
                </span>
              )}
              {writable ? (
                <button
                  type="button"
                  className="dsh-hooks__btn dsh-hooks__btn--ghost"
                  title={`在 ${event} 下新建`}
                  disabled={busy}
                  onClick={() => {
                    setNewEvent(event)
                    setNewOpen(true)
                    setFormError(null)
                  }}
                >
                  ＋新建
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* 诊断：所有"开发者要看的"东西都收在这里（默认收起） */}
      {diagOpen ? (
        <div className="dsh-hooks__foldbody">
          <DiagRow label="作用域" value={help} />
          <DiagRow label="当前会话" value={sessionLine(snapshot)} />
          <DiagRow label="项目根" value={snapshot.projectRoot ?? '未知（没有会话上下文，不编造）'} />
          <DiagRow label="cwd 来源" value={snapshot.cwdSource} />
          <DiagRow
            label="作用域回显"
            value={`kind=${snapshot.scope.kind} requested=${snapshot.scope.requested} workspaceId=${String(
              snapshot.scope.workspaceId,
            )} isCurrentSession=${String(snapshot.scope.isCurrentSession)}`}
          />
          {primary === undefined ? null : (
            <DiagRow
              label="当前文件"
              value={`${primary.path} · ${stateToken(primary)} · 版本 ${String(primary.version)} · ${String(
                primary.hookCount,
              )} 条`}
            />
          )}
          {others.map((file) => (
            <DiagRow
              key={file.kind}
              label={file.kind === 'user' ? '用户级文件' : '项目级文件'}
              value={`${file.path} · ${stateToken(file)} · 版本 ${String(file.version)} · ${String(file.hookCount)} 条`}
            />
          ))}
          {snapshot.scope.workspacePath !== null && snapshot.scope.workspacePath !== snapshot.scope.projectRoot ? (
            <DiagRow
              label="工作区路径"
              value={`${snapshot.scope.workspacePath}（≠ 项目根，配置落在项目根的 .dsh/hooks.json）`}
            />
          ) : null}
          <DiagRow label="staleInUse" value={snapshot.staleInUse ? '是（沿用上一份可用配置）' : '否'} />
          <DiagRow
            label="工作区清单"
            value={
              snapshot.workspacesAvailable
                ? `${String(snapshot.workspaces.length)} 项`
                : '宿主没有提供工作区清单，只能改当前项目和用户级配置'
            }
          />
          {snapshot.workspacesAvailable && currentProjectMissing(snapshot) ? (
            <DiagRow
              label="当前会话项目"
              value={`${String(snapshot.projectRoot)} 不在清单里 —— 用作用域下拉的「当前会话项目（${lastSegment(
                String(snapshot.projectRoot),
              )}）」编辑它`}
            />
          ) : null}
          {primary === undefined ? null : (
            <DiagRow
              label="matcher 诊断"
              value={primary.matcherErrors.length === 0 ? '无' : primary.matcherErrors.join('；')}
            />
          )}
          {primary === undefined ? null : (
            <DiagRow
              label="跳过的 handler"
              value={
                primary.skipped.length === 0
                  ? '无'
                  : primary.skipped.map((item) => `${item.event}:${item.type}`).join('、')
              }
            />
          )}
          {banner === null ? null : <DiagRow label="错误详情" value={`${banner.code} ${banner.detail}`} />}
        </div>
      ) : null}
    </div>
  )
}

/** 诊断区一行：`key` + `value`。 */
function DiagRow(props: { label: string; value: string }): Jsx {
  return (
    <div className="dsh-hooks__diagrow">
      <span className="dsh-hooks__diagkey">{props.label}</span>
      <span className="dsh-hooks__diagval">{props.value}</span>
    </div>
  )
}

/**
 * 「当前会话实际会跑什么」那一行（AGENTS §2.6 + 三态）。
 *
 * `session === null` 时**必须**说"不知道"：读不到会话上下文 ≠ 没有 hook（§2.8/§2.9）。
 * 显示"当前会话生效 0 条"就是把"不知道"说成"没有"，那正是本仓库最危险的那条失效路径。
 */
function sessionLine(snapshot: HooksSnapshot): string {
  const session = snapshot.session
  if (session === null) return '当前会话未知，无法判断实际会跑什么'
  const counts = `${String(session.hookCount)} 条（用户级 ${String(session.fromUser)} + 项目级 ${String(
    session.fromProject,
  )}）`
  return session.staleInUse ? `当前会话生效 ${counts}· 正在沿用上一份可用配置` : `当前会话生效 ${counts}`
}

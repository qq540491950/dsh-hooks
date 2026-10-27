/**
 * 设置页「Hooks」——**一行工具条 + 一句元信息 + 一条 hook 一张卡 + 一个折叠区**。
 *
 * ## 这一层的布局契约（v4：用户拿 ZCode 的钩子页做参照，说"非要使用一堆说明和检测"）
 * ```
 * 作用域 [ 当前会话项目（dsh-hooks） ▾ ]                [▸] [↻ 刷新]  [＋ 新建]
 * 1 个 hook · 其中 1 个已停用                              本会话生效 4 个
 * ─────────────────────────────────────────────────────────
 * ●  工具运行前 PreToolUse              未运行              [ ●—— ]  ⋯
 *    node -e const fs=require('node:fs')…
 * ```
 *   - **一张卡 = 一条 hook**，一屏只有两行：标题行（状态点 + 中文名主/英文枚举次要 + 一个
 *     **状态词** + 开关 + `⋯`）与命令行；
 *   - **`⋯` 里才是"详情"**：`匹配 X · 超时 Y` + 三个动作（试运行 / 编辑 / 删除）。v3 里那一行
 *     常驻的 meta（`未运行  匹配 pwsh|bash   默认 600 秒`）整条删掉了 —— 状态词留在正文，
 *     匹配范围与超时只在这块里；`exit N · 12ms` 这类技术串只在状态点的 `title` 里；
 *   - **工具条只有一行**：左边作用域、右边 `↻ 刷新` / `＋ 新建`。`钩子 N` chip 删掉了
 *     （它夹在下拉与搜索框之间破坏分组），搜索框**只在 `fileTotal >= 5` 时**渲染
 *     （1 条 hook 的页面上它是纯噪音）；
 *   - **第二行是一句人话**（次要色）：`N 个 hook`，有停用时追加 `其中 M 个已停用`，
 *     筛选时换成 `匹配 K / 共 N`。「本会话生效 X 个」**只在**它和屏幕上这一份**不是同一件事**时
 *     出现（作用域 ≠ 当前会话项目，或会话未知）—— 选中当前会话项目时上面那句已经是答案。
 *     过去同一屏把条数说了 5 遍（`钩子 1` / `已安装 1` / `（用户级 0 + 项目级 1）` / `0 条` / `1 条`），
 *     现在 `（用户级 a + 项目级 b）` 与完整口径只留在**详情折叠**里；
 *   - **折叠只有一个，入口在工具条右端**（v7 从"正文最后一行 `▸ 更多`"挪过去的；v3 是
 *     `查看全部事件（7）` + `诊断` 两个并列开关）：24×24 的 `▸`/`▾` 字形按钮，与卡片上那个 `⋯`
 *     同一套规格，名字走 `title` + `aria-label`（字形不是名字）。展开后先列 7 个事件（含 0 条，
 *     这是"空"的唯一可达路径），再列诊断（项目根 / cwd 来源 / 路径 / 状态 / 版本 / `写入权限` /
 *     清单 / matcher 诊断…）。**内容就贴在工具条下面**（在第一张卡之前）——从工具条点开的东西
 *     落在页尾，用户会以为按钮没生效。收起时整页不多占一行；
 *   - **主列表为空时渲染空状态块**（真机那一屏就是它）：标题 + **一句**副文案
 *     （文件不存在 = "这份 hooks.json 还不存在 —— 这是空的，不是出错"；存在但 0 条 =
 *     "文件里还没有任何 hook"）+ 一行按钮（主按钮 `＋ 新建第一条 hook` + 仅文件不存在时的
 *     `新建配置文件` + 引导按钮 `切换过去`）。**路径不再上屏**（它进了 `更多` 与按钮的 `title`）：
 *     v3 那块是"标题 + 副文案 + 路径 + 按钮 + 引导条"五行，用户读完还是不知道先点哪个。
 *     **文件读不出来是第三种情形**，如实说"无法判断"，绝不冒充"空的"（§2.9 最危险的失效路径）。
 *   - **作用域的一切"当前是谁"都跟宿主回显**（`snapshot.scope`，见 `echoedScopeOf`）：
 *     触发器 label / popover 勾选 / 写与试运行的落点 / 底部摘要的引导句，全从回显推导；
 *     本地 `scope` state 只表示"我请求了什么"（宿主把 `current` 归一成 `user` 时页面必须跟着变）。
 *     这条是 AGENTS §2.6 的落地：**页面显示的就是宿主实际给的那一份**。
 *   - **描边按钮只允许出现在工具条**（`↻ 刷新` / `＋ 新建`）：内容区（卡片动作 / 折叠事件行 /
 *     空状态 / 新建表单）一律 ghost 文字按钮。折叠收起时全页 `__btn--outline` 计数必须是 **0**
 *     （D 区有断言；真机上"7 个事件行各一个描边小按钮"就是"乱"的来源）；
 *   - 页面级提示**最多一条**（页面错误 > 文件坏了 > 非当前工作区 > 只读），不再堆叠横幅。
 *
 * ## v4 的取舍（写下来，免得下一轮又往回长）
 *   "砍掉可见的说明与检测"**不等于**"砍掉检测"：v4 删的全部是**渲染点**，一条判据都没删 ——
 *   三态（`absent`/`ok`/`error`）、fail-open 的 last-good、定点写 + 保留性证明、版本锁、
 *   状态色只来自执行台账、matcher 非法的例外标签，全部原样保留，只是**默认不占屏**。
 *   判据：`tools/verify.ts` 里那些"事实必须可达"的断言一条都没减少（只是从"首屏"换成"`更多`里"）。
 *
 * ## 三条"面向用户"的硬规则（v3 的 P0，都有机器断言；v4 只改了渲染点）
 *   1. **非当前工作区**（v6：**平时一句话都不说，只在写成功之后说一句**）：
 *      首屏不渲染任何提醒 —— "我看/改的这一份不是本会话在读的"这件事挂在作用域触发器的 `title`
 *      与 `更多` 折叠里（`项目根` + `写入权限` = 「按调用会话的沙箱策略判定；被拒绝时报 sandbox」）。
 *      **只有写入真的成功**（含新建表单提交）且落点不是当前会话这一份时，才在唯一的提示行里出现
 *      一句 `已写入 X —— 本会话不读这份配置，改动只影响以后在 X 里打开的会话。`
 *      + 不再给「切回当前会话项目」按钮：作用域选择器就在它上面一行，而那句话说的是选择器的方向。
 *      理由：用户明确要求"别在平时占屏"（原话"去掉这些信息"）；代价是**动手之后**才知道落到了
 *      别的工作区 —— 所以这句必须挂在**每一次**成功写入上，不许只在切换作用域时说。
 *      正文里永远**没有盘符路径**、没有"项目根"。
 *      黄底（`state-warning-background`）**不再挂在 `__alert` 上** —— 样式里没有这个颜色，
 *      自检对样式字符串做字面断言（"警告底色"不许回来）。
 *   2. **另一个来源**（用户级 / 项目级里不是主文件的那一份）**只在"有东西"时出现**：
 *      `file.hookCount > 0 || file.state === 'error'`。有内容 → `用户级（全局）还有 2 个 hook`
 *      + ghost `切过去`；读不出来 → `用户级（全局）这份配置读不出来（详情见「更多」）`。
 *      两种情形正文里都**不含盘符路径**（路径与状态都在 `更多` 折叠里）。
 *   3. **折叠里的空事件行**右侧是 `＋` **字形按钮**（`title` = `在 X 下新建`，
 *      `aria-label` = 中文名 + 英文原文），不再是六个「＋新建」文字按钮 —— 行高仍固定 32px。
 *
 * ## ⚠️ 对 AGENTS §3.6 的有意偏离（写在明处）
 * §3.6 要求"7 个事件分组永远全部渲染（含 0 条）"。本轮按用户明确要求改成"主列表只显示有内容的
 * 事件，全部 7 个事件收进**默认折叠**的 `更多`"。偏离的理由与代价：
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
 * →`newCommand`→`newTimeout`→`formError`→`scopeOpen`→`scopeActive`→`moreOpen`→`menuKey`
 * →`menuField`→`menuDraft`→`newGroup`→`dryFull`→**`notice`（v6 追加在末尾）**。
 * ⚠️ `moreOpen`（底部 `更多`）与 `menuKey`（哪一条 hook 的 `⋯` 展开着）**占的是 v3 里
 * `allEventsOpen` / `diagOpen` 那两个位置** —— 位置没变，含义变了：读测试里"点了折叠"这类
 * 交互时按顺序数 useState 的地方会踩到，改这里必须一起看 tools/verify.ts 的 D 区。
 */

import { Fragment, h, useEffect, useState } from './react.ts'
import type { Jsx } from './react.ts'
import { HOOK_EVENTS } from '../shared/constants.ts'
import { matcherDiagnostic } from '../shared/protocol.ts'
import { styles } from './styles.ts'
import { HookCard, BlockedRow, statusOf } from './hook-card.tsx'
import { cwdSourceText, eventLabel, eventTitle, skippedText } from './labels.ts'
import { NewHookForm } from './new-hook.tsx'
import { HOOK_TEMPLATES } from './templates.ts'
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
import type { FileView, GroupView, HooksResponse, HooksSnapshot, HookView, RejectedGroupView } from './wire.ts'

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
 * 试运行输出在卡片上最多显示多少字符。
 *
 * 没有上限的话，一个会打印 JSON / 日志的 hook 会把整张卡撑成一大片糊字（模板输出的就是 JSON）。
 * 台账侧有 `MAX_TEXT_CHARS` 截断，而试运行走的是另一条路径 —— 这里必须自己也限一次。
 */
const DRY_TEXT_MAX = 400

/**
 * 试运行结果 → `{ shown, full }`。
 *
 * `shown` 是卡片上那一行（超长就截断并留标记），`full` 只有被截断时才非空（给「查看全文」）。
 * 两件事一起算：各写一遍 stderr-or-stdout 的取值，迟早漂移成"摘要是 stderr、展开是 stdout"。
 *
 * **不猜**（§3.8）：`exitCode === null`（子进程没起来）与"非零退出"是两件事，各自说清；
 * `deny`/`block` 单独点名。输出优先显示 stderr（钩子通常把原因写在 stderr）。
 */
function dryRunText(run: DryRunView): { shown: string; full: string } {
  const outcome =
    run.exitCode === null
      ? '启动失败（子进程没起来）'
      : run.decision === 'deny' || run.decision === 'block'
        ? `已阻断（exit ${String(run.exitCode)}）`
        : run.exitCode === 0
          ? '通过（exit 0）'
          : `失败（exit ${String(run.exitCode)}）`
  const text = run.stderr.trim() === '' ? run.stdout.trim() : run.stderr.trim()
  const truncated = text.length > DRY_TEXT_MAX
  const body = truncated ? `${text.slice(0, DRY_TEXT_MAX)}…（已截断 ${String(text.length - DRY_TEXT_MAX)} 字符）` : text
  return {
    shown: `试运行：${outcome} · ${String(run.durationMs)}ms${body === '' ? '' : ` · ${body}`}`,
    full: truncated ? text : '',
  }
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
  const where = scopeWhere(snapshot, scope)
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
 * 「另一个来源」那一行的引导句 —— **只在目标作用域 ≠ 当前作用域时出现**。
 *
 * 否则就是"自己指自己"（真机截图里选中用户级，底部却写"要编辑请把作用域切到「用户（全局）」"）
 * —— 那种话会让用户以为页面坏了。
 *
 * v3 起这条规则由 `wantSwitchTo`（值比较）统一执行，不再按"来源 kind 对 kind"推：
 * 底部摘要 / 空状态引导条 / 非当前工作区那一行的动作**共用**它，三处不会各有一套口径。
 */
function wantSwitchTo(snapshot: HooksSnapshot, target: ScopeValue): boolean {
  return target !== echoedScopeOf(snapshot)
}

/** 那一份的名字（用户看得懂的那种）：`用户级（全局）` / `项目级`。 */
function fileKindLabel(kind: 'project' | 'user'): string {
  return kind === 'user' ? '用户级（全局）' : '项目级'
}

/** 选中作用域里"主文件"（要编辑的那份）：用户级作用域 → 用户文件；工作区作用域 → 项目文件。 */
function primaryFileOf(snapshot: HooksSnapshot): FileView | undefined {
  const wanted = snapshot.scope.kind === 'user' ? 'user' : 'project'
  return snapshot.files.find((file) => file.kind === wanted) ?? snapshot.files[0]
}

/**
 * 一个作用域对应的那份文件。
 *
 * ⚠️ 用它取**版本**（乐观锁的页面侧），不要用 `primaryFileOf`：后者按**宿主回显**的作用域取，
 * 而写请求要用的版本必须是"我要写的那一份"的版本 —— 两者在"宿主把 current 归一成 user"这类
 * 情况下会不一致，取错就等于拿 A 的版本去锁 B。
 */
function fileOfScope(snapshot: HooksSnapshot, scope: ScopeValue): FileView | undefined {
  const wanted = scope === 'user' ? 'user' : 'project'
  return snapshot.files.find((file) => file.kind === wanted)
}

/** 一份文件里已停用的条数（口径与宿主一致：`hookCount` 不含 disabled）。 */
function disabledCountOf(file: FileView): number {
  let disabled = 0
  for (const view of file.events) disabled += view.disabledCount
  return disabled
}

/**
 * 屏幕上是哪一份（用户看得懂的名字）：工作区标题 / 「当前会话的项目」/ 用户级。
 *
 * 一处推导、多处使用（提醒句、诊断），避免"同一个东西在两个地方叫两个名字"。
 */
function scopeWhere(snapshot: HooksSnapshot, fallback: ScopeValue): string {
  const { scope: view } = snapshot
  if (view.kind === 'user') return '用户（全局）'
  if (view.workspaceId === null && view.workspacePath === null) return '当前会话的项目'
  return view.workspaceTitle ?? view.workspaceId ?? fallback
}

/**
 * 写成功之后要不要说一句、说什么（v6）。
 *
 * 判据只有一条：**落点是不是本会话在读的那一份**。
 *   - 用户级作用域 ⇒ 不说话：用户级配置对每个项目都生效（包括本会话），没有"不读"这件事；
 *   - 工作区作用域且 `isCurrentSession === true` ⇒ 不说话：它就是本会话这一份；
 *   - `isCurrentSession === null`（会话上下文拿不到）⇒ 也**不说话**：不知道就不编造结论（§2.8）；
 *   - `isCurrentSession === false` ⇒ 说一句，并且说清**改动作用到哪里**（而不是只说"不是这一份"）。
 *
 * 这句话是"页面不撒谎"的最后一道：没有它，用户在别的工作区里改完会以为当前会话已经生效。
 */
function noteAfterWrite(phase: Phase, fallback: ScopeValue): string {
  if (phase.kind !== 'ready') return ''
  const { scope: view } = phase.snapshot
  if (view.kind !== 'workspace' || view.isCurrentSession !== false) return ''
  const where = scopeWhere(phase.snapshot, fallback)
  // 一句话、一个句号：前半句说"写成功了"，后半句说"它不影响本会话"（自检断言句数 ≤ 2）。
  return `已写入 ${where} —— 本会话不读这份配置，改动只影响以后在 ${where} 里打开的会话。`
}

/**
 * 「本会话生效 X 个」这一句**要不要出现**。
 *
 * 只在它和屏幕上这一份**不是同一件事**时才说话：选中当前会话项目时，第二行的 `N 个 hook`
 * 已经就是答案（再说一遍 = 用户反馈的"同一条信息说五遍"）。会话未知时必须出现 ——
 * 那时候它说的是"我不知道"，不是"没有"（§2.8/§2.9）。
 */
function sessionLineNeeded(snapshot: HooksSnapshot): boolean {
  if (snapshot.session === null) return true
  return snapshot.scope.isCurrentSession !== true
}

/**
 * 空状态块要说的两件事 + 一条**引导**。
 *
 * `guide` 是这一屏最关键的一条路：页面默认落在**用户（全局）**，而真机上用户级文件根本不存在
 * （`~/.dsh/hooks.json` 没建过），于是用户第一眼看到的是一个空页面 —— 而真正有内容的是
 * "当前会话项目"。没有这条引导，他只能看到"这个作用域还没有 hook"然后自己猜。
 */
interface EmptyBlock {
  /** 文件不存在 / 文件在但 0 条 —— **两种情形分开说**（§2.9/§3.9：空 ≠ 不存在）。一句话。 */
  body: string
  /**
   * 当前文件路径。**v4 起不再上屏**：它只留在 `新建配置文件` 按钮的 `title` 与 `更多` 折叠里
   * （"这份文件到底在哪"是可查的事实，但不是用户点按钮前必须先读的一行字）。
   */
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
  //   它和底部摘要那条 `wantSwitchTo` 是同一条纪律的两半（同一个判据，不各写一套）。
  if (raw === null || !wantSwitchTo(snapshot, raw.target)) return null
  return raw
}

/** 引导条的原始推导（不判"自己指自己"，那条在 `emptyGuideOf` 里统一处理）。 */
function rawEmptyGuideOf(snapshot: HooksSnapshot): { text: string; action: string; target: ScopeValue } | null {
  if (snapshot.scope.kind === 'user') {
    const session = snapshot.session
    if (session === null || session.fromProject <= 0) return null
    return {
      text: `当前会话项目（${lastSegment(session.projectRoot)}）里有 ${String(session.fromProject)} 个 hook。`,
      action: '切换过去',
      target: currentScopeTarget(snapshot),
    }
  }
  const userFile = snapshot.files.find((file) => file.kind === 'user')
  if (userFile === undefined || userFile.state !== 'ok' || userFile.hookCount <= 0) return null
  return {
    text: `用户级（全局）里有 ${String(userFile.hookCount)} 个 hook。`,
    action: '切换过去',
    target: 'user',
  }
}

/** 空状态的文案（两种情形分开说；第三种"读不出来"**绝不**冒充"空的"）。 */
function emptyBlockOf(snapshot: HooksSnapshot, file: FileView): EmptyBlock {
  const absent = file.state === 'absent'
  return {
    // v4：**一句**。v3 那两句各带一个括号解释（"(这是"空的"，不是出错)"），用户读完不知道先点哪个。
    body: absent ? '这份 hooks.json 还不存在 —— 这是空的，不是出错。' : '文件里还没有任何 hook。',
    path: file.path,
    canCreateFile: absent,
    guide: emptyGuideOf(snapshot),
  }
}

/**
 * 空状态块：标题 + **一句**副文案 + **一行**按钮（主按钮 ＋ 新建第一条 hook；仅文件不存在时的
 * 次按钮 新建配置文件；有引导时的 ghost 切换过去）。**纯 props、零 hook**（假 React 只支持无 hook 的子组件）。
 *
 * ★ **盘符路径的口径**（v4；写死在注释里，免得下一个人当成泄漏"顺手清理"）：
 *   盘符路径只允许出现在**一处** —— `更多` 折叠（开发者排查用）。v3 里空状态块也算一处，
 *   现在不算了：它不再渲染成一行字，只进 `新建配置文件` 按钮的 `title`。
 *   正文其它地方（工具条 / 点击行 / 信息行 / 另一来源那一行 / 卡片 / 折叠事件行 / 表单）
 *   **一律不许出现**。D 区有断言守着"正常态与空状态的首屏可见文本都不含盘符路径"。
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
            // 路径进 title（v4 起它不再单独占一行）：想手动建文件的人在这里能拿到它。
            <button
              type="button"
              className="dsh-hooks__btn dsh-hooks__btn--ghost"
              title={`新建配置文件（${block.path}）`}
              disabled={busy}
              onClick={props.onCreateFile}
            >
              新建配置文件
            </button>
          ) : null}
          {/* 引导动作与主按钮**同一行**（v3 是单独一行"引导条"）：`title` 里给证据（哪个作用域有几个）。
              ⚠️ 它刻意带 `__guidebtn` 类：v3 那句证据文字是**可见的一行**、断言按文字找它；
              v4 起它只进 `title`，所以断言改按类名找这个按钮（否则"证据有没有丢"就没法机器验证了）。 */}
          {guide === null ? null : (
            <button
              type="button"
              className="dsh-hooks__btn dsh-hooks__btn--ghost dsh-hooks__guidebtn"
              title={guide.text}
              disabled={busy}
              onClick={() => {
                props.onGuide(guide.target)
              }}
            >
              {guide.action}
            </button>
          )}
        </span>
      ) : null}
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
  /** 这一条在**解析后**的组内位置（0 = 第一条）。顺序即执行顺序，上移/下移靠它判断边界。 */
  position: number
  /** 组内条数（同上）。 */
  groupSize: number
  /**
   * 组内各条的**文件下标**（解析后顺序）。
   *
   * 上移/下移要拿**邻居的文件下标**：解析会跳过非 command 条目，所以"相邻"在文件里可能是 0 和 2，
   * 只按 ±1 移动会与文件里的 1 号互换 → 用户点了上移却看不出变化（像按钮坏了）。
   */
  rawIndexes: number[]
}

/** 按事件顺序铺平"有内容的 hook"（主列表用；0 条的事件不进主列表 —— 见文件头的偏离说明）。 */
function cardRows(file: FileView, matches: (hook: HookView, group: GroupView, event: string) => boolean): CardRow[] {
  const rows: CardRow[] = []
  for (const view of file.events) {
    for (const group of view.groups) {
      const rawIndexes = group.hooks.map((one) => one.rawIndex)
      group.hooks.forEach((hook, position) => {
        if (!matches(hook, group, view.event)) return
        rows.push({
          event: view.event,
          groupRawIndex: group.rawIndex,
          matcher: group.matcher,
          matcherProblem: group.matcherOk ? null : (group.matcherProblem ?? 'matcher 非法'),
          hook,
          position,
          groupSize: group.hooks.length,
          rawIndexes,
        })
      })
    }
  }
  return rows
}

/**
 * 就地编辑某一栏时的**不合法原因**（`null` = 合法）。
 *
 * 口径必须与宿主一致：matcher 用共享协议那一份 `matcherDiagnostic`（禁止另写一套），
 * timeout 用"正数秒 / 留空即默认"。就地拦住 → 用户不必保存后才知道自己写错了。
 */
function fieldProblemOf(field: '' | 'matcher' | 'timeout', draft: string): string | null {
  const text = draft.trim()
  if (field === 'matcher') return text === '' ? null : (matcherDiagnostic(text) ?? null)
  if (field === 'timeout') {
    if (text === '') return null
    const value = Number(text)
    return Number.isFinite(value) && value > 0 ? null : '超时必须是正数秒（留空 = 默认）'
  }
  return null
}

/**
 * 回显里"**请求**的是什么作用域"（人话）。
 *
 * 诊断行以前直出 `requested=current`：机器码上屏，用户读不懂；而这一行恰恰是"为什么我看到的是
 * 这份文件"的关键证据（`current` 在没有会话上下文时会被宿主归一成用户级）。
 */
function requestedScopeText(snapshot: HooksSnapshot): string {
  switch (snapshot.scope.requested) {
    case 'user':
      return '用户级'
    case 'current':
      return '当前会话的项目'
    default:
      return snapshot.scope.workspaceTitle ?? snapshot.scope.workspaceId ?? '某个工作区'
  }
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
  /** 底部折叠区 `更多`（7 个事件 + 诊断）：**默认收起**（见文件头）。 */
  const [moreOpen, setMoreOpen] = useState(false)
  /**
   * 哪一条 hook 的 `⋯` 展开着（键与 `editingKey` 同一个 `rowKey`）。
   *
   * ⚠️ 进入编辑 / 删除确认时**必须同时把它打开**：那两件事的按钮都在块里（保存 / 确认删除），
   * 菜单收着的话用户点完"编辑"会找不到"保存"。
   */
  const [menuKey, setMenuKey] = useState('')
  /**
   * 菜单里正在改**哪一栏**（`''` = 没在改）。
   *
   * 匹配范围与超时以前只能看（"看得见改不了"里最大的一块）。它们和"改命令"是**两种编辑**：
   * 改命令改的是 hook 节点上的 `command`，而这两栏一个是 group 节点、一个是 hook 节点的
   * `timeout` —— 混成一个状态会让「保存」不知道该发哪个定点操作。
   *
   * ⚠️ 新增状态一律**追加在末尾**（假 React 按 hook 位置发值，插到中间会让后面所有状态错位）。
   */
  const [menuField, setMenuField] = useState<'' | 'matcher' | 'timeout'>('')
  /** 那一栏的草稿（与改命令的 `draft` 分开，互不污染）。 */
  const [menuDraft, setMenuDraft] = useState('')
  /**
   * 新建表单的落点：`''` = 新开一组；否则是**已有组的文件下标**（字符串形式）。
   *
   * 常见形态是"同一个匹配范围下挂多条命令"，以前只能新开一组（文件越用越碎）。
   */
  const [newGroup, setNewGroup] = useState('')
  /** 试运行输出的**全文**（只有被截断时才非空；给「查看全文」用）。 */
  const [dryFull, setDryFull] = useState('')
  /**
   * **写成功之后**那一句（v6：非当前工作区不再常驻提示，只在这里说一次）。
   *
   * 空串 = 没有任何要说的话。设置点是**唯一的**：`runRequest` 成功回调里用 `noteAfterWrite()` 判定；
   * 清空点有两处 —— 下一次写请求开始时、以及切换作用域时（旧落点的那句话对新落点没有意义）。
   *
   * ⚠️ 追加在**末尾**：假 React 按 hook 位置发值，插到中间会让后面所有状态错位（§4.6）。
   */
  const [notice, setNotice] = useState('')

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
   * 乐观锁的**页面侧**：屏幕上这一份文件的版本。
   *
   * 返回 `undefined`（= **不带**这个字段）与 `null`（= "我以为它不存在"）是**两件事**：
   *   - `null` 只在文件确实不存在（`state === 'absent'`）时给 —— 宿主据此要求"目标必须不存在"；
   *   - 文件存在但 provider 没给版本时给 `undefined` → 宿主走"读后写"，拿不到版本它会回 `no-version`。
   * 以前把这两种情形都写成 `?? null`：于是"文件存在但没有版本"会被当成"它不存在"，每次保存都变成
   * 一条 `stale`，页面还会一直劝用户"刷新后再改"（刷新也永远不会好）。
   */
  const versionOfScope = (target: ScopeValue): string | null | undefined => {
    if (phase.kind !== 'ready') return undefined
    const file = fileOfScope(phase.snapshot, target)
    if (file === undefined) return undefined
    if (file.state === 'absent') return null
    return file.version ?? undefined
  }

  /**
   * 所有写请求的唯一入口。
   *
   * - 请求体一律由 `intentFor(displayScope, op)` 产出（选中工作区时**一定**带 `workspaceId`，§2.2）；
   * - `sessionId` 走 query（宿主据此解析调用会话的 cwd 与沙箱策略）；
   * - `channel` **一次选定**：`page` = 页面级提示行，`form` = 表单内 —— §3.7 要求
   *   "一条错误只允许一个渲染点"，绝不两条都写；
   * - 成功后 `nonce + 1` 重新取数（绝不自己在本地猜新状态：那会和宿主的答案漂移）。
   */
  /**
   * 一次请求的**时间预算**（15 票）。
   *
   * 读请求本来就有预算，写请求与试运行却没有 —— 而 `busy` 是**整页共享**的：宿主一旦不回应，
   * 每个控件都会永久禁用，用户只能刷新整个页面。这里把它补齐：超时即中止，`busy` 随之释放。
   */
  const withBudget = async <T,>(run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
    try {
      return await run(controller.signal)
    } finally {
      clearTimeout(timer)
    }
  }

  const runRequest = (op: WriteOp, channel: 'page' | 'form', onSuccess: () => void): void => {
    if (busy) return
    setBusy(true)
    setNotice('')
    if (channel === 'page') setBanner(null)
    else setFormError(null)
    void (async () => {
      const outcome = await withBudget((signal) =>
        requestWrite(intentFor(displayScope, op, versionOfScope(displayScope)), sessionId, signal),
      )
      if (outcome.ok) {
        // 落点不是本会话在读的那一份 ⇒ 这次改动对本会话**没有效果**，必须说一句（否则页面在撒谎）
        setNotice(noteAfterWrite(phase, displayScope))
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

  /**
   * 行内操作：失败进**页面级**通道（§3.7）。
   *
   * 成功之后把 `⋯` 也收起来：写盘的结果由重新取数后的快照显示，留着菜单只会让人以为还有待办。
   */
  const runWrite = (op: WriteOp): void => {
    runRequest(op, 'page', () => {
      setEditingKey('')
      setConfirmKey('')
      setMenuKey('')
      setMenuField('')
      setMenuDraft('')
    })
  }

  /**
   * 打开菜单里某一栏的就地编辑（预填当前值）。
   *
   * 同时清掉"改命令"与"删除确认"：同一时刻只允许一件事在编辑态，否则"保存"该发哪个
   * 定点操作就是猜的（而这正是"改错东西"的来源）。
   */
  /**
   * 就地编辑的目标：能跑的卡片给整行，跑不了的组只给 `event + groupRawIndex`（它没有 hook）。
   *
   * 一个入口两种行 —— 否则"改匹配范围"要为被拒组再写一份（两份必然漂移）。
   */
  type FieldTarget = { event: string; groupRawIndex: number; hook?: HookView; matcher: string | null }

  const startField = (key: string, field: 'matcher' | 'timeout', row: FieldTarget): void => {
    setMenuKey(key)
    setEditingKey('')
    setConfirmKey('')
    setMenuField(field)
    setMenuDraft(
      field === 'matcher'
        ? (row.matcher ?? '')
        : row.hook?.timeoutSec === null || row.hook === undefined
          ? ''
          : String(row.hook.timeoutSec),
    )
  }

  /** 保存菜单里那一栏。matcher 的合法性用**共享协议那一份**判定（禁止另写一套）。 */
  const saveField = (row: FieldTarget): void => {
    if (menuField === 'matcher') {
      const text = menuDraft.trim()
      if (matcherDiagnostic(text === '' ? undefined : text) !== undefined) return
      runWrite({
        op: 'setGroupMatcher',
        event: row.event,
        groupIndex: row.groupRawIndex,
        matcher: text === '' ? null : text,
      })
      return
    }
    if (menuField !== 'timeout' || row.hook === undefined) return
    const text = menuDraft.trim()
    if (text === '') {
      runWrite({
        op: 'setHookTimeout',
        event: row.event,
        groupIndex: row.groupRawIndex,
        hookIndex: row.hook.rawIndex,
        timeoutSec: null,
      })
      return
    }
    const value = Number(text)
    // 走到这里的值一定合法：保存按钮在 `fieldProblem !== null` 时就是禁用的（就地校验在那里）。
    // 这里只留一条防御性返回 —— 不为不可达的状态再造一条用户可见的报错通道。
    if (!Number.isFinite(value) || value <= 0) return
    runWrite({
      op: 'setHookTimeout',
      event: row.event,
      groupIndex: row.groupRawIndex,
      hookIndex: row.hook.rawIndex,
      timeoutSec: value,
    })
  }

  /**
   * 上移 / 下移一条（顺序即执行顺序）。
   *
   * 目标位置用**邻居的文件下标**（`rawIndexes`）：解析会跳过非 command 条目，所以页面上相邻的
   * 两条在文件里可能隔着一条。只发 `direction` 就会与文件里的"下一条"互换 —— 用户点了没变化。
   */
  const moveRow = (row: CardRow, step: -1 | 1): void => {
    const target = row.rawIndexes[row.position + step]
    if (target === undefined) return
    runWrite({
      op: 'moveHook',
      event: row.event,
      groupIndex: row.groupRawIndex,
      hookIndex: row.hook.rawIndex,
      direction: step,
      toIndex: target,
    })
  }

  /** 切作用域：**必须**清掉行内编辑 / 确认 / 试运行态（否则旧文件的行下标会打到新文件上）。 */
  const changeScope = (next: ScopeValue): void => {
    setScopeOpen(false)
    if (next === scope) return
    setScope(next)
    setNotice('')
    setEditingKey('')
    setDraft('')
    setConfirmKey('')
    setDryKey('')
    setDryText('')
    setDryFull('')
    setMenuKey('')
    setMenuField('')
    setMenuDraft('')
    setNewGroup('')
    setFormError(null)
    setNewOpen(false)
  }

  /**
   * 套一条模板：**只填四个字段**，不提交、不写盘（用户还能看完再改）。
   *
   * 模板内容来自 `templates.ts`（与 P 区的真子进程断言同一份），这里不重复写命令字面量。
   */
  const applyTemplate = (id: string): void => {
    const template = HOOK_TEMPLATES.find((one) => one.id === id)
    if (template === undefined) return
    setNewEvent(template.event)
    setNewMatcher(template.matcher)
    setNewCommand(template.command)
    setNewTimeout(template.timeout)
    // 模板换了事件 ⇒ 可选的"已有组"整批换掉，旧下标必须清掉（否则会追加到别的事件的那一组上）。
    setNewGroup('')
    setFormError(null)
  }

  const dryRun = (kind: string, event: string, groupRawIndex: number, hook: HookView): void => {
    if (busy) return
    setBusy(true)
    setBanner(null)
    void (async () => {
      // 试运行**不是写操作**：不碰文件、不进台账（§3.8），但寻址同样必须定点到作用域。
      const outcome = await withBudget((signal) =>
        requestDryRun(
          dryRunFor(displayScope, { event, groupIndex: groupRawIndex, hookIndex: hook.rawIndex }),
          sessionId,
          signal,
        ),
      )
      if (outcome.ok && outcome.run !== undefined) {
        const text = dryRunText(outcome.run)
        setDryKey(rowKey(kind, event, groupRawIndex, hook.rawIndex))
        setDryText(text.shown)
        setDryFull(text.full)
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
      // 有落点就**追加到已有组**（`addHook`），否则新开一组（`addGroup`）—— 两条 op 各司其职，
      // 不在宿主侧猜"要不要合并"（那是猜，猜错就是改错文件）。
      newGroup === ''
        ? { op: 'addGroup', event: newEvent, matcher: newMatcher, command: newCommand, timeoutSec }
        : { op: 'addHook', event: newEvent, groupIndex: Number(newGroup), command: newCommand, timeoutSec },
      'form',
      () => {
        setNewOpen(false)
        setNewCommand('')
        setNewMatcher('')
        setNewTimeout('')
        setNewGroup('')
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
        <div className="dsh-hooks__alert dsh-hooks__alert--error" role="alert">
          {sentenceFor(phase.code)}
        </div>
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
  /**
   * 搜索匹配"**页面上的字**"（16 票）。
   *
   * 以前只匹配命令 / 匹配范围 / **英文**事件枚举 —— 而页面主文案是中文事件名与状态词，
   * 于是搜"工具运行前"、"已停用"、"失败"全是 0 结果（用户会以为 hook 没了）。
   */
  const matches = (hook: HookView, group: GroupView, event: string): boolean => {
    if (needle === '') return true
    const haystack = [
      hook.command,
      group.matcher ?? '',
      event,
      eventLabel(event),
      statusOf(hook).label,
      hook.disabled ? '已停用' : '',
    ]
      .join('\n')
      .toLowerCase()
    return haystack.includes(needle)
  }
  const options = scopeOptions(snapshot)
  const rows = primary === undefined ? [] : cardRows(primary, matches)
  const fileTotal = primary === undefined ? 0 : primary.hookCount
  const disabledTotal = primary === undefined ? 0 : disabledCountOf(primary)
  const shown = rows.length
  /**
   * 文件里跑不了的那些组（06 票）：**主列表里每一条都要有归属**。
   *
   * 它们不进 `rows`（那是"会运行的东西"），但也不许消失 —— 每一条渲染成一行灰化的
   * 「不会运行」，原因写在正文里。搜索时按同一套字面过滤（事件名 / 匹配范围）。
   */
  const blocked: RejectedGroupView[] =
    primary === undefined
      ? []
      : primary.rejected.filter(
          (row) =>
            needle === '' ||
            row.event.toLowerCase().includes(needle) ||
            eventLabel(row.event).toLowerCase().includes(needle) ||
            (row.matcher ?? '').toLowerCase().includes(needle) ||
            '不会运行'.includes(needle),
        )
  /** 文件里跑不了的**条数**（口径由宿主给：被跳过的 handler + 被拒的组）。 */
  const unrunnableTotal = primary === undefined ? 0 : primary.unrunnable
  /** 文件里**真实**条目数 = 能跑的（含停用）+ 跑不了的。 */
  const fileRealTotal = fileTotal + unrunnableTotal
  /** 新建表单的"已有组"选项（按当前选中的事件取；没有组时这一栏不出现）。 */
  const newFormGroups =
    primary === undefined
      ? []
      : (primary.events.find((view) => view.event === newEvent)?.groups ?? []).map((group) => ({
          rawIndex: group.rawIndex,
          matcher: group.matcher,
        }))
  /**
   * 生效（合并）视图的数据（13 票）：用户级在前、项目级在后，**顺序即执行顺序**。
   *
   * 这份数据一直躺在快照里（`events` + `fromUser` / `fromProject`），但页面一个字段都没渲染过 ——
   * 于是"实际会跑什么、什么顺序、来自哪一份"这个最核心的问题在页面上无法回答。
   */
  const effectiveRows = snapshot.events
    .filter((view) => view.groups.length > 0)
    .map((view) => ({
      event: view.event,
      groups: view.groups.map((group) => ({
        file: group.file,
        matcher: group.matcher,
        hookCount: group.hooks.length,
      })),
    }))
  let effectiveTotal = 0
  let effectiveUser = 0
  let effectiveProject = 0
  for (const view of snapshot.events) {
    effectiveTotal += view.hookCount
    effectiveUser += view.fromUser
    effectiveProject += view.fromProject
  }
  /**
   * 搜索框**只在真的有东西可筛时**出现（`fileTotal >= 5`）：1 条 hook 的页面上它是纯噪音。
   *
   * ⚠️ `|| needle !== ''` 那半条是**不能省**的：筛选词还在时把搜索框收掉，用户会看到
   * "没有匹配的 hook"却**没有任何控件能清掉筛选** —— 那是真正的死胡同（文件从 5 条掉到 4 条
   * 就会发生：删掉一条之后重新取数）。所以"要收"和"已经筛上了"是两件事。
   */
  const showSearch = fileTotal >= 5 || needle !== ''
  /** 第二行那句人话：总条数（含已停用）+ 停用数 + 筛选口径 —— `钩子 N` / `已安装 N` 两个 chip 都删了。 */
  const countText = needle === '' ? `${String(fileTotal)} 个 hook` : `匹配 ${String(shown)} / 共 ${String(fileTotal)}`
  const disabledText = disabledTotal === 0 ? '' : ` · 其中 ${String(disabledTotal)} 个已停用`
  // 跑不了的条数**分开说**：以前它们既不在卡片里、也不在任何一句话里，用户只能得出
  // "文件里没有这些"（而他明明在文件里看见了）。
  const unrunnableText = unrunnableTotal === 0 ? '' : ` · 另有 ${String(unrunnableTotal)} 条跑不了`
  const metaText = `${countText}${disabledText}${unrunnableText}`
  // 触发器 label / 勾选位置 / 说明文字全部按**回显**（`displayScope`），不按本地 state：
  // 否则同屏会出现"触发器说用户级、数据是项目级"（AGENTS §2.6）。
  const displayLabel = echoedLabelOf(snapshot)
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === displayScope),
  )
  const help = scopeHelp(snapshot, displayScope)

  // ── 页面级提示**最多一条**（Fix A2）：页面错误 > 配置文件读不出来 > **写成功后那一句** > 只读。
  //    v6：非当前工作区不再**常驻**占用这条通道 —— 它只在写入成功后出现（见 `noteAfterWrite`）。
  const brokenFile = snapshot.files.find((file) => file.state === 'error')
  const alert: {
    tone: 'error' | 'info'
    text: string
    detail: string
    action: { label: string; onClick: () => void } | null
  } | null =
    banner !== null
      ? // 技术原文只作**补充**（§3.9：绝不作为主文案，但排查要用得上）
        { tone: 'error', text: writeErrorSentence(banner.code), detail: banner.detail, action: null }
      : brokenFile !== undefined || snapshot.staleInUse
        ? {
            tone: 'error',
            text: '有配置文件现在读不出来（内容不是合法 JSON）—— 运行中的 hook 仍在沿用上一份可用配置。',
            detail: brokenFile?.message ?? '',
            action: null,
          }
        : notice !== ''
          ? // 写成功了、但落点不是本会话在读的那一份（v6）：**只在动手之后**说这一句
            { tone: 'info', text: notice, detail: '', action: null }
          : writable
            ? null
            : { tone: 'info', text: '本页当前是只读模式（宿主没有提供写入能力）。', detail: '', action: null }

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

      {/* ── 工具条**只有一行**：左边作用域、右边 刷新/新建；搜索框只在 fileTotal >= 5 时出现 ── */}
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
        <span className="dsh-hooks__spacer" />
        {showSearch ? (
          <input
            className="dsh-hooks__search"
            type="search"
            value={query}
            placeholder="搜索 hook…"
            onChange={(changeEvent) => {
              setQuery(changeEvent.target.value)
            }}
          />
        ) : null}
        <span className="dsh-hooks__toolbarActions">
          {/* v7：折叠入口从正文最后一行挪到工具条（正文那一行整条消失）。
              仍是**唯一**开关：正文里不会再有第二个「更多」。图标是页面既有的折叠语汇
              （`▸` 收起 / `▾` 展开），名字走 `title` + `aria-label` —— 读屏拿到的是名字，
              不是那个字形；`aria-expanded` 照旧如实反映状态（按钮不许骗人）。
              放在动作簇最左，右邻仍是 刷新 / 新建（主操作留在右端，不被这枚图标挤走）。 */}
          <button
            type="button"
            className="dsh-hooks__disclosure"
            title="更多"
            aria-label="更多（生效配置 / 全部事件 / 诊断）"
            aria-expanded={moreOpen}
            onClick={() => {
              setMoreOpen(!moreOpen)
            }}
          >
            {moreOpen ? '▾' : '▸'}
          </button>
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
          {/* F5：这个按钮是 **toggle** —— 表单开着的时候点它是"收起"，文案就必须写「收起」，
              并带 `aria-expanded`（不然"文案说新建、动作是收起"就是骗人）。 */}
          <button
            type="button"
            className="dsh-hooks__toolbtn"
            title={newOpen ? '收起' : '新建'}
            aria-expanded={newOpen}
            disabled={busy || !writable}
            onClick={() => {
              setNewOpen(!newOpen)
              setFormError(null)
            }}
          >
            {newOpen ? '收起' : '＋ 新建'}
          </button>
        </span>
      </div>

      {/* ── 「更多」展开后的那块内容：生效配置 + 7 个事件（含 0 条）+ 诊断。
          v7：入口是工具条右端那个 `▸`（见上），内容就贴在工具条下面 —— 点了之后必须**就在眼前**，
          不能落在页面尾巴上（展开后还要滚一段才看见，等于按钮没生效）。仍然是**一个**折叠，
          仍然守"不占屏 ≠ 看不见"：收起时这一块整块都不渲染。 */}
      {moreOpen ? (
        <div className="dsh-hooks__foldbody">
          {/* ① 生效配置（13 票）：用户级 + 项目级按**执行顺序**排开 —— 这是"实际会跑什么"的答案，
              数据一直在快照里（`events`），只是以前一个字段都没渲染。 */}
          <div className="dsh-hooks__foldhead">生效配置</div>
          <div className="dsh-hooks__effectrow">
            <span className="dsh-hooks__eventname dsh-hooks__eventname--fold">将运行</span>
            <span className="dsh-hooks__count">
              {`${String(effectiveTotal)} 条（用户级 ${String(effectiveUser)} + 项目级 ${String(
                effectiveProject,
              )}）${snapshot.session === null ? ' —— 当前会话未知，这不代表实际会跑什么' : ''}`}
            </span>
          </div>
          {effectiveRows.length === 0 ? (
            <div className="dsh-hooks__effectrow">
              <span className="dsh-hooks__eventname dsh-hooks__eventname--fold">—</span>
              <span className="dsh-hooks__muted">这一份作用域里没有任何会运行的 hook</span>
            </div>
          ) : (
            effectiveRows.map((row) =>
              row.groups.map((group, index) => (
                <div className="dsh-hooks__effectrow" key={`${row.event}-${String(index)}`}>
                  <span className="dsh-hooks__eventname dsh-hooks__eventname--fold" title={eventTitle(row.event)}>
                    {/* 顺序即执行顺序：序号就是它在事件里的执行位次（用户级在前、项目级在后）。 */}
                    {`${String(index + 1)}. ${eventLabel(row.event)}`}
                  </span>
                  <span className="dsh-hooks__count">
                    {`${group.file === 'user' ? '用户级' : group.file === 'project' ? '项目级' : '来源未知'} · ${
                      group.matcher === null ? '匹配全部' : `匹配 ${group.matcher}`
                    } · ${String(group.hookCount)} 条`}
                  </span>
                </div>
              )),
            )
          )}

          {/* ② 全部事件：**7 个永远都在这里**（含 0 条）——"空"没有变得不可达（见文件头的偏离说明） */}
          <div className="dsh-hooks__foldhead">全部事件</div>
          {eventRows.map(({ event, file }) => (
            <div className="dsh-hooks__eventrow" key={event}>
              <span className="dsh-hooks__eventname dsh-hooks__eventname--fold" title={eventTitle(event)}>
                {eventLabel(event)}
                <span className="dsh-hooks__eventid">{event}</span>
              </span>
              {file === undefined || file.groups.length === 0 ? (
                <span className="dsh-hooks__muted">
                  没有配置
                  {file !== undefined && file.runCount > 0 ? `（但历史上跑过 ${String(file.runCount)} 次）` : ''}
                </span>
              ) : (
                <span className="dsh-hooks__count">
                  {String(file.hookCount)} 个
                  {file.disabledCount > 0 ? `（另有 ${String(file.disabledCount)} 个已停用）` : ''}
                </span>
              )}
              {writable ? (
                // 空事件行右侧是 **`＋` 字形按钮**（过去是六个「＋新建」文字按钮 = 用户说的"噪音"）。
                // 它仍然是一个真按钮：`title` / `aria-label` 说清"在哪个事件下新建"，键盘能 Tab 到。
                <button
                  type="button"
                  className="dsh-hooks__btn dsh-hooks__btn--ghost dsh-hooks__glyphbtn"
                  title={`在 ${event} 下新建`}
                  aria-label={`在 ${eventLabel(event)}（${event}）下新建`}
                  disabled={busy}
                  onClick={() => {
                    setNewEvent(event)
                    setNewOpen(true)
                    setFormError(null)
                  }}
                >
                  ＋
                </button>
              ) : null}
            </div>
          ))}

          {/* ③ 诊断：所有"开发者要看的"东西都收在这里。**值一律人话**（内部字段名只作补充）。 */}
          <div className="dsh-hooks__foldhead">诊断</div>
          <DiagRow label="作用域" value={help} />
          <DiagRow label="当前会话" value={sessionLine(snapshot)} />
          <DiagRow label="项目根" value={snapshot.projectRoot ?? '未知（没有会话上下文，不编造）'} />
          <DiagRow label="工作目录来源" value={cwdSourceText(snapshot.cwdSource)} />
          <DiagRow label="写入权限" value="按调用会话的沙箱策略判定；被拒绝时报 sandbox" />
          <DiagRow label="状态记录" value="只记录本次进程内的真实执行；重启后回到「未运行」" />
          <DiagRow
            label="作用域回显"
            value={`请求的是「${requestedScopeText(snapshot)}」，实际给的是「${scopeWhere(
              snapshot,
              displayScope,
            )}」${snapshot.scope.isCurrentSession === null ? '（当前会话未知，无法判断是不是它）' : ''}`}
          />
          {primary === undefined ? null : (
            <DiagRow
              label="当前文件"
              value={`${primary.path} · ${stateToken(primary)} · 版本 ${String(primary.version)} · ${String(
                primary.hookCount,
              )} 个${primary.unrunnable > 0 ? `（另有 ${String(primary.unrunnable)} 条跑不了）` : ''}`}
            />
          )}
          {others.map((file) => (
            <DiagRow
              key={file.kind}
              label={file.kind === 'user' ? '用户级文件' : '项目级文件'}
              value={`${file.path} · ${stateToken(file)} · 版本 ${String(file.version)} · ${String(file.hookCount)} 个`}
            />
          ))}
          {snapshot.scope.workspacePath !== null && snapshot.scope.workspacePath !== snapshot.scope.projectRoot ? (
            <DiagRow
              label="工作区路径"
              value={`${snapshot.scope.workspacePath}（≠ 项目根，配置落在项目根的 .dsh/hooks.json）`}
            />
          ) : null}
          <DiagRow
            label="沿用旧配置"
            value={snapshot.staleInUse ? '是（磁盘此刻读不出来，运行的是上一份可用配置）' : '否'}
          />
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
              label="匹配范围诊断"
              value={primary.matcherErrors.length === 0 ? '无' : primary.matcherErrors.join('；')}
            />
          )}
          {primary === undefined ? null : <DiagRow label="跑不了的条目" value={skippedText(primary.skipped)} />}
          {banner === null ? null : <DiagRow label="错误详情" value={`${banner.code} ${banner.detail}`} />}
        </div>
      ) : null}

      {/* ── 第二行：**一句人话**（次要色）。同一个条数不再在五个地方各说一遍；
             「本会话生效 X 个」只在它和屏幕上这一份不是同一件事时才出现（选中当前会话项目时，
             上面那句 `N 个 hook` 就是答案）。完整口径（用户级 a + 项目级 b）在诊断折叠里。

             ⚠️ 这里**不显示文件路径**：盘符路径只允许出现在「空状态块」与「诊断折叠」两处
             （D40 守着这条边界）。把绝对路径摆在首屏就是把内部信息丢给用户 —— 那正是本轮
             要治的病；"我到底在改哪个文件"的答案在诊断折叠与空状态块里，不在这里。 ── */}
      <div className="dsh-hooks__metaline">
        <span className="dsh-hooks__filecount">{metaText}</span>
        <span className="dsh-hooks__spacer" />
        {sessionLineNeeded(snapshot) ? (
          <span className="dsh-hooks__session" title="当前会话实际会跑的那一份（与所选作用域无关）">
            {sessionShortLine(snapshot)}
          </span>
        ) : null}
      </div>

      {/* 唯一的提示行（§2.1 / §2.9 / §3.9 的话都在这里，不再堆叠）。
          信息类（`--info`，没有黄底）现在只剩两种：**写成功但落点不是本会话那一份** 与 **只读**。
          v6：前者**不再常驻** —— 不选它、不改它，页面上一个字都不会多。 */}
      {alert === null ? null : (
        // `role="alert"`：读取失败 / 保存失败 / 非当前工作区这些**异步**结论要能被读屏播报
        // （17 票：以前它们只出现在视觉上）。
        <div className={`dsh-hooks__alert dsh-hooks__alert--${alert.tone}`} role="alert">
          <span className="dsh-hooks__alerttext">
            {alert.text}
            {alert.detail === '' ? null : <span className="dsh-hooks__muted">（{alert.detail}）</span>}
          </span>
          {alert.action === null ? null : (
            <button
              type="button"
              className="dsh-hooks__btn dsh-hooks__btn--ghost"
              title={alert.action.label}
              disabled={busy}
              onClick={alert.action.onClick}
            >
              {alert.action.label}
            </button>
          )}
        </div>
      )}

      {/* 新建表单（错误只渲染在表单内部，§3.7） */}
      {newOpen ? (
        <NewHookForm
          draft={{ event: newEvent, matcher: newMatcher, command: newCommand, timeout: newTimeout }}
          groups={newFormGroups}
          target={newGroup}
          onTarget={setNewGroup}
          error={formError === null ? null : writeErrorSentence(formError.code)}
          errorDetail={formError === null ? '' : formError.detail}
          busy={busy}
          writable={writable}
          onTemplate={applyTemplate}
          onEvent={(value) => {
            // 换事件 ⇒ 可选的"已有组"整批换掉（旧下标不再指向同一组）。
            setNewEvent(value)
            setNewGroup('')
          }}
          onMatcher={setNewMatcher}
          onCommand={setNewCommand}
          onTimeout={setNewTimeout}
          onSubmit={submitNew}
          onCancel={() => {
            setNewOpen(false)
            setFormError(null)
            setNewGroup('')
          }}
        />
      ) : null}

      {/* ── 主列表：一张卡 = 一条 hook；0 条的事件不在这里（收进下面的折叠） ──
          主列表为空时有四种情形，**分别**说清（"空"与"读不出来"绝不许混，§2.9/§3.9）：
          ① 搜索没命中 → "没有匹配的 hook"；② 文件不存在 → 空状态块（附"新建配置文件"）；
          ③ 文件在但 0 条 → 空状态块；④ 文件读不出来 → 如实说"无法判断"，**不冒充空的**。 */}
      {needle !== '' && rows.length === 0 && blocked.length === 0 ? (
        <div className="dsh-hooks__muted">没有匹配的 hook</div>
      ) : rows.length === 0 && primary !== undefined && primary.state === 'error' ? (
        <div className="dsh-hooks__muted">文件读不出来，无法判断里面有没有 hook（见上面的提示）。</div>
      ) : rows.length === 0 && blocked.length === 0 && primary !== undefined ? (
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
      ) : rows.length === 0 && blocked.length === 0 ? (
        <div className="dsh-hooks__muted">这个作用域没有可编辑的文件。</div>
      ) : (
        <div className="dsh-hooks__list">
          {rows.map((row) => {
            const kind = primary === undefined ? 'project' : primary.kind
            const key = rowKey(kind, row.event, row.groupRawIndex, row.hook.rawIndex)
            /** 整组删除的确认键（与单条删除共用同一个 `confirmKey`，靠前缀区分）。 */
            const groupKey = `group|${key}`
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
                menuOpen={menuKey === key || editingKey === key || confirmKey === key || confirmKey === groupKey}
                dryText={dryKey === key ? dryText : ''}
                dryFull={dryKey === key ? dryFull : ''}
                menu={{
                  field: menuKey === key ? menuField : '',
                  draft: menuDraft,
                  problem: fieldProblemOf(menuKey === key ? menuField : '', menuDraft),
                  canMoveUp: row.position > 0,
                  canMoveDown: row.position < row.groupSize - 1,
                  confirmingGroup: confirmKey === groupKey,
                }}
                onField={(field) => {
                  startField(key, field, row)
                }}
                onFieldDraft={setMenuDraft}
                onSaveField={() => {
                  saveField(row)
                }}
                onCancelField={() => {
                  setMenuField('')
                  setMenuDraft('')
                }}
                onMoveUp={() => {
                  moveRow(row, -1)
                }}
                onMoveDown={() => {
                  moveRow(row, 1)
                }}
                onAskRemoveGroup={() => {
                  setConfirmKey(groupKey)
                  setEditingKey('')
                  setMenuField('')
                }}
                onRemoveGroup={() => {
                  runWrite({ op: 'removeGroup', event: row.event, groupIndex: row.groupRawIndex })
                }}
                onCancelRemoveGroup={() => {
                  setConfirmKey('')
                  setMenuKey('')
                }}
                onToggle={() => {
                  runWrite({
                    op: 'setHookDisabled',
                    event: row.event,
                    groupIndex: row.groupRawIndex,
                    hookIndex: row.hook.rawIndex,
                    disabled: !row.hook.disabled,
                  })
                }}
                onToggleMenu={() => {
                  // 收起 `⋯` = 放弃这一条上正在进行的事（编辑草稿 / 删除确认）。
                  // 不这样做的话：编辑中 `menuOpen` 被 `editingKey` 强制撑开，点 `⋯` 什么都不会发生，
                  // 而按钮上的 `aria-expanded` 还是 true —— 那就是按钮在骗人。
                  if (menuKey === key) {
                    setMenuKey('')
                    setEditingKey('')
                    setConfirmKey('')
                    setDraft('')
                    return
                  }
                  setMenuKey(key)
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
                  setMenuKey('')
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
                  setMenuKey('')
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
          {/* 跑不了的组：**紧跟能跑的卡片之后**，一行一条，带原因、不带试运行。
              全部跑不了时这里也会有一条汇总句（否则用户只看到几行灰字，不知道该干什么）。 */}
          {blocked.length === 0 ? null : (
            <div className="dsh-hooks__muted">
              {rows.length === 0
                ? `文件里有 ${String(fileRealTotal)} 条，其中 ${String(unrunnableTotal)} 条跑不了 —— 它们不会运行。`
                : `还有 ${String(unrunnableTotal)} 条跑不了（灰化的那几行）。`}
            </div>
          )}
          {blocked.map((row) => {
            const key = `blocked|${row.event}|${String(row.groupIndex)}`
            const target: FieldTarget = { event: row.event, groupRawIndex: row.groupIndex, matcher: row.matcher }
            return (
              <BlockedRow
                key={key}
                row={row}
                writable={writable}
                busy={busy}
                menuOpen={menuKey === key}
                field={menuKey === key ? menuField : ''}
                fieldDraft={menuDraft}
                fieldProblem={fieldProblemOf(menuKey === key ? menuField : '', menuDraft)}
                onToggleMenu={() => {
                  setMenuKey(menuKey === key ? '' : key)
                  setMenuField('')
                  setMenuDraft('')
                }}
                onField={(field) => {
                  startField(key, field, target)
                }}
                onFieldDraft={setMenuDraft}
                onSaveField={() => {
                  saveField(target)
                }}
                onCancelField={() => {
                  setMenuField('')
                  setMenuDraft('')
                }}
              />
            )
          })}
        </div>
      )}

      {/* 另一个来源：**只在"有东西"时出现**的一行摘要（不再渲染第二张完整卡、也不再为空行占位）。
          正文里**没有任何盘符路径**（路径 / 状态 / 版本都在诊断折叠里）—— 用户反馈里那行
          `用户级（全局） · C:\... · 0 条 · 文件不存在，要编辑请把作用域切到…` 同时犯了三个错：
          为空还占一行、暴露绝对路径、教用户用界面。
          动作只在该来源**不是**屏幕上这一份时出现（`wantSwitchTo`：目标 ≠ 当前作用域）。 */}
      {others
        .filter((file) => file.hookCount > 0 || file.state === 'error')
        .map((file) => {
          const name = fileKindLabel(file.kind)
          const target: ScopeValue = file.kind === 'user' ? 'user' : currentScopeTarget(snapshot)
          const switchable = wantSwitchTo(snapshot, target)
          return (
            <div className="dsh-hooks__other" key={file.kind}>
              {file.state === 'error' ? (
                <span className="dsh-hooks__muted">{name}这份配置读不出来（详情见「更多」）</span>
              ) : (
                <Fragment>
                  <span className="dsh-hooks__muted">
                    {name}还有 {String(file.hookCount)} 个 hook
                  </span>
                  {switchable ? (
                    <button
                      type="button"
                      className="dsh-hooks__btn dsh-hooks__btn--ghost"
                      title={`切到${name}`}
                      disabled={busy}
                      onClick={() => {
                        changeScope(target)
                      }}
                    >
                      切过去
                    </button>
                  ) : null}
                </Fragment>
              )}
            </div>
          )
        })}
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
 * 「当前会话实际会跑什么」的**完整口径**（AGENTS §2.6 + 三态）—— 只进诊断折叠。
 *
 * `session === null` 时**必须**说"不知道"：读不到会话上下文 ≠ 没有 hook（§2.8/§2.9）。
 * 显示"当前会话生效 0 条"就是把"不知道"说成"没有"，那正是本仓库最危险的那条失效路径。
 *
 * v3：主视图不再用它，改成下面那句短的（`（用户级 a + 项目级 b）` 是"同一条信息说五遍"的一半，
 * 移到诊断里）。**三态语义一字不改**，只是换了渲染点。
 */
function sessionLine(snapshot: HooksSnapshot): string {
  const session = snapshot.session
  if (session === null) return '当前会话未知，无法判断实际会跑什么'
  const counts = `${String(session.hookCount)} 个（用户级 ${String(session.fromUser)} + 项目级 ${String(
    session.fromProject,
  )}）`
  return session.staleInUse ? `当前会话生效 ${counts} · 正在沿用上一份可用配置` : `当前会话生效 ${counts}`
}

/**
 * 第二行那句短的：「本会话生效 X 个」。
 *
 * **只在 `sessionLineNeeded` 为真时渲染**（作用域 ≠ 当前会话项目 / 会话未知）。
 * 三态照旧：`session === null` ⇒ 说"不知道"，**绝不**说成 0 个。
 */
function sessionShortLine(snapshot: HooksSnapshot): string {
  const session = snapshot.session
  if (session === null) return '当前会话未知，无法判断实际会跑什么'
  return `本会话生效 ${String(session.hookCount)} 个`
}

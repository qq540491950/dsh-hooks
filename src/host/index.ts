/**
 * dsh-hooks —— 项目级 hooks（DSH Host 半边）
 *
 * ## 目标
 * 让每个项目都能带自己的 hooks 配置，放在 DSH 已经承认的项目级目录里：
 *
 *     <projectRoot>/.dsh/hooks.json      ← 项目级（projectRoot = 最近含 .git 的祖先，否则 cwd）
 *     $DSH_HOME/hooks.json               ← 用户级（对所有项目生效）
 *
 * 配置格式为通用的 `hooks` 结构（`{"hooks": {...}}` 或裸事件映射）：事件名与
 * matcher/command/timeout 的语义沿行业标准，配置文件天然可读、可迁移。
 *
 * ## 为什么不能用 DSH 自带的那两个 hooks 兼容桥
 * 它们的 `configPath` 都是**进程级单值、启动读一次**。桌面 GUI 只有一个 Host 进程服务
 * 所有 session，`process.cwd()` 固定 —— 所以它们无法表达"每个项目各自的配置"。
 * 本插件在每个 session 首次触发时按会话 header 的 cwd 解析配置，并按 projectRoot
 * 缓存 + 三条失效通道热重载，多个项目可以同时各用各的。
 *
 * ## 失效的三层通道（按优先级）
 *   1. **版本核对**（主通道）：每次事件点读两个文件的 `stat().version`；没变就复用缓存
 *      （连 TTL 都不必等），变了就立刻重读（下一事件点生效）。
 *   2. **watcher**（加速器）：事件到达立即丢缓存，不等任何核对。
 *   3. **TTL**（兜底）：provider 不返回 `version` / `stat` 抛错时，退回"到期允许重读"。
 *      任何一条通道静默失效，最坏也只是延迟 {@link POSITIVE_TTL_MS} 生效，而不是"必须重启"。
 *
 * ## 三态读取（「读不到」≠「没有」，v0.2.1 修的 fail-open）
 * `readJsonFile()` 区分 `absent`（ENOENT，合法的空配置）/ `ok` / `error`（读到了但坏了）。
 * `error` 时**继续沿用最近一次成功解析的配置** —— 修之前它被折叠成"没有配置"，于是
 * hooks.json 写坏一个字符就让全部 hook（含 deny 守卫）静默消失。
 *
 * ## 零 import 纪律（重要）
 * 本文件由 Loader 以 `file:///...` 绝对路径加载，**裸模块说明符解析不到**
 * （`@deepseek-ai/*` 都藏在 app.asar 里）。所以这里只 import **相对路径**的 shared 模块
 * （打包器会内联进单文件），以及使用 Loader 注入的 Service。产物 `lib/index.js` 里
 * `import` 与 `require` 计数都必须是 0。
 *
 * ## hook 的权限（为什么必须透传 sandboxPolicy）
 * `ctx.shell` 的默认语义是"低层调用者回退到**部署**策略"，而部署策略的 `workspaceRoot`
 * 是宿主启动目录，不是会话的项目目录 —— 于是任何"落盘类" hook（格式化 / 自动修复 /
 * 写日志）都会**静默**失效。修法：取**调用会话**的策略并透传，与服务缺失时省略该字段
 * 回退部署策略（绝不因为拿不到策略就让 hook 跑不起来）。
 */

import {
  CONTEXT_SOURCE,
  DEFAULT_TIMEOUT_MS,
  HOOK_EVENTS,
  HOOKS_FILE,
  INVALIDATE_LOG_INTERVAL_MS,
  MAX_PROJECT_DEPTH,
  NEGATIVE_TTL_MS,
  POSITIVE_TTL_MS,
  PROJECT_DIR,
  STOP_FORCE_LIMIT,
  SUBAGENT_TYPE,
  type HookEvent,
} from '../shared/constants.ts'
import { isObject, isUnknownArray, messageOf } from '../shared/guards.ts'
import type { HostErrorCode } from '../shared/errors.ts'
import {
  blocksToText,
  contextMessage,
  joinPath,
  matchesMatcher,
  mergeHookGroups,
  mergeHookOutputs,
  newMessageId,
  parentOf,
  parseHookConfig,
  parseHookOutput,
} from '../shared/protocol.ts'
import type {
  HookOutput,
  HookPayload,
  InjectionMessage,
  MergedOutput,
  ParsedGroups,
  ParsedHook,
} from '../shared/types.ts'
import type {
  AgentLike,
  FsTarget,
  HostContext,
  OpaqueSandboxPolicy,
  ShellRunRequest,
  SubagentInfo,
  ToolExecution,
  WorkspaceRecord,
  WorkspaceService,
} from './service-types.ts'
import {
  ScopeError,
  registerHooksRoute,
  type DryRunOutcome,
  type DryRunRequest,
  type HooksInspection,
  type ScopeTarget,
  type SessionEffectView,
  type SourceInspection,
  type ScopeView,
  type WorkspaceItemView,
} from './data-plane.ts'
// 写路径的纯函数区：定点操作、风格、保留性证明、请求体校验（业务语义只有这一份）。
import {
  DEFAULT_STYLE,
  applyOp,
  detectStyle,
  preservationProblem,
  serialize,
  starterText,
  type HooksRequest,
} from './write.ts'
import { ExecutionLedger } from './ledger.ts'

/** 插件名。 */
export const name = 'dsh-hooks'
/**
 * 硬依赖：shell 跑 hook，fs 读配置 + 监听。
 * 两者在 desktop profile 均已挂载（shell 由 dsh-pwsh-sandbox 注册，fs 由 dsh-fs-sandbox 注册）。
 */
export const inject = ['shell', 'fs']

/** 一个 projectRoot 的合并配置。 */
interface ResolvedConfig {
  /** 合并后的生效配置（用户级在前、项目级在后）。 */
  groups: ParsedGroups
  /**
   * **参与合并**的用户级 / 项目级两份。
   *
   * 为什么要留：`groups` 是合并结果，而页面还要回答"用户级贡献几条、项目级贡献几条"。
   * 那两个数字**必须**取自这里，不能另外新鲜读一遍 —— stale（沿用上一份可用配置）时新鲜读
   * 解析出的是空 groups，于是"生效 5 条（用户级 0 + 项目级 0）"会与 stale 横幅自相矛盾。
   * 留在这里也顺带消掉了重复解析。
   */
  userGroups: ParsedGroups
  projectGroups: ParsedGroups
  projectPath: string
  userPath: string
}

/** 版本快照：每项是 version 字符串，`undefined` = 文件不存在。 */
interface VersionSnapshot {
  user: string | undefined
  project: string | undefined
}

/** 一次读取的三态结果。 */
type ReadState =
  | { path: string; state: 'absent'; target: FsTarget | undefined; version: string | null | undefined }
  | {
      path: string
      state: 'ok'
      target: FsTarget | undefined
      raw: Record<string, unknown>
      /** 原文件的**原始文本**（写路径要用它探测缩进/行尾/结尾换行）。 */
      text: string
      version: string | null | undefined
    }
  | { path: string; state: 'error'; target: FsTarget | undefined; message: string; version: string | null | undefined }

/** 缓存条目的可变状态（与 promise 分开，避免"先有 promise 后有 entry"的初始化绕路）。 */
interface CacheState {
  settled: boolean
  expiresAt: number
  versions: VersionSnapshot | undefined
  hasHooks: boolean
  /**
   * 当前生效的这份配置是不是**上一次成功读取**的兜底（磁盘此刻读不出来）。
   *
   * 记在缓存上而不是每次重新推断：数据面要如实告诉页面"你看到的 hooks 现在仍在跑，
   * 但文件本身已经坏了" —— 这正是 AGENTS §3.9 要求分别说清的情形之一。
   */
  stale: boolean
}

/** 缓存条目。 */
interface CacheEntry {
  state: CacheState
  promise: Promise<ResolvedConfig>
}

/** 校验过的会话沙箱策略。 */
interface ResolvedPolicy {
  /**
   * **服务给回来的那个对象本身**（不重建、不裁剪）。
   *
   * 为什么必须是原对象：本插件不解释策略内容，只负责把它交给 `shell.resolve`。重建会
   * ① 丢掉 provider 将来新增的字段；② 凭空补出 `sessionId: undefined` 这个键，而
   * `assert.deepStrictEqual`（自检的 3c 区）区分"键存在但为 undefined"与"没有这个键"——
   * 第一版重建实现就是被这条断言抓住的。
   */
  readonly passthrough: OpaqueSandboxPolicy
  /** 只用于日志标签（已校验是字符串）。 */
  readonly mode: string
}

/** 一次事件点的上下文。 */
interface RunContext {
  cwd: string
  projectRoot: string
  config: ResolvedConfig
  sandboxPolicy: ResolvedPolicy | undefined
}

/** 文件确实不存在吗？（编辑器原子保存的窗口里也会出现这个形状，不代表配置损坏） */
function isMissingFile(message: string): boolean {
  return /ENOENT|not found|no such file/i.test(message)
}

/** `$DSH_HOME`：环境变量优先，退化到 HOME/USERPROFILE + `.dsh`。属于宿主层（用 process.env）。 */
function dshHome(): string {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.length > 0) return configured
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  return home !== '' ? joinPath(home, PROJECT_DIR) : PROJECT_DIR
}

/**
 * 插件入口。
 *
 * 设计要点：
 * - **按 projectRoot 缓存配置**，命中后每次工具调用只是 Map 查表加两次 `stat`。
 * - **所有监听器全程 try/catch，失败一律 delegate 给 next()**，绝不让 hook 拖垮工具调用。
 * - **detached 运行**（SessionStart / Subagent*）被跟踪，dispose 时 abort + drain。
 */
export function apply(ctx: HostContext): void {
  const fsSvc = ctx.fs
  const shell = ctx.shell
  const log = ctx.logger

  /** projectRoot -> 配置缓存 */
  const projectCache = new Map<string, CacheEntry>()
  /** cwd -> projectRoot */
  const rootCache = new Map<string, string>()
  /** 已经挂上 watcher 的路径 */
  const watched = new Set<string>()
  /** 已经就"这条路径没挂上监听"告警过的路径，避免缓存周期刷屏 */
  const watchWarned = new Set<string>()
  /** 失效日志的限流时间戳：path -> lastLoggedAt */
  const invalidateLoggedAt = new Map<string, number>()
  /** projectRoot -> 上一次打日志的"事件集合"签名 */
  const loadedSignature = new Map<string, string>()
  /**
   * projectRoot -> 最近一次**成功**读取到的原始配置对象。
   *
   * 存在的唯一理由：`error`（读到了但解析/IO 失败）**不允许**被当成"没有配置"。
   * 没有它的话，hooks.json 写坏一个字符会让全部 hook（含 deny 守卫）静默消失，
   * 而且文件一直是坏的就一直消失 —— 这是本插件最危险的一条失效路径。
   */
  const lastGood = new Map<string, { userRaw: unknown; projectRaw: unknown; at: number }>()
  /** `projectRoot\0path` -> 上一次已经告警过的错误文本 */
  const lastErrorText = new Map<string, string>()
  /** watcher 的 close 函数 */
  const watchers: Array<() => Promise<void>> = []
  /** detached 运行的 promise */
  const detached = new Set<Promise<unknown>>()
  /** sessionId -> Stop hook 连续强制续跑次数 */
  const stopForced = new Map<string, number>()
  /** runId -> 子 agent */
  const subagentChildren = new Map<string, AgentLike>()
  /**
   * 有界执行台账（§2.11）：**状态色的唯一证据来源**（§3.8）。
   * 全局 500 条 / 单会话 200 条；stdout/stderr 在进台账之前就截断。
   */
  const ledger = new ExecutionLedger()

  const watcherAbort = new AbortController()
  let disposed = false

  ctx.effect(
    () => () => {
      disposed = true
      ledger.clear()
      watcherAbort.abort(new Error('dsh-hooks disposed'))
      for (const close of watchers) {
        try {
          void close().catch(() => undefined)
        } catch {
          /* 关闭失败不影响卸载 */
        }
      }
      watchers.length = 0
      return Promise.allSettled([...detached])
    },
    'dsh-hooks: 释放 watcher 与 detached 运行',
  )

  /** 不抛的日志包装：日志本身出问题也不能影响 agent。 */
  function warn(message: string): void {
    try {
      if (log !== undefined && typeof log.warn === 'function') log.warn(message)
    } catch {
      /* ignore */
    }
  }
  function info(message: string): void {
    try {
      if (log !== undefined && typeof log.info === 'function') log.info(message)
    } catch {
      /* ignore */
    }
  }

  /** 限流的 info：同一个 key 在 {@link INVALIDATE_LOG_INTERVAL_MS} 内只打一条。 */
  function infoThrottled(key: string, message: string): void {
    const now = Date.now()
    const last = invalidateLoggedAt.get(key)
    if (last !== undefined && now - last < INVALIDATE_LOG_INTERVAL_MS) return
    invalidateLoggedAt.set(key, now)
    info(message)
  }

  /** 跟踪一个 detached 运行。 */
  function track(run: Promise<unknown>): void {
    detached.add(run)
    const settle = (): void => {
      detached.delete(run)
    }
    void run.then(settle, settle)
  }

  /** 目标路径是否存在（任何类型都算存在，`.git` 在 worktree 里是文件）。 */
  async function exists(path: string): Promise<boolean> {
    try {
      const target = await fsSvc.resolve(path)
      const stat = await fsSvc.stat(target)
      return stat !== undefined
    } catch {
      return false
    }
  }

  /**
   * 读一个 JSON 配置文件的**三态**结果。
   *
   *   absent  文件不存在 → 合法的"这份配置是空的"
   *   ok      读到了且解析成功
   *   error   读到了但解析/IO 失败 → **绝不许当成空配置**
   *
   * 永不抛。见文件头的「三态读取」。
   */
  async function readJsonFile(path: string, signal?: AbortSignal): Promise<ReadState> {
    let target: FsTarget
    let version: string | null | undefined
    try {
      target = await fsSvc.resolve(path)
      const stat = await fsSvc.stat(target, signal)
      if (stat === undefined || stat.type !== 'file') return { path, state: 'absent', target, version: undefined }
      // 契约里 `version` 是字符串（或 null/undefined）；不再多套一层 String()：
      // 真要有 provider 违约给出非字符串，最坏也只是缓存键对不上 → 多读一次，不会出错。
      version = stat.version === undefined || stat.version === null ? undefined : stat.version
    } catch (error) {
      const message = messageOf(error)
      return isMissingFile(message)
        ? { path, state: 'absent', target: undefined, version: undefined }
        : { path, state: 'error', target: undefined, message, version: undefined }
    }

    let text: string
    try {
      text = await fsSvc.readText(target, signal)
    } catch (error) {
      const message = messageOf(error)
      // 读的瞬间文件被删掉：按"不存在"处理，不当成损坏。
      return isMissingFile(message)
        ? { path, state: 'absent', target, version }
        : { path, state: 'error', target, message, version }
    }

    // Windows PowerShell 的 `Set-Content -Encoding utf8` 会写出带 BOM 的文件，而 JSON.parse
    // 遇到 BOM 会直接抛。剥掉它，否则手写的 hooks.json 会被静默当成"没有配置"。
    let parsed: unknown
    try {
      parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
    } catch (error) {
      return { path, state: 'error', target, message: messageOf(error), version }
    }
    // 顶层不是对象（`42` / `"text"` / `[...]` / `null`）同样是"读到了但不是合法配置"：
    // 当成"没有配置"的话，用户把文件改成数组也会静默停掉全部 hook。
    if (!isObject(parsed)) {
      return { path, state: 'error', target, message: '顶层不是 JSON 对象', version }
    }
    return { path, state: 'ok', target, raw: parsed, text, version }
  }

  /** 从 cwd 向上找最近的含 .git 的目录；找不到返回 cwd 本身。 */
  async function findProjectRoot(cwd: string): Promise<string> {
    let start = cwd
    try {
      const target = await fsSvc.resolve(cwd)
      start = target.displayPath
    } catch {
      return cwd
    }
    let node = start
    for (let i = 0; i < MAX_PROJECT_DEPTH; i++) {
      if (await exists(joinPath(node, '.git'))) return node
      const parent = parentOf(node)
      if (parent === undefined || parent === node) break
      node = parent
    }
    return start
  }

  /** cwd -> projectRoot（带缓存，避免每次工具调用都走 fs）。 */
  async function projectRootFor(cwd: string): Promise<string> {
    const key = cwd === '' ? '' : cwd
    const hit = rootCache.get(key)
    if (hit !== undefined) return hit
    const root = await findProjectRoot(key)
    rootCache.set(key, root)
    return root
  }

  /**
   * 给一个路径挂监听（幂等、尽力而为）。
   *
   * 可诊断性约定：`ctx.fs` 没有 `watch()` 时**不再静默早退**，而是按 path 打一条 warn；
   * 挂载成功打一条 info（带 path 与 stat 出来的类型）；失效回调打一条限流 info。
   * 这样"没挂上"和"挂了但没事件"在日志里可区分。
   */
  async function ensureWatch(path: string, invalidate: () => void): Promise<void> {
    if (disposed || watched.has(path)) return
    if (typeof fsSvc.watch !== 'function') {
      if (!watchWarned.has(path)) {
        watchWarned.add(path)
        warn(
          `dsh-hooks: ctx.fs 不提供 watch()，无法监听 ${path} —— ` +
            `热重载退化为 ${POSITIVE_TTL_MS / 1000}s 正向 TTL 兜底（改配置最坏延迟这么多秒生效）`,
        )
      }
      return
    }
    watched.add(path)
    try {
      const target = await fsSvc.resolve(path)
      const stat = await fsSvc.stat(target)
      const kind =
        stat === undefined
          ? '尚不存在（等待创建）'
          : stat.type === 'directory'
            ? '目录'
            : stat.type === 'file'
              ? '文件'
              : `其他类型 ${String(stat.type)}`
      const close = await fsSvc.watch(
        target,
        (error) => {
          if (error !== undefined) warn(`dsh-hooks: 监听 ${path} 出错：${String(error)}`)
          infoThrottled(path, `dsh-hooks: 监听到变化 → 失效配置缓存（${path}）`)
          invalidate()
        },
        watcherAbort.signal,
      )
      watchers.push(close)
      watchWarned.delete(path)
      info(`dsh-hooks: 已监听 ${path}（判定为${kind}）`)
    } catch (error) {
      // 路径尚不存在（还没建 .dsh / hooks.json）时这里会失败，属于预期；靠 TTL 兜底。
      // 同一路径只告警一次：正结果会按 TTL 周期重试，不能每个周期刷一条。
      watched.delete(path)
      if (!watchWarned.has(path)) {
        watchWarned.add(path)
        warn(`dsh-hooks: 无法监听 ${path}：${messageOf(error)}`)
      }
    }
  }

  /**
   * 读两个配置文件当前的**内容版本**（`ctx.fs.stat()` 的 `version`）。
   *
   * 真实 `ctx.fs` 的 `FsInfo.version` 形如 `dev:ino:size:mtimeNs:ctimeNs`，比 `readText`
   * 便宜得多，所以它适合当**失效主通道**：内容没变就不必重读。
   *
   * @returns 版本快照；provider 不返回 version / stat 抛错时返回 `undefined`（= 无法核对）。
   */
  async function readVersions(projectRoot: string): Promise<VersionSnapshot | undefined> {
    const probe = async (path: string): Promise<{ known: boolean; version: string | undefined }> => {
      try {
        const target = await fsSvc.resolve(path)
        const stat = await fsSvc.stat(target)
        if (stat === undefined || stat.type !== 'file') return { known: true, version: undefined }
        // provider 没有 version：整条版本通道不可用。
        if (stat.version === undefined || stat.version === null) return { known: false, version: undefined }
        return { known: true, version: stat.version }
      } catch (error) {
        // 文件不存在是"版本为空"这种已知状态；其它 IO 错误则无法判定。
        return isMissingFile(messageOf(error))
          ? { known: true, version: undefined }
          : { known: false, version: undefined }
      }
    }
    const [user, project] = await Promise.all([
      probe(joinPath(dshHome(), HOOKS_FILE)),
      probe(joinPath(projectRoot, PROJECT_DIR, HOOKS_FILE)),
    ])
    if (!user.known || !project.known) return undefined
    return { user: user.version, project: project.version }
  }

  /** 两个版本快照是否完全一致（快照缺失一律视为"不一致"）。 */
  function sameVersions(previous: VersionSnapshot | undefined, next: VersionSnapshot): boolean {
    return previous !== undefined && previous.user === next.user && previous.project === next.project
  }

  /** 加载一个 projectRoot 的合并配置（缓存命中检查 → 版本核对 → 真正读）。 */
  function configFor(projectRoot: string): Promise<ResolvedConfig> {
    const cached = projectCache.get(projectRoot)
    // 已经有并发加载在飞：直接共享它。
    if (cached !== undefined && !cached.state.settled) return cached.promise

    const probe =
      cached === undefined ? Promise.resolve<VersionSnapshot | undefined>(undefined) : readVersions(projectRoot)
    return probe.then((versions) => {
      const current = projectCache.get(projectRoot)
      // 核对期间可能已经有另一个调用建了"在飞"的条目：共享它，别重复读。
      if (current !== undefined && !current.state.settled) return current.promise
      if (current !== undefined && current.state.settled) {
        // 主通道：两次快照完全一致 → 内容没变，直接用（并顺延 TTL）。
        if (versions !== undefined && sameVersions(current.state.versions, versions)) {
          current.state.expiresAt = Date.now() + (current.state.hasHooks ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS)
          return current.promise
        }
        // 兜底通道：拿不到版本 → 原来的 TTL 语义（未到期就复用）。
        if (versions === undefined && Date.now() < current.state.expiresAt) return current.promise
      }
      // 版本变了 / 过期了 / 首次加载：真正读一次。
      projectCache.delete(projectRoot)
      return loadConfig(projectRoot)
    })
  }

  /** 真正读+解析一次配置（缓存未命中时走这里）。 */
  function loadConfig(projectRoot: string): Promise<ResolvedConfig> {
    const userPath = joinPath(dshHome(), HOOKS_FILE)
    const projectPath = joinPath(projectRoot, PROJECT_DIR, HOOKS_FILE)
    const state: CacheState = {
      settled: false,
      expiresAt: Number.POSITIVE_INFINITY,
      versions: undefined,
      hasHooks: false,
      stale: false,
    }

    const promise = (async (): Promise<ResolvedConfig> => {
      const [userRead, projectRead] = await Promise.all([readJsonFile(userPath), readJsonFile(projectPath)])

      // ── fail-open 修复点 ────────────────────────────────────────────────
      // 任一侧"读到了但坏了"都**不等于**"没有配置"：有最近一次成功的结果就继续用它。
      const failures: Array<Extract<ReadState, { state: 'error' }>> = []
      if (userRead.state === 'error') failures.push(userRead)
      if (projectRead.state === 'error') failures.push(projectRead)
      for (const failure of failures) {
        const key = `${projectRoot}\u0000${failure.path}`
        // 同一条错误只 warn 一次；错误内容变了（换了一处笔误）再 warn 一次。
        if (lastErrorText.get(key) !== failure.message) {
          lastErrorText.set(key, failure.message)
          warn(`dsh-hooks: 读取 ${failure.path} 失败：${failure.message}`)
        }
      }

      const previous = lastGood.get(projectRoot)
      const pick = (read: ReadState): unknown => (read.state === 'ok' ? read.raw : undefined)
      /**
       * **按侧**回退（11 票）：哪一侧读不出来就只回退那一侧。
       *
       * 以前是"任一侧坏 → 两侧一起回 last-good"，于是"项目文件坏了"会把用户级**刚改好**的内容
       * 一起撤掉 —— 而页面那一侧是新鲜读的（显示的是新内容），页面与运行时就此分叉（§2.6）。
       * 只有"根本不知道哪一侧坏"（`previous === undefined`，即从没成功读过）时才没有回退可言。
       */
      const userStale = userRead.state === 'error' && previous !== undefined
      const projectStale = projectRead.state === 'error' && previous !== undefined
      const stale = userStale || projectStale
      if (stale) {
        const sides = [userStale ? '用户级' : '', projectStale ? '项目级' : ''].filter((one) => one !== '').join(' + ')
        infoThrottled(
          `${projectRoot}\u0000stale`,
          `dsh-hooks: ${sides}配置当前读不出来，继续沿用上一份可用配置（${projectPath}）`,
        )
      }

      /** 记录用的版本字符串；取不到就记 `undefined`（= 文件不存在或无法判定）。 */
      const versionOf = (read: ReadState): string | undefined =>
        read.version === undefined || read.version === null ? undefined : read.version
      // 逐侧决定用哪一份：坏的那一侧取 last-good，另一侧用**刚读到的**（否则改动不生效）。
      const userRaw = userStale ? previous.userRaw : pick(userRead)
      const projectRaw = projectStale ? previous.projectRaw : pick(projectRead)

      const vars = { projectDir: projectRoot }
      const user = parseHookConfig(userRaw, vars)
      const project = parseHookConfig(projectRaw, vars)

      for (const skipped of [...user.skipped, ...project.skipped]) {
        warn(
          skipped.reason === 'empty-command'
            ? `dsh-hooks: 跳过一条没有命令的 command 条目（事件 ${skipped.event}）`
            : `dsh-hooks: 跳过不支持的 ${JSON.stringify(skipped.type)} handler（事件 ${skipped.event}）—— 只运行 command hook`,
        )
      }
      for (const message of [...user.errors, ...project.errors]) warn(`dsh-hooks: ${message}`)

      const groups = mergeHookGroups(user.groups, project.groups)
      const summary = HOOK_EVENTS.filter((event) => groups[event] !== undefined).join(',')
      const hasHooks = summary.length > 0

      if (failures.length === 0) {
        // 只有"两侧都没出错"才算一次有效读取，允许刷新 last-good。
        lastGood.set(projectRoot, { userRaw: pick(userRead), projectRaw: pick(projectRead), at: Date.now() })
        for (const failurePath of [userPath, projectPath]) {
          lastErrorText.delete(`${projectRoot}\u0000${failurePath}`)
        }
      }

      // 只在"事件集合变了"时打日志：正结果会按 TTL 周期性重读，不能每次都刷。
      const signature = `${projectPath}\u0000${summary}`
      if (loadedSignature.get(projectRoot) !== signature) {
        loadedSignature.set(projectRoot, signature)
        const suffix = stale ? '（沿用上一份可用配置）' : ''
        info(`dsh-hooks: ${projectPath} ${hasHooks ? '已加载事件 ' + summary : '无可用 hook'}${suffix}`)
      }
      state.settled = true
      // 读不出来时用最短的负 TTL：错一次就尽快再试，别把坏状态缓存 4 秒。
      state.expiresAt = Date.now() + (failures.length > 0 || !hasHooks ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS)
      // 版本快照**无论成败都记**：坏文件没被改动时，下一个事件点就能靠"版本没变"直接复用
      // 这份 last-good 结果，而不是每次事件点都重读一遍坏文件。
      state.versions = { user: versionOf(userRead), project: versionOf(projectRead) }
      state.hasHooks = hasHooks
      // 记下"这份生效配置是 last-good 兜底"，供数据面如实告诉页面（AGENTS §3.9）。
      state.stale = stale
      return { groups, userGroups: user.groups, projectGroups: project.groups, projectPath, userPath }
    })().catch((error: unknown) => {
      warn(`dsh-hooks: 加载 ${projectRoot} 的 hook 配置失败：${messageOf(error)}`)
      state.settled = true
      state.expiresAt = Date.now() + NEGATIVE_TTL_MS
      // 整体失败时不去猜版本：两个都记 undefined，让"两个文件都不存在"这一种情况仍能复用。
      state.versions = { user: undefined, project: undefined }
      state.hasHooks = false
      // 整体失败时 groups 是空的，谈不上"沿用上一份"。
      state.stale = false
      return { groups: {}, userGroups: {}, projectGroups: {}, projectPath, userPath }
    })

    projectCache.set(projectRoot, { state, promise })

    // 监听器一旦挂上就长期有效（`watched` 去重）：失效只需丢掉缓存。
    track(
      (async () => {
        // 目录先于文件：`.dsh` 目录存在时，`hooks.json` 的创建与修改都能被它捕获。
        await ensureWatch(joinPath(projectRoot, PROJECT_DIR), () => projectCache.delete(projectRoot))
        await ensureWatch(projectPath, () => projectCache.delete(projectRoot))
        // 用户级配置变化影响所有项目，所以这里清掉整张表。
        // 大括号不是风格问题：`() => map.clear()` 会"返回" `void` 表达式，被 no-confusing-void-expression 拦下。
        await ensureWatch(userPath, () => {
          projectCache.clear()
        })
      })(),
    )

    return promise
  }

  /**
   * 取**调用会话**的沙箱策略，用来透传给 hook 子进程。
   *
   * 返回 `undefined` 时调用方**不传**这个字段 → hook 回退到部署策略（修复前的行为）。
   * 这是刻意的降级：拿不到策略只应该让 hook"少点权限"，不该让 hook 跑不起来。
   * 形状不对（缺 mode/workspaceRoot）同样丢弃 —— 宁可回退，也不把畸形策略透传下去。
   */
  function sandboxPolicyFor(agent: AgentLike | undefined): ResolvedPolicy | undefined {
    const sandboxPolicy = ctx.get('sandboxPolicy')
    if (sandboxPolicy === undefined || typeof sandboxPolicy.resolve !== 'function') return undefined
    try {
      const session = agent?.session
      const policy = sandboxPolicy.resolve(session === undefined ? {} : { session })
      if (!isObject(policy) || typeof policy.mode !== 'string' || typeof policy.workspaceRoot !== 'string') {
        return undefined
      }
      return { passthrough: policy, mode: policy.mode }
    } catch (error) {
      warn(`dsh-hooks: 解析沙箱策略失败，本次 hook 回退到部署策略：${messageOf(error)}`)
      return undefined
    }
  }

  /** 解析一次会话的上下文：cwd / projectRoot / 合并配置 / 沙箱策略。 */
  async function contextFor(agent: AgentLike | undefined): Promise<RunContext> {
    const cwd = agent?.session?.header?.cwd ?? process.cwd()
    const projectRoot = await projectRootFor(cwd)
    const config = await configFor(projectRoot)
    return { cwd, projectRoot, config, sandboxPolicy: sandboxPolicyFor(agent) }
  }

  /**
   * 从工具调用里取出调用方 agent。
   *
   * `ToolExecutionInput.agent` 是**可选**字段。即使它缺失，发起调用的 agent 仍可由
   * `ctx.agents.currentInitiator()` 拿到 —— 少了这层兜底，`tools/*` 事件会退化成用
   * `process.cwd()` 解析项目根，而那通常是 app 的启动目录，hook 就会静默失效。
   */
  function agentOf(exec: ToolExecution): AgentLike | undefined {
    if (exec.agent !== undefined) return exec.agent
    const agents = ctx.get('agents')
    if (agents !== undefined && typeof agents.currentInitiator === 'function') {
      try {
        return agents.currentInitiator()
      } catch {
        return undefined
      }
    }
    return undefined
  }

  /**
   * 跑一条 hook 真正需要的上下文（`RunContext` 里只有这三项与执行有关）。
   *
   * 单独抠出来是为了让**试运行**能用同一个函数：它没有"当前事件点的完整配置"，
   * 但完全具备这三项。用 `Pick` 而不是另写一个函数 —— 那就是"演示用执行器"的开端（§2.10）。
   */
  type ExecutionContext = Pick<RunContext, 'cwd' | 'projectRoot' | 'sandboxPolicy'>

  /**
   * 跑**一条** hook。
   *
   * **试运行与真实运行共用这一条路径**（AGENTS §2.10）：只有 `signal` / timeout / 沙箱档位允许不同，
   * payload 必须由同一个 builder 产出。两者唯一的差别在**调用方**：真实运行把结果记进执行台账，
   * 试运行不记（台账是状态色的唯一依据，§3.8；一次试运行不该把那一行画绿）。
   */
  async function runSingleHook(
    hook: ParsedHook,
    point: HookEvent,
    context: ExecutionContext,
    payload: HookPayload,
    signal: AbortSignal | undefined,
  ): Promise<{ output: HookOutput; durationMs: number }> {
    const sandboxPolicy = context.sandboxPolicy
    const started = Date.now()
    const timeoutMs = hook.timeoutSec !== undefined ? hook.timeoutSec * 1000 : DEFAULT_TIMEOUT_MS
    let output: HookOutput
    try {
      const request: ShellRunRequest = {
        command: hook.command,
        workdir: context.cwd,
        timeoutMs,
        stdin: JSON.stringify(payload) + '\n',
        signal,
        env: { DSH_PROJECT_DIR: context.projectRoot },
        // 关键：hook 子进程按**调用会话**的档位与会话 cwd 跑，而不是部署默认档。
        // 拿不到策略时整条字段省略（回退部署策略），绝不让 hook 跑不起来。
        ...(sandboxPolicy !== undefined ? { sandboxPolicy: sandboxPolicy.passthrough } : {}),
      }
      const spec = shell.resolve(request)
      const execution = await shell.execute(spec)
      const result = await execution.result()
      output = parseHookOutput(
        result.exitCode === null || result.exitCode === undefined ? undefined : result.exitCode,
        result.stdout?.text,
        result.stderr?.text,
        point,
      )
    } catch (error) {
      // 起不来 / 崩溃 / 基础设施失败：非阻断，只记。
      output = parseHookOutput(undefined, '', messageOf(error), point)
    }
    return { output, durationMs: Date.now() - started }
  }

  /** 跑一个事件点上所有匹配的 hook（串行，配置顺序），返回折叠后的结果。 */
  async function runPoint(
    context: RunContext,
    point: HookEvent,
    matchQuery: string,
    payload: HookPayload,
    signal: AbortSignal | undefined,
  ): Promise<MergedOutput> {
    const groups = context.config.groups[point] ?? []
    if (groups.length === 0) return mergeHookOutputs([])
    // 调用会话的沙箱策略；undefined = 拿不到，交由 shell 回退到部署策略。
    const sandboxPolicy = context.sandboxPolicy
    const sandboxLabel = sandboxPolicy !== undefined ? sandboxPolicy.mode : 'deployment'
    const outputs: HookOutput[] = []
    for (const group of groups) {
      if (!matchesMatcher(group.matcher, matchQuery)) continue
      for (const hook of group.hooks) {
        // `disabled: true` 在这里**被真正跳过** —— 这是 AGENTS §2.5 的诚实性要求：
        // 开关落在文件里，而本插件的执行路径必须认它，否则"UI 显示已停用、实际照跑"。
        if (hook.disabled === true) continue
        // 试运行与真实运行**共用这一条路径**（§2.10）；差别只在下面的"记台账"这一步。
        const { output, durationMs } = await runSingleHook(hook, point, context, payload, signal)
        // 记台账：这是"这一行现在是什么颜色"的**唯一**依据（§3.8）。记的是实际发生的事实。
        ledger.push({
          at: Date.now() - durationMs,
          sessionId: typeof payload.session_id === 'string' ? payload.session_id : '',
          event: point,
          command: hook.command,
          // 记下这次执行发生在哪个项目根下 —— 状态色的匹配条件是 event + command + projectRoot
          // 三者（§2.3）：少了它，同命令在别的项目跑过就会给这一行上色。
          projectRoot: context.projectRoot,
          exitCode: output.exitCode,
          decision: output.decision ?? 'pass',
          durationMs,
          stdout: output.stdout,
          stderr: output.stderr,
        })
        info(
          `dsh-hooks: [${point}] ${JSON.stringify(hook.command)} exit=${
            output.exitCode === undefined ? 'spawn-failed' : output.exitCode
          } decision=${output.decision ?? 'pass'} sandbox=${sandboxLabel} ${durationMs}ms`,
        )
        outputs.push(output)
      }
    }
    return mergeHookOutputs(outputs)
  }

  //#region payload 构造（对齐官方桥的字段形状）

  function basePayload(agent: AgentLike | undefined, event: HookEvent, context: ExecutionContext): HookPayload {
    return {
      session_id: agent?.session?.header?.id ?? '',
      // DSH 的会话日志是 zstd 压缩的，shell 脚本读不了，这里与官方桥保持一致恒为空串。
      transcript_path: '',
      cwd: context.cwd,
      hook_event_name: event,
    }
  }

  function sessionStartPayload(agent: AgentLike | undefined, source: string, context: RunContext): HookPayload {
    return { ...basePayload(agent, 'SessionStart', context), source }
  }

  function promptPayload(agent: AgentLike | undefined, content: unknown, context: RunContext): HookPayload {
    return { ...basePayload(agent, 'UserPromptSubmit', context), prompt: blocksToText(content) }
  }

  function preToolPayload(exec: ToolExecution, context: RunContext): HookPayload {
    return {
      ...basePayload(exec.agent, 'PreToolUse', context),
      tool_name: exec.name,
      tool_input: exec.arguments,
      tool_use_id: exec.callId,
    }
  }

  function postToolPayload(exec: ToolExecution, result: unknown, context: RunContext): HookPayload {
    const content = isObject(result) ? result.content : undefined
    return {
      ...basePayload(exec.agent, 'PostToolUse', context),
      tool_name: exec.name,
      tool_input: exec.arguments,
      tool_use_id: exec.callId,
      tool_response: blocksToText(content),
    }
  }

  /** Stop 的 payload：`stop_hook_active` 必须反映**真实**的续跑状态（见下面接线处的用法）。 */
  function stopPayload(agent: AgentLike | undefined, context: RunContext, forced: boolean): HookPayload {
    return { ...basePayload(agent, 'Stop', context), stop_hook_active: forced }
  }

  function subagentPayload(
    event: HookEvent,
    info: SubagentInfo,
    child: AgentLike | undefined,
    context: RunContext,
  ): HookPayload {
    return {
      ...basePayload(child, event, context),
      agent_id: info.id,
      agent_type: SUBAGENT_TYPE,
      ...(event === 'SubagentStop' ? { stop_hook_active: false } : {}),
    }
  }

  //#endregion

  //#region 数据面（设置页的只读快照）

  /**
   * 按 `sessionId` 找 agent（找不到退回"当前发起者"），并如实报告来源。**同步**函数：只查内存表。
   *
   * 数据面的读（要 cwd）与写（还要沙箱策略）都从这里出发，所以必须是**同一个**解析。
   */
  function agentForSession(sessionId: string | undefined): {
    agent: AgentLike | undefined
    source: 'session' | 'initiator' | 'none'
  } {
    const agents = ctx.get('agents')
    if (sessionId !== undefined && agents !== undefined && typeof agents.get === 'function') {
      try {
        const agent = agents.get(sessionId)
        const cwd = agent?.session?.header?.cwd
        if (typeof cwd === 'string' && cwd.length > 0) return { agent, source: 'session' }
      } catch {
        /* 拿不到就往下试 */
      }
    }
    if (agents !== undefined && typeof agents.currentInitiator === 'function') {
      try {
        const agent = agents.currentInitiator()
        const cwd = agent?.session?.header?.cwd
        if (typeof cwd === 'string' && cwd.length > 0) return { agent, source: 'initiator' }
      } catch {
        /* 没有就是没有 */
      }
    }
    return { agent: undefined, source: 'none' }
  }

  /**
   * 一次会话上下文的解析结果。
   *
   * `projectRoot` 是**从会话 cwd 解析出来的**项目根 —— 它是"当前会话在哪里"的唯一来源，
   * 绝不拿工作区清单里的某一条来代称（AGENTS §2.8）。
   */
  interface SessionContext {
    cwd: string | null
    cwdSource: 'session' | 'initiator' | 'none'
    projectRoot: string | null
  }

  /** 解析一次会话上下文（拿不到 cwd 就是 null，不编造）。 */
  async function sessionContextFor(sessionId: string | undefined): Promise<SessionContext> {
    const found = agentForSession(sessionId)
    const cwd = found.agent?.session?.header?.cwd
    if (typeof cwd !== 'string' || cwd.length === 0) return { cwd: null, cwdSource: 'none', projectRoot: null }
    return { cwd, cwdSource: found.source, projectRoot: await projectRootFor(cwd) }
  }

  /**
   * 解析后的作用域：`current` 归一成 `user` 或 `workspace` 之一。
   *
   * ⚠️ 这是**编辑**作用域，不是运行时开关：hook 仍然按触发事件的会话 cwd 解析（AGENTS §2.6）。
   */
  interface ResolvedScope {
    kind: 'user' | 'workspace'
    /** 这份 project 文件的项目根；`kind === 'user'` 时是 null（不确定就不编造）。 */
    projectRoot: string | null
    workspace: { id: string; title: string; path: string } | null
    /** 与当前会话的项目根比对的结果；`null` = 当前会话未知。 */
    isCurrentSession: boolean | null
  }

  /** 收窄一条工作区记录（**唯一**一份实现；`service-types.ts` 只声明类型）。 */
  function workspaceRecordOf(value: unknown): WorkspaceRecord | undefined {
    if (!isObject(value)) return undefined
    const { id, path, title } = value
    if (typeof id !== 'string' || id.length === 0) return undefined
    if (typeof path !== 'string' || path.length === 0) return undefined
    return { id, path, ...(typeof title === 'string' && title.length > 0 ? { title } : {}) }
  }

  /**
   * 取工作区服务。**每次请求现取** —— Cordis 的服务是渐进可用的，`apply()` 时刻读属性很可能
   * 拿到 `undefined`（AGENTS §2.12 记的线上事故就是这个形状），于是"没有清单"会变成常态假象。
   */
  function workspaceService(): WorkspaceService | undefined {
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined) return undefined
    // 两个成员都没有 = 它给不了我们任何东西：按"没有清单"处理，不装作可用。
    if (typeof registry.list !== 'function' && typeof registry.get !== 'function') return undefined
    return registry
  }

  /** 工作区清单（`available: false` = **宿主没有清单**，≠ 没有工作区；页面必须分别说清）。 */
  async function workspaceList(): Promise<{ available: boolean; records: WorkspaceRecord[] }> {
    const registry = workspaceService()
    if (registry === undefined || typeof registry.list !== 'function') return { available: false, records: [] }
    let raw: unknown
    try {
      raw = await registry.list()
    } catch (error) {
      warn(`dsh-hooks: 读取工作区清单失败：${messageOf(error)}`)
      return { available: false, records: [] }
    }
    if (!isUnknownArray(raw)) return { available: false, records: [] }
    const records: WorkspaceRecord[] = []
    for (const item of raw) {
      const record = workspaceRecordOf(item)
      if (record !== undefined) records.push(record)
    }
    return { available: true, records }
  }

  /**
   * 按 id 找工作区。
   *
   * `available: false`（宿主没有清单）与 `record: undefined`（清单里没有这个 id，可能被删过）
   * **必须分开**：前者 409 `no-workspace-registry`、后者 404 `unknown-workspace` —— 页面文案不同。
   */
  async function lookupWorkspace(id: string): Promise<{ available: boolean; record: WorkspaceRecord | undefined }> {
    const registry = workspaceService()
    if (registry === undefined) return { available: false, record: undefined }
    if (typeof registry.get === 'function') {
      try {
        const record = workspaceRecordOf(registry.get(id))
        if (record !== undefined) return { available: true, record }
      } catch (error) {
        warn(`dsh-hooks: 查询工作区 ${id} 失败：${messageOf(error)}`)
      }
    }
    if (typeof registry.list === 'function') {
      const listed = await workspaceList()
      if (!listed.available) return { available: false, record: undefined }
      return { available: true, record: listed.records.find((record) => record.id === id) }
    }
    return { available: true, record: undefined }
  }

  /**
   * 解析一次作用域。
   *
   * - `user` → 用户级文件（与项目无关）；
   * - `current` → 会话 cwd 解析出的项目根；**没有会话上下文时归一到 `user`**（与旧行为逐字一致：
   *   只列用户级，绝不编造一个项目路径，AGENTS §2.8）；
   * - `workspace` → 必须能在清单里查到，否则抛 {@link ScopeError}。**绝不回落会话项目**（§2.2）。
   */
  async function resolveScope(session: SessionContext, target: ScopeTarget): Promise<ResolvedScope> {
    if (target.kind === 'user') return { kind: 'user', projectRoot: null, workspace: null, isCurrentSession: null }
    if (target.kind === 'current') {
      if (session.projectRoot === null) {
        return { kind: 'user', projectRoot: null, workspace: null, isCurrentSession: null }
      }
      return { kind: 'workspace', projectRoot: session.projectRoot, workspace: null, isCurrentSession: true }
    }
    const lookup = await lookupWorkspace(target.workspaceId)
    if (!lookup.available) {
      throw new ScopeError(
        'no-workspace-registry',
        '宿主没有提供工作区清单（workspaceRegistry），只能改当前项目和用户级配置',
      )
    }
    if (lookup.record === undefined) {
      throw new ScopeError('unknown-workspace', `工作区 ${target.workspaceId} 不在宿主的清单里（可能被删过）`)
    }
    const path = lookup.record.path
    const projectRoot = await projectRootFor(path)
    return {
      kind: 'workspace',
      projectRoot,
      workspace: { id: lookup.record.id, title: lookup.record.title ?? lookup.record.id, path },
      // 比较的是**项目根**而不是工作区路径：工作区是仓库子目录时也能判对。
      isCurrentSession: session.projectRoot === null ? null : session.projectRoot === projectRoot,
    }
  }

  /** 工作区清单视图（下拉框用）。服务缺失 ⇒ `available: false`（**明说**，不是空下拉）。 */
  async function workspacesFor(session: SessionContext): Promise<{ items: WorkspaceItemView[]; available: boolean }> {
    const listed = await workspaceList()
    if (!listed.available) return { items: [], available: false }
    // 每条都要探测 `.git`（走 projectRootFor 的缓存），所以并行而不是串行。
    const items = await Promise.all(
      listed.records.map(async (record) => {
        const projectRoot = await projectRootFor(record.path)
        return {
          id: record.id,
          title: record.title ?? record.id,
          path: record.path,
          projectRoot,
          isCurrent: session.projectRoot !== null && session.projectRoot === projectRoot,
        }
      }),
    )
    return { items, available: true }
  }

  /** 一份配置的条数口径：启用中 / 已停用 / 分组数（`hookCount` **不含** disabled）。 */
  function countsOf(groups: ParsedGroups): { hookCount: number; disabledCount: number; groupCount: number } {
    let hookCount = 0
    let disabled = 0
    let groupCount = 0
    for (const event of HOOK_EVENTS) {
      for (const group of groups[event] ?? []) {
        groupCount++
        for (const hook of group.hooks) {
          if (hook.disabled === true) disabled++
          else hookCount++
        }
      }
    }
    return { hookCount, disabledCount: disabled, groupCount }
  }

  /**
   * 「当前会话实际会跑的是什么」—— **与所选作用域无关**的那一份（AGENTS §2.6）。
   *
   * 作用域回答的是"我在看/改哪一份文件"，而运行时回答的是"用户级 + 会话自己项目级的合并"。
   * 两个问题不是同一个，所以答案也不能复用：页面必须能**同时**说清这两件事。
   *
   * **三态**（AGENTS §2.8/§2.9）：当前会话的项目根拿不到就返回 `null` —— 一个数字都不编，
   * 页面要说"当前会话未知，无法判断实际会跑什么"，而不是"当前会话生效 0 条"
   * （用户级的条数确实是已知的，但"会话生效"是用户级 **+** 项目级的合并，缺了一半就不能报总数）。
   */
  async function sessionEffectOf(session: SessionContext): Promise<SessionEffectView | null> {
    if (session.projectRoot === null) return null
    const projectRoot = session.projectRoot
    const config = await configFor(projectRoot)
    const counts = countsOf(config.groups)
    // 来源条数取自**参与合并的那两份**（与 `hookCount` 同源）⇒ `fromUser + fromProject === hookCount`
    // 是结构性的，不需要"对账"；stale 时也不会出现 0 + 0 对不上总数。
    return {
      projectRoot,
      hookCount: counts.hookCount,
      disabledCount: counts.disabledCount,
      groupCount: counts.groupCount,
      fromUser: countsOf(config.userGroups).hookCount,
      fromProject: countsOf(config.projectGroups).hookCount,
      staleInUse: projectCache.get(projectRoot)?.state.stale === true,
    }
  }

  /** 把一次读取折成页面要的来源视图（用**同一个** `parseHookConfig` —— AGENTS §2.6）。 */
  function sourceViewOf(kind: 'project' | 'user', read: ReadState, vars: { projectDir?: string }): SourceInspection {
    const parsed = parseHookConfig(read.state === 'ok' ? read.raw : undefined, vars)
    return {
      kind,
      path: read.path,
      state: read.state,
      // 技术原文只在 error 时给出，且只放"详情"位（AGENTS §3.9：不作为页面主文案）。
      message: read.state === 'error' ? read.message : null,
      version: read.version === undefined || read.version === null ? null : read.version,
      groups: parsed.groups,
      skipped: parsed.skipped,
      rejected: parsed.rejected,
      matcherErrors: parsed.errors,
    }
  }

  /**
   * 数据面：检视**被选中的作用域**那一份文件。
   *
   * 三个刻意的选择：
   *   ① **作用域决定读哪一份 project 文件**（`scope=user` 时只有用户级；`workspace` 时读
   *      `root(X)/.dsh/hooks.json`）；
   *   ② **生效配置取 `configFor()` 的缓存**，而不是这里重新解析一遍 —— AGENTS §2.6 要求
   *      "页面显示的必须就是 hook 实际会跑的那一份"。重解析得到的是"磁盘刚刚的样子"，而
   *      runner 可能正拿着 last-good 在跑；两者不一致时页面就在撒谎；
   *   ③ **每侧的 state/message 取一次新鲜读取** —— 页面需要知道磁盘此刻到底是什么状态，
   *      才能把"文件坏了"和"生效配置是兜底"分开说清楚。
   *
   * 顶层 `projectRoot` / `cwd` 永远是"**当前会话**在哪里"（与所选作用域无关）：页面据此比较
   * "我是不是在看当前会话的项目"，绝不拿工作区清单里的某一条来代称（AGENTS §2.8）。
   */
  async function inspect(sessionId: string | undefined, target: ScopeTarget): Promise<HooksInspection> {
    const session = await sessionContextFor(sessionId)
    const userPath = joinPath(dshHome(), HOOKS_FILE)
    const userRead = await readJsonFile(userPath)
    const resolved = await resolveScope(session, target)
    const listed = await workspacesFor(session)
    const scope: ScopeView = {
      kind: resolved.kind,
      requested: target.kind,
      workspaceId: resolved.workspace?.id ?? null,
      workspaceTitle: resolved.workspace?.title ?? null,
      workspacePath: resolved.workspace?.path ?? null,
      projectRoot: resolved.projectRoot,
      isCurrentSession: resolved.isCurrentSession,
    }
    const base = {
      projectRoot: session.projectRoot,
      cwd: session.cwd,
      cwdSource: session.cwdSource,
      scope,
      workspaces: listed.items,
      workspacesAvailable: listed.available,
      // 数据面本身就是"能写"的入口：路由注册了 POST，页面据此显示可编辑。
      writable: true,
      ledger: ledger.entries(),
    }
    if (resolved.kind === 'user') {
      // 用户级作用域：只列用户级；生效配置就是用户级自己的 groups。
      // 占位符也不替换（传空 vars），否则页面会看到被替换成 '' 的命令。
      const userOnly = sourceViewOf('user', userRead, {})
      return {
        ...base,
        session: await sessionEffectOf(session),
        sources: [userOnly],
        effective: userOnly.groups,
        // 这个作用域里没有项目级贡献：合并输入就是用户级自己（`fromProject` 因此恒为 0）。
        effectiveUserGroups: userOnly.groups,
        effectiveProjectGroups: {},
        staleInUse: false,
      }
    }
    const projectRoot = resolved.projectRoot ?? ''
    const vars = { projectDir: projectRoot }
    const projectRead = await readJsonFile(joinPath(projectRoot, PROJECT_DIR, HOOKS_FILE))
    const project = sourceViewOf('project', projectRead, vars)
    const user = sourceViewOf('user', userRead, vars)
    const config = await configFor(projectRoot)
    const stale = projectCache.get(projectRoot)?.state.stale === true
    return {
      ...base,
      // 会话生效视图**只有一处实现**（`sessionEffectOf`）：目标就是当前会话的项目时它照样成立
      // （`configFor(projectRoot)` 命中同一份缓存，不多读一次文件）。刻意**不**在这里再抄一份
      // 计数逻辑 —— 两处必然漂移，而漂移的就是"实际会跑几条"这个数字。
      session: await sessionEffectOf(session),
      // 展示顺序：项目级在前（它才是"这个项目"的配置）。合并顺序由 effective 决定，与这里无关。
      sources: [project, user],
      effective: config.groups,
      // 合并输入（**与 effective 同源**：磁盘或 last-good 由同一条路径决定）——页面据此标来源。
      effectiveUserGroups: config.userGroups,
      effectiveProjectGroups: config.projectGroups,
      staleInUse: stale,
    }
  }

  // 只有 Web 载体才提供 connection。**必须用 `ctx.inject` 等服务就绪**，不能在 apply 时直接读
  // `ctx.connection`：Cordis 的服务是**渐进可用**的，apply 时刻它很可能还是 `undefined`，于是
  // `if (ctx.connection !== undefined)` 会**静默跳过**注册 —— 页面拿到的是 web 服务器的纯文本
  // "not found"，而不是我们的 JSON 信封。
  //
  // 这条是**线上实测**踩到的（P8b：界面正常渲染、`/api/hooks` 却是 404），而自检当时抓不到，
  // 因为假 ctx 把服务挂在属性上了。现在的假 ctx 只通过 inject 交付，直接读属性就会红。
  //
  // 用 inject 还有第二个好处：服务永不出现时插件照常激活 —— 数据面是便利设施，不是硬依赖。
  ctx.inject(['connection'], (scope) => {
    registerHooksRoute(scope.connection, { inspect, write: handleWrite, dryRun: dryRunHook })
  })

  //#endregion

  //#region 数据面：写路径（定点写 + 版本锁 + 保留性证明）

  /** 准备一次写入的结果。任何"读不出来"都在这里变成**拒写**。 */
  type WritePrep =
    | { ok: true; state: 'absent'; target: FsTarget }
    | { ok: true; state: 'ok'; target: FsTarget; doc: Record<string, unknown>; text: string; version: string }
    | { ok: false; error: string; detail?: string }

  async function prepareWrite(path: string, signal: AbortSignal | undefined): Promise<WritePrep> {
    const read = await readJsonFile(path, signal)
    if (read.state === 'error') {
      // **绝不在读不懂的文件上落笔**：那会把用户的内容整段替换成我们序列化出来的东西。
      return { ok: false, error: 'invalid-json', detail: read.message }
    }
    if (read.target === undefined) return { ok: false, error: 'resolve-failed' }
    if (read.state === 'absent') return { ok: true, state: 'absent', target: read.target }
    const version = read.version
    if (typeof version !== 'string' || version.length === 0) {
      // 拿不到版本就**不做无守卫写入** —— 那正是"覆盖别人改动"的入口（`expected` 必给，AGENTS §2.3）。
      return { ok: false, error: 'no-version' }
    }
    return { ok: true, state: 'ok', target: read.target, doc: read.raw, text: read.text, version }
  }

  /** 把 `writeText` 抛出的异常翻成页面能**分别处理**的错误码。返回类型是 `HostErrorCode`：目录外的码写不进来。 */
  function writeErrorCode(error: unknown): HostErrorCode {
    const message = messageOf(error)
    // `FS_STALE_VERSION` 是官方契约里版本冲突的精确错误码（已用 cordis_inspect_query 核实）。
    if (message.includes('FS_STALE_VERSION')) return 'stale'
    // `createIfAbsent` 撞上"别人刚建了它"：如实报 `exists`（页面提示刷新），绝不静默覆盖。
    // 契约没给这个精确错误码（与沙箱那条一样是 best-effort），所以两种常见写法都认。
    if (/FS_EXISTS|FS_ALREADY_EXISTS|already exists|EEXIST/i.test(message)) return 'exists'
    // 沙箱拒绝只能按消息 best-effort 归类 —— 契约没给精确错误码，这条要在线上复核。
    if (/FS_(DENIED|SANDBOX|READ_ONLY)|read-only|permission denied|EPERM|EACCES/i.test(message)) return 'sandbox'
    return 'write-failed'
  }

  /** 一次写入的结果（路由据此出响应）。 */
  interface WriteResult {
    ok: boolean
    error?: string
    detail?: string
    version?: string
  }

  /**
   * 定点写：只改 `request` 指到的那一处。
   *
   * 三道防线，缺一不可：
   *   ① 读不懂就拒写（`invalid-json`）—— 否则会把读不懂的内容整段覆盖掉；
   *   ② 保留性证明不过就拒写（`not-preservable`）—— 证明的是"我声明改了什么"这份声明；
   *   ③ 写盘带**版本锁**（存在用 `replaceIfVersion`、不存在用 `createIfAbsent`）——
   *      页面与编辑器并发改同一份文件时，后到的那次拿到 `stale`，而不是静默覆盖。
   */
  async function writeHookFile(
    request: HooksRequest,
    projectRoot: string | null,
    signal: AbortSignal | undefined,
    policy: ResolvedPolicy | undefined,
  ): Promise<WriteResult> {
    const path =
      request.file === 'user'
        ? joinPath(dshHome(), HOOKS_FILE)
        : projectRoot === null
          ? undefined
          : joinPath(projectRoot, PROJECT_DIR, HOOKS_FILE)
    if (path === undefined) return { ok: false, error: 'no-project' }

    const prep = await prepareWrite(path, signal)
    if (!prep.ok) return { ok: false, error: prep.error, ...(prep.detail !== undefined ? { detail: prep.detail } : {}) }
    // 与 hook 子进程同理：写入按**调用会话**的沙箱档位来；拿不到就省略该字段回退部署策略（AGENTS §1.6）。
    const sandboxPolicy = policy?.passthrough
    /**
     * 页面看到的版本（乐观锁的页面侧那一半，03 票）。
     *
     * `undefined` = 旧页面：走"读后写"（与改动前逐字一致）；`null` = 页面认为目标还不存在。
     * 字符串则是"我看到的是这一版" —— 它与磁盘不符时**必须在落笔之前**就拒掉：
     * `groupIndex` / `hookIndex` 是文件下标，别处插删一条之后同一个下标会指到另一条 hook 上。
     */
    const pageVersion = request.expectedVersion

    try {
      if (request.op === 'createFile') {
        // 页面说"它已经存在" → 与 `createFile` 的语义直接矛盾，按冲突处理（不做无守卫新建）。
        if (typeof pageVersion === 'string') return { ok: false, error: 'stale' }
        if (prep.state !== 'absent') return { ok: false, error: 'exists' }
        const created = await fsSvc.writeText(
          prep.target,
          starterText(DEFAULT_STYLE),
          { kind: 'createIfAbsent' },
          signal,
          sandboxPolicy,
        )
        return { ok: true, version: created.version }
      }

      if (prep.state === 'absent') {
        // 页面手里有一个版本 ⇒ 它以为文件还在；现在文件没了 ⇒ 冲突（绝不"顺手新建回来"）。
        if (pageVersion !== undefined && pageVersion !== null) return { ok: false, error: 'stale' }
        // 「＋新建」要能**一次建出文件**（D2）：只有新增类 op 才放开自动建文件 ——
        // "改一条不存在的命令"仍然 absent 拒写（否则会顺手建出一份空配置，用户看到的是
        // "我明明是去改的，怎么多了个文件"）。骨架就是 `{hooks:{…一条}}`（我们自己的不动点风格）。
        if (request.op !== 'addGroup' && request.op !== 'addHook') return { ok: false, error: 'absent' }
        const skeleton: Record<string, unknown> = { hooks: {} }
        // `addHook` 在**空文件**里没有组可加 → 等价于"新开一组"（语义上就是新建按钮的意图）。
        const seeding = request.op === 'addHook' ? { ...request, op: 'addGroup' as const, matcher: null } : request
        const applied = applyOp(skeleton, seeding)
        if (!applied.ok) return { ok: false, error: applied.reason }
        const problem = preservationProblem(skeleton, applied.applied.doc, applied.applied.changes)
        if (problem !== undefined) return { ok: false, error: 'not-preservable', detail: problem }
        const text = serialize(applied.applied.doc, DEFAULT_STYLE)
        // 竞态（别人同时建了它）：provider 报 `exists`，这里如实透传并提示刷新（D2）。
        const created = await fsSvc.writeText(prep.target, text, { kind: 'createIfAbsent' }, signal, sandboxPolicy)
        return { ok: true, version: created.version }
      }

      const applied = applyOp(prep.doc, request)
      if (!applied.ok) return { ok: false, error: applied.reason }
      // 页面给的版本与磁盘不一致 ⇒ **落笔之前**就拒掉（连 applyOp 都跑过了也无妨：它的产物不落盘）。
      // 顺序放在这里是为了让"拒写"覆盖所有 op（含 setHookDisabled / removeHook 这些会丢数据的）。
      if (typeof pageVersion === 'string' && prep.version !== pageVersion) {
        return { ok: false, error: 'stale', detail: `页面版本 ${pageVersion} ≠ 磁盘版本 ${prep.version}` }
      }
      if (pageVersion === null) return { ok: false, error: 'stale', detail: '页面认为文件不存在，但它存在' }
      const problem = preservationProblem(prep.doc, applied.applied.doc, applied.applied.changes)
      if (problem !== undefined) return { ok: false, error: 'not-preservable', detail: problem }
      const text = serialize(applied.applied.doc, detectStyle(prep.text))
      const written = await fsSvc.writeText(
        prep.target,
        text,
        { kind: 'replaceIfVersion', version: prep.version },
        signal,
        sandboxPolicy,
      )
      return { ok: true, version: written.version }
    } catch (error) {
      return { ok: false, error: writeErrorCode(error), detail: messageOf(error) }
    }
  }

  /**
   * 把**请求体里的作用域参数**解析成目标 projectRoot。
   *
   * 这是 §2.2 的核心：`file:'project'` + `workspaceId` 时**只**按白名单解析那个工作区 ——
   * 解析不到就返回错误，**绝不允许**"拿不到就退回会话项目"（那会静默改错文件）。
   * 沙箱策略仍取调用会话（拿不到工作区时也不提权）。
   */
  async function writeRootFor(
    target: ScopeTarget,
    sessionId: string | undefined,
  ): Promise<{ ok: true; projectRoot: string | null } | { ok: false; error: string }> {
    if (target.kind === 'user') return { ok: true, projectRoot: null }
    if (target.kind === 'current') {
      const found = agentForSession(sessionId)
      const cwd = found.agent?.session?.header?.cwd
      return {
        ok: true,
        projectRoot: typeof cwd === 'string' && cwd.length > 0 ? await projectRootFor(cwd) : null,
      }
    }
    const lookup = await lookupWorkspace(target.workspaceId)
    if (!lookup.available) return { ok: false, error: 'no-workspace-registry' }
    if (lookup.record === undefined) return { ok: false, error: 'unknown-workspace' }
    return { ok: true, projectRoot: await projectRootFor(lookup.record.path) }
  }

  /** 路由的写入口：作用域 → projectRoot + 该会话的沙箱策略。 */
  async function handleWrite(
    request: HooksRequest,
    target: ScopeTarget,
    sessionId: string | undefined,
    signal: AbortSignal,
  ): Promise<WriteResult> {
    const found = agentForSession(sessionId)
    const root = await writeRootFor(target, sessionId)
    if (!root.ok) return { ok: false, error: root.error }
    return writeHookFile(request, root.projectRoot, signal, sandboxPolicyFor(found.agent))
  }

  //#endregion

  //#region 数据面：试运行（与真实运行共用执行路径，但**不进台账**）

  /**
   * 试运行**一条** hook：按文件下标找到它 → 用同一个执行路径跑 → 把结果原样回给页面。
   *
   * 与真实运行只有两条差异（§2.10 允许的）：
   *   ① **不写执行台账** —— 台账是状态色的唯一依据（§3.8），一次试运行不该把那一行画绿；
   *   ② payload 多一个 `dry_run: true` 标记（同一个 builder 产出，只多这一个字段），
   *      免得 hook 分不清自己在预演还是真跑。
   * 沙箱档位**沿用调用会话**，与真实运行一致 —— 试运行绝不放宽权限（§1.6）。
   */
  async function dryRunHook(
    request: DryRunRequest,
    target: ScopeTarget,
    sessionId: string | undefined,
    signal: AbortSignal,
  ): Promise<DryRunOutcome> {
    const found = agentForSession(sessionId)
    const session = await sessionContextFor(sessionId)
    const root = await writeRootFor(target, sessionId)
    if (!root.ok) return { ok: false, error: root.error }
    const projectRoot = root.projectRoot
    const path =
      request.file === 'user'
        ? joinPath(dshHome(), HOOKS_FILE)
        : projectRoot === null
          ? undefined
          : joinPath(projectRoot, PROJECT_DIR, HOOKS_FILE)
    if (path === undefined) return { ok: false, error: 'no-project' }

    const read = await readJsonFile(path, signal)
    if (read.state === 'error') return { ok: false, error: 'invalid-json', detail: read.message }
    if (read.state === 'absent') return { ok: false, error: 'absent' }

    // 寻址一律用**文件下标**（§2.3）：页面给的 groupIndex / hookIndex 是 `rawIndex`，
    // 不是解析后的数组位置 —— 解析会跳过 matcher 非法的 group 与没有 command 的条目。
    const parsed = parseHookConfig(read.raw, { projectDir: projectRoot ?? '' })
    const group = (parsed.groups[request.event] ?? []).find((candidate) => candidate.rawIndex === request.groupIndex)
    if (group === undefined) {
      // 先分清"真的不在"与"在、但不会跑"：后者是**有原因的**，说成"已经不在了"就是撒谎
      // （用户明明能在文件里看到它，试运行却告诉他"可能刚被改过，请刷新"）。
      const rejected = parsed.rejected.find(
        (candidate) => candidate.event === request.event && candidate.groupIndex === request.groupIndex,
      )
      if (rejected !== undefined) {
        const where = rejected.matcher === undefined ? '' : `：${rejected.matcher}`
        return { ok: false, error: 'rejected', detail: `这一组不会运行（${rejected.reason}）${where}` }
      }
      return { ok: false, error: 'not-found', detail: '这个分组不在文件里（可能刚被改过）' }
    }
    const hook = group.hooks.find((candidate) => candidate.rawIndex === request.hookIndex)
    if (hook === undefined) return { ok: false, error: 'not-found', detail: '这一条不在文件里（可能刚被改过）' }

    // 工作目录：只有"目标就是当前会话的项目"才用会话 cwd；否则用目标项目根 ——
    // 拿当前会话的 cwd 去跑别的工作区的 hook，结果会**看起来像**那条 hook 会在这里跑。
    const cwd =
      projectRoot !== null && session.projectRoot === projectRoot && session.cwd !== null
        ? session.cwd
        : (projectRoot ?? session.cwd ?? '')
    const context: ExecutionContext = {
      cwd,
      projectRoot: projectRoot ?? '',
      sandboxPolicy: sandboxPolicyFor(found.agent),
    }
    const payload = { ...basePayload(found.agent, request.event, context), dry_run: true } as HookPayload
    const { output, durationMs } = await runSingleHook(hook, request.event, context, payload, signal)
    return {
      ok: true,
      run: {
        command: hook.command,
        // `null` = 子进程没起来（与台账里的语义一致，页面据此显示"启动失败"而不是绿）。
        exitCode: output.exitCode ?? null,
        decision: output.decision ?? 'pass',
        durationMs,
        stdout: output.stdout,
        stderr: output.stderr,
      },
    }
  }

  //#endregion

  //#region 事件接线（与官方桥的 7 个扩展点一一对应）

  /** SessionStart：注入上下文。serial 事件，会 await。 */
  ctx.on('agent/created', async ({ agent, source, signal }) => {
    try {
      const context = await contextFor(agent)
      if (context.config.groups.SessionStart === undefined) return
      const merged = await runPoint(
        context,
        'SessionStart',
        source,
        sessionStartPayload(agent, source, context),
        signal,
      )
      const message = contextMessage(merged)
      if (message !== undefined && typeof agent.inject === 'function') agent.inject(message)
    } catch (error) {
      warn(`dsh-hooks: SessionStart 失败：${messageOf(error)}`)
    }
  })

  /** UserPromptSubmit：可拒绝整条 prompt，或追加上下文。 */
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    let merged: MergedOutput | undefined
    try {
      const context = await contextFor(agent)
      // ⚠️ 这里刻意写成"条件成立才处理"，而不是 `if (没命中) return next()`。
      // 后者落在 try 里会被 `@typescript-eslint/return-await` 要求改成 `return await next()`，
      // 而那会**改变语义**：下游的 rejection 会被本函数的 catch 吸走，catch 里又会**再调一次**
      // next() → 下游整整跑两遍。落到 try 之外统一 next() 才与手写版逐字等价。
      if (context.config.groups.UserPromptSubmit !== undefined && isUnknownArray(messages) && messages.length > 0) {
        const content = messages.flatMap((message) =>
          isObject(message) && isUnknownArray(message.content) ? message.content : [],
        )
        merged = await runPoint(context, 'UserPromptSubmit', '', promptPayload(agent, content, context), signal)
        if (merged.decision === 'deny') return { kind: 'reject' }
      }
    } catch (error) {
      warn(`dsh-hooks: UserPromptSubmit 失败：${messageOf(error)}`)
      return next()
    }
    const downstream = await next()
    const message = merged === undefined ? undefined : contextMessage(merged)
    if (message === undefined || !isObject(downstream) || downstream.kind !== 'enter') return downstream
    const existing = isUnknownArray(downstream.messages) ? downstream.messages : []
    return { ...downstream, messages: [...existing, message] }
  })

  /** PreToolUse：deny 阻断、ask 转审批、其余放行。 */
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const context = await contextFor(agentOf(exec))
      // 同上：不在 try 里 `return next()`，落到函数末尾那一条（两者语义完全一致）。
      if (context.config.groups.PreToolUse !== undefined) {
        const merged = await runPoint(context, 'PreToolUse', exec.name, preToolPayload(exec, context), exec.signal)
        if (merged.decision === 'deny') {
          return { kind: 'deny', reason: merged.reason ?? 'blocked by PreToolUse hook (dsh-hooks)' }
        }
        if (merged.decision === 'ask') {
          return { kind: 'ask', ...(merged.reason !== undefined ? { reason: merged.reason } : {}) }
        }
      }
    } catch (error) {
      warn(`dsh-hooks: PreToolUse 失败：${messageOf(error)}`)
    }
    return next()
  })

  /** PostToolUse：block 带 feedback，或追加上下文。 */
  ctx.on('tools/post-execute', async (exec, result, next) => {
    let merged: MergedOutput | undefined
    let message: InjectionMessage | undefined
    try {
      const context = await contextFor(agentOf(exec))
      // 同上：不在 try 里 `return next()`。这里"没命中"要落到 try 之后的 `await next()`，
      // 与手写版早退的返回值完全一致（都是下游结果、都不进 catch）。
      if (context.config.groups.PostToolUse !== undefined) {
        merged = await runPoint(context, 'PostToolUse', exec.name, postToolPayload(exec, result, context), exec.signal)
        message = contextMessage(merged)
        if (merged.decision === 'deny') {
          return {
            kind: 'block',
            feedback: [{ type: 'text', text: merged.reason ?? 'blocked by PostToolUse hook (dsh-hooks)' }],
            ...(message !== undefined ? { additionalContexts: [message] } : {}),
          }
        }
      }
    } catch (error) {
      warn(`dsh-hooks: PostToolUse 失败：${messageOf(error)}`)
      return next()
    }
    const downstream = await next()
    if (message === undefined) return downstream
    const inherited =
      isObject(downstream) && isUnknownArray(downstream.additionalContexts) ? downstream.additionalContexts : []
    return { ...downstream, additionalContexts: [message, ...inherited] }
  })

  /**
   * Stop：阻断则强制再走一轮。
   *
   * 这里比官方桥多一道防线：官方桥没有连续阻断上限，一个无条件返回阻断的 Stop hook
   * 会让 run 无限续跑。本插件按会话计数，超过 {@link STOP_FORCE_LIMIT} 后放行并 warn。
   */
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    try {
      const context = await contextFor(agent)
      if (context.config.groups.Stop === undefined) return
      const sessionId = agent.session?.header?.id ?? ''
      // `stop_hook_active` 的语义是"这一轮已经被 Stop hook 续跑过"（官方协议）。
      // 以前恒为 false：按官方语义写的防死循环逻辑（看到 true 就放行）在我们这里**永远不触发**。
      const forced = stopForced.get(sessionId) ?? 0
      const merged = await runPoint(context, 'Stop', '', stopPayload(agent, context, forced > 0), signal)
      if (merged.decision !== 'deny') {
        stopForced.delete(sessionId)
        return
      }
      if (forced >= STOP_FORCE_LIMIT) {
        warn(`dsh-hooks: Stop hook 已连续强制续跑 ${forced} 次，达到上限 ${STOP_FORCE_LIMIT}，本次放行以免死循环`)
        stopForced.delete(sessionId)
        return
      }
      stopForced.set(sessionId, forced + 1)
      agent.steer?.({
        id: newMessageId(),
        role: 'user',
        content: [{ type: 'text', text: merged.reason ?? 'continue: blocked by Stop hook (dsh-hooks)' }],
        source: CONTEXT_SOURCE,
      })
    } catch (error) {
      warn(`dsh-hooks: Stop 失败：${messageOf(error)}`)
    }
  })

  /** SubagentStart：向进程内子 agent 注入上下文（detached）。 */
  ctx.on('subagent/start', (info) => {
    try {
      const agents = ctx.get('agents')
      const child = agents !== undefined && typeof agents.get === 'function' ? agents.get(info.id) : undefined
      if (child !== undefined) subagentChildren.set(info.runId, child)
      const run = (async () => {
        const anchor = child?.session !== undefined ? child : undefined
        const cwd = anchor?.session?.header?.cwd ?? process.cwd()
        const projectRoot = await projectRootFor(cwd)
        const config = await configFor(projectRoot)
        if (config.groups.SubagentStart === undefined) return
        const context: RunContext = { cwd, projectRoot, config, sandboxPolicy: sandboxPolicyFor(anchor) }
        const merged = await runPoint(
          context,
          'SubagentStart',
          SUBAGENT_TYPE,
          subagentPayload('SubagentStart', info, anchor, context),
          undefined,
        )
        const message = contextMessage(merged)
        if (message !== undefined && typeof child?.inject === 'function') child.inject(message)
      })().catch((error: unknown) => {
        warn(`dsh-hooks: SubagentStart 失败：${messageOf(error)}`)
      })
      track(run)
    } catch (error) {
      warn(`dsh-hooks: SubagentStart 接线失败：${messageOf(error)}`)
    }
  })

  /** SubagentStop：只观察，不阻断（harness 的 subagent seam 没有 veto 能力）。 */
  ctx.on('subagent/end', (info) => {
    try {
      const agents = ctx.get('agents')
      const child =
        subagentChildren.get(info.runId) ??
        (agents !== undefined && typeof agents.get === 'function' ? agents.get(info.id) : undefined)
      subagentChildren.delete(info.runId)
      const run = (async () => {
        const anchor = child?.session !== undefined ? child : undefined
        const cwd = anchor?.session?.header?.cwd ?? process.cwd()
        const projectRoot = await projectRootFor(cwd)
        const config = await configFor(projectRoot)
        if (config.groups.SubagentStop === undefined) return
        const context: RunContext = { cwd, projectRoot, config, sandboxPolicy: sandboxPolicyFor(anchor) }
        await runPoint(
          context,
          'SubagentStop',
          SUBAGENT_TYPE,
          subagentPayload('SubagentStop', info, anchor, context),
          undefined,
        )
      })().catch((error: unknown) => {
        warn(`dsh-hooks: SubagentStop 失败：${messageOf(error)}`)
      })
      track(run)
    } catch (error) {
      warn(`dsh-hooks: SubagentStop 接线失败：${messageOf(error)}`)
    }
  })

  //#endregion
}

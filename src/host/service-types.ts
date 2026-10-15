/**
 * 宿主半边用到的 Service 契约：**本地最小接口，不 import 官方类型**。
 *
 * 为什么不全量照抄官方类型：宿主产物必须是零 import 的单文件，而 `@deepseek-ai/dsh-*` 的
 * 类型包只存在于 app.asar 里（磁盘路径解析不到）。这里只声明**我们实际会调用的那几个成员**，
 * 并且刻意写得比官方宽一点（可选成员用 `?`），因为：
 *   ① 版本升级时多出来的字段不该让插件编译不过；
 *   ② 缺服务时要能降级，而不是在类型层面假设它一定存在。
 *
 * 这个文件**只有类型、没有实现，也没有运行时 import**。
 */

/** 解析后的文件目标：`targetKey` 是不透明标识，`displayPath` 是给人看的路径。 */
export interface FsTarget {
  readonly targetKey: string
  readonly displayPath: string
}

/**
 * `stat()` 的结果子集。
 *
 * **已核实（P4b，`cordis_inspect_query` host Service `fs` 的精确契约）**：
 * ```ts
 * interface FsInfo { version: FsVersion; type: 'file'|'directory'|'other'; size?: number }
 * ```
 * 即 **`version` 是必填的**，所以 C2 的版本核对通道在真实 provider 上**总是可用**。
 * 这里仍声明成可选是**防御性**的：退化分支（provider 没有 version → 退回 TTL）有自己的断言，
 * 而声明成必填会让那些分支变成"多余判断"。
 */
export interface FsInfo {
  readonly type?: string
  readonly size?: number
  /** 刻意带上 `null`：服务返回值是不可信运行时数据，可能给 null。 */
  readonly version?: string | null | undefined
}

/** 写入意图（官方 `FsWriteIntent`，逐字对齐）。 */
export type FsWriteIntent = { kind: 'createIfAbsent' } | { kind: 'replaceIfVersion'; version: string }

/** `writeText` 的结果：包含本次写入产生的**新版本号**（可用于连续编辑）。 */
export interface FsWriteOutcome {
  readonly operation: 'create' | 'update'
  readonly version: string
  readonly before: string | null
  readonly after: string
}

/** 文件监听回调：`error` 只在监听器自身出错时给。 */
export type FsChanged = (error?: Error) => void

/** `ctx.fs`（dsh-fs-sandbox 注册）。 */
export interface FsService {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>
  stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>
  readText(target: FsTarget, signal?: AbortSignal): Promise<string>
  /**
   * 原子地创建或替换 UTF-8 文本。
   *
   * - `expected` 守卫**意图与时效性**：文件存在用 `replaceIfVersion`（版本不符 → 抛
   *   `FS_STALE_VERSION`），不存在用 `createIfAbsent`。**绝不允许省略**（省略 = 无条件覆盖）。
   * - `sandboxPolicy` 是**按调用**给的模式与 workspace 根 —— 与 hook 子进程同理（AGENTS §1.6）：
   *   必须传**调用会话**的策略，拿不到才省略。
   */
  writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: OpaqueSandboxPolicy,
  ): Promise<FsWriteOutcome>
  /** 可选：不是每个 provider 都支持监听（不支持时插件退化成 TTL 兜底）。 */
  watch?(target: FsTarget, changed: FsChanged, signal: AbortSignal): Promise<() => Promise<void>>
}

/** 沙箱策略：**宿主不解释它**，只负责把它原样交给 `shell.resolve`。 */
export type OpaqueSandboxPolicy = Record<string, unknown>

/** `ctx.shell.resolve()` 的入参（字段名与 dsh-shell 的 ShellExecRequest 对齐）。 */
export interface ShellRunRequest {
  command: string
  workdir: string
  timeoutMs: number
  stdin: string
  signal?: AbortSignal | undefined
  env?: Record<string, string> | undefined
  /** **原样透传**调用会话的策略对象（形如 `{mode, workspaceRoot, sessionId?}`）。 */
  sandboxPolicy?: OpaqueSandboxPolicy | undefined
}

/** `shell.resolve()` 的返回值：对插件不透明的规格对象。 */
export interface ShellSpec {
  readonly request: ShellRunRequest
}

/** 子进程输出的一段文本。 */
export interface ShellChunk {
  readonly text: string
}

/** 子进程结果：**不抛**——起不来 / 超时 / 被信号杀掉都以字段形式表达。 */
export interface ShellResult {
  readonly exitCode?: number | null | undefined
  readonly stdout?: ShellChunk | undefined
  readonly stderr?: ShellChunk | undefined
}

/** `shell.execute()` 的返回值：`result()` 才是等进程结束。 */
export interface ShellExecution {
  result(): Promise<ShellResult>
}

/** `ctx.shell`（dsh-pwsh-sandbox 注册）。 */
export interface ShellService {
  resolve(request: ShellRunRequest): ShellSpec
  execute(spec: ShellSpec): Promise<ShellExecution>
}

/** `ctx.connection`（dsh-client-connection 注册；只有 Web 载体才提供）。 */
export interface ConnectionService {
  readonly fetch: {
    /** 注册一条精确路由，挂在 webServer 的 `/api` 前缀下（自带围栏与鉴权）。 */
    register(route: {
      path: string
      methods: string[]
      requestBody: 'buffered' | 'streaming'
      fetch: (request: Request) => Promise<Response>
    }): unknown
  }
}

/** `ctx.logger`（cordis 内建，不在 inject 列表里，只做出席检查）。 */
export interface LoggerLike {
  warn(message: string): void
  info(message: string): void
}

/** 会话 header 里我们会用到的字段。 */
export interface SessionHeader {
  readonly id?: string
  readonly cwd?: string
}

/** 会话对象。 */
export interface SessionLike {
  readonly header?: SessionHeader
}

/** agent：只声明我们会调用的成员。 */
export interface AgentLike {
  readonly session?: SessionLike
  inject?(message: unknown): void
  steer?(message: unknown): void
}

/** `ctx.get('sandboxPolicy')`。 */
export interface SandboxPolicyService {
  /**
   * 返回类型刻意写成 `unknown`：服务给回来的是**不可信运行时数据**，
   * 声明成 `SandboxPolicy` 会让 `sandboxPolicyFor()` 里的形状校验变成"多余判断"而被 lint 拦下，
   * 也会掩盖"服务版本不匹配时给出的畸形策略"。由宿主侧自己收窄。
   */
  resolve(request?: { session?: SessionLike; mode?: string }): unknown
}

/** `ctx.get('agents')`。 */
export interface AgentsService {
  currentInitiator?(): AgentLike | undefined
  get?(id: string): AgentLike | undefined
}

/**
 * 一条工作区记录（**最小形状**，只声明我们读的字段）。
 *
 * 官方 `dsh-workspace` 的记录还有 `createdAt` / `updatedAt` / `sessionIds`（已核实），
 * 但本插件一个都不用 —— 只声明用得到的，版本升级时多出来的字段不该让插件编译不过。
 * `path` 是 **realpath 规范化**过的绝对路径。
 *
 * ⚠️ 工作区路径 **≠** 项目根：`projectRoot` = 最近含 `.git` 的祖先（可能就在 `path` 上，
 * 也可能是它的某个父目录）。所以两者必须分别给页面看，不能互相代替。
 */
export interface WorkspaceRecord {
  id: string
  path: string
  title?: string
}

/**
 * `ctx.get('workspaceRegistry')`（dsh-workspace 注册；desktop 载体上真实存在）。
 *
 * 返回类型刻意写成 `unknown`（与 `SandboxPolicyService` 同款防御性声明）：服务给回来的是
 * **不可信运行时数据**，由宿主侧自己收窄成 {@link WorkspaceRecord}。
 * 两个成员都可选：缺 `list` 时"扁平清单"这条能力不可用，缺 `get` 时退回 `list().find`。
 */
export interface WorkspaceService {
  list?(): unknown
  get?(id: string): unknown
}

/** 工具调用（`tools/pre-execute` 的 exec）。 */
export interface ToolExecution {
  readonly name: string
  readonly arguments?: unknown
  readonly callId?: string
  readonly agent?: AgentLike | undefined
  readonly signal?: AbortSignal | undefined
}

/** `agent/pre-step` 的 next() 结果里我们关心的部分。 */
export interface StepResult {
  readonly kind?: string
  readonly messages?: unknown
  readonly additionalContexts?: unknown
}

/** `tools/post-execute` 的 next() 结果里我们关心的部分。 */
export interface PostToolResult {
  readonly additionalContexts?: unknown
}

/** `subagent/start` / `subagent/end` 的事件载荷。 */
export interface SubagentInfo {
  readonly id: string
  readonly runId: string
}

/**
 * 事件表：键是 cordis 事件名，值是监听器签名。
 *
 * 写成显式表而不是 `(...args: any[])`：`any` 被 eslint 禁止，而 `unknown` 参数没法直接解构。
 * 这张表既是类型，也是"本插件接了哪 7 个扩展点"的文档。
 */
export interface HostEvents {
  'agent/created': (payload: { agent: AgentLike; source: string; signal?: AbortSignal | undefined }) => unknown
  'agent/pre-step': (
    payload: { agent?: AgentLike | undefined; messages?: unknown; signal?: AbortSignal | undefined },
    next: () => Promise<StepResult>,
  ) => unknown
  'tools/pre-execute': (exec: ToolExecution, next: () => Promise<unknown>) => unknown
  'tools/post-execute': (exec: ToolExecution, result: unknown, next: () => Promise<PostToolResult>) => unknown
  'agent/turn-stopping': (payload: { agent: AgentLike; signal?: AbortSignal | undefined }) => unknown
  'subagent/start': (info: SubagentInfo) => unknown
  'subagent/end': (info: SubagentInfo) => unknown
}

/**
 * 宿主上下文（只声明本插件用到的成员）。
 *
 * `get` 用**重载**而不是返回 `unknown`：已知服务拿到精确类型，未知服务仍是 `unknown`。
 * 这样既避免 `as` 硬转，也避免 strictTypeChecked 的 `no-unsafe-*` 报警。
 */
export interface HostContext {
  readonly fs: FsService
  readonly shell: ShellService
  readonly logger?: LoggerLike | undefined
  /**
   * 浏览器载体才提供。**刻意可选**：shell 载体（无 Web 半边）里它就是 undefined，
   * 那时设置页数据面不注册，但 hooks 本身必须照常工作 —— 数据面是便利设施，不是硬依赖。
   *
   * ⚠️ 但**不要直接读这个属性**：Cordis 的服务是**渐进可用**的，`apply()` 时刻它可能还没加载，
   * 于是"读到 undefined 就跳过"会**静默丢掉整条路由**（线上实测踩过：界面活了、`/api/hooks`
   * 是 404）。正确写法是 `ctx.inject(['connection'], (scope) => …)` —— 服务就绪后才回调，
   * 永不出现时插件也照常激活。
   */
  readonly connection?: ConnectionService | undefined
  /**
   * 声明式依赖。等服务就绪后回调；服务永不出现则回调不跑（插件照常激活）。
   * 可选服务的**唯一**正确访问方式（见上面 `connection` 的说明）。
   *
   * 两条重载：精确声明 `['connection']` 时，回调里的 `scope.connection` **保证存在**
   * （这正是 inject 的语义 —— 服务没就绪回调根本不会跑）；泛化那条只保证 `HostContext`。
   */
  inject(
    deps: readonly ['connection'],
    callback: (scope: HostContext & { readonly connection: ConnectionService }) => void,
  ): unknown
  inject(deps: readonly string[], callback: (scope: HostContext) => void): unknown
  get(name: 'sandboxPolicy'): SandboxPolicyService | undefined
  get(name: 'agents'): AgentsService | undefined
  /**
   * 工作区清单（`dsh-workspace`）。**每次请求时现取**，不要在 `apply()` 里读属性 ——
   * 与 `connection` 同理：Cordis 的服务是渐进可用的，apply 时刻它可能还没加载
   * （AGENTS §2.12 记的线上事故就是这个形状）。服务缺席 ⇒ 页面说"宿主没有提供工作区清单"。
   */
  get(name: 'workspaceRegistry'): WorkspaceService | undefined
  get(name: string): unknown
  on<E extends keyof HostEvents>(event: E, handler: HostEvents[E]): void
  /**
   * 注册一个随 fiber 释放的副作用。回调返回 disposer（或不返回）。
   * 用 `| undefined` 而不是 `| void`：`void` 出现在联合类型里会被 lint 判为无效
   * （no-invalid-void-type），而宿主里 `abort` 掉的回调确实可能什么都不返回。
   */
  effect(callback: () => (() => unknown) | undefined, label?: string): void
}

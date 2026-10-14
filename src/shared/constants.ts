/**
 * 两半共享的常量。**唯一来源** —— 宿主半边与自检都必须从这里取，不许各写一份字面量
 * （否则改一处忘一处，而且断言会退化成"两边的字面量碰巧一样"）。
 */

/** 项目级配置所在目录（与 dsh-skill-filesystem 的 `<projectRoot>/.dsh/skills` 同一约定）。 */
export const PROJECT_DIR = '.dsh'
/** 配置文件名。 */
export const HOOKS_FILE = 'hooks.json'
/** hook 未写 timeout 时的默认超时（ms）= 600 秒，即通用 hooks 规范对 command handler 的默认值。 */
export const DEFAULT_TIMEOUT_MS = 600_000
/** hook 用这个退出码表示"阻断"。⚠️ Windows 上 `ctx.shell` 是 PowerShell 5.1，exit 2 会被折叠成 1。 */
export const BLOCKING_EXIT_CODE = 2
/** 向上找 .git 的最大层数，防止符号链接环导致死循环。 */
export const MAX_PROJECT_DEPTH = 64
/** Stop hook 连续强制续跑的上限（官方桥没有上限，会无限循环；这里对齐 ZCode 的 3 次）。 */
export const STOP_FORCE_LIMIT = 3
/**
 * 「解析失败 / 没有配置」这类**负结果**的缓存时长（ms）。
 *
 * 为什么必须有过期：典型场景是"先开着项目干活，过一会儿才想起来建 `.dsh/hooks.json`"。
 * 如果负结果被永久缓存，新建的配置要等到重启才生效。而 `fs.watch` 对**尚不存在**的路径
 * 不一定能挂上（`resolve` 可能要做 realpath），所以必须有这层兜底。
 * 代价：无 hook 的项目最多每 2 秒多付两次 stat。
 */
export const NEGATIVE_TTL_MS = 2_000
/**
 * 「有可用 hook」这类**正结果**的缓存时长（ms）—— 版本核对通道不可用时的兜底。
 *
 * 失效的主通道是 `ctx.fs.stat()` 的 `version` 核对（见 src/host/index.ts 的 configFor）；
 * watcher 是加速器。但这两条都不保证存在：provider 可能不返回 `version`，`stat` 也可能抛错。
 * 那时只有"正结果也带短 TTL"能把"监听器静默失效"从「永久用旧配置」降级成「最多迟 4 秒生效」。
 */
export const POSITIVE_TTL_MS = 4_000
/**
 * 失效回调日志的最小间隔（ms）。
 *
 * 一次保存可能被底层 watcher 拆成多个事件（Windows 上 `change` 常常还伴随 `add`/`unlink`），
 * 而失效回调在每次工具调用前都可能在热路径附近，所以要限流。
 */
export const INVALIDATE_LOG_INTERVAL_MS = 1_000

/** 本插件支持的事件集合（顺序即文档里的展示顺序；解析时当白名单用）。 */
export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStart',
  'SubagentStop',
] as const

/** 事件名联合类型。 */
export type HookEvent = (typeof HOOK_EVENTS)[number]

/**
 * 注入上下文的 message source。
 *
 * 用 `dsh-hooks` 作为 kind：这只是一个来源标记，实测没有任何消费方对 `source.kind` 做穷举
 * switch，所以用一个属于本插件自己的、语义准确的值即可。
 */
export const CONTEXT_SOURCE = { kind: 'dsh-hooks' } as const

/**
 * matcher 判别式：纯 [A-Za-z0-9_|] 视为字面量多选，其余视为正则。
 * 与 dsh-hook-protocol/lib/matcher.js 逐字一致。
 */
export const LITERAL_ALTERNATIVES = /^[A-Za-z0-9_|]+$/
/** SubagentStart/Stop 上报的 agent_type（harness 的 subagent seam 不携带种类标签）。 */
export const SUBAGENT_TYPE = 'general-purpose'

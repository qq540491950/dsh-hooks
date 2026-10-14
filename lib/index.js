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
 * 本插件在每个 session 首次触发时按 `agent.session.header.cwd` 解析配置，并按
 * projectRoot 缓存 + `ctx.fs.watch()` 热重载，多个项目可以同时各用各的。
 *
 * ## 缓存与失效（两条通道，缺一不可）
 *   1. **主通道**：`ctx.fs.watch()` 监听 `<projectRoot>/.dsh`（目录）、`hooks.json`（文件）
 *      和用户级 `$DSH_HOME/hooks.json`；事件到达就丢掉对应缓存。
 *   2. **兜底通道**：正结果带 {@link POSITIVE_TTL_MS}(4s) 的自愈过期，负结果带
 *      {@link NEGATIVE_TTL_MS}(2s)。任何"监听器没挂上/挂了没事件"的静默失效，
 *      最坏也只是延迟 4 秒生效，而不是"必须重启"。
 *
 * ## 零 import 纪律（重要）
 * 本文件由 Loader 以 `file:///...` 绝对路径加载，**裸模块说明符解析不到**
 * （`@deepseek-ai/*` 都藏在 app.asar 里）。所以这里不 import / 不 require 任何东西，
 * 只使用 Loader 注入进来的 Service：
 *
 *     ctx.shell  — 跑 hook 子进程（ShellExecRequest/ShellRunResult，见 dsh-shell）
 *     ctx.fs     — 读配置 + 目录监听（FsTarget{targetKey,displayPath}，见 dsh-fs）
 *     ctx.logger — 日志
 *     ctx.sandboxPolicy — **可选**（用 `ctx.get`，不进 inject）：把调用会话的沙箱策略
 *                         透给 hook 子进程。见下方「hook 的权限」。
 *
 * ## hook 的权限（为什么必须透传 sandboxPolicy）
 * `ctx.shell` 的默认语义是"低层调用者回退到**部署**策略"（见 dsh-shell / dsh-pwsh-sandbox）。
 * 插件不显式传 `sandboxPolicy` 时，hook 子进程按部署默认档跑：本机 desktop profile 是
 * `mode: workspace-write` + `workspaceRoot: 宿主 process.cwd()` —— 那个"工作区"是**宿主启动目录**，
 * 不是会话的项目目录。实测后果：hook 进程写项目、写用户目录、写真实 %TEMP% 全部 `EPERM`，
 * 只有它自己那次的私有临时目录能写。于是任何"落盘类" hook（格式化 / 自动修复 / 写日志）
 * 都会**静默**失效：退出码非 2、输出非 JSON ⇒ 插件按非阻断失败处理，动作照常放行。
 *
 * 修法：用 `ctx.get('sandboxPolicy').resolve({ session })` 取**调用会话**的策略并透传，
 * 与 dsh-tool-pwsh 里的 `resolveSandboxPolicy(exec)` 同构。语义变成
 * "hook 与它会话里的工具调用同权限"：
 *   - `read-only` 会话 → hook 仍然写不了（与工具调用一致，不是提权）；
 *   - `workspace-write` 会话 → hook 能写会话 cwd；
 *   - `danger-full-access` 会话 → hook 不受限。
 * 服务缺失 / 抛错时**不传**该字段，回退到部署策略 —— 绝不因为拿不到策略就让 hook 跑不起来。
 *
 * 协议逻辑（matcher / exit code 解码 / 结构化输出 / deny>ask>allow 合并）在下方
 * 「纯函数区」自包含实现，语义对齐 @deepseek-ai/dsh-hook-protocol，可通过
 * `internals` 导出被 tools/verify.mjs 独立测试。
 *
 * ## 支持的 7 个事件
 *   SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop
 *   SubagentStart / SubagentStop
 */

//#region 常量

/** 项目级配置所在目录（与 dsh-skill-filesystem 的 `<projectRoot>/.dsh/skills` 同一约定）。 */
const PROJECT_DIR = '.dsh'
/** 配置文件名。 */
const HOOKS_FILE = 'hooks.json'
/** hook 未写 timeout 时的默认超时（ms）= 600 秒，即通用 hooks 规范对 command handler 的默认值。 */
const DEFAULT_TIMEOUT_MS = 600000
/** hook 用这个退出码表示"阻断"。 */
const BLOCKING_EXIT_CODE = 2
/** 向上找 .git 的最大层数，防止符号链接环导致死循环。 */
const MAX_PROJECT_DEPTH = 64
/** Stop hook 连续强制续跑的上限（官方桥没有上限，会无限循环；这里对齐 ZCode 的 3 次）。 */
const STOP_FORCE_LIMIT = 3
/**
 * 「没有配置 / 没有可用事件」这类**负结果**的缓存时长（ms）。
 *
 * 为什么必须有过期：典型场景是"先开着项目干活，过一会儿才想起来建 `.dsh/hooks.json`"。
 * 如果负结果被永久缓存，新建的配置要等到重启才生效。而 `fs.watch` 对**尚不存在**的路径
 * 不一定能挂上（`resolve` 可能要做 realpath），所以必须有这层兜底。
 * 代价：无 hook 的项目最多每 2 秒多付两次 stat。
 */
const NEGATIVE_TTL_MS = 2000
/**
 * 「有可用 hook」这类**正结果**的缓存时长（ms）—— 热重载失效时的兜底。
 *
 * 为什么正结果也必须过期：`fs.watch` 这条失效通道是**尽力而为**的。它可能
 *   1. 根本没有挂上（`ctx.fs` 不提供 `watch`，被静默跳过）；
 *   2. 挂上后在真实服务上不投递事件（目录 vs 文件、ignored 过滤、平台差异）；
 *   3. 回调投递了但被上游吞掉。
 * 任何一条成立，在只有"监听器失效"这一条失效路径时，正结果就会**永久**留在缓存里，
 * 表现为"改了 hooks.json 不生效，必须重启"——而且完全没有日志可查。
 *
 * 所以正结果也带一个短 TTL：到期后允许重新读文件，把"监听器静默失效"从
 * 「永久用旧配置」降级成「最多迟 {@link POSITIVE_TTL_MS} 生效」。
 *
 * 边界（重要）：
 * - TTL **只是允许重读**，不改变"每个 hook 事件只解析一次配置"这一前提
 *   （`contextFor()` 每个事件点只调用一次 `configFor()`）。
 * - 负结果仍用 {@link NEGATIVE_TTL_MS}(2s)，语义不变。
 * - 用户级配置变化仍然是 `projectCache.clear()`（全量失效），语义不变。
 * - 代价：活跃项目最多每 4 秒多付两次 stat + 一次 readText（只在有 hook 事件时）。
 */
const POSITIVE_TTL_MS = 4000
/**
 * 失效回调日志的最小间隔（ms）。
 *
 * 一次保存可能被底层 watcher 拆成多个事件（Windows 上 `change` 常常还伴随
 * `add`/`unlink`），而失效回调在每次工具调用前都可能是"热路径"附近，所以要限流：
 * 同一个 path 在 {@link INVALIDATE_LOG_INTERVAL_MS} 内只打一条日志。
 */
const INVALIDATE_LOG_INTERVAL_MS = 1000
/** 本插件支持的事件集合（顺序无关，仅用于解析时的白名单）。 */
const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStart',
  'SubagentStop',
]
/**
 * 注入上下文的 message source。
 *
 * 用 `dsh-hooks` 作为 kind：这只是一个来源标记，实测没有任何消费方对 `source.kind` 做穷举
 * switch，所以用一个属于本插件自己的、语义准确的值即可。
 */
const CONTEXT_SOURCE = { kind: 'dsh-hooks' }
/**
 * matcher 判别式：纯 [A-Za-z0-9_|] 视为字面量多选，其余视为正则。
 * 与 dsh-hook-protocol/lib/matcher.js 逐字一致。
 */
const LITERAL_ALTERNATIVES = /^[A-Za-z0-9_|]+$/
/** SubagentStart/Stop 上报的 agent_type（harness 的 subagent seam 不携带种类标签）。 */
const SUBAGENT_TYPE = 'general-purpose'

//#endregion

//#region 纯函数区（无副作用，可独立测试）

/** 非 null、非数组的对象。 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 生成一个消息 id。crypto 是 Node 全局对象，不需要 import。 */
function newMessageId() {
  const g = globalThis.crypto
  if (g && typeof g.randomUUID === 'function') return g.randomUUID()
  return 'dsh-hooks-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

/** 平台无关的路径拼接（不 import node:path）。 */
function joinPath(base, ...parts) {
  const text = String(base)
  // 只看 base 本身是 Windows 形状还是 POSIX 形状；不能因为出现 '/' 就当成有分隔符。
  const sep = text.includes('\\') || /^[A-Za-z]:/.test(text) ? '\\' : '/'
  let out = text.replace(/[\\/]+$/, '')
  for (const part of parts) out += sep + String(part).replace(/^[\\/]+|[\\/]+$/g, '')
  return out
}

/**
 * 取父目录；到根（`C:\` / `/`）时返回 undefined。
 * 纯字符串运算，避免依赖 node:path。
 */
function parentOf(p) {
  const s = String(p).replace(/[\\/]+$/, '')
  const idx = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
  if (idx < 0) return undefined
  let parent = s.slice(0, idx)
  if (parent === '') return undefined
  if (/^[A-Za-z]:$/.test(parent)) parent += '\\'
  return parent
}

/** 环境变量 `DSH_HOME`，退化到 HOME/USERPROFILE + `.dsh`（不 import node:os）。 */
function dshHome() {
  const env = (typeof process !== 'undefined' && process.env) || {}
  if (typeof env.DSH_HOME === 'string' && env.DSH_HOME.length > 0) return env.DSH_HOME
  const home = env.USERPROFILE || env.HOME || ''
  return home ? joinPath(home, '.dsh') : '.dsh'
}

/** `$DSH_PLUGIN_ROOT` / `$DSH_PROJECT_DIR` 占位符替换。 */
function substituteCommand(command, vars) {
  let out = command
  if (vars && vars.projectDir !== undefined) out = out.split('${DSH_PROJECT_DIR}').join(vars.projectDir)
  if (vars && vars.pluginRoot !== undefined) out = out.split('${DSH_PLUGIN_ROOT}').join(vars.pluginRoot)
  return out
}

/** 缺省 / 空串 / `*` = 全匹配。 */
function isMatchAll(matcher) {
  return matcher === undefined || matcher === '' || matcher === '*'
}

/** 校验一个 matcher；返回 undefined 表示合法，否则返回诊断字符串。 */
function matcherDiagnostic(matcher) {
  if (isMatchAll(matcher)) return undefined
  if (LITERAL_ALTERNATIVES.test(matcher)) return undefined
  try {
    new RegExp(matcher)
    return undefined
  } catch {
    return `invalid regex matcher ${JSON.stringify(matcher)}`
  }
}

/** matcher 是否选中 query。非法正则按"不匹配"处理，绝不抛。 */
function matchesMatcher(matcher, query) {
  if (isMatchAll(matcher)) return true
  if (LITERAL_ALTERNATIVES.test(matcher)) return matcher.split('|').includes(query)
  try {
    return new RegExp(matcher).test(query)
  } catch {
    return false
  }
}

/**
 * 解析通用 hooks 配置。
 *
 * 接受两种输入：含 `hooks` key 的 settings 对象，或裸事件映射。
 * 只跑 `type: "command"`（缺省即 command）；其余 handler 跳过并记入 skipped。
 * 单条 matcher 非法**只跳过该 group**（官方桥是拒绝整份配置，这里的取舍是
 * "一份配置里的一个笔误不该让全部 hook 失效"，诊断会以 warn 打到日志）。
 *
 * @param raw 已 JSON.parse 的对象。
 * @param vars `{projectDir?, pluginRoot?}` 替换值。
 * @returns `{groups, skipped, errors}`；groups 形如 `{PreToolUse:[{matcher?,hooks:[{command,timeoutSec?}]}]}`。
 */
function parseHookConfig(raw, vars) {
  const groups = {}
  const skipped = []
  const errors = []
  const root = isObject(raw) ? raw : undefined
  if (!root) return { groups, skipped, errors }
  const hooksMap = isObject(root.hooks) ? root.hooks : root

  for (const event of HOOK_EVENTS) {
    const rawGroups = hooksMap[event]
    if (!Array.isArray(rawGroups)) continue
    const parsedGroups = []
    for (const rawGroup of rawGroups) {
      const group = isObject(rawGroup) ? rawGroup : undefined
      if (!group || !Array.isArray(group.hooks)) continue
      const commands = []
      for (const rawHook of group.hooks) {
        const hook = isObject(rawHook) ? rawHook : undefined
        if (!hook) continue
        const type = typeof hook.type === 'string' ? hook.type : 'command'
        if (type !== 'command') {
          skipped.push({ event, type })
          continue
        }
        if (typeof hook.command !== 'string' || hook.command.length === 0) continue
        commands.push({
          command: substituteCommand(hook.command, vars || {}),
          ...(typeof hook.timeout === 'number' && hook.timeout > 0 ? { timeoutSec: hook.timeout } : {}),
        })
      }
      if (commands.length === 0) continue
      // UserPromptSubmit / Stop 没有 matcher 主语，这两个事件的 matcher 一律丢弃。
      const matcher =
        event === 'UserPromptSubmit' || event === 'Stop'
          ? undefined
          : typeof group.matcher === 'string'
            ? group.matcher
            : undefined
      const diagnostic = matcherDiagnostic(matcher)
      if (diagnostic !== undefined) {
        errors.push(`${diagnostic} on event ${JSON.stringify(event)}`)
        continue
      }
      parsedGroups.push({ ...(matcher !== undefined ? { matcher } : {}), hooks: commands })
    }
    if (parsedGroups.length > 0) groups[event] = parsedGroups
  }
  return { groups, skipped, errors }
}

/** 用户级在前、项目级在后；同一事件的数组拼接（通用的合并语义）。 */
function mergeHookGroups(userGroups, projectGroups) {
  const out = {}
  for (const event of HOOK_EVENTS) {
    const list = [...(userGroups[event] || []), ...(projectGroups[event] || [])]
    if (list.length > 0) out[event] = list
  }
  return out
}

/** 从对象里读一个字符串字段。 */
function strField(obj, key) {
  const v = obj[key]
  return typeof v === 'string' ? v : undefined
}

/** 从对象里读一个布尔字段。 */
function boolField(obj, key) {
  const v = obj[key]
  return typeof v === 'boolean' ? v : undefined
}

/** 顶层 decision 只认 approve / block。 */
function topLevelDecisionOf(value) {
  return value === 'approve' || value === 'block' ? value : undefined
}

/** permissionDecision 只认 allow / deny / ask。 */
function permissionDecisionOf(value) {
  return value === 'allow' || value === 'deny' || value === 'ask' ? value : undefined
}

/**
 * 把结构化 stdout 折进 outcome（原地修改）。
 * `expectedEventName` 守卫 `hookSpecificOutput`：字段缺失或与当前事件不符时丢弃该块
 * 的事件级字段（与官方 codec 同语义）。
 */
function applyStructured(output, parsed, expectedEventName) {
  const cont = boolField(parsed, 'continue')
  if (cont !== undefined) output.continue = cont
  const stopReason = strField(parsed, 'stopReason')
  if (stopReason !== undefined) output.stopReason = stopReason
  const sysMsg = strField(parsed, 'systemMessage')
  if (sysMsg !== undefined) output.systemMessage = sysMsg
  const topDecision = topLevelDecisionOf(strField(parsed, 'decision'))
  if (topDecision !== undefined) output.decision = topDecision
  const topReason = strField(parsed, 'reason')
  if (topReason !== undefined) output.reason = topReason

  const hso = isObject(parsed.hookSpecificOutput) ? parsed.hookSpecificOutput : undefined
  if (!hso) return
  const eventName = strField(hso, 'hookEventName')
  if (eventName !== undefined) output.hookEventName = eventName
  if (expectedEventName !== undefined && eventName !== expectedEventName) return
  const permission = permissionDecisionOf(strField(hso, 'permissionDecision'))
  if (permission !== undefined) output.decision = permission
  const permissionReason = strField(hso, 'permissionDecisionReason')
  if (permissionReason !== undefined) output.reason = permissionReason
  const addCtx = strField(hso, 'additionalContext')
  if (addCtx !== undefined) output.additionalContext = addCtx
  const updated = isObject(hso.updatedInput) ? hso.updatedInput : undefined
  if (updated !== undefined) output.updatedInput = updated
}

/**
 * 解码 hook 进程结果。全函数，永不抛。
 * exit 2 = 阻断（stderr 作理由）；exit 0 且 stdout 以 `{` 开头才尝试解析 JSON；
 * 其余情况是非阻断失败。
 */
function parseHookOutput(exitCode, stdout, stderr, expectedEventName) {
  const trimmedErr = String(stderr == null ? '' : stderr).trim()
  const trimmedOut = String(stdout == null ? '' : stdout).trim()
  const output = { exitCode, stderr: trimmedErr, stdout: trimmedOut }
  if (exitCode === BLOCKING_EXIT_CODE) {
    output.decision = 'block'
    if (trimmedErr.length > 0) output.reason = trimmedErr
  }
  if (exitCode === 0 && trimmedOut.startsWith('{')) {
    let parsed
    try {
      const candidate = JSON.parse(trimmedOut)
      parsed = isObject(candidate) ? candidate : undefined
    } catch {
      parsed = undefined
    }
    if (parsed) applyStructured(output, parsed, expectedEventName)
  }
  return output
}

/** 单个 hook 的 decision 排序：deny > ask > allow。 */
function rank(decision) {
  switch (decision) {
    case 'deny':
    case 'block':
      return 3
    case 'ask':
      return 2
    case 'approve':
    case 'allow':
      return 1
    default:
      return 0
  }
}

/** 排名折回枚举。 */
function decisionForRank(maxRank) {
  switch (maxRank) {
    case 3:
      return 'deny'
    case 2:
      return 'ask'
    case 1:
      return 'allow'
    default:
      return 'none'
  }
}

/**
 * 把同一事件下所有匹配 hook 的输出折成一份最严结果。
 * 权限取 `deny > ask > allow`；`continue:false` 粘住首个；additionalContext 按顺序累积。
 */
function mergeHookOutputs(outputs) {
  let maxRank = 0
  const reasonsByRank = new Map()
  let stop = false
  let stopReason
  const additionalContext = []
  const systemMessages = []
  for (const out of outputs) {
    const r = rank(out.decision)
    if (r > maxRank) maxRank = r
    if ((r === 3 || r === 2) && out.reason !== undefined && out.reason.length > 0) {
      const list = reasonsByRank.get(r) || []
      list.push(out.reason)
      reasonsByRank.set(r, list)
    }
    if (out.continue === false && !stop) {
      stop = true
      if (out.stopReason !== undefined) stopReason = out.stopReason
    }
    if (out.additionalContext !== undefined && out.additionalContext.length > 0) {
      additionalContext.push(out.additionalContext)
    }
    if (out.systemMessage !== undefined && out.systemMessage.length > 0) systemMessages.push(out.systemMessage)
  }
  const reasons = reasonsByRank.get(maxRank) || []
  return {
    decision: decisionForRank(maxRank),
    ...(reasons.length > 0 ? { reason: reasons.join('\n\n') } : {}),
    stop,
    ...(stopReason !== undefined ? { stopReason } : {}),
    additionalContext,
    systemMessages,
  }
}

/** 把内容块拍平成文本（hook payload 的公共做法）。 */
function blocksToText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => isObject(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

/** 构造一条注入了 hook 上下文的 user 消息（形状对齐 dsh-llm 的 createUserMessage）。 */
function contextMessage(merged) {
  if (!merged.additionalContext || merged.additionalContext.length === 0) return undefined
  return {
    id: newMessageId(),
    role: 'user',
    content: merged.additionalContext.map((text) => ({ type: 'text', text })),
    source: CONTEXT_SOURCE,
  }
}

//#endregion

//#region 插件入口

/** 插件名。 */
export const name = 'dsh-hooks'
/**
 * 硬依赖：shell 跑 hook，fs 读配置 + 监听。
 * 两者在 desktop profile 均已挂载（shell 由 dsh-pwsh-sandbox 注册，fs 由 dsh-fs-sandbox 注册）。
 */
export const inject = ['shell', 'fs']
/** 供 tools/verify.mjs 做离线测试；Loader 只取 apply/name/inject，额外导出无副作用。 */
export const internals = {
  HOOK_EVENTS,
  DEFAULT_TIMEOUT_MS,
  NEGATIVE_TTL_MS,
  POSITIVE_TTL_MS,
  INVALIDATE_LOG_INTERVAL_MS,
  BLOCKING_EXIT_CODE,
  parentOf,
  joinPath,
  dshHome,
  substituteCommand,
  isMatchAll,
  matcherDiagnostic,
  matchesMatcher,
  parseHookConfig,
  mergeHookGroups,
  parseHookOutput,
  applyStructured,
  mergeHookOutputs,
  rank,
  decisionForRank,
  blocksToText,
  contextMessage,
}

/**
 * 插件入口。
 *
 * 设计要点：
 * - **按 projectRoot 缓存配置**，命中后每次工具调用只是 Map 查表，不做 fs I/O。
 *   缓存有两个过期时长：有 hook 的正结果 {@link POSITIVE_TTL_MS}、无 hook 的负结果
 *   {@link NEGATIVE_TTL_MS}；到期只是**允许**下一次事件重读，单次事件内不重复读。
 * - **所有监听器全程 try/catch，失败一律 delegate 给 next()**，绝不让 hook 拖垮工具调用。
 * - **detached 运行**（SessionStart / Subagent*）被跟踪，dispose 时 abort + drain，
 *   不让进程或迟到回调活过 fiber。
 */
export function apply(ctx) {
  const fsSvc = ctx.fs
  const shell = ctx.shell
  const log = ctx.logger

  /** projectRoot -> { promise, settled, expiresAt } */
  const projectCache = new Map()
  /** cwd -> projectRoot */
  const rootCache = new Map()
  /** 已经挂上 watcher 的路径 */
  const watched = new Set()
  /** 已经就"这条路径没挂上监听"告警过的路径（不提供 watch / 挂载失败都算），避免缓存周期刷屏 */
  const watchWarned = new Set()
  /** 失效日志的限流时间戳：path -> lastLoggedAt */
  const invalidateLoggedAt = new Map()
  /** projectRoot -> 上一次打日志的"事件集合"签名（只有变化才打，避免 TTL 重读刷屏） */
  const loadedSignature = new Map()
  /**
   * projectRoot -> 最近一次**成功**读取到的原始配置对象 `{userRaw, projectRaw, at}`。
   *
   * 存在的唯一理由：`error`（读到了但解析/IO 失败）**不允许**被当成"没有配置"。
   * 没有它的话，hooks.json 写坏一个字符会让全部 hook（含 deny 守卫）静默消失，
   * 而且文件一直是坏的就一直消失 —— 这是本插件最危险的一条失效路径。
   */
  const lastGood = new Map()
  /** `projectRoot\0path` -> 上一次已经告警过的错误文本（错误内容变了才再 warn 一次） */
  const lastErrorText = new Map()
  /** watcher 的 close 函数 */
  const watchers = []
  /** detached 运行的 promise */
  const detached = new Set()
  /** sessionId -> Stop hook 连续强制续跑次数 */
  const stopForced = new Map()
  /** runId -> 子 agent */
  const subagentChildren = new Map()

  const watcherAbort = new AbortController()
  let disposed = false

  ctx.effect(
    () => () => {
      disposed = true
      watcherAbort.abort(new Error('dsh-hooks disposed'))
      for (const close of watchers) {
        try {
          const r = close()
          if (r && typeof r.then === 'function') r.then(undefined, () => {})
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
  function warn(message) {
    try {
      if (log && typeof log.warn === 'function') log.warn(message)
    } catch {
      /* ignore */
    }
  }
  function info(message) {
    try {
      if (log && typeof log.info === 'function') log.info(message)
    } catch {
      /* ignore */
    }
  }

  /**
   * 限流的 info：同一个 key 在 {@link INVALIDATE_LOG_INTERVAL_MS} 内只打一条。
   * 只影响日志本身，不影响任何失效行为。
   */
  function infoThrottled(key, message) {
    const now = Date.now()
    const last = invalidateLoggedAt.get(key)
    if (last !== undefined && now - last < INVALIDATE_LOG_INTERVAL_MS) return
    invalidateLoggedAt.set(key, now)
    info(message)
  }

  /** 跟踪一个 detached 运行。 */
  function track(run) {
    detached.add(run)
    const settle = () => detached.delete(run)
    run.then(settle, settle)
  }

  /** 目标路径是否存在（任何类型都算存在，`.git` 在 worktree 里是文件）。 */
  async function exists(path) {
    try {
      const target = await fsSvc.resolve(path)
      const stat = await fsSvc.stat(target)
      return stat !== undefined
    } catch {
      return false
    }
  }

  /** 从任意异常里取一句可读的原因。 */
  function messageOf(error) {
    return String((error && error.message) || error)
  }

  /**
   * 文件确实不存在吗？
   *
   * 注意：编辑器原子保存（临时文件 + rename）的窗口里也会出现这个形状，
   * 所以它代表"这一刻没有这个文件"，**不代表**配置损坏。
   */
  function isMissingFile(message) {
    return /ENOENT|not found|no such file/i.test(message)
  }

  /**
   * 读一个 JSON 配置文件的**三态**结果。
   *
   *   { path, state: 'absent' }                    文件不存在 → 合法的"这份配置是空的"
   *   { path, state: 'ok', raw, version }          读到了且解析成功
   *   { path, state: 'error', message, version? }  读到了但解析/IO 失败 → **绝不许当成空配置**
   *
   * 为什么必须先分三态：把 `error` 折叠进"没有配置"，会让全部 hook（含 deny 守卫）
   * 在文件写坏一个字符时静默消失，而且一直消失。见 README「解析失败时保持上一份可用配置」。
   *
   * @param path 要读的绝对路径。
   * @returns 三态结果；**永不抛**。
   */
  async function readJsonFile(path) {
    let target
    let version
    try {
      target = await fsSvc.resolve(path)
      const stat = await fsSvc.stat(target)
      if (!stat || stat.type !== 'file') return { path, state: 'absent' }
      version = stat.version
    } catch (error) {
      const message = messageOf(error)
      return isMissingFile(message) ? { path, state: 'absent' } : { path, state: 'error', message }
    }

    let text
    try {
      text = await fsSvc.readText(target)
    } catch (error) {
      const message = messageOf(error)
      // 读的瞬间文件被删掉：按"不存在"处理，不当成损坏。
      return isMissingFile(message) ? { path, state: 'absent', version } : { path, state: 'error', message, version }
    }

    // Windows PowerShell 的 `Set-Content -Encoding utf8` 会写出带 BOM 的文件，而 JSON.parse
    // 遇到 BOM 会直接抛。剥掉它，否则手写的 hooks.json 会被静默当成"没有配置"。
    let parsed
    try {
      parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
    } catch (error) {
      return { path, state: 'error', message: messageOf(error), version }
    }
    // 顶层不是对象（`42` / `"text"` / `[...]` / `null`）同样是"读到了但不是合法配置"：
    // 当成"没有配置"的话，用户把文件改成数组也会静默停掉全部 hook。
    if (!isObject(parsed)) {
      return { path, state: 'error', message: '顶层不是 JSON 对象', version }
    }
    return { path, state: 'ok', raw: parsed, version }
  }

  /** 从 cwd 向上找最近的含 .git 的目录；找不到返回 cwd 本身。 */
  async function findProjectRoot(cwd) {
    let start = cwd
    try {
      const target = await fsSvc.resolve(cwd)
      if (target && target.displayPath) start = target.displayPath
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
  async function projectRootFor(cwd) {
    const key = String(cwd || '')
    const hit = rootCache.get(key)
    if (hit !== undefined) return hit
    const root = await findProjectRoot(key)
    rootCache.set(key, root)
    return root
  }

  /**
   * 给一个路径挂监听（幂等、尽力而为）。
   *
   * 可诊断性约定（这次修复的重点）：
   * - `ctx.fs` 没有 `watch()` 时**不再静默早退**，而是按 path 打一条 warn（每条路径一次），
   *   这样"没挂上"和"挂了但没事件"在日志里可区分。
   * - 挂载成功打一条 info，带上 path 和 stat 出来的类型（目录 / 文件 / 尚不存在）。
   * - 失效回调触发时打一条限流 info，明确写出是哪个 path 触发的。
   *
   * @param path 要监听的路径。
   * @param invalidate 变化时调用（丢掉缓存）；可能被调用多次，必须幂等。
   */
  async function ensureWatch(path, invalidate) {
    if (disposed || watched.has(path)) return
    if (!fsSvc || typeof fsSvc.watch !== 'function') {
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
        stat === undefined || stat === null
          ? '尚不存在（等待创建）'
          : stat.type === 'directory'
            ? '目录'
            : stat.type === 'file'
              ? '文件'
              : `其他类型 ${String(stat.type)}`
      const close = await fsSvc.watch(
        target,
        (error) => {
          if (error) warn(`dsh-hooks: 监听 ${path} 出错：${String(error)}`)
          infoThrottled(path, `dsh-hooks: 监听到变化 → 失效配置缓存（${path}）`)
          invalidate()
        },
        watcherAbort.signal,
      )
      if (typeof close === 'function') watchers.push(close)
      watchWarned.delete(path)
      info(`dsh-hooks: 已监听 ${path}（判定为${kind}）`)
    } catch (error) {
      // 路径尚不存在（还没建 .dsh / hooks.json）时这里会失败，属于预期；靠 TTL 兜底。
      // 同一路径只告警一次：正结果现在会按 TTL 周期重试，不能每个周期刷一条。
      watched.delete(path)
      if (!watchWarned.has(path)) {
        watchWarned.add(path)
        warn(`dsh-hooks: 无法监听 ${path}：${String((error && error.message) || error)}`)
      }
    }
  }

  /**
   * 读两个配置文件当前的**内容版本**（`ctx.fs.stat()` 的 `version`）。
   *
   * 真实 `ctx.fs` 的 `FsInfo.version` 形如 `dev:ino:size:mtimeNs:ctimeNs`，比 `readText`
   * 便宜得多，所以它适合当**失效主通道**：内容没变就不必重读。
   *
   * @returns `{user, project}`（每项是 version 字符串，或 `undefined` = 文件不存在）；
   *   provider 不返回 version / stat 抛错时整体返回 `undefined`（= 无法核对，退回 TTL 语义）。
   */
  async function readVersions(projectRoot) {
    const probe = async (path) => {
      try {
        const target = await fsSvc.resolve(path)
        const stat = await fsSvc.stat(target)
        if (!stat || stat.type !== 'file') return { known: true, version: undefined }
        // provider 没有 version：整条版本通道不可用。
        if (stat.version === undefined || stat.version === null) return { known: false }
        return { known: true, version: String(stat.version) }
      } catch (error) {
        // 文件不存在是"版本为空"这种已知状态；其它 IO 错误则无法判定。
        return isMissingFile(messageOf(error)) ? { known: true, version: undefined } : { known: false }
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
  function sameVersions(previous, next) {
    return previous !== undefined && previous.user === next.user && previous.project === next.project
  }

  /**
   * 加载一个 projectRoot 的合并配置（用户级 + 项目级），带缓存与并发去重。
   *
   * 失效通道（三层，按优先级）：
   *   1. **版本核对**（主通道，C2）：每次事件点读两个文件的 `stat().version`；没变就复用缓存
   *      （**连 TTL 都不必等**），变了就立刻重读（下一事件点生效，不必等 TTL）。
   *   2. **watcher**（加速器）：事件到达立即 `projectCache.delete()`，不等任何核对。
   *   3. **TTL**（兜底）：provider 不返回 version / stat 抛错时，退回"到期允许重读"的老语义。
   */
  function configFor(projectRoot) {
    const cached = projectCache.get(projectRoot)
    // 已经有并发加载在飞：直接共享它。
    if (cached !== undefined && !cached.settled) return cached.promise

    const probe = cached === undefined ? Promise.resolve(undefined) : readVersions(projectRoot)
    return probe.then((versions) => {
      const current = projectCache.get(projectRoot)
      // 核对期间可能已经有另一个调用建了"在飞"的条目：共享它，别重复读。
      if (current !== undefined && !current.settled) return current.promise
      if (current !== undefined && current.settled) {
        // 主通道：两次快照完全一致 → 内容没变，直接用（并顺延 TTL，避免每次都重新核对）。
        if (versions !== undefined && sameVersions(current.versions, versions)) {
          current.expiresAt = Date.now() + (current.hasHooks === true ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS)
          return current.promise
        }
        // 兜底通道：拿不到版本 → 原来的 TTL 语义（未到期就复用）。
        if (versions === undefined && Date.now() < current.expiresAt) return current.promise
      }
      // 版本变了 / 过期了 / 首次加载：真正读一次。
      projectCache.delete(projectRoot)
      return loadConfig(projectRoot)
    })
  }

  /** 真正读+解析一次配置（缓存未命中时走这里）。 */
  function loadConfig(projectRoot) {
    const userPath = joinPath(dshHome(), HOOKS_FILE)
    const projectPath = joinPath(projectRoot, PROJECT_DIR, HOOKS_FILE)
    const entry = { settled: false, expiresAt: Infinity, promise: undefined }

    entry.promise = (async () => {
      const [userRead, projectRead] = await Promise.all([readJsonFile(userPath), readJsonFile(projectPath)])

      // ── fail-open 修复点 ────────────────────────────────────────────────
      // 任一侧"读到了但坏了"都**不等于**"没有配置"：有最近一次成功的结果就继续用它。
      // 修之前这里是把 undefined 直接当空配置，于是写坏一个字符就静默停掉全部 hook。
      const failures = []
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
      const stale = failures.length > 0 && previous !== undefined
      if (stale) {
        infoThrottled(
          `${projectRoot}\u0000stale`,
          `dsh-hooks: 配置当前读不出来，继续沿用上一份可用配置（${projectPath}）`,
        )
      }

      const pick = (read) => (read.state === 'ok' ? read.raw : undefined)
      /** 记录用的版本字符串；取不到就记 `undefined`（= 文件不存在或无法判定）。 */
      const versionOf = (read) => (read.version === undefined || read.version === null ? undefined : String(read.version))
      // stale 时**两侧都**取上一份：只换一侧会合成出一份从未存在过的配置。
      const userRaw = stale ? previous.userRaw : pick(userRead)
      const projectRaw = stale ? previous.projectRaw : pick(projectRead)

      const vars = { projectDir: projectRoot }
      const user = userRaw ? parseHookConfig(userRaw, vars) : { groups: {}, skipped: [], errors: [] }
      const project = projectRaw ? parseHookConfig(projectRaw, vars) : { groups: {}, skipped: [], errors: [] }

      for (const skipped of [...user.skipped, ...project.skipped]) {
        warn(`dsh-hooks: 跳过不支持的 ${JSON.stringify(skipped.type)} handler（事件 ${skipped.event}）—— 只运行 command hook`)
      }
      for (const message of [...user.errors, ...project.errors]) warn(`dsh-hooks: ${message}`)

      const groups = mergeHookGroups(user.groups, project.groups)
      const summary = HOOK_EVENTS.filter((event) => groups[event]).join(',')
      const hasHooks = summary.length > 0

      if (failures.length === 0) {
        // 只有"两侧都没出错"才算一次有效读取，允许刷新 last-good。
        lastGood.set(projectRoot, { userRaw: pick(userRead), projectRaw: pick(projectRead), at: Date.now() })
        for (const failurePath of [userPath, projectPath]) {
          lastErrorText.delete(`${projectRoot}\u0000${failurePath}`)
        }
      }

      // 只在"事件集合变了"时打日志：正结果现在会按 TTL 周期性重读，不能每次都刷。
      const signature = `${projectPath}\u0000${summary}`
      if (loadedSignature.get(projectRoot) !== signature) {
        loadedSignature.set(projectRoot, signature)
        const suffix = stale ? '（沿用上一份可用配置）' : ''
        info(`dsh-hooks: ${projectPath} ${hasHooks ? '已加载事件 ' + summary : '无可用 hook'}${suffix}`)
      }
      entry.settled = true
      // 读不出来时用最短的负 TTL：错一次就尽快再试，别把坏状态缓存 4 秒。
      entry.expiresAt = Date.now() + (failures.length > 0 || !hasHooks ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS)
      // 版本快照**无论成败都记**：坏文件没被改动时，下一个事件点就能靠"版本没变"直接复用
      // 这份 last-good 结果，而不是每次事件点都重读一遍坏文件。
      entry.versions = {
        user: versionOf(userRead),
        project: versionOf(projectRead),
      }
      entry.hasHooks = hasHooks
      return { groups, projectPath, userPath }
    })().catch((error) => {
      warn(`dsh-hooks: 加载 ${projectRoot} 的 hook 配置失败：${messageOf(error)}`)
      entry.settled = true
      entry.expiresAt = Date.now() + NEGATIVE_TTL_MS
      // 整体失败时不去猜版本：两个都记 undefined，让"两个文件都不存在"这一种情况仍能复用，
      // 其余情况（文件在、但我们读失败）会在下一个事件点重试。
      entry.versions = { user: undefined, project: undefined }
      entry.hasHooks = false
      return { groups: {}, projectPath, userPath }
    })

    projectCache.set(projectRoot, entry)

    // 监听器一旦挂上就长期有效（`watched` 去重，不会因为 TTL 重读而重复挂）：
    // 失效只需丢掉缓存，下一次访问会重新读文件；即使监听器根本没挂上，
    // POSITIVE_TTL_MS / NEGATIVE_TTL_MS 也会把旧缓存顶掉。
    track(
      (async () => {
        // 目录先于文件：`.dsh` 目录存在时，`hooks.json` 的创建与修改都能被它捕获。
        await ensureWatch(joinPath(projectRoot, PROJECT_DIR), () => projectCache.delete(projectRoot))
        await ensureWatch(projectPath, () => projectCache.delete(projectRoot))
        // 用户级配置变化影响所有项目。
        await ensureWatch(userPath, () => projectCache.clear())
      })(),
    )

    return entry.promise
  }

  /**
   * 取**调用会话**的沙箱策略，用来透传给 hook 子进程。
   *
   * 与 dsh-tool-pwsh 的 `resolveSandboxPolicy(exec)` 同构：
   *   `sandboxPolicy?.resolve(agent === undefined ? {} : { session: agent.session })`
   * 返回 `{mode, workspaceRoot, sessionId?}`，或 `undefined`（服务没挂 / 抛错）。
   *
   * 返回 `undefined` 时调用方**不传**这个字段 → hook 回退到部署策略（修复前的行为）。
   * 这是刻意的降级：拿不到策略只应该让 hook"少点权限"，不该让 hook 跑不起来。
   */
  function sandboxPolicyFor(agent) {
    const sandboxPolicy = ctx.get('sandboxPolicy')
    if (!sandboxPolicy || typeof sandboxPolicy.resolve !== 'function') return undefined
    try {
      const session = agent && agent.session
      const policy = sandboxPolicy.resolve(session === undefined ? {} : { session })
      return policy === null || typeof policy !== 'object' ? undefined : policy
    } catch (error) {
      warn(`dsh-hooks: 解析沙箱策略失败，本次 hook 回退到部署策略：${String((error && error.message) || error)}`)
      return undefined
    }
  }

  /** 解析一次会话的上下文：cwd / projectRoot / 合并配置 / 沙箱策略。 */
  async function contextFor(agent) {
    const cwd = (agent && agent.session && agent.session.header && agent.session.header.cwd) || process.cwd()
    const projectRoot = await projectRootFor(cwd)
    const config = await configFor(projectRoot)
    return { cwd, projectRoot, config, sandboxPolicy: sandboxPolicyFor(agent) }
  }

  /**
   * 从工具调用里取出调用方 agent。
   *
   * `ToolExecutionInput.agent` 是**可选**字段（见 tools/pre-execute 的类型声明）。即使它缺失，
   * 发起调用的 agent 仍可由 `ctx.agents.currentInitiator()` 拿到 —— 该服务的设计目的就是
   * "在进程内的异步驱动链上携带发起 agent"。少了这层兜底，`tools/*` 事件会退化成用
   * `process.cwd()` 解析项目根，而那通常是 app 的启动目录而不是项目目录，hook 就会静默失效。
   */
  function agentOf(exec) {
    if (exec && exec.agent) return exec.agent
    const agents = ctx.get('agents')
    if (agents && typeof agents.currentInitiator === 'function') {
      try {
        return agents.currentInitiator()
      } catch {
        return undefined
      }
    }
    return undefined
  }

  /** 跑一个事件点上所有匹配的 hook（串行，配置顺序），返回折叠后的结果。 */
  async function runPoint(context, point, matchQuery, payload, signal) {
    const groups = (context.config.groups && context.config.groups[point]) || []
    if (groups.length === 0) return mergeHookOutputs([])
    // 调用会话的沙箱策略；undefined = 拿不到，交由 shell 回退到部署策略。
    const sandboxPolicy = context.sandboxPolicy
    const sandboxLabel = sandboxPolicy && sandboxPolicy.mode ? String(sandboxPolicy.mode) : 'deployment'
    const outputs = []
    for (const group of groups) {
      if (!matchesMatcher(group.matcher, matchQuery)) continue
      for (const hook of group.hooks) {
        const started = Date.now()
        const timeoutMs = hook.timeoutSec !== undefined ? hook.timeoutSec * 1000 : DEFAULT_TIMEOUT_MS
        let output
        try {
          const spec = shell.resolve({
            command: hook.command,
            workdir: context.cwd,
            timeoutMs,
            stdin: JSON.stringify(payload) + '\n',
            signal,
            env: { DSH_PROJECT_DIR: context.projectRoot },
            // 关键：hook 子进程按**调用会话**的档位与会话 cwd 跑，而不是部署默认档。
            // 拿不到策略时整条字段省略（回退部署策略），绝不让 hook 跑不起来。
            ...(sandboxPolicy !== undefined ? { sandboxPolicy } : {}),
          })
          const execution = await shell.execute(spec)
          const result = await execution.result()
          output = parseHookOutput(
            result.exitCode === null || result.exitCode === undefined ? undefined : result.exitCode,
            result.stdout && result.stdout.text,
            result.stderr && result.stderr.text,
            point,
          )
        } catch (error) {
          // 起不来 / 崩溃 / 基础设施失败：非阻断，只记。
          output = parseHookOutput(undefined, '', String((error && error.message) || error), point)
        }
        const durationMs = Date.now() - started
        info(
          `dsh-hooks: [${point}] ${JSON.stringify(hook.command)} exit=${
            output.exitCode === undefined ? 'spawn-failed' : output.exitCode
          } decision=${output.decision || 'pass'} sandbox=${sandboxLabel} ${durationMs}ms`,
        )
        outputs.push(output)
      }
    }
    return mergeHookOutputs(outputs)
  }

  //#region payload 构造（对齐官方桥的字段形状）

  function basePayload(agent, event, context) {
    return {
      session_id: (agent && agent.session && agent.session.header && agent.session.header.id) || '',
      // DSH 的会话日志是 zstd 压缩的，shell 脚本读不了，这里与官方桥保持一致恒为空串。
      transcript_path: '',
      cwd: context.cwd,
      hook_event_name: event,
    }
  }

  function sessionStartPayload(agent, source, context) {
    return { ...basePayload(agent, 'SessionStart', context), source }
  }

  function promptPayload(agent, content, context) {
    return { ...basePayload(agent, 'UserPromptSubmit', context), prompt: blocksToText(content) }
  }

  function preToolPayload(exec, context) {
    return {
      ...basePayload(exec.agent, 'PreToolUse', context),
      tool_name: exec.name,
      tool_input: exec.arguments,
      tool_use_id: exec.callId,
    }
  }

  function postToolPayload(exec, result, context) {
    return {
      ...basePayload(exec.agent, 'PostToolUse', context),
      tool_name: exec.name,
      tool_input: exec.arguments,
      tool_use_id: exec.callId,
      tool_response: blocksToText(result && result.content),
    }
  }

  function stopPayload(agent, context) {
    return { ...basePayload(agent, 'Stop', context), stop_hook_active: false }
  }

  function subagentPayload(event, info, child, context) {
    return {
      ...basePayload(child || undefined, event, context),
      agent_id: info.id,
      agent_type: SUBAGENT_TYPE,
      ...(event === 'SubagentStop' ? { stop_hook_active: false } : {}),
    }
  }

  //#endregion

  //#region 事件接线（与官方桥的 7 个扩展点一一对应）

  /** SessionStart：注入上下文。serial 事件，会 await。 */
  ctx.on('agent/created', async ({ agent, source, signal }) => {
    try {
      const context = await contextFor(agent)
      if (!context.config.groups.SessionStart) return
      const merged = await runPoint(context, 'SessionStart', source, sessionStartPayload(agent, source, context), signal)
      const message = contextMessage(merged)
      if (message && agent && typeof agent.inject === 'function') agent.inject(message)
    } catch (error) {
      warn(`dsh-hooks: SessionStart 失败：${String((error && error.message) || error)}`)
    }
  })

  /** UserPromptSubmit：可拒绝整条 prompt，或追加上下文。 */
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    let merged
    try {
      const context = await contextFor(agent)
      if (!context.config.groups.UserPromptSubmit || !Array.isArray(messages) || messages.length === 0) return next()
      const content = messages.flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      merged = await runPoint(context, 'UserPromptSubmit', '', promptPayload(agent, content, context), signal)
      if (merged.decision === 'deny') return { kind: 'reject' }
    } catch (error) {
      warn(`dsh-hooks: UserPromptSubmit 失败：${String((error && error.message) || error)}`)
      return next()
    }
    const downstream = await next()
    const message = contextMessage(merged)
    if (!message || !downstream || downstream.kind !== 'enter') return downstream
    return { ...downstream, messages: [...downstream.messages, message] }
  })

  /** PreToolUse：deny 阻断、ask 转审批、其余放行。 */
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const context = await contextFor(agentOf(exec))
      if (!context.config.groups.PreToolUse) return next()
      const merged = await runPoint(context, 'PreToolUse', exec.name, preToolPayload(exec, context), exec.signal)
      if (merged.decision === 'deny') {
        return { kind: 'deny', reason: merged.reason || 'blocked by PreToolUse hook (dsh-hooks)' }
      }
      if (merged.decision === 'ask') {
        return { kind: 'ask', ...(merged.reason !== undefined ? { reason: merged.reason } : {}) }
      }
    } catch (error) {
      warn(`dsh-hooks: PreToolUse 失败：${String((error && error.message) || error)}`)
    }
    return next()
  })

  /** PostToolUse：block 带 feedback，或追加上下文。 */
  ctx.on('tools/post-execute', async (exec, result, next) => {
    let merged
    let message
    try {
      const context = await contextFor(agentOf(exec))
      if (!context.config.groups.PostToolUse) return next()
      merged = await runPoint(context, 'PostToolUse', exec.name, postToolPayload(exec, result, context), exec.signal)
      message = contextMessage(merged)
      if (merged.decision === 'deny') {
        return {
          kind: 'block',
          feedback: [{ type: 'text', text: merged.reason || 'blocked by PostToolUse hook (dsh-hooks)' }],
          ...(message ? { additionalContexts: [message] } : {}),
        }
      }
    } catch (error) {
      warn(`dsh-hooks: PostToolUse 失败：${String((error && error.message) || error)}`)
      return next()
    }
    const downstream = await next()
    if (!message) return downstream
    return { ...downstream, additionalContexts: [message, ...((downstream && downstream.additionalContexts) || [])] }
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
      if (!context.config.groups.Stop) return
      const sessionId = (agent && agent.session && agent.session.header && agent.session.header.id) || ''
      const merged = await runPoint(context, 'Stop', '', stopPayload(agent, context), signal)
      if (merged.decision !== 'deny') {
        stopForced.delete(sessionId)
        return
      }
      const forced = stopForced.get(sessionId) || 0
      if (forced >= STOP_FORCE_LIMIT) {
        warn(`dsh-hooks: Stop hook 已连续强制续跑 ${forced} 次，达到上限 ${STOP_FORCE_LIMIT}，本次放行以免死循环`)
        stopForced.delete(sessionId)
        return
      }
      stopForced.set(sessionId, forced + 1)
      agent.steer({
        id: newMessageId(),
        role: 'user',
        content: [{ type: 'text', text: merged.reason || 'continue: blocked by Stop hook (dsh-hooks)' }],
        source: CONTEXT_SOURCE,
      })
    } catch (error) {
      warn(`dsh-hooks: Stop 失败：${String((error && error.message) || error)}`)
    }
  })

  /** SubagentStart：向进程内子 agent 注入上下文（detached）。 */
  ctx.on('subagent/start', (info) => {
    try {
      const agents = ctx.get('agents')
      const child = agents && typeof agents.get === 'function' ? agents.get(info.id) : undefined
      if (child !== undefined) subagentChildren.set(info.runId, child)
      const run = (async () => {
        const anchor = child && child.session ? child : undefined
        const cwd = (anchor && anchor.session.header && anchor.session.header.cwd) || process.cwd()
        const projectRoot = await projectRootFor(cwd)
        const config = await configFor(projectRoot)
        if (!config.groups.SubagentStart) return
        const context = { cwd, projectRoot, config, sandboxPolicy: sandboxPolicyFor(anchor) }
        const merged = await runPoint(
          context,
          'SubagentStart',
          SUBAGENT_TYPE,
          subagentPayload('SubagentStart', info, anchor, context),
          undefined,
        )
        const message = contextMessage(merged)
        if (message && child && typeof child.inject === 'function') child.inject(message)
      })().catch((error) => {
        warn(`dsh-hooks: SubagentStart 失败：${String((error && error.message) || error)}`)
      })
      track(run)
    } catch (error) {
      warn(`dsh-hooks: SubagentStart 接线失败：${String((error && error.message) || error)}`)
    }
  })

  /** SubagentStop：只观察，不阻断（harness 的 subagent seam 没有 veto 能力）。 */
  ctx.on('subagent/end', (info) => {
    try {
      const agents = ctx.get('agents')
      const child =
        subagentChildren.get(info.runId) || (agents && typeof agents.get === 'function' ? agents.get(info.id) : undefined)
      subagentChildren.delete(info.runId)
      const run = (async () => {
        const anchor = child && child.session ? child : undefined
        const cwd = (anchor && anchor.session.header && anchor.session.header.cwd) || process.cwd()
        const projectRoot = await projectRootFor(cwd)
        const config = await configFor(projectRoot)
        if (!config.groups.SubagentStop) return
        const context = { cwd, projectRoot, config, sandboxPolicy: sandboxPolicyFor(anchor) }
        await runPoint(context, 'SubagentStop', SUBAGENT_TYPE, subagentPayload('SubagentStop', info, anchor, context), undefined)
      })().catch((error) => {
        warn(`dsh-hooks: SubagentStop 失败：${String((error && error.message) || error)}`)
      })
      track(run)
    } catch (error) {
      warn(`dsh-hooks: SubagentStop 接线失败：${String((error && error.message) || error)}`)
    }
  })

  //#endregion
}

//#endregion

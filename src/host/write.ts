/**
 * 写路径：**定点操作 → 新文档 + 保留性证明**。
 *
 * 全部是纯函数（不碰 fs），所以可以直接单测；真正落盘在数据面里用
 * `ctx.fs.writeText(..., { kind: 'replaceIfVersion', version })`（原子替换 + 乐观锁）。
 *
 * ## 为什么不是"解析 → 重建 → 写回"
 * 那是丢字段的老事故来源（`_comment` 这类未知键会在重建时消失）。这里的机制是
 * **克隆整份原始 JSON 树、只改目标那一个节点** —— 未知键之所以能留下，是**结构上不可能丢**，
 * 而不是"重建之后比对一下"。比对仍然要做（{@link preservationProblem}），因为它是
 * 对"我声明改了什么"这份声明的检查：声明错了（比如忘了 `setHookTimeout(null)` 是删键）
 * 会当场被抓住并**拒写**。
 *
 * ## 寻址用的是**文件下标**
 * `parsedIndex !== rawIndex`（解析会跳过非 command handler、没有 command 的条目、matcher
 * 非法的 group）。所以 op 里的 `groupIndex` / `hookIndex` 一律是文件里的真实下标 —— 与
 * `ParsedGroup.rawIndex` / `ParsedHook.rawIndex` 对应。寻址错了就是"静默改错用户配置"，
 * 比写失败严重得多，所以越界一律 `not-found` 拒写。
 */

import { HOOK_EVENTS, type HookEvent } from '../shared/constants.ts'
import { isObject, isUnknownArray } from '../shared/guards.ts'
import { hooksMapOf } from '../shared/protocol.ts'

/** 两个配置文件（与 `$DSH_HOME/hooks.json` / `<projectRoot>/.dsh/hooks.json` 对应）。 */
export type FileKind = 'project' | 'user'

/** 会改动文档的操作。`createFile` 不改文档，单独处理（见 `HooksRequest`）。 */
export type HooksOp =
  | {
      op: 'setHookCommand'
      file: FileKind
      event: HookEvent
      groupIndex: number
      hookIndex: number
      command: string
    }
  | {
      op: 'setHookTimeout'
      file: FileKind
      event: HookEvent
      groupIndex: number
      hookIndex: number
      /** `null` = 删掉 timeout（回到默认 600s）。 */
      timeoutSec: number | null
    }
  | {
      op: 'setHookDisabled'
      file: FileKind
      event: HookEvent
      groupIndex: number
      hookIndex: number
      disabled: boolean
    }
  | { op: 'setGroupMatcher'; file: FileKind; event: HookEvent; groupIndex: number; matcher: string | null }
  | {
      op: 'addHook'
      file: FileKind
      event: HookEvent
      groupIndex: number
      command: string
      timeoutSec: number | null
    }
  | { op: 'removeHook'; file: FileKind; event: HookEvent; groupIndex: number; hookIndex: number }
  | {
      op: 'moveHook'
      file: FileKind
      event: HookEvent
      groupIndex: number
      hookIndex: number
      /** -1 = 上移，+1 = 下移（顺序即执行顺序，所以这是个语义操作）。 */
      direction: -1 | 1
    }
  | { op: 'removeGroup'; file: FileKind; event: HookEvent; groupIndex: number }

/** 客户端能发的完整请求体。 */
export type HooksRequest = HooksOp | { op: 'createFile'; file: FileKind }

/** 拒写的机器可读原因（页面据此给出各自的文案，而不是一句"保存失败"）。 */
export type OpFailure = 'bad-op' | 'not-found' | 'out-of-range' | 'not-preservable'

/** 有意改动的一处：比较时用它把两边"改动的那一处"抹掉，剩下的必须逐字段相等。 */
export interface Change {
  /** 从文档根算起的路径，如 `['hooks','PreToolUse',0,'hooks',1,'command']`。 */
  path: Array<string | number>
  /** `key`：忽略这个键；`index`：整个数组元素拿掉。 */
  mode: 'key' | 'index'
  /**
   * 这一处在哪一侧存在。
   *
   * - 缺省 / `both`：两侧都抹掉它 —— 适用于"改键值""新增元素""交换两个元素"。
   * - `original`：**只有原文**有这一项 —— 删除类操作必须用这个。
   *
   * ⚠️ 这个方向不能省：`removeHook` 若写成 `both`，抹掉的动作会在**新文档**里又把
   * `hooks[h]`（此时已经是"后面那条"了）删一次，于是两边对不上、被自己的证明拒写。
   * 第一版就是这么写的，是 `W：…只动目标` 那条断言把它抓出来的。
   */
  area?: 'both' | 'original'
}

/** 一次成功改写的产物。 */
export interface OpApplied {
  doc: Record<string, unknown>
  changes: Change[]
}

/** 一次改写的结果。 */
export type OpResult = { ok: true; applied: OpApplied } | { ok: false; reason: OpFailure }

/** 文件风格（按原文件探测，写回时保持）。 */
export interface DocStyle {
  indent: string
  eol: '\n' | '\r\n'
  finalNewline: boolean
}

/**
 * 探测文件的风格。
 *
 * JSON 没有注释，格式上只有三件事需要保持：缩进、行尾、结尾换行。按"第一处行首空白"取缩进；
 * 探测不到就退回 2 空格（同时也是我们自己的输出风格，于是我们写的文件是**不动点**：
 * 再解析再序列化与原文逐字节相同 → 后续编辑的 diff 只会是最小的一处）。
 */
export function detectStyle(text: string): DocStyle {
  const indentMatch = text.match(/^([ \t]+)"/m)
  const captured = indentMatch === null ? undefined : indentMatch[1]
  return {
    indent: captured !== undefined && captured.length > 0 ? captured : '  ',
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    finalNewline: text.endsWith('\n'),
  }
}

/** 把 2 空格缩进的 JSON 换成目标缩进（JSON.stringify 只支持空格数，不支持 tab）。 */
function reindent(text: string, indent: string): string {
  return text.replace(/^( +)/gm, (spaces) => indent.repeat(Math.floor(spaces.length / 2)))
}

/** 按探测到的风格序列化。 */
export function serialize(doc: Record<string, unknown>, style: DocStyle): string {
  const pretty = JSON.stringify(doc, null, 2)
  const body = style.indent === '  ' ? pretty : reindent(pretty, style.indent)
  const withEol = style.eol === '\n' ? body : body.split('\n').join(style.eol)
  return style.finalNewline ? withEol + style.eol : withEol
}

/** 默认风格（我们自己的输出风格，也是新建文件用的风格）。 */
export const DEFAULT_STYLE: DocStyle = { indent: '  ', eol: '\n', finalNewline: true }

/** 新文件的内容：一个自解释的空配置。 */
export function starterText(style: DocStyle): string {
  return serialize({ hooks: {} }, style)
}

/** 值域只有 JSON，所以 JSON 往返就是安全的深拷贝（不引第三方库）。 */
function cloneJson(value: unknown): unknown {
  const cloned: unknown = JSON.parse(JSON.stringify(value))
  return cloned
}

/** 递归按键排序的规范化字符串（比较只看语义，不看键的书写顺序）。 */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (isUnknownArray(value)) return value.map(sortKeys)
  if (isObject(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key])
    return out
  }
  return value
}

/** 沿路径走到父节点（拿不到就 undefined）。 */
function parentAt(root: unknown, path: Array<string | number>): unknown {
  let node: unknown = root
  for (const key of path.slice(0, -1)) {
    if (isUnknownArray(node)) {
      const index = typeof key === 'number' ? key : Number(key)
      node = node[index]
    } else if (isObject(node)) {
      node = node[String(key)]
    } else {
      return undefined
    }
  }
  return node
}

/** 按 `changes` 把"有意改动之处"从**指定那一侧**抹掉。 */
function strip(value: unknown, changes: Change[], side: 'original' | 'updated'): unknown {
  const clone = cloneJson(value)
  const active = changes.filter((change) => (change.area ?? 'both') === 'both' || change.area === side)
  // index 先做，且同一数组内按下标从大到小，避免边删边错位。我们的 op 至多同时涉及两个 index
  // （moveHook 的相邻两条），不同数组之间互不影响。
  const indexes = active
    .filter((change) => change.mode === 'index')
    .slice()
    .sort((left, right) => Number(right.path[right.path.length - 1]) - Number(left.path[left.path.length - 1]))
  for (const change of indexes) {
    const parent = parentAt(clone, change.path)
    const last = change.path[change.path.length - 1]
    if (isUnknownArray(parent) && typeof last === 'number' && last >= 0 && last < parent.length) parent.splice(last, 1)
  }
  for (const change of active.filter((one) => one.mode === 'key')) {
    const parent = parentAt(clone, change.path)
    const last = change.path[change.path.length - 1]
    // 用 `Reflect.deleteProperty` 而不是 `delete parent[last]`：键是动态算出来的，而
    // `no-dynamic-delete` 禁的正是后者那种写法。语义一致（都删可配置属性）。
    if (isObject(parent) && typeof last === 'string') Reflect.deleteProperty(parent, last)
  }
  return clone
}

/**
 * 保留性检查：抹掉"有意改动之处"之后，两份文档必须**逐字段相等**。
 *
 * 返回 `undefined` = 通过；否则返回人类可读的问题描述，调用方**必须拒写**。
 */
export function preservationProblem(
  original: Record<string, unknown>,
  updated: Record<string, unknown>,
  changes: Change[],
): string | undefined {
  const before = canonical(strip(original, changes, 'original'))
  const after = canonical(strip(updated, changes, 'updated'))
  if (before === after) return undefined
  // 给一条能直接看出"哪一层开始不同"的线索，而不是甩两个巨型 JSON。
  const length = Math.min(before.length, after.length)
  let at = 0
  while (at < length && before[at] === after[at]) at++
  return `改写会动到目标之外的字段（第 ${at} 字节起：…${before.slice(Math.max(0, at - 40), at + 40)} ≠ …${after.slice(
    Math.max(0, at - 40),
    at + 40,
  )}）`
}

/** 取事件数组（不存在时返回 undefined）。 */
function eventListOf(doc: Record<string, unknown>, event: HookEvent): unknown[] | undefined {
  const list = hooksMapOf(doc)[event]
  return isUnknownArray(list) ? list : undefined
}

/** 取一个 group 对象（下标越界 / 形状不对都返回 undefined）。 */
function groupAt(
  doc: Record<string, unknown>,
  event: HookEvent,
  groupIndex: number,
): Record<string, unknown> | undefined {
  const list = eventListOf(doc, event)
  if (list === undefined || groupIndex < 0 || groupIndex >= list.length) return undefined
  const group = list[groupIndex]
  return isObject(group) ? group : undefined
}

/** 取一个 hook 对象。 */
function hookAt(
  doc: Record<string, unknown>,
  event: HookEvent,
  groupIndex: number,
  hookIndex: number,
): Record<string, unknown> | undefined {
  const group = groupAt(doc, event, groupIndex)
  if (group === undefined || !isUnknownArray(group.hooks)) return undefined
  if (hookIndex < 0 || hookIndex >= group.hooks.length) return undefined
  const hook = group.hooks[hookIndex]
  return isObject(hook) ? hook : undefined
}

/** 文档里"事件映射"那一层的路径前缀（比较时要把这段也带上）。 */
function mapPath(doc: Record<string, unknown>): Array<string | number> {
  return hooksMapOf(doc) === doc ? [] : ['hooks']
}

/** 目标 hook 的路径。 */
function hookPath(
  doc: Record<string, unknown>,
  op: { event: HookEvent; groupIndex: number; hookIndex: number },
): Array<string | number> {
  return [...mapPath(doc), op.event, op.groupIndex, 'hooks', op.hookIndex]
}

/** 目标 group 的路径。 */
function groupPath(doc: Record<string, unknown>, op: { event: HookEvent; groupIndex: number }): Array<string | number> {
  return [...mapPath(doc), op.event, op.groupIndex]
}

/**
 * 应用一个定点操作。
 *
 * **不改 `op` 之外的任何东西**：先克隆，再只动目标节点。返回值里的 `changes` 是"我声明改了
 * 什么"，交给 {@link preservationProblem} 验证。
 */
export function applyOp(doc: Record<string, unknown>, op: HooksOp): OpResult {
  const next = cloneJson(doc)
  if (!isObject(next)) return { ok: false, reason: 'bad-op' }

  switch (op.op) {
    case 'setHookCommand': {
      if (op.command.length === 0) return { ok: false, reason: 'bad-op' }
      const hook = hookAt(next, op.event, op.groupIndex, op.hookIndex)
      if (hook === undefined) return { ok: false, reason: 'not-found' }
      hook.command = op.command
      return { ok: true, applied: { doc: next, changes: [{ path: [...hookPath(next, op), 'command'], mode: 'key' }] } }
    }

    case 'setHookTimeout': {
      const hook = hookAt(next, op.event, op.groupIndex, op.hookIndex)
      if (hook === undefined) return { ok: false, reason: 'not-found' }
      if (op.timeoutSec === null) delete hook.timeout
      else if (op.timeoutSec > 0) hook.timeout = op.timeoutSec
      else return { ok: false, reason: 'bad-op' }
      return { ok: true, applied: { doc: next, changes: [{ path: [...hookPath(next, op), 'timeout'], mode: 'key' }] } }
    }

    case 'setHookDisabled': {
      const hook = hookAt(next, op.event, op.groupIndex, op.hookIndex)
      if (hook === undefined) return { ok: false, reason: 'not-found' }
      // 开=写 true（显式）、关=**删键**（不留 `disabled: false` 这种噪音）。
      if (op.disabled) hook.disabled = true
      else delete hook.disabled
      return { ok: true, applied: { doc: next, changes: [{ path: [...hookPath(next, op), 'disabled'], mode: 'key' }] } }
    }

    case 'setGroupMatcher': {
      const group = groupAt(next, op.event, op.groupIndex)
      if (group === undefined) return { ok: false, reason: 'not-found' }
      if (op.matcher === null) delete group.matcher
      else group.matcher = op.matcher
      return { ok: true, applied: { doc: next, changes: [{ path: [...groupPath(next, op), 'matcher'], mode: 'key' }] } }
    }

    case 'addHook': {
      if (op.command.length === 0) return { ok: false, reason: 'bad-op' }
      const group = groupAt(next, op.event, op.groupIndex)
      if (group === undefined || !isUnknownArray(group.hooks)) return { ok: false, reason: 'not-found' }
      const added: Record<string, unknown> = { type: 'command', command: op.command }
      if (op.timeoutSec !== null && op.timeoutSec > 0) added.timeout = op.timeoutSec
      const index = group.hooks.length
      group.hooks.push(added)
      return {
        ok: true,
        applied: { doc: next, changes: [{ path: [...groupPath(next, op), 'hooks', index], mode: 'index' }] },
      }
    }

    case 'removeHook': {
      const group = groupAt(next, op.event, op.groupIndex)
      if (group === undefined || !isUnknownArray(group.hooks)) return { ok: false, reason: 'not-found' }
      if (op.hookIndex < 0 || op.hookIndex >= group.hooks.length) return { ok: false, reason: 'not-found' }
      group.hooks.splice(op.hookIndex, 1)
      return {
        ok: true,
        applied: {
          doc: next,
          // `original`：那一项**只有原文**有（新文档里已经删掉了），抹两侧会对不上。
          changes: [{ path: [...groupPath(next, op), 'hooks', op.hookIndex], mode: 'index', area: 'original' }],
        },
      }
    }

    case 'moveHook': {
      const group = groupAt(next, op.event, op.groupIndex)
      if (group === undefined || !isUnknownArray(group.hooks)) return { ok: false, reason: 'not-found' }
      const from = op.hookIndex
      const to = from + op.direction
      if (from < 0 || from >= group.hooks.length || to < 0 || to >= group.hooks.length) {
        return { ok: false, reason: 'out-of-range' }
      }
      const moved = group.hooks[from]
      group.hooks[from] = group.hooks[to]
      group.hooks[to] = moved
      return {
        ok: true,
        applied: {
          doc: next,
          changes: [
            { path: [...groupPath(next, op), 'hooks', from], mode: 'index' },
            { path: [...groupPath(next, op), 'hooks', to], mode: 'index' },
          ],
        },
      }
    }

    case 'removeGroup': {
      const list = eventListOf(next, op.event)
      if (list === undefined || op.groupIndex < 0 || op.groupIndex >= list.length)
        return { ok: false, reason: 'not-found' }
      list.splice(op.groupIndex, 1)
      return {
        ok: true,
        applied: {
          doc: next,
          changes: [{ path: [...mapPath(next), op.event, op.groupIndex], mode: 'index', area: 'original' }],
        },
      }
    }

    default:
      return { ok: false, reason: 'bad-op' }
  }
}

/** 事件名合法性（请求体是不可信输入，先验证再进 `applyOp`）。 */
export function isHookEvent(value: unknown): value is HookEvent {
  return typeof value === 'string' && (HOOK_EVENTS as readonly string[]).includes(value)
}

/** 请求体校验结果。 */
export type RequestParse = { ok: true; request: HooksRequest } | { ok: false; reason: string }

function fileOf(value: unknown): FileKind | undefined {
  return value === 'project' || value === 'user' ? value : undefined
}

/** 非负安全整数（`-1` / `"0"` / `1.5` 一律拒绝）。 */
function indexOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** 正有限数（timeout 用；0 与负数与 NaN 一律拒绝）。 */
function positiveOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * 校验客户端发来的操作。**请求体是不可信输入**。
 *
 * 为什么不能省：`applyOp` 的寻址是数组下标，一个 `groupIndex: "0"` 或 `-1` 都可能落到
 * 别的节点上 —— 那是"静默改错用户配置"。这里一律先收窄，再交给纯函数；
 * 越界由 `applyOp` 报 `not-found`（本函数只保证**类型**合法）。
 */
export function parseHooksRequest(body: unknown): RequestParse {
  if (!isObject(body)) return { ok: false, reason: 'body 必须是 JSON 对象' }
  const file = fileOf(body.file)
  if (file === undefined) return { ok: false, reason: 'file 必须是 project 或 user' }
  if (typeof body.op !== 'string') return { ok: false, reason: 'op 必须是字符串' }
  const op = body.op

  /** 校验 event + groupIndex（所有改写操作都要）。 */
  const head = (): { event: HookEvent; groupIndex: number } | string => {
    if (!isHookEvent(body.event)) return 'event 不是受支持的事件'
    const groupIndex = indexOf(body.groupIndex)
    if (groupIndex === undefined) return 'groupIndex 必须是非负整数'
    return { event: body.event, groupIndex }
  }
  /** 再校验 hookIndex。 */
  const withHook = (): { event: HookEvent; groupIndex: number; hookIndex: number } | string => {
    const base = head()
    if (typeof base === 'string') return base
    const hookIndex = indexOf(body.hookIndex)
    if (hookIndex === undefined) return 'hookIndex 必须是非负整数'
    return { ...base, hookIndex }
  }

  switch (op) {
    case 'createFile':
      return { ok: true, request: { op: 'createFile', file } }

    case 'setHookCommand': {
      const where = withHook()
      if (typeof where === 'string') return { ok: false, reason: where }
      if (typeof body.command !== 'string' || body.command.length === 0) {
        return { ok: false, reason: 'command 必须是非空字符串' }
      }
      return { ok: true, request: { op, file, ...where, command: body.command } }
    }

    case 'setHookTimeout': {
      const where = withHook()
      if (typeof where === 'string') return { ok: false, reason: where }
      if (body.timeoutSec !== null) {
        const timeoutSec = positiveOf(body.timeoutSec)
        if (timeoutSec === undefined) return { ok: false, reason: 'timeoutSec 必须是 null 或正数' }
        return { ok: true, request: { op, file, ...where, timeoutSec } }
      }
      return { ok: true, request: { op, file, ...where, timeoutSec: null } }
    }

    case 'setHookDisabled': {
      const where = withHook()
      if (typeof where === 'string') return { ok: false, reason: where }
      if (typeof body.disabled !== 'boolean') return { ok: false, reason: 'disabled 必须是布尔值' }
      return { ok: true, request: { op, file, ...where, disabled: body.disabled } }
    }

    case 'setGroupMatcher': {
      const base = head()
      if (typeof base === 'string') return { ok: false, reason: base }
      if (body.matcher === null) return { ok: true, request: { op, file, ...base, matcher: null } }
      if (typeof body.matcher !== 'string') return { ok: false, reason: 'matcher 必须是字符串或 null' }
      return { ok: true, request: { op, file, ...base, matcher: body.matcher } }
    }

    case 'addHook': {
      const base = head()
      if (typeof base === 'string') return { ok: false, reason: base }
      if (typeof body.command !== 'string' || body.command.length === 0) {
        return { ok: false, reason: 'command 必须是非空字符串' }
      }
      if (body.timeoutSec === null || body.timeoutSec === undefined) {
        return { ok: true, request: { op, file, ...base, command: body.command, timeoutSec: null } }
      }
      const timeoutSec = positiveOf(body.timeoutSec)
      if (timeoutSec === undefined) return { ok: false, reason: 'timeoutSec 必须是 null 或正数' }
      return { ok: true, request: { op, file, ...base, command: body.command, timeoutSec } }
    }

    case 'removeHook': {
      const where = withHook()
      if (typeof where === 'string') return { ok: false, reason: where }
      return { ok: true, request: { op, file, ...where } }
    }

    case 'moveHook': {
      const where = withHook()
      if (typeof where === 'string') return { ok: false, reason: where }
      const direction = body.direction === -1 ? -1 : body.direction === 1 ? 1 : undefined
      if (direction === undefined) return { ok: false, reason: 'direction 必须是 -1 或 1' }
      return { ok: true, request: { op, file, ...where, direction } }
    }

    case 'removeGroup': {
      const base = head()
      if (typeof base === 'string') return { ok: false, reason: base }
      return { ok: true, request: { op, file, ...base } }
    }

    default:
      return { ok: false, reason: `未知操作 ${JSON.stringify(op)}` }
  }
}

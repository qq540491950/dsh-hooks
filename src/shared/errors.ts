/**
 * 错误码目录：**两半共用的唯一来源**。
 *
 * 为什么需要这么一个文件（02 票）：
 *   - 宿主能返回的失败码散在三个地方（路由状态码映射、`applyOp` 的拒写原因、写入路径的 IO 归类），
 *     而客户端那张"机器码 → 一句人话"的表是**另一份**手写清单。两份清单必然漂移，
 *     实测漂移的结果就是页面把内部码直接当主文案（"写入失败（no-version）。"）。
 *   - 漂移是**静默**的：新加一个码不会让任何东西变红，用户只会看到一句看不懂的话。
 *
 * 所以：`HOST_ERROR_CODES` 是宿主侧"可能出现在失败信封 error 字段里"的枚举，
 * `CLIENT_ERROR_CODES` 是浏览器半边自己产生的（请求没到宿主就失败了）。
 * 客户端文案表必须**逐项**覆盖这两份的并集 —— 这条由自检做表驱动断言（缺一即红）。
 *
 * ⚠️ 加一个新码的正确顺序：① 写进这里；② 客户端补一句**专属**文案；③ 宿主侧真的会返回它。
 *    漏掉 ② 会让自检变红，这是刻意的。
 */

/** 宿主数据面可能返回的失败码（`{ok:false, error}` 信封里的 `error`）。 */
export const HOST_ERROR_CODES = [
  /** 请求体不是合法 JSON。 */
  'bad-json',
  /** 请求体的形状/取值不合法（含 `expectedVersion` 类型错）。 */
  'bad-op',
  /** 目标文件不存在，而这个操作必须作用在已有文件上。 */
  'absent',
  /** "新建"撞上"已经存在"。 */
  'exists',
  /** 文件存在但读不懂（JSON 非法 / 顶层不是对象）。**绝不在这种文件上落笔**。 */
  'invalid-json',
  /** 事件键存在但不是数组（文件结构坏了）。 */
  'malformed-event',
  /** 项目根解析不出来。 */
  'no-project',
  /** fs provider 不返回版本号 ⇒ 不做无守卫写入。 */
  'no-version',
  /** 宿主没有工作区清单（≠ 没有工作区）。 */
  'no-workspace-registry',
  /** 要改的那一条/那一组不在文件里（含下标越界）。 */
  'not-found',
  /** 改写会动到目标之外的字段 ⇒ 拒写。 */
  'not-preservable',
  /** 移动已经到头了。 */
  'out-of-range',
  /** 目标组存在，但它的 matcher 非法，所以这一条跑不了（试运行专用）。 */
  'rejected',
  /** 目标路径解析失败。 */
  'resolve-failed',
  /** 调用会话的沙箱策略不允许写这个路径。 */
  'sandbox',
  /** 版本冲突：页面看到的版本已经不是磁盘上的版本。 */
  'stale',
  /** 工作区 id 不在宿主的清单里。 */
  'unknown-workspace',
  /** 写盘本身失败（IO / provider 抛错），且不属于上面任何一类。 */
  'write-failed',
  /** 插件内部错误（真正的 bug）。 */
  'internal',
] as const

/** 只在浏览器半边产生的失败码（请求没发出，或响应读不懂）。 */
export const CLIENT_ERROR_CODES = [
  /** 纯前端校验：超时字段不是正数。 */
  'bad-timeout',
  /** fetch 抛了 / 断网。 */
  'network',
  /** 等太久自己放弃（写请求与试运行都有时间预算 —— 否则"忙"会让整页永久不可操作）。 */
  'timeout',
] as const

/** 宿主码。 */
export type HostErrorCode = (typeof HOST_ERROR_CODES)[number]
/** 浏览器半边码。 */
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number]
/** 客户端文案表必须覆盖的并集。 */
export type SentenceErrorCode = HostErrorCode | ClientErrorCode

/** 文案表必须覆盖的全部码（顺序即断言遍历顺序）。 */
export const SENTENCE_ERROR_CODES: readonly SentenceErrorCode[] = [...HOST_ERROR_CODES, ...CLIENT_ERROR_CODES]

/**
 * 收窄一个"宿主可能返回的错误码"。
 *
 * **宿主必须用它**（而不是把原始字符串直接塞进失败信封）：目录之外的码一律归成 `internal`，
 * 于是"客户端一定有对应文案"这件事在结构上成立，而不是靠两边手工同步（那正是本条要治的漂移）。
 */
export function hostErrorCodeOf(value: string | undefined): HostErrorCode {
  const known = (HOST_ERROR_CODES as readonly string[]).includes(value ?? '')
  return known ? (value as HostErrorCode) : 'internal'
}

/**
 * 机器码 → **一句人话**。`Record<SentenceErrorCode, string>` 是刻意的：
 * 少写一个键就是**编译错误**（而不是"运行时静默降级成内部码"）。
 *
 * 文案纪律（AGENTS §3.9）：
 *   - 每个码一句**不同**的话 —— 用户据此分得清"该刷新"、"该去修文件"、"该换权限"；
 *   - 主文案里**不许**出现机器码、内部字段名、盘符路径、markdown 记号；
 *   - 技术原文由调用方放在 `detail` 里作补充，**绝不**当主文案。
 */
export const ERROR_SENTENCES: Readonly<Record<SentenceErrorCode, string>> = {
  'bad-json': '宿主返回的内容不是合法 JSON（界面与宿主的版本可能对不上）。',
  'bad-op': '这次请求不合法（界面与宿主的版本可能不一致）。',
  absent: '这份配置文件还不存在。',
  exists: '文件已经存在，不能再"新建"。',
  'invalid-json': '文件现在读不出来（内容不是合法 JSON）。为避免覆盖你的内容，这次没有写入，请先手工修好文件。',
  'malformed-event': '这个事件在文件里不是数组（结构坏了）。为避免覆盖你的内容，这次没有写入。',
  'no-project': '无法确定当前项目，所以不能写项目级配置。',
  'no-version': '宿主拿不到这个文件的版本号。为避免覆盖别人的改动，这次没有写入。',
  'no-workspace-registry': '宿主没有提供工作区清单，只能改当前项目和用户级配置。',
  'not-found': '要改的那一条已经不在了（文件可能刚被改过），请刷新。',
  'not-preservable': '这次改动会动到目标以外的字段。为避免破坏文件，已拒绝写入。',
  'out-of-range': '这一条已经到头了，挪不动。',
  rejected: '这一条的分组匹配范围不合法，所以它根本不会运行 —— 先把匹配范围改回合法的写法。',
  'resolve-failed': '宿主解析不出这个文件的位置，写入没有发生。',
  sandbox: '当前会话的权限不允许写这个文件（沙箱限制）。',
  stale: '这个文件刚被别处改过了，页面上的内容已经不是最新的。请刷新后再改。',
  'unknown-workspace': '这个工作区已经不在宿主的清单里了（可能被删过），请刷新页面后重试。',
  'write-failed': '写文件时出错了，改动没有保存。',
  internal: '插件内部出错了，这次改动没有保存（这是插件的问题，不是你的配置写错了）。',
  'bad-timeout': '超时必须是正数秒；留空就用默认 600s。',
  network: '连不上宿主，写入没有发生。',
  timeout: '宿主太久没有回应，这次操作已经放弃（宿主可能卡住了）。可以重试。',
}

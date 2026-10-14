/**
 * 客户端的写请求层。
 *
 * ## 两条铁律
 *   1. **只发定点操作**，绝不回传整份文件（AGENTS §2.3）：回传整份 = 静默丢字段的老事故。
 *      所以请求体只有"改哪一份文件的哪一处、改成什么"。
 *   2. `requestWrite` **永不抛**：网络错误、非 JSON 响应都折叠成同一个结果形状，调用方只判 `ok`。
 *      否则每个调用点都要写一遍 try/catch，迟早漏一个 —— 漏掉的那次就是"点了没反应"。
 */

import { HOOKS_ROUTE } from '../shared/constants.ts'
import type { HooksWriteResponse } from './wire.ts'

/** 一次写操作的意图（字段与宿主 `write.ts` 的 `HooksRequest` 一一对应）。 */
export interface WriteIntent {
  file: 'project' | 'user'
  op:
    | 'setHookCommand'
    | 'setHookTimeout'
    | 'setHookDisabled'
    | 'setGroupMatcher'
    | 'addHook'
    | 'removeHook'
    | 'moveHook'
    | 'removeGroup'
    | 'createFile'
  event?: string
  groupIndex?: number
  hookIndex?: number
  command?: string
  timeoutSec?: number | null
  disabled?: boolean
  matcher?: string
}

/** 写请求的结果（永不抛，所以调用方只需判 `ok`）。 */
export interface WriteOutcome {
  ok: boolean
  error?: string
  detail?: string
  version?: string
}

/**
 * 错误码 → 人话：**每个码一句不同的话**（AGENTS §3.9）。
 *
 * 糊成一句"保存失败"是不允许的：用户据此分不清"该刷新页面"、"该去修文件"、"该换权限"。
 * 宿主返回的 `detail` 是技术原文，只作补充，**绝不**当主文案。
 */
export function writeErrorSentence(error: string): string {
  switch (error) {
    case 'stale':
      return '这个文件刚被别处改过了，页面上的内容已经不是最新的。请刷新后再改。'
    case 'invalid-json':
      return '文件现在读不出来（内容不是合法 JSON）。为避免覆盖你的内容，这次**没有写入**，请先手工修好文件。'
    case 'not-preservable':
      return '这次改动会动到目标以外的字段。为避免破坏文件，已拒绝写入。'
    case 'sandbox':
      return '当前会话的权限不允许写这个文件（沙箱限制）。'
    case 'absent':
      return '这份配置文件还不存在。'
    case 'exists':
      return '文件已经存在，不能再"新建"。'
    case 'not-found':
      return '要改的那一条已经不在了（文件可能刚被改过），请刷新。'
    case 'bad-op':
      return '这次请求不合法（界面与宿主的版本可能不一致）。'
    case 'no-project':
      return '无法确定当前项目，所以不能写项目级配置。'
    case 'network':
      return '连不上宿主，写入没有发生。'
    default:
      return `写入失败（${error}）。`
  }
}

/** 发一次写请求。`signal` 用于组件卸载/超时中断。 */
export async function requestWrite(intent: WriteIntent, signal?: AbortSignal): Promise<WriteOutcome> {
  try {
    const response = await fetch(HOOKS_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // 鉴权是 host-only 的同源 cookie（官方 connection 层管），带上同源凭据即可。
      credentials: 'same-origin',
      body: JSON.stringify(intent),
      ...(signal === undefined ? {} : { signal }),
    })
    const body = (await response.json()) as HooksWriteResponse
    if (body.ok) {
      const version = body.data === undefined ? null : body.data.version
      return version === null ? { ok: true } : { ok: true, version }
    }
    const outcome: WriteOutcome = { ok: false, error: typeof body.error === 'string' ? body.error : 'internal' }
    return typeof body.detail === 'string' ? { ...outcome, detail: body.detail } : outcome
  } catch (error) {
    return { ok: false, error: 'network', detail: error instanceof Error ? error.message : String(error) }
  }
}

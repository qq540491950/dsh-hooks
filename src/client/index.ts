/**
 * 浏览器半边的入口。平台的 lazy loader 会 materialize 本模块并调用 `exports.apply(ctx)`。
 *
 * ## 契约（逐条对应 AGENTS §2.2，产物由 tools/build.ts 断言）
 *   1. 产物是 **classic script**（不是 ESM），只向 `window.__ModuleLoader__` 注册**一个** factory；
 *   2. factory 的 `id` **必须等于** `package.json` 的 `name`（由构建脚本注入）；
 *   3. `require` 只取平台种子模块 —— 这里只用 `react`（经 `./react.ts` 单点中转）。
 *
 * ## 本页做什么
 * 往 `settings.section`（**list 座位**）注册一页「Hooks」，当前是**只读看板**：内容全部来自宿主
 * `GET /api/hooks`，页面自己**不解析** `hooks.json`（AGENTS §2.6）。
 */

import { HooksSection } from './section.tsx'

/** 座位身份：list 座位必须给唯一 `id`（唯一性约束在 `(id, priority)`，不在 `order`）。 */
const SECTION_ID = 'hooks'
/** 导航上的名字（可以是 thunk，官方会按 locale 重新求值）。 */
const SECTION_LABEL = 'Hooks'
/**
 * 官方区间：account -10 / general 0 / models 10 / plugins 15 / agent-presets 20；
 * 本地 MCP 页占 900、Skills 页占 910 —— 920 让本页排在它们之后（但**不保证**永远最后）。
 */
const SECTION_ORDER = 920

/** 本半边用到的 Client 服务（只声明实际调用的成员）。 */
interface SlotScope {
  slots: {
    inject(key: string, callback: () => unknown): unknown
    register(options: { name: string; id: string; order: number; label: () => string }, component: unknown): unknown
  }
}

/** 客户端上下文：只声明我们要用的 `inject`。 */
interface ClientContext {
  inject(services: string[], callback: (scope: SlotScope) => void): unknown
}

/** 插件入口（平台调用）。 */
export function apply(ctx: ClientContext): void {
  // 用 `ctx.inject` 而不是模块级 `inject`：在缺 `slots` 的宿主里保持 inactive，
  // 而不是"激活之后抛错"（与 dsh-skill-manager / dsh-mcp-manager 同一写法）。
  ctx.inject(['slots'], (scope) => {
    // **必须走 inject**：`settings.section` 由官方 `settings-general` 声明；未声明的座位直接
    // register 会抛 `slot "..." is not declared`，而 inject 会等声明就绪（AGENTS §3.4）。
    scope.slots.inject('settings.section', () =>
      scope.slots.register(
        {
          name: 'settings.section',
          id: SECTION_ID,
          order: SECTION_ORDER,
          label: () => SECTION_LABEL,
        },
        HooksSection,
      ),
    )
  })
}

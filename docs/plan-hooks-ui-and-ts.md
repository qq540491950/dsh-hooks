# dsh-hooks 执行方案：设置页可视化 + 全面 TypeScript 化

> 状态：**计划**（未开工）。基线 commit `5ae2026`，`node tools/verify.mjs` = 61/61 PASS（本轮实测）。
> 约束文件：[AGENTS.md](../AGENTS.md)。取证与事故复盘：`docs/agent-rules-notes.md`（待建）。
> 参考实现：`dsh-mcp-manager`（TS + 构建 + 写入面，order 900）、`dsh-skill-manager`（纯 JS + 只读设置页，order 910）。

---

## 0. 一句话结论

给 hooks 加一个和 skill / mcp 同款的设置页（`settings.section`，`id: hooks`，`order: 920`，标签「Hooks」），
**只读看板先行、受控写入随后**；同时把整个仓库迁到 `src/**` 的 TypeScript + esbuild 构建（`lib/**` 变成产物）。

**但有一件必须先做的事**：`lib/index.js` 现在有一个**仍在线**的 fail-open 缺陷（`readJson` 把"读不到"当成"没有配置"），
写坏一个字符就会让**全部 hook 静默消失**（含 deny 守卫）。设置页会让这个文件被改得更频繁，所以 **P1 先修它，任何写入路径都排在它之后**。

---

## 1. 事实基线（本轮核实过的）

| 事实 | 证据 |
|---|---|
| 插件已挂在 desktop profile，装载方式是**路径行** | `C:\Users\admin\.dsh\profiles\desktop\cordis.patch.yml:402-404`：`- insert: {id: dsh-hooks, name: 'file:///D:/project/dsh-plugins/dsh-hooks/lib/index.js'}` |
| 当前是纯 JS、单文件、无构建 | `package.json` 无 `scripts`；`lib/index.js` 1103 行手写；无 `src/`、无 tsconfig/eslint/prettier/`.gitattributes`/`.editorconfig` |
| 自检 | `node tools/verify.mjs` → `dsh-hooks verify: 61 passed, 0 failed` + `全绿 ✅`（61 个 `test()`，约 158 次断言；`--config <file>` 是配置体检模式） |
| 宿主半边**不热重载**，客户端半边热重载 | README:56-68 实测（`insert` 立刻出现在 Loader 树但不激活；`plugin_manager set_plugin` 只对同一模块实例再 `apply()`） |
| 配置是**插件自己的 JSON**，两层 | `<projectRoot>/.dsh/hooks.json`（projectRoot = 最近 `.git` 祖先，否则会话 cwd）+ `$DSH_HOME/hooks.json`；用户级在前、项目级在后，顺序即执行顺序 |
| 文件里有**未知键** | `.dsh/hooks.json:2` 是 `_comment`（活文档）→ 写入必须保留 |
| 座位现状（活台账） | `account/-10`、`general/0`、`models/10`、`plugins/15`、`agent-presets/20`、`mcp/900`、`skills/910` |
| 写入 API 齐全 | `ctx.fs.writeText(target, content, expected?, signal?, sandboxPolicy?)` **本身就是原子替换**；`FsWriteIntent = {kind:'createIfAbsent'} \| {kind:'replaceIfVersion', version}`；`ctx.fs.editText(target, {oldString,newString,replaceAll}, {version})` 可做逐字节外科手术 |
| 路由 API | `ctx.connection.fetch.register({path, methods, requestBody:'buffered', fetch})`，路径必须形如 `/api/<name>`，自动继承 Host/Origin 围栏与浏览器鉴权 |
| 会话 cwd 的权威来源 | `sessionQuery.observeSession(sessionId)` → `SessionObservation{header, …} & Disposable`（租约读完即放）；`sandboxPolicy.resolve({session?})` 永远返回一个策略（无 session 时是部署默认） |
| 座位注册字段只拷 11 个键 | 读 `dsh-client-ui-slots/lib/index.js` 的 `register()`：`key/id/order/label/priority/select/inject/children/store/locale/registrant` → **`icon` 被静默丢弃**；list 座位按 `(id, priority)` 去重，重复抛错；未声明的座位直接 register 抛 `slot "…" is not declared` |
| 外壳留白 | 官方 `SettingsRoot.module.css` 的 `options` 类 = `padding: 0 24px 24px` → 页面不要再垫 |
| **仍在线缺陷** | `.tmp/hotreload-fix-plan.md` §1-§2 实测：写坏 `hooks.json` ⇒ deny 守卫消失，且一直消失；C1/C2/C3 **一行都没实现**（`readJson` 仍二值折叠、`configFor` 仍把解析失败当负结果缓存 2s） |

---

## 2. 关键设计决策（含被否决的方案）

### 2.1 复用 mcp-manager 的**工具链与纪律**，但不复用它的**写入层**

| 维度 | dsh-mcp-manager | dsh-hooks（本方案） |
|---|---|---|
| 数据是什么 | cordis Loader 条目（YAML 分层配置） | 插件自己的 JSON 文件 |
| 读取 | `configEditor.configuration()` + `loader.entries()` | `ctx.fs.readText` + 自带三态解析（含 last-good） |
| 写入 | `ctx.configEditor.edit()`（外科手术式 YAML） | `ctx.fs.writeText()`（版本锁 + 原子替换）/ `ctx.fs.editText()`（逐字节） |
| 容器归属 | `cordis:group` 容器声明在 profile，不在 bundle | 无容器概念；文件本身就是全部 |
| **结论** | 可抄：零 import 产物、构建指纹、座位注册、主题 token、错误单渲染点、定点 op、能力协商、verify 分区与反向验证。**不可抄**：写入层、`markNavCell`（见 2.3） | |

### 2.2 「快照即真相」：客户端永远不回传整份文件

mcp-manager 的历史事故是：客户端回传整个数组、宿主用**表单形状**重建 → 每次行内操作都静默清空 `headers`/`env`。
hooks 的同构风险是：客户端回传整个 `hooks.json`、宿主序列化 → 清空 `_comment`、重排格式、丢掉未知字段。

所以：**客户端只发 `{op, scope, event, groupIndex, hookIndex, patch, version}` 这样的定点操作，宿主读→改→写。**
所有写操作都带 `version`（快照里读到的那一份 `FsVersion`），宿主用 `{kind:'replaceIfVersion'}` / `editText` 的版本护栏；
不匹配 → `409 FS_STALE_VERSION` → 客户端提示"配置已被外部修改"并自动重读（**绝不覆盖**）。

### 2.3 导航图标：**不抄** mcp-manager 的 DOM 覆盖

`dsh-skill-manager` 已明确否决 `markNavCell()`（打 `data-` 属性 + CSS 覆盖官方 svg）——它依赖官方 DOM 结构，一改就静默失效（最坏情况仍然只是退回齿轮）。
本方案第一版**就用官方兜底齿轮**，不留 `nav-mark.ts`，不读别人的 DOM。
代价：导航上那格是齿轮而不是 hooks 图标；上游若支持 `icon` 注册参数，一行改用。

### 2.4 试运行（dry-run）= 真实执行路径 + 合成 payload

试运行**复用 `runPoint` 的同一段代码**（同一个 `shell.resolve/execute`、同一个 payload builder、同一份会话沙箱策略），
只有 payload 是合成/可编辑的、超时被夹到 `min(hook.timeoutSec, 30s)`。
理由：另写一个"演示用执行器"必然出现"试运行通过、真实失败"。

### 2.5 执行台账是**唯一**的状态色证据来源

hooks 没有 mcp 的 `fiber.phase` 可以偷看，也不该"没报错就报绿"。所以宿主维护一个有界环形缓冲，
每条记录带 `{at, scope, event, groupIndex, hookIndex, command, exitCode, decision, durationMs, sandbox, sessionId}`。
渲染时**先按索引匹、再校验 `command` 相同**；`command` 已经变了 ⇒ 那一格显示灰「配置已改，无新记录」——
**旧记录不许把新配置画成绿的**（这正是 mcp-manager 被 `failOnStartupError:false` 骗绿的同构陷阱）。

### 2.6 明确**不做**（范围外）

- 不做 hooks 市场 / 模板库；不做跨项目批量写入；不做 hook 执行历史的持久化（只存内存环形缓冲）；
- 不接 `ctx.locale`（v1 硬编码中文，与两个兄弟插件一致，在 AGENTS §6 记为有意偏离）；
- 不做 nav 图标（见 2.3）；不动 `inject = ['shell','fs']` 之外的服务依赖；
- 不改官方兼容桥、不改 `dsh-hook-protocol` 的语义；不引入 `http` / `prompt` / `agent` handler。

---

## 3. UI 设计

### 3.1 座位与身份

```
ctx.inject(['slots'], (scope) => {
  scope.slots.inject('settings.section', () =>
    scope.slots.register({ name:'settings.section', id:'hooks', order:920, label:() => 'Hooks' }, HooksSection))
})
```
`id: 'hooks'`、`order: 920`（> mcp 900、skills 910）、`label` 用 thunk（官方按 locale 重新求值，零成本留后路）。

### 3.2 页面结构（wireframe）

```
Hooks
┌ 工具条 ───────────────────────────────────────────────────────────────────────┐
│ 项目 [当前会话（dsh-hooks） ▾]   来源 [项目级 (3) | 用户级 (1)]        [刷新]   │
└───────────────────────────────────────────────────────────────────────────────┘
┌ 诊断（仅当有错/有跳过时出现；整页最多一处） ─────────────────────────────────┐
│ ⚠ 这份文件不是合法 JSON：Unexpected token } at position 118 —— 正在沿用上一份  │
│   可用配置（2026-10-14 06:58 加载）。修好它之前不会重新读取。                 │
└───────────────────────────────────────────────────────────────────────────────┘
┌ PreToolUse (2) ───────────────────────────────────────────────────────────────┐
│  matcher `pwsh|bash`                                            [改 matcher]  │
│   ● 1  node scripts/guard.mjs          timeout 20s   exit=2 deny  23ms        │
│        [停用] [试运行] [编辑] [↑] [↓] [删除]                                  │
│   ○ 2  node scripts/fmt.mjs            timeout 60s   未运行（本会话）          │
│        [停用] [试运行] [编辑] [↑] [↓] [删除]                                  │
│  matcher `^mcp__github__`                                       [删组]        │
│   ● 3  node scripts/audit.mjs          timeout 10s   exit=0 pass  7ms         │
└───────────────────────────────────────────────────────────────────────────────┘
┌ UserPromptSubmit (0) ─────────────────────────────────────────────────────────┐
│  这一格没有 hook。「新增」会加到这份文件；用户级与项目级都会跑（用户级先）。  │
└───────────────────────────────────────────────────────────────────────────────┘
… SessionStart / PostToolUse / Stop / SubagentStart / SubagentStop（7 个永远全列）
┌ 最近执行 (12) ────────────────────────────────────────────────────────────────┐
│ 06:58:12  PreToolUse  exit=0 pass   23ms  workspace-write  pwsh                │
└───────────────────────────────────────────────────────────────────────────────┘
                                                              [新建 hook]
```

设计要点（每条都对应一条 AGENTS 规则）：

- **7 个事件分组永远全部渲染**（含 0 条），每组标题带条数；`UserPromptSubmit` / `Stop` 隐藏 matcher 输入（解析器本来就丢弃）。[AGENTS 3.6]
- **两个来源永远都列**（项目级 / 用户级 tab 带条数）；用户级页顶部明确写"对**所有**项目生效"。
- **matcher 属于 group、command/timeout/disabled 属于 hook**——UI 的分层必须与文件结构一致，否则用户改不了 matcher 或改错层。
- 每行状态点：● 绿 = 最近一次 `exit=0` 且 `decision=pass`；● 琥珀 = `ask`；● 红 = `deny`/`block`/spawn-failed/超时；○ 灰 = 停用或无记录/记录已过期（§2.5）。
- `timeout` 显示"20s"（文件里是秒；默认 600s 时显示 `600s（默认）`），点击进入编辑时用数字输入。
- `command` 用等宽多行 `textarea`（`mono` + `multiline` 两个开关都要，AGENTS 3.10）；行内只显示单行省略号版本。
- 删除是两步确认（对齐 mcp-manager 的 `confirming`）。
- 「试运行」打开对话框：事件相关 payload 模板（可编辑 JSON）+ 超时 + 「用当前会话的字段值」开关；
  结果显示 `exitCode / decision / durationMs / sandbox / stdout / stderr`，长输出截断并给"完整长度"。
- 两条错误通道分开：**表单内**错误（新增/编辑提交失败）只渲染在表单里；**页面级**错误（启停/删除/试运行失败）只渲染在页面工具条下方。[AGENTS 3.7]
- 四种"空/坏"必须文案不同，且不出现内部错误原文与绝对路径堆砌：`文件不存在` / `JSON 非法（正在沿用上一份可用配置）` / `写入被当前沙箱档位拒绝` / `matcher 非法（该组已跳过，其余照跑）`。[AGENTS 3.9]

### 3.3 数据面协议

**`GET /api/hooks?sessionId=<id>&cwd=<path>&scope=project|user`**

```jsonc
{ "ok": true, "data": {
  "capabilities": ["read","write","createFile","run","executions"],   // 旧宿主缺哪些，客户端就禁用哪些
  "context": { "sessionId": "…", "cwd": "D:\\…", "projectRoot": "D:\\…",
               "source": "session" },                                  // source: session | cwd-arg | fallback
  "files": [
    { "scope": "project", "path": "D:\\…\\.dsh\\hooks.json",
      "exists": true, "valid": true, "state": "ok",                    // ok | absent | error | invalid
      "usingLastGood": false, "lastGoodAt": 1760000000000,
      "error": null,                                                   // 只在 state=invalid|error 时有值
      "version": "…", "indent": 2, "newline": "\n", "bom": false,
      "unknownTopLevelKeys": ["_comment"],
      "groups": { "PreToolUse": [ { "index": 0, "matcher": "pwsh|bash",
                    "hooks": [ { "index": 0, "type": "command", "command": "node scripts/guard.mjs",
                                 "timeoutSec": 20, "disabled": false } ] } ] },
      "skipped": [ { "event": "PreToolUse", "type": "http" } ],
      "diagnostics": [ "invalid regex matcher \"(\" on event \"PreToolUse\"" ] },
    { "scope": "user", "path": "C:\\Users\\…\\.dsh\\hooks.json", "exists": false, "state": "absent", "…": "…" }
  ],
  "executions": [ { "at": 1760000000000, "scope": "project", "event": "PreToolUse",
                    "groupIndex": 0, "hookIndex": 0, "command": "node scripts/guard.mjs",
                    "exitCode": 2, "decision": "deny", "durationMs": 23,
                    "sandbox": "workspace-write", "sessionId": "…" } ]      // 有界、截断
} }
```

**`POST /api/hooks`**（一次性 JSON，全部返回**新快照**）

| op | 载荷 | 语义 |
|---|---|---|
| `toggle` | `{scope, event, groupIndex, hookIndex, enabled, version}` | 加/删 `disabled: true`，**只动这个键** |
| `setHook` | `{scope, event, groupIndex, hookIndex, patch:{command?, timeoutSec?}, version}` | 改 command / timeout（走 `editText` 优先） |
| `addHook` | `{scope, event, groupIndex?, matcher?, hook:{command, timeoutSec?}, version}` | `groupIndex` 缺省则新建 group |
| `removeHook` | `{scope, event, groupIndex, hookIndex, version}` | 删一条；组空则删组 |
| `moveHook` | `{scope, event, groupIndex, hookIndex, delta, version}` | 同组内上下移（顺序即执行顺序） |
| `setMatcher` | `{scope, event, groupIndex, matcher: string \| null, version}` | 改/删 group 的 matcher |
| `removeGroup` | `{scope, event, groupIndex, version}` | 删整组 |
| `createFile` | `{scope}` | `{kind:'createIfAbsent'}` 建空骨架 |
| `run` | `{scope, event, groupIndex, hookIndex, payload, timeoutSec?, sessionId?}` | 试运行，**不写文件** |

**错误契约**（客户端只认这一套，HTTP 状态只作辅助）：

- `409` + `error.code = 'stale'` → "配置已被外部修改，请重试"（客户端自动重读一次快照）；
- `403` + `error.code = 'sandbox'` → "当前会话的沙箱档位不允许写这个文件"；
- `409` + `error.code = 'invalid-json'` → "文件当前不是合法 JSON，请先修好或用编辑器直接改"；
- `409` + `error.code = 'not-preservable'` → 深比较失败（改动会顺带丢掉未知键/改格式）→ **拒写**，附差异摘要；
- `400` + `error.code = 'bad-op'` / `'not-found'`（索引越界、目标不存在）。

### 3.4 写入实现（宿主侧三层防线）

1. **定位层**：用一个带 offset 的 JSON 扫描器（或"重新序列化"路径）算出目标字段的字节区间。
   单字段操作（`toggle` / `setHook`）优先用 `ctx.fs.editText(target, {oldString, newString, replaceAll:false}, {version})`——**只动那一段字节**。
2. **断言层**：任何"重建整份文档"的操作，在写盘前必须证明「除目标变更外，解析结果与原文**逐字段深比较相等**」；
   同时保留未知顶层键、原有缩进（探测）、原有行尾、结尾换行、不带 BOM。不满足 → `not-preservable` 拒写。
3. **提交层**：`ctx.fs.writeText(target, next, {kind:'replaceIfVersion', version} | {kind:'createIfAbsent'}, signal, sandboxPolicy)`。
   沙箱策略用调用会话的（`resolve({session})`）；页面发起的写没有 agent ⇒ `resolve({})`（部署默认）——
   **这是诚实的降级**：`read-only` 会话下页面写不进去，就如实报 `sandbox` 错，不提权。

### 3.5 UI 构件与种子模块（本轮从 asar 实测，P5 开工前必读）

- **`dsh-client-ui-primitives` 里没有** `Card` / `Panel` / `Select` / `Textarea` / `Spinner` / `EmptyState` / 排版助手 —— 这些都要我们自己拼（卡用 `.5px solid var(--dsw-alias-settings-card-stroke)` + `settings-card-fill`；空状态自己写一句；下拉用 `Menu`/`MenuSurface`）。可直接用的：`Button`（`variant: primary|ghost|outline|toolbar`、`size: md|sm`）、`Switch`（`label` 必填）、`Checkbox`、`Input`、`SegmentedTabs`/`SegmentedControl`、`Tag`（8 个 tone）、`Tooltip`、`Modal`、`Toast`、`StateDot`、`JsonTree`/`JsonBlock`（试运行结果展示很合适）、`PathLabel`、`DisclosureRow`、188 个 `Icon*`（`{size=16, className}`）。
- **`SettingsForm` / `SettingsFormModel` 不适用**：它们绑在 `ctx.configForms.get(ns)` 的 `mutate(ops, revision)` 上（管 cordis 配置字段）。我们写的是**自己的 JSON**，所以只借它的**外观**（只读提示 + 保存/放弃页脚 + 字段行 + hint/invalid），数据面仍走 §3.3 的定点 op。
- **浏览器种子模块表（完整 9 个词）**：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。
  → `ui-primitives` **确实**可以被 `require`，但官方 practices 与两个兄弟插件都**刻意不用**（手写 CSS + 原生 DOM）。**本方案跟随兄弟插件：不 require 它**，保持产物只有一处 `require("react")`；这条要写进 eslint 的客户端 override。
- **`/plugins` 路由没有鉴权围栏**（403/401 的 Host/Origin + 浏览器鉴权只挂在 `/api` 前缀上）；bundle URL 必须以**文档相对**形式使用（图里给的就是去掉前导斜杠的形式）。**结论：我们所有数据面都挂在 `/api/hooks` 上（自带围栏），客户端只写相对路径。**
- 客户端 `<style>` 会被 HMR 的样式接管逻辑打标：**注入必须幂等 + 可原地更新**（比较 `textContent`，不要"存在就 return"）——与 AGENTS §3.2 同一条。

---

## 4. TypeScript 化方案

### 4.1 目标形态（照 mcp-manager 的骨架，按本插件裁）

```
src/shared/constants.ts   事件表 / 默认值 / 路由 / 座位 id+order / 上限（台账容量、截断长度）
src/shared/types.ts       快照与定点 op 的 wire 类型
src/shared/guards.ts      不可信输入收窄（asRecord / readString / readInt …）
src/shared/protocol.ts    纯协议层：matcher / exit-code codec / deny>ask>allow 合并（从 lib/index.js 平移）
src/shared/json-source.ts JSON 源文定位：缩进/行尾/BOM 探测、字段区间、深比较（可单测的纯函数）
src/host/index.ts         插件体：事件接线 + 路由 + 写入 + 执行台账
src/host/config.ts        配置读取三态 + last-good + stat 版本核对（P1 的 JS 逻辑平移）
src/host/rows.ts          宿主纯函数：快照构造 / 定点 op 应用
src/host/service-types.ts 本地最小 Service 接口（不 import 官方类型）
src/client/index.ts       插件体：ensureStyles + 座位注册（wrapper 不在这里）
src/client/react.ts       react 单点中转（h / Fragment / hooks）
src/client/section.tsx    页面
src/client/event-group.tsx 事件分组卡
src/client/hook-row.tsx   单条 hook 行
src/client/hook-form.tsx  新增 / 编辑表单
src/client/dry-run.tsx    试运行对话框
src/client/executions.tsx 最近执行面板
src/client/styles.ts      注入样式表（幂等 + 可刷新）
src/client/core/api.ts    fetch 桥（同源相对路径 + 超时）
src/client/core/draft.ts  draft ↔ payload
src/client/core/status.ts 状态色 / 文案 / 证据判定
src/client/service-types.ts
tools/build.ts            esbuild：host 目标 + client 目标 + 指纹
tools/verify.ts           自检（从 verify.mjs 平移 + 扩展）
```

### 4.2 工具链（逐条抄 mcp-manager，**除了声明产物**）

- `tsconfig.base.json`：`target ES2022` / `module ESNext` / `moduleResolution Bundler` / `strict` / `noUncheckedIndexedAccess` /
  `exactOptionalPropertyTypes` / `verbatimModuleSyntax` / `isolatedModules` / `allowImportingTsExtensions` / `rewriteRelativeImportExtensions`。
- `tsconfig.host.json`：`lib: ["ES2022"]`（**无 DOM** ⇒ 写 `document` 编译不过）、`types: ["node"]`、`noEmit: true`。
- `tsconfig.client.json`：`lib: ["ES2022","DOM","DOM.Iterable"]`、`types: ["react"]`、**classic JSX**：`jsx:"react"` / `jsxFactory:"h"` / `jsxFragmentFactory:"Fragment"`。
- `tsconfig.tools.json`（`include: ["tools/build.ts"]`）+ `tsconfig.tools.wip.json`（进度表，含 `tools/verify.ts`，**不进 `pnpm check`**）。
- `eslint.config.js`：`strictTypeChecked` 只作用于 `src/**`；`HOST_BARE_IMPORT`（裸说明符选择器 `ImportDeclaration[source.value=/^[^./]/]:not([importKind='type'])`）；
  禁 `document.body` / `dangerouslySetInnerHTML` / 手写 `window.__ModuleLoader__`；客户端禁运行时 import `@deepseek-ai/dsh-client-*`（允许 type import）；
  `consistent-type-imports` / `no-explicit-any` / `no-non-null-assertion` / `no-floating-promises` / `no-misused-promises` / `no-console` / `eqeqeq`。
  **`no-restricted-syntax` 是替换不是追加** ⇒ 每个 override 必须重列基础选择器（mcp-manager 踩过）。
- `.prettierrc.json`（唯一格式权威，`singleQuote` / `semi:false` / `printWidth:120` / `endOfLine:"lf"`）、`.editorconfig`、`.gitattributes`（`* text=auto eol=lf`）、
  `pnpm-workspace.yaml`（`allowBuilds: esbuild: false`）。
- `package.json` scripts：`build` / `typecheck` / `typecheck:tools` / `typecheck:tools:wip` / `lint` / `format` / `format:check` / `verify` / `check`。

**有意偏离 mcp-manager 的一处**：**第一版不产 `lib/types/**`、不设 `types`、不用 `tsc -b` 项目引用**。
理由：本插件是 `private` + 路径行装载，不需要类型入口；而 mcp-manager 的 `lib/types/**` 已知有两个坑——
committed `.d.ts` 里仍是 `.ts` 说明符（`rewriteRelativeImportExtensions` 没有体现在产物里），且指纹只覆盖两个 JS 产物、
**verify 抓不到 `lib/types` 过期**。要发布 npm 时再补 `composite` + 声明产物（P8 的可选项）。

### 4.3 构建（`tools/build.ts`）

两个目标，指纹写 `lib/.build-manifest.json`（只记 `output + outputSha256 + inputs{path:sha256}`，**不带时间戳**）：

| 目标 | 入口 | 输出 | 关键参数 |
|---|---|---|---|
| host | `src/host/index.ts` | `lib/index.js` | `bundle` / `format:'esm'` / `platform:'node'` / `target:'node22'` / `charset:'utf8'` / `minify:false`（中文错误串必须保持可断言） |
| client | `src/client/index.ts` | `lib/client.js` | `bundle` / `format:'cjs'` → 中间文件 → 套 classic wrapper / `platform:'browser'` / `target:'es2020'` / `jsx:'transform'` + `jsxFactory:'h'` / `external:['react']` / `charset:'utf8'` / `minify:false` |

wrapper 由构建注入（源码里禁写）：
```js
window.__ModuleLoader__.load({
  id: <package.json.name>,
  factory: (require) => { var module = { exports: {} }; var exports = module.exports;
    /* esbuild CJS body */
    Object.defineProperty(module.exports, Symbol.toStringTag, { value: "Module" }); return module.exports; }
});
```

`package.json` 的改动（**以官方运行时校验器为准**，见 `.tmp` 里抽出的 `dsh-client-modules` 源码）：

| 字段 | 值 | 说明 |
|---|---|---|
| `exports["./client"]` | `"./lib/client.js"` | **必需**：声明了 `dsh.client` 却没有这个导出会**直接抛错**；只接受字符串，或带字符串 `default` 的对象 |
| `dsh.client.platform` | `"web"` | **必填且必须是字符串**；只有 `web` 会发布客户端半边 |
| `dsh.client.{inject,external,immediately}` | 不用（可选） | `inject` 只是**排序激活**；`external` 声明非基线运行时 import；本插件只 require `react`（基线种子），所以三个都不需要 |
| `main` | `"lib/index.js"` | 不变（profile 路径行指向它） |
| `exports["./package.json"]` | `"./package.json"` | 已有，保留 |
| `dsh.bundle.patch` | **暂不加** | 只在改走 **bundle 装载路线**时才需要（见 §5 P8）；当前是路线 1「路径行」，加了反而要同时维护 `cordis.patch.yml` |

**运行时不许 `require` Harness Client 包**（`@deepseek-ai/dsh-client-*` 被官方 practices 禁止）——这正是 eslint 客户端 override 要禁的原因。

### 4.4 断言改造（`verify.mjs` → `verify.ts`）

平移现有 61 项，**改掉三处"耦合实现拼写"的断言**（mcp-manager 的教训）：

1. `A` 区"`lib/index.js` 零 import/require"保留（指向**产物**）；
2. 纯函数测试从**经 `internals` 导出**改为**直接 `await import('../src/shared/protocol.ts')`**（Node ≥22.18 type stripping，本机 v24.14.1 ✓）——
   这样 `internals` 这个死导出可以在迁移末尾删掉；
3. 文本断言不得依赖打包器拼写（`const`→`var`、引号、`/* @__PURE__ */`、JSX 不再是字面 `h(`）→ 断言**产物或行为**，不断言实现。

新增分区：`C`（假 `window.__ModuleLoader__` 真跑 factory + 假 DOM）、`D`/`D2`（假 React 按 hook 顺序渲染 + 真跑 `useEffect`）、
`E`（共享常量 ↔ 产物 + 构建指纹）、`P`（数据面：读三态 / last-good / 定点写 / 未知键保留 / 版本锁 / 沙箱拒绝 / 台账有界）。

---

## 5. 分阶段计划

排序原则：**先修行爲，再搬家，再看得见，最后才能改**。每个阶段独立可验收、可提交、可回滚。

### P0 基线冻结与仓库骨架 —— 0.5 人日

- 记录：`commit 5ae2026`、`verify.mjs` 输出（61/61）、`git hash-object lib/index.js`、`.dsh/hooks.json` 哈希、座位台账。
- 落地：`AGENTS.md`（**已产出**）、`.gitattributes`、`.editorconfig`、`.prettierrc.json`；`.gitignore` 加 `.tsbuildinfo/`。
- **验收**：`node tools/verify.mjs` 仍 61/61；`git status` 只多出上述文件。

### P1 修 fail-open（C1 + C2）—— 1 人日 【硬前置】

- `readJson` 三态：`absent`（ENOENT ⇒ 合法空配置）/ `ok`（用 + 覆盖 last-good）/ `error`（**继续用 last-good**，错误内容变化时 warn 一次）。
- `configFor` 用 `ctx.fs.stat()` 的 `version` 做状态核对；watcher 降为加速器；`stat` 抛错时**不清 last-good** + 去抖。
- 断言：① 非法 JSON ⇒ **仍 deny**（last-good 生效）+ 只 warn 一次；② ENOENT ⇒ 空配置（合法清空）；③ 版本未变 ⇒ 不重读（`readText` 计数）；
  ④ 版本变了 ⇒ 只重读一次；⑤ `stat` 抛错 ⇒ 不清 last-good；⑥ 合法编辑在线生效（in-call flip 实验）。
- 这一阶段**仍是 JS**，diff 小、能单独在线验收 —— 不要把"改行为"和"搬家"混进同一次提交。
- **验收**：`verify` PASS（条数增加）；`.tmp` 里用 C1/C2 的在线复现步骤跑一遍；README 补一行行为说明。

### P2 工具链配置 —— 0.5 人日

- 落地 4.2 的所有配置文件 + `pnpm install`（产出 `pnpm-lock.yaml`）。
- `tsc` 门从 P3 起生效（此时无 `src/`）；若 eslint 对空 glob 报错，则 P2 与 P3 合并提交。
- **验收**：`pnpm install` 成功、`pnpm lint` PASS、`node tools/verify.mjs` 仍 61/61。

### P3 协议层 TS 化 + 构建落地 —— 1 人日

- 建 `src/shared/**`（常量 + 纯函数平移到 `protocol.ts`，加类型）；建 `tools/build.ts`（host 目标 + 指纹）；
  `src/host/index.ts` 暂时原样搬插件体（只改成 `import` shared，不拆行、不改逻辑）；`lib/index.js` 改为构建产物。
- `tools/verify.mjs` → `tools/verify.ts`（同一套用例，前两处断言改造见 4.4）。
- **验收**：`node tools/verify.ts` PASS（**条数不减少**）；`lib/index.js` 里 `import`/`require` 计数都是 0；
  profile 路径行**不改**（仍是 `lib/index.js`）；`pnpm build` 后 `git diff` 只动 `lib/index.js` 与指纹。

### P4 宿主数据面 —— 1.5–2 人日

- `src/host/config.ts`（P1 逻辑平移 + 暴露 `state/lastGood`）、`src/host/rows.ts`（快照构造 + 定点 op，纯函数）、
  `src/host/index.ts`（`GET/POST /api/hooks`、`writeText`/`editText` 写入、执行台账环形缓冲、`run` 试运行）。
- **先核对**：`@deepseek-ai/dsh-hook-protocol` 是否拒绝未知字段（决定 `disabled` 是放 hook 层还是 group 层）——用 `.tmp/asar.mjs` 读源码。
- 断言（`P` 区）：读三态与 last-good、快照形状、`_comment` 等等未知键必须保留、定点写只动目标字段、
  旧 `version` ⇒ `stale` 且**文件字节未变**、沙箱拒绝 ⇒ `sandbox` 且文件未变、非法 JSON ⇒ 拒写、
  台账有界 + 输出截断、试运行与真实运行同路径（注入一处差异就会报错）。
- **验收**：`node tools/verify.ts` PASS；宿主行为此时在线看不到（要重启），全部靠 verify + 假 ctx 兜住。

### P5 客户端**只读**看板（Stage A）—— 1.5–2 人日

- `src/client/**` 全套：`ensureStyles` + 座位注册（id `hooks` / order 920）+ fetch 桥 + 7 事件分组 + 来源 tab + 诊断条 + 最近执行（只读）。
  `package.json` 加 `exports["./client"]` 与 `dsh.client.platform`。
- 断言：`A`（包清单/座位/主题与 inline/自适应）、`C`（协议 + 假 DOM 真跑 `apply()`）、`D`/`D2`（渲染与挂载）。
- **在线验收（本阶段唯一一次重启）**：座位台账出现 `hooks/920`；页面能列出两个文件、7 组、条数与诊断；
  空/非法/不存在三种文案分别可见。
- ⚠️ 风险：客户端半边**首次出现**需要 `dsh-client-modules` 重新扫描（启动时扫 `exports["./client"]`）。
  如果重启后 10 分钟仍没有 bundle，先查 `exports` 路径是否存在、`dsh.client.platform` 是否为 `web`，不要盲目再重启。

### P6 受控写入（Stage B）—— 1.5–2 人日

- 客户端：`toggle` / 编辑 / 新增 / 删除 / 移动 / 建文件 / 改 matcher + 两条错误通道 + 版本冲突自动重读；
  **试运行**对话框（与 P4 的 `run` 对接）。
- 断言：静态断言"客户端**不发**整份文件"（源码里不出现 `JSON.stringify(snapshot)` 之类整份回传）；
  每个 op 一轮往返后快照刷新；`stale` ⇒ 提示 + 自动重读；`D`/`D2` 补交互场景；`E` 区（共享常量 ↔ 产物 + 指纹）。
- **在线验收**：改一条 timeout 后 `git diff .dsh/hooks.json` **只允许一行**；toggle 后格式与 `_comment` 不变；
  外部并发改 ⇒ 明确报错、不覆盖；`read-only` 会话 ⇒ `sandbox` 错误文案。

### P7 文档与规范 —— 0.5 人日

- README 重写：新增「设置页」章节；**修正两处既存错误**——L53（`dsh-mcp-manager` 是 bundle 装载，不是路径行）与 L347（"三层"实际是五个区）；
  补"解析失败 ⇒ 保持上一份可用配置"的行为说明。
- `docs/agent-rules-notes.md`（取证、事故、断言台账）、`docs/design-notes.md`（协议字段 + UI 尺寸基准与出处）。
- AGENTS.md 复核：`src/` 已存在 ⇒ §0 判据切到"源码在 `src/**`"；删掉"迁移前为 verify.mjs"的过渡表述。

### P8 端到端验收与发布准备 —— 1 人日

- **反向验证矩阵**：每条新增断言注入一次违规 → 确认精确报错 → 还原（注入脚本写成 `.mjs`/`.ts`，不塞 `node -e`）。
- **编码检查**：`src/**`、`tools/**`、`lib/**` 无 BOM、无 `U+FFFD`、LF 行尾。
- **真实 UI 走查**：7 组渲染、四种空/坏文案、试运行、最近执行、删掉 `.dsh/hooks.json` 后的表现、外部编辑后的冲突提示。
- **发布准备（可选）**：`license` / `files` / `engines` / `src 与 tools 不进 files` / `exports["./package.json"]`；
  manifest 级展示元数据（`icon` ≤256 KiB 的相对路径 + `locale/{en,zh}.json` 的 `{"meta":{title,description}}` + 对应 `exports`/`files` 条目）——
  这是**插件卡片**图标，与设置导航那一格无关（§3.3 的 slot 不给 icon）。
  **装载路线二选一，并在 README 里写明本包用哪条**：① 路线 1「路径行」（当前，不需要 `dsh.bundle.patch`）；② 路线 2「bundle」（加 `dsh.bundle.patch: './cordis.patch.yml'` + `exports["./cordis.patch.yml"]`，由该 YAML 的 `- insert:` 行声明条目，走 `plugin_manager install_bundle`，**不要用 shell 复刻安装流程**）。
  用**临时 profile** 跑 `install_bundle`（绝对路径 → git → tarball 三条路线至少验一条）；`npm pack` 输出扫密钥；卸载后确认无残留。

合计约 **9–11 人日**（不含发布）。

---

## 6. 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| 1 | 宿主半边改动**必须重启**才可见，验收被卡住 | 宿主行为全部用 `verify` + 假 ctx 真跑兜住；"需要重启"的验收集中到 P5/P6 的在线里程碑，一次重启验一批 |
| 2 | 客户端半边首次出现是否要重启**未实测** | P5 第一件事就是加 `exports["./client"]` + 重启 + 查座位台账；失败先查 `exports`/`platform`，不重复重启 |
| 3 | 断言耦合 esbuild 拼写，一改构建就红 | 只断言产物与行为；4.4 列出三处必改的断言 |
| 4 | 假 React **按 hook 顺序**发值，新增状态漏补位 | `scene(...)` 参数顺序 = 状态顺序，写进 AGENTS 4.6；可选改进：把页面状态合成**一个对象 state**，减少顺序耦合（代价：偏离兄弟插件写法） |
| 5 | 写入吃掉用户手写格式 / 未知键（`_comment`） | 三层防线（§3.4）+ 深比较断言 + 在线 `git diff` 只允许一行 |
| 6 | fail-open 没修就上写入 = 一次手滑停掉全部守卫 | **P1 是硬前置**，不进 P1 就不进 P6 |
| 7 | 叶子页面越写越大（mcp-manager 的 `section.tsx` 397 行 / 8 个 state） | 一开始就按 4.1 拆文件；状态对象化；纯函数进 `core/` |
| 8 | 文档声明与实况漂移 | `E` 区断言文档里的路径/脚本存在（mcp-manager 的 E12 同款） |
| 9 | `disabled` 是否被 `dsh-hook-protocol` 接受**未核实** | P4 开工前用 asar 探针读源码确认；被拒就把开关放到 group 层并同步 README |
| 10 | `tsc -b` 声明产物已知有两个坑 | 第一版不产 `lib/types/**`（4.2），发布前再引 |

---

## 7. 未核实清单（不要把推断当结论）

1. `@deepseek-ai/dsh-hook-protocol` 对**未知字段**的容忍度（决定 `disabled` 放哪一层）。
2. `dsh-client-modules` 是否能在**不重启**的情况下发现新出现的 `exports["./client"]`（目前只有兄弟插件的注释与 profile 注释作为间接证据）。
3. ~~`dsh.client.external` / `dsh.client.inject` 的确切语义~~ —— **已核实（本轮）**：官方运行时校验器 `parseDshClient` 只接受 `{platform, inject?, external?, immediately?}`；`inject` 仅用于排序激活，`external` 用于声明非基线运行时 import，某一行不得声明自己的包。本插件只需要 `platform: 'web'`。
4. 页面发起的写入在**无 session** 时用部署默认档（`sandboxPolicy.resolve({})`）是否会真的通过沙箱校验——本机是 `danger-full-access`，`workspace-write` 下未实测。
5. `sessionQuery.observeSession()` 对**已持久化、非 live** 的 sessionId 是否返回可用 `header.cwd`（只读了签名）。
6. README 里那些热重载/写入边界的实测结论是**上一轮**的记录，本轮未重新测量（本轮只核对了 61/61 与文件现状）。
7. `slots.register` 的字段白名单是**读 `register()` 实现**得出的（逐字段展开 ⇒ 未列举的键被丢弃），不是官方文档明示。
8. 假想中的 `settings.plugins.tab` 作为备用座位未验证可用性。

---

## 8. 与兄弟插件的对齐清单（做完逐条打勾）

- [ ] `lib/**` 是构建产物并提交；`src/**` 是唯一源码；指纹 + `git diff --exit-code lib/` 守门
- [ ] 宿主半边零裸 import（eslint `HOST_BARE_IMPORT` + 产物断言）
- [ ] 客户端产物：恰好一次 `window.__ModuleLoader__.load`、`id == package.json.name`、`require` 只有 `react`（单点 `react.ts`）
- [ ] `exports["./client"]` + `dsh.client.platform === "web"`（声明 `dsh.client` 就必须有前者，否则 loader 抛错）；`main` 仍指向 `lib/index.js`
- [ ] 装载路线在 README 里写明（路径行 / bundle 二选一）；若走 bundle 则 `dsh.bundle.patch` + 补丁文件 + `lib/**` 都已提交
- [ ] `settings.section` 走 `slots.inject` 注册，`id/order/label`，字段白名单内（无 `icon`）
- [ ] 零硬编码颜色（十六进制只作 `var()` fallback）；样式只进注入表且可热刷新
- [ ] 一条错误一个渲染点；状态色有正面证据；空分组照常渲染并带条数
- [ ] 定点 op + 版本锁；未知键与格式保留；`stale`/`sandbox`/`invalid-json`/`not-preservable` 四种错误分明
- [ ] 试运行与真实运行同路径
- [ ] `node tools/verify.ts` 是唯一必跑命令、零依赖、不经过构建链；每个新断言都有反向验证
- [ ] README / AGENTS / docs 三份文档互相指向，且引用的路径都存在

---

## 9. 执行记录（每阶段完成后追加，含"没实测什么"）

### P0 —— 完成（commit `223934b`）

- 产出：`AGENTS.md`、`docs/plan-hooks-ui-and-ts.md`、`docs/baseline-p0.md`、`.gitattributes`、`.editorconfig`、`.prettierrc.json`、`.gitignore` 补 esbuild 中间产物。
- 验收：`node tools/verify.mjs` → `61 passed, 0 failed`（源码未动）；新文件编码检查通过（无 BOM / 无 `U+FFFD` / LF）。
- **未实测**：无（本阶段只加文件）。

### P1a —— 完成（commit `fceaaa0`）

- 产出：`readJsonFile` 三态（`absent`/`ok`/`error`）+ `lastGood` + 错误内容去重告警 + 沿用时的限流 info；`configFor` 拆分出 `loadConfig`。
- 断言：新增 `fail-open` 区 4 条（写坏后仍 deny、删除即清空、顶层非对象也算坏、修好即按新配置跑且错误计数重置）。
- 反向验证：把 `stale` 打回 `false`（锚点唯一，命中 1 次）→ **3 条**精确报错 → 还原后 61+4 = 65/65，且 `lib/index.js` 与注入前字节相同。
- **未实测（需要重启 DSH）**：在线复现"写坏后 deny 仍在"、在线热重载；profile 里跑的还是重启前的旧模块。

### P1b —— 完成（本次提交）

- 产出：`readVersions`（`ctx.fs.stat().version` 探测）+ `sameVersions` + `configFor` 改为「版本核对 → watcher → TTL」三层；`loadConfig` 记录 `entry.versions` / `entry.hasHooks`（**无论成败都记**，坏文件没改动时不再重复读）；并发在飞的条目被共享。
- 断言：新增 `C2` 区 3 条（版本没变则 TTL 到期也不重读 / 内容一变立刻重读 / `stat` 抛错只降级 TTL 且不丢 last-good）；假 `ctx.fs` 增加 `version: true` 选项（默认**不给** version，于是原有那批 TTL 用例同时在守"没有版本通道的 provider"）。
- 反向验证：**双向**注入 —— ① 关掉版本通道 → 预期 2 条报错；② 把"内容变了"看成"没变"（最危险的陈旧方向）→ 预期 1 条报错。两次都精确命中且还原后 68/68。
- **未实测（需要重启 DSH）**：真实 `ctx.fs` 的 `version` 在 Windows 上是否真的随内容变化（本机未采样）；每次事件点多 2 次 `stat` 的实际开销（计划里按 ~10–100µs 估）。

### P2 —— 完成（本次提交）

- 产出：`package.json`（scripts / engines / packageManager / devDeps，版本 0.2.1）、`tsconfig.base.json`、`tsconfig.host.json`、`tsconfig.client.json`、`tsconfig.tools.json`、`tsconfig.tools.wip.json`、根 `tsconfig.json`（两半的 project references）、`eslint.config.js`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`；`.gitignore` 补 `lib/.types/`。
- 关键决策：**不产 `lib/types/**`**。composite + `emitDeclarationOnly` 的声明产物落在**被 gitignore 的 `lib/.types/`**，`package.json` 里也**不设 `types`** —— 本包是 private + 路径行装载，没有类型入口需求，于是直接绕开 mcp-manager 已知的两个坑（committed `.d.ts` 里仍是 `.ts` 说明符；指纹覆盖不到 `lib/types` 导致过期抓不出来）。
- 验收：`pnpm install` 成功（26.9s，pnpm 12.5.1，`lockfileVersion: '9.0'`）；`pnpm check`（format:check + lint + verify）全绿，`verify` 仍 **68/68**；三个 tsconfig **语法与选项组合验证通过** —— `tsc -p` 只报 `TS18003: No inputs were found`（`src/` 还不存在，属预期），没有"未知选项 / composite 冲突 / 空 glob"之类的配置错误。
- 偏离计划两处（都记账）：
  1. `format` / `format:check` 加了 `--no-error-on-unmatched-pattern`，并把 `yml/yaml` 从 glob 里去掉。原因：P2 时 `src/**` 不存在，prettier 对空 glob **退出码 2**；而 `*.{yml,yaml}` 会把 `pnpm-lock.yaml` 这种工具生成物重排（第一次跑就改了它）。代价：glob 写错时不再报错 → **待办**：P3 之后在 verify 里加一条"format/lint 的 glob 指向真实存在的目录"断言（对应 mcp-manager 的 E11/E12）。
  2. `pnpm check` 目前**不含 typecheck**（此时没有任何 `src/`，`tsc -b` 必然 TS18003）。**P3 落地后立刻把 `pnpm typecheck && pnpm typecheck:tools` 加回 `check`**。
- **未实测**：typecheck 门本身（无输入）；eslint 的类型感知规则（无 `src/` 文件，`pnpm lint` 现在是"全部被 ignore → 0 文件"的通过）。

### P3a —— 完成（本次提交）：纯协议层 TS 化 + 等价性证明

- 产出：`src/shared/constants.ts`、`src/shared/types.ts`、`src/shared/guards.ts`、`src/shared/protocol.ts`（严格类型；`tsc -p tsconfig.host.json` 与 `tsc -p tsconfig.client.json` **两个视角都干净** —— 这一点同时验证了"shared 不许碰 DOM / 不许碰 process"）。
- **等价性证明（这是本阶段的核心）**：`tools/verify.mjs` 的纯函数测试与新增的 `2b 差分对拍` 区**直接 `import` TS 源码**（Node ≥22.18 剥类型），并在迁移期与 `lib/index.js` 的 `internals` **逐例对拍**（递归按键排序后比较，只看语义不看键序）。自检 68 → **74 条**，全绿。
- 反向验证（两个真实语义漂移）：
  1. `decisionForRank(2)` 从 `ask` 改成 `allow` → 期望被差分抓到；
  2. `matchesMatcher` 的字面量多选退化成全匹配 → 期望被差分抓到。
  **两个方向都抓到了。** 但第一轮暴露了差分 harness 自身的一个缺陷：合并用例只对拍**整个数组**时，rank 最高的 `deny` 项把 `ask` 分支彻底掩盖 → 改注入也抓不住（正是 AGENTS 4.3 的第五个陷阱"平凡通过的断言"）。修成"**逐条单元素 + 整数组**"两轮对拍后两个注入都被抓住，注释里记了这个坑。
- 判据调整：AGENTS §0 的"源码/产物"判据从"`src/` 是否存在"改成"**`lib/.build-manifest.json` 是否存在**"。理由：P3a 之后 `src/` 已存在但宿主体还在 `lib/index.js` 里，只看目录会误判成"lib 是产物"。
- 关闭 P2 债务：新增断言"A：format/format:check 的 glob 指向真实存在的目录"。
- **本阶段未做（留给 P3b）**：宿主体仍手写在 `lib/index.js`；`internals` 这个只为自检存在的导出还不能删（差分对拍要靠它）；`tools/build.ts` 未落地；自检仍是 `tools/verify.mjs`。

### P3b —— 完成（本次提交）：宿主体搬 TS + 构建产物 + 自检迁移

- 产出：`src/host/service-types.ts`（本地最小 Service 契约）、`src/host/index.ts`（宿主体，逐行保语义）、`tools/build.ts`（esbuild 宿主目标 + 指纹）、`lib/index.js`（**首次成为构建产物**）、`lib/.build-manifest.json`、`tools/verify.ts`（`git mv` 自 `verify.mjs`）。
- 自检：**74 → 73 条**（删掉了迁移期专用的 `2b 差分对拍` 区共 5 条 —— 那是**有意减少**，不是丢断言：产物就是源码，自己和自己对拍没有意义），其余全部保留并照旧全绿。另新增 `E` 区 4 条构建指纹断言，净变化见提交说明。
- **行为等价性用自检本身证明**：迁移过程中自检抓到**一处真实回归** —— 我一开始把沙箱策略对象**重建**成 `{mode, workspaceRoot, sessionId}`，而原实现是**原样透传** provider 给的对象；`assert.deepStrictEqual` 区分"键存在但为 undefined"与"没有这个键"，于是 3c 区两条断言当场红。改回原样透传（`ResolvedPolicy.passthrough`）后恢复。**这是"看代码觉得等价"和"证明等价"的区别。**
- 新增 `E` 区（构建指纹，AGENTS §4.8 的两把锁之一）：产物 sha256 ↔ 指纹、每个源文件 sha256 ↔ 指纹、`src/**` 无漏网文件。反向验证：① 改 `src/**` 不重建 → `E：指纹覆盖到的每个源文件都没有变` 精确报错；② 手改产物 → `E：产物 sha256 与指纹一致` 精确报错；两次还原后字节相同、73/73。
- 三处**故意不听 lint** 的地方（都写了理由）：`@typescript-eslint/return-await` 要求把 try 里的 `return next()` 改成 `return await next()`，而那会把下游的 rejection 吸进本函数的 catch，catch 里又会**再调一次** `next()` → 下游跑两遍。改成"不满足条件就落到 try 之外的 `return next()`"，语义与手写版逐字一致且不再需要 lint 例外。
- 其他决策：`FakeReact`/指纹无关；`pnpm check` 已接上 `typecheck && typecheck:tools`（P2 的欠账）；`tools/verify.ts` 走 Node 类型剥离运行，它的类型收紧进度单独用 `tsconfig.tools.wip.json` 量（当前 155 条，**只许下降**，不进门槛）。
- 文档：AGENTS §0 判据改为"看 `lib/.build-manifest.json`"、§4.8 从"迁移期纪律"改写成"产物纪律"、§2.9/§5 的 `verify.mjs` 引用改为 `.ts`；README 新增「源码与构建」小节、把"两条失效通道"改成**三层**（版本核对 / watcher / TTL）。
- **未实测（需要重启 DSH）**：产物在真实 host 里加载（profile 路径行指向的仍是旧模块实例）。

### P4a —— 完成（本次提交）：只读数据面 + `disabled` 的诚实性

- **开工前先核实了两件事**（结论写进 `docs/design-notes.md` §1）：
  1. **通道选型**：`dsh-client-store` 是**浏览器本地**存储原语，不是宿主↔客户端通道；官方确实另有 Remote（typert）RPC 与 `$events` 事件流两条路，但兄弟插件已评估并否决 Remote（要手写严格 codec、客户端 bundle 无 zod 种子、能力集构建期固定）。结论：继续用 `connection.fetch.register()` 的精确路由 —— 白拿 `/api` 前缀的 Host/Origin 围栏（403）与浏览器鉴权（401）以及绑 scope 的 disposer。
  2. **`disabled` 能不能落在 hook 上**（§2.5 要求"改之前先核对"）：`@deepseek-ai/dsh-hook-protocol` **根本不解析配置文件**（只有 matcher 语义、输出 codec、`runCommandHook(已解析的 hook)`、判决合并）→ 协议层不存在"未知字段被拒"的问题。于是纪律从"先核对再决定"变成两条：解析层**保留** `disabled`、执行层**跳过**它，并且必须有**真子进程**断言证明它真的没跑。
- 产出：`src/host/data-plane.ts`（`HOOKS_ROUTE`、wire 类型、**纯函数** `buildSnapshot`、`registerHooksRoute`）；`src/host/index.ts` 增加 `cwdFor` / `sourceViewOf` / `inspect` 与路由注册；`CacheState` 增加 `stale`；`runPoint` 跳过 `disabled`；`parseHookConfig` 记录 `disabled`。
- 断言：新增 `P` 区 13 条（注册契约 3 条 + 纯函数快照不变式 3 条 + 真实文件系统上的 handler 行为 7 条）。自检 **76 → 89**。
- 反向验证 5 个注入，全部精确命中（其中 2 条要先重建产物才认，因为集成断言跑的是 `lib/index.js`）：过滤空事件 → "7 个事件恒全列"红；runner 不跳 `disabled` → 哨兵文件出现、断言红；`staleInUse` 固定 false → 红；无会话时拿 `process.cwd()` 顶上 → 红；500 里塞 `data` → 红。还原后 89/89。
- 过程中自检抓到**两处我自己的测试错误**（都被修掉，不是产品问题）：断言取错下标（把"用户级组"当成了"项目级组"，顺带确认了 `groups[0]` 是用户级 = 合并顺序正确）；把 `disabled` 哨兵脚本写成 `.mjs` 却在里面用 `require`（ESM 没有 `require`）。
- **未做（留给 P4b）**：POST 与定点写（`writeText` + 版本锁 + 深比较保留未知键）、有界执行台账（状态色的唯一证据来源）、试运行（复用 `runPoint`）。**`capabilities.writable` 现在是 `false`**，页面据此显示只读横幅。
- **未实测（需要重启 DSH）**：真实 `/api/hooks` 的鉴权与围栏（403/401）、以及页面能否真的拉到数据。

### P4b —— 完成（本次提交）：写路径（纯函数区）

- 产出：`src/host/write.ts`（`DocStyle` / `detectStyle` / `serialize` / 9 个定点 op / `applyOp` / `preservationProblem` / `parseHooksRequest`）；`ParsedGroup.rawIndex` + `ParsedHook.rawIndex`（**文件里的真实下标**，因为解析会跳过若干条目，`parsedIndex !== rawIndex`）；`hooksMapOf()` 导出给写路径共用（解析与写入必须是同一条布局判定）。
- 开工前核实了 `ctx.fs` 的**精确契约**（`cordis_inspect_query` host Service `fs`），修正了三条认知：`FsInfo.version` 其实是**必填**（所以 C2 的版本通道总可用）；`FS_STALE_VERSION` 是版本冲突的精确错误码；`writeText` 的第五个参数是 `sandboxPolicy`（必须传调用会话那一份）。
- **关键取舍**：写盘不走 `fs.editText`，而是"克隆整份文档 + 只改目标节点"，理由写在 [docs/design-notes.md](docs/design-notes.md) §2 —— `disabled` 开/关与 `timeout=null` 都是**增删键**，`editText` 没有可靠锚点（只能猜命令那一行的形状），猜错就是改坏用户文件。代价是"重新序列化"，用手写的不规则格式第一次保存时会被规范化，之后是不动点。
- 断言：新增 `W` 区 9 条（风格不动点 / 新文件形状 / 每个 op 只动目标 / 越界拒写 / **保留性证明本身能被证伪** / 请求体校验拒绝 16 种畸形输入 / 端到端未知键保留）。自检 **89 → 98**。
- 反向验证 4 个注入全部精确命中：删除类补偿方向退回 `both`、下标校验放过 `-1`、序列化忽略 tab 缩进、**把保留性证明改成永远返回"没问题"**。还原后 98/98。
- **写路径自身抓到过一个真 bug**（第一版）：`removeHook` 的补偿方向写成"两侧都抹掉"，于是删除操作会被自己的保留性证明拒写。是 `W：…只动目标` 那条断言把它抓出来的 —— 这正是"证明"存在的意义。
- **未做（留给 P4c）**：`POST /api/hooks` 的路由接线（版本锁 `replaceIfVersion`/`createIfAbsent`、`FS_STALE_VERSION` → `stale`、`invalid-json` 时**拒写**、沙箱策略透传）、有界执行台账、试运行。

### P4c —— 完成（本次提交）：把写路径接线到 `POST /api/hooks`

- 产出：`registerHooksRoute(connection, {inspect, write})` —— GET 读快照 + POST 定点写挂在同一条路由上；宿主侧 `prepareWrite` / `writeHookFile` / `handleWrite`（新增 `agentForSession` 统一"读要 cwd、写还要沙箱策略"的解析）；`ReadState` 补 `target` 与 `text`（写路径要原文探测缩进/行尾）；`capabilities.writable` 改由宿主的 `inspection.writable` 声明（不再写死 false）。
- **三道防线落地**：① **读不懂就拒写**（`invalid-json`，409）—— 覆盖读不懂的文件等于删用户内容；② 保留性证明不过就拒写（`not-preservable`）；③ 写盘带**版本锁**，且 `prepareWrite` 拿不到版本时拒写（`no-version`）—— **绝不做无守卫写入**。
- 错误码 → 状态码：`stale`/`exists`/`not-preservable`/`invalid-json`/`no-project`/`no-version` = 409；`absent`/`not-found` = 404；`sandbox` = 403；`bad-op`/`bad-json` = 400。页面据此把失败分别说清（§3.9）。
- 断言：新增 `P3` 区 7 条（真实文件系统上跑 POST）：落盘 + 未知键保留 + **乐观锁用的是读到的那个版本** + 版本冲突（文件不变）+ 坏文件拒写（文件不变）+ `absent`/`createFile`/`exists` + 越界 + 沙箱 + 畸形请求体（一条都没写到盘）+ `not-preservable` 透传；`E` 区补上 `write.ts` 的产物标记。自检 **99 → 107**。
- 反向验证 3 个注入全部精确命中并还原：乐观锁传假版本、读不懂也照写、`capabilities.writable` 写死 false。
- **自检又抓到一个"假件比真的弱"的问题**：`createFile` 在自检里 500，因为假 fs 不建父目录；而真实 provider 的 `writeFileAtomic` 里有 `mkdir(dirname, {recursive:true})`（已读 asar 源码核实）。修法是让假 fs 与真实同能力 —— 否则会出现"自检里假失败、真机没事"，反过来也可能掩盖真问题。
- **未做（留给 P4d）**：有界执行台账（状态色的唯一证据来源）与试运行（复用 `runPoint`）。

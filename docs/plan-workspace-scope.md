# 工作区作用域选择器 —— 修改方案（**已实施**）

> **实施状态**：已按本文落地（提交信息 `feat: 设置页 Hooks 支持按工作区作用域查看与编辑`）。
> 自检 124 → **147 条全绿**；`pnpm typecheck` / `lint` / `format:check` 均 0；`node tools/build.ts`
> 连跑两次产物逐字节相同。宿主半边需要**重启 DSH** 才生效（客户端半边由 HMR 替换）。
>
> **实施中相对本文的三处增量**（都是加法，代码与 README 里都已写清）：
>   ① `HooksSnapshot.session`：与所选作用域**无关**的"当前会话实际会跑什么"（§2.6 要求页面能回答它）。
>      会话未知时是**三态**：计数为 `null`，页面说"无法判断"，**不许**说"当前会话生效 0 条"。
>   ② 作用域第三种取值 `current`（**当前会话项目**）：不进下拉，会话项目就不在 `workspaceRegistry`
>      清单里（本机正在开发的插件项目正是如此），旧页面本有的"改当前项目级配置"能力会丢失。
>   ③ 取数失败相位补恢复控件（`重试` / `回到用户级配置`）：选择器引入后"工作区被删掉（404）"
>      不再是把页面卡死、只能整页刷新的死胡同。
>   另：D1–D6 全部按本文推荐值实施；台账匹配从 `event + command` 收紧为
>   `event + command + projectRoot`（§2.3）。
>
> 目标形态：设置页「Hooks」顶部左起是一个**作用域下拉框**（`用户` / 各工作区），右边是条数、
> 搜索框；工具条是「已安装 N / 刷新 / ＋新建」；下面是**按事件分组的 hook 卡列表**，每条卡右侧
> 一个开关（启用/停用），展开后是编辑 / 试运行 / 删除。
> 默认作用域 = **用户（全局）**。
>
> 下文正文保留**编写时的原始形态**（规划文档，不回填实施细节）。所有"已核实"标注都指当时真读过
> 源码/产物，不是记忆；行号对应 v0.2.1 的 `src/**`。

---

## 0. 一句话结论

这件事**不是重写**，而是三件事：

1. **作用域参数化**：`GET/POST /api/hooks` 增加"看哪一份文件"的显式参数（`scope` + `workspaceId`），
   宿主按它定 `projectRoot`；现有写路径（定点 op + 保留性证明 + 版本锁）**一行机制都不用换**。
2. **工作区清单由宿主给**（`ctx.workspaceRegistry.list()`），页面只负责摆到下拉框里。
3. **页面从"两个来源两张卡"改成"一个作用域一份文件 + hook 卡列表"**，同时补上"新建一条 hook"
   需要的那个唯一缺口 op（`addGroup`）；其余操作（停用/删除/编辑/试运行/新建文件）**宿主已经全有**。

代价最大的不是功能，而是**诚实性**：下拉框一换，页面显示的就不再是"当前会话实际会跑的那一份"，
如果写入还按会话 cwd 落笔，就会出现**"看着 A 项目、改到 B 项目"的静默改错文件**。
下面第 2 节把这条钉死。

---

## 1. 现状盘点：已有 / 缺什么

| 截图里的能力 | 现有实现 | 结论 |
|---|---|---|
| 下拉选择作用域 | 无（只按会话 cwd 自动定项目） | **要新增** |
| 显示某份文件的 hook 列表 | `FileView.events[7]`（`src/client/section.tsx` 的 `SourceCard`） | 复用数据，**重做排版** |
| 条数 `钩子 N / 已安装 N` | `snapshot.total` / `FileView.hookCount` | 复用，**改口径**（见 §6.2） |
| 刷新 | `nonce + 1` 重新 GET | 已有 |
| 启用 / 停用（开关） | `setHookDisabled`（`src/host/write.ts`，Runner 真的跳过它） | 已有，**换 UI 控件** |
| 删除 | `removeHook`（两步确认） | 已有 |
| 编辑 command | `setHookCommand` | 已有 |
| 试运行 | `op:'dryRun'`（与真实运行共用执行路径，不进台账） | 已有 |
| matcher / timeout 编辑 | `setGroupMatcher` / `setHookTimeout` | 已有（放进卡片展开区） |
| 新建**配置文件** | `createFile` | 已有 |
| 新建**一条 hook** | 宿主 `addHook` 只认已存在的 group | **要补 `addGroup`**（见 §5.3） |
| 搜索框 | 无 | **纯前端过滤**（不发请求） |
| 行状态色（点/开关） | 台账 `event + command` 匹配 | **要加 `projectRoot`**（见 §2.3） |

**关键事实（已核实）**：写路径的 op 集合已经完整
（`src/host/write.ts:29-77`：`setHookCommand` / `setHookTimeout` / `setHookDisabled` /
`setGroupMatcher` / `addHook` / `removeHook` / `moveHook` / `removeGroup` + `createFile`），
客户端 `WriteIntent`（`src/client/write.ts:15-34`）也一一对应。
所以这轮**不需要新的写机制**，只需要一个新 op 和一个新参数。

---

## 2. 三条不可动摇的语义（这轮的核心风险）

### 2.1 选择器是"编辑作用域"，不是"运行时开关"

运行时的解析链**一行都不改**：hook 仍然按*触发事件的会话*的 `cwd` → 最近 `.git` 祖先 →
`<projectRoot>/.dsh/hooks.json`，用户级永远参与合并（`src/host/index.ts` 的 `contextFor` / `configFor`）。
下拉框只决定**页面读哪份文件、写哪份文件**。

因此页面必须在三个地方说真话（否则就是 AGENTS §2.6/§2.8/§3.9 的违规）：

- 选中 `用户` → 一句话："用户级配置：对**所有**项目生效；每个项目还会叠加它自己的项目级配置。"
- 选中工作区 X，且 `root(X) === 当前会话的项目根` → "当前会话就在这个工作区，改动**立即**对之后的调用生效。"
- 选中工作区 X，`root(X) !==` 当前会话项目根 → "你正在看/改 **X**；当前会话在 **Y**。这次改动
  **不会**影响当前会话，只影响以后在 X 里打开的会话。"（黄底横幅，与现有 `staleInUse` 横幅同级）
- **不许**把工作区列表里的 `default` 之类当成"当前项目"的代称 —— 当前项目只有一个来源：会话 cwd。

### 2.2 写入必须定点到被选中的作用域，**绝不回落会话项目**

这是本方案最容易出错、后果最重的一处：如果页面选中工作区 X 而请求里不带 X，
宿主会按会话 cwd 解析出 Y 并把 X 的文件展示、Y 的文件改写 —— **静默改错文件**。

硬纪律（写成断言）：

- 客户端发起的**每一次** `write` / `dryRun`，只要当前作用域是工作区，请求体**必须**带 `workspaceId`；
  客户端侧用"作用域 → 请求体"的单一构造函数产出，禁止各调用点自己拼。
- 宿主侧：请求带了 `workspaceId` 而它不在白名单里 ⇒ **拒写**（`unknown-workspace`），
  **绝不允许**"拿不到就退回会话项目"。宁可写失败，也不改写错的文件。
- 请求**不带** `workspaceId` 时（旧客户端 / `file:'user'`）保持现状语义，向后兼容。

### 2.3 状态色必须有证据：台账要按项目匹配

现状：`latestRunFor(entries, event, command)` 只匹配 `event + command`（`src/host/ledger.ts:97-103`）。
同一个 `ctx` 服务所有会话，所以**两个项目里命令字面相同的 hook 会互相上色** ——
这在"只看当前项目"的旧页面里已经是隐患，换成下拉框后会被用户直接看见（切到 A 项目看到 B 项目的绿点）。

改法（小、局部、可断言）：`LedgerEntry` 增加 `projectRoot: string`（`runPoint` 里 push 时宿主本来就有
`context.projectRoot`），`latestRunFor(entries, { event, command, projectRoot })` 三者都匹配。
断言：**同命令在别的项目跑过 → 这一行仍是灰「未运行」**（反向验证：把 projectRoot 从匹配里去掉 → 该断言必须红）。

---

## 3. 工作区清单从哪来（已核实）

**首选：宿主侧 `ctx.workspaceRegistry.list()`。**

- 契约（已核实，`app.asar: dsh/node_modules/@deepseek-ai/dsh-workspace/lib/types/entity.js`）：
  每条记录有 `id` / `path` / `title` / `createdAt` / `updatedAt` / `sessionIds`，
  `path` 是 **realpath 规范化**过的绝对路径。
- 同目录成熟插件 `dsh-skill-manager` 已经这么用（`lib/index.js:164-172` 的 `fallbackCwd`），
  证明该服务在 desktop 载体上真实存在。
- 页面拿到的必须是**宿主自己也能解析出 `projectRoot` 的那个清单**：因为写路径要靠它做白名单校验
  （§2.2）。让宿主把清单随快照一起发下来，**只有一个数据源**，不会出现"下拉框里有 A、写 A 却被拒"。
- 读数时机：**每次请求时**用 `ctx.get('workspaceRegistry')` 现取（不要在 `apply()` 里读属性 ——
  Cordis 服务渐进可用，§2.12 那条线上事故就是"apply 时读到 undefined 就静默跳过"）。
  服务不存在 ⇒ `workspaces: []` + `workspacesAvailable: false`，页面说"宿主没有提供工作区清单"
  （**绝不能渲染成空下拉**：空和不存在必须长得不一样，§3.6/§3.9）。

**备选（不采用）：客户端 root kit 的 `props.useWorkspaces`。**

`settings.section` 是 `{kind:'list', scope:'root'}`，页组件确实能拿到 root standard kit 的
`useSessions` / `useWorkspaces`（`dsh-skill-manager/lib/client.js:391-399` 在用，其注释记录了
快照形状 `{workspaceId, path, title, sessionIds, createdAt}`）。不采用的理由有两条：

1. 它是 **ui-store 的视图状态**，与宿主 `workspaceRegistry` 是两份数据，可能漂移；
   而我们的写路径**必须**用宿主的那一份做白名单。一份就够，不要两份。
2. 会往客户端引入一个 props-hook：本插件的渲染自检（`tools/verify.ts` 的假 React，**按 hook 位置发值**，
   `tools/verify.ts:262-323`）目前以 `component()` **无 props** 调用；引入 props-hook 要改驱动层，
   收益为零（清单反正要从宿主过一遍才能校验）。

**工作区路径 ≠ 项目根**：`projectRoot = 最近含 .git 的祖先`（与 `dsh-skill-filesystem` 同一约定，
`findProjectRoot`）。所以宿主必须在快照里**同时给出** `workspace.path` 与 `projectRoot`，
并且两者不同时页面要明说（否则用户会问"我改的是 A，为什么落到了 B/.dsh/hooks.json"）。

---

## 4. 数据面契约（在现有契约上做**加法**）

路由字面量不变（`HOOKS_ROUTE = '/api/hooks'`，`src/shared/constants.ts:62`；宿主注册、客户端 fetch 必须逐字一致）。

### 4.1 `GET /api/hooks`

| query | 取值 | 缺省 | 语义 |
|---|---|---|---|
| `sessionId` | 会话 id | 无 | 现状：定"当前会话的项目根"、给状态来源 |
| `scope` | `current` \| `user` \| `workspace` | **`current`** | 看哪一份 |
| `workspaceId` | `workspaceRegistry` 里的 id | 无 | `scope=workspace` 时必给 |

> `scope` 缺省保持 `current`（现状语义）是**刻意的**：让 P 区现有断言（"无会话上下文 → 只列用户级"、
> "有会话 → 项目级 + 用户级两份"）继续有效，新语义只走显式参数。默认**页面**发 `scope=user`（用户要求：
> 默认全局）。

响应 `data` **新增字段**（旧字段一律不动）：

```jsonc
{
  "scope": {
    "kind": "user",                     // 实际生效的作用域（回显）
    "requested": "workspace",           // 客户端请求的
    "workspaceId": "…", "workspaceTitle": "agent-go", "workspacePath": "D:\\project\\agent-go",
    "projectRoot": "D:\\project\\agent-go",   // ← 最近 .git 祖先；与 workspacePath 不同时必须分别显示
    "isCurrentSession": true            // null = 当前会话项目未知（不编造，§2.8）
  },
  "workspaces": [
    { "id": "…", "title": "agent-go", "path": "D:\\project\\agent-go",
      "projectRoot": "D:\\project\\agent-go", "isCurrent": true }
  ],
  "workspacesAvailable": true,          // false = 宿主没有 workspaceRegistry（≠ 没有工作区）
  "files": [ /* 形状不变 */ ],           // user → 只有 user 一项；workspace → project(选中那份)+user
  "events": [ /* 仍是固定 7 项 */ ],     // ★ 语义升级为"这个作用域真实会跑的合并配置"
  "total": { … }, "staleInUse": false, "capabilities": { "writable": true }
}
```

**`events` 的语义要点（保住 AGENTS §2.6）**：`scope=workspace` 时，`effective` 必须取
**`configFor(root(X))` 的那份缓存**（runner 正在用的同一份），而不是路由里重新解析一遍；
`scope=user` 时 `effective` = 用户级自己的 groups。
于是"生效 7 事件视图"永远等于"一个会话在 X 里跑起来会得到的那份配置"，
`staleInUse` 取该 projectRoot 缓存条目的 `state.stale`。

### 4.2 `POST /api/hooks`（写与试运行）

请求体新增一个可选字段，其余**逐字不变**（不给 `workspaceId` = 现状）：

```jsonc
{ "file": "project", "workspaceId": "…", "op": "setHookDisabled", "event": "PreToolUse",
  "groupIndex": 0, "hookIndex": 1, "disabled": true }
// dryRun 同样：{ "op": "dryRun", "file": "project", "workspaceId": "…", "event": …, "groupIndex": …, "hookIndex": … }
```

判定表（宿主侧，`file` 与 `workspaceId` 是**不可信输入**，先校验再用）：

| `file` | `workspaceId` | 目标路径 | 备注 |
|---|---|---|---|
| `user` | 必须缺省（给了就 `bad-op` 400） | `$DSH_HOME/hooks.json` | |
| `project` | 给了，且在白名单 | `root(workspaceId)/.dsh/hooks.json` | 新能力 |
| `project` | 给了，不在白名单 | **拒写** `unknown-workspace`(404) | 绝不回落 |
| `project` | 缺省 | 会话 cwd 的 projectRoot（现状） | 向后兼容 |

**新增错误码**（配一句独立的人话，§3.9；不要糊成"保存失败"）：

- `unknown-workspace`（404）："这个工作区已经不在宿主的清单里了（可能被删过），请刷新页面。"
- `no-workspace-registry`（409）："宿主没有提供工作区清单，只能改当前项目和用户级配置。"
- 现有 `no-project` 的文案要顺手改准：选中工作区后它不再等于"当前会话没有工作区"。

**沙箱的诚实降级（要写进文案，§1.6）**：写盘用的是**调用会话**的 `sandboxPolicy`
（`writeHookFile` 的第 5 个参数）。当前会话的 `workspaceRoot` 很可能不是 X，
所以**改别的项目可能被沙箱拒绝**（`sandbox` 403）。这是对的，不许提权；
页面在"非当前工作区"横幅里提前提示一句，用户才不会以为是 bug。

---

## 5. 宿主改动清单（`src/host/**`）

### 5.1 `service-types.ts`

- 新增 `WorkspaceService`（只有 `list?(): unknown` / `get?(id: string): unknown`，返回 `unknown`，
  由宿主侧收窄 —— 与 `SandboxPolicyService` 同款防御性声明）。
- `HostContext.get` 增加重载 `get(name: 'workspaceRegistry'): WorkspaceService | undefined`。
- 新增 `WorkspaceRecord` 最小形状 `{ id: string; path: string; title?: string }` 与收窄函数
  （放 `shared/guards.ts` 或 host 内私有，二者择一，不要两处都写）。

### 5.2 `data-plane.ts`

- `HooksInspection` 增加 `scope: ScopeView` / `workspaces: WorkspaceItemView[]` / `workspacesAvailable: boolean`。
- `buildSnapshot()` 增加一份纯函数 `scopeViewOf(...)`（与现有 `groupViewOf` 同风格），
  不变式写进注释：**`events` 恒 7 项**、`scope.projectRoot` 与 `scope.workspacePath` 分开、`isCurrentSession` 允许 `null`。
- `RouteDeps.inspect(sessionId, target)` 增加 `target` 形参；`RouteDeps.write/dryRun` 增加 `target`。
- `sessionIdOf` 旁新增 `scopeOf(request)`（解析 query，**只做字符串收窄**，语义在宿主）：
  `scope` 不认识 ⇒ 400 `bad-op`；`scope=workspace` 缺 `workspaceId` ⇒ 400。
- `statusFor`：`unknown-workspace` → 404，`no-workspace-registry` → 409。
- `parseHooksRequest`（在 `host/write.ts`）增加 `workspaceId?: string` 校验（非空字符串；`file==='user'` 时给了就 400）。

### 5.3 `write.ts`（新增一个 op）

```ts
| { op: 'addGroup'; file: FileKind; event: HookEvent; matcher: string | null; command: string; timeoutSec: number | null }
```

- `applyOp` 实现：`eventListOf` 不存在则按 `hooksMapOf` 的形状**创建**事件数组（注意顶层是
  `{hooks:{…}}` 还是裸事件映射 —— 复用 `mapPath()` 的判定，不要另写一套）；
  `push({ ...(matcher ? {matcher} : {}), hooks:[{type:'command', command, ...(timeout?{timeout}:{})}] })`。
- `changes` = 一次 `mode:'index'` 的追加；保留性证明照跑（未知键保留是结构性的，不是比对出来的）。
- `addGroup` 与 `addHook` 的**语义分工**：`addHook` = 加到已有组；`addGroup` = 新开一组（"新建"按钮默认走它，
  用户可选"加到哪一组"）。
- **自动建文件**：`writeHookFile` 现在 `prep.state === 'absent'` 直接 `absent` 拒写。
  建议对 `addGroup` / `addHook` 放开：不存在时用 `{kind:'createIfAbsent'}` 写一份
  `{"hooks":{…一条}}`（`starterText` 已经是我们的不动点风格）。代价：存在竞态（别人同时建了文件）时
  provider 会给 `exists`，如实拒写并提示刷新 —— 这条要断言。
  若想更保守，页面先要求用户点"新建配置文件"（`createFile`），本条可以不做。

### 5.4 `index.ts`

- 新增 `resolveScope(sessionId, target): Promise<ResolvedScope>`：

  ```ts
  type ScopeTarget = { kind: 'current' } | { kind: 'user' } | { kind: 'workspace'; workspaceId: string }
  type ResolvedScope = {
    kind: 'user' | 'workspace'            // current 解析后归一到其中之一
    projectRoot: string | null            // kind=user 时可为 null（不确定就不编造）
    workspace: { id: string; title: string; path: string } | null
    isCurrentSession: boolean | null      // 与会话 cwd 解析出的项目根比对
  }
  ```

  - `kind='workspace'`：`workspaceRegistry.get(id)`（或 `list().find`）→ 拿不到 ⇒ 抛 `unknown-workspace`；
    `projectRootFor(record.path)` —— **复用现有缓存函数**，不另写路径解析。
  - `isCurrentSession`：`projectRootFor(cwd) === projectRoot` 时 `true`；没有 cwd 时 `null`。
    （比较的是**项目根**而不是工作区路径，这样"工作区是仓库子目录"也能判对。）
- `workspacesFor(sessionId)`：`list()` → 收窄 → 逐条 `projectRootFor` + `isCurrent`；
  服务缺失 ⇒ `{items: [], available: false}`。**条数上限**：清单本身有界（用户自建），但每条都要
  `projectRootFor`（走 fs 探测 `.git`），所以同一次请求内**并行 + 走缓存**，不要每条打日志。
- `inspect`：按 `ResolvedScope` 决定读哪一份 project 文件、`effective` 取哪份缓存；
  `scope=user` 时 `sources` 只有用户级（`effective` = 用户级 groups）。
- `handleWrite` / `dryRunHook`：目标路径由 `resolveScope` 决定（**不再直接由 cwd 推导**）；
  沙箱策略仍取调用会话（`sandboxPolicyFor(found.agent)`）。
- `runPoint` 的 ledger push 增加 `projectRoot: context.projectRoot`。
- **不新增任何 `ctx.on`**：运行时事件接线不动。

### 5.5 `ledger.ts`

- `LedgerEntry` + `projectRoot: string`；`latestRunFor(entries, { event, command, projectRoot })`。
- 清理逻辑（`MAX_GLOBAL` / `MAX_PER_SESSION`）不变。

---

## 6. 客户端改动清单（`src/client/**`）

### 6.1 结构

`section.tsx` 现在 616 行、`SourceCard/GroupBlock/HookRow/EventRow` 全在一个文件里。这轮要重排，
建议按 `docs/plan-hooks-ui-and-ts.md` §4.1 早就画好的结构拆（不拆也能做完，但下次再改会更贵）：

```
section.tsx      页面外壳：作用域选择 + 工具条 + 相位/横幅 + 状态
hook-card.tsx    一条 hook 的卡（开关 / 命令 / 状态点 / 展开区：编辑·试运行·删除·timeout·matcher）
new-hook.tsx     新建表单（事件 / matcher / command / timeout）
styles.ts        新增类（表里见下）
```

⚠️ 假 React 只支持**不用 hook 的子组件**（`tools/verify.ts:296-299`）：新拆出来的卡与表单
**仍然必须是纯 props 组件**，状态一律留在最外层 `HooksSection`（与现在同一条纪律）。

### 6.2 页面骨架与状态

```
Hooks                                            [作用域 ▾ 用户] 钩子 3   [搜索钩子…]
已安装 2 · 已停用 1                                            [↻ 刷新]  [＋ 新建]
────────────────────────────────────────────────────────────────────────────────
（作用域横幅：用户级 / 当前工作区 / 非当前工作区 + 沙箱提示）
PreToolUse                                                    [开关 ON]
  node -e const fs=require…
  ● 通过 · exit 0 · 23ms · matcher: pwsh · 20s        [编辑] [试运行] [删除]
SessionStart（没有配置）                                 [在这个事件下新建]
…（7 个事件永远全列，含 0 条；§3.6）
```

- **默认作用域 `user`**（用户要求）；下拉项 = `用户` + `workspaces`（`<optgroup>` 分组，
  与截图一致；用**原生 `<select>`**，不做自定义弹层 —— 不依赖官方 DOM 结构，成本最低，
  键盘/无障碍免费。想要截图那种带勾选的自绘菜单，留到 v2）。
- 状态表（`useState` 顺序**必须**一次性写清，`tools/verify.ts` 的假 React 按位置发值）：
  `phase` / `banner` / `busy` / `nonce` / `scope`(值 = `'user'` 或 `workspaceId`) / `query` /
  `editingKey` / `draft` / `confirmKey` / `dryKey` / `dryText` / `newOpen` / `newEvent` / `newMatcher` /
  `newCommand` / `newTimeout`。**顺序变了要同步改自检**（§4.6 记的维护陷阱）。
- `fetch` 的取数 effect 依赖从 `[nonce]` 变成 `[nonce, scopeKey]`；切作用域要清掉行内编辑/确认/试运行态
  （否则"上一份文件的行下标"会打到新文件上 —— 那就是另一种静默改错）。
- 搜索框**纯前端过滤**已加载的列表：只过滤渲染，不改变 `groupIndex/hookIndex` 的原始下标，
  并显示"筛选后 N / 共 M"；无结果时说"没有匹配的 hook"（≠"没有配置"）。

### 6.3 条数口径（截图上的两个数字，建议定义清楚）

| 文案 | 口径 | 来源 |
|---|---|---|
| 下拉框右侧 `钩子 N` | 当前作用域**文件里**的 hook 条数（含已停用） | `FileView.hookCount` |
| 工具条 `已安装 N` | 当前**启用中**的条数；另有停用时追加"· 已停用 M" | `hookCount - disabledCount` |

（口径可以反过来，但不能两个数字指同一个量 —— 那样用户会以为页面坏了。落地时在 README 写死一条。）

### 6.4 样式（`styles.ts` 新增类）

沿用现有纪律：不硬编码颜色、不写 inline、`min-width:0`、长命令省略号、**不垫外层留白**（§3.1/§3.2/§3.12）。
新增：

```
.dsh-hooks__toolbar / __scope / __select / __search / __toolbarActions / __installed
.dsh-hooks__list / __hookcard / __cardmain / __switch / __switch--on / __knob
.dsh-hooks__detail / __detailRow / __newform / __newfield
```

- **开关**：`<button type="button" role="switch" aria-checked>` + 内部 `<span class="…__knob">`；
  轨道关 = `var(--dsw-alias-bg-module-platform)`，开 = `var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))`；
  尺寸全部进样式表（~32×18 + 2px 内边距，对齐同目录插件的 28px 档）。**不用 `<input type=checkbox>`**：
  原生 checkbox 在深色主题下不好统一，而 `role="switch"` 的语义与外观都在我们手里。
- 新用到的 token 名（`--dsw-alias-label-primary/secondary/tertiary`、`--dsw-alias-border-l3/l4`、
  `--dsw-alias-interactive-bg-hover`）**先核对再写**：用 `.tmp/tokens.mjs` / 官方 CSS 用法确认存在，
  不要凭记忆（AGENTS §6：`listTokens` 不是全表）。现有 `styles.ts` 里的 `--dsw-alias-text-*`
  是可疑的（掉到 fallback 才会"看起来还行"），顺手一并核对 —— 但**单独一次提交**，不要和功能混在一起。

### 6.5 `wire.ts` / `write.ts`

- `HooksSnapshot` + `scope` / `workspaces` / `workspacesAvailable`（与宿主 §4.1 一一对应）。
- `WriteIntent` / `DryRunIntent` + `workspaceId?: string`。
- **单一构造函数**：`intentFor(scope, op)`，所有调用点都从它产请求体，避免"某一条忘了带 workspaceId"。
  配套断言：**选中工作区后，每个 op 的请求体都必须带 `workspaceId`**。
- 错误文案：`writeErrorSentence()` 补 `unknown-workspace` / `no-workspace-registry` 两句人话（§3.9）。

---

## 7. 情形 → 页面怎么说（降级矩阵，直接当验收表用）

| 情形 | 页面表现 | 依据 |
|---|---|---|
| 宿主没有 `workspaceRegistry` | 下拉只有"用户"，并明说"宿主没有提供工作区清单" | §3.6/§3.9 |
| `workspaceRegistry.list()` 为空 | 下拉只有"用户"，说"还没有工作区" | 空 ≠ 不存在 |
| 工作区路径的 `projectRoot ≠ 路径` | 卡片头部同时显示两行（工作区路径 / 项目根） | §2.8 不编造 |
| 选中非当前工作区 | 黄底横幅 + 提前提示"可能被当前会话沙箱拒绝写入" | §1.6/§2.1 |
| 选中作用域的文件不存在 | "文件不存在（这份配置是空的）" + 「新建配置文件」 | §2.9/§3.9 |
| 选中作用域文件 JSON 坏 | "读不出来 …运行中的 hook 仍在沿用上一份可用配置"（沿用 `staleInUse`） | §2.9 |
| 会话上下文缺失（`sessionId` 取不到） | `isCurrentSession: null`，只说"当前会话未知"，不写"当前项目 = X" | §2.8 |
| 写入被沙箱拒绝 | 403 `sandbox` + 专句："当前会话的权限不允许写这个文件（沙箱限制）" | §3.9 |
| 行没有任何执行记录 | 灰"未运行"（哪怕开关是开着的） | §3.8 |

---

## 8. 自检与反向验证清单（`tools/verify.ts`，全部要**先红后绿**）

> 铁律：新断言必须做反向验证（注入违规 → 确认**精确**报错 → 用 `edit` 还原）。条数看输出，不抄死。

**F 区（纯函数）**

1. `addGroup`：新建事件数组 / 追加到已有组 / `matcher: null` 不写键 / `timeout` 不写键；
2. `addGroup` 的保留性证明：文档带 `_comment` + 未知键 ⇒ 写后逐字段相等；
   注入"顺手重建整个 hooks 映射" ⇒ 必须 `not-preservable` 拒写；
3. `parseHooksRequest`：`workspaceId` 非字符串 / 空串 / `file:'user'` 带 `workspaceId` ⇒ 全 400；
4. `latestRunFor`：同命令不同 `projectRoot` ⇒ 不匹配（反向：去掉 projectRoot 匹配 ⇒ 红）。

**P 区（只读快照 / 路由）**

5. `scope=user` ⇒ `files` 只有 user；`events` 恒 7 项且等于用户级合并；
6. `scope=workspace` ⇒ `files` 的 project 项路径 = `root(X)/.dsh/hooks.json`，且
   `scope.projectRoot/workspacePath/isCurrentSession` 三项各自正确；
7. `scope=workspace` + 未知 id ⇒ 404 `unknown-workspace`（**反向**：把它改成"回落会话项目" ⇒ 断言红）；
8. 没有 `workspaceRegistry` 假 ctx ⇒ `workspacesAvailable:false` + `workspaces:[]`，**不报 500**；
9. `scope` 缺省 ⇒ 与今天逐字段一致（回归护栏：老客户端不许被这次改动影响）。

**P3 区（写路径）**

10. 真文件系统 + 临时目录：`workspaceId` 指向另一个目录 ⇒ 只有**那个**目录的 `hooks.json` 变了，
    当前会话项目的文件**字节不变**（这是 §2.2 的核心断言）；
11. 未知 `workspaceId` ⇒ 拒写且两边文件都没变；
12. `createIfAbsent` 竞态 ⇒ `exists` 如实拒写；
13. 版本锁：写前外部改文件 ⇒ `stale`（现有断言保持）。

**D 区（真实渲染，假 React + 假 fetch）**

14. 默认作用域 = 用户：渲染出的第一条横幅是用户级语义，且**没有**项目级卡片；
15. 下拉选项 = `用户` + 所有 `workspaces`（数量与 `title` 对得上）；
16. 点开关 ⇒ 发出的 POST 体里 `op/setHookDisabled/hookIndex` 与 `workspaceId` 正确（§4.5：点完要重新渲染再断言）；
17. 选中非当前工作区 ⇒ 黄底横幅出现；选中当前工作区 ⇒ 不出现；
18. 搜索过滤：输入后卡片数变少、原始下标不变、无结果显示"没有匹配的 hook"；
19. 「＋新建」提交 ⇒ POST 体是 `addGroup` 且 `event/matcher/command` 正确（表单错误只能渲染在表单内，§3.7）；
20. `workspacesAvailable:false` ⇒ 明说而不是空下拉。

**E 区**：`pnpm build` 后指纹重算；两份产物里 `HOOKS_ROUTE` 逐字一致（现有断言保持）。

---

## 9. 实施顺序（每一步都可单独验证、可单独提交）

| 步 | 内容 | 验证 | 需要重启 DSH？ |
|---|---|---|---|
| 0 | `git status` 干净；`node tools/verify.ts` PASS（基线） | PASS n/n | — |
| 1 | `ledger.ts` + `runPoint` 加 `projectRoot`；`latestRunFor` 改签名 | F4 红→绿；P4 区不回归 | 是（宿主半边） |
| 2 | `write.ts` 加 `addGroup` + `parseHooksRequest` 加 `workspaceId`；`data-plane.ts` 的 `RouteDeps` 扩参 | F1–F3、P3-13 | 是 |
| 3 | `service-types.ts` + `resolveScope`/`workspacesFor` + `inspect`/`write`/`dryRun` 接作用域；`data-plane.ts` 快照扩字段 | P5–P9、P3-10–12 | 是 |
| 4 | `pnpm build` → `node tools/verify.ts` → 提交链路（宿主半边到此为止） | PASS + `git diff --exit-code lib/`（幂等） | 告知用户重启 |
| 5 | 客户端：`wire.ts`/`write.ts`/`styles.ts`/`section.tsx` 重排 + 新卡与新建表单 | D14–D20、C 区不回归 | 否（`pnpm build` + HMR；免刷新需 `pnpm run dev:web`） |
| 6 | README/AGENTS 补：作用域语义、条数口径、`unknown-workspace`、`addGroup` | 文档与代码一致 | — |

**纪律提醒（不要违反）**：

- `src/**` 是源码，`lib/**` 只能由 `pnpm build` 产出（§4.8）；**改了必须重建**，否则 E 区当场红。
- 中间态必须**永远能被 profile 里那条 `file://` 行加载**：`lib/index.js` 不许"暂时坏着"。
- 宿主半边改动**只有重启 DSH 才生效**（§1.2/§1.3）—— **我不会替你重启**，第 4 步做完会明确告诉你。
- 不碰 `~/.dsh/profiles/**`（§1.4）；读写源文件用 `read`/`edit`/`write`，不用 PowerShell（§1.1）。
- 只在 `.tmp/**` 下做一次性实验（§1.7）。

---

## 10. 待你确认的决策点（4 个，都有推荐值）

1. **作用域是否只影响"看/改"，不影响"跑"？**（推荐：是。运行时仍按会话 cwd，下拉只决定编辑目标 ——
   这也是唯一符合 §2.6 的做法：页面不许假装能改运行时会话的项目。）
2. **「＋新建」是否要自动创建不存在的 `hooks.json`？**（推荐：要，一次 `addGroup` 搞定；
   竞态时如实报 `exists` 并提示刷新。保守方案是让用户先点"新建配置文件"。）
3. **是否保留"当前会话生效 N 条（用户级 a + 项目级 b）"这一块只读视图？**
   （推荐：保留为可折叠一行 —— AGENTS §2.6 明确要求页面能回答"实际会跑的是什么"；
   你如果觉得截图那样的单文件视图更干净，也可以去掉，但作用域横幅必须把合并规则说清。）
4. **条数口径**：`钩子 N` = 文件总条数（含停用）、`已安装 N` = 启用中条数 —— 还是反过来？
   （推荐前者；两个数字必须指不同的量。）

另外两个**顺带修**（建议一起做，都是为了不撒谎）：

5. 台账按 `projectRoot` 匹配（§2.3）—— 不做的话切工作区会看到别的项目的绿点。
6. `styles.ts` 里 `--dsw-alias-text-*` 这类可疑 token 名核对（**单独一次提交**，别混进功能）。

---

## 11. 明确不做（范围外，避免范围失控）

- 不新增运行时的"按工作区切换 hook 集"能力：hook 的生效范围仍然只由会话 cwd 决定。
- 不引入自定义下拉弹层 / 官方 UI primitives（保持客户端产物只有一处 `require('react')`，§2.2/§7）。
- 不做 `hooks.json` 的多文件 / 多目录发现（约定仍是两处文件，§0）。
- 不做搜索的后端查询：作用域内的条数是几十条量级，前端过滤足够。
- 不动 `dsh-mcp-manager` 的 cordis 配置面（`ctx.loader` / `ctx.configEditor` 一律不碰，§2.3）。

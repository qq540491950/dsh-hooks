# AGENTS.md —— 本仓库的 agent 工作约束

> 分级：**[硬]**（破坏数据/环境）＞**[边界]**（抄近路引入已知 bug）＞**[风格]**；同级冲突以**机检**为准（`tsconfig.*` / `eslint.config.js` / `tools/verify.*` / `package.json`）。
> 每条规则都对应**已经发生过的**事实，括号里是现象或证据，不是理论风险。
> 只写"做什么、怎么自查、代价"；取证、事故复盘、断言台账在 `docs/agent-rules-notes.md`，设计与实测记录在 [README.md](README.md)，迁移与 UI 的阶段计划在 `docs/plan-hooks-ui-and-ts.md`。

## 0. 30 秒定位

**这是什么**：DSH Host 插件，让每个项目带自己的 hooks 配置。配置只有两处，都是**插件自己拥有的 JSON 文件**（与 `dsh-mcp-manager` 管的 cordis Loader 条目**完全无关**）：

| 级别 | 路径 |
|---|---|
| 项目级 | `<projectRoot>/.dsh/hooks.json`（`projectRoot` = 最近含 `.git` 的祖先，没有就用会话 cwd） |
| 用户级 | `$DSH_HOME/hooks.json`（本机 `C:\Users\admin\.dsh\hooks.json`） |

合并语义：**用户级在前、项目级在后**，同事件数组拼接；**顺序即执行顺序**。支持 7 个事件（`SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop / SubagentStart / SubagentStop`），**只跑 `type: "command"`**。

**源码与产物（判据：看 `lib/.build-manifest.json`）**：

- **有** `lib/.build-manifest.json` → **源码在 `src/**`（TS），`lib/**` 是构建产物，不要直接编辑**。
- **没有**该文件 → 迁移尚未落地，`lib/index.js` 就是手写源码，本文件对它同样生效（尤其 §2.1 零 import）。

> 用"构建指纹存在"而不是"`src/` 目录存在"作判据：迁移期间 `src/shared/**` 会先落地而宿主体还在
> `lib/index.js` 里，只看目录会误判成"lib 是产物"。指纹由 `tools/build.ts` 产出，语义唯一。

| 半边 | 源码 | 产物 | 职责 |
|---|---|---|---|
| 宿主 | `src/host/**` | `lib/index.js` | **零 import**；读两个 hooks.json + `ctx.fs.watch` 热重载 + 跑 hook 子进程；并将开 `/api/hooks` 给设置页用 |
| 客户端 | `src/client/**` | `lib/client.js` | 设置页「Hooks」（`settings.section`，list 座位，`order: 920`） |

**唯一必跑**：`node tools/verify.ts`，期望 `PASS n/n`。**别把条数抄死**——条数看输出，台账是 `//#region` + 实际输出。

**座位台账（活台账，`cordis_inspect_query` client `Slots.listSubTree` root=`settings.section`）**：
`account/-10`、`general/0`、`models/10`、`plugins/15`、`agent-presets/20`、`mcp/900`（本地 `dsh-mcp-manager`）、`skills/910`（本地 `dsh-skill-manager`）、**`hooks/920`（本插件）**。

## 1. 硬性纪律

**1.1 [硬] 不用 PowerShell 读写 UTF-8 源文件。** 本机 `pwsh` 是 **Windows PowerShell 5.1**（ANSI 码页 936）：`Get-Content -Raw` / `Set-Content` 会让中文变乱码、吃掉换行、坏字节变 `?`，**不可逆**（本轮实测：`Get-Content .gitignore` 直接输出乱码，而文件本身没坏）。读用 `read` 工具或 `node -e "fs.readFileSync(p,'utf8')"`；写用 `write` / `edit`（自带版本护栏）。一次性实验脚本写成 `.mjs`/`.ts` 文件，**不要塞进 `node -e` 字符串**（反引号会被吞掉）。

**1.2 [硬] 宿主半边不热重载，客户端半边热重载。** 实测：`insert` 行加进 profile 后**立刻**出现在 Loader 树里（`include:dsh-hooks`, `enabled:true`），但**运行中的进程不会激活它**；连 `plugin_manager set_plugin`（禁用→启用）也只是对**同一个模块实例**再 `apply()` 一次，不会从磁盘重新 import。所以改 `lib/index.js` / `src/host/**` 要**重启 DSH**；改 `lib/client.js` / `src/client/**` 构建后由客户端 HMR 替换（且只有在 `pnpm run dev:web` 也在跑时才免刷新）。唯一热的是 `hooks.json` 本身（watch 命中 < 1s，最坏 `POSITIVE_TTL_MS` 4s）。

**1.3 [硬] 不要重启 DSH。** 当前会话就跑在它里面。需要宿主侧生效时**告知用户**，由用户决定。

**1.4 [硬] 不擅自改 `~/.dsh/profiles/**`。** 本插件的接线是 `desktop/cordis.patch.yml` 末尾的 `- insert: - id: dsh-hooks / name: 'file:///D:/project/dsh-plugins/dsh-hooks/lib/index.js'`（"路径行"装载）。该文件是**活配置**，应用会并发写入。确需改动：① 备份到带时间戳 `.bak`；② 只用 `edit` 做**最小行级**改动；③ 用真实 YAML 解析器验证；④ 告知备份路径与回滚方式。**profile 原文（含明文凭据 / 真实网关地址）不得粘进仓库文件**（本 profile 里就有明文 token 与内网地址）。

**1.5 [硬] 并发编辑按护栏重做。** `edit` 报 `file changed since it was read`、或写入报 `FS_STALE_VERSION` → **重新读取、基于新内容重做**；不要用整文件写入绕过护栏。

**1.6 [硬] hook 子进程的权限来自调用会话，不许提权。** 每次 hook 都必须 `ctx.get('sandboxPolicy').resolve({session})` 并把结果透传进 `shell.resolve({..., sandboxPolicy})`（与 `dsh-tool-pwsh` 同构）。**只有这个返回值可以透传**；服务缺失 / 抛错就**省略该字段**回退部署策略（并打一条降级 warn）。代价：`read-only` 会话下 hook 照样写不了——这是对的，不是 bug。反面教材：v0.1.0 不透传，hook 按**部署**档跑（`workspaceRoot` = 宿主启动目录），所有落盘类 hook（格式化 / 自动修复 / 写日志）**静默**失效。

**1.7 [硬] 只在 `.tmp/**` 下做一次性实验。** `.tmp/` 与 `*.log` 已 gitignore。实验产物、从 `app.asar` 解出来的第三方包、注入脚本一律不进版本库，**也绝不进 `lib/`**。

**1.8 [硬] 不许把"读不到配置"当成"没有配置"。** 见 §2.9：这是本插件最危险的失效路径（写坏一个字符 → 全部 hook 含 deny 守卫静默消失）。C1 已修（三态 + last-good），**但改动这条语义必须同时有断言**——它是"安全默认值"级别的东西，不是普通行为。

## 2. 代码与数据边界

**2.1 [边界] 宿主半边零 import。** 判据是**裸模块说明符**（`@deepseek-ai/*` 都在 `app.asar` 里，从磁盘路径解析不到）；相对 import 由打包器内联、`import type` 被擦除，两者允许。→ eslint `HOST_BARE_IMPORT` + 产物断言（`lib/index.js` 里 `import` 与 `require` 计数都为 0）。宿主侧只用注入的 Service 与全局对象（`URL` / `Response` / `AbortController` / `crypto` / `process`）。

**2.2 [边界] 客户端产物协议。** classic script（非 ESM），只向 `window.__ModuleLoader__.load` 注册 factory（**恰好一次**）；`id` == `package.json.name`（构建注入）；`require` 只取种子模块（`react`，经 `src/client/react.ts` 单点中转，产物里应当只有**一处** `require`）；`package.json` 必须有 `exports["./client"]`（指向真实文件）与 `dsh.client.platform === "web"`。**源码里不许手写 `window.__ModuleLoader__`**（wrapper 由 `tools/build.ts` 注入；eslint 禁）。

**2.3 [边界] hooks.json 是我们自己的文件：写入只走 `ctx.fs.writeText()`，不用 `configEditor`。**
- 绝不 `ctx.loader.create()/remove()`，也绝不碰 `ctx.configEditor`——那是 cordis 配置面，改了会压平用户手写的 `insert:` 分节（`dsh-mcp-manager` 的教训），而 hooks.json 根本不在那里。
- `expected` **必须给**：存在用 `{kind:'replaceIfVersion', version}`，不存在用 `{kind:'createIfAbsent'}`。`writeText` 本身就是**原子替换**（临时文件 + rename），不需要另外找原子写库。
- **未知键必须原样保留。** 现在 `.dsh/hooks.json` 第一行就是 `_comment`（活文档）；任何"解析→重建→写回"都必须证明除目标字段外**逐字段深比较相等**，否则**拒写并报错**（这是 `dsh-mcp-manager` 写盘前 `composeEntries` 断言的同构物）。
- 缩进、行尾、结尾换行按**原文件探测**后保持；不带 BOM；不要因为一次编辑把整个文件重排（用户会看到整文件 diff）。
- **客户端不许回传整份文件**：只发 `{file, op, event, groupIndex, hookIndex, patch}` 这样的定点操作，宿主读→改→写。回传整份 = 静默丢字段的老事故。
- **已核实的官方写入契约（P4b，`cordis_inspect_query` host Service `fs`）**：`FsInfo.version` 是**必填**的（所以 C2 的版本通道在真实 provider 上总是可用）；`FsWriteIntent = {kind:'createIfAbsent'} | {kind:'replaceIfVersion', version}`；版本不符抛 **`FS_STALE_VERSION`**；`writeText(target, content, expected?, signal?, sandboxPolicy?)` —— **`sandboxPolicy` 必须传调用会话的那一份**（与 hook 子进程同理，§1.6）。
- **寻址一律用文件下标**：`ParsedGroup.rawIndex` / `ParsedHook.rawIndex` 是**文件里的真实下标**，因为解析会跳过非 command handler、没有 command 的条目、matcher 非法的 group（`parsedIndex !== rawIndex`）。拿 parsed 下标去写 = 静默改错 hook。越界一律拒写（`not-found`），不许"就近"落笔。

**2.4 [边界] 写入只走一条路径：克隆整份文档 + 只改目标节点 + 保留性证明。**
- **不做"解析 → 重建 → 写回"**：那是丢字段的老事故来源。`src/host/write.ts` 的机制是克隆原始 JSON 树之后**只改目标那一个节点** —— 未知键能留下是**结构上不可能丢**，不是"重建之后再比对一下"。
- `preservationProblem(original, updated, changes)` **仍然必须跑**：它检查的是"我声明改了什么"这份声明本身 —— `Change.area` 方向写错、漏声明一处，都会当场被测出来并**拒写**。它已经抓到过一次真 bug：`removeHook` 的补偿方向写成 `both`，会让删除类操作被自己的证明拒写（第一版就是这样）。
- **刻意不用 `fs.editText`**：它要的是**字节级精确的 oldString 锚点**，而 `setHookDisabled` 开/关、`setHookTimeout(null)` 都是"增删一个键"，锚点只能靠猜命令所在那一行的形状 —— 猜错就是改坏用户文件。取舍与代价见 [docs/design-notes.md](docs/design-notes.md) §2。
- 写盘一律 `ctx.fs.writeText(target, text, expected, signal, sandboxPolicy)`，`expected` **必给**（见 §2.3）。
- 探测并保持缩进 / 行尾 / 结尾换行。我们写出的文件是**不动点**（再解析再序列化逐字节相同），所以后续编辑的 diff 一定只落在改动的那一处。

**2.5 [边界] 启停必须落在文件里，不许只存内存或私有状态文件。** 用 hook 对象上的 `disabled: true`（与 DSH loader 行的字段名一致）。只存 sidecar 状态会导致"UI 显示已停用、别的消费者照跑"。
**核对结论（本轮已完成，结论与计划相反地更宽松）**：`@deepseek-ai/dsh-hook-protocol` **根本不解析配置文件** —— 它只有 matcher 语义、输出 codec、`runCommandHook(已解析的 hook)` 与判决合并。所以"未知字段被拒"的担心在协议层**不成立**，`disabled` 可以安全落在 hook 对象上。
**因此纪律变成两条**：① `parseHookConfig` **保留** `disabled`（只在为 `true` 时写这个键，避免破坏 `deepStrictEqual` 断言），执行层 `runPoint` **跳过**它；② 必须有"disabled 的 hook 真的没跑"的**真子进程**断言（哨兵法：让它写一个文件，文件必须不存在）—— 否则它还是"界面停用、实际照跑"。

**2.6 [边界] 解析规则只有一份。** UI 展示的"生效配置"必须就是 hook 实际会跑的那一份：同一个 `parseHookConfig`、同一个 projectRoot 解析、同一个 `matcherDiagnostic`、同一份用户级+项目级合并。**禁止为页面另写一套解析器**（两套必然漂移，页面会"看起来配好了"而运行时不认）。

**2.7 [边界] matcher 非法只跳过该 group，不整份拒绝；非 command handler 跳过并记入 `skipped`。** 这是刻意的取舍（一个笔误不该让全部 hook 失效），官方桥是整份拒绝。UI 校验必须调用同一个 `matcherDiagnostic`。

**2.8 [边界] cwd 只能来自 session，拿不到就如实说。** 宿主侧**没有**"当前工作区"概念。事件时用 `agent.session.header.cwd`（`exec.agent` 缺失时退化到 `ctx.agents.currentInitiator()`，再没有才 `process.cwd()`）；UI 侧用 `sessionQuery.observeSession(sessionId)` 的 `header.cwd`（租约**读完即放**）。没有 sessionId 时 cwd 就是 `undefined`，**不要编造**成某个 workspace 路径。

**2.9 [边界][硬] 「读不到」≠「没有」——三态语义，已修一半。**
读取配置有三态：`absent`（ENOENT，合法的空配置）/ `ok`（解析成功 + 刷新 last-good）/ `error`（读到了但 JSON 非法、顶层不是对象、或 IO 失败）。
- **C1 已实现（v0.2.1）**：`error` 时**继续沿用最近一次成功解析的配置**；同一条错误只 warn 一次（成功读取后计数重置）；每次沿用打一条限流 info。对应断言在 `tools/verify.ts` 的 `fail-open` 区，并做过反向验证（把 `stale` 打回 `false` → 3 条精确报错）。**删除文件仍然是合法的清空**，不许 fail-safe 回旧配置。
- 修之前的形态是危险的 fail-open：`error` 被折叠成"没有配置"，写坏一个字符就让**全部** hook（含 deny 守卫）静默消失，而且一直消失。历史取证见 `.tmp/hotreload-fix-plan.md`。
- **C2 已实现（v0.2.1）**：用 `ctx.fs.stat()` 的 `version`（`dev:ino:size:mtimeNs:ctimeNs`）做**失效主通道** —— 版本没变就复用缓存（连 TTL 都不等），变了就立刻重读；watcher 是加速器，**TTL 降为"provider 不返回 version / stat 抛错"时的兜底**。`configFor` 每次事件点先核对版本（2 次 stat），`loadConfig` 才真正读。断言在 `tools/verify.ts` 的 `C2` 区，并做过**双向**反向验证（关掉版本通道 → 2 条报错；把"内容变了"看成"没变" → 1 条报错）。
  代价与边界：每次事件点多 2 次 `stat`（Windows ~10–100µs）；假 `ctx.fs` **默认不返回 `version`**（于是默认覆盖"没有版本通道"那一支），需要版本的项目必须显式 `makeFs({version: true})`；`stat` 失败**绝不允许**清掉 last-good。
- **C3 未实现**：可观测性（payload 里加 `dsh_hooks: {config_path, config_version, loaded_at, reload_reason, last_error}`；可选旁路 journal）。宿主 logger 没有可发现的落盘位置（§6），所以这条对排查很重要。
- **任何写入路径落地之前必须先有 C1**（已满足）**且 C2 落地**（UI 会让人更频繁地改这个文件）。

**2.10 [边界] 试运行与真实运行共用同一条执行路径。** 只有 `signal` / timeout / 沙箱档位允许不同；payload 必须由**同一个** builder 产出。禁止另写"演示用"执行器——那必然出现"试运行通过、真实失败"。试运行也必须带上 §1.6 的会话沙箱策略。

**2.11 [边界] 执行台账有界，且是状态色的唯一证据。** 见 `src/host/ledger.ts`（**已实现**）：全局 `MAX_GLOBAL` 500 条、单会话 `MAX_PER_SESSION` 200 条（两个上限**各自**生效：灌同一个会话时先触到单会话上限）；stdout/stderr 进台账前按 `MAX_TEXT_CHARS` 截断并留 `…（已截断 N 字符）` 标记。`ctx.effect` 清理时 `clear()`。
**匹配规则是 `event + command` 两者都要**：命令改过之后旧记录不再匹配 → 行退回"未运行"的灰色。这就是 §3.8"缓存记录不能给不同 command 上色"的落地方式。
寻址上还有一条：`GroupView.file` / `rawIndex` 与 `HookView.rawIndex` 是**文件里的真实下标**，页面必须原样回传；合并视图（顶层 `events`）在 `staleInUse` 时 `file` 为 `null`（来源无法确定）→ 页面据此**禁用编辑**，而不是猜一个文件写进去。

**2.12 [边界] 设置页数据面只走 `ctx.connection.fetch.register()` 的精确路由。**
选型论证在 [docs/design-notes.md](docs/design-notes.md) §1（含 7 条候选的否决理由）。落地纪律：
- 路由**必须**是 `/api/<名字>`（`connection.fetch` 自己校验），字面量只能有一处（`HOOKS_ROUTE`），**宿主与客户端两份产物里必须逐字一致** —— 不一致就是静默 404。
- `requestBody` 必须在 bridge 读字节之前声明；POST 体积小，用 `'buffered'`。
- 成功 `{ok:true, data}`，失败 `{ok:false, error, detail?}` 且 **没有 `data`**；`detail` 只放技术原文，**绝不作为页面主文案**（§3.9）。
- **`connection` 是可选服务，但访问它只有一种正确方式：`ctx.inject(['connection'], (scope) => …)`。**
  **不许在 `apply()` 里直接读 `ctx.connection`** —— Cordis 的服务是**渐进可用**的，apply 时刻它很可能还是 `undefined`，于是 `if (ctx.connection !== undefined)` 会**静默跳过注册**：页面拿到的是 web 服务器的纯文本 `not found`，而自检全绿。**这条是线上实测踩到的**（P8b：界面正常渲染、`/api/hooks` 是 404），根因就是自检的假 ctx 把服务挂在属性上了 —— 现在假 ctx **只经 inject 交付**，"直接读属性"会在自检里红成一片（把旧写法注入回去 → **18 条同时红**）。
  用 inject 还有第二个好处：服务永不出现时插件照常激活 —— 数据面是便利设施，不是硬依赖。
- 快照里的"生效配置"**必须取 `configFor()` 的缓存**（就是 runner 正在用的那一份），而不是路由里重新解析一遍 —— 后者会得到"磁盘刚的样子"，在 fail-open 场景下与 runner 不一致，页面就在撒谎。
- 没有会话上下文时 `cwd` / `projectRoot` 一律给 `null` 并如实标注来源，**不许拿 `process.cwd()` 顶上**。
- 可离线测：注册契约靠捕获 `register()`，handler 行为靠**直接 `new Request(...)` 调 handler**（绝对 URL）—— 不需要浏览器。
- **写请求的错误码必须能分别说清**（§3.9）：`stale`（版本冲突，409）、`exists`（409）、`not-preservable`（409）、`invalid-json`（409，**读不懂就拒写**）、`absent` / `not-found`（404）、`sandbox`（403）、`bad-op` / `bad-json`（400）。**不许**把"读不懂文件"和"权限不允许"都糊成一句"保存失败"。
- **`invalid-json` 时绝不落笔**：覆盖一份我们读不懂的文件 = 删掉用户的内容。`no-version`（provider 没给版本）同样拒写 —— **不做无守卫写入**。
- **已核实的 provider 行为**（读 `dsh-fs-local/lib/index.js`）：`writeFileAtomic` 里有 `mkdir(dirname, { recursive: true })`，所以**父目录会被自动创建**（`createFile` 因此能建出 `<projectRoot>/.dsh/hooks.json`）；`replaceIfVersion` 在**文件已消失**时同样报 `FS_STALE_VERSION`。假 fs 必须与真实 provider 同能力，否则会出现"自检里假失败、真机没事"。

## 3. UI 纪律

**3.1 [边界] 绝不硬编码颜色。** 深色主题下 `--dsw-alias-brand-primary` **近白色**，写 `#fff` 就是白底白字。十六进制只允许作 `var()` 的 fallback。状态色用 `--dsw-alias-state-*-primary`。

**3.2 [边界] 视觉与尺寸进注入的样式表，绝不写 inline。** inline `background` 压过 `:hover`（按钮永远没有悬停反馈），inline `height` 压过样式表。唯一例外：圆点颜色（走 token）。
**本插件的注入方式（刻意偏离字面写法）**：样式是 `src/client/styles.ts` 里的一个 CSS 字符串，由组件渲染成 `<style>{styles}</style>` 元素 —— 官方 `references/ui-plugin.md` 明确认可"组件局部样式以 React 元素渲染，卸载时随之移除"。这比往 `document` 注入 `<style id>` 更稳：**根本不存在**"`<style id>` 已存在就 return → 新加的 CSS 永远不出现"那个坑（每条渲染都是新元素，天然最新）。代价：不能靠 `#id` 去更新既有样式（也不需要）。

**3.3 [边界] 座位注册字段白名单里没有 `icon`。** 本轮核对 `dsh-client-ui-slots/lib/index.js` 的 `register()`：`entry.options` 逐字段展开，只有 `key/id/order/label/priority/select/inject/children/store/locale/registrant` 会被拷贝，**`icon` 被静默丢弃**；导航图标由官方 `navIcon(id)` 硬编码查表、未知 id 兜底成齿轮。**不要学 `dsh-mcp-manager` 的「打 data 属性 + CSS 覆盖」**——那依赖官方 DOM 结构，一改就静默失效（`dsh-skill-manager` 已明确否决）。本插件第一版就用兜底齿轮。
**注意区分两个「icon」**：这里说的是**座位注册参数**；`package.json` 里的 **manifest 级 `icon`** 是另一套机制且**官方支持**（Plugin Manager 卡片 / bundle 详情 / 设置里的插件清单会读它，不需要激活插件）——见 §7。

**3.4 [边界] 必须走 `slots.inject("settings.section", …)`，不能直接 `register`。** 该座位由官方 `settings-general` 声明；未声明的座位直接 register 会抛 `slot "..." is not declared`。

**3.5 [边界] `order: 920`，唯一性约束在 `(id, priority)`。** 同一 list 座位里同 `(id, priority)` 重复注册会抛错（`list slot "..." already has an entry with id "..."`）。`order` 只保证排在 `mcp/900`、`skills/910` 之后，不保证"永远最后一个"。

**3.6 [边界] 7 个事件分组永远全部渲染，含 0 条。** 「空」和「不存在」必须长得不一样，否则用户只能得出"这功能没做"——**他的判断没错，是界面在撒谎**。分组标签带条数；默认选中第一个非空分组。两个来源（项目级 / 用户级）同样永远都列，带条数。

**3.7 [边界] 一条错误只允许一个渲染点。** 错误跟着来源走：表单内的错误由提交失败写入、渲染在表单内部；页面级错误由行内操作（启停 / 删除 / 试运行）失败写入、渲染在页面级。写入辅助函数的第三个参数就是"写进哪条通道"，**必须只写一条**。

**3.8 [边界] 状态色必须有正面证据。** 每行的颜色只能来自**执行台账**（真实 `exitCode` / `decision` / `spawn-failed` / 超时）与 `disabled` 字段：无记录 = 灰「未运行」，**不许**因为"没报错"就报绿。这与 `dsh-mcp-manager` 的 3.10 是同一条纪律（那边被 `failOnStartupError:false` 骗过绿）。

**3.9 [边界] 只读渲染不许"猜"。** 文件不存在 / JSON 非法 / 写入被沙箱拒绝 / matcher 非法，四种都要能**分别**说清，并且**不许把内部错误原文**（`FsError: cannot list …`）直接当文案。

**3.10 [风格] mono 与 multiline 正交。** `mono` 只换等宽字体，`multiline` 换真 `<textarea>`；`command` 是两个都要（等宽多行），`timeout` 只要 mono。混用会把单行字段渲染成 56px 大框。

**3.11 [风格] 表单面板靠底色分层，不加描边。** 卡：`.5px solid var(--dsw-alias-settings-card-stroke)` + `var(--dsw-alias-settings-card-fill)`；面板：无描边 + `var(--dsw-alias-bg-module-platform)`。加 `border` 会叠成"卡片套卡片"。

**3.12 [风格] 自适应与外壳留白。** 每个可收缩的 flex 子项显式 `min-width:0`；长文本 `text-overflow:ellipsis`（长路径 `overflow-wrap:anywhere`）；操作区 `flex:none` 且不换行。外壳内容区**已经**有 `padding: 0 24px 24px`（`dsh-client-ui-settings-general` 的 `options` 类），**不要再垫一层**。

## 4. 改代码与交付流程

**4.1 先跑自检。** `node tools/verify.ts`：改动前 PASS、改动后 FAIL，才能证明是你的改动引起的。

**4.2 每修一个 bug 同时加断言。** 台账只有一处：`tools/verify.ts` 的 `//#region` + 自检输出——**本文件不维护断言 ID，也不抄条数**（历史台账已经漂移过）。建议分区：`A` 包清单/座位/主题与 inline 纪律/零 import/产物协议；`B` 宿主行为（真子进程 + 真文件系统 + 假 ctx）；`C` 客户端协议（假 `window.__ModuleLoader__` 真跑 factory）；`D`/`D2` 真实渲染与挂载行为；`E` 共享常量 ↔ 出厂产物（含构建指纹）；`F` 纯函数直接单测；`P` 数据面（读 / 定点写 / 版本锁 / 深比较保留未知键 / 沙箱拒绝）。

**4.3 新断言必须反向验证。** 注入违规 → 确认能**精确**报错 → 还原（用 `edit`，别用 PowerShell）。五个自欺陷阱：① 注入点让进程崩掉（看起来像"没报错"）→ 用 `if (false) …` 之类不执行的注入；② 注入锚点不唯一（先断锚点恰好命中 1 次，否则判该用例无效）；③ 断言里带恒真的「或」；④ 注入打错半边；⑤ **平凡通过的断言**（永不失败的断言比没有更糟）。

**4.4 处理失败响应时先补空形状。** 路由失败返回 `{ok:false,error}`，**没有 `data`**；断言里直接解引用会在第一处崩掉，后面的断言全部来不及跑。取响应统一走一个 `getJson()`，`data` 缺失时补成文档里的空形状，让失败报成"实际 0 条"这类干净结果。

**4.5 测交互时事件闭包是当次渲染的。** `onClick`/`onChange` 捕获的是那一次渲染的状态：状态变更后**必须重新 mount、重新查 DOM**，别拿旧节点去点。

**4.6 改了 JSX 就延长渲染测试。** 假 React 的 `useState` 是**按 hook 顺序**位置发值的：`scene(...)` 的参数顺序就是组件的状态顺序，**新增一个状态必须同步补一位**（这是本仓库 `D`/`D2` 最大的维护陷阱）。

**4.7 不要为了让断言通过而放宽断言。** 先判断是断言过严还是改动错了；改断言要说明理由并保留原有防护意图。**改断言之后要重新做反向验证**——锚点会随重构过期。

**4.8 [硬] 产物纪律（`src/**` 是源码，`lib/**` 是产物且**要提交**）。**
- `lib/**` **只能**由 `pnpm build` 产出。手改产物等于下次构建被静默覆盖，而且指纹立刻对不上（自检 `E` 区当场红）。
- 改了 `src/**` **必须重建**：先 `pnpm build`，再 `node tools/verify.ts`。忘重建会得到 `E：指纹覆盖到的每个源文件都没有变` 这条精确报错。
- 两把锁：① `lib/.build-manifest.json` 指纹（每个源文件 + 产物的 sha256，自检 `E` 区逐项重算）；② 提交前 `git diff --exit-code lib/`（构建必须幂等——`tools/build.ts` 刻意不写时间戳）。
- **源码存在 ≠ 已交付**：esbuild 只从入口 `src/host/index.ts` 沿 import 打包，**没有任何模块 import 的文件会被静默丢掉**（P4b 的 `write.ts` 一开始就是这样：产物里根本没有它，而所有指纹断言照样全绿）。所以每个"必须交付的模块"都要在自检 `E` 区留一个**唯一标记字符串**的断言（现在有 `/api/hooks`）。
- 每个阶段结束必须：`node tools/verify.ts` PASS（条数**不减少**）+ 无 BOM / 无 `U+FFFD` / LF。
- **任何中间态都必须是一个能被现有 profile 行加载的模块**：`lib/index.js` 就是 profile 里那条 `file://` 路径指向的文件，它不能"暂时坏着"。

## 5. 常用命令

- **自检**：`node tools/verify.ts`（唯一必跑）。
- **体检一份真实配置**（不跑测试）：`node tools/verify.ts --config "<path>/.dsh/hooks.json"` —— 列出识别到的事件、每个 group 的 matcher/timeout、被跳过的非 command handler、matcher 诊断。**写完配置先跑这个**，比等重启看日志快。
- **座位台账**：`cordis_inspect_query`（platform: client, provider: Slots, method: listSubTree, input `{"root":"settings.section"}`）。
- **本插件 Loader 条目 / Service 契约**：`cordis_inspect_query`（host, provider: Service, method: listService，`input {"service":"fs"}` 这样只取一个服务的精确契约）比读源码快；条目 id 是 `include:dsh-hooks`。
- **官方源码 / CSS / 契约**：源码在 `<安装目录>\resources\app.asar`（**是文件不是目录**）。`read` / glob / shell / `node` 都穿不过 asar 虚拟路径，要用**只读探针**（`.tmp/asar.mjs`：解析 asar 头按 offset 取文件；`list <regex>` / `cat <path>` / `top`）。**判据权威顺序**：本机安装的 DSH 源码 ＞ asar 内官方 README/practices ＞ 同目录成熟兄弟插件 ＞ 二手资料。
  已核实的官方参考入口（都在 asar 里）：`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-slots`（座位白名单与注册语义）、`@deepseek-ai/dsh-client-ui-settings-general`（设置外壳 DOM/CSS 与 `settings.section` 渲染）、`@deepseek-ai/dsh-client-modules`（`dsh.client` 运行时校验器、`exports["./client"]` 解析）、以及插件开发参考 `cordis-plugin-development/references/{host-plugin,ui-plugin,practices}.md` 与 `templates/{mcp,decoration}/`。**读之前先 `list` 确认路径存在**——版本会变。
- **看真实运行痕迹**：宿主 logger **没有**可发现的落盘位置；`lib/index.js` 的日志看不到。可用的观测面只有三处：① hook 自己的 stdout / deny reason（**首选**，跨平台、免疫沙箱）；② 会话日志 `session.v4.jsonl.zstd`（多帧 zstd，按 `28 b5 2f fd` 切帧，参考 `.tmp/zlog.mjs`）；③ `.debug` 模式的旁路 journal（见 `hotreload-fix-plan.md` C3，**未实现**）。
- **权限**：官方明确 `plugin_manager` 每个 action（含 `list_plugins`）**需要审批**，`cordis_inspect_query` **不需要**——查证优先后者。

## 6. 已知边界（不要试图"修好"）

| 边界 | 说明 |
|---|---|
| 宿主半边不热重载 | §1.2：重启，或告知用户；`plugin_manager` 禁用→启用也**不重新 import 模块** |
| **设置导航那一格**的图标不可由插件提供 | §3.3。上游支持 `icon` 注册参数后立刻改用它。别和 **manifest 级 `icon`** 混淆——那个是插件卡片图标，官方支持（§7） |
| `order` 不保证"永远最后" | 920 只是大于 mcp/900、skills/910 |
| **配置读取的三态与失效通道** | §2.9。**C1 已修**（三态 + last-good + 错误去重告警）、**C2 已修**（stat 版本核对为主通道）——两者都有断言与反向验证；**C3 可观测性（payload 元数据 + 旁路 journal）未做** |
| 项目级 = 最近 `.git` 祖先 | 上游约束（与 `dsh-skill-filesystem` 同一约定），不支持 monorepo 子项目选择 |
| 官方兼容桥是**进程级单配置** | `dsh-hooks-claude-code` / `dsh-hooks-codex` 的 `configPath` 启动只读一次，无法表达项目级；同时命中同一事件 = 同一个 hook 跑两遍 |
| `args` 不被协议支持 | DSH 的 hook 协议只认 `command` 字符串 → 参数拼进 `command` |
| Windows 上 `exit 2` 不可靠 | 本机 `ctx.shell` 是 **PowerShell 5.1**，`exit 2` 被折叠成 1 → 改用 `exit 0` + `{"hookSpecificOutput":{"permissionDecision":"deny",…}}` |
| 只有 `command` handler | `http`/`mcp_tool`/`prompt`/`agent` 一律跳过并 warn |
| `updatedInput` 只解析不生效 | 协议字段收下但 warn，不要对外承诺"能改写工具入参" |
| `transcript_path` 恒为空串 | DSH 会话日志是 zstd 压缩的，shell 脚本读不了（与官方桥一致） |
| 宿主日志基本不可看 | §5：靠自检 + 渲染测试兜住，不能靠"跑起来看看" |
| TTL 是**兜底**不是时效保证 | `POSITIVE_TTL_MS` 4s / `NEGATIVE_TTL_MS` 2s 只是"允许重读"；单次事件点只解析一次 |
| Stop 有 3 次上限 | 比官方桥多一道防线（官方无上限，会无限续跑），这是**有意**的偏离 |
| `listTokens` 不是全表 | 只列需要 light/dark 双份覆写的 alias 子集；判断 token 是否存在以官方 CSS 用法为准 |
| 客户端半边首次出现需要重启 | `@deepseek-ai/dsh-client-modules` 在启动时扫描 `exports["./client"]`；给已在运行的插件**新增**客户端半边，通常要重启一次 DSH 才发布 bundle |

## 7. Git 与发布

- 分支 `main`；远端 `origin` → `https://github.com/qq540491950/dsh-hooks.git`。
- 提交信息中文：`feat|fix|docs: 一句话` + 空行 + 分节说明（接入点 / 数据面 / UI / 自检）；**写进 UTF-8 文件用 `git commit -F`**（不要 `-m` 直传中文，见 §1.1）。
- **推送前扫密钥**：不得含真实 token / API key / 内网地址；`hooks.json` 示例里不写机器绝对路径（现在 `_comment` 与命令里就有 `D:\...`，示例要标注为"本机 demo"）。profile 原文一律不粘进仓库。
- `.gitattributes` 强制 LF；不要引入 CRLF，也不要依赖 `core.autocrlf`（本机为 `true`，方向相反）。
- `git push` 的 stderr 进度会被 PowerShell 记成错误并给出 `[exit code: 1]`——**假警报**，以 `git ls-remote origin refs/heads/main` 与 `git status -sb` 为准。
- **装载路线二选一（必须在 README 里写明本包用哪条）**：
  - **路线 1「路径行」（当前）**：profile 的 `- insert:` 直接指向 `lib/index.js` 的 `file://` 绝对路径；不需要 `dsh.bundle.patch`、不需要 pnpm / node_modules。客户端 bundle 仍由 `dsh-client-modules` 从本包 `package.json` 的 `exports["./client"]` 定位，由 Host 在 `/plugins` 下发布。
  - **路线 2「bundle」**：`package.json` 声明 `dsh.bundle.patch: './cordis.patch.yml'`，由该 YAML 的 `- insert:` 行声明插件条目，走 `plugin_manager install_bundle`（官方要求：**不要**用 shell 命令复刻安装流程）。**两条路线是替代关系，不是互补字段**。走这条路要额外提交补丁文件与 `lib/**`（git 路线要求），且**替换已安装的包必须重启**才加载新的 JS 模块代。
- **`dsh.client` 的确切 schema（官方运行时校验器为准）**：`{platform, inject?, external?, immediately?}`。
  - `platform` **必填且必须是字符串**；只有 `platform === "web"` 才会发布客户端半边（其他值等同"没有客户端半边"）。
  - `inject: string[]` 只用于**排序激活**（不是模块依赖）；`external: string[]` 声明**非基线**运行时 import（答案来自动态包行或静态表，且某一行不得声明自己的包）；`immediately: boolean`。
  - **声明了 `dsh.client` 却没有 `exports["./client"]` 会直接抛错**；`exports["./client"]` 只接受字符串，或带字符串 `default` 的对象。bundle 文件按 `join(dirname(package.json), 相对路径)` 解析。
  - 运行时 `require('@deepseek-ai/dsh-client-ui-*')` 等 Harness Client 包**被官方 practices 禁止**（这正是 eslint 要禁客户端运行时 import 的原因）。
- **发布状态（已落地一部分）**：`package.json` 已有 `scripts` / `engines`（`node >=22.18` + `dsh` 版本）/ `exports`（`.`、`./client`、`./package.json`、`./locale/*.json`）/ `dsh`（`manifestVersion: 1` + `client.platform: "web"`）/ `files` / 顶层 `icon`；`peerDependencies` **恰好一个**（`@deepseek-ai/cordis`，绝不 pin `@deepseek-ai/dsh-*`，否则 app-boot 会整包跳过）。`npm pack --dry-run` 实测 **8 个文件 / ~128 KiB**（见 README「发布」）。
  **仍待用户决定**：`private: true`（发 npm 必须先摘掉）与 `license`（法律声明不替用户编；定了之后把 `LICENSE` 加进 `files`）。**包名 `dsh-hooks` 是否被占未核实**。升级后宿主半边仍需重启。
- **manifest 级展示元数据（已落地，事实以官方源码为准）**：`icon` 是 **`package.json` 顶层字段**（官方 `dsh-app-boot` 源码里是 `iconOf(manifest?.icon, manifestPath)` —— 写成 `dsh.icon` **没人看**），相对包根、≤ 256 KiB、SVG/PNG/JPEG/WebP；`locale/en.json` 是**英文兜底**，其余语言必须**与它同目录**（官方会因"不同目录"直接抛错）；**`locale/*.json` 必须进 `exports`** —— 否则 subpath 被 `exports` 挡住，界面**静默**不显示名字与图标。配套要加 `files` 里的 `locale/*.json` 与图标文件。缺失时回退到 `name`/`description` 与默认图。**这是"插件卡片图标"，与设置导航那一格的图标（§3.3，slot 注册给不了）是两回事。**
- **`files` 白名单（已落地 + 有断言）**：`lib/**`、`!lib/.types/**`、`icon.svg`、`locale/*.json`、`README.md`。**必须排除 `lib/.types/**`** —— `lib/**` 会把 tsc 中间产物一起带进包（既不在 `exports` 里、又会过期）；这条是 `npm pack --dry-run` 实测抓到的。`src/` `tools/` `docs/` `AGENTS.md` `.tmp/` 一律不进包（`A` 区有断言）。发布前跑 `.tmp/pack-scan.mjs`（交叉核对 + 扫密钥）。**`private` 与 `license` 是用户决定**，不替用户编法律声明。
- **安装契约双向核对**：`install_bundle` 也认绝对路径 / git / tarball；git 路线要求补丁文件与 `lib/**` **已提交**，且 bundle 判定发生在抓取之后（失败会回滚 profile）。

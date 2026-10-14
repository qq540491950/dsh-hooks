# 设计记录：为什么是这些做法

> 这份文件回答"**为什么不用另一条路**"。结论背后是**官方源码 + 两个已上线的兄弟插件**的实测，
> 不是我偏好。取证的原始出处都标了行号/路径，方便版本升级后复查。
> 与 [AGENTS.md](../AGENTS.md) 的分工：AGENTS 写"必须怎么做"，这里写"为什么不是别的做法"。

## 1. 通道选型：设置页怎么拿到 hooks 配置

### 1.1 问题

设置页「Hooks」（`settings.section` 座位 `hooks/920`）跑在**浏览器**里，而 `hooks.json` 在
**Host 进程**手里。页面读不到任何文件，所以页面与宿主之间**必须**有一条通道 —— 这不是偏好问题，
是平台结构决定的。

### 1.2 候选与结论

| 路线 | 结论 | 理由（证据） |
|---|---|---|
| **A** 客户端直接读文件 | ❌ 不可能 | 浏览器没有 `fs`。宿主半边也没有 DOM/React，渲染不了设置页座位 |
| **B** 构建时把配置打进客户端 bundle | ❌ 不能用 | 配置按项目、运行时变化；构建期快照必然过期 → 正是"界面在撒谎" |
| **C** `@deepseek-ai/dsh-client-store` 当通道 | ❌ 不是通道 | 它是**浏览器本地**的 observable/快照原语（Immer + `localStorage`），"不提供跨设备同步"、不连宿主。可以拿来**放**快照，但拿不到快照 |
| **D** 自建 Remote 命名空间（`ctx.typert.register()` + `remote.$mount()`） | ❌ 不选 | 官方机制，但要手写严格 codec（**客户端 bundle 里没有 zod 种子模块**），且能力集**构建期固定**。`dsh-mcp-manager` 在同类场景下评估后否掉了它（其 README §3 的 C 路线） |
| **E** `$events` 事件流推送 | ❌ 不选 | `dsh-client-connection` 的流是 API Gateway 自己的 **generation / 增量 listener** 通道（先发 `{type:'ready'…}` 再发事件），不是给插件推业务状态的公开面。而且设置页是"打开才需要数据"，请求/响应天然更简单，推送要多处理重连与乱序 |
| **F** session command + `ctx.remote.commands.execute()` | ❌ 不适用 | 官方 `user-actions.md` 推荐的"一个操作两个调用方"**入口**，适合**有 session** 的 agent tool/命令；设置页与 session 无绑定，而我们的操作对象是**配置文件**而不是会话 |
| **G** `ctx.connection.fetch.register()` 精确路由 `/api/hooks` | ✅ **采用** | 见下 |

### 1.3 为什么是 G

官方 `@deepseek-ai/dsh-client-connection` README 自述本包职责就是"浏览器与 Host 之间的协议层：
Remote RPC、带重连的事件流投递、**精确 Fetch 路由**、`/api` HTTP 桥与浏览器信任栅栏"，并明确
"Host half **始终**提供与载体无关的 RPC 注册表和精确 `GET`/`HEAD`/`POST` 路由注册表"。

于是我们白拿三样东西，一样都不用自己实现：

1. **鉴权**：路由挂在 webServer 的 `/api` 前缀下 → 先过 Host/Origin 围栏（失败 **403**）再过浏览器
   会话 cookie 鉴权（失败 **401**）。启动令牌换成 host-only / `HttpOnly` / `SameSite=Strict` 的
   签名 cookie，绑定 hostname + port，默认 30 天。**自己写这套是纯风险**。
2. **生命周期**：`connection.fetch` 是 caller-context 求值的 getter，`register()` 会把 disposer
   挂到**调用方 scope** —— 插件卸载即摘除路由。
3. **零 import**：宿主半边照旧可以零裸 import（本插件的硬约束）。

还有两条官方契约细节被写进了实现：

- 路径**必须以 `/api/` 开头**（`connection.fetch` 自己校验）。
- `requestBody` 必须在 bridge **读取任何字节之前**声明为 `'buffered'` 或流式；
  我们选 `'buffered'`（POST 体积只有几百字节；默认上限 `maxRequestBodyBytes` 300 MiB）。
- 客户端断开时**处理函数会收到 abort 信号** —— 写入路径要把它透传给 `ctx.fs`。

### 1.4 这条路线的代价（记账）

- 路由字面量必须在**宿主与客户端两份产物里逐字一致** → 自检里断言两份产物都含同一字面量。
- 客户端必须传**绝对 URL**：`dsh-skill-manager` README 记着真实报错
  `Failed to parse URL from "/api/skill-manager"`。
- 路由/鉴权问题**离线测不出来**，重启后要在线上点一次。
- 可离线测的部分：注册契约（路径/方法/`requestBody`）与 handler 行为 —— 直接用
  `new Request('http://127.0.0.1/api/hooks', {method:'GET'})` 调 handler（`dsh-skill-manager`
  的自检就是这么做的），不需要浏览器。

### 1.5 与官方 "一个操作两个调用方" 的关系

官方 `references/user-actions.md` 要求：**操作只实现一次**（一个 Host service 方法），UI 与 agent
tool 都调它，禁止两条路径各写一套逻辑。

本条对本插件的约束：**所有写入语义只写在宿主侧的一个模块里，路由只是它的适配层**。
这样将来要把同一批操作暴露成 agent tool 时，不需要重写任何业务逻辑 —— 也不会出现
"UI 里能改、工具里改了另一个地方"的漂移。

> 出处：`app.asar → @deepseek-ai/dsh-client-connection/README.zh.md`（协议层与信任栅栏）、
> `@deepseek-ai/dsh-client-store/README.zh.md`（本地状态原语）、
> `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/references/{ui-plugin,user-actions}.md`、
> 以及本地兄弟插件 `dsh-mcp-manager`（`README.md` §3 四路线比选、`docs/design-notes.md` §3）与
> `dsh-skill-manager`（只读页仍然用同一条路由 + 用 `Request` 对象做离线自检）。

## 2. 写入：为什么是"克隆整份 + 只改一处 + 保留性证明"，而不是 `fs.editText`

官方 `fs` 服务确实提供 `editText(target, {oldString, newString, replaceAll}, {version})`，契约里
还写明"版本守卫在匹配**之前**检查，过期的内容会报 `FS_STALE_VERSION`" —— 从"改动最小"的角度看它
是最优解。**本插件仍然没用它**，理由是它的前提在我们的操作集里不成立：

| 我们的操作 | `editText` 需要什么锚点 | 现实 |
|---|---|---|
| 改 `command` | `JSON.stringify(旧命令)` 的**字节级**出现 | 能做到，但只在"该字符串在文件里恰好出现一次"且没有被手写成 `\uXXXX` 转义时才成立 |
| 开/关 `disabled` | 关闭时删一个键、开启时**插入**一个键 | **没有锚点**。`disabled` 原本不存在时，"插入"只能靠猜命令那一行的形状（还是猜缩进、逗号、键序）—— 猜错就是改坏用户文件 |
| `timeout` 设为 `null` | 同上（删键） | 同上 |
| 新增/删除/移动整条 | 结构性改写 | 本来就不适合 |

所以本插件的机制是：**克隆整份原始 JSON 树 → 只改目标那一个节点 → 序列化**。

- 未知键能留下来，是**结构上不可能丢**（我们从不从"解析后的视图"重建文档），而不是"重建之后再比对"。
- 代价：**重新序列化**。用手写的、格式不规则的 `hooks.json` 第一次保存时，会顺带被规范成"探测到的缩进 + LF + 结尾换行"。之后它就是**不动点**（`serialize(parse(text), detectStyle(text)) === text`，有断言），所以后续编辑的 diff 一定只落在改动那一处。
- 补偿措施：`preservationProblem()` 仍然每次都比对 —— 它守护的是"**我声明改了什么**"这份声明本身。第一版把 `removeHook` 的补偿方向写成"两侧都抹掉"，结果是删除操作会被自己的证明拒写；那条断言当场把它抓了出来。

> 出处：`cordis_inspect_query`（platform: host, provider: Service, `{"service":"fs"}`）—— 已核实
> `FsWriteIntent` 的确切形状、`FS_STALE_VERSION` 这个错误码、以及 `writeText` 的第五个参数是
> `sandboxPolicy`（**必须传调用会话的那一份**，与 hook 子进程同样理由：AGENTS §1.6）。


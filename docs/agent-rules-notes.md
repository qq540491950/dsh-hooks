# 取证、事故与断言台账

`AGENTS.md` 只写"做什么、怎么自查、代价"。**这条规则是怎么来的**、**当时发生了什么**、
**断言覆盖到哪一步**都记在这里，免得规则变成没有出处的口号。

---

## 1. 取证记录（每条都写明出处）

| 结论 | 出处（可复核） |
|---|---|
| 宿主半边**零 import**：相对 import 由打包器内联，裸说明符从磁盘路径解析不到 | `resources/app.asar` 里的 `@deepseek-ai/*` 包；产物断言 `lib/index.js` 的 `import`/`require` 计数为 0 |
| `dsh-hook-protocol` **不解析配置文件**（只有 matcher 语义、输出 codec、`runCommandHook(已解析的 hook)`、判决合并） | 读 asar 内 `@deepseek-ai/dsh-hook-protocol/lib/index.js`。**后果**：`disabled` 可以安全落在 hook 对象上（§2.5 的结论比原计划更宽松） |
| `fs.writeText(target, content, expected?, signal?, sandboxPolicy?)`；`FsWriteIntent = {kind:'createIfAbsent'} \| {kind:'replaceIfVersion', version}`；版本不符抛 `FS_STALE_VERSION`；`FsInfo.version` **必填** | `cordis_inspect_query` host `Service.listService {service:'fs'}` |
| **父目录会被自动创建**：`writeFileAtomic` 里有 `mkdir(dirname, { recursive: true })`；`replaceIfVersion` 在文件**已消失**时也报 `FS_STALE_VERSION` | 读 asar 内 `@deepseek-ai/dsh-fs-local/lib/index.js`（`writeFileAtomic` 调用点） |
| 座位注册字段白名单**没有 `icon`**（只有 `key/id/order/label/priority/select/inject/children/store/locale/registrant`）；导航图标由官方 `navIcon(id)` 硬编码查表 | 读 asar 内 `@deepseek-ai/dsh-client-ui-slots/lib/index.js` 的 `register()` |
| `settings.section` 必须走 `slots.inject`（未声明的座位直接 `register` 会抛 `slot "..." is not declared`） | 同上 + 官方 `settings-general` 声明处 |
| `dsh.client` schema：`{platform, inject?, external?, immediately?}`；`platform === "web"` 才发布客户端半边；声明了 `dsh.client` 却没有 `exports["./client"]` 会**直接抛错** | 读 asar 内 `@deepseek-ai/dsh-client-modules/lib/index.js` |
| 浏览器半边是 **classic script + 单 factory**，`id` 必须等于包名 | 同目录成熟兄弟插件 `dsh-skill-manager/lib/client.js` 的 wrapper（头尾形状） |
| `connection.fetch.register()` 的路径必须以 `/api/` 开头，自带 Host/Origin 围栏（403）与浏览器鉴权（401） | `cordis_inspect_query` host `Service.listService {service:'connection'}` + `docs/design-notes.md` §1 |
| 宿主半边**不热重载**（`insert` 立刻出现在 Loader 树里但不激活；`plugin_manager` 禁用→启用也只是对同一模块实例再 `apply()`） | 实测 + `plugin_manager list_plugins` |
| 客户端半边**首次出现需要重启**（启动时扫描 `exports["./client"]`）；之后由客户端 HMR 替换 | 同 `dsh-client-modules` 的加载时机 |

---

## 2. 事故复盘（每一条都对应一条现在的硬规则）

### 2.1 fail-open：写坏一个字符 ⇒ 全部 hook（含 deny 守卫）静默消失（§1.8 / §2.9）
- **形态**：`error`（读到了但 JSON 非法）被折叠成"没有配置"。用户改坏一个字符，所有 hook —— 包括
  用来阻拦危险命令的守卫 —— 全部静默停止，而且文件一直是坏的就一直停。
- **为什么危险**：这是**安全默认值**级别的失效，而且完全不报错：从"钩子没触发"到"守卫消失"之间没有任何信号。
- **修法**：三态（`absent` / `ok` / `error`）+ `error` 时**沿用最近一次成功解析的配置**（last-good）；
  同一条错误只 warn 一次；**删除文件仍然是合法的清空**，不许 fail-safe 回旧配置。
- **断言**：`tools/verify.ts` 的 `fail-open` 区；反向验证：把 `stale` 打回 `false` → 3 条精确报错。

### 2.2 每次事件点两次 `stat`：C2 版本通道（§2.9）
- **代价与收益**：Windows 上 ~10–100µs/次；换来的是"内容一变就立刻重读，不必等 TTL"。
- **边界**：假 `ctx.fs` **默认不返回 `version`**（于是默认覆盖"没有版本通道"那一支）；
  `stat` 失败**绝不允许**清掉 last-good。
- **断言**：`C2` 区 + **双向**反向验证（关掉版本通道 → 2 条报错；把"内容变了"看成"没变" → 1 条报错）。

### 2.3 `write.ts` 被 esbuild 静默丢掉：源码存在 ≠ 已交付（§4.8）
- **形态**：`src/host/write.ts` 整块没进产物（没有任何模块 import 它），而**所有指纹断言照样全绿**
  —— 指纹证明的是"产物 = 当前源码的产物"，管不了"这个模块压根没被打进去"。
- **修法**：`E` 区为每个"必须交付的模块"留一个**唯一标记字符串**的断言（现在有 `/api/hooks`、
  `改写会动到目标之外的字段`、`已截断`）。
- **同类**：客户端半边也一样（`lib/client.js` 必须包含同一个 `HOOKS_ROUTE` 字面量，不一致就是静默 404）。

### 2.4 保留性证明把自己拒了（§2.4）
- **形态**：`removeHook` 把补偿声明成 `area: 'both'`，于是**删除类操作被自己的证明拒写**。
- **教训**：证明检查的是"我声明改了什么"这份**声明**本身 —— 声明写错方向，功能就整个不可用。
  它不是"重建之后再比对一下"的装饰。

### 2.5 假件比真的弱：`createFile` 在自检里 500，真机没事
- **形态**：假 `ctx.fs.writeText` 不建父目录 → `createFile` 报 500；而真实 provider 的
  `writeFileAtomic` 里有 `mkdir(dirname, {recursive:true})`。
- **教训**：**假件必须与真实同能力**。否则会出现"自检里假失败、真机没事"，反过来也可能掩盖真问题
  （假件比真的**强**时，真机上才会失败）。修法是让假 fs 也 `mkdir`，并把这条写进 §2.12。

### 2.6 渲染测试的假 React **只折树、不展开函数组件**
- **形态**：D 区第一版断言"7 个事件全列"看到 **0 个事件名** —— 因为 `SourceCard` / `EventRow` /
  `HookRow` 这些函数组件从未被"渲染"（假 React 只是把元素树摊平）。
- **为什么危险**：如果不修，我会得到一区**看着很绿、其实什么都没测**的渲染测试。
- **修法**：`flatten` 里对 `typeof node.type === 'function'` 调一次组件函数（最小必要的 reconcile）。
- **限制（诚实记录）**：因此**子组件不许用 hook**；哪个子组件引入 hook，就必须把 hook 存储从
  "位置索引"改成"按组件实例索引"。这条限制直接影响了 P6 的设计（行内编辑状态放在最外层）。

### 2.7 按下标选按钮：测试的脆弱被伪装成产品的回归
- **形态**：每加一个按钮（0 → 2 → 3 → 4），按下标选按钮的旧断言就**换一个目标去点**，
  而报错说"功能坏了"。三处旧断言本来就是靠"索引恰好没变"在过关。
- **修法**：按钮带 `title`（动作名），测试用 `buttonByLabel(nodes, '停用')` 选；
  `writeButtons` 只用来数数量。

### 2.8 JSX 插值会切成独立文本节点
- **形态**：`{String(n)} 条` 在假 React 下是**多个**文本节点，`texts.includes('生效 4 条')` 永远为假。
- **修法**：子串断言先把文本片段按文档顺序**拼起来**（`joined`）；精确匹配（事件名）仍用数组。

### 2.9 上线才发现的 404：`apply()` 里直接读可选服务（§2.12 的那条硬规则）
- **现象（用户重启后第一步就撞上）**：设置页「Hooks」**正常出现并渲染**（导航、齿轮图标、错误文案全对），但面板里是
  `连不上宿主…` + 技术原文 `Unexpected token 'o', "not found" is not valid JSON` —— `GET /api/hooks` 拿到的是
  **web 服务器的纯文本 "not found"**，不是我们的 JSON 信封。
- **根因**：宿主写的是 `if (ctx.connection !== undefined) { registerHooksRoute(...) }`。Cordis 的服务是**渐进可用**的，
  `apply()` 时刻 `connection` 还没加载 → 条件为假 → **整条路由被静默跳过**。改成
  `ctx.inject(['connection'], (scope) => …)` 后正常。
- **为什么自检当时全绿**：假 `ctx` 把服务挂在属性上（`connection: options.connection`）。**假件比真的强** ——
  它替产品把"服务已就绪"这个不成立的前提补上了。这与 §2.5（假 fs 比真的**弱**）是同一枚硬币的两面：
  **假件的时序与能力都必须与真件一致**，否则自检只是自我安慰。
- **修法与防线**：① 宿主改走 `inject`；② `HostContext.inject` 加**重载**（精确声明 `['connection']` 时回调里的
  `scope.connection` 保证存在）；③ **假 ctx 不再把服务挂在属性上**，并专门断言 `ctx.connection === undefined`
  且 `inject` 能交付；④ 把旧写法注入回去 → **18 条断言同时红**（修前全绿）。
- **教训（比 bug 本身重要）**："真人点一遍"抓到了离线自检抓不到的东西 —— 这里缺的是一个**只有真运行时才有的前提**
  （服务在 apply 时尚未就绪）。所以真实走查与断言**不是替代关系**。

### 2.10 顺带确认的事实
- 客户端半边**确实需要重启一次**才发布：重启后 `settings.section` 的占位从 7 个变成 8 个（多了 `hooks/920`）；
  在此之前 `Slots.listSubTree` 里**没有** `hooks`。这条可以用 `cordis_inspect_query`（不需要审批）直接取证。

---

## 3. 断言台账

**条数看 `node tools/verify.ts` 的输出，别抄这里的数字**（会漂移）。这里只记演进与"每阶段不减少"这条门槛。

| 阶段 | 结果 |
|---|---|
| P0 基线冻结 | 61 |
| P1a 三态 / P1b 版本通道 | 65 → 68 |
| P2 TS 工具链 | 68 |
| P3a/P3b 协议层 + 主体 TS 化 | 74 → 76（去掉 5 条只对迁移期有意义的差分测试，加 7 条交付断言） |
| P4a 只读数据面 | 89 |
| P4b 写路径 + 文件下标 | 99 |
| P4c `POST /api/hooks`（版本锁 + 三道防线） | 107 |
| P4d 台账 + 可寻址视图 | 110 |
| P5a 客户端半边（产物协议 + 只读看板） | 113 |
| P5b 真实渲染测试 | 115 |
| P6a/P6b/P6c/P6d/P6e 受控写入 | 117 → 118 → 119 → 120 → 121 |

### 反向验证记录（每个注入都要"精确命中 + 还原"）

| 轮次 | 注入的违规 | 结果 |
|---|---|---|
| P1 | `stale` 打回 `false` | 3 条精确报错 |
| C2 | 关掉版本通道 / 把"内容变了"看成"没变" | 2 条 / 1 条 |
| 指纹 | 改源码不重建 / 手改产物 / 改 builder | 各自精确报错 |
| P4a | 空事件不过滤 / `disabled` 不跳过 / `staleInUse` 恒 false / 编造 `process.cwd()` / 500 带 `data` | 各自精确命中 |
| P4b | 删除补偿方向写成 `both` / `indexOf` 接受 `-1` / 忽略 tab 缩进 / 保留性证明变空操作 | 各自精确命中 |
| P4c | 乐观锁传假版本 / 读不懂也照写 / `capabilities.writable` 写死 false | 各自精确命中 |
| P4d | 台账匹配忽略 `command` / 台账不封顶 / `rawIndex` 用解析后的下标 | 各自精确命中（最后一条同时打红两条断言） |
| P5a | `platform` 非 web / 产物 `id` 不等于包名 / 座位 `order` 退回 910 | 各自精确命中 |
| P5b | 没有记录也报绿 / 空事件不渲染 / error 与 absent 糊成一句话 | 各自精确命中 |
| P6a | 写请求寻址到错误文件 / 错误码糊成一句 / 写失败清空页面 | 各自精确命中 |
| P6b | 编辑框不预填当前命令 / 保存发旧命令 | 各自精确命中 |
| P6c | 点"删除"直接发请求 / 确认态下普通按钮也渲染 | 各自精确命中 |
| P6d | 试运行也写台账 / 不按文件下标定位 | 各自精确命中 |
| P6e | 试运行结果不渲染 / deny 说成"失败" | 各自精确命中 |

### 自欺陷阱清单（§4.3 的落地版，都是实际踩过的）

1. 注入点让进程**崩掉** → 看起来像"没报错"（用 `if (false) …` 之类不执行的注入）。
2. 锚点不唯一 → 先断言"锚点恰好命中 1 次"，否则该用例作废（注入脚本里都带这一步）。
3. 断言里带**恒真的「或」** → 永不失败的断言比没有更糟。
4. 注入打错半边（改宿主却断言客户端）。
5. **平凡的断言**：例如"元素存在"这种永远为真的检查。
6. （本轮新增）**假件比真件弱**：自检失败但真机没事 —— 见 §2.5。
7. （本轮新增）**测试自己脆弱**：断言依赖"索引恰好没变" —— 见 §2.7。

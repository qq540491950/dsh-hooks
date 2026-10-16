# dsh-hooks

给 DeepSeek Harness 加**按项目生效的 hooks**。

配置放在 DSH 已经承认的项目级目录里：

```
<projectRoot>/.dsh/hooks.json      ← 项目级：只对这个项目生效
$DSH_HOME/hooks.json               ← 用户级：对所有项目生效（= ~/.dsh/hooks.json）
```

`projectRoot` 的定义与 `dsh-skill-filesystem` 的 `<projectRoot>/.dsh/skills` 完全一致：
**最近的包含 `.git` 的祖先目录；没有就用会话 cwd**。所以从子目录（`packages/app/src`）开
的会话也会命中最内层项目根的配置。

## 为什么需要它（自带兼容桥做不到）

DSH 自带两个 hooks 兼容桥（`@deepseek-ai/dsh-hooks-*`），但它们：

| 限制 | 后果 |
| --- | --- |
| `configPath` 是进程级单值，`apply()` 里只 `readFileSync` 一次 | 一个 Host 进程只有一份配置 |
| 桌面 GUI 一个进程服务所有 session，`process.cwd()` 固定 | 无法表达"每个项目各自的 hooks" |
| 无分层发现、无热加载 | 换项目要重启整个 app |

本插件在每个 session 首次触发时按 `agent.session.header.cwd` 解析 projectRoot，按 projectRoot
缓存，并用 `ctx.fs.watch()` 监听配置文件 —— **多个项目同时开着也能各用各的，改配置免重启**
（实测，见[热重载实测记录](#热重载实测记录不重启即生效)）。

缓存失效有**三层通道**（按优先级），缺一不可：

| 通道 | 机制 | 生效延迟 |
| --- | --- | --- |
| 主通道（版本核对） | 每个事件点比对两个配置文件的 `ctx.fs.stat().version` | 内容一变，**下一个事件点**即生效（连 TTL 都不必等） |
| 加速通道（监听） | `ctx.fs.watch()` 监听 `<projectRoot>/.dsh`、`hooks.json`、`$DSH_HOME/hooks.json` | 秒级（实测 < 1s），不等版本核对 |
| 兜底通道（TTL） | 正结果 4s / 负结果 2s；**只在拿不到 `version`（provider 不提供）或 `stat` 抛错时**才起作用 | 最坏 `POSITIVE_TTL_MS` = 4s |

为什么三层都要：`fs.watch` 是**尽力而为**的（可能根本没挂上、挂上了不投递事件），而版本核对要求
provider 真的返回 `version`。任意一条失效，最坏也只是"迟几秒生效"，而不会退化成"必须重启"。

## 源码与构建

**源码是 TypeScript**（`src/**`），`lib/index.js` 是 **esbuild 的构建产物**，同样提交进版本库
（profile 的路径行直接指向它）：

```bash
pnpm install
pnpm build             # src/** → lib/index.js + lib/.build-manifest.json
pnpm check             # typecheck + typecheck:tools + format:check + lint + verify
node tools/verify.ts   # 唯一必跑的自检
```

- **不要手改 `lib/index.js`**：下一次构建会静默覆盖它，而且自检的 `E` 区会立刻报
  "产物 sha256 与指纹不符"。
- 改了 `src/**` **必须重建**（`pnpm build`）：忘了重建会得到
  `E：指纹覆盖到的每个源文件都没有变` 这条精确报错，而不是"自检全绿但改动没生效"。
- 宿主半边**零 import**：相对 import 由 esbuild 内联进单文件，裸模块说明符在 `app.asar` 里
  从磁盘路径根本解析不到（自检会断言产物里 `import` / `require` 计数都是 0）。
- 构建脚本刻意**不写时间戳**，所以构建是幂等的（同源码 → 同字节），可以用
  `git diff --exit-code lib/` 当第二把锁。
- `pnpm typecheck` 分两半跑：宿主半边**没有 DOM**、客户端半边**没有 node types** ——
  写错半边会直接编译不过，不靠人记规则。

## 安装

两条路线**替代关系**（见 `AGENTS.md` §7），同一时间只应生效一条。

> **本机现状（2026-10-16）**：已切到**路线 2「bundle」** —— 装的是 `v0.2.2`（lockfile 钉在
> `a41f3f8`），profile 里那条手写路径行**已删**（备份 `cordis.patch.yml.bak-20261016142901`）。
> 宿主半边要**重启 DSH** 才会改从 `<profile>/node_modules/dsh-hooks/lib/index.js` 加载。
> **装了 bundle 之后，改本地源码 + `pnpm build` 不再影响运行中的插件** —— 要边改边看就切回路线 1。

### 路线 1「路径行」

追加到 `%DSH_HOME%\profiles\<profile>\cordis.patch.yml`（本机是
`C:\Users\admin\.dsh\profiles\desktop\cordis.patch.yml`）：

```yaml
# --- 项目级 hooks ---
- insert:
    - id: dsh-hooks
      name: 'file:///D:/project/dsh-plugins/dsh-hooks/lib/index.js'
```

无 `config:` 段 —— profile 直接指向 `lib/index.js` 的 `file://` 绝对路径，
**不需要 pnpm install，不需要联网**，改完源码 `pnpm build` 重启即生效。（同目录的 `dsh-continue`
也用这条路。）代价：Loader 行是**机器绝对路径**，换机器 / 换目录要改这一行。

### 路线 2「bundle」（本机当前生效）

`package.json` 的 `dsh.bundle.patch` → `./cordis.patch.yml`（包内那一层只声明插件自己这一行，
`name` 必须等于包名）。`plugin_manager install_bundle` 用它挂载，并把
`dependencies` / `dsh.profile.bundles` 写进 profile —— 这两处**由它写，不要手改**。

切换时必须**二选一**，否则同一个 id 会出现两行，Loader 只保留一行（后应用的层覆盖先应用的层），
"到底加载的是哪个文件"就不可读了：

1. 在「设置 → 插件」里安装/更新本包（或让有 `plugin_manager` 工具、且审批放行的会话执行
   `install_bundle`）—— 它会写好 profile 的依赖与 bundles 列表；
2. **把 profile 里那条 `- id: dsh-hooks / name: 'file:///…/lib/index.js'` 删掉**
   （改 `~/.dsh/profiles/**` 前先备份成带时间戳的 `.bak`，只做最小行级改动，改完用真实 YAML
   解析器验一遍 —— `AGENTS.md` §1.4）；
3. 宿主半边**必须重启**才会加载新的 JS 模块代（§1.2：`disable→enable` 不重新 import 模块）。

### ⚠️ 必须重启 DSH

实测结论（`plugin_manager list_plugins` + 端到端探针）：`insert` 进来的新条目**会立刻出现在
Loader 树里**（`include:dsh-hooks`，`enabled: true`），但**不会在运行中的进程里激活**——
`app-boot/config-reload` 是保守的，只调和已存在条目。而且 `dsh-hmr` 的 `root: []` 不监听本插件文件。

所以：**加完 patch 行要重启 DSH**；之后改本插件的 `lib/index.js` 也要重启才生效
（只有 `hooks.json` 的内容是热重载的）。

> 补充实测：`plugin_manager set_plugin`（disable → enable）**也不会**重新 import 磁盘上的
> `lib/index.js` —— 它只是重新 `apply()` 同一个模块实例（拿一个临时哨兵字符串验证过：
> 重挂载后新代码里的改动没有出现）。所以 `lib/index.js` 的改动**只能靠重启 app 落地**，
> 不要指望用插件开关省掉重启。

### 验证它活了

重启后，在 DSH 里执行一次**带魔法串的 shell 调用**：

```pwsh
Write-Output DSH_HOOKS_PROBE
```

如果被拦截并返回 `dsh-hooks 存活探针：插件已加载且 PreToolUse 命中（event=… tool=… cwd=…）`，
就说明插件已加载、matcher 命中、`PreToolUse` 真的在跑。其余调用完全不受影响（探针只在看到这个
魔法串时才 deny）。

这份 demo 配置在 [`.dsh/hooks.json`](.dsh/hooks.json)：一个 `matcher: "pwsh"` 的**非阻断**探针，
脚本是 [`.dsh/live-probe.mjs`](.dsh/live-probe.mjs)。删掉这两个文件就完全移除。

> #### ⚠️ 判定 hook 有没有跑，请走协议出口，不要靠"探针写文件"
>
> 上一轮的三个热重载实验全部用"探针把 payload 追加到某个日志文件"来判定 hook 有没有跑，
> 结论是"热重载失效"——**这个结论是错的**。原因是当时 hook 子进程**写不了任何持久位置**
> （v0.1.0 的实测见[写入边界](#hook-子进程的写入边界)）：
>
> | 目标 | v0.1.0 结果 |
> | --- | --- |
> | `<repo>/.dsh/probe.log`、`<repo>/.tmp/probe.log` | `EPERM` |
> | `%TEMP%\dsh-recon\probe.log`（真实临时目录） | `EPERM` |
> | `C:\Users\admin\.dsh\…` | `EPERM` |
> | hook 进程自己的 `os.tmpdir()`（`%TEMP%\dsh-XXXXXX`，每次调用一个） | ✅ OK |
>
> 而探针脚本通常还 `try { appendFileSync } catch {}` 吞掉错误 —— 于是"hook 没跑"和
> "跑了但写不进去"长得一模一样。
>
> **v0.2.0 起** hook 已经继承会话的沙箱策略（`danger-full-access` 会话下确实能写文件了），
> 但写文件探针**依然不推荐**：它会随会话档位时灵时不灵，而且依赖副作用才能判定。
> 判定 hook 是否触发，**永远优先走 hook 协议自己的出口**（`PreToolUse` 用
> `permissionDecision`，`SessionStart`/`UserPromptSubmit`/`PostToolUse` 用 `additionalContext`）。


## 热重载实测记录（不重启即生效）

环境：DSH desktop，宿主 PID 28736（`dsh-desktop-host`，profile `C:\Users\admin\.dsh\profiles\desktop`），
项目 `D:\project\dsh-plugins\dsh-hooks`，全部在**同一个活跃 session 内**完成，**期间没有重启 DSH、
也没有重挂插件**。

### 判定手段（关键）

不能用写文件判定（见上）。这次用的是**沙箱免疫**的通道：把探针挂成 `PreToolUse` 的一个组，
探针读 stdin，只在 `tool_input` 里出现魔法串 `HOTPROBE` 时输出
`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…marker=…"}}`。
于是"配置有没有被重新读"直接体现在**工具结果里的 marker**，只用 stdout，不需要任何写权限。

### 三次实验的真实结果（与上一轮结论相反）

| 场景 | 操作 | 期望 | 实测 |
| --- | --- | --- | --- |
| a. 原地改写 | 把组里的 marker 从 `M1` 改成 `M2` | 下一次调用 deny 理由里出现 `M2` | ✅ 出现 `M2`（`marker=M1 → M2`，未重启） |
| b. 删除后重建 | 删掉 `hooks.json`，300ms 后重建为 `RB2` | 下一次调用出现 `RB2` | ✅ 出现 `RB2` |
| c. 无 matcher 全匹配组 | 把组改成**没有 matcher**（全匹配） | 非 `pwsh` 工具（`glob`）也被拦 | ✅ `glob` 被拦（同组是 `matcher: "pwsh"` 时 `glob` 不被拦，作对照） |

结论：**`ctx.fs.watch()` 的热重载在这台机器上是正常工作的**，秒级生效。
上一轮"三次实验全部失败"是**观测手段失效**（探针写文件被 ACL 沙箱 EPERM 吞掉），
不是热重载失效。

### hook 子进程的写入边界

#### v0.1.0（修复前，同一探针顺手测的）

插件调 `ctx.shell` 时**不传 per-call 沙箱策略**，`dsh-pwsh-sandbox/lib/index.js` 于是
`request.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()` → 回退到**部署策略**
（`cordis.yml` 的 `sandbox-policy`：`mode: workspace-write`、`workspaceRoot: process.cwd()`）。

| 写入目标 | 实测 |
| --- | --- |
| `<repo>/.dsh/x.txt` | `EPERM` |
| `<repo>/.tmp/x.txt` | `EPERM` |
| `C:\Users\admin\AppData\Local\Temp\x.txt`（真实 TEMP） | `EPERM` |
| `C:\Windows\Temp\x.txt` | `EPERM` |
| `C:\Users\admin\.dsh\x.txt` | `EPERM` |
| `C:\Users\admin\AppData\Roaming\@deepseek-ai\dsh-desktop\x.txt` | `EPERM` |
| hook 进程的 `os.tmpdir()` = `%TEMP%\dsh-XXXXXX`（每次调用新建） | ✅ `OK` |

⇒ v0.1.0 里 **hook 进程只能写自己那次的私有 TEMP**，且这与会话档位**无关**（即使会话是
`danger-full-access`，hook 仍按**部署**默认档跑）。后果是任何落盘类 hook（格式化、自动修复、
写日志）都会**静默**失效：退出码非 2、输出非 JSON ⇒ 插件按非阻断失败处理，动作照常放行。

#### v0.2.0（已修）

插件现在用 `ctx.get('sandboxPolicy').resolve({ session })` 取**调用会话**的策略，并塞进
`shell.resolve({ …, sandboxPolicy })`（与 `dsh-tool-pwsh` 的 `resolveSandboxPolicy(exec)` 同构）。
于是 hook 与**同一会话里的工具调用**同权限：

| 会话档位 | hook 子进程能写哪里 |
| --- | --- |
| `read-only` | 哪里都写不了（与工具调用一致，**不提权**） |
| `workspace-write` | 会话 cwd 之内 |
| `danger-full-access` | 不受限（本机 desktop profile 的默认档，所以格式化 / 自动修复现在可用） |

服务没挂或 `resolve()` 抛错时**不传**该字段 → 回退部署策略，并且只打一条降级 warn，
**绝不让 hook 跑不起来**。每次 hook 执行的日志末尾也会带 `sandbox=<档位>`，
拿不到时显示 `sandbox=deployment`。

> ⚠️ 这条改动同时意味着：`danger-full-access` 会话里的 hook 可以写你会话能写的任何地方。
> 这**没有超出会话本身的权限**（同一会话里 agent 的 `pwsh` 本来就能写），但 `hooks.json`
> 是随仓库走的文件 —— 别把不受信任的 `hooks.json` 拉进项目（它本来就能执行任意命令）。


### 复现步骤（可直接照抄）

```pwsh
# 1) 备份
Copy-Item .dsh\hooks.json .tmp\hooks.json.bak

# 2) 追加一个 deny 探针组（命令里带 marker M1）
#    探针：只在 tool_input 含 HOTPROBE 时 deny，其余 exit 0
#    用 node tools/verify.ts --config .dsh\hooks.json 确认解析正常（无 matcher 诊断）

# 3) 等 3–5s，然后在 DSH 里发一次带魔法串的调用
#    Write-Output HOTPROBE      ← 期望被拦住，理由里带 marker=M1

# 4) 把 marker 改成 M2，再等 3–5s，再发一次 HotPROBE 调用
#    期望：理由里变成 marker=M2（= 不重启即生效）

# 5) 还原并核对字节
#    还原后 Get-FileHash / git hash-object 必须与备份一致
```

`POSITIVE_TTL_MS` 与 watcher 的区分办法：**改完配置后只等 1 秒**再发调用 ——
1 秒 < TTL(4s)，此时生效只可能来自 watcher；如果只有等过 4s 才生效，那就是 TTL 兜底在起作用。

## 配置格式

采用通用的 `hooks` 结构，`{"hooks": {...}}` 或裸事件映射两种写法都接受：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "pwsh|bash",
        "hooks": [
          { "type": "command", "command": "node .dsh/guard.mjs", "timeout": 30 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "edit|write",
        "hooks": [{ "command": "npx prettier --write \"${DSH_PROJECT_DIR}\"" }]
      }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "command": "node .dsh/prompt-check.mjs" }] }
    ],
    "SessionStart": [
      { "hooks": [{ "command": "node .dsh/context.mjs" }] }
    ]
  }
}
```

要点：

- **`timeout` 单位是秒**（通用 hooks 规范的语义）。缺省 = 600 秒。
- **只支持 `type: "command"`**（缺省即 command）。`http` / `mcp_tool` / `prompt` / `agent`
   会被跳过并在日志里 warn。
- **`args` 不生效**：DSH 的 hook 协议只认 `command` 字符串。要传参数就拼进 `command`。
- `${DSH_PROJECT_DIR}` 在命令串里会被替换成 projectRoot，同时作为**同名环境变量**注入给 hook 进程；
  `${DSH_PLUGIN_ROOT}` 同理（由配置里的 `pluginRoot` 提供）。
- `matcher`：缺省 / `""` / `"*"` 全匹配；纯字母数字下划线加 `|`（如 `edit|write`）按**字面量多选**精确匹配；
  其余按**非锚定正则**（如 `^mcp__github__.*`）。`UserPromptSubmit` 与 `Stop` 没有 matcher 主语，写了会被丢弃。
- **DSH 的工具名是 DSH 自己的**：Windows 上是 `pwsh`，POSIX 上是 `bash`。写 `Bash` / `PowerShell`
  这类外来工具名**不会命中**。跨平台就写 `pwsh|bash`。
- 单条 matcher 写错**只跳过那个 group**并 warn，不会让整份配置失效。

### 支持的事件（7 个）

| 事件 | 时机 | 能做什么 |
| --- | --- | --- |
| `SessionStart` | 会话创建 | 通过 `additionalContext` 注入上下文（`agent.inject`） |
| `UserPromptSubmit` | agent 收到 prompt | 拒绝整条 prompt，或注入上下文 |
| `PreToolUse` | 工具执行前 | `deny` 阻断（理由模型可见）/ `ask` 转审批弹窗 |
| `PostToolUse` | 工具执行后 | `block` 带 feedback 回灌模型，或注入上下文 |
| `Stop` | 一轮准备结束 | 强制再走一轮 |
| `SubagentStart` | 子 agent 启动 | 向进程内子 agent 注入上下文 |
| `SubagentStop` | 子 agent 结束 | 只能观察（harness 的 subagent seam 没有 veto 能力） |

`Notification` / `PreCompact` / `SessionEnd` / `PermissionRequest` 等**会被忽略**（写了不报错）。

### hook 进程的输入（stdin）

一行 JSON：

```jsonc
{
  "session_id": "...",
  "transcript_path": "",        // 恒为空串：DSH 的会话日志是 zstd 压缩的，shell 脚本读不了
  "cwd": "C:\\proj",
  "hook_event_name": "PreToolUse",
  "tool_name": "pwsh",
  "tool_input": { "command": "ls" },
  "tool_use_id": "call-42"
}
```

### hook 进程的输出

| 出口 | 语义 |
| --- | --- |
| **exit 2** | 阻断。stderr 作理由（stderr 为空则不填理由）—— ⚠️ **Windows 上不可靠，见下** |
| **exit 0 + stdout 是 JSON** | 结构化输出，见下 —— ✅ **推荐，跨平台可靠** |
| **exit 0 + 非 JSON stdout** | 不解析（注意：有些实现会把 SessionStart/UserPromptSubmit 的纯 stdout 当上下文，**本插件不支持**） |
| **其他 exit code / 起不来 / 崩溃 / 超时** | 非阻断失败，只记日志，动作照常 |

> ### ⚠️ 在 Windows 上请用 JSON deny，不要用 exit 2
>
> 实测（本机 DSH 的 `ctx.shell` 解析到 **Windows PowerShell 5.1**，不是 PowerShell 7）：
>
> | hook 进程的结尾 | DSH 实际看到的 exitCode |
> | --- | --- |
> | `node -e "process.exit(2)"` | **1** ← 2 被 PowerShell 折叠掉了 |
> | `node -e "process.exit(2)"; exit $LASTEXITCODE` | 2（必须显式转发才有效） |
>
> 后果：`exit 2` 退化成"非阻断失败"——**hook 看起来跑了，其实什么都没拦住**。
> 这是 DSH 在本机的 shell 行为，不是本插件的 bug；但写 hook 的人必须知道。
>
> **正确写法**：exit 0 + stdout 输出
>
> ```json
> {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"原因"}}
> ```
>
> 这条路径在 Windows / Linux / macOS 上语义一致。

```jsonc
{
  "continue": false,                 // 记录 stop 意图
  "stopReason": "...",
  "systemMessage": "...",            // 记录 + warn
  "decision": "approve|block",       // 顶层只认这两个
  "reason": "...",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",   // 必须等于当前事件，否则丢弃该块的事件级字段
    "permissionDecision": "allow|deny|ask",
    "permissionDecisionReason": "...",
    "additionalContext": "...",
    "updatedInput": { }              // 解析但**不生效**（只 warn）
  }
}
```

多个 hook 的合并：同一事件下**串行**执行（用户级在前、项目级在后），按
**`deny > ask > allow`** 取最严；同档理由用空行拼接；`additionalContext` 按顺序累积。

## 相对兼容桥的差异

| 能力 | 自带兼容桥 | 本插件 |
| --- | --- | --- |
| `<projectRoot>/.dsh/hooks.json` 逐项目 | ❌ | ✅ |
| 多项目同时生效 | ❌ | ✅ |
| 改配置免重启 | ❌ | ✅（`ctx.fs.watch` 秒级；失效时 4s TTL 兜底） |
| 用户级 + 项目级合并 | ❌ | ✅ |
| matcher 写错的影响面 | **整份配置失效** | 只跳过那一个 group |
| `Stop` 连续强制续跑 | **无上限**（会死循环） | 3 次后放行并 warn |
| `hook/invoked` + `hook/result` 审计事件 | ✅ | ❌（v1 只写日志） |

## 与兼容桥同时使用

不冲突，但**不要让两份配置命中同一个事件** —— 兼容桥是进程级单配置，本插件是按项目级，
很容易把同一个 hook 跑两遍。要稳妥就只启用本插件。

## 自检

不需要 DSH，直接用 Node 跑：

```pwsh
node tools/verify.ts
```

覆盖五个区（**条数看输出，别抄死**——每个 bug 修复都会顺手加断言）：

1. **静态**：`lib/index.js` 必须零 `import` / 零 `require`（这是 `file:///` 装载方式的硬约束）。
2. **纯函数**：matcher 语义、exit code 解码、`hookEventName` 守卫、顶层 decision 白名单、
   `deny>ask>allow` 合并、`continue:false` 粘滞、路径工具在 Windows/POSIX 根上收敛。
3. **集成**：用**真实子进程** + **真实文件系统**驱动的假 ctx，真正挂载插件后逐一验证
   deny / ask / block / reject / 上下文注入 / Stop 上限 / projectRoot 解析 / stdin payload 形状 /
   `DSH_PROJECT_DIR` 注入 / 用户级与项目级合并 / 超时非阻断 / 命令不存在非阻断 /
   **负结果过期** / **BOM 容错** / **`exec.agent` 缺失时退化到 `currentInitiator`**。
4. **热重载与缓存失效**（本次新增）：
   - `ctx.fs` **不提供 `watch()`** 时 hook 仍照常工作，且**每条路径只 warn 一次**（跨 TTL 重读也不重复刷屏）；
   - `watch()` **挂载失败**时同样每条路径只 warn 一次，TTL 周期重试不会重复告警；
   - **正结果 TTL 到期后会重读**（watcher 挂得上但永不投递事件时的自愈路径）；
   - **未到期不重复读**、到期只重读一次 —— 用真实 `readText` **调用次数**断言；
   - watcher 回调触发时**立刻**失效缓存（不等 TTL）并打一条**带 path 的限流 info**。
5. **hook 的沙箱策略透传**：hook spec 必须带上**调用会话**解析出来的
   `sandboxPolicy`（并断言 `resolve` 拿到的是那个 session）；会话是 `read-only` 时**原样透传**
   （不提权）；`ctx.sandboxPolicy` 缺失或 `resolve()` 抛错时**省略该字段**回退部署策略、
   且只打一条降级 warn —— hook 照常工作、判定不受影响。
6. **fail-open 修复与版本核对**（v0.2.1 新增）：
   - fail-open：hooks.json 写坏后**必须继续沿用上一份可用配置**（deny 不能消失）；
     顶层不是对象的 JSON 同样算"读不出来"；**删除**配置文件则必须真的清空
     （`absent` ≠ `error`，不许 fail-safe 回旧配置）；同一条错误只 warn 一次、成功读取后计数重置。
     用 watcher 回调强制失效，不靠 sleep。
   - 版本核对（C2）：provider 给出 `version` 时，**内容没变则 TTL 到期也不重读**（用真实
     `readText` 调用次数断言）；**内容一变就立刻重读**，不必等 TTL；**`stat` 抛错时只降级成
     TTL 语义、绝不丢 last-good**。假 `ctx.fs` 默认**不给** `version`，所以上面那批 TTL 用例
     同时在守"没有版本通道的 provider"这一支。
7. **客户端渲染**（`D`/`D23–D28` 区）：用**产物** `lib/client.js` 里注册到座位上的那个组件 +
   假 React（`useState` 按位置发值）+ 假 `fetch` 真跑一遍，并**点真的按钮 / 键盘真的按**。
   本轮补齐：空状态的两种副文案与「读不出来」这第三种情形、空状态主按钮真的打开表单、
   引导条出现并且点「切换过去」后**取数 URL 变成 `scope=current`**（反方向切回 `scope=user`）、
   **折叠收起时全页 `__btn--outline` 计数为 0**（展开后事件行是 ghost）、样式字符串的硬指标
   （popover 的 `max-height`/`overflow-y`/`overscroll-behavior`、`max-width:720px`、
   事件行 `height:32px`、内容区按钮 `border:0`），以及**作用域回显是唯一真源**那一组：
   触发器 label / popover 勾选 / **写请求落点**都跟 `snapshot.scope`（含"请求了 current、宿主
   归一化成 user"那一支），底部摘要的引导句只在"目标 ≠ 当前"时出现，非当前工作区的提醒
   **最多两句话**（曾经堆到三四行）。

另外可以单独体检一份真实的配置（不跑测试）：

```pwsh
node tools/verify.ts --config "D:\some\project\.dsh\hooks.json"
```

会列出：识别到哪些事件、每个 group 的 matcher 与 timeout、被跳过的非 command handler、
以及 matcher 诊断。**写配置之后先跑这个**，比等重启看日志快得多。

## 设置页数据面（`/api/hooks`，读写就位）

给设置页「Hooks」用的数据面，由宿主半边用 `ctx.connection.fetch.register()` 注册。
**读、定点写、试运行**都挂在这一条路由上：

- **为什么是这条通道**（7 条候选逐条否决：Remote / `$events` / client-store / 构建期快照 …）：
  [docs/design-notes.md](docs/design-notes.md) §1。
- `GET /api/hooks[?sessionId=…][&scope=current|user|workspace][&workspaceId=…]` → `{ok:true, data:HooksSnapshot}`；
  失败 → `{ok:false, error, detail?}`，**没有 `data`**（页面必须先补空形状再解引用）。
  `scope` **缺省仍是 `current`**（会话 cwd 的项目，向后兼容）；页面默认发 `scope=user`（见下一节）。
  响应新增 `scope`（回显实际作用域）/ `workspaces` / `workspacesAvailable` / `session`（与作用域无关的
  「当前会话实际会跑什么」条数口径；**三态**：`null` = 当前会话未知，页面必须说"无法判断"）。
  `effectiveUserGroups` / `effectiveProjectGroups` 是 `EventView.fromUser` / `fromProject` 的**合并输入**
  （取自 `configFor()` 参与合并的那两份，**不是"新鲜读"**）—— 客户端不消费它们，但离线断言与排查要看
  "用户级贡献几条、项目级贡献几条"：`fromUser + fromProject === hookCount` 是必须成立的不变式
  （stale 沿用 last-good 时同样成立），写在响应里比藏在内部变量里可核对。
- `POST /api/hooks` 四种意图，**全部是定点操作**（客户端**绝不回传整份文件**，那会静默丢字段）：
  - **定点写**：`{op:'setHookCommand'|'setHookTimeout'|'setHookDisabled'|'setGroupMatcher'|'addHook'|'addGroup'|'removeHook'|'moveHook'|'removeGroup'|'createFile', file, workspaceId?, event, groupIndex, hookIndex, …}`。
    机制是**克隆整份 JSON 树 + 只改目标节点 + 保留性证明**，未知键（例如第一行的 `_comment`）
    在结构上不可能丢；写盘带**版本锁**（存在用 `replaceIfVersion`、不存在用 `createIfAbsent`）。
    `addGroup` 是"＋新建"用的那个 op：事件数组不存在时**创建**它；文件不存在时用 `createIfAbsent`
    写一份含该 hook 的骨架（竞态时 provider 报 `exists`，如实拒写并提示刷新）。
  - **作用域**：`file:'project'` + `workspaceId` ⇒ 目标 = `root(workspaceId)/.dsh/hooks.json`；
    它在宿主清单里查不到 ⇒ **拒写 `unknown-workspace`，绝不回落会话项目**（回落 = 静默改错文件）。
    `file:'project'` 不带 `workspaceId` = 现状语义（会话 cwd 的项目）；`file:'user'` 带 `workspaceId` = 400。
  - **试运行**：`{op:'dryRun', file, workspaceId?, event, groupIndex, hookIndex}` —— 与真实运行**共用同一条执行
    路径**（同一个 `runSingleHook`、同一个 payload builder），但**不写执行台账**（预演不该给状态上色）。
  - **错误码分得很细**，页面据此把失败**分别**说清（这是硬要求，不许糊成一句"保存失败"）：
    `stale` / `exists` / `not-preservable` / `invalid-json` / `no-project` / `no-version` /
    **`no-workspace-registry`** → 409；`absent` / `not-found` / **`unknown-workspace`** → 404；
    `sandbox` → 403；`bad-op` / `bad-json` → 400。
- 寻址一律用**文件下标**（`rawIndex`）：解析会跳过 matcher 非法的 group 与没有 command 的条目，
  拿"解析后的数组位置"去找 = 静默改错/跑错那一行。越界一律拒（`not-found`）。
- 快照的硬不变式：**7 个事件永远全列**（含 0 条）、**两份文件永远都列**、`disabled` 单独计数
  （生效条数不含它）、`staleInUse` 如实反映"文件坏了但运行中的还是上一份可用配置"、
  `fromUser + fromProject === hookCount`（**stale 时也成立**：两个数字取自 `configFor()` 参与合并的
  那两份，而不是"新鲜读"—— 否则页面会显示"生效 5 条（用户级 0 + 项目级 0）"）。
- `capabilities.writable` 是 **`true`**（路由注册了 POST）；为 `false` 时页面显示只读提示行，
  而不是让用户点了没反应。
- **每行还带执行证据**：`lastRun`（真实的 `exitCode` / `decision` / 耗时 / 输出）与 `runCount`。
  匹配条件是 **`event + command + projectRoot` 三者都要** —— 命令改过之后旧记录不再匹配，行退回灰
  "未运行"；**同一条命令在别的项目跑过也不会给这里的行上色**（否则切工作区就会看到别的项目的绿点）。
  台账有界（全局 500 / 单会话 200），输出截断后才进快照。
- **没有会话上下文**时 `cwd` / `projectRoot` 一律是 `null` 并标注来源（`cwdSource`），
  **不拿 `process.cwd()` 顶上**。
- 当前载体没有 `connection` 服务（如 shell 载体）时不注册数据面，但 **hooks 照常工作**。
- 离线自检覆盖：注册契约（路径 / 方法 / `requestBody`）+ handler 行为（直接用
  `new Request('http://127.0.0.1/api/hooks')` 调 handler），见 `tools/verify.ts` 的 `P` 区。

## 设置页「Hooks」（`settings.section`，`order: 920`）

浏览器半边（`src/client/**` → `lib/client.js`）注册在设置导航里，排在 MCP（900）、Skills（910）之后：

- **一张卡 = 一条 hook**（v4：一屏只有两行）：左侧 28×28 槽位装**状态点**（颜色仍**只**来自执行台账与
  `disabled`）；标题 = **中文名 + 英文枚举**（后者 mono、11px、第三级色，`title` 里给触发时机与原文）+
  `已停用` / `不会运行` 两个标签（后者是 matcher 非法这个**例外态**）；第二行 = command（mono 省略号）；
  标题行末尾是**一个状态词**（`未运行` / `通过` / `失败` / `已阻断`，停用时为空 —— 标签已经说了）+
  启停开关 + **`⋯`**。**匹配范围 / 超时 / 三个动作（试运行 / 编辑 / 删除）全部收在 `⋯` 里**，
  默认一个都不渲染 —— 这是 v4 相对 v3 最大的改动（v3 有一行常驻 meta：`未运行  匹配 pwsh|bash
  默认 600 秒` + 三个 hover 才显形的动作按钮）。`exit N · 12ms` 这类技术串只在状态点的 `title` 里。
- **7 个事件的中文名**在 `src/client/labels.ts`（`EVENT_LABEL` / `EVENT_HINT`），卡片标题、折叠
  事件行、新建表单的事件下拉三处共用。**名字的出处**：官方中文 README
  `@deepseek-ai/dsh-hooks-claude-code/README.zh.md` 的「运行时机」一列（`agent 收到提示词时`、
  `工具运行前`…）逐字用作 `EVENT_HINT`；`@deepseek-ai/dsh-hooks-codex/README.zh.md` 里
  「会话开始、提示词提交、工具执行前后以及停止」是官方中文里最接近"事件名"的一处用词 ——
  `EVENT_LABEL`（会话开始 / 提示词提交 / 工具运行前 / 工具运行后 / 停止 / 子代理启动 / 子代理结束）
  由它名词化而来。官方 locale 里**没有**这 7 个事件的名词式中文名（全 asar 中含 CJK 且含
  `PreToolUse` 的文件只有 3 个中文 README，都是描述句）。放在客户端新模块而不是
  `src/shared/constants.ts`：后者属于宿主半边，改它要重建 `lib/index.js` ⇒ 用户得重启 DSH
  （§1.2/§1.3），而本轮是纯呈现层改动。
- **工具条只有一行**（v3）：左边作用域选择器、右边 `↻ 刷新` / `＋ 新建`。`钩子 N` chip 删了
  （它夹在下拉与搜索框之间，破坏分组），**搜索框只在 `fileTotal >= 5` 时渲染**（1 条 hook 的页面上
  它是纯噪音）。条数下移到第二行**一句人话**：`N 个 hook`，有停用时追加 `其中 M 个已停用`，
  筛选时换成 `匹配 K / 共 N`；「本会话生效 X 个」**只在**它和屏幕上这一份不是同一件事时出现
  （作用域 ≠ 当前会话项目，或会话未知），`（用户级 a + 项目级 b）` 移进诊断折叠 ——
  过去同一屏把条数说了 5 遍（`钩子 1` / `已安装 1` / `（用户级 0 + 项目级 1）` / `0 条` / `1 条`），
  这正是用户说的"冗余内容很多"。
- **提示最多一条**，且正常态**一条都没有**：页面级错误 > 配置文件读不出来 > 非当前工作区 >
  只读，四者互斥。**非当前工作区那条是中性信息行**（无底色、次要色文字 + ghost 动作
  `切回当前会话项目`，仅当目标 ≠ 当前作用域时出现）：`本会话不读这份配置 —— 改动只影响以后在
  X 里打开的会话。` —— 不再带绝对路径、不再写「报 sandbox 属预期」。被删掉的两条事实落进
  **诊断折叠**：`项目根` 一行仍在，另加 `写入权限` =「按调用会话的沙箱策略判定；被拒绝时报
  sandbox」。顺带修掉一个隐性 bug：过去那条黄底横幅的底色其实来自**不存在的 token**
  （`state-warning-background` 官方 0 定义 ⇒ 走 fallback，实测 `#453d27`），已换成真实 token。
- **另一个来源**（用户级 / 项目级里不是主文件的那一份）**只在"有东西"时出现**：
  `file.hookCount > 0 || file.state === 'error'`。有内容 → `用户级（全局）还有 2 个 hook` +
  ghost `切过去`（目标 ≠ 当前作用域时才出现）；读不出来 → `用户级（全局）这份配置读不出来
  （详情见诊断）`。**两种情形正文里都没有盘符路径**（路径 / 状态 / 版本都在诊断折叠里）——
  过去是"为空也占一行 + 暴露 `C:\...` + 教用户用界面"，三件事一起犯。
- **底部只有一个折叠区**（默认收起）：`更多`。展开后先是 7 个事件（含 0 条），再是诊断（项目根 /
  cwd 来源 / 文件路径·状态·版本 / `写入权限` / `staleInUse` / matcher 诊断 / 被跳过的 handler /
  工作区清单 / 工作区路径≠项目根 / 作用域语义那句话）。折叠里的 7 行
  **行高固定 32px**、`没有配置` 是次要色、有内容的行为 `N 个`，右侧是 **`＋` 字形按钮**
  （24×24、`title` = `在 X 下新建`、`aria-label` = 中文名 + 英文原文，Tab 可达）—— 过去是 7 个
  「＋新建」文字按钮，用户的原话是"噪音"。折叠区**只画分隔线**
  （`border-bottom:.5px solid var(--dsw-alias-border-l2)`，官方 `settings-general` 的行式条目就是
  这套），不加底色、不加圆角 —— 卡片语言与分隔线语言不混在同一层。
  **v3 是两个并列开关**（`查看全部事件（7）` / `诊断`）："诊断"两个字挂在每一屏上，正是用户说的
  "非要使用一堆说明和检测"。合并只改渲染点，**一条事实都没删**（D 区断言逐条守着可达性）。
- **主列表为空时渲染「空状态块」**（真机那一屏就是它：默认作用域 = 用户（全局），而
  `~/.dsh/hooks.json` 从来没建过）：标题「这个作用域还没有 hook」+ **一句**副文案
  （文件不存在 = 「这份 hooks.json 还不存在 —— 这是空的，不是出错。」；文件在但 0 条 =
  「文件里还没有任何 hook。」）+ **一行**按钮（主按钮 `＋ 新建第一条 hook` + **仅**文件不存在时的
  次按钮 `新建配置文件`）。**第三种情形**——文件读不出来——如实说「无法判断里面有没有 hook」，
  **绝不**冒充"空的"（AGENTS §2.9 那条最危险的失效路径）。
  v4 把 v3 的五行（标题 / 副文案 / **路径** / 按钮 / 单独一行的引导条）压成三行：路径只留在
  `新建配置文件` 按钮的 `title` 与 `更多` 折叠里，引导条变成按钮行里那个 `切换过去`。
- **空状态块里的引导**（真机那一屏的关键）：用户默认落在空空的**用户级**上，而真正有内容的是
  「当前会话项目」。所以只要另一处有 hook 就给一个 `切换过去` 按钮，**证据（`当前会话项目
  （dsh-hooks）里有 1 个 hook。`）在它的 `title` 里**（v3 是单独一行字）。点它就把作用域换过去；
  反方向同样成立：项目级为空而用户级有内容时引导回「用户（全局）」。证据只用宿主给的
  `session.fromProject` / 用户级文件视图 —— **会话未知时不给引导**，不编一个"也许有"。
- **描边按钮只允许出现在工具条**（`↻ 刷新` / `＋ 新建`，即 `__toolbtn`）。内容区（卡片动作 /
  折叠事件行 / 空状态 / 表单）一律是 `__btn` 的 ghost 文字按钮（次要色，hover 才转主色），
  表单提交与空状态主按钮是填充的 primary。真机上"展开的 7 个事件行各挂一个描边小按钮"正是
  用户说的"乱"；自检里有机器断言：**折叠收起时全页 `__btn--outline` 计数必须是 0**。
- `.dsh-hooks` 有 `max-width:720px`（与同目录 `dsh-skill-manager` 的基准一致）：宽窗口 / 独立
  渲染时卡片不该被拉满。**设置面板内容区真宽 = 564px**（`panel 800 / 导航 188 / 内容
  padding:0 24px 24px`，由 `hooks-fidelity` 在真机截图上逐像素量出）—— 以后做离线预览/自查
  都要按 **564px** 渲染：上一轮按 660px 做的预览"看着对、真机不对"，根因就在这里。
  作用域 popover 有 `max-height:320px` + `overflow-y:auto` + `overscroll-behavior:contain`
  （工作区 8+ 个时在**自己内部**滚动，滚到底也不会把滚动传给底下的页面）。
- **删除是两步**：点"删除"只变成"确认删除 / 取消"，**第一步不发请求**（它是唯一丢数据的操作）。
- 错误**只有一个渲染点**：行内操作（启停 / 编辑 / 删除 / 试运行）的失败进**页面级提示行**，
  新建表单的失败只留在**表单内部**（表单里有独立的错误行）。两条通道不许互相写。
- **会话上下文从 root kit 拿**：`settings.section` 是 root scope 座位，页组件拿到的是 standard kit ——
  用 `props.useSessions(findMainSessionId)` 取当前会话 id（判据与官方 `CordisPanel`、同目录
  `dsh-skill-manager` 同一份：会话快照里 `retainedBy.mainView > 0` 的那一行），并把它并进
  **GET 与写请求的 query**（宿主从 URL 取，见 `data-plane.ts`）。没有 root kit 时用 no-op 替身，
  **不做条件式 hook 调用**（两条路径的 hook 位完全相同）。缺了它宿主只能问 `currentInitiator()`，
  而设置页里根本拿不到 → 整页"当前会话未知"、项目根解析不出来。
- 写入成功后**重新取数**，绝不在本地猜新状态（那会和宿主的答案漂移）。
- 样式：CSS 字符串 + 组件渲染 `<style>` 元素（官方 `ui-plugin.md` 认可的写法）；颜色一律走
  `var(--dsw-alias-*)` token，**绝不硬编码**。统一尺度：控件 **28px** 高、字号 **12/13px**、
  卡圆角 **`var(--dsw-radius-xl)` = 20px**、控件圆角 **6px**、区块间距只用 **12/16 两档**、
  命令一律等宽。自检里有一条**白名单**：样式里出现的每个 `--dsw-*` 都必须在官方 theme 表里
  核对过（否则真机只会走 fallback —— 见下一条）。
- **卡片 = 官方卡片配方**（`agent-preset` / `settings-models` / `settings-plugin-inventory`
  三个官方包是同一套原文）：
  `border:.5px solid var(--dsw-alias-settings-card-stroke)` +
  `background:var(--dsw-alias-settings-card-fill)` + `border-radius:var(--dsw-radius-xl)`。
  ⚠️ **上一轮记在这里的那条"有意偏离：卡无描边（靠 fill 分层）"已撤销**，因为它建立在错误的
  预览上：真机上 `settings-card-fill` 解析成 `bg-layer-2` = **与设置面板底色逐位相同**
  （`#2c2c2e`，ΔRGB 0）⇒ 去掉描边之后卡片**什么都没画**（这正是"看不见的卡 / 整体风格乱"的
  根因之一）；而 `settings-card-stroke` = `border-l4` = `#fff3` 叠上去 = `#565658`（ΔRGB 126）。
  证据来自 `hooks-fidelity` 的逐像素 token 事实表，不是审美判断。**别再把它"优化"掉**：
  `D36` 会在 `.dsh-hooks__hookcard` / `__empty` / `__newform` 三条规则上查 stroke + fill + radius。
- **token 名字以官方 theme 表为准，不许"看着像就写"**：官方警告族写作 `state-warn-*`
  （不是 `state-warning-*`）、成功族写作 `state-success-*`（不是 `state-ok-*`）、按下态是
  `interactive-bg-active`（不是 `interactive-bg-pressed`）；错误**没有** `background` 变体，
  底色照官方 `Tag[data-tone=danger]` 的 `color-mix(in srgb, var(--dsw-alias-state-error-primary)
  10%, transparent)` 写。判据文件：asar 里 `@deepseek-ai/dsh-client-ui-theme/lib/client.js` 的
  `base_css_default`（第 1142 行，亮/暗两套）。本轮修掉了 4 个**零定义**的 token
  （`state-warning-primary` / `state-warning-background` / `state-error-background` /
  `state-success-background`）—— 它们在真机上永远走 fallback；`D36` 有否定断言守着它们不回来。
- **页面上不许出现 markdown 语法**（`**x**` / 反引号 / `##`）—— 要强调就用 `<strong>`。
  真机截图里出现过字面的 `**agent-go**`（把 JSX 当 markdown 写了）；自检的渲染护栏对**每一个**
  文本节点做这项检查，任何场景漏了都当场红（而且护栏本身也有断言，不是空的）。
- 导航图标用官方兜底齿轮：座位注册的字段白名单里**没有 `icon`**，不要学"打 data 属性 + CSS 覆盖"
  那条路（依赖官方 DOM 结构，一改就静默失效）。
- **首次出现需要重启一次 DSH**（`dsh-client-modules` 在启动时扫描 `exports["./client"]`）；
  之后改 UI 不需要重启（客户端半边构建后由客户端 HMR 替换；免刷新需要 `pnpm run dev:web` 在跑）。

### 排版预览（`.tmp/section-preview.html`，**不进版本库**）

`node .tmp/make-preview.mjs` 用**真实组件**（`lib/client.js` 产物）+ **真实 styles** 生成一份离线
HTML（双击就能看），并写进 6 屏。这里修的是**验收方法本身的缺陷**：用户拿真机截图说"和预览还是有
差异性"，根因是旧预览**全窗口宽**。现在每一屏都装在一个模拟设置面板里，另有一屏放到 1024px 验证
`.dsh-hooks { max-width:720px }`。

⚠️ **模拟面板的宽度必须是 564px，不是 660/612**（`hooks-fidelity` 在真机截图上逐像素量出：
`panel 800 / 导航 188 / 内容 padding:0 24px 24px` ⇒ 内容区 **564px**）。本节历史上写的 660px 是
**旧预览那个错的取值** —— 按它渲染出来的换行位置全是错的，这正是"预览看着对、真机不对"的另一半
根因。以后做任何离线预览 / 自查截图，一律按 **564px** 渲染。

生成器带**结构性自检**，防的是"预览自己加 CSS 把组件修好看，于是预览永远漂亮、真机永远不对"：

1. `<style id="dsh-hooks-styles">` 的内容必须**逐字节等于** `src/client/styles.ts` 的 `styles`；
2. 其它 `<style>` 块（预览外壳：token fallback + 面板标题/分隔线）里**一个 `.dsh-hooks` 选择器
   都不许有**，选择器还必须在白名单内；全页 `<style>` 块**恰好两个**（挡"往面板 HTML 里再塞一个"）；
3. 模拟面板必须真的是 **564px** + `padding:0 24px 24px`；面板**恰好 6 个**，且必须包含真机那一屏
   （用户（全局）+ 文件不存在 + 项目级 1 条，折叠收起）与它的展开态。

还带**面板自洽自检**（task-6 的 F2：预览不许骗看的人）。旧预览每一屏都是"组件本地 state = user、
fixture 却是项目级"的混合体，于是触发器与内容互相打脸。现在：

- **fixture 按 query 里的 `scope` 回答**（真宿主就是这样：回显 / `files` / `session` 全按它推），
  想展示哪一份就**真的去点那个下拉项**把组件状态驱动过去 —— 与真人操作同一条路；
- 每个面板渲染出的**触发器 label 必须等于该面板 scope 回显对应的 label**，popover 开着的面板还要
  **勾选唯一且落在回显那一项**上；另外 fixture 自身不许自相矛盾（`session` 未知却声称
  "已知不是当前会话"、回显是 user 却带项目级文件……）；
- 还有一个**隐藏面板**（不进 HTML）：本地 state 被点成 `current`、宿主却把它归一化成 `user` ——
  这正是"label 说谎"那个 bug 的精确形状，只要 label 还敢跟本地 state 走这条就红。

自检**不许空转**：生成完先拿 6 份**故意违规**的 HTML + 2 份**故意不自洽**的面板 + 2 份**故意
自相矛盾**的 fixture 试一遍（多一条预览专用 CSS / 改我们的样式块 / 混进白名单外的选择器 /
偷塞没有 id 的 `<style>` / 少一个面板 / 去掉面板宽度（**564px**）/ label 与回显不符 / 勾选与回显不符 /
会话未知却说不是当前会话 / user 回显带项目级文件），必须全部被拒绝，否则直接退码 1 ——
这些"证明自检不是空的"的检查本身都做过反向验证。

### ⚠️ 对 AGENTS §3.6 的一处**有意偏离**（7 个事件不再永远全渲染）

§3.6 要求"7 个事件分组永远全部渲染（含 0 条）"。本轮按用户明确要求改成：**主列表只显示有内容的
事件**（0 条不占一屏），全部 7 个事件收进底部**默认折叠**的 `更多`（v3 时是 `查看全部事件（7）`）。

- 理由：一屏 7 行里通常 5 行是"没有配置"，用户读到的全是噪音（原话"冗余内容很多"）；
- 代价与补偿：**默认不动手看不到"空"**。所以折叠里**永远**列全 7 个事件（含 0 条、明说"没有配置"、
  并给出该事件的 `＋` 字形按钮）—— "空"没有变得**不可达**，只是不再默认占一屏；
- 自检两半都断言：折叠收起时主列表**不含** 0 条事件；展开后**恰好 7 行**、含 0 条、含"没有配置"。

### v4：把"说明和检测"从首屏撤下来（默认不占屏，一键可达）

用户拿另一个产品的钩子页做参照问："为什么不能简洁面向用户使用，非要使用一堆说明和检测？"
v4 只改**渲染点**，**一条判据都没删**：

```
作用域 [ 当前会话项目（dsh-hooks） ▾ ]                [↻ 刷新]  [＋ 新建]
3 个 hook · 其中 1 个已停用
●  工具运行前 PreToolUse                    未运行            [ ●—— ]  ⋯
   node -e const fs=require('node:fs')…
●  工具运行后 PostToolUse                   通过              [ ●—— ]  ⋯
   pnpm prettier --write
▸ 更多
```

点开某一条的 `⋯` 之后（**只有这时**才多出这一块）：

```
   匹配 pwsh|bash · 默认 600 秒              试运行   编辑   删除
```

| v3 在首屏的东西 | v4 挪到哪 |
|---|---|
| 卡片第二行 `未运行   匹配 pwsh\|bash   默认 600 秒` | 正文只留**一个状态词**；匹配 / 超时进 `⋯` |
| `exit 0 · 12ms`（"这条慢不慢"的证据） | 状态点的 `title` |
| 试运行 / 编辑 / 删除（hover 才显形） | `⋯` 里（默认不渲染；展开后立刻可见，不再靠 hover） |
| 底部 `诊断` 开关（"检测"两个字挂在每一屏） | 与 7 个事件合并成一个 `更多` |
| 空状态块的**路径行** + 单独一行的引导条 | `新建配置文件` 按钮的 `title` + 按钮行里的 `切换过去` |

- **不许砍的三样**：状态点（颜色必须有正面证据，§3.8）、**一个状态词**（色觉障碍与纯文本渲染
  拿到的唯一答案）、`已停用` / `不会运行` 标签（"这条根本不会跑"必须看得见；matcher 非法是
  **例外态**，例外允许占地方）。
- **本来就不在屏幕上的检测，v4 一个都没动**：三态（`absent`/`ok`/`error`）+ fail-open 的
  last-good（§2.9）、定点写 + 保留性证明（§2.4）、版本锁（§2.3）、会话沙箱策略透传（§1.6）、
  执行台账（§2.11）、matcher 非法只跳过该组（§2.7）。"简洁"治的是**渲染点**，不是判据。
- **新建不再是"手写 node -e"**：表单第一行是三个模板（`src/client/templates.ts`）——
  `注入提醒`（SessionStart 注入一句 `additionalContext`）、`记到日志`（把 stdin 追加到
  `<projectRoot>/.dsh/hook.log`）、`直接拦住`（PreToolUse 结构化 `deny`）。模板只**填**四个字段，
  命令明文可见可改（不做黑盒预设）。命令的引号形态（外层双引号、内层单引号、不用 `$`）是
  **实测**出来的 —— 见下面的反向验证 ③。
- **新断言**：`D41` 数首屏"不许出现"的字（`匹配` / `秒` / `exit ` / `ms` / `诊断` / `项目根` /
  `cwd 来源` / `版本`）+ 每张卡的元件计数 + 点开 `⋯` 与 `更多` 之后事实**仍然可达**；`D42` 断言
  模板真的把字段填好、提交的 `addGroup` 逐字段等于模板、三个中文标签在**产物** `lib/client.js`
  里（§4.8）；P 区用**真子进程**把三条模板各跑一遍（exit 0 / `decision=deny` / 真的落盘
  `.dsh/hook.log`）。
- **反向验证**（§4.3，五条都做过，还原后复跑全绿）：① 把 `匹配 · 超时` 挪回首屏 → D41 精确报
  「首屏不许出现「匹配」」；② 把路径放回空状态 → D23 / D40 等三条红；③ 模板命令改成外层单引号 →
  D42 静态断言红，**并且 P 区真子进程给出 `exit 1` + node 的 `[eval]:1` 语法错**（引号形态不是
  审美，是能不能跑）；④ 把 deny 模板的 `permissionDecision` 改成 `allow` → P 区
  「必须真的被判成 deny」红；⑤ 把 `⋯` 改成永远展开 → D41 / D33 / D25 等五条红。
- **`C` 区的一条判据被收紧了**："产物里只允许一个 `require`"现在**先去掉字符串字面量**再数 ——
  模板命令里那个 `require('node:fs')` 是**数据**（交给子进程的 shell 命令），不是产物的模块依赖；
  不去掉就会变成"因为模板里出现了 require 这个词"而红的**平凡误报**。去掉字符串之后判据不变
  （仍然恰好一个取 `react` 种子），而且这条判据本身做了双向断言（代码里的两个都数到、字符串里的
  一个都不数）。真正的第二个模块依赖更早就被拦住：esbuild 直接构建失败（`node:fs` 在浏览器
  target 下解析不了）。

## 设置页「Hooks」的作用域选择器（`用户` / 各工作区）

页面顶层就是参考图那个形态（v4：**工具条一行** + 一句人话 + **一条卡两行**；内容区实际宽 **564px**）：

```
作用域 [ 当前会话项目（dsh-hooks） ▾ ]                [↻ 刷新]  [＋ 新建]
1 个 hook · 其中 1 个已停用                              本会话生效 4 个
●  工具运行前 PreToolUse                    未运行            [ ●—— ]  ⋯
   node -e const fs=require('node:fs')…
▸ 更多
```

**默认作用域是「用户（全局）」**，而它很可能是空的（`~/.dsh/hooks.json` 没建过）—— 那一屏长这样
（用户真机截图就是它；卡片一个都没有）：

```
作用域 [ 用户（全局） ▾ ]                            [↻ 刷新]  [＋ 新建]
0 个 hook                                                本会话生效 1 个
┌──────────────────────────────────────────────────────────────┐
│ 这个作用域还没有 hook                                          │
│ 这份 hooks.json 还不存在 —— 这是空的，不是出错。                │
│ [＋ 新建第一条 hook]  新建配置文件  切换过去                    │
└──────────────────────────────────────────────────────────────┘
▸ 更多
```

v4 把 v3 那块五行空状态压成三行：**路径不再上屏**（进「新建配置文件」的 `title` 与 `更多`），
引导也从"单独一行字"变成按钮行里的 `切换过去`（证据 `当前会话项目（dsh-hooks）里有 1 个 hook。`
进它的 `title`）。没有这条引导，用户看到的就只是"这个作用域还没有 hook"然后自己猜 —— 而真正有
内容的是**当前会话项目**。展开 `更多` 时，7 行事件是 32px 的等距表、右侧是 `＋` 字形按钮
（无描边、有 `title` / `aria-label`，见上面的"描边按钮只允许出现在工具条"），紧随其后就是诊断行。

**作用域只决定"页面读哪份文件、写哪份文件"，它不改变运行时。** hook 仍然按**触发事件的会话**的
cwd → 最近 `.git` 祖先解析，用户级永远参与合并（用户级在前、项目级在后，顺序即执行顺序）。
页面在三个地方把这件事说清楚（**不再各占一行横幅**）：作用域选择器的触发器（label + `title`）、
那条**最多一条**的提示行、以及 `诊断` 折叠里的"作用域"一行：

| 选中的作用域 | 页面怎么说 |
|---|---|
| `用户（全局）`（**默认**） | 触发器 label 就是「用户（全局）」；完整那句「用户级配置对所有项目生效；每个项目还会叠加它自己的项目级配置」在触发器的 `title` 与诊断折叠里 |
| 当前会话所在的项目/工作区 | 触发器 `title`：「当前会话就在这个项目（项目根 …），改动对之后的调用立即生效」 |
| 别的工作区 | **一条中性信息行**（无底色、次要色文字）：「本会话不读这份配置 —— 改动只影响以后在 X 里打开的会话。」+ ghost 动作 `切回当前会话项目`（仅当目标 ≠ 当前作用域）。项目根与"写入按调用会话的沙箱策略判定"两句进**诊断折叠**（`项目根` / `写入权限`），不再出现在正文里 |
| 会话上下文拿不到 | 「当前会话未知，无法判断它是不是当前会话的项目」—— **不编造**一个"当前项目" |

- **"当前是哪一份"只有一个真源：宿主回显**（`snapshot.scope`，见 `section.tsx` 的 `echoedScopeOf`）。
  触发器的 label、popover 的勾选（`✓` / `aria-selected`）、以及**每一个写 / 试运行请求的落点**都从回显
  推导；本地 `scope` state 只表示"我发起了什么请求"。这条是 AGENTS §2.6 的落地，也是踩过的坑：
  label 曾经用本地 state（初始 `'user'`），于是同一屏出现"触发器写着用户（全局）、卡片却是项目级的、
  横幅说你在改 agent-go、底部摘要让你切到「用户（全局）」"——预览与真机都被抓到过。
  宿主把 `scope=current` **归一化**成 `user`（没有会话上下文 / 会话项目解析不出来）时，页面显示
  「用户（全局）」，写请求也落到**用户级**那一份（不许"看着用户级、写到项目级"）。
- **切换动作只在"目标 ≠ 当前"时出现**：「另一个来源」那一行的 ghost `切过去`、非当前工作区那行的
  `切回当前会话项目`、空状态块的 `切换过去`，三处共用同一个判据（`wantSwitchTo`：目标值 ≠ 宿主
  回显的作用域）。回显就是用户级时，绝不会再出现「要编辑请把作用域切到「用户（全局）」」这种
  **自己指自己**的话（真机截图里出现过，用户会以为页面坏了）。

- **默认作用域 = 用户**；`GET /api/hooks` 的 `scope` 缺省仍是 `current`（老客户端不受影响）。
- 下拉框是**自绘 popover**（不是原生 `<select>`）：分组「用户」/「工作区」、当前项右侧打勾、
  `role="listbox"`/`option`、Enter/Space 打开、↑↓ 移动、Enter 选中、Esc 关闭、点外部关闭
  （用一个铺满屏幕的透明背板，不用 `document` 监听器 —— 那在离线渲染测试里不存在）。
  选项 = 「用户（全局）」+（会话项目不在工作区清单里时）**「当前会话项目（<目录名>）」** + 各工作区。
  最后那个不是工作区，而是**按会话 cwd 解析**的项目（`scope=current`，请求里**不带** `workspaceId`）——
  否则"正在开发的这个项目恰好不在 `workspaceRegistry` 里"时，用户在新页面上改不到它的
  `.dsh/hooks.json`（旧页面本有这个能力，不能丢）。
- 宿主没有提供工作区清单时在**诊断折叠**里明说「宿主没有提供工作区清单，只能改当前项目和用户级配置」，
  popover 里也不会出现工作区分组 —— **不渲染成一个会骗人的空下拉**；清单为空则诊断里报 `0 项`。
  **空 ≠ 不存在**，两者文案不同。
- **取数失败不是死胡同**：失败提示下面有「↻ 重试」和「回到用户级配置」两个控件（后者在
  `unknown-workspace` / `no-workspace-registry` 时突出显示）—— 选中的作用域被删掉时不必整页刷新。
- **工作区路径 ≠ 项目根**：`projectRoot` 是最近含 `.git` 的祖先。两者不同（工作区是仓库子目录）时
  诊断折叠里会分别列出，否则用户会问"我改的是 A，为什么落到 B/.dsh/hooks.json"。
- **每次读 / 写 / 试运行都带被选中的作用域 + 会话 id**：作用域 → 请求体由**唯一**构造函数
  （`src/client/write.ts` 的 `intentFor` / `dryRunFor`）产出；`sessionId` 走 query。宿主侧查不到那个
  工作区就**拒写** `unknown-workspace`（404）并提示刷新，**绝不回落**到会话项目 —— 回落就是
  "看着 A 项目、改到 B 项目"，而且是静默的。宿主没有清单则是 `no-workspace-registry`（409）。
- **条数口径**（v3 收成**一句人话**，同一个数不再说五遍）：第二行 `N 个 hook` = 当前作用域
  **文件里**的 hook 总条数（**含**已停用）；有停用时追加 `其中 M 个已停用`（启用中条数 = N - M
  仍然算得出来）；筛选时换成 `匹配 K / 共 N`。`钩子 N` / `已安装 N` 两个 chip 已经删掉。
- 第二行右边还有一句「**当前会话实际会跑的是什么**」：`本会话生效 X 个` —— 它按的是运行时会话，
  与所选作用域无关，**只在**它和屏幕上这一份不是同一件事时出现（作用域 ≠ 当前会话项目，或会话
  未知）。完整口径 `当前会话生效 X 个（用户级 a + 项目级 b）` 在**诊断折叠**里；会话上下文拿不到时
  那句写「当前会话未知，无法判断实际会跑什么」，**绝不显示"生效 0 个"**（读不到 ≠ 没有）。
- **搜索框是纯前端过滤**：只过滤渲染，发出去的仍是文件里的**真实下标**；无结果说"没有匹配的 hook"
  （≠"没有配置"）。
- **「＋新建」** = 一次 `addGroup` 定点操作（事件 / matcher / command / timeout），文件不存在时宿主
  用 `createIfAbsent` 写一份含该 hook 的骨架；竞态（别人同时建了它）如实报 `exists` 并提示刷新。
  `UserPromptSubmit` / `Stop` 没有 matcher —— 表单在选中这两个事件时**不渲染** matcher 输入框。
- **开关**是 `<button role="switch" aria-checked>` + 样式表里的旋钮（不是原生 checkbox）：
  停用落在文件里的 `disabled: true`，执行层**真的跳过**它。
- **一条错误只允许一个渲染点**：行内操作（启停 / 编辑 / 删除 / 试运行）的失败进**页面级提示行**；
  新建表单的失败只留在**表单内部**（表单里有独立的错误行）。两条通道不许互相写。
- **改了工作区作用域后不重启也能生效的部分**：客户端半边（HMR）；**宿主半边要重启**
  （新增的 `workspaceRegistry` 读取与 `addGroup` 都是宿主侧代码）。当前会话的沙箱权限可能不允许写
  **别的工作区**的文件 —— 那会如实报 `sandbox`（403），不提权。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| hook 完全不跑 | 1) patch 行加了但**没重启**（最常见）；2) 项目根下有没有 `.git`（没有就用会话 cwd）；3) 配置是否在 `<projectRoot>/.dsh/hooks.json`；4) `node tools/verify.ts --config <该文件>` 看有没有被识别 |
| **matcher 写了外来工具名** | 用了 `Bash` / `PowerShell` 这类别的工具的名字 → 改成 DSH 的 `pwsh`（POSIX 是 `bash`） |
| **hook 跑了但什么都没拦住** | Windows 上多半是用了 `exit 2`，被 PowerShell 折叠成 1（见上文警告）→ 改用 JSON `permissionDecision: deny` + exit 0 |
| **hook 里"跑了但看不到效果"** | 先排除**观测手段**问题：写文件探针会随会话档位时灵时不灵，用它判定 hook 是否触发容易误判（见[写入边界](#hook-子进程的写入边界)）。改用 `permissionDecision` / `additionalContext` 这类协议出口 |
| 配置明明是对的却读不到 | 文件可能带 **UTF-8 BOM**（PowerShell `Set-Content -Encoding utf8` 的产物）。本插件会剥掉 BOM，但其它工具不一定 |
| 用了 `args` 但没生效 | DSH 的 hook 协议**只认 `command` 字符串，不认 `args`** → 把参数拼进 `command` |
| 日志里 `跳过不支持的 "xxx" handler` | 用了非 command handler（本插件只跑 command） |
| 日志里 `invalid regex matcher ...` | 该 group 的 matcher 不是合法正则，已跳过（其余 group 不受影响） |
| 日志里 `无可用 hook` | 文件读到了但没有任何可用事件组（只在事件集合变化时打，不会反复刷） |
| 日志里 `配置当前读不出来，继续沿用上一份可用配置` | **配置现在解析不了**（JSON 非法 / 顶层不是对象 / IO 失败）。hook 仍在按上一份可用配置跑，所以"改的配置不生效"很可能是文件本身写坏了。紧跟上面的 `读取 … 失败：…` 看具体原因 |
| 日志里 `读取 … 失败：…` 只出现一次 | 正常：同一条错误只告警一次；换成**另一处**错误会再告警一次 |
| 日志里 `ctx.fs 不提供 watch()` | 该 fs 服务没有 `watch()`：热重载退化成 4s TTL 兜底。每条路径只打一次 |
| 日志里 `已监听 <path>（判定为目录/文件/尚不存在）` | 正常挂载点。**"已监听" + "改了不生效"** = 挂了但没事件；**完全没有这条** = 没挂上（对照上一条） |
| 日志里 `监听到变化 → 失效配置缓存（<path>）` | 热重载真的触发了。同一条路径 1s 内不重复打 |
| 日志里 `无法监听 ...` | 路径还不存在或 `resolve`/`watch` 抛错；正/负结果都会按 4s / 2s TTL 自愈，不必重启 |
| 改了 hooks.json 没生效 | 正常应秒级热重载（watcher）/ 下一个事件点（版本核对）。用"改完只等 1s 再调用"可以把 watcher 与其它通道区分开；日志里出现 `配置当前读不出来，继续沿用上一份可用配置` 说明是**文件本身写坏了**，不是热重载没生效 |
| 项目**先开着**、后来才建 hooks.json | 支持：负结果有 2 秒过期，不需要重启 |
| hook 想写文件却被拒绝（`EPERM`） | v0.1.0 的老问题：hook 按**部署**档跑，只能写自己那次的私有 `%TEMP%\dsh-XXXXXX`。v0.2.0 起 hook 继承**会话**档位（`sandbox: <档位>`，见[写入边界](#hook-子进程的写入边界)）。仍被拒就先看档位：`read-only` 会话下 hook 与工具调用一样写不了；日志里 `sandbox=deployment` 说明没拿到 `ctx.sandboxPolicy` |
| 格式化 / 自动修复类 hook 没生效 | v0.1.0 会**静默**失效（退出码非 2、输出非 JSON ⇒ 按非阻断失败处理，动作照常放行）。升级到 v0.2.0 后 hook 按会话档跑即可落盘；仍不行就看该 hook 自己的 stderr |


## 发布（`npm pack` 会打进去什么）

**装载路线：路线 1「路径行」当前生效**（profile 直接指向 `lib/index.js` 的绝对路径）；
本包**同时**声明了路线 2 所需的 `dsh.bundle.patch`（→ `cordis.patch.yml`）供
`plugin_manager install_bundle` 使用。两条路是替代关系，切换步骤见上文「安装」——
**同一个 id 不许有两行**。

`files` 白名单是刻意收窄的。`npm pack --dry-run` 实测（`node .tmp/pack-scan.mjs`）打出来的是：

```
README.md   cordis.patch.yml   icon.svg   lib/.build-manifest.json   lib/client.js
lib/index.js   locale/en.json   locale/zh.json   package.json      # 9 个文件 / ~75 KiB（压缩后）
```

- **`lib/.types/**` 必须排除**：`lib/**` 会把 tsc 的中间产物一起带进包，它们既不在 `exports` 里
  （拿不到）、又会随手过期。这条有断言（`files` 必须含 `!lib/.types/**`）——`npm pack` 实测抓到的就是这个。
- **`src/` `tools/` `docs/` `AGENTS.md` `.tmp/` 一律不进包**（有断言）。
- **展示元数据**（官方 `dsh-app-boot` 的 `readPluginMeta` / `metaOf` 读，**不需要激活插件**）：
  - `icon` 是 **`package.json` 的顶层字段**（不是 `dsh.icon`）：相对包根、≤ 256 KiB、SVG/PNG/JPEG/WebP。
    官方源码里是 `iconOf(manifest?.icon, manifestPath)`。
  - `locale/en.json` 是**英文兜底**，其余语言必须与它**同目录**（官方按 `<包>/locale/en.json` 找，
    并且会因为"不在同一目录"直接抛错）。
  - `locale/*.json` **必须进 `exports`** —— 否则 subpath 解析被 `exports` 挡住，界面**静默**地不显示
    名字与图标（这是最容易漏、也最难发现的一条）。内容形如 `{"meta":{"title":…,"description":…}}`。
- **发布前扫密钥**：`node .tmp/pack-scan.mjs` 会扫 API key / GitHub token / 内网地址形状，并交叉核对
  "该进的进了、不该进的没进"（当前：干净 ✅）。
- **未决（需要你定）**：`private: true` 与 `license`。要发 npm 必须先摘掉 `private`；而 `license` 是
  法律声明，我不替你编 —— 你定了之后再把 `LICENSE` 加进 `files`。

## 实现约束（改代码前必读）

- **零 import**：本文件由 Loader 以 `file:///...` 绝对路径加载，裸模块说明符（`@deepseek-ai/*`）
  都在 `app.asar` 里，从磁盘路径解析不到。所以协议逻辑（matcher / codec / merge / runner）
  在 `src/host/**` 内自包含实现（由 esbuild 构建成单文件 `lib/index.js`），语义对齐 `@deepseek-ai/dsh-hook-protocol`。
- **零外来品牌字符串**：代码、注释、配置里不使用外部工具的品牌名。环境变量是本插件自己的
  `DSH_PROJECT_DIR` / `DSH_PLUGIN_ROOT`；注入上下文的 `source.kind` 是 `dsh-hooks`。
  唯一沿用外部命名的是 **wire 协议字段**（`hookSpecificOutput` / `permissionDecision` /
  `hookEventName` 等）与事件名（`PreToolUse` …）—— 它们是跨工具的数据格式，改了会让 hook 失效。
- **只用注入的 Service**：`ctx.shell`（跑 hook）、`ctx.fs`（读配置 + 监听）、`ctx.logger`。
  对应 `export const inject = ['shell', 'fs']`。
- **hook 必须继承调用会话的沙箱策略**：`ctx.shell` 的默认语义是"低层调用者回退到**部署**策略"，
  而部署策略的 `workspaceRoot` 是**宿主启动目录**——照默认跑，hook 连项目目录都写不了，
  落盘类 hook（格式化 / 自动修复 / 写日志）会**静默**失效。所以每次 hook 都要
  `ctx.get('sandboxPolicy').resolve({ session })` 并透传 `{ sandboxPolicy }`
  （与 `dsh-tool-pwsh` 的 `resolveSandboxPolicy(exec)` 同构）。
  用 `ctx.get` 而不是改 `inject`；拿不到/抛错就省略该字段回退部署策略。
- **cwd 不能只依赖 `exec.agent`**：`ToolExecutionInput.agent` 是**可选**字段。拿不到时
  退化到 `ctx.agents.currentInitiator()`；再拿不到才用 `process.cwd()`。少了这层兜底，
  `tools/*` 会静默地按 app 启动目录找配置，hook 永远不生效。
- **负结果必须有过期**：`fs.watch` 对尚不存在的路径不一定挂得上，所以"没有配置"的缓存
  带 `NEGATIVE_TTL_MS`(2s) 过期，否则"先开项目、后建 hooks.json"要等到重启。
- **「读不到」≠「没有」：解析失败必须保持上一份可用配置**（v0.2.1 修复）。
  读取配置分成**三态**：`absent`（文件不存在 = 合法的"这份配置是空的"）、`ok`（解析成功，
  同时刷新 last-good）、`error`（读到了但 JSON 非法 / 顶层不是对象 / IO 失败）。
  `error` 时**继续沿用最近一次成功解析的配置**，并在错误内容变化时 warn 一次
  （同一条错误跨重读不重复告警）、每次沿用打一条限流 info。
  **修之前的形态是危险的 fail-open**：`error` 被折叠成"没有配置"，于是 hooks.json 写坏一个
  字符（编辑器写一半、并发写、手改错一处）会让**全部** hook（含 `PreToolUse` deny 守卫）
  **静默消失**，而且文件一直是坏的就一直消失。三条对应断言见自检 `fail-open` 区。
  注意边界：**删除**配置文件仍然是合法的清空（`absent`），不会 fail-safe 回旧配置。
- **失效有三层通道（版本 → watcher → TTL）**，优先级从高到低：
  1. **版本核对（主通道，v0.2.1）**：每个事件点用 `ctx.fs.stat()` 的 `version`
     （真实值是 `dev:ino:size:mtimeNs:ctimeNs`）核对两个配置文件。**没变就复用缓存**
     （连 TTL 都不必等，省掉一次 `readText`）；**变了就立刻重读**——新配置在下一个事件点
     就生效，不用等 TTL。
  2. **watcher（加速器）**：`ctx.fs.watch()` 事件到达立即丢缓存，不等任何核对（实测 < 1s）。
  3. **TTL（兜底）**：provider **不返回 `version`** 或 `stat` 抛错时，退回"到期允许重读"的
     老语义 —— 正结果 `POSITIVE_TTL_MS`(4s)、负结果 `NEGATIVE_TTL_MS`(2s)。
     TTL **只是允许重读**，单次 hook 事件内不重复读（`contextFor()` 每个事件点只调一次 `configFor()`）。
  为什么保留 TTL 而不是删掉：版本通道依赖 provider 提供 `version`，这不是所有 provider 的
  义务；`stat` 也可能因 ACL 抖动失败。**任何一条通道静默失效，最坏也只是延迟 4 秒生效**，
  而不是"改了配置必须重启"。
- **静默早退是可诊断性的大敌**：`ctx.fs` 没有 `watch()` 时必须 warn 一次（带路径），
  挂载成功 / 失效回调也必须留痕，否则"没挂上"和"挂了没事件"在日志里无法区分。
  这些日志都做了限流（每路径一次 / 1s 窗口），不会在热路径刷屏。
- **所有监听器全程 try/catch**，任何失败都 delegate 给 `next()`，绝不让 hook 拖垮工具调用。
- **detached 运行**（SessionStart / Subagent*）被跟踪，dispose 时 abort + drain。

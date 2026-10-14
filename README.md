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

追加到 `%DSH_HOME%\profiles\<profile>\cordis.patch.yml`（本机是
`C:\Users\admin\.dsh\profiles\desktop\cordis.patch.yml`）：

```yaml
# --- 项目级 hooks ---
- insert:
    - id: dsh-hooks
      name: 'file:///D:/project/dsh-plugins/dsh-hooks/lib/index.js'
```

无 `config:` 段 —— 这是**路线 1「路径行」**装载：profile 直接指向 `lib/index.js` 的 `file://`
绝对路径，**不需要 pnpm install，不需要联网，也不需要 `dsh.bundle.patch`**。
（同目录的 `dsh-continue` 也用这条路；但 **`dsh-mcp-manager` 不是** —— 它走的是路线 2「bundle」，
即 `package.json` 里的 `dsh.bundle.patch` + 一个 `cordis.patch.yml`，由 `plugin_manager
install_bundle` 安装。两条路是**替代关系**，别把它们的字段混着抄。）

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
- `GET /api/hooks[?sessionId=…]` → `{ok:true, data:HooksSnapshot}`；失败 → `{ok:false, error, detail?}`，
  **没有 `data`**（页面必须先补空形状再解引用）。
- `POST /api/hooks` 三种意图，**全部是定点操作**（客户端**绝不回传整份文件**，那会静默丢字段）：
  - **定点写**：`{op:'setHookCommand'|'setHookTimeout'|'setHookDisabled'|'setGroupMatcher'|'addHook'|'removeHook'|'moveHook'|'removeGroup'|'createFile', file, event, groupIndex, hookIndex, …}`。
    机制是**克隆整份 JSON 树 + 只改目标节点 + 保留性证明**，未知键（例如第一行的 `_comment`）
    在结构上不可能丢；写盘带**版本锁**（存在用 `replaceIfVersion`、不存在用 `createIfAbsent`）。
  - **试运行**：`{op:'dryRun', file, event, groupIndex, hookIndex}` —— 与真实运行**共用同一条执行
    路径**（同一个 `runSingleHook`、同一个 payload builder），但**不写执行台账**（预演不该给状态上色）。
  - **错误码分得很细**，页面据此把失败**分别**说清（这是硬要求，不许糊成一句"保存失败"）：
    `stale` / `exists` / `not-preservable` / `invalid-json` / `no-project` / `no-version` → 409；
    `absent` / `not-found` → 404；`sandbox` → 403；`bad-op` / `bad-json` → 400。
- 寻址一律用**文件下标**（`rawIndex`）：解析会跳过 matcher 非法的 group 与没有 command 的条目，
  拿"解析后的数组位置"去找 = 静默改错/跑错那一行。越界一律拒（`not-found`）。
- 快照的硬不变式：**7 个事件永远全列**（含 0 条）、**两个来源永远都列**、`disabled` 单独计数
  （生效条数不含它）、`staleInUse` 如实反映"文件坏了但运行中的还是上一份可用配置"。
- `capabilities.writable` 是 **`true`**（路由注册了 POST）；为 `false` 时页面显示只读横幅，
  而不是让用户点了没反应。
- **每行还带执行证据**：`lastRun`（真实的 `exitCode` / `decision` / 耗时 / 输出）与 `runCount`。
  匹配条件是 **`event + command` 两者都要** —— 命令改过之后旧记录不再匹配，行退回灰"未运行"，
  **绝不会拿旧命令的结果给新命令画绿**。台账有界（全局 500 / 单会话 200），输出截断后才进快照。
- **没有会话上下文**时 `cwd` / `projectRoot` 一律是 `null` 并标注来源（`cwdSource`），
  **不拿 `process.cwd()` 顶上**。
- 当前载体没有 `connection` 服务（如 shell 载体）时不注册数据面，但 **hooks 照常工作**。
- 离线自检覆盖：注册契约（路径 / 方法 / `requestBody`）+ handler 行为（直接用
  `new Request('http://127.0.0.1/api/hooks')` 调 handler），见 `tools/verify.ts` 的 `P` 区。

## 设置页「Hooks」（`settings.section`，`order: 920`）

浏览器半边（`src/client/**` → `lib/client.js`）注册在设置导航里，排在 MCP（900）、Skills（910）之后：

- **两个来源永远都列**（项目级 / 用户级），含"文件不存在"与"读不出来"——「空」和「不存在」必须长得
  不一样，否则用户只能得出"这功能没做"，而**他的判断没错，是界面在撒谎**。
- **7 个事件分组永远全渲染**（含 0 条）。
- 每行：状态点（**只**来自执行台账与 `disabled`）+ 命令（等宽）+ 超时 + 四个动作
  **试运行 / 编辑 / 停用（启用）/ 删除**。
- **删除是两步**：点"删除"只变成"确认删除 / 取消"，**第一步不发请求**（它是唯一丢数据的操作）。
- 错误**只有一个渲染点**：行内操作（启停 / 编辑 / 删除 / 试运行）的失败写进**页面级**横幅，
  表单内的错误留在表单里。
- 写入成功后**重新取数**，绝不在本地猜新状态（那会和宿主的答案漂移）。
- 样式：CSS 字符串 + 组件渲染 `<style>` 元素（官方 `ui-plugin.md` 认可的写法）；颜色一律走
  `var(--dsw-alias-*)` token，**绝不硬编码**（深色主题下 `--dsw-alias-brand-primary` 近白色，
  写 `#fff` 就是白底白字）。
- 导航图标用官方兜底齿轮：座位注册的字段白名单里**没有 `icon`**，不要学"打 data 属性 + CSS 覆盖"
  那条路（依赖官方 DOM 结构，一改就静默失效）。
- **首次出现需要重启一次 DSH**（`dsh-client-modules` 在启动时扫描 `exports["./client"]`）；
  之后改 UI 不需要重启（客户端半边构建后由客户端 HMR 替换）。

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

**装载路线：路线 1「路径行」** —— profile 直接指向 `lib/index.js` 的绝对路径。本包**没有**声明
`dsh.bundle.patch`，也不走 `install_bundle`（两条路是替代关系，见上文「安装」）。

`files` 白名单是刻意收窄的。`npm pack --dry-run` 实测（`node .tmp/pack-scan.mjs`）打出来的是：

```
README.md   icon.svg   lib/.build-manifest.json   lib/client.js   lib/index.js
locale/en.json   locale/zh.json   package.json            # 8 个文件 / ~128 KiB
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

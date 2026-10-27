# 完成情况（18 张 ticket）

自检：`node tools/verify.ts` → **202 passed / 0 failed**（改动前 172）。`pnpm typecheck` 与 `pnpm lint` 均干净；
`pnpm build` 幂等（同样的源码 → 同样的产物 sha256：host `2f3d128b1fad`、client `350dac8ed058`）。

每条断言都做过**反向验证**（注入违规 → 确认精确报错 → 还原）。本轮做了两组注入、一次跑完，失败精确落在对应用例上：

| 注入 | 落下的失败 |
|---|---|
| `detectStyle.compact` 恒 false | `W：单行紧凑文件编辑后仍是单行` |
| 解析器不再记录被拒组 | 3 条 `P`：非法 matcher / 全跑不了 / 试运行被拒 |
| `stopPayload` 恒 false | `集成：Stop 的 stop_hook_active 说真话` |
| fail-open 恢复"两侧一起回退" | `fail-open：只有坏掉的那一侧回退` |
| `intentFor` 丢掉 `expectedVersion` | 2 条 `D43`：锁必须是**目标文件**的版本 / 切换作用域后换锁 |
| `removeHook` 不回收空组 | `F：删掉组里最后一条 hook ⇒ 整组回收` |
| popover 去掉 `aria-activedescendant` | `D56：可达性` |

（一次注入**没有**变红：`saveField` 里那道 `matcherDiagnostic` 兜底判断。因为用户可见的行为是"保存按钮被禁用
+ 不发请求"，那由 `D47` 断言；兜底判断是防御性的第二道锁，删掉它不改变任何外部行为。这里记下来，
免得下一轮把"没变红"误读成"没覆盖"。）

## 逐票状态

| # | Ticket | 状态 | 断言落点 |
|---|---|---|---|
| 01 | 包能在当前 DSH 上安装 | 代码完成，**待用户执行安装** | `A：引擎声明与描述` |
| 02 | 错误码目录与文案表合一 | 完成 | `F：错误码目录 ↔ 用户文案表` |
| 03 | 写前版本锁 | 完成 | `P：写请求带 expectedVersion`、`D43`×2 |
| 04 | 单行紧凑文件保真 | 完成 | `W：单行紧凑文件编辑后仍是单行` |
| 05 | 删组不留空壳 + 畸形事件键拒写 | 完成 | `F：…整组回收`、`F：…malformed-event` |
| 06 | 跑不了的 hook 可见 | 完成 | 3 条 `P` + `D44` / `D45` |
| 07 | ⋯ 里改匹配范围与超时 | 完成 | `F：setGroupMatcher / setHookTimeout`、`D46` / `D47` / `D48` |
| 08 | 上移 / 下移 | 完成 | `F：moveHook 用 toIndex`、`D49` |
| 09 | 删除整组 + 追加到已有组 | 完成 | `F：removeGroup / addHook`、`D50` |
| 10 | `stop_hook_active` 说真话 | 完成 | `集成：Stop 的 stop_hook_active 说真话` |
| 11 | fail-open 按侧回退 | 完成 | `fail-open：只有坏掉的那一侧回退` |
| 12 | 状态证据带时间 + 只记本次进程 | 完成 | `D51` |
| 13 | 生效（合并）视图 | 完成 | `D52` |
| 14 | 试运行输出可读 | 完成 | `D53` |
| 15 | 写与试运行的时间预算与取消 | 完成 | `D54` |
| 16 | 搜索按可见文本 + 术语统一 | 完成 | `D55` |
| 17 | 可达性（焦点 / 播报 / 可访问名） | 完成 | `D56`、`D57` |
| 18 | 「更多」分节 + 诊断中文化 | 完成 | `D58` |

## 只有真机能验的部分（本轮做不到的）

1. **01 的安装与激活**：需要用户执行 `plugin_manager install_bundle`（本会话审批关闭）。装完之后要复核两件事：
   设置导航出现 Hooks 一格；`settings.section` 座位台账里出现 `hooks/920`。
2. **真机视觉**：`⋯` 现在是两排（字段排 + 动作排）、「更多」是三节、被拒组是虚线边框 —— 这些只在离线渲染里
   验过结构与文案，没有在 564px 真屏上量过换行。
3. **沙箱档位**：写 `$DSH_HOME/hooks.json` 在 `workspace-write` / `read-only` 会话下是否被拒，仍取决于 profile；
   本机是 `danger-full-access`，所以这条路径没被真的走一遍。

## 与设计意图的两处偏差（写在明处）

1. **06 的「⋯」**：ticket 里写的是"被拒的行也给一个 `⋯`（其中不提供试运行）"。落地时它只有**一个动作** ——
   「改匹配范围」，而且**只对 `invalid-matcher` 那一类出现**（`malformed-group` / `no-command` /
   `unsupported-type` 改 matcher 也不会让它跑起来，给了入口只会误导用户白改一遍）。整组删除的入口在
   09 之后仍然只在"能跑的行"上（被拒组本身已经没有可删的 hook）。
2. **13 的入口**：ticket 说"新增一个视图"。落地为「更多」折叠里的**第一节**（而不是顶部的视图切换）——
   这样零新增状态、且满足"折叠收起时仍可通过既有入口一次点击到达"。

## code-review 复核后的修复（两个轴各跑了一个子代理）

修复前的状态：`pnpm check` 的 `format:check` 是红的（六份文件没格式化，另有两处语句被并到了上一行）。

**Standards 轴**
- `format:check` 全绿；并补了一条护栏：注入的 CSS 里出现反引号会当场红（它会提前结束模板字符串，
  报错点在离现场很远的地方 —— 本轮踩了两次）。
- `statusFor` 从 switch 改成 `Record<HostErrorCode, number>`：新增错误码漏进表里现在是**编译错误**
  （以前会静默掉进 500，页面显示"插件内部出错了"）。
- `src/shared/errors.ts` 过去只有客户端 import，宿主仍然扔裸字符串 —— 现在宿主**必须在运行时**用它：
  目录外的码由 `hostErrorCodeOf()` 归成 `internal`，`writeErrorCode()` 的返回类型就是 `HostErrorCode`。
  AGENTS §2.12 的错误码清单同步更新。
- 删掉 `lockVersion`（在中止判断之后它恒等于 `prep.version` —— Middle Man）。
- `RejectedGroupView.reason` 不再在客户端重抄联合类型，改为 import 共享的 `RejectedReason`；
  `rejectedReasonText` 也从 `string` 收紧成 `RejectedReason`（少一种没人认识的值）。
- `formatDryRun` + `dryFullOf` 合成 `dryRunText(run) → {shown, full}`（两处各写一遍 stderr-or-stdout 会漂移）。
- `HookCard` 的六个菜单态参数打包成 `CardMenuState`（它已经涨到 22 个平铺 prop）。
- `saveField` 里那条不可达的 `bad-timeout` 分支删掉（保存按钮在该输入下就是禁用的，再报一次只会
  多一条没人能触发的文案）。

**Spec 轴（这几条是真的漏了，不是风格）**
- **06**：全是 `type:"prompt"` 的组**一条记录都不留** → 页面一边说"另有 3 条跑不了"、一边说
  "文件里还没有任何 hook"。现在这种组记一条 `unsupported-type`（`hookCount: 0`，条目已在 `skipped` 里计过）；
  `T:"command"` 但命令为空串的条目也从"静默丢弃"改为记 `reason: 'empty-command'`（否则条数说小了）。
- **06**：`D44`/`D45` 原先**手工拼 `rejected`**，于是上面这个真 bug 在渲染断言里完全看不见。
  现在走 `snapshotFromRaw()`：`parseHookConfig(文件内容)` → `buildSnapshot(...)` → 渲染。
- **03**：`versionOfScope` 把"文件存在但 provider 没给版本"也当成 `null`（= "它不存在"）→ 每次保存都
  变成 `stale`，页面还一直劝用户刷新（刷新永远不会好）。现在是三态：`absent → null`、
  有版本 → 版本串、存在但没版本 → **不带这个字段**（宿主走读后写，拿不到版本会如实回 `no-version`）。
- **03**：补了"两个写请求拿同一个版本"的断言（先到的成功、后到的 `stale`）。
- **11**：补了"两侧都坏 → 两侧各自回 last-good"的断言（这条兜底路径以前没有断言）。
- **15**：补了客户端协议层的"中止 → 折成 `timeout`、永不抛"断言。
- **13**：生效视图在"当前会话未知"时会明说"这不代表实际会跑什么"。

## 仍然没有断言覆盖的两处（如实记录）

1. **`withBudget` 的 10s 计时器本身**：`D54` 是让 fetch 立刻以 `AbortError` 失败，测的是"中止之后
   页面能用"；"10 秒后真的会 abort"这条只靠代码可见，没有测试（要测就得让用例等 10 秒，或给预算
   开一个只为测试存在的注入点 —— 后者我不愿意加）。风险很低：那三行是 `setTimeout` + `abort`。
2. **真机视觉与安装**：见上一节。


/**
 * dsh-hooks 存活探针（demo，可随时删除）。
 *
 * ## 为什么不用"写日志文件"来证明 hook 跑了
 *
 * 实测（本机 desktop profile，见 README「热重载实测记录」）：插件用 `ctx.shell` 跑 hook 时
 * **不带 per-call 沙箱策略**，`dsh-pwsh-sandbox` 于是回退到**部署策略**
 * （`cordis.yml` 里 sandbox-policy 的 `mode: workspace-write`、`workspaceRoot: 宿主 process.cwd()`）。
 * 结果是 hook 子进程**只能写自己那次的私有 TEMP**，写仓库 / 用户目录 / 真实 %TEMP% 全部 EPERM：
 *
 *     repo:.dsh=EPERM  repo:.tmp=EPERM  real_TEMP=EPERM  userhome:.dsh=EPERM  sandbox_tmpdir=OK
 *
 * 所以"探针追加一行到文件"这条路在本机**根本走不通**，而且探针里通常还 try/catch 吞掉错误 ——
 * "hook 没跑"和"跑了但写不进去"看起来一模一样，这正是上一轮三个热重载实验全部误判的原因。
 *
 * ## 正确做法：用 hook 协议自己的出口
 *
 * PreToolUse 唯一"非阻断且可见"的出口是结构化输出里的 `permissionDecision`。
 * 本探针只在**工具输入里出现魔法串 `DSH_HOOKS_PROBE`** 时才 deny，平时完全静默、不阻断：
 *
 *     在 DSH 里执行一次 `Write-Output DSH_HOOKS_PROBE`
 *     → 被拦截并返回 "dsh-hooks 存活探针：..." 就说明插件已加载、matcher 命中、PreToolUse 真的在跑
 *
 * 这样探针不需要任何文件写权限，跨平台且不会被沙箱吞掉。
 * 删除方式：删掉 `.dsh/hooks.json`（连同本文件）即可移除。
 */
import { appendFileSync } from 'node:fs'

/** 触发拦截的魔法串；平时不写、不打日志，避免任何副作用。 */
const TRIGGER = 'DSH_HOOKS_PROBE'
/** 尽力而为的旁路日志：写不进去是**预期**的（见文件头），只为本地排查时能对照。 */
const BEST_EFFORT_LOG = 'dsh-hooks-probe.log'

let stdin = ''
process.stdin.on('data', (chunk) => {
  stdin += chunk
})
process.stdin.on('end', () => {
  let payload = {}
  try {
    payload = JSON.parse(stdin)
  } catch {
    payload = { parseError: true }
  }

  const summary =
    `event=${payload.hook_event_name} tool=${payload.tool_name} cwd=${payload.cwd} ` +
    `session=${payload.session_id} tool_use_id=${payload.tool_use_id}`
  const hit = JSON.stringify(payload.tool_input ?? null).includes(TRIGGER)

  // 旁路日志：成功与否都不影响下面的判定（本机多半是 EPERM，属预期）。
  try {
    appendFileSync(BEST_EFFORT_LOG, `${new Date().toISOString()}\t${summary}\n`, 'utf8')
  } catch {
    /* 预期：hook 子进程被 ACL 沙箱限制，只能写自己的私有 TEMP */
  }

  if (hit) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `dsh-hooks 存活探针：插件已加载且 PreToolUse 命中（${summary}）`,
        },
      }),
    )
  }
  process.exit(0)
})

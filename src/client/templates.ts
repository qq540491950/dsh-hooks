/**
 * 「＋新建」的模板（v4）。
 *
 * ## 为什么要有这个模块
 * 用户的原话是"为什么不能简洁面向用户使用"。一个 hook 的 `command` 在本协议里**只能是一条
 * 字符串**（没有 `args` / `cwd` / `env` 字段，AGENTS §6），所以"检查环境 → 找入口 → 打人话报错"
 * 全都得塞进这一条里 —— 结果就是真机上那条 300 字符的 `node -e "…"`：用户既看不懂也不敢改。
 * 模板把最常见的三种意图变成**一次点击**：会话开始注入一句提醒、把每次调用记到文件、直接拦住。
 *
 * ## 三条纪律
 *   1. **每条模板都必须真跑得起来**（不是装饰）：`tools/verify.ts` 的 P 区用**真子进程**跑这
 *      三条，断言 exit 0 / `decision` / 落盘副产物。改模板 = 改断言，两边一起动。
 *   2. **命令是给人看的**：模板只**填**字段，不隐藏命令 —— 用户仍然能在 `命令` 框里看到并改它。
 *      不做"黑盒预设"，否则出问题时用户无从下手。
 *   3. **本文件必须被 import**：esbuild 沿 import 打包，没人 import 的模块会被**静默丢掉**（§4.8）。
 *      所以 `new-hook.tsx` 引用它，`tools/verify.ts` 的 D 区另有一条断言：三个中文标签真的在
 *      **产物** `lib/client.js` 里。
 *
 * ## ⚠️ 两个写命令的坑（都是实测出来的）
 *   1. **引号形态**：外层双引号 + 内层单引号，且**一处 `$` 都不用** —— Windows 上 `ctx.shell`
 *      是 PowerShell 5.1，它会先做一次变量展开。这与本机实际在跑的 hook 命令（agent-go 的
 *      `boot.cjs` 启动行）同一形态；改成外层单引号会被 PowerShell 的 `-Command` 引号规则吃掉。
 *   2. **模板字符串里不许出现 `${`**：命令用反引号写可读性最好，但 `${…}` 会被当插值。
 *      所以命令里一律用 `process.env.DSH_PROJECT_DIR`，**不用** `${DSH_PROJECT_DIR}` 占位符
 *      （那个占位符在宿主解析时才替换，写在这里会被 TS 先插值成 undefined）。
 *
 * 中文提示语写在 `additionalContext` 里：宿主把它作为上下文注入（`agent.inject` /
 * `additionalContexts`，见 `src/host/index.ts` 的 SessionStart / UserPromptSubmit 接线）。
 */

/** 一条模板：点一下 = 把四个字段填进表单（用户随后仍可改）。 */
export interface HookTemplate {
  /** 稳定 id（断言与日志用）。 */
  id: string
  /** 按钮上的短词（中文，2–4 字）。 */
  label: string
  /** `title`：这一条模板到底干什么（一句话）。 */
  hint: string
  event: string
  matcher: string
  command: string
  timeout: string
}

/**
 * 模板清单（顺序即按钮顺序；第一个是最常用的那个）。
 *
 * `deny` 那条刻意走"exit 0 + 结构化 JSON"，而不是 `exit 2` —— Windows 上 PowerShell 会把
 * exit 2 折叠成 1（AGENTS §6 的实测），用退出码表达阻断在这台机器上是**不可靠**的。
 */
export const HOOK_TEMPLATES: readonly HookTemplate[] = [
  {
    id: 'session-reminder',
    label: '注入提醒',
    hint: '会话开始时，把一句话作为上下文交给 agent（不阻断任何东西）',
    event: 'SessionStart',
    matcher: '',
    command: `node -e "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'动手前先读本仓库的 AGENTS.md。'}}))"`,
    timeout: '10',
  },
  {
    id: 'log-calls',
    label: '记到日志',
    hint: '每次工具调用后，把这行输入追加到项目里的 .dsh/hook.log',
    event: 'PostToolUse',
    matcher: '',
    command: `node -e "const fs=require('node:fs');fs.appendFileSync(process.env.DSH_PROJECT_DIR+'/.dsh/hook.log',fs.readFileSync(0).toString()+'\\n')"`,
    timeout: '10',
  },
  {
    id: 'deny-calls',
    label: '直接拦住',
    hint: '命中的工具调用一律拒绝（拦哪些由「匹配」决定）',
    event: 'PreToolUse',
    matcher: 'pwsh|bash',
    command: `node -e "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'被项目 hook 拒绝'}}))"`,
    timeout: '10',
  },
]

/**
 * dsh-hooks 离线自检。
 *
 * 不需要 DSH、不需要 pnpm —— 直接：
 *
 *     node tools/verify.mjs
 *
 * 覆盖三层：
 *   1. 静态检查：lib/index.js 必须零 import/require，且导出 name/inject/apply。
 *   2. 纯函数单测：matcher / exit code 解码 / 结构化输出 / deny>ask>allow 合并。
 *   3. 集成测试：用假的 ctx.shell（背后是**真实子进程**）+ 假 ctx.fs（背后是**真实文件系统**）
 *      真正挂载插件，驱动 7 个扩展点，验证 deny/ask/block/reject/注入/Stop 上限/路径解析/payload 形状。
 *
 * 退出码 0 = 全绿。
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 宿主产物：跑真实的 lib/index.js（事件接线 + 配置读取 + 子进程执行）。
import { apply, inject, name } from '../lib/index.js'
// 纯协议层：**直接 import TS 源码**（Node ≥22.18 会剥类型），而不是经 lib/index.js 的
// `internals` 转出来 —— 这样同一批断言直接压在迁移后的实现上，改错了立刻红。
import {
  blocksToText,
  contextMessage,
  matcherDiagnostic,
  matchesMatcher,
  mergeHookGroups,
  mergeHookOutputs,
  parentOf,
  parseHookConfig,
  parseHookOutput,
  joinPath,
} from '../src/shared/protocol.ts'
import { DEFAULT_TIMEOUT_MS, NEGATIVE_TTL_MS, POSITIVE_TTL_MS } from '../src/shared/constants.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.join(HERE, '..', 'lib', 'index.js')
const NODE = process.execPath

let passed = 0
let failed = 0
const failures = []

function test(title, fn) {
  const onError = (error) => {
    failed++
    const detail = error && error.stack ? error.stack.split('\n').slice(0, 3).join('\n    ') : String(error)
    failures.push(`${title}\n    ${detail}`)
  }
  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        passed++
      }, onError)
    }
    passed++
  } catch (error) {
    onError(error)
  }
  return undefined
}

const tmpRoots = []

//#region 1. 静态检查

test('lib/index.js 零 import / 零 require', () => {
  const source = fs.readFileSync(LIB, 'utf8')
  const imports = source.match(/^\s*import\s/gm) || []
  const requires = source.match(/\brequire\s*\(/g) || []
  assert.equal(imports.length, 0, `发现 ${imports.length} 处 import`)
  assert.equal(requires.length, 0, `发现 ${requires.length} 处 require`)
})

test('插件导出面正确', () => {
  assert.equal(name, 'dsh-hooks')
  assert.deepEqual(inject, ['shell', 'fs'])
  assert.equal(typeof apply, 'function')
})

test('A：format/format:check 的 glob 指向真实存在的目录（空 glob 不再静默）', () => {
  // P2 记账：当时 src/ 还不存在，prettier 对空 glob 直接退出码 2，于是给两个脚本加了
  // --no-error-on-unmatched-pattern —— 代价是"glob 写错"不再报错。这条断言把那份保护补回来。
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'))
  const root = path.join(HERE, '..')
  for (const name of ['format', 'format:check']) {
    const script = pkg.scripts[name]
    assert.ok(typeof script === 'string' && script.startsWith('prettier'), `${name} 应当是 prettier 脚本`)
    for (const dir of ['src', 'tools']) {
      assert.ok(script.includes(`${dir}/**`), `${name} 应当覆盖 ${dir}/**（当前：${script}）`)
      assert.ok(fs.existsSync(path.join(root, dir)), `${name} 覆盖的目录 ${dir}/ 必须真实存在`)
    }
  }
})

//#endregion

//#region 可选：直接体检一份真实的 hooks.json
//   node tools/verify.mjs --config <projectRoot>/.dsh/hooks.json
const configArgIndex = process.argv.indexOf('--config')
if (configArgIndex !== -1) {
  const target = process.argv[configArgIndex + 1]
  if (!target) {
    console.error('--config 后面需要跟一个 hooks.json 路径')
    process.exit(2)
  }
  const abs = path.resolve(target)
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch (error) {
    console.error(`✗ 读不动 / 解析不了 ${abs}\n  ${error && error.message}`)
    process.exit(1)
  }
  // `<root>/.dsh/hooks.json` → projectDir = <root>
  const projectDir = path.dirname(path.dirname(abs))
  const parsed = parseHookConfig(raw, { projectDir })
  const events = Object.keys(parsed.groups)
  console.log(`\n体检 ${abs}`)
  console.log(`  projectDir : ${projectDir}`)
  console.log(`  可用事件   : ${events.length ? events.join(', ') : '(无 —— 这份配置不会触发任何 hook)'}`)
  for (const event of events) {
    for (const group of parsed.groups[event]) {
      const matcher = group.matcher === undefined ? '(无 matcher，全匹配)' : JSON.stringify(group.matcher)
      for (const hook of group.hooks) {
        const timeout = hook.timeoutSec === undefined ? `${DEFAULT_TIMEOUT_MS / 1000}s(默认)` : `${hook.timeoutSec}s`
        console.log(`    ${event}  matcher=${matcher}  timeout=${timeout}\n      ${hook.command}`)
      }
    }
  }
  console.log(`  跳过的 handler: ${parsed.skipped.length ? parsed.skipped.map((s) => `${s.event}:${s.type}`).join(', ') : '(无)'}`)
  console.log(`  matcher 诊断  : ${parsed.errors.length ? parsed.errors.join('; ') : '(无)'}`)
  process.exit(0)
}
//#endregion

//#region 2. 纯函数单测

test('matcher：全匹配哨兵', () => {
  for (const m of [undefined, '', '*']) assert.equal(matchesMatcher(m, 'anything'), true)
})

test('matcher：字面量多选精确匹配', () => {
  assert.equal(matchesMatcher('Edit|Write', 'Edit'), true)
  assert.equal(matchesMatcher('Edit|Write', 'Write'), true)
  assert.equal(matchesMatcher('Edit|Write', 'Read'), false)
  assert.equal(matchesMatcher('Edit', 'EditText'), false, '字面量不做子串匹配')
})

test('matcher：正则非锚定', () => {
  assert.equal(matchesMatcher('^mcp__github__.*', 'mcp__github__list_issues'), true)
  assert.equal(matchesMatcher('^mcp__github__.*', 'mcp__gva__x'), false)
  assert.equal(matchesMatcher('Read.*', 'ReadFileExtra'), true)
})

test('matcher：非法正则按不匹配处理并给出诊断', () => {
  assert.equal(matchesMatcher('[unclosed', 'x'), false)
  assert.match(matcherDiagnostic('[unclosed'), /invalid regex/)
  assert.equal(matcherDiagnostic('Edit|Write'), undefined)
})

test('parseHookConfig：接受 hooks 段与裸事件映射两种形状', () => {
  const wrapped = parseHookConfig({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'a' }] }] } })
  assert.deepEqual(wrapped.groups.PreToolUse[0].hooks, [{ command: 'a' }])
  const bare = parseHookConfig({ PreToolUse: [{ hooks: [{ command: 'a' }] }] })
  assert.deepEqual(bare.groups.PreToolUse[0].hooks, [{ command: 'a' }])
})

test('parseHookConfig：timeout 是秒，缺省时不写', () => {
  const r = parseHookConfig({ hooks: { PostToolUse: [{ hooks: [{ command: 'a', timeout: 30 }, { command: 'b' }] }] } })
  assert.deepEqual(r.groups.PostToolUse[0].hooks, [{ command: 'a', timeoutSec: 30 }, { command: 'b' }])
})

test('parseHookConfig：非 command handler 跳过并记录', () => {
  const r = parseHookConfig({
    hooks: {
      PreToolUse: [{ hooks: [{ type: 'http', url: 'http://x' }, { type: 'command', command: 'a' }] }],
      Stop: [{ hooks: [{ type: 'prompt', prompt: 'p' }] }],
    },
  })
  assert.deepEqual(r.skipped, [
    { event: 'PreToolUse', type: 'http' },
    { event: 'Stop', type: 'prompt' },
  ])
  assert.equal(r.groups.PreToolUse[0].hooks.length, 1)
  assert.equal(r.groups.Stop, undefined)
})

test('parseHookConfig：非法 matcher 只跳过该 group', () => {
  const r = parseHookConfig({
    hooks: {
      PreToolUse: [
        { matcher: '[unclosed', hooks: [{ command: 'bad' }] },
        { matcher: 'Edit', hooks: [{ command: 'good' }] },
      ],
    },
  })
  assert.equal(r.errors.length, 1)
  assert.equal(r.groups.PreToolUse.length, 1)
  assert.deepEqual(r.groups.PreToolUse[0].hooks, [{ command: 'good' }])
})

test('parseHookConfig：UserPromptSubmit / Stop 丢弃 matcher', () => {
  const r = parseHookConfig({
    hooks: {
      UserPromptSubmit: [{ matcher: 'whatever', hooks: [{ command: 'a' }] }],
      Stop: [{ matcher: 'whatever', hooks: [{ command: 'b' }] }],
      PreToolUse: [{ matcher: 'Edit', hooks: [{ command: 'c' }] }],
    },
  })
  assert.equal(r.groups.UserPromptSubmit[0].matcher, undefined)
  assert.equal(r.groups.Stop[0].matcher, undefined)
  assert.equal(r.groups.PreToolUse[0].matcher, 'Edit')
})

test('parseHookConfig：不支持的事件被忽略', () => {
  const r = parseHookConfig({
    hooks: { Notification: [{ hooks: [{ command: 'a' }] }], PreCompact: [{ hooks: [{ command: 'b' }] }] },
  })
  assert.deepEqual(Object.keys(r.groups), [])
})

test('parseHookConfig：${DSH_PROJECT_DIR} / ${DSH_PLUGIN_ROOT} 替换', () => {
  const r = parseHookConfig(
    { hooks: { PreToolUse: [{ hooks: [{ command: 'node ${DSH_PROJECT_DIR}/h.mjs ${DSH_PLUGIN_ROOT}' }] }] } },
    { projectDir: 'C:\\proj', pluginRoot: 'C:\\plug' },
  )
  assert.equal(r.groups.PreToolUse[0].hooks[0].command, 'node C:\\proj/h.mjs C:\\plug')
})

test('parseHookConfig：损坏输入不抛', () => {
  for (const bad of [null, undefined, 42, 'text', [], { hooks: null }]) {
    assert.doesNotThrow(() => parseHookConfig(bad))
  }
})

test('mergeHookGroups：用户级在前、项目级在后，数组拼接', () => {
  const merged = mergeHookGroups({ PreToolUse: [{ hooks: [{ command: 'user' }] }] }, {
    PreToolUse: [{ hooks: [{ command: 'project' }] }],
    Stop: [{ hooks: [{ command: 'stop' }] }],
  })
  assert.deepEqual(merged.PreToolUse.map((g) => g.hooks[0].command), ['user', 'project'])
  assert.deepEqual(merged.Stop.map((g) => g.hooks[0].command), ['stop'])
})

test('codec：exit 2 阻断且 stderr 作理由', () => {
  const out = parseHookOutput(2, '', '  nope  ', 'PreToolUse')
  assert.equal(out.decision, 'block')
  assert.equal(out.reason, 'nope')
})

test('codec：exit 2 且 stderr 为空时不填 reason', () => {
  const out = parseHookOutput(2, '', '', 'PreToolUse')
  assert.equal(out.decision, 'block')
  assert.equal(out.reason, undefined)
})

test('codec：非 0 非 2 是非阻断失败', () => {
  const out = parseHookOutput(1, '', 'warn', 'PreToolUse')
  assert.equal(out.decision, undefined)
  assert.equal(out.reason, undefined)
})

test('codec：exit 0 + permissionDecision', () => {
  const out = parseHookOutput(
    0,
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'boom',
        additionalContext: 'ctx',
      },
    }),
    '',
    'PreToolUse',
  )
  assert.equal(out.decision, 'deny')
  assert.equal(out.reason, 'boom')
  assert.equal(out.additionalContext, 'ctx')
})

test('codec：hookEventName 不符时丢弃事件级字段', () => {
  const out = parseHookOutput(
    0,
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', permissionDecision: 'deny' } }),
    '',
    'PreToolUse',
  )
  assert.equal(out.decision, undefined)
  assert.equal(out.hookEventName, 'PostToolUse')
})

test('codec：顶层 decision 只认 approve/block，deny 被忽略', () => {
  assert.equal(parseHookOutput(0, JSON.stringify({ decision: 'block', reason: 'r' }), '', 'Stop').decision, 'block')
  assert.equal(parseHookOutput(0, JSON.stringify({ decision: 'deny' }), '', 'Stop').decision, undefined)
})

test('codec：非 JSON stdout 不解析、不抛', () => {
  assert.equal(parseHookOutput(0, 'just text', '', 'Stop').decision, undefined)
  assert.equal(parseHookOutput(0, '{"unclosed": ', '', 'Stop').decision, undefined)
})

test('codec：spawn 失败（无 exit code）是非阻断', () => {
  const out = parseHookOutput(undefined, '', 'ENOENT', 'PreToolUse')
  assert.equal(out.decision, undefined)
  assert.equal(out.exitCode, undefined)
})

test('merge：deny > ask > allow', () => {
  assert.equal(mergeHookOutputs([{ decision: 'allow' }, { decision: 'ask' }, { decision: 'deny' }]).decision, 'deny')
  assert.equal(mergeHookOutputs([{ decision: 'allow' }, { decision: 'ask' }]).decision, 'ask')
  assert.equal(mergeHookOutputs([{ decision: 'allow' }]).decision, 'allow')
  assert.equal(mergeHookOutputs([]).decision, 'none')
  assert.equal(mergeHookOutputs([{ decision: 'block' }]).decision, 'deny', 'block 与 deny 同档')
})

test('merge：同档理由拼接，异档理由不混入', () => {
  const merged = mergeHookOutputs([
    { decision: 'deny', reason: 'a' },
    { decision: 'deny', reason: 'b' },
    { decision: 'ask', reason: 'c' },
  ])
  assert.equal(merged.reason, 'a\n\nb')
})

test('merge：continue:false 粘住首个并带 stopReason', () => {
  const merged = mergeHookOutputs([
    { continue: false, stopReason: 'first' },
    { continue: false, stopReason: 'second' },
  ])
  assert.equal(merged.stop, true)
  assert.equal(merged.stopReason, 'first')
})

test('merge：additionalContext 按顺序累积', () => {
  assert.deepEqual(mergeHookOutputs([{ additionalContext: 'a' }, { additionalContext: 'b' }, {}]).additionalContext, ['a', 'b'])
})

test('helper：路径工具在根上收敛', () => {
  assert.equal(parentOf('C:\\a\\b'), 'C:\\a')
  assert.equal(parentOf('C:\\a'), 'C:\\')
  assert.equal(parentOf('C:\\'), undefined)
  assert.equal(parentOf('/a/b'), '/a')
  assert.equal(parentOf('/a'), undefined)
  assert.equal(joinPath('C:\\proj', '.dsh', 'hooks.json'), 'C:\\proj\\.dsh\\hooks.json')
  assert.equal(joinPath('/proj', '.dsh', 'hooks.json'), '/proj/.dsh/hooks.json')
})

test('helper：blocksToText 只取 text 块', () => {
  assert.equal(blocksToText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]), 'ab')
  assert.equal(blocksToText(undefined), '')
})

test('helper：contextMessage 形状对齐 createUserMessage', () => {
  assert.equal(contextMessage({ additionalContext: [] }), undefined)
  const message = contextMessage({ additionalContext: ['x', 'y'] })
  assert.equal(message.role, 'user')
  assert.equal(typeof message.id, 'string')
  assert.deepEqual(message.content, [
    { type: 'text', text: 'x' },
    { type: 'text', text: 'y' },
  ])
  assert.ok(message.source && typeof message.source.kind === 'string')
})

//#endregion

//#region 2b. 差分对拍：TS 协议层 ↔ lib/index.js 的 internals（**迁移期专用**）
//
// 为什么需要它：2 区的单测只覆盖"想到的那些例子"。迁移期间两份实现同时存在，
// 用一批更宽的输入对拍，任何一边漂移都会立刻红。
// **P3b 之后（lib/index.js 变成构建产物、internals 被删除）本区应当整体删除。**
const { internals } = await import('../lib/index.js')

/** 递归按键排序，使比较只看语义、不看键的书写顺序。 */
function canon(value) {
  if (Array.isArray(value)) return value.map(canon)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = canon(value[key])
    return out
  }
  return value
}

const sameAsLegacy = (label, produce, legacyProduce) => {
  const next = JSON.stringify(canon(produce()))
  const legacy = JSON.stringify(canon(legacyProduce()))
  assert.equal(next, legacy, `${label}：TS 实现与旧实现结果不一致`)
}

const DIFF_CONFIGS = [
  { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: 'a' }] }] } },
  { PreToolUse: [{ hooks: [{ command: 'b', timeout: 30 }] }] },
  { hooks: { PreToolUse: [{ hooks: [{ type: 'http', command: 'x' }, { command: 'c' }] }] } },
  { hooks: { PreToolUse: [{ matcher: '(', hooks: [{ command: 'd' }] }] } },
  { hooks: { Stop: [{ matcher: 'pwsh', hooks: [{ command: 'e' }] }] } },
  { hooks: { UserPromptSubmit: [{ matcher: 'pwsh', hooks: [{ command: 'f' }] }] } },
  { hooks: { PreToolUse: [{ hooks: [{ command: '${DSH_PROJECT_DIR}/x' }] }] } },
  { hooks: { PostToolUse: [{ hooks: [{ command: 'g', timeout: 0 }] }] } },
  { hooks: null },
  null,
  42,
  [],
  'text',
  { hooks: { Notification: [{ hooks: [{ command: 'h' }] }] } },
]

const DIFF_MATCHERS = [undefined, '', '*', 'pwsh|bash', '^mcp__.*', '(', 'Edit']
const DIFF_QUERIES = ['pwsh', 'Bash', 'mcp__github__x', 'EditText', '']
const DIFF_OUTPUTS = [
  { exitCode: 0, stdout: '{"continue":false,"stopReason":"r"}', stderr: '' },
  { exitCode: 2, stdout: '', stderr: 'boom' },
  { exitCode: 2, stdout: '', stderr: '   ' },
  { exitCode: 0, stdout: 'not json', stderr: '' },
  { exitCode: 0, stdout: '{"decision":"deny","reason":"only approve|block"}', stderr: '' },
  {
    exitCode: 0,
    stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"sure?"}}',
    stderr: '',
  },
  { exitCode: 0, stdout: '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"deny"}}', stderr: '' },
  { exitCode: undefined, stdout: undefined, stderr: undefined },
  { exitCode: 0, stdout: '{"systemMessage":"sys","additionalContext":"ctx"}', stderr: '' },
]

await test('差分：parseHookConfig 与旧实现逐例一致', () => {
  for (const raw of DIFF_CONFIGS) {
    sameAsLegacy(
      `parseHookConfig(${JSON.stringify(raw)})`,
      () => parseHookConfig(raw, { projectDir: 'D:/p' }),
      () => internals.parseHookConfig(raw, { projectDir: 'D:/p' }),
    )
  }
})

await test('差分：matcher 判定与诊断逐例一致', () => {
  for (const matcher of DIFF_MATCHERS) {
    sameAsLegacy(
      `matcherDiagnostic(${JSON.stringify(matcher)})`,
      () => matcherDiagnostic(matcher),
      () => internals.matcherDiagnostic(matcher),
    )
    for (const query of DIFF_QUERIES) {
      sameAsLegacy(
        `matchesMatcher(${JSON.stringify(matcher)}, ${JSON.stringify(query)})`,
        () => matchesMatcher(matcher, query),
        () => internals.matchesMatcher(matcher, query),
      )
    }
  }
})

await test('差分：mergeHookGroups 逐例一致', () => {
  const user = parseHookConfig({ hooks: { PreToolUse: [{ hooks: [{ command: 'u' }] }] } })
  const project = parseHookConfig({ hooks: { PreToolUse: [{ hooks: [{ command: 'p' }] }], Stop: [] } })
  sameAsLegacy(
    'mergeHookGroups',
    () => mergeHookGroups(user.groups, project.groups),
    () => internals.mergeHookGroups(user.groups, project.groups),
  )
})

await test('差分：输出解码与合并逐例一致', () => {
  for (const item of DIFF_OUTPUTS) {
    for (const expectedEventName of [undefined, 'PreToolUse']) {
      sameAsLegacy(
        `parseHookOutput(${String(item.exitCode)}, …, ${String(expectedEventName)})`,
        () => parseHookOutput(item.exitCode, item.stdout, item.stderr, expectedEventName),
        () => internals.parseHookOutput(item.exitCode, item.stdout, item.stderr, expectedEventName),
      )
    }
  }
  const decoded = DIFF_OUTPUTS.map((item) => parseHookOutput(item.exitCode, item.stdout, item.stderr, 'PreToolUse'))
  // ⚠️ 逐条单元素对拍是**必须的**：如果只对拍整个数组，rank 最高的那一项会掩盖其它分支
  // （第一版就是这么写的 —— deny 项让 rank=2 的 ask 分支永远走不到，注入漂移都抓不住）。
  for (let index = 0; index < decoded.length; index++) {
    const single = decoded[index]
    sameAsLegacy(
      `mergeHookOutputs([${String(index)}])`,
      () => mergeHookOutputs([single]),
      () => internals.mergeHookOutputs([single]),
    )
  }
  sameAsLegacy(
    'mergeHookOutputs(all)',
    () => mergeHookOutputs(decoded),
    () => internals.mergeHookOutputs(decoded),
  )
})

await test('差分：路径与文本 helper 逐例一致', () => {
  const paths = ['/a/b/c', 'C:\\x\\y\\z', 'C:\\', '/', '/a.txt', 'relative', 'C:\\x\\y\\']
  for (const p of paths) {
    sameAsLegacy(`parentOf(${p})`, () => parentOf(p), () => internals.parentOf(p))
    sameAsLegacy(
      `joinPath(${p})`,
      () => joinPath(p, '.dsh', 'hooks.json'),
      () => internals.joinPath(p, '.dsh', 'hooks.json'),
    )
  }
  for (const content of [undefined, null, 'text', [], [{ type: 'text', text: 'a' }, { type: 'image' }], [{}]]) {
    sameAsLegacy(
      `blocksToText(${JSON.stringify(content)})`,
      () => blocksToText(content),
      () => internals.blocksToText(content),
    )
  }
  const merged = { decision: 'deny', reason: 'r', stop: false, additionalContext: ['x', 'y'], systemMessages: [] }
  sameAsLegacy(
    'contextMessage',
    () => {
      const message = contextMessage(merged)
      return message === undefined ? undefined : { ...message, id: '(id)' }
    },
    () => {
      const message = internals.contextMessage(merged)
      return message === undefined ? undefined : { ...message, id: '(id)' }
    },
  )
})

//#endregion

//#region 3. 集成测试（真子进程 + 真文件系统 + 假 ctx）

/**
 * 插件每次调 `ctx.shell.resolve(request)` 的原始请求（按调用顺序）。
 * 用来断言 hook 子进程拿到的 `sandboxPolicy` 是什么。
 */
const shellRequests = []
/** 取最近一次 shell 请求。 */
const lastShellRequest = () => shellRequests[shellRequests.length - 1]

/**
 * 把 spec 交给**真实子进程**执行的假 ctx.shell。
 *
 * 这里刻意复刻了真实执行器的两个关键语义，否则测试会失真：
 *   1. 到期要 kill **整个进程树**（Windows 上 `cmd /c node slow.mjs` 里真正在跑的是孙进程，
 *      kill 掉 cmd 不管用；spawnSync 的 timeout 会因为管道没关而一直等到孙进程自己退出）。
 *   2. 超时 / 起不来的结果是**普通返回值**，不是 reject。
 */
const fakeShell = {
  resolve(request) {
    // 记下插件交给 shell 的原始请求：用例要断言 sandboxPolicy 有没有被透传。
    shellRequests.push(request)
    return { workdir: process.cwd(), timeoutMs: 600000, onExpiry: 'kill', ...request }
  },
  async execute(spec) {
    return {
      result() {
        return new Promise((resolve) => {
          const child = spawn(spec.command, {
            shell: true,
            cwd: spec.workdir,
            env: { ...process.env, ...(spec.env || {}) },
            windowsHide: true,
          })
          let stdout = ''
          let stderr = ''
          let timedOut = false
          const timer = setTimeout(() => {
            timedOut = true
            if (process.platform === 'win32') {
              spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
            } else {
              child.kill('SIGKILL')
            }
          }, spec.timeoutMs)
          child.stdout.on('data', (chunk) => {
            stdout += chunk
          })
          child.stderr.on('data', (chunk) => {
            stderr += chunk
          })
          child.on('error', (error) => {
            clearTimeout(timer)
            resolve({ exitCode: undefined, stdout: { text: stdout }, stderr: { text: String(error && error.message ? error.message : error) } })
          })
          child.on('close', (code) => {
            clearTimeout(timer)
            resolve({
              exitCode: timedOut ? null : code,
              timedOut,
              stdout: { text: stdout },
              stderr: { text: stderr },
            })
          })
          child.stdin.on('error', () => {})
          child.stdin.end(spec.stdin === undefined ? '' : spec.stdin)
        })
      },
    }
  },
}

/** 架在**真实文件系统**上的最小 ctx.fs 实现（不含 watch）。 */
const localFsBase = {
  async resolve(p, opts) {
    return { targetKey: path.resolve((opts && opts.cwd) || process.cwd(), p), get displayPath() { return this.targetKey } }
  },
  async stat(target) {
    try {
      const stat = await fsp.stat(target.displayPath)
      return { type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other', size: stat.size }
    } catch {
      return undefined
    }
  },
  async readText(target) {
    return fsp.readFile(target.displayPath, 'utf8')
  },
}

/** 默认假 ctx.fs：watch 挂得上但**永远不投递事件**（即"挂了但没事件"这一失效形态）。 */
const fakeFs = {
  ...localFsBase,
  async watch() {
    return async () => {}
  },
}

/**
 * 可定制的假 ctx.fs。
 *
 * @param options.watch `'none'` = **刻意不提供** `watch` 方法（测静默早退分支）；
 *   `'capture'` = 把 `changed` 回调收集进 `options.captured`（测失效路径）；
 *   省略 = 挂得上但静默。
 * @param options.onRead 每次 `readText` 都被调用一次（用来断言"读了几次配置"）。
 * @param options.version `true` = `stat` 额外返回一个**内容派生**的 `version`
 *   （真实 `FsInfo.version` 是 `dev:ino:size:mtimeNs:ctimeNs`；这里用 size+内容摘要，
 *   保证"内容变→版本变、不动文件→版本不变"，测版本核对通道用）。
 *   **默认不给 version** —— 于是默认假 fs 走的是"provider 没有版本"的 TTL 兜底分支。
 */
function makeFs(options = {}) {
  const fsImpl = {
    ...localFsBase,
    async stat(target) {
      const info = await localFsBase.stat(target)
      if (info === undefined || options.version !== true) return info
      const text = await fsp.readFile(target.displayPath, 'utf8').catch(() => '')
      const digest = createHash('sha1').update(text).digest('hex').slice(0, 12)
      return { ...info, version: `${info.size}:${digest}` }
    },
    async readText(target) {
      if (options.onRead) options.onRead(target)
      return localFsBase.readText(target)
    },
  }
  if (options.watch === 'none') return fsImpl
  if (options.watch === 'capture') {
    fsImpl.watch = async (target, changed) => {
      options.captured.push({ target, changed })
      return async () => {}
    }
    return fsImpl
  }
  fsImpl.watch = async () => async () => {}
  return fsImpl
}

function makeCtx(options = {}) {
  const listeners = new Map()
  const logs = []
  const disposers = []
  const agents = new Map()
  const ctx = {
    shell: fakeShell,
    fs: options.fs || fakeFs,
    logger: {
      info: (m) => logs.push({ level: 'info', message: String(m) }),
      warn: (m) => logs.push({ level: 'warn', message: String(m) }),
    },
    on(event, handler) {
      const list = listeners.get(event) || []
      list.push(handler)
      listeners.set(event, list)
      return () => {}
    },
    effect(fn) {
      disposers.push(fn())
      return () => {}
    },
    get(service) {
      if (service === 'agents') {
        return { get: (id) => agents.get(id), currentInitiator: () => options.initiator }
      }
      if (service === 'sandboxPolicy') return options.sandboxPolicy
      return undefined
    },
  }
  return { ctx, listeners, logs, disposers, agents }
}

/** 造临时项目目录（带 .git 标记，让 projectRoot 解析命中最内层）。 */
async function makeProject(subdir) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-hooks-verify-'))
  tmpRoots.push(dir)
  await fsp.mkdir(path.join(dir, '.git'), { recursive: true })
  if (subdir) await fsp.mkdir(path.join(dir, subdir), { recursive: true })
  return dir
}

/** 写一个作为 hook 运行的 .mjs（避开命令行引号地狱）。 */
async function script(dir, filename, body) {
  const file = path.join(dir, filename)
  await fsp.writeFile(file, body, 'utf8')
  return file
}

/** 写项目级配置。 */
async function writeHooks(dir, config) {
  await fsp.mkdir(path.join(dir, '.dsh'), { recursive: true })
  await fsp.writeFile(path.join(dir, '.dsh', 'hooks.json'), JSON.stringify(config, null, 2), 'utf8')
}

/** `"<node>" "<script>"` —— 只含两个被引号包住的路径。 */
const cmd = (scriptPath) => `"${NODE}" "${scriptPath}"`

/** 读 stdin 全量的脚本前缀。 */
const READ_STDIN = `let stdin='';process.stdin.on('data',(d)=>stdin+=d).on('end',()=>{const payload=JSON.parse(stdin);`

function fakeAgent(dir) {
  const injected = []
  const steered = []
  return {
    agent: {
      session: { header: { id: 'session-test', cwd: dir } },
      inject: (message) => injected.push(message),
      steer: (message) => steered.push(message),
    },
    injected,
    steered,
  }
}

/** 新建 ctx 并挂载插件。 */
async function mount(options = {}) {
  const harness = makeCtx(options)
  apply(harness.ctx)
  await new Promise((resolve) => setTimeout(resolve, 10))
  return harness
}

const nextAllow = async () => ({ kind: 'allow' })
const sayNext = (value) => async () => value

await test('集成：PreToolUse deny 生效（JSON permissionDecision）', async () => {
  const dir = await makeProject()
  const s = await script(
    dir,
    'deny.mjs',
    `process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'rm is banned'}}))`,
  )
  await writeHooks(dir, {
    hooks: { PreToolUse: [{ matcher: 'pwsh|Bash', hooks: [{ type: 'command', timeout: 20, command: cmd(s) }] }] },
  })
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const decision = await h.listeners.get('tools/pre-execute')[0](
    { name: 'pwsh', arguments: { command: 'rm -rf /' }, callId: 'c1', agent },
    nextAllow,
  )
  assert.deepEqual(decision, { kind: 'deny', reason: 'rm is banned' })
})

await test('集成：matcher 不命中时原样放行', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'exit2.mjs', 'process.exit(2)')
  await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const decision = await h.listeners.get('tools/pre-execute')[0](
    { name: 'read_file', arguments: {}, callId: 'c1', agent },
    nextAllow,
  )
  assert.deepEqual(decision, { kind: 'allow' })
})

await test('集成：exit 2 转成 deny，理由来自 stderr', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'danger.mjs', `process.stderr.write('dangerous');process.exit(2)`)
  await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const decision = await h.listeners.get('tools/pre-execute')[0]({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)
  assert.equal(decision.kind, 'deny')
  assert.equal(decision.reason, 'dangerous')
})

await test('集成：permissionDecision ask 转成审批询问', async () => {
  const dir = await makeProject()
  const s = await script(
    dir,
    'ask.mjs',
    `process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'ask',permissionDecisionReason:'sure?'}}))`,
  )
  await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const decision = await h.listeners.get('tools/pre-execute')[0]({ name: 'anything', arguments: {}, callId: 'c', agent }, nextAllow)
  assert.deepEqual(decision, { kind: 'ask', reason: 'sure?' })
})

await test('集成：PostToolUse 阻断带 feedback', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'lint.mjs', `process.stderr.write('lint failed');process.exit(2)`)
  await writeHooks(dir, { hooks: { PostToolUse: [{ matcher: 'edit', hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const decision = await h.listeners.get('tools/post-execute')[0](
    { name: 'edit', arguments: {}, callId: 'c', agent },
    { content: [{ type: 'text', text: 'ok' }] },
    sayNext({ kind: 'accept' }),
  )
  assert.equal(decision.kind, 'block')
  assert.equal(decision.feedback[0].text, 'lint failed')
})

await test('集成：UserPromptSubmit 拒绝整条 prompt', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'reject.mjs', 'process.exit(2)')
  await writeHooks(dir, { hooks: { UserPromptSubmit: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const decision = await h.listeners.get('agent/pre-step')[0](
    { agent, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], turn: 1, step: 1, signal: undefined },
    sayNext({ kind: 'enter', messages: [] }),
  )
  assert.deepEqual(decision, { kind: 'reject' })
})

await test('集成：additionalContext 被注入成 user 消息', async () => {
  const dir = await makeProject()
  const s = await script(
    dir,
    'ctx.mjs',
    `process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:'remember the rules'}}))`,
  )
  await writeHooks(dir, { hooks: { UserPromptSubmit: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const decision = await h.listeners.get('agent/pre-step')[0](
    { agent, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], turn: 1, step: 1, signal: undefined },
    sayNext({ kind: 'enter', messages: [] }),
  )
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 1)
  assert.equal(decision.messages[0].role, 'user')
  assert.equal(decision.messages[0].content[0].text, 'remember the rules')
})

await test('集成：SessionStart 注入到 agent.inject', async () => {
  const dir = await makeProject()
  const s = await script(
    dir,
    'start.mjs',
    `process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'project conventions'}}))`,
  )
  await writeHooks(dir, { hooks: { SessionStart: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent, injected } = fakeAgent(dir)
  const h = await mount()
  await h.listeners.get('agent/created')[0]({ agent, source: 'startup', signal: undefined })
  assert.equal(injected.length, 1)
  assert.equal(injected[0].content[0].text, 'project conventions')
})

await test('集成：Stop 阻断会 steer，且连续超过上限后放行', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'stop.mjs', `process.stdout.write(JSON.stringify({decision:'block',reason:'keep going'}))`)
  await writeHooks(dir, { hooks: { Stop: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent, steered } = fakeAgent(dir)
  const h = await mount()
  const handler = h.listeners.get('agent/turn-stopping')[0]
  for (let i = 0; i < 4; i++) await handler({ agent, turn: i + 1, signal: undefined })
  assert.equal(steered.length, 3, '应只强制续跑 3 次')
  assert.equal(steered[0].content[0].text, 'keep going')
  assert.ok(
    h.logs.some((entry) => entry.level === 'warn' && /上限/.test(entry.message)),
    '应打出一条达到上限的 warn',
  )
})

await test('集成：Stop 不阻断时不 steer', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'nostop.mjs', 'process.exit(0)')
  await writeHooks(dir, { hooks: { Stop: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent, steered } = fakeAgent(dir)
  const h = await mount()
  await h.listeners.get('agent/turn-stopping')[0]({ agent, turn: 1, signal: undefined })
  assert.equal(steered.length, 0)
})

await test('集成：项目没有 .dsh/hooks.json 时原样放行且无 warn 噪音', async () => {
  const dir = await makeProject()
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const decision = await h.listeners.get('tools/pre-execute')[0]({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)
  assert.deepEqual(decision, { kind: 'allow' })
  assert.equal(h.logs.filter((entry) => entry.level === 'warn').length, 0)
})

await test('集成：projectRoot 是最近的含 .git 祖先，子目录会话也命中项目配置', async () => {
  const dir = await makeProject('packages/app/src')
  const s = await script(dir, 'root.mjs', `process.stderr.write('from project root');process.exit(2)`)
  await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(path.join(dir, 'packages', 'app', 'src'))
  const h = await mount()
  const decision = await h.listeners.get('tools/pre-execute')[0]({ name: 'any', arguments: {}, callId: 'c', agent }, nextAllow)
  assert.equal(decision.kind, 'deny')
  assert.equal(decision.reason, 'from project root')
})

await test('集成：hook 命令不存在时非阻断', async () => {
  const dir = await makeProject()
  await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: 'definitely-not-a-real-command-xyz-123' }] }] } })
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const decision = await h.listeners.get('tools/pre-execute')[0]({ name: 'any', arguments: {}, callId: 'c', agent }, nextAllow)
  assert.deepEqual(decision, { kind: 'allow' })
})

await test('集成：hook 超时是非阻断且快速返回', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'slow.mjs', 'setTimeout(()=>{},30000)')
  await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ timeout: 1, command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const started = Date.now()
  const decision = await h.listeners.get('tools/pre-execute')[0]({ name: 'any', arguments: {}, callId: 'c', agent }, nextAllow)
  assert.deepEqual(decision, { kind: 'allow' })
  assert.ok(Date.now() - started < 20000, '超时应当很快返回')
})

await test('集成：stdin payload 形状与 DSH_PROJECT_DIR 环境变量', async () => {
  const dir = await makeProject()
  const s = await script(
    dir,
    'echo.mjs',
    READ_STDIN +
      `process.stderr.write(JSON.stringify({e:payload.hook_event_name,s:payload.session_id,c:payload.cwd,` +
      `t:payload.tool_name,a:payload.tool_input,u:payload.tool_use_id,env:process.env.DSH_PROJECT_DIR,` +
      `tp:payload.transcript_path}));process.exit(2)});`,
  )
  await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const decision = await h.listeners.get('tools/pre-execute')[0](
    { name: 'pwsh', arguments: { command: 'ls' }, callId: 'call-42', agent },
    nextAllow,
  )
  const payload = JSON.parse(decision.reason)
  assert.equal(payload.e, 'PreToolUse')
  assert.equal(payload.s, 'session-test')
  assert.equal(payload.t, 'pwsh')
  assert.deepEqual(payload.a, { command: 'ls' })
  assert.equal(payload.u, 'call-42')
  assert.equal(payload.c, dir)
  assert.equal(payload.tp, '', 'transcript_path 恒为空串')
  assert.equal(payload.env, dir, 'DSH_PROJECT_DIR 应被注入')
})

await test('集成：用户级 $DSH_HOME/hooks.json 与项目级同时生效（用户级在前）', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-home-verify-'))
  tmpRoots.push(home)
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const userScript = await script(home, 'user.mjs', `process.stderr.write('user');process.exit(2)`)
    await fsp.writeFile(
      path.join(home, 'hooks.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: cmd(userScript) }] }] } }),
      'utf8',
    )
    const dir = await makeProject()
    const projectScript = await script(dir, 'project.mjs', `process.stderr.write('project');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: cmd(projectScript) }] }] } })

    const { agent } = fakeAgent(dir)
    const h = await mount()
    const decision = await h.listeners.get('tools/pre-execute')[0]({ name: 'any', arguments: {}, callId: 'c', agent }, nextAllow)
    assert.equal(decision.kind, 'deny')
    assert.equal(decision.reason, 'user\n\nproject', '同档理由应全部拼接，用户级在前')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

await test('集成：dispose 的清理函数不抛', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'ok.mjs', 'process.exit(0)')
  await writeHooks(dir, { hooks: { Stop: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const h = await mount()
  await h.listeners.get('agent/turn-stopping')[0]({ agent, turn: 1, signal: undefined })
  for (const disposer of h.disposers) {
    if (typeof disposer === 'function') await disposer()
  }
})

await test('集成：hooks.json 带 UTF-8 BOM 也能读到（PowerShell 写文件的常见坑）', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'bom.mjs', `process.stderr.write('bom ok');process.exit(2)`)
  await fsp.mkdir(path.join(dir, '.dsh'), { recursive: true })
  await fsp.writeFile(
    path.join(dir, '.dsh', 'hooks.json'),
    '\uFEFF' + JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: cmd(s) }] }] } }),
    'utf8',
  )
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const decision = await h.listeners.get('tools/pre-execute')[0]({ name: 'any', arguments: {}, callId: 'c', agent }, nextAllow)
  assert.deepEqual(decision, { kind: 'deny', reason: 'bom ok' })
})

await test('集成：负结果会过期 —— 先干活、后建 hooks.json 也能生效', async () => {
  const dir = await makeProject()
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const handler = h.listeners.get('tools/pre-execute')[0]

  // 1) 此刻项目里还没有 .dsh/hooks.json
  const before = await handler({ name: 'any', arguments: {}, callId: 'c', agent }, nextAllow)
  assert.deepEqual(before, { kind: 'allow' })

  // 2) 项目"开始干活之后"才建配置（模拟真实场景）
  const s = await script(dir, 'late.mjs', `process.stderr.write('late config');process.exit(2)`)
  await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: cmd(s) }] }] } })

  // 3) 超过 NEGATIVE_TTL_MS 后必须自动生效，不需要重启
  assert.ok(NEGATIVE_TTL_MS <= 5000, '负结果缓存不应过长')
  await new Promise((resolve) => setTimeout(resolve, NEGATIVE_TTL_MS + 400))

  const after = await handler({ name: 'any', arguments: {}, callId: 'c', agent }, nextAllow)
  assert.equal(after.kind, 'deny', '过期后应重新读到配置')
  assert.equal(after.reason, 'late config')
})

await test('集成：exec.agent 缺失时退化到 ctx.agents.currentInitiator()', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'ini.mjs', `process.stderr.write('via initiator');process.exit(2)`)
  await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const h = await mount({ initiator: agent })
  // exec 里**没有** agent —— 只有 currentInitiator 能救它
  const decision = await h.listeners.get('tools/pre-execute')[0]({ name: 'any', arguments: {}, callId: 'c' }, nextAllow)
  assert.equal(decision.kind, 'deny')
  assert.equal(decision.reason, 'via initiator')
})

await test('集成：exec.agent 与 initiator 都缺失时不抛、仍返回合法 decision', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'never.mjs', 'process.exit(2)')
  await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: cmd(s) }] }] } })
  const h = await mount()
  const decision = await h.listeners.get('tools/pre-execute')[0]({ name: 'any', arguments: {}, callId: 'c' }, nextAllow)
  // 退化到 process.cwd()，那个项目根不是 temp 项目，所以放行 —— 关键是**不能抛**
  assert.ok(decision && typeof decision.kind === 'string')
})

//#region 3b. 热重载 / 缓存失效（这次修复的重点）

/** 在隔离的 DSH_HOME 下跑一段测试，保证"用户级配置"读不到真实机器上的文件。 */
async function withIsolatedHome(fn) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-home-verify-'))
  tmpRoots.push(home)
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await fn(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
}

await test('集成：ctx.fs 不提供 watch() 时 hook 仍工作，且每条路径只 warn 一次（不刷屏）', async () => {
  await withIsolatedHome(async (home) => {
    const dir = await makeProject()
    const s = await script(dir, 'nowatch.mjs', `process.stderr.write('no watch ok');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: cmd(s) }] }] } })
    const { agent } = fakeAgent(dir)
    // 刻意**不给** watch 方法：以前这里是静默早退，看不出"没挂上"还是"挂了没事件"。
    const h = await mount({ fs: makeFs({ watch: 'none' }) })
    const handler = h.listeners.get('tools/pre-execute')[0]
    const call = (id) => handler({ name: 'any', arguments: {}, callId: id, agent }, nextAllow)

    const first = await call('c1')
    assert.equal(first.kind, 'deny', '没有 watcher 也必须照常跑 hook（非阻断失败原则）')
    assert.equal(first.reason, 'no watch ok')

    const watchWarns = () => h.logs.filter((e) => e.level === 'warn' && /不提供 watch/.test(e.message))
    assert.equal(watchWarns().length, 3, '三条监听路径各应有一条 warn（不是每个 hook 事件一条）')
    for (const p of [path.join(dir, '.dsh'), path.join(dir, '.dsh', 'hooks.json'), path.join(home, 'hooks.json')]) {
      assert.ok(watchWarns().some((e) => e.message.includes(p)), `warn 文案里应带路径：${p}`)
    }

    // 继续触发，并跨过一次正结果 TTL 到期：都不应重复告警。
    await call('c2')
    await new Promise((resolve) => setTimeout(resolve, POSITIVE_TTL_MS + 400))
    await call('c3')
    assert.equal(watchWarns().length, 3, 'TTL 重读之后也不应重复告警')
  })
})

await test('集成：watch() 挂载失败时每条路径只 warn 一次（跨 TTL 重试也不刷屏）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const s = await script(dir, 'watchfail.mjs', 'process.exit(0)')
    await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: cmd(s) }] }] } })
    const { agent } = fakeAgent(dir)
    const fsImpl = makeFs({})
    fsImpl.watch = async () => {
      throw new Error('watch unsupported by this provider')
    }
    const h = await mount({ fs: fsImpl })
    const handler = h.listeners.get('tools/pre-execute')[0]
    const call = () => handler({ name: 'any', arguments: {}, callId: 'c', agent }, nextAllow)

    await call()
    const fails = () => h.logs.filter((e) => e.level === 'warn' && /无法监听/.test(e.message))
    assert.equal(fails().length, 3, '三条路径各 warn 一次')

    // 正结果 TTL 到期会重试挂载：失败告警不应随重试次数增长。
    await new Promise((resolve) => setTimeout(resolve, POSITIVE_TTL_MS + 400))
    await call()
    assert.equal(fails().length, 3, 'TTL 周期重试不应重复告警')
  })
})

await test('集成：正结果 TTL 到期后会重新读配置（watcher 静默失效时的自愈）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const a = await script(dir, 'ttl-a.mjs', `process.stderr.write('ttl A');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(a) }] }] } })
    const { agent } = fakeAgent(dir)
    // watch 挂得上但永远不投递事件 —— 正是"监听器静默失效"的形态。
    const h = await mount({ fs: makeFs({}) })
    const handler = h.listeners.get('tools/pre-execute')[0]
    const call = () => handler({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)

    assert.equal((await call()).reason, 'ttl A')
    const b = await script(dir, 'ttl-b.mjs', `process.stderr.write('ttl B');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(b) }] }] } })

    assert.ok(POSITIVE_TTL_MS >= 3000 && POSITIVE_TTL_MS <= 5000, '正结果兜底 TTL 应在 3–5s')
    assert.equal((await call()).reason, 'ttl A', '未到期前仍用缓存')
    await new Promise((resolve) => setTimeout(resolve, POSITIVE_TTL_MS + 400))
    assert.equal((await call()).reason, 'ttl B', 'TTL 到期后必须重新读取，而不是永久用旧配置')
  })
})

await test('集成：未到期不重复读、到期只重读一次（读次数可断言）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const cfgPath = path.join(dir, '.dsh', 'hooks.json')
    const s = await script(dir, 'count.mjs', `process.stderr.write('counted');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: cmd(s) }] }] } })
    let reads = 0
    const { agent } = fakeAgent(dir)
    const h = await mount({
      fs: makeFs({
        onRead: (target) => {
          if (target.displayPath === cfgPath) reads += 1
        },
      }),
    })
    const handler = h.listeners.get('tools/pre-execute')[0]
    const call = () => handler({ name: 'any', arguments: {}, callId: 'c', agent }, nextAllow)

    await call()
    assert.equal(reads, 1, '首次加载读一次项目配置')
    await call()
    await call()
    assert.equal(reads, 1, '未到期时命中缓存 —— 单次事件内 / 事件之间都不重复读')

    await new Promise((resolve) => setTimeout(resolve, POSITIVE_TTL_MS + 400))
    await call()
    assert.equal(reads, 2, '到期后只重读一次')
    await call()
    assert.equal(reads, 2, '重读出来的正结果又被缓存住')
  })
})

await test('集成：watcher 回调触发时立刻失效缓存并打一条 info（含 path）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const a = await script(dir, 'w-a.mjs', `process.stderr.write('w A');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(a) }] }] } })
    const captured = []
    const { agent } = fakeAgent(dir)
    const h = await mount({ fs: makeFs({ watch: 'capture', captured }) })
    const handler = h.listeners.get('tools/pre-execute')[0]
    const call = () => handler({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)

    assert.equal((await call()).reason, 'w A')
    assert.equal(captured.length, 3, '`<root>/.dsh`、`hooks.json`、用户级 hooks.json 三条路径都要挂上')

    // 换配置后**不等 TTL**：只有 watcher 回调能让它立刻生效。
    const b = await script(dir, 'w-b.mjs', `process.stderr.write('w B');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(b) }] }] } })
    for (const { changed } of captured) changed()

    assert.equal((await call()).reason, 'w B', '失效回调应立刻丢掉缓存')
    const invalidated = () => h.logs.filter((e) => e.level === 'info' && /监听到变化/.test(e.message))
    assert.equal(invalidated().length, 3, '三条被监听的路径各打一条 info（按 path 各一条）')
    assert.ok(
      invalidated().some((e) => e.message.includes(path.join(dir, '.dsh', 'hooks.json'))),
      'info 文案里应带触发失效的路径',
    )

    // 同一个 path 在限流窗口内被重复触发时不应再打日志（避免热路径刷屏）。
    const before = invalidated().length
    for (const { changed } of captured) changed()
    assert.equal(invalidated().length, before, '同一 path 在限流窗口内不重复打日志')
  })
})

//#region 3d. fail-open：解析失败必须保持上一份可用配置（P1 修复的重点）
//
// `readJsonFile` 的三态语义：
//   absent  文件不存在   → 合法的"这份配置是空的"
//   ok      解析成功     → 用它，并刷新 last-good
//   error   读到但坏了   → **沿用 last-good**，绝不静默放开
//
// 本区用 watcher 回调强制失效（不 sleep），既快，走的又是生产上的真实失效通道。

/** 挂上带 capture 的假 fs，并返回"强制失效"函数（`fsOptions` 透传给 `makeFs`）。 */
async function mountCaptured(options = {}, fsOptions = {}) {
  const captured = []
  const h = await mount({ ...options, fs: makeFs({ ...fsOptions, watch: 'capture', captured }) })
  return {
    h,
    invalidate: () => {
      for (const { changed } of captured) changed()
    },
  }
}

await test('fail-open：hooks.json 写坏后必须继续沿用上一份可用配置（deny 不能消失）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const s = await script(dir, 'failopen.mjs', `process.stderr.write('guard alive');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(s) }] }] } })
    const { agent } = fakeAgent(dir)
    const { h, invalidate } = await mountCaptured()
    const handler = h.listeners.get('tools/pre-execute')[0]
    const call = () => handler({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)

    assert.equal((await call()).reason, 'guard alive', '基线：正常配置必须拦得住')

    // 写坏文件（模拟编辑器写一半 / 并发写入 / 手改错一个字符），立刻走真实失效通道。
    await fsp.writeFile(path.join(dir, '.dsh', 'hooks.json'), '{"hooks": {', 'utf8')
    invalidate()

    const after = await call()
    assert.equal(after.kind, 'deny', '解析失败绝不能静默放开——这正是修复前的形态')
    assert.equal(after.reason, 'guard alive', '沿用的必须是"上一份可以解析"的配置')

    const parseWarns = () => h.logs.filter((e) => e.level === 'warn' && /读取 .*hooks\.json 失败/.test(e.message))
    assert.equal(parseWarns().length, 1, '同一条错误只 warn 一次')

    // 再失效一次、再调用：同一条错误不应重复告警。
    invalidate()
    await call()
    assert.equal(parseWarns().length, 1, '跨重读不重复告警（否则 TTL 周期会刷屏）')
    assert.ok(
      h.logs.some((e) => e.level === 'info' && /沿用上一份可用配置/.test(e.message)),
      '沿用旧配置这件事必须留痕，否则宿主日志里看不出"为什么改的配置没生效"',
    )
  })
})

await test('fail-open：配置被**删除**时必须真的清空（缺失 ≠ 读不出来）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const s = await script(dir, 'gone.mjs', `process.stderr.write('gone guard');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(s) }] }] } })
    const { agent } = fakeAgent(dir)
    const { h, invalidate } = await mountCaptured()
    const handler = h.listeners.get('tools/pre-execute')[0]
    const call = () => handler({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)

    assert.equal((await call()).kind, 'deny')

    await fsp.rm(path.join(dir, '.dsh', 'hooks.json'))
    invalidate()

    const after = await call()
    assert.equal(after.kind, 'allow', 'ENOENT 是合法的"没有配置"：必须真的停掉 hook，不能 fail-safe 到旧配置')
    // 缺文件不该产生"读取失败"告警（项目还没建 hooks.json 是常态）。
    assert.equal(
      h.logs.filter((e) => e.level === 'warn' && /读取 .*hooks\.json 失败/.test(e.message)).length,
      0,
      '文件不存在不是错误，不许刷告警',
    )
  })
})

await test('fail-open：顶层不是对象的 JSON 也算"读不出来"（不是空配置）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const s = await script(dir, 'nonobj.mjs', `process.stderr.write('obj guard');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(s) }] }] } })
    const { agent } = fakeAgent(dir)
    const { h, invalidate } = await mountCaptured()
    const handler = h.listeners.get('tools/pre-execute')[0]
    const call = () => handler({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)

    assert.equal((await call()).kind, 'deny')

    // 合法 JSON，但顶层是字符串：修之前会被 `isObject` 判成 undefined → 当成"没有配置"。
    await fsp.writeFile(path.join(dir, '.dsh', 'hooks.json'), '"not an object"', 'utf8')
    invalidate()

    const after = await call()
    assert.equal(after.kind, 'deny', '顶层不是对象同样是坏配置，必须沿用上一份')
    assert.equal(after.reason, 'obj guard')
    assert.ok(
      h.logs.some((e) => e.level === 'warn' && /顶层不是 JSON 对象/.test(e.message)),
      '这条错误要有专门文案，用户才知道该把文件改回对象',
    )
  })
})

await test('fail-open：修好文件后按新配置跑，且错误计数重置（新错误重新告警）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const file = path.join(dir, '.dsh', 'hooks.json')
    const a = await script(dir, 'fo-a.mjs', `process.stderr.write('old');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(a) }] }] } })
    const { agent } = fakeAgent(dir)
    const { h, invalidate } = await mountCaptured()
    const handler = h.listeners.get('tools/pre-execute')[0]
    const call = () => handler({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)
    const parseWarns = () => h.logs.filter((e) => e.level === 'warn' && /读取 .*hooks\.json 失败/.test(e.message))

    assert.equal((await call()).reason, 'old')
    await fsp.writeFile(file, '{ broken', 'utf8')
    invalidate()
    assert.equal((await call()).reason, 'old', '坏文件期间沿用旧配置')
    assert.equal(parseWarns().length, 1)

    // 修好并换成另一条命令：必须按**新**配置跑（last-good 要被刷新）。
    const b = await script(dir, 'fo-b.mjs', `process.stderr.write('new');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(b) }] }] } })
    invalidate()
    assert.equal((await call()).reason, 'new', '修好之后必须立刻按新配置跑')
    assert.equal(parseWarns().length, 1, '成功读取后不应产生新的错误告警（之前的记录被清掉）')

    // 再坏一次：这是一条**新的**错误，必须重新告警一次。
    await fsp.writeFile(file, '{ broken again', 'utf8')
    invalidate()
    assert.equal((await call()).reason, 'new', '再次沿用最近一次成功的那份（已是 new）')
    assert.equal(parseWarns().length, 2, '成功读取后错误记录重置，新错误要重新告警')
  })
})

//#endregion

//#region 3e. C2 版本核对：stat().version 作为失效主通道（watcher 只是加速器，TTL 只是兜底）

await test('C2：provider 给出 version 时，内容没变则 TTL 到期也不重读（省 I/O）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const s = await script(dir, 'v-stable.mjs', `process.stderr.write('stable');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(s) }] }] } })
    const { agent } = fakeAgent(dir)
    const reads = []
    const h = await mount({ fs: makeFs({ version: true, onRead: (target) => reads.push(target.displayPath) }) })
    const handler = h.listeners.get('tools/pre-execute')[0]
    const call = () => handler({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)

    assert.equal((await call()).reason, 'stable')
    const baseline = reads.length
    assert.ok(baseline >= 1, '首次必须真读一次')

    // 跨过正结果 TTL：**没有版本通道时这里会重读**；有版本且内容没变则不该重读。
    await new Promise((resolve) => setTimeout(resolve, POSITIVE_TTL_MS + 400))
    assert.equal((await call()).reason, 'stable')
    assert.equal(reads.length, baseline, '版本没变就不重读：TTL 只是"provider 没有 version"时的兜底')
  })
})

await test('C2：内容一变就立刻重读（不必等 TTL）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const a = await script(dir, 'v1.mjs', `process.stderr.write('v1');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(a) }] }] } })
    const { agent } = fakeAgent(dir)
    const h = await mount({ fs: makeFs({ version: true }) })
    const handler = h.listeners.get('tools/pre-execute')[0]
    const call = () => handler({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)

    assert.equal((await call()).reason, 'v1')

    const b = await script(dir, 'v2.mjs', `process.stderr.write('v2');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(b) }] }] } })
    // **故意不 sleep**：TTL 远未到期，只有版本核对才能让新配置在这里生效。
    assert.equal((await call()).reason, 'v2', '版本变了必须在下一个事件点就生效，而不是等 TTL')
  })
})

await test('C2：stat 抛错时只降级成 TTL 语义，绝不丢 last-good', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const s = await script(dir, 'v-stat-throw.mjs', `process.stderr.write('still guarded');process.exit(2)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(s) }] }] } })
    const { agent } = fakeAgent(dir)
    const captured = []
    const fsImpl = makeFs({ version: true, watch: 'capture', captured })
    const h = await mount({ fs: fsImpl })
    const handler = h.listeners.get('tools/pre-execute')[0]
    const call = () => handler({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)
    const invalidate = () => {
      for (const { changed } of captured) changed()
    }

    assert.equal((await call()).reason, 'still guarded', '基线')

    // provider 的 stat 从此失败（ACL 抖动 / 服务故障）：版本通道不可用 → 退回 TTL 语义。
    fsImpl.stat = async () => {
      throw new Error('EPERM: stat denied by sandbox')
    }
    invalidate()

    const after = await call()
    assert.equal(after.kind, 'deny', 'stat 失败也不许静默放开')
    assert.equal(after.reason, 'still guarded', 'stat 失败必须沿用 last-good，而不是把它丢掉')
  })
})

//#endregion

//#region 3c. hook 的沙箱策略透传（落盘类 hook 能不能写，全看这里）

await test('集成：hook 子进程按**调用会话**的沙箱策略跑（否则格式化类 hook 会静默 EPERM）', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'policy.mjs', `process.stderr.write('policy ok');process.exit(2)`)
  await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const resolved = []
  const sandboxPolicy = {
    resolve(request) {
      resolved.push(request)
      return { mode: 'workspace-write', workspaceRoot: dir, sessionId: 'session-test' }
    },
  }
  const h = await mount({ sandboxPolicy })
  const decision = await h.listeners.get('tools/pre-execute')[0]({ name: 'any', arguments: {}, callId: 'c', agent }, nextAllow)

  assert.equal(decision.kind, 'deny', '透传策略不能影响 hook 判定')
  assert.equal(resolved.length, 1, '每个 hook 事件只解析一次策略')
  assert.equal(resolved[0].session, agent.session, '必须带 session，会话级档位覆盖才会生效')
  assert.deepEqual(lastShellRequest().sandboxPolicy, {
    mode: 'workspace-write',
    workspaceRoot: dir,
    sessionId: 'session-test',
  })
  assert.ok(
    h.logs.some((e) => e.level === 'info' && /sandbox=workspace-write/.test(e.message)),
    '每次 hook 执行的日志里应带上实际用的档位',
  )
})

await test('集成：会话是 read-only 时 hook 原样拿到 read-only（不透传 = 不提权）', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'ro.mjs', 'process.exit(0)')
  await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const sandboxPolicy = { resolve: () => ({ mode: 'read-only', workspaceRoot: dir }) }
  const h = await mount({ sandboxPolicy })
  await h.listeners.get('tools/pre-execute')[0]({ name: 'any', arguments: {}, callId: 'c', agent }, nextAllow)
  assert.deepEqual(lastShellRequest().sandboxPolicy, { mode: 'read-only', workspaceRoot: dir })
})

await test('集成：拿不到 sandboxPolicy 服务时省略该字段（回退部署策略），hook 照常工作', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'nopolicy.mjs', `process.stderr.write('no policy');process.exit(2)`)
  await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const h = await mount() // 不提供 sandboxPolicy 服务
  const decision = await h.listeners.get('tools/pre-execute')[0]({ name: 'any', arguments: {}, callId: 'c', agent }, nextAllow)
  assert.equal(decision.kind, 'deny')
  assert.equal(decision.reason, 'no policy')
  assert.ok(!('sandboxPolicy' in lastShellRequest()), '拿不到策略时不应传该字段')
})

await test('集成：sandboxPolicy.resolve 抛错时非阻断、回退部署策略并 warn', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'policyerr.mjs', `process.stderr.write('policy error fallback');process.exit(2)`)
  await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const sandboxPolicy = {
    resolve() {
      throw new Error('sessionProjections unavailable')
    },
  }
  const h = await mount({ sandboxPolicy })
  const decision = await h.listeners.get('tools/pre-execute')[0]({ name: 'any', arguments: {}, callId: 'c', agent }, nextAllow)
  assert.equal(decision.kind, 'deny', '策略解析失败不能拖垮 hook')
  assert.equal(decision.reason, 'policy error fallback')
  assert.ok(!('sandboxPolicy' in lastShellRequest()))
  assert.ok(
    h.logs.some((e) => e.level === 'warn' && /解析沙箱策略失败/.test(e.message)),
    '应有一条降级 warn',
  )
})

await test('集成：SubagentStart 的 hook 也按子会话的策略跑', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'sub.mjs', 'process.exit(0)')
  await writeHooks(dir, { hooks: { SubagentStart: [{ hooks: [{ command: cmd(s) }] }] } })
  const child = {
    session: { header: { id: 'child-session', cwd: dir } },
    inject() {},
    steer() {},
  }
  const sandboxPolicy = { resolve: (request) => ({ mode: 'danger-full-access', workspaceRoot: dir, byChild: request.session === child.session }) }
  const h = await mount({ sandboxPolicy })
  h.agents.set('child-1', child)
  h.listeners.get('subagent/start')[0]({ id: 'child-1', runId: 'run-1' })
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.deepEqual(lastShellRequest().sandboxPolicy, {
    mode: 'danger-full-access',
    workspaceRoot: dir,
    byChild: true,
  })
})

//#endregion

for (const dir of tmpRoots) {
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
}

console.log(`\ndsh-hooks verify: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\n失败明细：')
  for (const failure of failures) console.log(`  ✗ ${failure}\n`)
  process.exit(1)
}
console.log('全绿 ✅')

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

// 宿主产物：跑真实的 lib/index.js（esbuild 从 src/host/** 生成的**产物**）。
import { apply, inject, name } from '../lib/index.js'
// 纯协议层：**直接 import TS 源码**（Node ≥22.18 会剥类型），不经过产物 ——
// 这样纯函数单测压的是源码本身，产物没重新构建也能发现问题。
// （迁移期曾有一条经 lib/index.js 的 `internals` 做"旧实现 vs TS 实现"差分对拍的区，
//   `internals` 随 P3b 一起删掉了：产物就是源码，自己和自己对拍没有意义。）
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
import { DEFAULT_TIMEOUT_MS, HOOK_EVENTS, NEGATIVE_TTL_MS, POSITIVE_TTL_MS } from '../src/shared/constants.ts'
// 数据面：路由注册与**纯函数**快照构造都直接 import 源码，不需要挂载插件就能测。
import { HOOKS_ROUTE, buildSnapshot, registerHooksRoute } from '../src/host/data-plane.ts'
// 执行台账：有界缓冲与"最近一次真实执行"的匹配逻辑，纯逻辑直接单测。
import { ExecutionLedger, MAX_GLOBAL, MAX_PER_SESSION, MAX_TEXT_CHARS, latestRunFor } from '../src/host/ledger.ts'
// 写路径：定点操作、风格探测、保留性证明 —— 全是纯函数，直接单测。
import {
  applyOp,
  detectStyle,
  parseHooksRequest,
  preservationProblem,
  serialize,
  starterText,
} from '../src/host/write.ts'

// 客户端**写请求层**：唯一的"作用域 → 请求体"构造函数（§2.2）。纯函数，不需要浏览器 / react。
import {
  CURRENT_SCOPE,
  dryRunFor,
  intentFor,
  requestDryRun,
  requestWrite,
  scopeQuery,
  scopeTargetOf,
  writeErrorSentence,
} from '../src/client/write.ts'
// 错误码目录：宿主能返回的码 + 只在浏览器半边产生的码。两半共用**同一份**，并由 F 区做表驱动断言
// （02 票：以前客户端的文案表漏了 no-version 这类码，页面会把内部码当主文案显示）。
import { HOST_ERROR_CODES, SENTENCE_ERROR_CODES } from '../src/shared/errors.ts'
// 客户端**样式字符串**：注入的 CSS 没有 DOM 可量，所以 D 区对它做字面断言（popover 滚动 / 720px /
// 事件行 32px / 内容区按钮无描边）。它同时是预览生成器"只许用这一份 CSS"的比对基准。
import { styles } from '../src/client/styles.ts'
// 新建模板：D 区断言三个标签进了产物，P 区用**真子进程**把三条命令各跑一遍（模板不许是装饰品）。
import { HOOK_TEMPLATES } from '../src/client/templates.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.join(HERE, '..', 'lib', 'index.js')
const CLIENT = path.join(HERE, '..', 'lib', 'client.js')
const NODE = process.execPath

let passed = 0
let failed = 0
const failures = []

function test(title, fn) {
  const onError = (error) => {
    failed++
    // 失败详情多给几行：assert 的"实际 / 期望"是 message 的一部分，只截 3 行会把值截掉
    // （排查时最需要的那半句正好没了）。
    const detail = error && error.stack ? error.stack.split('\n').slice(0, 8).join('\n    ') : String(error)
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

//#region C. 客户端半边：包契约 + 产物协议 + 假 loader 真跑 factory

test('A：package.json 的客户端半边契约（exports["./client"] + dsh.client.platform）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'))
  // 声明了 dsh.client 却没有 exports["./client"] 时，官方运行时校验器会**直接抛错**。
  assert.equal(pkg.dsh.client.platform, 'web', '只有 platform === "web" 才会发布客户端半边')
  const entry = pkg.exports['./client']
  assert.equal(typeof entry, 'string', 'exports["./client"] 只接受字符串（或带字符串 default 的对象）')
  assert.equal(entry, './lib/client.js', '路径是相对 manifest 目录的（bundle 按 dirname(package.json) 解析）')
  assert.ok(fs.existsSync(path.join(HERE, '..', entry)), 'exports["./client"] 必须指向真实存在的文件')
})

test('A：发布元数据（icon / locale / exports / files）—— 每一条失效都是静默的', () => {
  const root = path.join(HERE, '..')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

  // ① `icon` 在**顶层**：官方 `dsh-app-boot` 读的是 `manifest.icon`
  //    （源码 `iconOf(manifest?.icon, manifestPath)`）。写成 `dsh.icon` 没人看。
  assert.equal(typeof pkg.icon, 'string', 'icon 必须是 package.json 的**顶层**字段')
  const iconPath = path.join(root, pkg.icon)
  assert.ok(fs.existsSync(iconPath), `icon 文件必须存在：${pkg.icon}`)
  assert.ok(fs.readFileSync(iconPath, 'utf8').trimStart().startsWith('<svg'), 'icon 必须是 SVG/PNG/JPEG/WebP')
  assert.ok(fs.statSync(iconPath).size <= 256 * 1024, 'icon 必须 ≤ 256 KiB（官方限制）')

  // ② locale：官方按 `<包>/locale/en.json` 找**英文兜底**、其余语言必须同目录
  //    （源码 `optionalResourcePath(`${specifier}/locale/en.json`)` + "must share the English locale directory"）。
  for (const file of ['locale/en.json', 'locale/zh.json']) {
    const full = path.join(root, file)
    assert.ok(fs.existsSync(full), `缺少 ${file}`)
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8'))
    assert.equal(typeof parsed.meta.title, 'string', `${file} 必须有 meta.title`)
    assert.ok(parsed.meta.title.length > 0, `${file} 的 meta.title 不许为空`)
    assert.equal(typeof parsed.meta.description, 'string', `${file} 必须有 meta.description`)
  }
  assert.equal(
    pkg.exports['./locale/*.json'],
    './locale/*.json',
    'locale 必须进 exports：否则 subpath 解析被 exports 挡住，界面静默不显示名字与图标',
  )

  // ③ files 白名单：产物与展示元数据要进包；源码 / 工具 / 文档 / 活配置**不许**进包
  for (const required of ['lib/**', 'icon.svg', 'locale/*.json', 'README.md']) {
    assert.ok(pkg.files.includes(required), `files 必须包含 ${required}`)
  }
  for (const forbidden of ['src', 'tools', 'docs', 'AGENTS.md', '.tmp', 'node_modules', '.dsh']) {
    assert.ok(
      !pkg.files.some((entry) => entry === forbidden || entry.startsWith(`${forbidden}/`)),
      `files 不许包含 ${forbidden}（源码与活配置不进包）`,
    )
  }
  assert.equal(pkg.dsh.manifestVersion, 1, 'dsh.manifestVersion 声明清单格式版本')
  // `lib/**` 会把 `lib/.types/**`（tsc 的中间产物）一起带进包 —— 它们既不在 exports 里（拿不到）、
  // 又会随手过期。`npm pack --dry-run` 实测抓到的就是这个。
  assert.ok(pkg.files.includes('!lib/.types/**'), 'files 必须排除 lib/.types/**（tsc 中间产物不该发布）')

  // ④ 「路线 2：bundle」装载所需的声明（`plugin_manager install_bundle` 读的就是这三处）。
  //    判据来自**可工作的兄弟包** `@qq540491950/dsh-mcp-manager`（它的 patch 由 profile 的
  //    `dsh.profile.bundles` 装载）：`dsh.bundle.patch` → 包内补丁层；补丁层的插件行必须在 `insert:`
  //    下；`name` **必须等于 package.json 的 name**（写错就是"装上了但加载不到"，而界面不报错）。
  assert.equal(pkg.dsh.bundle?.patch, './cordis.patch.yml', 'dsh.bundle.patch 必须指向包内的补丁层')
  const patchPath = path.join(root, 'cordis.patch.yml')
  assert.ok(fs.existsSync(patchPath), '缺 cordis.patch.yml：install_bundle 会装上一个没有插件行的 bundle')
  const patch = fs.readFileSync(patchPath, 'utf8')
  assert.ok(/^- insert:\s*$/m.test(patch), '插件行必须写在 `insert:` 下（顶层 `- id:` 是覆写，会被丢弃）')
  assert.ok(new RegExp(`^\\s*- id: ${pkg.name}\\s*$`, 'm').test(patch), `补丁层必须有 Loader 条目 id：${pkg.name}`)
  assert.ok(
    new RegExp(`^\\s*name: '${pkg.name}'\\s*$`, 'm').test(patch),
    `补丁层的 name 必须等于 package.json 的 name（${pkg.name}）`,
  )
  assert.equal(
    pkg.exports['./cordis.patch.yml'],
    './cordis.patch.yml',
    '补丁层必须进 exports：有 exports 时未声明的 subpath 会被挡住（拿不到 patch 文件）',
  )
  assert.ok(pkg.files.includes('cordis.patch.yml'), 'files 必须包含 cordis.patch.yml，否则发出去的包里没有它')
})

test('A：引擎声明与描述（不许被过期的 prerelease 钉死；描述不暴露内部座位号）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'))

  // ① 判据：npm 的 semver 规则下，**任何**含 prerelease 元组的范围（"0.2.0-rc.2" /
  //    "^0.2.0-rc.2" / ">=0.2.0-rc.2"）都**不**匹配"另一个元组"的 prerelease（例如 0.2.1-rc.3）——
  //    钉 rc 等于把自己锁死在那一台机器上。线上实测：运行时升到 0.2.1-rc.3 之后本包装不上
  //    （unmet engines 会阻断安装与激活），而 profile 里那条 loader 行也随之消失。
  const dshEngine = pkg.engines === undefined ? undefined : pkg.engines.dsh
  if (dshEngine !== undefined) {
    assert.equal(typeof dshEngine, 'string', 'engines.dsh 必须是字符串（semver 范围）')
    assert.ok(
      !/-(?:rc|beta|alpha|next|canary)\./i.test(dshEngine),
      `engines.dsh 不许出现 prerelease 元组（它只匹配同一个版本元组，换一个 rc 就装不上）：${dshEngine}`,
    )
  }
  assert.equal(typeof pkg.engines?.node, 'string', 'node 引擎要求必须保留 —— 它是真可判定的')

  // ② `description` 是 Plugin Manager 卡片上的**用户文案**：内部座位号（order 920）不该上屏。
  assert.equal(typeof pkg.description, 'string')
  assert.ok(!/order\s*\d+/i.test(pkg.description), `描述里不许出现座位顺序号：${pkg.description}`)
})

test('A：编码纪律（src/** + tools/** + lib/** 无 BOM、无 U+FFFD、LF、结尾换行）', () => {
  const root = path.join(HERE, '..')
  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else out.push(full)
    }
    return out
  }
  const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'tools')), ...walk(path.join(root, 'lib'))]
  assert.ok(files.length > 10, '应当扫到源码与产物（否则这条断言是空的）')
  const problems = []
  for (const file of files) {
    const bytes = fs.readFileSync(file)
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) problems.push(`${file}: 有 BOM`)
    const text = bytes.toString('utf8')
    if (text.includes('\uFFFD')) problems.push(`${file}: 有 U+FFFD（编码坏了）`)
    if (text.includes('\r\n')) problems.push(`${file}: 有 CRLF`)
    if (!text.endsWith('\n')) problems.push(`${file}: 结尾没有换行`)
  }
  assert.deepEqual(problems, [], '编码问题（AGENTS §4.8 每个阶段都要过这一关）')
})

test('C：客户端产物是 classic script + 恰好一个 factory + 恰好一个 require', () => {
  const source = fs.readFileSync(CLIENT, 'utf8')
  assert.equal((source.match(/^(import|export) /gm) || []).length, 0, '必须是 classic script，不是 ESM')
  assert.equal((source.match(/\.load\(/g) || []).length, 1, '只能注册一个 factory')
  assert.equal(
    (source.match(/window\.__ModuleLoader__/g) || []).length,
    1,
    '产物里只能有**一处**真正的注册调用（wrapper 由构建脚本注入；注释里的提及不算）',
  )
  // ⚠️ v4 起"只允许一个 require"必须**先去掉字符串字面量**再数：新建模板里的命令
  //   （`node -e "…require('node:fs')…"`）本身是一段**数据**（要交给子进程的 shell 命令），
  //   不是产物自己的模块依赖。不去掉字符串的话，这条断言会因为"模板里出现了 require 这个词"
  //   而红 —— 那是**平凡误报**，会逼着下一个人去放宽真正的防护。
  //   判据仍然精确：去掉字符串之后必须**只剩**那一个取 react 种子的 require。
  const stripStrings = (text) => text.replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  const countRequires = (text) => (text.match(/\brequire\s*\(/g) || []).length
  // ★ 这条判据本身必须双向验证过（§4.3），否则"去掉字符串"就是"把断言放宽到永远绿"：
  //   ① 代码里的两个 require 都要数到；② 字符串里的那个一个都不许数到（但去掉字符串**之前**数得到）。
  assert.equal(
    countRequires(stripStrings('const a=require("react");const b=require("node:fs")')),
    2,
    '★ 去掉字符串之后，代码里的 require 一个都不许漏（否则这条断言会放宽成永远绿）',
  )
  const embedded = 'const cmd = "node -e \\"require(\'node:fs\')\\""'
  assert.equal(countRequires(stripStrings(embedded)), 0, '★ 字符串字面量里的 require 不算产物依赖')
  assert.equal(countRequires(embedded), 1, '前提：去掉之前确实数得到那一个（否则上一条是平凡断言）')

  const codeOnly = stripStrings(source)
  const requires = codeOnly.match(/\brequire\s*\(/g) || []
  assert.equal(requires.length, 1, '只允许一个 require（源码里手写第二个就会被这条抓住；字符串里的 require 不算）')
  assert.ok(source.includes('require("react")'), '而且只能取平台种子模块 react')
  assert.ok(source.includes('id: "dsh-hooks"'), 'id 必须等于 package.json 的 name')
})

await test('C：假 loader 真跑 factory —— 经 ctx.inject(["slots"]) 注册 hooks/920', async () => {
  const source = fs.readFileSync(CLIENT, 'utf8')
  const loads = []
  // 源码里写的是 `window.__ModuleLoader__`，所以喂一个假 window 进去（局部作用域，不污染全局）。
  new Function('window', source)({ __ModuleLoader__: { load: (config) => loads.push(config) } })
  assert.equal(loads.length, 1, '脚本执行时必须恰好注册一次')
  assert.equal(loads[0].id, 'dsh-hooks')
  assert.equal(typeof loads[0].factory, 'function')

  // materialize：假 require 只认 react（第二个种子模块会让这条断言红）。
  const fakeReact = {
    createElement: () => null,
    Fragment: {},
    useCallback: (value) => value,
    useEffect: () => {},
    useMemo: (compute) => compute(),
    useState: (initial) => [initial, () => {}],
  }
  const exported = loads[0].factory((name) => {
    assert.equal(name, 'react', '客户端只允许取种子模块 react')
    return fakeReact
  })
  assert.equal(typeof exported.apply, 'function', '平台调用的是 exports.apply')

  // 调 apply：断言顺序与参数 —— inject(["slots"]) → slots.inject("settings.section") → register(...)
  const injectedServices = []
  const slotInjections = []
  const registrations = []
  const scope = {
    slots: {
      inject: (key, callback) => {
        slotInjections.push(key)
        return callback()
      },
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  const ctx = {
    inject: (services, callback) => {
      injectedServices.push(services)
      callback(scope)
      return () => {}
    },
  }
  exported.apply(ctx)

  assert.deepEqual(
    injectedServices,
    [['slots']],
    '必须在 ctx.inject(["slots"]) 里注册（缺 slots 的宿主里保持 inactive）',
  )
  assert.deepEqual(
    slotInjections,
    ['settings.section'],
    '必须走 slots.inject：未声明的座位直接 register 会抛 slot "..." is not declared',
  )
  assert.equal(registrations.length, 1)
  const options = registrations[0].options
  assert.equal(options.name, 'settings.section')
  assert.equal(options.id, 'hooks', 'list 座位必须给唯一 id')
  assert.equal(options.order, 920, 'order 必须排在 mcp/900 与 skills/910 之后')
  assert.equal(typeof options.label, 'function', 'label 可以是 thunk（官方按 locale 重新求值）')
  assert.equal(options.label(), 'Hooks')
  assert.equal(typeof registrations[0].component, 'function')
})

test('C：作用域 → 请求体的**唯一**构造函数（选中工作区时每个 op 都必须带 workspaceId）', () => {
  // 这条是 §2.2 的地基：只要有一个 op 的请求体漏了 `workspaceId`，宿主就会按会话 cwd 落笔
  // —— 页面看着 A 项目、改到 B 项目，而且**静默**。所以每个 op 都逐个验一遍。
  const ops = [
    { op: 'createFile' },
    { op: 'setHookDisabled', event: 'PreToolUse', groupIndex: 0, hookIndex: 1, disabled: true },
    { op: 'setHookCommand', event: 'PreToolUse', groupIndex: 0, hookIndex: 1, command: 'x' },
    { op: 'setHookTimeout', event: 'PreToolUse', groupIndex: 0, hookIndex: 1, timeoutSec: 30 },
    { op: 'setGroupMatcher', event: 'PreToolUse', groupIndex: 0, matcher: null },
    { op: 'addHook', event: 'PreToolUse', groupIndex: 0, command: 'x', timeoutSec: null },
    { op: 'addGroup', event: 'PreToolUse', matcher: 'pwsh', command: 'x', timeoutSec: null },
    { op: 'removeHook', event: 'PreToolUse', groupIndex: 0, hookIndex: 1 },
    { op: 'moveHook', event: 'PreToolUse', groupIndex: 0, hookIndex: 1, direction: 1 },
    { op: 'removeGroup', event: 'PreToolUse', groupIndex: 0 },
  ]
  for (const op of ops) {
    const workspaceBody = intentFor('w-1', op)
    assert.equal(workspaceBody.file, 'project', `${op.op}：工作区作用域 → file 必须是 project`)
    assert.equal(workspaceBody.workspaceId, 'w-1', `${op.op}：★ 选中工作区时**必须**带 workspaceId（§2.2）`)
    const userBody = intentFor('user', op)
    assert.equal(userBody.file, 'user', `${op.op}：用户级作用域 → file 必须是 user`)
    assert.equal('workspaceId' in userBody, false, `${op.op}：用户级作用域不许带 workspaceId`)
  }
  // 试运行同一套寻址
  assert.deepEqual(dryRunFor('w-1', { event: 'PreToolUse', groupIndex: 0, hookIndex: 1 }), {
    file: 'project',
    workspaceId: 'w-1',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 1,
  })
  assert.equal('workspaceId' in dryRunFor('user', { event: 'Stop', groupIndex: 0, hookIndex: 0 }), false)
  // ★ `'current'`（**当前会话的项目**）：它必须**不带** workspaceId —— 带上就等于谎称"它是某个
  //   工作区"，宿主会照白名单去查 → `unknown-workspace`（404）。这是"会话项目不在清单里时页面
  //   也能编辑它"的唯一落地方式。
  assert.deepEqual(scopeTargetOf(CURRENT_SCOPE), { file: 'project' })
  assert.equal('workspaceId' in scopeTargetOf(CURRENT_SCOPE), false)
  assert.deepEqual(intentFor(CURRENT_SCOPE, { op: 'createFile' }), { file: 'project', op: 'createFile' })
  for (const op of ops) {
    const body = intentFor(CURRENT_SCOPE, op)
    assert.equal(body.file, 'project', `${op.op}：当前会话项目 → file 必须是 project`)
    assert.equal('workspaceId' in body, false, `${op.op}：当前会话项目**不许**带 workspaceId（带=404）`)
  }
  assert.equal('workspaceId' in dryRunFor(CURRENT_SCOPE, { event: 'Stop', groupIndex: 0, hookIndex: 0 }), false)
  // 读也必须定点（否则看的是当前会话项目、写的是选中的工作区 —— 另一条"看着 A 改到 B"）
  assert.equal(scopeQuery('user'), '?scope=user')
  assert.equal(scopeQuery(CURRENT_SCOPE), '?scope=current', '当前会话项目走 scope=current（不是 workspace）')
  assert.equal(scopeQuery('w-1'), '?scope=workspace&workspaceId=w-1')
  assert.equal(scopeQuery('a b&c'), '?scope=workspace&workspaceId=a%20b%26c')
})

//#endregion

//#region D. 真实渲染（假 React + 假 fetch；渲染的是**产物里注册到座位上的那个组件**）

/**
 * 极简假 React —— 只够跑本插件这一个组件。
 * `useState` **按位置**发值（§4.6 记的维护陷阱）：`cursor` 每次渲染归零，值跨渲染保留。
 * `useEffect` 只收集、由驱动执行一次（对应 `[]` 依赖）。`<style>` 的内容不算页面文案。
 */
function createFakeReact() {
  const store = { values: [], effects: [], dirty: false }
  let cursor = 0
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: 'Fragment',
    useState(initial) {
      const index = cursor++
      if (!(index in store.values)) store.values[index] = initial
      return [
        store.values[index],
        (value) => {
          // 与真实 React 同语义：函数式更新拿到**当前值**（如 `setNonce(v => v + 1)`）。
          // 第一版直接存函数 —— "依赖里换了个函数"被当成"状态变了"，多数场景看起来一样，
          // 但组件一旦真的读这个值（例如 popover 的高亮下标）就会静默算错。
          store.values[index] = typeof value === 'function' ? value(store.values[index]) : value
          store.dirty = true
        },
      ]
    },
    useEffect: (effect) => {
      store.effects.push(effect)
    },
    useMemo: (compute) => compute(),
    useCallback: (fn) => fn,
  }
  const flatten = (node, out = [], parentClass = '') => {
    if (node === null || node === undefined || typeof node === 'boolean') return out
    if (Array.isArray(node)) {
      for (const child of node) flatten(child, out, parentClass)
      return out
    }
    if (typeof node === 'string' || typeof node === 'number') {
      const text = String(node)
      // ★ 通用护栏：页面上**不许出现 markdown 语法**。
      // 真机截图上出现过字面的 `**agent-go**`（把 JSX 当 markdown 写了）—— 这条检查挂在**渲染**上，
      // 于是 D 区每一个场景都自动受它保护，而不是靠某条断言碰巧覆盖到。
      assert.ok(
        !text.includes('**') && !text.includes('`') && !text.includes('##'),
        `渲染出的文本里出现了 markdown 语法（要强调请用 <strong>）：${JSON.stringify(text)}`,
      )
      out.push({ text, parentClass })
      return out
    }
    if (typeof node.type === 'string' && node.type === 'style') return out
    // **展开函数组件**：这才是最小必要的"reconcile" —— 不展开的话 `HookCard` / `ScopePicker` /
    // `NewHookForm` 的内部永远渲染不出来（第一版就踩了这个坑：断言看到 0 个事件名）。
    // 限制：只支持**不用 hook 的子组件**（本页只有最外层用 useState/useEffect）。
    if (typeof node.type === 'function') return flatten(node.type(node.props), out, parentClass)
    const props = node.props ?? {}
    const className = typeof props.className === 'string' ? props.className : ''
    out.push({
      className,
      // **父容器的类名** —— 有了它才能断言"label 与它的控件在同一个容器里"（F1 那条布局缺陷
      // 光看扁平列表是看不出来的：两行里的 label 和 input 长得一模一样）。
      parentClass,
      title: typeof props.title === 'string' ? props.title : '',
      // `onClick` / `onKeyDown` 要留着：渲染测试得能**真的点/真的按键**
      // （§4.5：事件闭包是当次渲染的，交互之后要重新渲染再看）。
      onClick: typeof props.onClick === 'function' ? props.onClick : undefined,
      onKeyDown: typeof props.onKeyDown === 'function' ? props.onKeyDown : undefined,
      // 表单控件：渲染测试要能读到**当前值**并模拟输入（§4.5：输入后要重新渲染再看）。
      value: typeof props.value === 'string' ? props.value : undefined,
      placeholder: typeof props.placeholder === 'string' ? props.placeholder : undefined,
      onChange: typeof props.onChange === 'function' ? props.onChange : undefined,
      // UI 纪律要求开关是 `role="switch"` + `aria-checked`（§6.4）—— 这两个属性必须能被断言，
      // 否则"语义正确"只能靠读代码。`tag` 是**宿主标签名**（button/textarea/div/select），
      // `type` 是 `type=` 属性（button / search / text），两者不能混。
      tag: typeof node.type === 'string' ? node.type : undefined,
      role: typeof props.role === 'string' ? props.role : undefined,
      ariaChecked: props['aria-checked'],
      ariaSelected: props['aria-selected'],
      ariaExpanded: props['aria-expanded'],
      // `aria-label` 是"只有字形、没有文字"的按钮唯一的可读名字（v3 的折叠行 `＋` 按钮靠它），
      // 没被采集的话"无障碍名字对不对"就只能靠读代码。
      ariaLabel: typeof props['aria-label'] === 'string' ? props['aria-label'] : undefined,
      // 17 票的三件套：播报（aria-live）、listbox 的高亮指认（aria-activedescendant）、以及被指认的 id。
      ariaLive: typeof props['aria-live'] === 'string' ? props['aria-live'] : undefined,
      ariaActiveDescendant:
        typeof props['aria-activedescendant'] === 'string' ? props['aria-activedescendant'] : undefined,
      id: typeof props.id === 'string' ? props.id : undefined,
      type: typeof props.type === 'string' ? props.type : undefined,
      disabled: props.disabled === true,
      // `autoFocus` 也要采集：17 票要求"打开表单/进入编辑态时焦点落在第一个可编辑字段"，
      // 而这在假 React 里唯一的可观察形态就是它（没有真实 DOM，也没有 ref）。
      autoFocus: props.autoFocus === true,
    })
    flatten(node.children, out, className === '' ? parentClass : className)
    return out
  }
  return {
    React,
    store,
    flatten,
    begin: () => {
      cursor = 0
      store.effects = []
      store.dirty = false
    },
  }
}

/** 从**产物**里取出注册到座位上的那个组件 —— 页面真正渲染的就是它。 */
function componentFromArtifact(react) {
  const source = fs.readFileSync(CLIENT, 'utf8')
  const loads = []
  new Function('window', source)({ __ModuleLoader__: { load: (config) => loads.push(config) } })
  let component = null
  const scope = {
    slots: {
      inject: (_key, callback) => callback(),
      register: (_options, registered) => {
        component = registered
        return () => {}
      },
    },
  }
  loads[0]
    .factory(() => react)
    .apply({
      inject: (_services, callback) => {
        callback(scope)
        return () => {}
      },
    })
  assert.equal(typeof component, 'function', '座位注册必须给出一个组件函数')
  return component
}

/** 渲染一次 + 跑完 effect 引发的重渲染。`props` 是座位给的 standard kit（`useSessions` 等）。 */
async function renderSection(component, harness, respond, props) {
  // `respond` 可以是对象（所有请求同一个回答），也可以是 `(url, options) => body` ——
  // 后者是切换作用域必须的：GET 会按 `scope=` 拿到**不同**的快照（D16/D17/D21 就靠它）。
  globalThis.fetch = async (url, options) => ({
    json: async () => (typeof respond === 'function' ? respond(String(url), options ?? {}) : respond),
  })
  harness.props = props
  const pass = () => {
    harness.begin()
    return component(harness.props)
  }
  let tree = pass()
  for (const effect of harness.store.effects) effect()
  // async IIFE 要跨好几个微任务才走到 setPhase；多让两轮宏任务过去。
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (harness.store.dirty) tree = pass()
  return harness.flatten(tree)
}

/**
 * 状态变更后的"推进"：重新渲染 → 跑这次收集的 effect → 等微任务 → 若状态又变了再渲染一次。
 *
 * §4.5：事件闭包是**当次渲染**的，点了/输入了之后必须重新渲染再查 DOM，
 * 拿旧节点继续断言的测试会"测到一个已经不存在的界面"。
 * 用 `renderSection` 传进来的同一份 `props`（否则"有 root kit"的场景会在第二次渲染丢失）。
 */
async function advance(component, harness) {
  harness.begin()
  let tree = component(harness.props)
  for (const effect of harness.store.effects) effect()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (harness.store.dirty) {
    harness.begin()
    tree = component(harness.props)
  }
  return harness.flatten(tree)
}

/** 按类名取第一个元素（找不到直接断言失败：静默 undefined 会让后面的报错指向别处）。 */
function firstByClass(nodes, className) {
  const found = nodes.find(
    (node) => typeof node.className === 'string' && node.className.split(' ').includes(className),
  )
  assert.ok(found !== undefined, `应当有一个 .${className} 元素`)
  return found
}

/** 按类名取全部元素。 */
function allByClass(nodes, className) {
  return nodes.filter((node) => typeof node.className === 'string' && node.className.split(' ').includes(className))
}

/**
 * 取样式字符串里某条规则的**规则体**（注入的 CSS 没有 DOM 可量，所以对它做字面断言）。
 *
 * `selector` 要带上 `{`（例如 `.dsh-hooks__btn {`）：`indexOf` 找的是第一个匹配，
 * 不带花括号的话 `.dsh-hooks__btn` 会先命中 `.dsh-hooks__btn--ghost`，断言就测错了对象。
 */
function ruleBodyOf(selector) {
  const at = styles.indexOf(selector)
  assert.ok(at >= 0, `样式里应当有 ${selector} 这条规则`)
  const open = styles.indexOf('{', at)
  const close = styles.indexOf('}', open)
  assert.ok(open > at && close > open, `${selector} 的规则体没找到`)
  return styles.slice(open + 1, close)
}

/**
 * 取某个元素的**文本内容**。
 *
 * `flatten` 是"先推元素、再推它的子节点"，所以紧跟其后的文本节点就是它的内容；
 * 遇到下一个**有类名的元素**就停下（那是兄弟节点，不是子节点）。
 */
function textOfClass(nodes, className) {
  const index = nodes.findIndex(
    (node) => typeof node.className === 'string' && node.className.split(' ').includes(className),
  )
  assert.ok(index >= 0, `应当有一个 .${className} 元素`)
  let text = ''
  for (let at = index + 1; at < nodes.length; at++) {
    const node = nodes[at]
    if (typeof node.className === 'string' && node.className !== '') break
    if (node.text !== undefined) text += node.text
  }
  return text
}

/** 拼接页面上的全部文案（断言子串用；精确匹配事件名仍请用 texts）。 */
function joinedText(nodes) {
  return nodes
    .filter((node) => node.text !== undefined)
    .map((node) => node.text)
    .join('')
}

/** 取第 n 个开关（`role="switch"` 的按钮；类名 dsh-hooks__switch）。 */
function switchNode(nodes, index = 0) {
  const switches = allByClass(nodes, 'dsh-hooks__switch')
  assert.ok(switches[index] !== undefined, `应当有第 ${index + 1} 个开关`)
  assert.equal(switches[index].role, 'switch', '开关必须是 role="switch"（不是原生 checkbox）')
  assert.equal(typeof switches[index].ariaChecked, 'boolean', '开关必须带 aria-checked（无障碍语义）')
  assert.equal(typeof switches[index].onClick, 'function', '开关必须能点')
  return switches[index]
}

/** 取工具条按钮（按 `title`；工具条按钮刻意不用 `__btn` 类，见 styles.ts 的注释）。 */
function toolButton(nodes, label) {
  const found = nodes.find(
    (node) =>
      typeof node.className === 'string' && node.className.includes('dsh-hooks__toolbtn') && node.title === label,
  )
  assert.ok(found !== undefined, `应当有一个工具条按钮「${label}」`)
  assert.equal(typeof found.onClick, 'function', `「${label}」按钮必须真的带 onClick`)
  return found
}

/**
 * 键盘事件的**最小**假事件（组件只要求 `key`）。
 *
 * `preventDefault` 给成空函数而不是省略：组件会调它（避免 ↑↓ 滚动页面），缺了这个方法会在
 * 组件里抛 TypeError —— 那是"测试脚手架失真"，不是产品 bug。
 */
function keyEvent(key) {
  return { key, preventDefault() {}, stopPropagation() {} }
}

/**
 * 请求体去掉**乐观锁字段**（`expectedVersion`）。
 *
 * 为什么单拎出来：D 区各用例关心的是"落在**哪一份文件**的**哪一处**"，而"锁到底有没有发、
 * 发的是不是页面看到的那一版"由 `D43` 一条断言统一守。不这么做的话，每加一个信封字段都要改
 * 十条互不相干的断言 —— 改着改着就会有人顺手把真正的防护一起放宽掉。
 */
function withoutLock(body) {
  const rest = { ...body }
  delete rest.expectedVersion
  return rest
}

/** 作用域选择器的触发器。 */
function scopeTrigger(nodes) {
  const found = firstByClass(nodes, 'dsh-hooks__trigger')
  assert.equal(typeof found.onClick, 'function', '触发器必须能点开')
  assert.equal(typeof found.onKeyDown, 'function', '触发器必须能收键盘（Enter/↑↓/Esc）')
  return found
}

/** 点开作用域 popover。 */
async function openScopePicker(nodes, component, harness) {
  scopeTrigger(nodes).onClick()
  const opened = await advance(component, harness)
  assert.ok(allByClass(opened, 'dsh-hooks__popover').length === 1, '点触发器必须展开 popover')
  return opened
}

/** 展开底部折叠区（`查看全部事件` / `诊断`）并返回新节点。 */
async function expandFold(nodes, component, harness, title) {
  const disclosure = nodes.find(
    (node) =>
      typeof node.className === 'string' && node.className.includes('dsh-hooks__disclosure') && node.title === title,
  )
  assert.ok(disclosure !== undefined, `应当有一个折叠开关「${title}」`)
  assert.equal(typeof disclosure.onClick, 'function', `「${title}」必须能点开`)
  disclosure.onClick()
  return advance(component, harness)
}

/** popover 里 value = `value` 的那个选项。 */
function scopeOptionOf(nodes, value) {
  const found = nodes.find(
    (node) =>
      typeof node.className === 'string' && node.className.includes('dsh-hooks__option') && node.value === value,
  )
  assert.ok(found !== undefined, `popover 里应当有 value=${value} 的选项`)
  assert.equal(typeof found.onClick, 'function', `value=${value} 的选项必须能点`)
  return found
}

/** 点开 popover → 选一个作用域 → 推进渲染（D16/D17/D21 与"文件不存在"用例都走这一条）。 */
async function pickScopeOption(nodes, component, harness, value) {
  const opened = await openScopePicker(nodes, component, harness)
  scopeOptionOf(opened, value).onClick()
  return advance(component, harness)
}

/** 造一条 hook（快照 `HookView`）。 */
function snapshotHook(rawIndex, command, extra = {}) {
  return { rawIndex, command, timeoutSec: null, defaultTimeoutSec: 600, disabled: false, lastRun: null, ...extra }
}

/**
 * 造一份文件视图（`FileView`，含 7 个事件的可寻址视图）。
 *
 * `groupsByEvent` 形如 `{ PreToolUse: [{ rawIndex: 0, matcher: 'pwsh', hooks: [...] }] }`。
 */
function snapshotFile(kind, state, groupsByEvent = {}, overrides = {}) {
  let hookCount = 0
  const events = HOOK_EVENTS.map((event) => {
    const groups = (groupsByEvent[event] ?? []).map((group) => ({
      file: kind,
      rawIndex: group.rawIndex,
      matcher: group.matcher ?? null,
      matcherOk: group.matcherOk ?? true,
      matcherProblem: group.matcherProblem ?? null,
      hooks: group.hooks,
    }))
    let enabled = 0
    let disabled = 0
    for (const group of groups) {
      for (const one of group.hooks) {
        if (one.disabled) disabled += 1
        else enabled += 1
      }
    }
    hookCount += enabled + disabled
    return { event, groups, hookCount: enabled, disabledCount: disabled, runCount: 0 }
  })
  return {
    kind,
    path: kind === 'user' ? 'C:/u/.dsh/hooks.json' : 'D:/p/.dsh/hooks.json',
    state,
    message: state === 'error' ? 'FsError: cannot read text: Unexpected token {' : null,
    version: state === 'absent' ? null : 'v1',
    hookCount,
    // 06 票：文件里"跑不了"的东西。缺省为空（大多数用例不关心），需要时用 overrides 注入。
    rejected: [],
    unrunnable: 0,
    skipped: [],
    matcherErrors: [],
    events,
    ...overrides,
  }
}

/**
 * 造一份整页快照（`HooksSnapshot`）。
 *
 * 缺省 = **工作区作用域** `w-1`（项目级文件是"主文件"、用户级是只读的另一个来源）：
 * 页面默认作用域是用户（D14 单独测），这里缺省用工作区是为了让"定位到哪一份文件"随手可测。
 */
function snapshotOf(options = {}) {
  const scopeValue = options.scope ?? 'w-1'
  const workspaces = options.workspaces ?? [
    { id: 'w-1', title: 'agent-go', path: 'D:/p', projectRoot: 'D:/p', isCurrent: true },
  ]
  const known = workspaces.find((workspace) => workspace.id === scopeValue)
  const projectRoot = options.projectRoot ?? 'D:/p'
  const userFile = options.userFile ?? snapshotFile('user', 'ok')
  const projectFile = options.projectFile ?? snapshotFile('project', 'ok')
  const scope =
    scopeValue === 'user'
      ? scopeView({ kind: 'user', requested: 'user', projectRoot: null, isCurrentSession: null })
      : scopeValue === 'current'
        ? // `scope=current`：会话 cwd 解析出来的项目 —— **不是**清单里的某个工作区，
          // 所以 workspaceId / workspacePath 都是 null（页面据此说"当前会话的项目"而不是"这个工作区"）。
          scopeView({
            kind: 'workspace',
            requested: 'current',
            workspaceId: null,
            workspaceTitle: null,
            workspacePath: null,
            projectRoot,
            isCurrentSession: options.isCurrentSession ?? true,
          })
        : scopeView({
            kind: 'workspace',
            requested: 'workspace',
            workspaceId: scopeValue,
            workspaceTitle: known?.title ?? scopeValue,
            workspacePath: known?.path ?? projectRoot,
            projectRoot,
            isCurrentSession: options.isCurrentSession ?? true,
          })
  return {
    route: '/api/hooks',
    projectRoot,
    cwd: projectRoot,
    cwdSource: 'session',
    scope,
    workspaces,
    workspacesAvailable: options.workspacesAvailable ?? true,
    // 三态：显式传 `session: null` 表示"当前会话未知"（页面必须说不知道）。
    session: options.session === undefined ? sessionEffect({ projectRoot }) : options.session,
    files: scopeValue === 'user' ? [userFile] : [projectFile, userFile],
    events:
      options.events ??
      HOOK_EVENTS.map((event) => ({
        event,
        groups: [],
        hookCount: 0,
        disabledCount: 0,
        fromUser: 0,
        fromProject: 0,
        runCount: 0,
      })),
    total: options.total ?? { hookCount: 1, disabledCount: 0, groupCount: 1, unrunnable: 0 },
    staleInUse: options.staleInUse ?? false,
    capabilities: { writable: options.writable ?? true },
  }
}

await test('D：一张卡 = 一条 hook（中文名+英文枚举/命令/开关/状态色）+ 一行工具条 + 条数口径', async () => {
  // 选中的项目级（4 条不同状态的 hook）+ 用户级读不出来。
  const run = (exitCode, decision) => ({ at: 1, exitCode, decision, durationMs: 12, stdout: '', stderr: 'out' })
  const hooks = [
    snapshotHook(0, 'echo never-run'),
    snapshotHook(1, 'echo ok', { lastRun: run(0, 'pass') }),
    snapshotHook(2, 'echo deny', { lastRun: run(0, 'deny') }),
    snapshotHook(3, 'echo off', { disabled: true }),
  ]
  const snapshot = snapshotOf({
    scope: 'w-1',
    projectFile: snapshotFile('project', 'ok', { PreToolUse: [{ rawIndex: 0, matcher: 'pwsh', hooks }] }),
    userFile: snapshotFile('user', 'error'),
    session: sessionEffect({ hookCount: 4, groupCount: 1, fromUser: 0, fromProject: 4 }),
    total: { hookCount: 4, disabledCount: 1, groupCount: 1 },
  })

  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })
  const texts = nodes.filter((node) => node.text !== undefined).map((node) => node.text)
  // JSX 的 `{...}` 插值会变成**独立子节点**，所以像"本会话生效 4 个"这种文案会被切成好几段；
  // 断言子串时要按文档顺序拼起来看（精确匹配事件名仍用 `texts`）。
  const joined = texts.join('')

  // ① 一张卡 = 一条 hook：4 条 hook → 4 张卡，每张卡的标题都是事件名
  const cards = allByClass(nodes, 'dsh-hooks__hookcard')
  assert.equal(cards.length, 4, '4 条 hook 必须是 4 张卡（不是"一个事件一张卡"）')
  assert.equal(texts.filter((text) => text === 'PreToolUse').length, 4, '每张卡的标题里都有英文枚举（原文要能查到）')
  assert.ok(joined.includes('echo never-run') && joined.includes('echo off'), '命令是副标题（mono 省略号）')
  // ★ v3：左侧 28×28 槽位不再装事件首字母（事件名中文化后它没有信息量），改装**状态点**。
  //   槽位、状态点、颜色三件事都在这一条里：槽位还在、字母没了、点还是 4 个。
  const slots = allByClass(nodes, 'dsh-hooks__slot')
  assert.equal(slots.length, 4, '每张卡左侧保留一个 28×28 槽位（v3 起装状态点）')
  assert.equal(texts.filter((text) => text === 'P').length, 0, '事件首字母格已取消（中文化之后那个字母没有信息量）')
  assert.equal(allByClass(nodes, 'dsh-hooks__dot').length, 4, '槽位里就是状态点（每张卡恰好一个）')

  // ② 0 条的事件**不进主列表**（这是对 AGENTS §3.6 的有意偏离，见 section.tsx 文件头）
  for (const event of HOOK_EVENTS) {
    if (event === 'PreToolUse') continue
    assert.equal(
      texts.filter((text) => text === event).length,
      0,
      `${event}（0 条）不该占主列表的一行 —— 它收在底部折叠里`,
    )
  }
  // 折叠**收起**时看不到"没有配置"（默认态就是参考图那个安静的样子）
  assert.ok(!joined.includes('没有配置'), '折叠收起时不该出现"没有配置"')
  // ③ 另一个来源 = **只在"有东西"时出现**的一行摘要（不再是第二张完整卡，正文里也不许有盘符路径）
  assert.ok(joined.includes('用户级（全局）'), '另一个来源有一行摘要（这一份读不出来 ⇒ 必须说）')
  assert.ok(joined.includes('用户级（全局）这份配置读不出来（详情见「更多」）'), '读不出来时如实说，并把人指向「更多」')
  assert.ok(!joined.includes('C:/u/.dsh/hooks.json'), '★ 正文不许暴露盘符路径（路径只在诊断折叠里）')
  assert.equal(cards.length, 4, '用户级那份**不再**渲染成完整卡（否则卡片数会多出来）')
  // ④ 条数口径（v3 收成**一句人话**）：`钩子 N` / `已安装 N` 两个 chip 删掉了，同一个数不再说五遍
  assert.ok(joined.includes('4 个 hook'), '第二行说人话：N 个 hook = 文件里的总条数（含已停用）')
  assert.ok(joined.includes('其中 1 个已停用'), '有停用时追加"其中 M 个已停用"（启用中条数 = 4 - 1 仍然算得出来）')
  assert.ok(!joined.includes('钩子 4'), '`钩子 N` chip 删了（它夹在下拉与搜索框之间破坏分组）')
  assert.ok(!joined.includes('已安装'), '`已安装 N` 也删了（同一条信息说五遍正是"冗余"的来源）')
  // ⑤ 「本会话生效」只在"和屏幕上这一份不是同一件事"时出现：这里作用域**就是**当前会话的项目
  //    ⇒ 第二行不再重复；完整口径（用户级 a + 项目级 b）移进诊断折叠（D3 的落点没丢）。
  assert.ok(!joined.includes('本会话生效'), '作用域 = 当前会话项目时，不再把同一件事说两遍')
  const diag5 = await expandFold(nodes, component, harness, '更多')
  assert.ok(
    joinedText(diag5).includes('当前会话生效 4 个（用户级 0 + 项目级 4）'),
    '诊断折叠里仍有完整口径（页面依然能回答"当前会话实际会跑什么"）',
  )
  // ⑥ 工具条**只有一行**（v3）：作用域 + 刷新/新建；条数下移到"一句人话"那一行
  const toolbars = allByClass(nodes, 'dsh-hooks__toolbar')
  assert.equal(toolbars.length, 1, '★ 工具条只有一行（v3）—— 过去是两行，第二行还塞了计数与截图对不上的位置')
  assert.equal(allByClass(nodes, 'dsh-hooks__metaline').length, 1, '第二行是一句人话（metaline）')
  assert.ok(
    texts.filter((text) => text === '↻ 刷新').length === 1 && texts.filter((text) => text === '＋ 新建').length === 1,
  )

  // ⑦ 状态色**只**来自台账与 disabled（§3.8）
  const dots = nodes.filter((node) => typeof node.className === 'string' && node.className.includes('dsh-hooks__dot'))
  assert.equal(dots.length, 4, '每条 hook 恰好一个状态点')
  assert.ok(!dots[0].className.includes('--'), '没有记录 → 灰（"没报错就报绿"是被禁的）')
  assert.ok(dots[1].className.includes('--ok'), 'exitCode 0 + pass → 绿')
  assert.ok(dots[2].className.includes('--deny'), 'decision deny → 红')
  assert.ok(!dots[3].className.includes('--ok'), '已停用不许画绿')
  assert.ok(dots[0].title.includes('未运行'), '灰点必须能解释自己')
  assert.ok(dots[0].title.includes('没有执行记录'), '而且原因要在 title 里（v3 把它从正文挪到了 title）')

  // ⑧ 开关的可访问性语义（§6.4）：启用中 aria-checked=true、停用 false
  const switches = allByClass(nodes, 'dsh-hooks__switch')
  assert.equal(switches.length, 4, '每条 hook 一个开关')
  assert.deepEqual(
    switches.map((node) => node.ariaChecked),
    [true, true, true, false],
    'aria-checked 必须如实反映启停（停用的开关不能是"开"档）',
  )
  // ⑨ 唯一的提示行：页面级 / 文件坏了 / 非当前工作区 / 只读 —— 最多一条
  assert.equal(
    allByClass(nodes, 'dsh-hooks__alert').length,
    1,
    '提示最多一条（用户反馈"堆叠横幅"是噪音）：这里只有"用户级文件读不出来"那条',
  )
})

await test('D：底部折叠「更多」展开后 7 个事件都在（含 0 条）——"空"没有变得不可达', async () => {
  // §3.6 偏离的另一半保证：默认不占一屏，但**折叠里必须永远列全 7 个**（含 0 条 + ＋新建）。
  const hooks = [snapshotHook(0, 'echo only')]
  const snapshot = minimalSnapshot({
    userFile: snapshotFile('user', 'ok', { PreToolUse: [{ rawIndex: 0, matcher: 'pwsh', hooks }] }),
  })
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const collapsed = await renderSection(component, harness, { ok: true, data: snapshot })
  const collapsedTexts = collapsed.filter((node) => node.text !== undefined).map((node) => node.text)
  // v4：底部**只有一个**开关，名字是「更多」（v3 是两个：查看全部事件（7） + 诊断）。
  assert.ok(joinedText(collapsed).includes('更多'), '底部必须有「更多」这个折叠开关')
  assert.ok(!joinedText(collapsed).includes('诊断'), '★ "诊断"两个字不再挂在首屏（v4：检测不占屏）')
  assert.equal(allByClass(collapsed, 'dsh-hooks__foldbody').length, 0, '默认是收起的')
  for (const event of HOOK_EVENTS) {
    if (event === 'PreToolUse') continue
    assert.equal(
      collapsedTexts.filter((text) => text === event).length,
      0,
      `${event} 收起时不出现在主列表（主列表只放有内容的 hook）`,
    )
  }

  const opened = await expandFold(collapsed, component, harness, '更多')
  const openedTexts = opened.filter((node) => node.text !== undefined).map((node) => node.text)
  const rows = allByClass(opened, 'dsh-hooks__eventrow')
  assert.equal(rows.length, HOOK_EVENTS.length, '展开后**恰好 7 行**（含 0 条）')
  for (const event of HOOK_EVENTS) {
    assert.ok(openedTexts.filter((text) => text === event).length >= 1, `${event} 必须能在折叠里看到（含 0 条）`)
  }
  assert.ok(joinedText(opened).includes('没有配置'), '0 条的事件在折叠里明说"没有配置"（空 ≠ 不存在）')
  // 折叠里给每个事件一个「＋新建」（把 hook 加到这个事件下）。
  // ⚠️ 本轮改了类名（`__toolbtn` → `__btn--ghost`）但**保留原防护意图**：7 个事件行各挂一个
  // 描边小按钮正是用户说的"乱"（真机截图里展开的 7 个 `＋新建` 全是描边）。所以这里从
  // "有一个标题为「在 SessionStart 下新建」的按钮" 变成 "它是 ghost、且 7 行都不带描边"。
  const rowNewButtons = opened.filter(
    (node) => typeof node.title === 'string' && node.title.startsWith('在 ') && node.title.endsWith(' 下新建'),
  )
  assert.equal(rowNewButtons.length, HOOK_EVENTS.length, '折叠里每个事件都要能新建（空事件不是死路）')
  assert.equal(
    rowNewButtons.filter((node) => node.title === '在 SessionStart 下新建').length,
    1,
    'SessionStart 那一行同样有一个「＋新建」',
  )
  for (const node of rowNewButtons) {
    assert.ok(
      typeof node.className === 'string' && node.className.includes('dsh-hooks__btn--ghost'),
      `事件行的「＋新建」必须是 ghost 文字按钮（无描边）：${String(node.className)}`,
    )
    assert.ok(
      typeof node.className === 'string' && !node.className.includes('--outline'),
      '事件行不许出现描边按钮（描边只允许在工具条）',
    )
  }
  assert.equal(
    allByClass(opened, 'dsh-hooks__btn--outline').length,
    0,
    '展开态页面上不许有 __btn--outline（内容区一律 ghost / primary）',
  )
})

await test('D：诊断折叠（默认收起）里放项目根/路径/状态/版本/清单/作用域语义', async () => {
  const snapshot = minimalSnapshot()
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const collapsed = await renderSection(component, harness, { ok: true, data: snapshot })
  const collapsedText = joinedText(collapsed)
  assert.ok(!collapsedText.includes('项目根'), '诊断默认收起：这些开发者台词不该出现在首屏')

  const opened = await expandFold(collapsed, component, harness, '更多')
  const text = joinedText(opened)
  assert.ok(text.includes('项目根'), '展开后要有项目根')
  assert.ok(text.includes('D:/p'), '项目根的值来自快照')
  assert.ok(text.includes('工作目录来源'), '展开后要有工作目录来源（不编造来源；18 票把它翻成人话）')
  assert.ok(text.includes('C:/u/.dsh/hooks.json'), '展开后要有**当前那份**文件的路径（scope=user 时是用户级）')
  assert.ok(text.includes('已读取'), '展开后要有文件状态')
  assert.ok(text.includes('版本'), '展开后要有版本（排查乐观锁冲突要看）')
  assert.ok(text.includes('工作区清单'), '展开后要有工作区清单状态')
  assert.ok(text.includes('用户级配置对所有项目生效'), '§2.1 那句"用户级对所有项目生效"放在这里（不占横幅）')
})

await test('D：渲染出的文本里出现 markdown 语法会被当场抓住（这条护栏本身不是空的）', () => {
  // 通用护栏在 `flatten` 里（任何场景渲染出的文本都过一遍）。这里证明它**真的会**报错 ——
  // 否则"没有 markdown"可能只是因为没有断言（平凡通过的断言比没有更糟）。
  const harness = createFakeReact()
  const element = (text) => harness.React.createElement('span', null, text)
  assert.throws(
    () => harness.flatten(element('**agent-go**')),
    /markdown/,
    '星号对必须被抓住（真机截图上就是它把 ** 原样渲染出来了）',
  )
  assert.throws(() => harness.flatten(element('看 `代码`')), /markdown/, '反引号同样要被抓')
  assert.throws(() => harness.flatten(element('## 标题')), /markdown/, '井号同样要被抓')
  assert.doesNotThrow(() => harness.flatten(element('普通文本，没有问题')))
})

await test('D：sessionId 经 useSessions 带给宿主（GET + 写请求）；没有 root kit 时退回不带且照常渲染', async () => {
  // ① root kit 提供 useSessions：组件用**官方判据**（快照里 `retainedBy.mainView > 0` 的那一行）
  //    挑出主会话 id，并把它并进 GET 与写请求的 query（宿主从 URL 取 —— 缺了它就整页"当前会话未知"）。
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const urls = []
  const props = {
    useSessions: (selector) =>
      selector({
        byId: {
          s2: { id: 's2', retainedBy: { mainView: 0 } },
          s1: { id: 's1', retainedBy: { mainView: 1 } },
        },
      }),
  }
  const first = await renderSection(
    component,
    harness,
    (url) => {
      urls.push(url)
      return { ok: true, data: minimalSnapshot() }
    },
    props,
  )
  assert.ok(urls[0].includes('sessionId=s1'), `GET 必须带主会话 id（官方判据选出来的）：${urls[0]}`)
  assert.ok(!urls[0].includes('sessionId=s2'), 'mainView=0 的那个不是主会话，不许带')

  // 写请求也要带（宿主据此解析调用会话的 cwd 与沙箱策略；不带时会退回"当前发起者"，
  // 而设置页里根本拿不到它 —— 那就是这一整页"当前会话未知"的根因）。
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method ?? 'GET'
    calls.push({
      method,
      url: String(url),
      body: typeof options.body === 'string' ? JSON.parse(options.body) : null,
    })
    return {
      json: async () =>
        method === 'POST' ? { ok: true, data: { file: 'user', version: 'v2' } } : { ok: true, data: minimalSnapshot() },
    }
  }
  switchNode(first).onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(calls[0].url.includes('sessionId=s1'), `写请求也要带 sessionId：${calls[0].url}`)

  // ② 没有 root kit ⇒ 不带 sessionId、页面照常渲染（no-op 替身；**不是**条件式 hook 调用，
  //    所以这两条路径的 hook 位完全相同 —— 这是"缺 root kit 也不许崩"的结构性保证）。
  const bare = createFakeReact()
  const bareUrls = []
  const bareNodes = await renderSection(componentFromArtifact(bare.React), bare, (url) => {
    bareUrls.push(url)
    return { ok: true, data: minimalSnapshot() }
  })
  assert.ok(!bareUrls[0].includes('sessionId='), '没有 root kit 时不带 sessionId')
  assert.ok(joinedText(bareNodes).includes('echo a'), '页面照常渲染（no-op 兜底，不是空白/崩溃）')
  assert.ok(textOfClass(bareNodes, 'dsh-hooks__triggerlabel').includes('用户（全局）'), '两条路径渲染形状一致')

  // ③ props 在、但 useSessions 不是函数（旧宿主 / 传错）⇒ 同一套 no-op 兜底，不许抛
  const broken = createFakeReact()
  const brokenUrls = []
  await renderSection(
    componentFromArtifact(broken.React),
    broken,
    (url) => {
      brokenUrls.push(url)
      return { ok: true, data: minimalSnapshot() }
    },
    { useSessions: '不是函数' },
  )
  assert.ok(!brokenUrls[0].includes('sessionId='), 'useSessions 不是函数时同样退回不带')
})

await test('D：真实渲染 —— 取数失败时主文案是人话，技术原文只作补充', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const nodes = await renderSection(component, harness, {
    ok: false,
    error: 'internal',
    detail: 'FsError: cannot list D:/proj/.dsh',
  })
  const texts = nodes.filter((node) => node.text !== undefined).map((node) => node.text)
  assert.ok(texts[0].includes('宿主在读取配置时出错了'), '主文案必须是我们自己的话（§3.9）')
  assert.ok(!texts[0].includes('FsError'), '绝不把内部错误原文当主文案')
  assert.ok(
    texts.some((text) => text.includes('FsError: cannot list')),
    '技术原文只能作为补充出现在下面（排查要用得上）',
  )
})

/**
 * 造一份最小可用快照：**用户作用域**（页面默认），用户级文件里 1 条 hook（`echo a`）。
 *
 * 为什么是用户级：页面默认作用域就是用户（D6/用户要求），快照的 `scope.kind` 必须与它一致
 * —— 否则"宿主回显的作用域"和"页面正在用的作用域"是两回事，测试就不再测真实形态了。
 * 需要工作区作用域的用例（D16/D17、以及"两个来源同时出现"）自己驱动下拉框切过去。
 */
function minimalSnapshot(overrides = {}) {
  return snapshotOf({
    scope: 'user',
    userFile: snapshotFile('user', 'ok', {
      PreToolUse: [{ rawIndex: 0, matcher: 'pwsh', hooks: [snapshotHook(0, 'echo a')] }],
    }),
    ...overrides,
  })
}

/** 取写入按钮（可写时每条 hook 一个；"新建文件"按钮的 className 相同，所以按数量断言）。 */
function writeButtons(nodes) {
  return nodes.filter((node) => typeof node.className === 'string' && node.className.includes('dsh-hooks__btn'))
}

/**
 * 按**标签**取按钮（`title` 就是动作名）。
 *
 * 比按下标稳：这几轮每加一个按钮（0→2→3→4），按下标的旧断言就会**换一个目标**去点，
 * 而报错却是"功能坏了"——把测试的脆弱伪装成产品的回归。按标签选才表达真实意图。
 */
function buttonByLabel(nodes, label) {
  const found = nodes.find(
    (node) => typeof node.className === 'string' && node.className.includes('dsh-hooks__btn') && node.title === label,
  )
  assert.ok(found !== undefined, `应当有一个标签为「${label}」的按钮`)
  assert.equal(typeof found.onClick, 'function', `「${label}」按钮必须真的带 onClick`)
  return found
}

/** 空状态块里的「切换过去」（v4：证据在 `title` 里，所以按类名找 —— 见 section.tsx 的注释）。 */
function guideButton(nodes) {
  const found = firstByClass(nodes, 'dsh-hooks__guidebtn')
  assert.equal(typeof found.onClick, 'function', '「切换过去」必须能点')
  return found
}

/**
 * 「⋯」里那一排**可点开的字段**（匹配范围 / 超时 / 上移 / 下移）。
 *
 * 它们刻意不带 `__btn` 类（D 区按 `__btn` 数"这一排有几个动作按钮"），所以按 `title` 找。
 */
function menuFieldButton(nodes, label) {
  const found = nodes.find(
    (node) =>
      typeof node.className === 'string' && node.className.includes('dsh-hooks__fieldbtn') && node.title === label,
  )
  assert.ok(found !== undefined, `「⋯」里应当有一个字段按钮「${label}」`)
  assert.equal(typeof found.onClick, 'function', `「${label}」必须能点`)
  return found
}

/**
 * 打开某一张卡右上角的 `⋯`（v4：试运行 / 编辑 / 删除都收在这块里）。
 *
 * 断言两件事：默认收起（`aria-expanded=false`）、点开之后**真的**能拿到那块内容。
 * `⋯` 刻意不用 `__btn` 类 —— `writeButtons` 按 `__btn` 数"这一行有几个动作按钮"，
 * 把 `⋯` 混进去那条计数就会测到一个不存在的界面。
 */
async function openCardMenu(nodes, component, harness, index = 0) {
  const menus = allByClass(nodes, 'dsh-hooks__morebtn')
  assert.ok(menus[index] !== undefined, `应当有第 ${index + 1} 个「⋯」按钮`)
  assert.equal(menus[index].ariaExpanded, false, '「⋯」默认收起（aria-expanded=false）')
  assert.equal(typeof menus[index].onClick, 'function', '「⋯」必须能点')
  menus[index].onClick()
  return advance(component, harness)
}

await test('D：点开关发的是定点写请求（file + workspaceId + 原始下标 + 目标值）', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const nodes = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })
  const buttons = writeButtons(nodes)
  assert.equal(
    buttons.length,
    0,
    '★ v4：三个动作按钮**默认不在 DOM 里**（它们在 `⋯` 里）—— 首屏每张卡只有状态点 + 一个状态词 + 开关 + `⋯`',
  )

  const calls = []
  globalThis.fetch = async (_url: string, options: { method?: string; body?: string } = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return {
      json: async () =>
        method === 'POST'
          ? { ok: true, data: { file: 'project', version: 'v2' } }
          : { ok: true, data: minimalSnapshot() },
    }
  }
  switchNode(nodes).onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(calls[0].method, 'POST', '切开关是一次写请求，不是又一次取数')
  assert.deepEqual(
    withoutLock(calls[0].body),
    // 页面默认作用域 = 用户 ⇒ `file:'user'`，且**不带** workspaceId（用户级不属于任何工作区）。
    { file: 'user', op: 'setHookDisabled', event: 'PreToolUse', groupIndex: 0, hookIndex: 0, disabled: true },
    '请求体只能是定点操作（绝不回传整份文件），且下标必须是**文件里的**下标',
  )
})

await test('D：写失败按错误码分别说清，且只渲染在页面级通道（§3.7/§3.9）', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const nodes = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })
  // 这里要触发的是写请求 —— 启停是右侧那个 `role="switch"` 的开关。
  const button = switchNode(nodes)

  globalThis.fetch = async () => ({
    json: async () => ({ ok: false, error: 'stale', detail: 'FS_STALE_VERSION: 期望 v1' }),
  })
  button.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  // 状态变更后**重新渲染再看**（§4.5：事件闭包是当次渲染的，别拿旧节点判断）。
  harness.begin()
  const after = harness.flatten(component())
  const joined = after
    .filter((node) => node.text !== undefined)
    .map((node) => node.text)
    .join('')
  assert.ok(joined.includes('刚被别处改过了'), 'stale 必须说"该刷新"，而不是含混的"保存失败"')
  assert.ok(joined.includes('FS_STALE_VERSION'), '技术原文只作补充（排查要用得上），不是主文案')
  // v3：主视图那句是 `本会话生效 N 个`（完整口径带 `（用户级 a + 项目级 b）`，在诊断折叠里）。
  assert.ok(joined.includes('本会话生效 1 个'), '失败**不**清空已有内容 —— 用户要对着旧内容决定下一步')
  assert.ok(!joined.includes('用户级 1 + 项目级'), '主视图不再重复"用户级 a + 项目级 b"（那是诊断区的事）')
  // §3.7：行内操作失败进页面级提示行；表单错误通道（__newerror）此时必须是空的。
  const banners = after.filter(
    (node) => typeof node.className === 'string' && node.className.includes('dsh-hooks__alert--error'),
  )
  assert.equal(banners.length, 1, '一条错误只允许一个渲染点（§3.7）')
  assert.equal(allByClass(after, 'dsh-hooks__newerror').length, 0, '行内失败**不许**写进表单内的错误通道')
})

await test('D：行内编辑命令 —— 文本框里是当前命令，保存发的是定点写请求', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const first = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })

  // 没在编辑时：`⋯` 里是四个动作按钮（试运行、编辑、删除、删除整组）；首屏一个都没有（v4）。
  assert.equal(writeButtons(first).length, 0, '首屏不该有动作按钮（它们全在 ⋯ 里）')
  const opened = await openCardMenu(first, component, harness)
  const idle = writeButtons(opened)
  assert.equal(idle.length, 4, '「⋯」里应当有"试运行"、"编辑"、"删除"、"删除整组"四个按钮（整组删除 = 09 票）')
  assert.deepEqual(
    idle.map((node) => node.title),
    ['试运行', '编辑', '删除', '删除整组'],
    '顺序稳定：先这条、再整组（破坏性动作排最后）',
  )
  assert.ok(joinedText(opened).includes('匹配 pwsh'), '★ 匹配范围进了「⋯」（v4 不再占卡片正文）')
  assert.ok(joinedText(opened).includes('默认 600 秒'), '★ 超时也进了「⋯」')
  buttonByLabel(opened, '编辑').onClick()

  // 点"编辑"后重新渲染（§4.5：事件闭包是当次渲染的）
  harness.begin()
  const editing = harness.flatten(component())
  const textarea = editing.find(
    (node) => typeof node.className === 'string' && node.className.includes('dsh-hooks__editor'),
  )
  assert.ok(textarea !== undefined, 'command 必须是 mono+multiline 的真 textarea（§3.10）')
  assert.equal(textarea.value, 'echo a', '文本框里应当是**当前**命令（不是空的）')

  // 模拟输入，再重新渲染
  textarea.onChange({ target: { value: 'echo b' } })
  harness.begin()
  const typed = harness.flatten(component())
  const typedBox = typed.find(
    (node) => typeof node.className === 'string' && node.className.includes('dsh-hooks__editor'),
  )
  assert.equal(typedBox.value, 'echo b', '输入必须真的进了草稿状态')

  // 点"保存"：断言发出的**请求体逐字段**
  const calls = []
  globalThis.fetch = async (_url: string, options: { method?: string; body?: string } = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return { json: async () => ({ ok: true, data: { file: 'project', version: 'v2' } }) }
  }
  buttonByLabel(typed, '保存').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(
    withoutLock(calls[0].body),
    {
      file: 'user',
      op: 'setHookCommand',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 0,
      command: 'echo b',
    },
    '只改命令这一个字段，其余一切交给宿主原样保留（§2.3/§2.4）',
  )
})

await test('D：删除是两步 —— 第一步只改状态不发请求，第二步才发 removeHook', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const first = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })

  // ⚠️ 打开 `⋯` **必须在换掉 fetch 之前**：`openCardMenu` 会推进一次渲染（跑 effect），
  //   而 GET 会重新取数 —— 换过之后的假 fetch 对 GET 返回的是"写响应"，快照就变形了。
  const opened = await openCardMenu(first, component, harness)

  const calls = []
  globalThis.fetch = async (_url: string, options: { method?: string; body?: string } = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return { json: async () => ({ ok: true, data: { file: 'project', version: 'v2' } }) }
  }

  // 第一步：点"删除"。**绝不能发请求**。
  buttonByLabel(opened, '删除').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.length, 0, '第一步绝不能发请求 —— 删除是唯一丢数据的操作，点错了没有 undo')

  harness.begin()
  const confirming = harness.flatten(component())
  const joined = confirming
    .filter((node) => node.text !== undefined)
    .map((node) => node.text)
    .join('')
  assert.ok(joined.includes('删除这一条？'), '必须变成确认态（界面上要说清"这一步还没删"）')
  const confirmButtons = writeButtons(confirming)
  assert.equal(confirmButtons.length, 2, '确认态只剩"确认删除"和"取消"')
  assert.ok(joined.includes('确认删除'), '第二个按钮必须是明确的"确认删除"，不是含混的"确定"')

  // 第二步：点"确认删除" → 这时才发请求。
  buttonByLabel(confirming, '确认删除').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.length, 1, '两步之后恰好一次写请求')
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(
    withoutLock(calls[0].body),
    { file: 'user', op: 'removeHook', event: 'PreToolUse', groupIndex: 0, hookIndex: 0 },
    '删除也是定点操作：宿主拿这两个**文件下标**定位要删的那一条',
  )
})

await test('D：点"试运行"发 dryRun 请求，结果贴在这一行，且那一行仍然是灰的', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const first = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })
  // ⚠️ 先开 `⋯`（会推进渲染 → 重新取数），再换 fetch —— 理由同"删除是两步"那条。
  const opened = await openCardMenu(first, component, harness)

  const calls = []
  globalThis.fetch = async (_url: string, options: { method?: string; body?: string } = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return {
      json: async () => ({
        ok: true,
        data: {
          run: { command: 'echo a', exitCode: 2, decision: 'block', durationMs: 7, stdout: '', stderr: 'dry ok' },
        },
      }),
    }
  }
  buttonByLabel(opened, '试运行').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(calls.length, 1, '试运行只发一次请求')
  assert.deepEqual(
    withoutLock(calls[0].body),
    { op: 'dryRun', file: 'user', event: 'PreToolUse', groupIndex: 0, hookIndex: 0 },
    '试运行也是定点寻址（文件 + 事件 + 两个文件下标）；换到工作区作用域时同一构造函数会带上 workspaceId',
  )

  harness.begin()
  const after = harness.flatten(component())
  const joined = after
    .filter((node) => node.text !== undefined)
    .map((node) => node.text)
    .join('')
  assert.ok(joined.includes('已阻断'), 'deny/block 要**单独点名**，不能只说"失败了事"')
  assert.ok(joined.includes('dry ok'), 'stderr 要带给用户看（原因通常写在这里）')
  assert.ok(joined.includes('7ms'), '耗时也要显示（用户判断"这条 hook 慢不慢"就靠它）')
  const dot = after.find((node) => typeof node.className === 'string' && node.className.includes('dsh-hooks__dot'))
  assert.ok(dot.title.includes('未运行'), '试运行**不进台账**：那一行仍然是灰的"未运行" —— 预演不该给状态上色（§3.8）')

  // 失败走**页面级**通道（§3.7），与其它行内操作一致。
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, error: 'invalid-json', detail: '坏文件' }) })
  harness.begin()
  buttonByLabel(harness.flatten(component()), '试运行').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  harness.begin()
  const failedText = harness
    .flatten(component())
    .filter((node) => node.text !== undefined)
    .map((node) => node.text)
    .join('')
  assert.ok(failedText.includes('没有写入'), '试运行失败也要按错误码说清（这条是"文件读不出来，所以没写"）')
})

await test('D：文件不存在时渲染空状态块 —— 说清"不存在"（不是"读不出来"），并给出"新建配置文件"', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  // 选中的项目级文件不存在、用户级那份是好的 —— 这正是"还没建过这个项目的 hooks.json"的状态。
  const snapshotFor = (scopeValue) =>
    snapshotOf({
      scope: scopeValue,
      projectFile: snapshotFile('project', 'absent'),
      userFile: snapshotFile('user', 'ok'),
    })
  const initial = await renderSection(component, harness, (url) => ({
    ok: true,
    data: snapshotFor(url.includes('scope=workspace') ? 'w-1' : 'user'),
  }))
  // 切到那个工作区（页面里的"文件不存在"发生在项目级那份上）
  const nodes = await pickScopeOption(initial, component, harness, 'w-1')
  const joined = joinedText(nodes)
  // ⚠️ 本轮把"一行小字 `文件不存在 [新建这个文件]`"换成了**空状态块**：断言随文案更新，
  //   但原防护意图一字不差地保留 ——（a）不存在必须**明说**；(b) 不许说成"读不出来"；
  //   (c) 同一页里另一份好的文件状态要**同时**说得清；(d) 「新建」按钮真的发 createFile。
  assert.equal(allByClass(nodes, 'dsh-hooks__empty').length, 1, '空状态要成块渲染（不是一行小字）')
  assert.ok(joined.includes('这个作用域还没有 hook'), '空状态块要有标题')
  assert.ok(
    joined.includes('这份 hooks.json 还不存在') && joined.includes('不是出错'),
    '"不存在"必须**明说**，并说清"这是空的、不是出错"（§2.9/§3.9）',
  )
  // v4：路径**不再上屏**（它进了按钮的 title 与「更多」折叠）。原防护意图保留：路径必须**可达**
  // —— 只是不再占空状态块的一行（用户读完那行还是不知道先点哪个，这正是 v4 要治的病）。
  assert.ok(
    !joined.includes('D:/p/.dsh/hooks.json'),
    '★ v4：空状态块也不再把盘符路径摆上屏（路径在按钮 title 与「更多」里）',
  )
  assert.ok(joined.includes('＋ 新建第一条 hook'), '主按钮是"新建第一条 hook"（打开新建表单）')
  assert.ok(joined.includes('新建配置文件'), '文件不存在时才有次按钮"新建配置文件"')
  const createFileButton = buttonByLabel(nodes, '新建配置文件（D:/p/.dsh/hooks.json）')
  assert.equal(typeof createFileButton.onClick, 'function', '路径在按钮 title 里可达，按钮本身仍然可用')
  assert.ok(
    !joined.includes('读不出来'),
    '不存在 ≠ 读不出来：绝不能说成"读不出来"（用户会去修一个没坏的文件，§2.9/§3.9）',
  )
  // 同一页里另一份文件是好的 —— v3 起那份**空的**来源不再占首屏一行（P0-5），它的状态在诊断
  // 折叠里如实说：三态一个都没丢，只是换了渲染点（原断言意图"两种状态必须同时说得清"保留）。
  const diag = await expandFold(nodes, component, harness, '更多')
  assert.ok(joinedText(diag).includes('用户级文件'), '诊断里有另一份文件那一行')
  assert.ok(
    joinedText(diag).includes('已读取'),
    '同一页里另一份文件是好的，两种状态必须**同时**说得清（v3 落在诊断里）',
  )

  const calls = []
  globalThis.fetch = async (_url: string, options: { method?: string; body?: string } = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return { json: async () => ({ ok: true, data: { file: 'project', version: 'v2' } }) }
  }
  createFileButton.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(calls.length, 1, '"新建配置文件"是一次写请求')
  assert.deepEqual(
    withoutLock(calls[0].body),
    { file: 'project', workspaceId: 'w-1', op: 'createFile' },
    '新建的必须是**当前作用域**那一份（选中的工作区的项目级文件），且带 workspaceId',
  )
})

//#region D14–D20. 作用域选择器（§8 的渲染断言）
//   每条都先红后绿：注入违规 → 确认**精确**报错 → 还原。

await test('D14：默认作用域 = 用户 —— 用户级横幅、只读那份是用户文件、没有项目级卡', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const urls = []
  const nodes = await renderSection(component, harness, (url) => {
    urls.push(url)
    return {
      ok: true,
      data: snapshotOf({
        scope: 'user',
        userFile: snapshotFile('user', 'ok', {
          PreToolUse: [{ rawIndex: 0, hooks: [snapshotHook(0, 'echo user-level')] }],
        }),
        projectFile: snapshotFile('project', 'ok', {
          PreToolUse: [{ rawIndex: 0, hooks: [snapshotHook(0, 'echo project-level')] }],
        }),
      }),
    }
  })
  const joined = joinedText(nodes)

  assert.equal(urls.length, 1, '挂载后应当恰好取数一次')
  assert.ok(urls[0].includes('scope=user'), '默认必须读**用户级**那一份（用户要求默认全局）')
  // ① 触发器上写的就是「用户（全局）」——"（全局）"就是"对所有项目生效"那句话
  const trigger = scopeTrigger(nodes)
  assert.ok(textOfClass(nodes, 'dsh-hooks__triggerlabel').includes('用户（全局）'), '触发器显示当前作用域')
  assert.ok(
    trigger.title.includes('所有项目生效'),
    `§2.1 那句"用户级对所有项目生效"挂在触发器的 title 上（不占一行横幅）：${trigger.title}`,
  )
  // ② 没有项目级卡片/摘要：项目级的命令一次都不出现
  assert.ok(joined.includes('echo user-level'))
  assert.ok(!joined.includes('echo project-level'), '项目级那份的 hook 不许被渲染出来')
  assert.ok(!joined.includes('D:/p/.dsh/hooks.json'), '不许出现项目级文件卡/摘要')
  // 当前那份文件的**完整路径**在诊断折叠里（首屏只留作用域名，用户反馈"别堆路径"）
  const diag = await expandFold(nodes, component, harness, '更多')
  assert.ok(joinedText(diag).includes('C:/u/.dsh/hooks.json'), '诊断里能看到当前那份文件是谁')
  // ③ **没有堆叠横幅**：用户级作用域 + 文件正常 ⇒ 一条提示都没有（参考图的安静形态）
  assert.equal(allByClass(nodes, 'dsh-hooks__alert').length, 0, '正常情况下提示行 0 条')
})

await test('D15：自绘 popover —— 分组 + 当前项打勾 + 键盘 + 点外部关闭', async () => {
  const workspaces = [
    { id: 'w-1', title: 'agent-go', path: 'D:/p', projectRoot: 'D:/p', isCurrent: false },
    { id: 'w-2', title: 'dsh-hooks', path: 'D:/q', projectRoot: 'D:/q', isCurrent: true },
  ]
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const nodes = await renderSection(component, harness, (url) =>
    // ⚠️ 取数必须**按请求的作用域**回答（真宿主就是这么做的）。写死一份快照的话，
    // "选中 w-1 之后触发器应当写 agent-go"这条断言会变成在测一个说谎的宿主 ——
    // 本轮的 F1 就是"页面显示必须跟宿主回显"，fixture 自己先得自洽。
    ({
      ok: true,
      data: snapshotOf({
        scope: String(url).includes('scope=workspace') ? 'w-1' : 'user',
        workspaces,
        projectRoot: 'D:/q',
      }),
    }),
  )
  // 收起时**没有**列表（参考图那个安静的首屏）
  assert.equal(allByClass(nodes, 'dsh-hooks__popover').length, 0, '默认收起')

  // ① Enter 打开（键盘，不是鼠标）→ listbox + option 语义 + 分组
  scopeTrigger(nodes).onKeyDown(keyEvent('Enter'))
  const opened = await advance(component, harness)
  assert.equal(allByClass(opened, 'dsh-hooks__popover').length, 1, 'Enter 必须打开 popover')
  assert.equal(firstByClass(opened, 'dsh-hooks__popover').role, 'listbox', 'role="listbox"')
  const options = allByClass(opened, 'dsh-hooks__option')
  assert.deepEqual(
    options.map((option) => option.value),
    ['user', 'w-1', 'w-2'],
    '选项 = 用户 + 各工作区（本项目在清单里 ⇒ 不额外补 current）',
  )
  assert.ok(
    options.every((option) => option.role === 'option'),
    '每一项都是 role="option"',
  )
  assert.deepEqual(
    options.map((option) => option.ariaSelected),
    [true, false, false],
    '当前项 aria-selected=true',
  )
  assert.ok(joinedText(opened).includes('✓'), '当前项右侧打勾（参考图）')
  assert.ok(allByClass(opened, 'dsh-hooks__group').length >= 2, '有分组标题（用户 / 工作区）')

  // ② ↓ 移动高亮 → Enter 选中
  scopeTrigger(opened).onKeyDown(keyEvent('ArrowDown'))
  const moved = await advance(component, harness)
  const active = allByClass(moved, 'dsh-hooks__option--active')
  assert.equal(active.length, 1, '同一时刻只有一个高亮项')
  assert.equal(active[0].value, 'w-1', 'Enter 打开时高亮停在当前项，↓ 移动到下一项')
  scopeTrigger(moved).onKeyDown(keyEvent('Enter'))
  const picked = await advance(component, harness)
  assert.equal(allByClass(picked, 'dsh-hooks__popover').length, 0, '选中后收起')
  assert.ok(textOfClass(picked, 'dsh-hooks__triggerlabel').includes('agent-go'), '触发器换成被选中的那个工作区')

  // ③ Esc 关闭 / 点外部（背板）关闭
  const reopened = await openScopePicker(picked, component, harness)
  scopeTrigger(reopened).onKeyDown(keyEvent('Escape'))
  const escaped = await advance(component, harness)
  assert.equal(allByClass(escaped, 'dsh-hooks__popover').length, 0, 'Esc 必须关闭')
  const again = await openScopePicker(escaped, component, harness)
  firstByClass(again, 'dsh-hooks__backdrop').onClick()
  const outside = await advance(component, harness)
  assert.equal(allByClass(outside, 'dsh-hooks__popover').length, 0, '点外部必须关闭')
})

await test('D16：选中工作区后点开关 ⇒ 请求体带 workspaceId（开关是 role=switch + aria-checked）', async () => {
  const workspaces = [{ id: 'w-1', title: 'agent-go', path: 'D:/p', projectRoot: 'D:/p', isCurrent: false }]
  const userFile = snapshotFile('user', 'ok')
  const projectFile = snapshotFile('project', 'ok', {
    PreToolUse: [{ rawIndex: 0, matcher: 'pwsh', hooks: [snapshotHook(0, 'echo a')] }],
  })
  const snapshotFor = (scopeValue) =>
    snapshotOf({ scope: scopeValue, workspaces, isCurrentSession: false, userFile, projectFile })

  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const urls = []
  const first = await renderSection(component, harness, (url) => {
    urls.push(url)
    return { ok: true, data: snapshotFor(url.includes('scope=workspace') ? 'w-1' : 'user') }
  })
  assert.ok(urls[0].includes('scope=user'), '页面默认还是用户作用域')

  // 切作用域（自绘 popover：点触发器 → 点选项）→ 重新渲染 → 重新取数（§4.5：别拿旧节点判断）
  const after = await pickScopeOption(first, component, harness, 'w-1')
  assert.ok(
    urls.some((url) => url.includes('scope=workspace') && url.includes('workspaceId=w-1')),
    `切作用域后必须按选中工作区取数，实际请求：${urls.join(' , ')}`,
  )
  assert.ok(joinedText(after).includes('echo a'), '显示的是那个工作区的 hook')

  // 开关的可访问性语义（§6.4）
  const sw = switchNode(after)
  assert.equal(sw.ariaChecked, true, '启用中的 hook → 开关处于"开"（aria-checked=true）')

  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, url: String(url), body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return {
      json: async () =>
        method === 'POST'
          ? { ok: true, data: { file: 'project', version: 'v2' } }
          : { ok: true, data: snapshotFor('w-1') },
    }
  }
  switchNode(after).onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(calls[0].method, 'POST', '点开关是一次写请求')
  assert.equal('workspaceId' in calls[0].body, true, '★ 选中工作区时请求体**必须**带 workspaceId（§2.2）')
  assert.deepEqual(withoutLock(calls[0].body), {
    file: 'project',
    workspaceId: 'w-1',
    op: 'setHookDisabled',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 0,
    disabled: true,
  })
})

await test('D17：选中非当前工作区 ⇒ **一行信息**（不是黄底横幅）；选中当前工作区 ⇒ 没有提示', async () => {
  const workspaces = [
    { id: 'w-1', title: 'agent-go', path: 'D:/p', projectRoot: 'D:/p', isCurrent: false },
    { id: 'w-2', title: 'dsh-hooks', path: 'D:/q', projectRoot: 'D:/q', isCurrent: true },
  ]
  const other = createFakeReact()
  const otherComponent = componentFromArtifact(other.React)
  // fixture **按请求的作用域**回答（真宿主就是这样）：先落在用户级、再点开下拉切到 w-1。
  // 写死一份 `scope:'w-1'` 的快照会造出"请求 user、回 w-1"的说谎宿主 —— 那正是 F2 的同一类问题，
  // 出现在自检里同样会让断言测的不是真实形态。
  const otherInitial = await renderSection(otherComponent, other, (url) => ({
    ok: true,
    data: String(url).includes('scope=workspace')
      ? snapshotOf({ scope: 'w-1', workspaces, isCurrentSession: false, projectRoot: 'D:/p' })
      : snapshotOf({ scope: 'user', workspaces, projectRoot: 'D:/p' }),
  }))
  const otherNodes = await pickScopeOption(otherInitial, otherComponent, other, 'w-1')
  // ⚠️ 提醒行的正文现在装在 `__alerttext` 里（外面多了一层，给动作按钮留位置）——
  //    `textOfClass` 遇到下一个有类名的元素就停，所以这里取到的是**正文**而不是整行。
  const otherAlert = textOfClass(otherNodes, 'dsh-hooks__alerttext')
  const errorAlerts = otherNodes.filter(
    (node) => typeof node.className === 'string' && node.className.includes('dsh-hooks__alert--error'),
  )
  const alerts = allByClass(otherNodes, 'dsh-hooks__alert')
  const otherJoined = joinedText(otherNodes)
  assert.equal(alerts.length, 1, '非当前工作区时**恰好一条**提示（不堆叠）')
  assert.equal(errorAlerts.length, 0, '它不是错误，不该用错误底色')
  // ★ v3（R2）：黄底横幅 → **非黄色信息行**。`--info` 是显式类；样式里 `__alert` 基类**没有底色**
  //   （D30 对样式字符串做字面断言），所以"黄底警告"在结构上不可能回来。
  assert.ok(
    alerts[0].className.includes('dsh-hooks__alert--info'),
    `★ 它必须是**信息**行（--info），不是警告横幅：${String(alerts[0].className)}`,
  )
  assert.ok(otherAlert.includes('本会话不读这份配置'), `一句话说清这一份不是本会话在读的：${otherAlert}`)
  assert.ok(otherAlert.includes('agent-go'), '要说清正在看/改哪个工作区')
  // ★ P0-2：提醒行正文里不许再出现盘符路径 / 项目根 / "报 sandbox 属预期"这类内部话术。
  //   ⚠️ 只对**提醒行**断言路径：这一屏的主列表是空的（这个 fixture 的项目级文件 0 条），
  //   空状态块里的路径是 D23 明确要求显示的 —— 那是**另一件事**，不该被这条误伤。
  assert.ok(!otherAlert.includes('项目根'), '★ 提醒行正文里不许出现"项目根"（它进诊断折叠了）')
  assert.ok(!otherAlert.includes('D:/'), '★ 提醒行正文里不许出现盘符路径')
  assert.ok(!otherJoined.includes('项目根'), '★ 首屏（可见文本）不许出现"项目根"')
  assert.ok(!otherJoined.includes('sandbox 属预期'), '★ 更不许出现"报 sandbox 属预期"这种内部话术')
  // ★ F4：这条提醒**最多两句话**（真机上它曾经堆到三四行）。句子数是能在 DOM 上量的代理指标，
  //   所以它与"两行以内"一起构成回归护栏：信息一件都不许丢，但不许再涨回去。
  assert.ok(
    otherAlert.split('。').filter((part) => part.trim() !== '').length <= 2,
    `那条提醒最多两句话（压到两行内）：${otherAlert}`,
  )
  // 被删掉的两条事实必须**仍然可达**：项目根一行还在，另加"写入权限"一行（含沙箱这件事）。
  const otherDiag = await expandFold(otherNodes, otherComponent, other, '更多')
  const otherDiagText = joinedText(otherDiag)
  assert.ok(otherDiagText.includes('写入权限'), '★ 诊断里必须新增"写入权限"一行（P0-2 要求落点）')
  assert.ok(otherDiagText.includes('沙箱'), '"写入权限"要说清它是按沙箱策略判定的')
  assert.ok(otherDiagText.includes('项目根'), '诊断里的"项目根"一行仍在（确认没被一起删掉）')

  const current = createFakeReact()
  const currentComponent = componentFromArtifact(current.React)
  const currentInitial = await renderSection(currentComponent, current, (url) => ({
    ok: true,
    data: String(url).includes('w-2')
      ? snapshotOf({ scope: 'w-2', workspaces, isCurrentSession: true, projectRoot: 'D:/q' })
      : snapshotOf({ scope: 'user', workspaces, projectRoot: 'D:/p' }),
  }))
  const currentNodes = await pickScopeOption(currentInitial, currentComponent, current, 'w-2')
  // 当前工作区 + 文件正常 ⇒ **一条提示都没有**（参考图的安静形态）；"立即生效"那句挂在触发器 title 上
  assert.equal(allByClass(currentNodes, 'dsh-hooks__alert').length, 0, '当前工作区不是提醒情形')
  assert.ok(
    scopeTrigger(currentNodes).title.includes('立即'),
    `当前工作区要说"改动立即生效"（§2.1）：${scopeTrigger(currentNodes).title}`,
  )
})

await test('D18：搜索是纯前端过滤 —— 卡片变少、原始下标不变、无结果说"没有匹配的 hook"', async () => {
  // ⚠️ v3：搜索框**只在 `fileTotal >= 5` 时渲染**（1 条 hook 的页面上它是纯噪音），所以这个
  //    用例的文件里放 5 条 —— 否则连搜索框都没有，"过滤"就无从谈起（阈值两个分支见 D29）。
  const file = snapshotFile('project', 'ok', {
    PreToolUse: [
      {
        rawIndex: 1,
        matcher: 'pwsh',
        hooks: [
          snapshotHook(0, 'echo keep-me'),
          snapshotHook(1, 'echo drop-me'),
          snapshotHook(2, 'echo filler-2'),
          snapshotHook(3, 'echo filler-3'),
          snapshotHook(4, 'echo filler-4'),
        ],
      },
    ],
  })
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const nodes = await renderSection(component, harness, { ok: true, data: minimalSnapshot({ userFile: file }) })
  assert.equal(allByClass(nodes, 'dsh-hooks__hookcard').length, 5, '没过滤时 5 条 hook 都在')

  // 输入过滤词 → 重新渲染 → 再看（§4.5）
  firstByClass(nodes, 'dsh-hooks__search').onChange({ target: { value: 'keep' } })
  const filtered = await advance(component, harness)
  assert.equal(allByClass(filtered, 'dsh-hooks__hookcard').length, 1, '过滤后只剩一条卡')
  const joined = joinedText(filtered)
  assert.ok(joined.includes('匹配 1 / 共 5'), '要说清"匹配 K / 共 N"（N 是文件里的总条数）')
  assert.ok(!joined.includes('echo drop-me'))

  // ★ 原始下标不变：剩下的那条 hook 在文件里是 group 1 / hook 0，请求体必须原样回传
  const calls = []
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return {
      json: async () =>
        method === 'POST'
          ? { ok: true, data: { file: 'user', version: 'v2' } }
          : { ok: true, data: minimalSnapshot({ userFile: file }) },
    }
  }
  switchNode(filtered).onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(
    withoutLock(calls[0].body),
    {
      file: 'user',
      op: 'setHookDisabled',
      event: 'PreToolUse',
      groupIndex: 1,
      hookIndex: 0,
      disabled: true,
    },
    '过滤只影响渲染：发出去的必须是**文件里**的真实下标（否则会改错 hook）',
  )

  // 无结果时说"没有匹配的 hook"（≠"没有配置"）
  firstByClass(filtered, 'dsh-hooks__search').onChange({ target: { value: 'zzz-not-there' } })
  const empty = await advance(component, harness)
  const emptyJoined = joinedText(empty)
  assert.equal(allByClass(empty, 'dsh-hooks__hookcard').length, 0)
  assert.ok(emptyJoined.includes('没有匹配的 hook'), '过滤无结果要单独说清')
  assert.ok(!emptyJoined.includes('没有配置'), '过滤无结果 ≠ 没有配置（两者不许混）')
})

await test('D19：「＋新建」提交 ⇒ addGroup（event/matcher/command 正确）；表单错误只渲染在表单里', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const first = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })
  const calls = []
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return method === 'POST'
      ? { json: async () => ({ ok: true, data: { file: 'project', version: 'v2' } }) }
      : { json: async () => ({ ok: true, data: minimalSnapshot() }) }
  }

  // 打开表单（工具条按钮）→ 表单必须真的出现
  toolButton(first, '新建').onClick()
  const opened = await advance(component, harness)
  assert.equal(allByClass(opened, 'dsh-hooks__newform').length, 1, '点「＋新建」必须展开表单')
  assert.equal(allByClass(opened, 'dsh-hooks__input').length, 2, '表单有 matcher / timeout 两个文本框')

  // 事件 `Stop` 没有 matcher：那个输入框必须**不渲染**（填了也不生效是界面的错）
  const eventSelect = firstByClass(opened, 'dsh-hooks__newselect')
  assert.equal(eventSelect.tag, 'select', '事件也用原生 select')
  eventSelect.onChange({ target: { value: 'Stop' } })
  let tree = await advance(component, harness)
  assert.equal(allByClass(tree, 'dsh-hooks__input').length, 1, 'matcherless 事件下只剩 timeout 一个输入框')

  // 切回 PreToolUse → 填 matcher / command / timeout（§4.5：每次输入后重新渲染再看）
  firstByClass(tree, 'dsh-hooks__newselect').onChange({ target: { value: 'PreToolUse' } })
  tree = await advance(component, harness)
  const inputs = allByClass(tree, 'dsh-hooks__input')
  assert.equal(inputs.length, 2)
  inputs[0].onChange({ target: { value: 'pwsh' } })
  tree = await advance(component, harness)
  allByClass(tree, 'dsh-hooks__editor')[0].onChange({ target: { value: 'echo new-hook' } })
  tree = await advance(component, harness)
  allByClass(tree, 'dsh-hooks__input')[1].onChange({ target: { value: '30' } })
  tree = await advance(component, harness)

  // 注意：`advance` 每次都会重跑取数 effect（假 React 的 useEffect 是"每次渲染都收集"），
  // 所以断言"提交发的那一次"之前要把已记录的清掉。
  calls.length = 0
  buttonByLabel(tree, '创建').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.length, 1, '提交只发一次请求')
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(
    withoutLock(calls[0].body),
    {
      file: 'user',
      op: 'addGroup',
      event: 'PreToolUse',
      matcher: 'pwsh',
      command: 'echo new-hook',
      timeoutSec: 30,
    },
    '「＋新建」= 一次 addGroup 定点操作（宿主负责建组 / 建文件）',
  )

  // ★ 失败错误只渲染在**表单内**（§3.7）：页面级横幅一条都不许有
  const failing = createFakeReact()
  const failingComponent = componentFromArtifact(failing.React)
  const initial = await renderSection(failingComponent, failing, { ok: true, data: minimalSnapshot() })
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method ?? 'GET'
    return {
      json: async () =>
        method === 'POST'
          ? { ok: false, error: 'exists', detail: 'FS_EXISTS: 目标已存在' }
          : { ok: true, data: minimalSnapshot() },
    }
  }
  toolButton(initial, '新建').onClick()
  let formTree = await advance(failingComponent, failing)
  allByClass(formTree, 'dsh-hooks__editor')[0].onChange({ target: { value: 'echo x' } })
  formTree = await advance(failingComponent, failing)
  buttonByLabel(formTree, '创建').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const afterFail = await advance(failingComponent, failing)
  const failJoined = joinedText(afterFail)
  assert.ok(failJoined.includes('已经存在'), '表单里要说清"文件已经存在"（人话，不是码）')
  assert.ok(failJoined.includes('FS_EXISTS'), '技术原文只作补充（排查要用得上）')
  assert.equal(allByClass(afterFail, 'dsh-hooks__newerror').length, 1, '表单错误**只**渲染在表单内')
  assert.equal(
    afterFail.filter((node) => typeof node.className === 'string' && node.className.includes('banner--error')).length,
    0,
    '§3.7：表单失败**不许**同时写进页面级横幅（一条错误只允许一个渲染点）',
  )
})

await test('D20：workspacesAvailable:false ⇒ 明说"宿主没有提供工作区清单"，而不是空下拉', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const nodes = await renderSection(component, harness, {
    ok: true,
    data: snapshotOf({ scope: 'user', workspaces: [], workspacesAvailable: false }),
  })
  // "宿主没有清单"在**诊断折叠**里明说（首屏不再为它占一行，但它必须可达）
  const diag = await expandFold(nodes, component, harness, '更多')
  assert.ok(
    joinedText(diag).includes('宿主没有提供工作区清单'),
    '"宿主没有清单"必须**明说**（不是渲染成空下拉，也不是沉默，§3.6/§3.9）',
  )
  // popover 里只剩「用户」+「当前会话项目」（后者**不需要** registry：它按会话 cwd 解析）
  const opened = await openScopePicker(nodes, component, harness)
  assert.deepEqual(
    allByClass(opened, 'dsh-hooks__option').map((option) => option.value),
    ['user', 'current'],
    '没有清单时下拉不是空的，但也**不含**工作区项',
  )

  // 反向：清单存在但为空 → 另一种说法（"还没有工作区"，空 ≠ 不存在）
  const emptyHarness = createFakeReact()
  const emptyComponent = componentFromArtifact(emptyHarness.React)
  const emptyNodes = await renderSection(emptyComponent, emptyHarness, {
    ok: true,
    data: snapshotOf({ scope: 'user', workspaces: [], workspacesAvailable: true }),
  })
  const emptyDiag = await expandFold(emptyNodes, emptyComponent, emptyHarness, '更多')
  const emptyJoined = joinedText(emptyDiag)
  assert.ok(emptyJoined.includes('0 项'), '清单为空时说"0 项"（有清单，只是空的）')
  assert.ok(!emptyJoined.includes('宿主没有提供工作区清单'), '"空清单"与"没有清单"必须长得不一样')
})

await test('D21：会话项目不在工作区清单里 ⇒ 下拉补「当前会话项目」，选中后读写都不带 workspaceId', async () => {
  // 本机正在开发的这个插件项目就是这种形态：会话项目**不是** registry 里的工作区。
  const projectRoot = 'D:/dev/dsh-hooks'
  const workspaces = [{ id: 'w-1', title: 'agent-go', path: 'D:/p', projectRoot: 'D:/p', isCurrent: false }]
  const userFile = snapshotFile('user', 'ok')
  const projectFile = snapshotFile('project', 'ok', {
    PreToolUse: [{ rawIndex: 0, matcher: 'pwsh', hooks: [snapshotHook(0, 'echo a')] }],
  })
  const snapshotFor = (scopeValue) => snapshotOf({ scope: scopeValue, workspaces, projectRoot, userFile, projectFile })

  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const urls = []
  const first = await renderSection(component, harness, (url) => {
    urls.push(url)
    return { ok: true, data: snapshotFor(url.includes('scope=current') ? 'current' : 'user') }
  })
  const firstJoined = joinedText(first)

  // ① popover 里必须出现「当前会话项目（<路径最后一段>）」，排在「用户」之后
  const opened = await openScopePicker(first, component, harness)
  assert.deepEqual(
    allByClass(opened, 'dsh-hooks__option').map((option) => option.value),
    ['user', 'current', 'w-1'],
    '会话项目不在清单里时必须补一个 current 选项（否则改不到正在开发的这个项目）',
  )
  assert.ok(
    joinedText(opened).includes('当前会话项目（dsh-hooks）'),
    'label 要带路径最后一段（用户一眼知道是哪个目录）',
  )
  // ② "当前会话项目不在清单里"那句提示在诊断折叠里，并**指向**这个选项（不是死提示）
  const diag = await expandFold(first, component, harness, '更多')
  const diagText = joinedText(diag)
  assert.ok(diagText.includes('当前会话项目'), '诊断里要说清这个项目不在清单里')
  assert.ok(diagText.includes('用作用域下拉的'), '并且要指向「当前会话项目」选项，而不是让人无路可走')
  assert.ok(!diagText.includes('这里改不到它的项目级配置'), '死提示必须消失')

  // ③ 选中它 → GET 走 scope=current（**不是** scope=workspace&workspaceId=current，那必然 404）
  const picked = await openScopePicker(first, component, harness)
  scopeOptionOf(picked, 'current').onClick()
  const after = await advance(component, harness)
  const currentUrls = urls.filter((url) => url.includes('scope=current'))
  assert.ok(currentUrls.length >= 1, `选中后必须按 scope=current 取数，实际：${urls.join(' , ')}`)
  assert.ok(!urls.some((url) => url.includes('workspaceId=current')), 'current 不许被当成工作区 id（那会 404）')
  assert.ok(joinedText(after).includes('echo a'), '显示的是会话项目的文件')
  // ④ 触发器 title 说的是"项目"而不是"工作区"（后者会编造一个不存在的工作区）
  const hint = scopeTrigger(after).title
  assert.ok(hint.includes('这个项目'), `会话项目那条路要说"这个项目"：${hint}`)
  assert.ok(!hint.includes('这个工作区'), '不许把会话项目说成"某个工作区"')

  // ⑤ 写请求：file:'project' 且**不带** workspaceId（宿主按会话 cwd 落笔）
  const calls = []
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return {
      json: async () =>
        method === 'POST'
          ? { ok: true, data: { file: 'project', version: 'v2' } }
          : { ok: true, data: snapshotFor('current') },
    }
  }
  switchNode(after).onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls[0].method, 'POST')
  assert.equal('workspaceId' in calls[0].body, false, '当前会话项目**不许**带 workspaceId（带=404）')
  assert.deepEqual(withoutLock(calls[0].body), {
    file: 'project',
    op: 'setHookDisabled',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 0,
    disabled: true,
  })
})

await test('D22：取数失败时有恢复控件（重试 / 回到用户级配置），workspace 失败时后者突出', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const urls = []
  const failing = async (url) => {
    urls.push(String(url))
    return { ok: false, error: 'unknown-workspace', detail: '工作区 w-gone 不在宿主的清单里（可能被删过）' }
  }
  const nodes = await renderSection(component, harness, failing)
  const joined = joinedText(nodes)
  assert.ok(joined.includes('已经不在宿主的清单里'), '主文案是人话（§3.9）')

  // 两个恢复控件都在，且 workspace 这次失败时「回到用户级配置」是突出的那一个
  const retry = toolButton(nodes, '重试')
  const backToUser = toolButton(nodes, '回到用户级配置')
  assert.ok(
    backToUser.className.includes('dsh-hooks__toolbtn--primary'),
    'unknown-workspace 时「回到用户级配置」要突出（它会解掉这个死胡同）',
  )
  assert.ok(
    !retry.className.includes('dsh-hooks__toolbtn--primary'),
    '这时「重试」不是首选（同一个已删除的工作区会再失败一次）',
  )

  // 点「回到用户级配置」⇒ 必须重新取数，且 URL 是 scope=user
  const before = urls.length
  backToUser.onClick()
  await advance(component, harness)
  assert.ok(urls.length > before, '点了必须真的重新取数（不能只是清一清状态）')
  assert.ok(urls[urls.length - 1].includes('scope=user'), `重新取的 URL 必须含 scope=user：${urls[urls.length - 1]}`)

  // 对照：非 workspace 类失败（比如宿主内部错误）时突出的是「重试」——证明上面的突出是**有条件**的
  const otherHarness = createFakeReact()
  const other = await renderSection(componentFromArtifact(otherHarness.React), otherHarness, {
    ok: false,
    error: 'internal',
    detail: 'boom',
  })
  const otherRetry = toolButton(other, '重试')
  const otherBack = toolButton(other, '回到用户级配置')
  assert.ok(otherRetry.className.includes('dsh-hooks__toolbtn--primary'), '内部错误时首选是「重试」')
  assert.ok(!otherBack.className.includes('dsh-hooks__toolbtn--primary'))
})

await test('D：当前会话未知 ⇒ 说"无法判断实际会跑什么"，绝不显示「生效 0 条」', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  // 三态：`session === null` = 当前会话未知（读不到 ≠ 没有）
  const unknown = await renderSection(component, harness, {
    ok: true,
    data: minimalSnapshot({ session: null }),
  })
  const unknownJoined = joinedText(unknown)
  assert.ok(unknownJoined.includes('当前会话未知，无法判断实际会跑什么'), '必须说"不知道"')
  assert.ok(!unknownJoined.includes('当前会话生效'), '不许把"不知道"说成"没有"')
  assert.ok(!unknownJoined.includes('生效 0 条'))

  // 对照：**已知**为 0 条时反而必须照实说 —— 证明上面那条不是"一律禁止"（否则是平凡通过的断言）
  const knownHarness = createFakeReact()
  const known = await renderSection(componentFromArtifact(knownHarness.React), knownHarness, {
    ok: true,
    data: minimalSnapshot({ session: sessionEffect({ hookCount: 0, groupCount: 0, fromUser: 0, fromProject: 0 }) }),
  })
  assert.ok(joinedText(known).includes('本会话生效 0 个'), '已知的 0 条要如实说（v3 的短句口径）')
})

//#region D23–D26. 空状态 / 引导条 / 折叠降噪 / 样式硬指标（真机那一屏的收口）
//   每条都先红后绿：注入违规 → 确认**精确**报错 → 还原。

await test('D23：空状态块 —— "文件不存在"与"文件里 0 条"两种副文案分别说清；读不出来是第三种', async () => {
  // ① 文件不存在（真机那一屏：用户级 hooks.json 从来没建过）
  const absentHarness = createFakeReact()
  const absentComponent = componentFromArtifact(absentHarness.React)
  const absent = await renderSection(absentComponent, absentHarness, {
    ok: true,
    data: snapshotOf({ scope: 'user', userFile: snapshotFile('user', 'absent') }),
  })
  const absentJoined = joinedText(absent)
  assert.equal(allByClass(absent, 'dsh-hooks__empty').length, 1, '空状态要成块渲染（不是一行小字）')
  assert.ok(absentJoined.includes('这个作用域还没有 hook'), '空状态块要有标题')
  assert.ok(absentJoined.includes('这份 hooks.json 还不存在'), '"文件不存在"的副文案')
  assert.ok(absentJoined.includes('这是空的，不是出错'), '并且说清"这不是出错"（§2.9：空 ≠ 出错）')
  // v4：路径不上屏（进按钮 title），但必须**可达**（"我到底在说哪个文件"仍然能查到）
  assert.ok(!absentJoined.includes('C:/u/.dsh/hooks.json'), '★ v4：空状态块不再把盘符路径摆上屏')
  buttonByLabel(absent, '新建配置文件（C:/u/.dsh/hooks.json）')
  assert.ok(absentJoined.includes('＋ 新建第一条 hook'), '主按钮存在')
  assert.ok(absentJoined.includes('新建配置文件'), '文件不存在时才有"新建配置文件"')
  assert.equal(allByClass(absent, 'dsh-hooks__btn--outline').length, 0, '空状态块不许用描边按钮')
  // 主按钮**真的**打开新建表单（不是装饰品；§4.5：点完重新渲染再看）
  buttonByLabel(absent, '新建第一条 hook').onClick()
  const opened = await advance(absentComponent, absentHarness)
  assert.equal(allByClass(opened, 'dsh-hooks__newform').length, 1, '「＋ 新建第一条 hook」必须打开新建表单')

  // ② 文件在、但里面 0 条：**另一种**副文案，且**没有**"新建配置文件"
  const zeroHarness = createFakeReact()
  const zero = await renderSection(componentFromArtifact(zeroHarness.React), zeroHarness, {
    ok: true,
    data: snapshotOf({ scope: 'user', userFile: snapshotFile('user', 'ok') }),
  })
  const zeroJoined = joinedText(zero)
  assert.equal(allByClass(zero, 'dsh-hooks__empty').length, 1, '0 条同样是空状态块')
  assert.ok(zeroJoined.includes('文件里还没有任何 hook'), '"存在但 0 条"必须换一种说法')
  assert.ok(!zeroJoined.includes('这份 hooks.json 还不存在'), '两种情形不许糊成一句')
  assert.ok(!zeroJoined.includes('新建配置文件'), '"新建配置文件"只在文件不存在时出现')
  assert.ok(zeroJoined.includes('＋ 新建第一条 hook'), '0 条时主按钮同样是"新建第一条 hook"')

  // ③ **第三种情形**（本轮顺手修的诚实性）：文件读不出来 ⇒ 绝不冒充"空的"（读不到 ≠ 没有，§2.9）
  const brokenHarness = createFakeReact()
  const broken = await renderSection(componentFromArtifact(brokenHarness.React), brokenHarness, {
    ok: true,
    data: snapshotOf({ scope: 'user', userFile: snapshotFile('user', 'error') }),
  })
  const brokenJoined = joinedText(broken)
  assert.equal(allByClass(broken, 'dsh-hooks__empty').length, 0, '"读不出来"不是空状态')
  assert.ok(brokenJoined.includes('无法判断里面有没有 hook'), '读不出来时如实说"无法判断"')
  assert.ok(!brokenJoined.includes('文件里还没有任何 hook'), '绝不把"读不到"说成"没有"')
})

await test('D24：空状态引导条 —— 有内容的那一份出现「切换过去」，点击真的把页面换过去', async () => {
  // 真机那一屏的完整形状：作用域 = 用户（全局）、用户级文件不存在、当前会话项目里有 1 条，
  // 而**当前会话项目不在工作区清单里**（本机正在开发的插件项目就是这样）。
  const projectRoot = 'D:/dev/dsh-hooks'
  const workspaces = [{ id: 'w-1', title: 'agent-go', path: 'D:/p', projectRoot: 'D:/p', isCurrent: false }]
  const snapshotFor = (scopeValue) =>
    snapshotOf({
      scope: scopeValue,
      workspaces,
      projectRoot,
      userFile: snapshotFile('user', 'absent'),
      projectFile: snapshotFile('project', 'ok', {
        PreToolUse: [{ rawIndex: 0, matcher: null, hooks: [snapshotHook(0, 'echo project-level')] }],
      }),
      session: sessionEffect({ projectRoot, hookCount: 1, fromUser: 0, fromProject: 1 }),
    })

  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const urls = []
  const nodes = await renderSection(component, harness, (url) => {
    urls.push(String(url))
    return { ok: true, data: snapshotFor(String(url).includes('scope=current') ? 'current' : 'user') }
  })
  assert.equal(urls.length, 1, '挂载后恰好取数一次')
  assert.ok(urls[0].includes('scope=user'), '默认落在用户（全局）—— 真机就是这一屏')
  const joined = joinedText(nodes)
  assert.equal(allByClass(nodes, 'dsh-hooks__empty').length, 1, '前提：这一屏确实是空状态')
  // v4：证据（哪一份里有几个）从"单独一行字"挪进按钮的 `title` —— 按钮标签仍然是「切换过去」，
  //     所以断言改成"按类名找到它 + 证据在它的 title 里"（原来的防护意图一字不差）。
  const guide = guideButton(nodes)
  assert.ok(
    guide.title.includes('当前会话项目（dsh-hooks）里有 1 个 hook。'),
    `引导按钮要说清"哪一份里有几个"（不然用户只能看到"这里空"）：${String(guide.title)}`,
  )
  assert.ok(joined.includes('切换过去'), '并且给出一条路')
  assert.ok(!joined.includes('当前会话项目（dsh-hooks）里有 1 个 hook'), '★ v4：那句证据不再单独占一行（它进了 title）')

  // 点「切换过去」→ 真的重新取数，且 URL 是 scope=current（当前会话项目**不是**工作区，
  // 所以它不能伪装成 workspaceId —— 带了必然 404，见 write.ts 的 CURRENT_SCOPE 注释）。
  const before = urls.length
  guide.onClick()
  const after = await advance(component, harness)
  assert.ok(urls.length > before, '点了必须真的重新取数')
  assert.ok(
    urls.some((url) => url.includes('scope=current')),
    `点「切换过去」必须按 scope=current 取数，实际：${urls.join(' , ')}`,
  )
  assert.ok(!urls.some((url) => url.includes('workspaceId=current')), 'current 不许被当成工作区 id（那会 404）')
  assert.ok(joinedText(after).includes('echo project-level'), '切过去之后显示的是那个项目里的 hook')

  // 反方向：项目级为空、用户级有内容 ⇒ 引导回「用户（全局）」
  const userWithTwo = snapshotFile('user', 'ok', {
    UserPromptSubmit: [{ rawIndex: 0, matcher: null, hooks: [snapshotHook(0, 'echo u1'), snapshotHook(1, 'echo u2')] }],
  })
  const backHarness = createFakeReact()
  const backComponent = componentFromArtifact(backHarness.React)
  const backUrls = []
  const initial = await renderSection(backComponent, backHarness, (url) => {
    backUrls.push(String(url))
    return {
      ok: true,
      data: String(url).includes('scope=workspace')
        ? snapshotOf({
            scope: 'w-1',
            workspaces,
            projectRoot,
            projectFile: snapshotFile('project', 'ok'),
            userFile: userWithTwo,
          })
        : snapshotOf({ scope: 'user', workspaces, projectRoot, userFile: userWithTwo }),
    }
  })
  const atWorkspace = await pickScopeOption(initial, backComponent, backHarness, 'w-1')
  const backGuide = guideButton(atWorkspace)
  assert.ok(
    backGuide.title.includes('用户级（全局）里有 2 个 hook。'),
    `反方向同样要给引导（项目级空、用户级有内容），证据在 title 里：${String(backGuide.title)}`,
  )
  const backBefore = backUrls.length
  backGuide.onClick()
  const back = await advance(backComponent, backHarness)
  assert.ok(backUrls.length > backBefore, '点了必须真的重新取数')
  assert.ok(
    backUrls[backUrls.length - 1].includes('scope=user'),
    `反方向的引导必须切回用户级：${backUrls[backUrls.length - 1]}`,
  )
  assert.ok(joinedText(back).includes('echo u1'), '切回后显示的是用户级那份的 hook')
})

await test('D25：折叠收起时全页 __btn--outline 计数 = 0；展开后事件行是 ghost（描边只在工具条）', async () => {
  // 真机那一屏：用户（全局）+ 文件不存在 + 折叠收起。过去这里是"一行小字 + 用户点开折叠后的
  // 7 个描边「＋新建」"，现在内容区**一个描边按钮都不许有**。
  const realMachine = snapshotOf({
    scope: 'user',
    projectRoot: 'D:/dev/dsh-hooks',
    workspaces: [{ id: 'w-1', title: 'agent-go', path: 'D:/p', projectRoot: 'D:/p', isCurrent: false }],
    userFile: snapshotFile('user', 'absent'),
    session: sessionEffect({ projectRoot: 'D:/dev/dsh-hooks', hookCount: 1, fromUser: 0, fromProject: 1 }),
  })
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const collapsed = await renderSection(component, harness, { ok: true, data: realMachine })
  assert.equal(allByClass(collapsed, 'dsh-hooks__foldbody').length, 0, '折叠默认收起')
  // 先证明"这一屏确实有内容区按钮" —— 否则下面的 0 是平凡通过的（永不失败的断言比没有更糟）
  const contentButtons = allByClass(collapsed, 'dsh-hooks__btn')
  assert.ok(contentButtons.length >= 3, `空状态块本身就有内容区按钮（否则 0 是平凡的）：${contentButtons.length}`)
  assert.ok(
    contentButtons.some((node) => node.className.includes('dsh-hooks__btn--ghost')),
    '其中确实有 ghost 按钮（不是"因为什么都没渲染"才为 0）',
  )
  assert.equal(
    allByClass(collapsed, 'dsh-hooks__btn--outline').length,
    0,
    '★ 折叠收起时页面上 __btn--outline 计数必须是 0',
  )
  // 工具条那两个仍然是描边的 __toolbtn："描边只允许在工具条"不等于"工具条也不许描边"
  assert.ok(toolButton(collapsed, '刷新').className.includes('dsh-hooks__toolbtn'), '工具条按钮是 __toolbtn')
  assert.ok(!toolButton(collapsed, '新建').className.includes('--outline'), '工具条也不该用那个保留类')

  // 展开后：7 个事件行、每行一个 ghost「＋新建」，依然零描边内容按钮
  const opened = await expandFold(collapsed, component, harness, '更多')
  assert.equal(allByClass(opened, 'dsh-hooks__eventrow').length, HOOK_EVENTS.length, '展开后恰好 7 行')
  const rowNew = opened.filter((node) => typeof node.title === 'string' && node.title.startsWith('在 '))
  assert.equal(rowNew.length, HOOK_EVENTS.length, '7 个事件行各一个「＋新建」')
  for (const node of rowNew) {
    assert.ok(
      typeof node.className === 'string' && node.className.includes('dsh-hooks__btn--ghost'),
      `事件行的「＋新建」必须是 ghost（无描边）：${String(node.className)}`,
    )
  }
  assert.equal(allByClass(opened, 'dsh-hooks__btn--outline').length, 0, '展开后同样必须是 0')

  // 有卡片时也一样（卡内动作按钮本轮一并改成 ghost）——v4 起它们在 `⋯` 里，所以先展开菜单再数。
  const normalHarness = createFakeReact()
  const normalComponent = componentFromArtifact(normalHarness.React)
  const normal = await renderSection(normalComponent, normalHarness, {
    ok: true,
    data: minimalSnapshot(),
  })
  assert.ok(allByClass(normal, 'dsh-hooks__hookcard').length > 0, '前提：正常态确实有卡片')
  assert.equal(allByClass(normal, 'dsh-hooks__btn--ghost').length, 0, '★ v4：卡内动作按钮默认不渲染（在 ⋯ 里）')
  const cardMenu = await openCardMenu(normal, normalComponent, normalHarness)
  assert.ok(allByClass(cardMenu, 'dsh-hooks__btn--ghost').length >= 3, '展开 ⋯ 之后三个动作按钮是 ghost')
  assert.equal(allByClass(cardMenu, 'dsh-hooks__btn--outline').length, 0, '卡片动作按钮同样不许描边')
})

await test('D26：样式字符串的硬指标（popover 可滚动 / 720px 上限 / 事件行 32px / 内容区按钮无描边）', () => {
  // 样式是注入的字符串，没有 DOM 可量 —— 所以对它做**字面**断言。这不是格式检查：下面每一条
  // 都对应一个真机上会看见的现象（8+ 工作区时 popover 超出屏幕 / 宽窗口把卡片拉满 / 7 行忽高忽低）。
  const ruleOf = (selector) => {
    const at = styles.indexOf(selector)
    assert.ok(at >= 0, `样式里应当有 ${selector} 这条规则`)
    const open = styles.indexOf('{', at)
    const close = styles.indexOf('}', open)
    assert.ok(open > at && close > open, `${selector} 的规则体没找到`)
    return styles.slice(open + 1, close)
  }
  const popover = ruleOf('.dsh-hooks__popover {')
  assert.ok(popover.includes('max-height:320px'), 'popover 必须有高度上限（否则工作区一多就超出屏幕）')
  assert.ok(popover.includes('overflow-y:auto'), '并且要在**自己内部**滚动')
  assert.ok(popover.includes('overscroll-behavior:contain'), '滚到底不许把滚动传给页面（滚动链）')

  assert.ok(
    ruleOf('.dsh-hooks {').includes('max-width:720px'),
    '宽窗口下卡片不该被拉满（与同目录 dsh-skill-manager 的基准一致）',
  )
  assert.ok(ruleOf('.dsh-hooks__eventrow {').includes('height:32px'), '折叠里的事件行固定 32px（7 行等距）')
  assert.ok(ruleOf('.dsh-hooks__btn {').includes('border:0'), '内容区按钮基座无描边')
  assert.ok(
    ruleOf('.dsh-hooks__btn--outline {').includes('border:.5px solid'),
    '--outline 才是描边修饰符（内容区禁用，D25 数它）',
  )
  assert.ok(
    ruleOf('.dsh-hooks__btn--ghost {').includes('dsw-alias-label-secondary'),
    'ghost 是次要色（hover 才转主色）',
  )
})

await test('D27：触发器的 label 与勾选都跟**宿主回显**（不是本地 state）—— 回显说哪份就是哪份', async () => {
  // 这一条是 AGENTS §2.6 的落地，也是 Lead 在截图里抓到的真 bug：触发器 label 用了本地 state
  // （初始 'user'），而卡片/横幅/摘要用回显 ⇒ 同一屏"触发器说用户级、数据是项目级"。
  const projectRoot = 'D:/dev/dsh-hooks'
  const workspaces = [{ id: 'w-1', title: 'agent-go', path: 'D:/p', projectRoot: 'D:/p', isCurrent: false }]
  const userWithHook = snapshotFile('user', 'ok', {
    PreToolUse: [{ rawIndex: 0, matcher: null, hooks: [snapshotHook(0, 'echo u')] }],
  })
  const snapshotFor = (scopeValue) => snapshotOf({ scope: scopeValue, workspaces, projectRoot, userFile: userWithHook })

  // ① 回显 `kind:'workspace', requested:'current', workspaceId:null` ⇒ label 是「当前会话项目（…）」、勾选在它
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const first = await renderSection(component, harness, (url) => ({
    ok: true,
    data: snapshotFor(String(url).includes('scope=current') ? 'current' : 'user'),
  }))
  assert.ok(
    textOfClass(first, 'dsh-hooks__triggerlabel').includes('用户（全局）'),
    '还没切之前（本地与回显都是 user）触发器写用户（全局）',
  )
  const atCurrent = await pickScopeOption(first, component, harness, 'current')
  assert.equal(
    textOfClass(atCurrent, 'dsh-hooks__triggerlabel'),
    '当前会话项目（dsh-hooks）',
    '① 回显 current ⇒ label 必须是「当前会话项目（…）」（本地 state 是 current，回显也是）',
  )
  const openedA = await openScopePicker(atCurrent, component, harness)
  assert.deepEqual(
    allByClass(openedA, 'dsh-hooks__option').map((option) => option.ariaSelected),
    [false, true, false],
    '① 勾选在 current 那一项',
  )
  assert.ok(joinedText(openedA).includes('✓'), '勾选标记同样跟着它')

  // ② ★ 回显把 `current` **归一化成 user**（没有会话上下文）⇒ 不许继续标"当前会话项目"
  const norm = createFakeReact()
  const normComponent = componentFromArtifact(norm.React)
  const normFirst = await renderSection(normComponent, norm, () => ({
    // 无论请求哪一份，宿主都回**用户级**（scope=current 拿不到会话 ⇒ 归一化成 user）
    ok: true,
    data: snapshotFor('user'),
  }))
  const afterNorm = await pickScopeOption(normFirst, normComponent, norm, 'current')
  assert.equal(
    textOfClass(afterNorm, 'dsh-hooks__triggerlabel'),
    '用户（全局）',
    '② 回显 user ⇒ 必须显示「用户（全局）」，不许继续说谎说"当前会话项目"',
  )
  const openedB = await openScopePicker(afterNorm, normComponent, norm)
  assert.deepEqual(
    allByClass(openedB, 'dsh-hooks__option').map((option) => option.ariaSelected),
    [true, false, false],
    '② 勾选也回到 user',
  )
  // ★ 写请求同样跟回显：本地 scope 还是 'current'，但屏幕上是用户级那份 ⇒ 必须发 file:'user'
  const calls = []
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return {
      json: async () =>
        method === 'POST'
          ? { ok: true, data: { file: 'user', version: 'v2' } }
          : { ok: true, data: snapshotFor('user') },
    }
  }
  // ⚠️ 必须用**这一份**渲染器（`norm`）来重渲染：假 React 的 `useState` 是按**位置**发值的，
  //    拿另一个 store 去渲染同一个组件会读到错位的值（第一版就写错成 `harness`，页面直接变"读取中…"）。
  norm.begin()
  const beforeWrite = norm.flatten(normComponent())
  switchNode(beforeWrite).onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls[0].method, 'POST', '点开关是一次写请求')
  assert.deepEqual(
    withoutLock(calls[0].body),
    { file: 'user', op: 'setHookDisabled', event: 'PreToolUse', groupIndex: 0, hookIndex: 0, disabled: true },
    '★ 写请求也必须落在**屏幕上这一份**（回显推导），否则就是"看着 A 改到 B"',
  )

  // ③ 回显带 `workspaceId` ⇒ label 是那个工作区的标题、勾选在它
  const wsHarness = createFakeReact()
  const wsComponent = componentFromArtifact(wsHarness.React)
  const wsFirst = await renderSection(wsComponent, wsHarness, (url) => ({
    ok: true,
    data: snapshotFor(String(url).includes('scope=workspace') ? 'w-1' : 'user'),
  }))
  const atWs = await pickScopeOption(wsFirst, wsComponent, wsHarness, 'w-1')
  assert.equal(textOfClass(atWs, 'dsh-hooks__triggerlabel'), 'agent-go', '③ 回显 workspaceId ⇒ label 是工作区标题')
  const openedC = await openScopePicker(atWs, wsComponent, wsHarness)
  assert.deepEqual(
    allByClass(openedC, 'dsh-hooks__option').map((option) => option.ariaSelected),
    [false, false, true],
    '③ 勾选在 w-1 那一项',
  )
})

await test('D28：底部摘要的动作只在"目标 ≠ 当前作用域"时出现（不许自己指自己）', async () => {
  const projectFile = snapshotFile('project', 'ok', {
    PreToolUse: [{ rawIndex: 0, matcher: null, hooks: [snapshotHook(0, 'echo p')] }],
  })
  const userFile = snapshotFile('user', 'ok', {
    UserPromptSubmit: [{ rawIndex: 0, matcher: null, hooks: [snapshotHook(0, 'echo u')] }],
  })
  /** 「切过去」那一类按钮（按 title 取）—— v3 起引导是一句话 + 一个 ghost 动作，不再是一整句文案。 */
  const switchButtons = (nodes) =>
    nodes.filter((node) => typeof node.title === 'string' && node.title.startsWith('切到'))

  // ① 正常形态：回显是工作区 ⇒ 用户级那一行**必须**给出切换动作（目标 ≠ 当前）
  const wsHarness = createFakeReact()
  const wsNodes = await renderSection(componentFromArtifact(wsHarness.React), wsHarness, {
    ok: true,
    data: snapshotOf({ scope: 'w-1', projectFile, userFile }),
  })
  const wsJoined = joinedText(wsNodes)
  assert.ok(wsJoined.includes('用户级（全局）还有 1 个 hook'), '前提：那一行确实渲染了（有内容才出现）')
  const wsSwitches = switchButtons(wsNodes)
  assert.equal(wsSwitches.length, 1, '目标 ≠ 当前 ⇒ 恰好一个切换动作')
  assert.equal(wsSwitches[0].title, '切到用户级（全局）')
  assert.ok(
    typeof wsSwitches[0].className === 'string' && wsSwitches[0].className.includes('dsh-hooks__btn--ghost'),
    '内容区的动作是 ghost（描边只允许在工具条）',
  )

  // ② 回显 `kind:'user'`：用户级那一行**不许**再出现"切到用户级（全局）" ——
  //    那句话是在让用户切到他自己所在的地方（Lead 在 shot-1 里抓到的原话）。
  //    ⚠️ fixture 说明：真机上 `scope=user` 只回用户级一份，而 `others` 又总是排除主文件，
  //    所以"用户级那份出现在摘要里"这个形状真机给不出来 ⇒ 直接那么写的话，这条断言会因为
  //    `others` 永远是别的 kind 而**永远通过**（AGENTS §4.3 陷阱⑤：平凡断言）。
  //    这里**故意**给两份用户级：第一份是主文件、第二份落进 `others` —— 于是"目标 = 当前"
  //    这一支真的被走到，去掉 `wantSwitchTo` 里的判断这条就红（已做反向验证）。
  const selfHarness = createFakeReact()
  const selfNodes = await renderSection(componentFromArtifact(selfHarness.React), selfHarness, {
    ok: true,
    data: { ...snapshotOf({ scope: 'user', userFile }), files: [userFile, { ...userFile }, projectFile] },
  })
  const selfJoined = joinedText(selfNodes)
  const selfSwitches = switchButtons(selfNodes)
  assert.equal(selfSwitches.length, 1, '用户级那一行（目标 = 当前）不许有动作；有内容的项目级那一行仍要有')
  assert.equal(
    selfSwitches[0].title,
    '切到项目级',
    '★ 有动作的必须是**别的**作用域（项目级），不是用户自己所在的用户级',
  )
  assert.ok(
    selfJoined.includes('切到用户级（全局）') === false,
    '回显就是用户级时，摘要里不许再让用户"切到用户级（全局）"（自己指自己）',
  )
  assert.ok(
    selfJoined.includes('项目级还有 1 个 hook') === true,
    '但项目级那一行仍然要引导（动作只对**别的**作用域出现，不是整块删掉）',
  )
})

//#region D29–D35. v3「面向用户」收口：工具条一行 / 中文事件名 / 去横幅 / 去冗余 / 静态纪律
//   每条都先红后绿：注入违规 → 确认**精确**报错 → 还原（见提交信息里的反向验证表）。

await test('D29：工具条**只有一行** + 第二行一句人话 + 搜索框只在 fileTotal >= 5 时渲染（两个分支）', async () => {
  // ① 1 条 hook：搜索框**不渲染**（用户原话"1 条 hook 时它是纯噪音"），条数落在第二行那句人话里。
  const one = createFakeReact()
  const oneNodes = await renderSection(componentFromArtifact(one.React), one, {
    ok: true,
    data: minimalSnapshot(),
  })
  const oneJoined = joinedText(oneNodes)
  assert.equal(allByClass(oneNodes, 'dsh-hooks__toolbar').length, 1, '★ 工具条只有一行（v3 收口）')
  assert.equal(allByClass(oneNodes, 'dsh-hooks__metaline').length, 1, '第二行是"一句人话"（metaline）')
  assert.ok(oneJoined.includes('1 个 hook'), '第二行要说人话：N 个 hook')
  assert.equal(allByClass(oneNodes, 'dsh-hooks__search').length, 0, '★ 1 条 hook 时不渲染搜索框')
  assert.ok(!oneJoined.includes('钩子 1'), '`钩子 N` chip 删了')
  assert.ok(!oneJoined.includes('已安装'), '`已安装 N` 也删了')
  // 作用域 = 用户级 ≠ 当前会话项目 ⇒ 「本会话生效 X 个」**必须**出现（这时它说的是另一件事）
  assert.ok(oneJoined.includes('本会话生效 1 个'), '作用域 ≠ 当前会话项目时要显示本会话口径')
  // `（用户级 a + 项目级 b）` 从主视图删掉、移进诊断区（同一条信息不再说五遍）
  assert.ok(!oneJoined.includes('（用户级 0 + 项目级 1）'), '主视图不再重复"用户级 a + 项目级 b"')
  const oneDiag = await expandFold(oneNodes, componentFromArtifact(one.React), one, '更多')
  assert.ok(
    joinedText(oneDiag).includes('（用户级 0 + 项目级 1）') || joinedText(oneDiag).includes('用户级 0 + 项目级 1'),
    '★ 但它必须在诊断折叠里可达（不是删掉事实）',
  )

  // ② 5 条 hook：搜索框**必须**渲染（阈值是 `fileTotal >= 5`，不是一个恒真/恒假的条件）
  const five = snapshotFile('user', 'ok', {
    PreToolUse: [
      {
        rawIndex: 0,
        matcher: null,
        hooks: [
          snapshotHook(0, 'echo 1'),
          snapshotHook(1, 'echo 2'),
          snapshotHook(2, 'echo 3'),
          snapshotHook(3, 'echo 4'),
          snapshotHook(4, 'echo 5'),
        ],
      },
    ],
  })
  const many = createFakeReact()
  const manyNodes = await renderSection(componentFromArtifact(many.React), many, {
    ok: true,
    data: minimalSnapshot({ userFile: five }),
  })
  assert.equal(allByClass(manyNodes, 'dsh-hooks__search').length, 1, '★ 5 条 hook 时搜索框必须出现')
  assert.ok(joinedText(manyNodes).includes('5 个 hook'), '条数跟着文件走')

  // ③ ★ 不能变成"清不掉的筛选"：文件从 5 条掉到 4 条（删掉一条之后重新取数）时，只要筛选词还在，
  //    搜索框就必须还在 —— 否则用户看到"没有匹配的 hook"却没有任何控件能清掉筛选，只能刷新整页。
  const four = snapshotFile('user', 'ok', {
    PreToolUse: [
      {
        rawIndex: 0,
        matcher: null,
        hooks: [snapshotHook(0, 'echo keep'), snapshotHook(1, 'echo 2'), snapshotHook(2, 'echo 3')],
      },
    ],
  })
  firstByClass(manyNodes, 'dsh-hooks__search').onChange({ target: { value: 'echo 1' } })
  const typed = await advance(componentFromArtifact(many.React), many)
  assert.equal(allByClass(typed, 'dsh-hooks__search').length, 1, '筛选词非空时搜索框在')
  assert.ok(joinedText(typed).includes('匹配 1 / 共 5'), '先证明筛选真的生效了')
  globalThis.fetch = async () => ({ json: async () => ({ ok: true, data: minimalSnapshot({ userFile: four }) }) })
  toolButton(typed, '刷新').onClick()
  await advance(componentFromArtifact(many.React), many)
  const afterShrink = await advance(componentFromArtifact(many.React), many)
  assert.ok(joinedText(afterShrink).includes('4 个 hook') === false, '前提：文件确实已经掉到 4 条（筛选词还在）')
  assert.equal(
    allByClass(afterShrink, 'dsh-hooks__search').length,
    1,
    '★ 筛选词还在时搜索框必须还在（否则筛选变成一个清不掉的死胡同）',
  )
})

await test('D30：非当前工作区 ⇒ 一行信息 + 「切回当前会话项目」动作（点了真的换作用域）', async () => {
  // 自洽的 fixture（D17 那个 fixture 的 session 项目根与 scope 项目根相同，动作按规则不该出现）：
  // 屏幕上是 w-1（agent-go，D:/p），而**当前会话**的项目根是 D:/q（在清单里就是 w-2）。
  const workspaces = [
    { id: 'w-1', title: 'agent-go', path: 'D:/p', projectRoot: 'D:/p', isCurrent: false },
    { id: 'w-2', title: 'dsh-hooks', path: 'D:/q', projectRoot: 'D:/q', isCurrent: true },
  ]
  const projectFile = snapshotFile('project', 'ok', {
    PreToolUse: [{ rawIndex: 0, matcher: null, hooks: [snapshotHook(0, 'echo a')] }],
  })
  const userFile = snapshotFile('user', 'ok', {
    PreToolUse: [{ rawIndex: 0, matcher: null, hooks: [snapshotHook(0, 'echo u')] }],
  })
  const snapshotFor = (scopeValue) =>
    snapshotOf({
      scope: scopeValue,
      workspaces,
      projectRoot: 'D:/q',
      isCurrentSession: scopeValue === 'w-2',
      projectFile,
      userFile,
    })

  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const urls = []
  const first = await renderSection(component, harness, (url) => {
    urls.push(String(url))
    return { ok: true, data: snapshotFor(String(url).includes('scope=workspace') ? 'w-1' : 'user') }
  })
  const nodes = await pickScopeOption(first, component, harness, 'w-1')
  assert.equal(allByClass(nodes, 'dsh-hooks__alert').length, 1, '前提：这一屏确实有那条提示')
  const body = textOfClass(nodes, 'dsh-hooks__alerttext')
  assert.ok(body.includes('本会话不读这份配置'), `一句话说清它不是本会话在读的：${body}`)
  assert.ok(body.includes('只影响以后在 agent-go 里打开的会话'), '并且说清改动作用到哪里')
  // ★ 整页可见文本（不只是提醒行）都不许出现内部话术与盘符路径：主列表非空（1 条 hook），
  //   所以这里不存在"空状态块要显示路径"那个例外。
  const joined = joinedText(nodes)
  assert.ok(!joined.includes('项目根'), '★ 首屏可见文本不许出现"项目根"')
  assert.ok(!joined.includes('sandbox 属预期'), '★ 不许出现"报 sandbox 属预期"')
  assert.ok(!joined.includes('D:/'), '★ 首屏可见文本不许出现盘符路径')

  // ★ 动作：目标（w-2）≠ 当前作用域（w-1）⇒ 必须给一条回去的路，而且点了真的重新取数
  const back = buttonByLabel(nodes, '切回当前会话项目')
  const before = urls.length
  back.onClick()
  await advance(component, harness)
  assert.ok(urls.length > before, '点了必须真的重新取数')
  assert.ok(
    urls[urls.length - 1].includes('scope=workspace') && urls[urls.length - 1].includes('workspaceId=w-2'),
    `「切回当前会话项目」必须落到当前会话的那个工作区：${urls[urls.length - 1]}`,
  )
})

await test('D31：另一个来源**只在有东西时出现**（0 条不占行 / 有内容给动作 / 读不出来如实说）', async () => {
  const projectFile = snapshotFile('project', 'ok', {
    PreToolUse: [{ rawIndex: 0, matcher: null, hooks: [snapshotHook(0, 'echo p')] }],
  })
  const render = async (userFile) => {
    const harness = createFakeReact()
    const nodes = await renderSection(componentFromArtifact(harness.React), harness, {
      ok: true,
      data: snapshotOf({ scope: 'w-1', projectFile, userFile }),
    })
    return nodes
  }

  // ① 另一份**正常且 0 条** ⇒ 整行不渲染：不占一行、不暴露盘符路径、"用户级（全局）"这四个字都不出现
  const zeroNodes = await render(await snapshotFile('user', 'ok').valueOf())
  const zeroJoined = joinedText(zeroNodes)
  assert.ok(!zeroJoined.includes('用户级（全局）'), '★ 另一来源 0 条且正常时，整行不许出现')
  assert.ok(!zeroJoined.includes('C:\\') && !zeroJoined.includes('D:\\'), '★ 首屏也不许出现盘符路径')
  assert.equal(allByClass(zeroNodes, 'dsh-hooks__other').length, 0, '那一行的容器同样不许出现')
  // 但它的路径/状态必须仍然可达（诊断折叠里）——"不占首屏"不等于"看不见"
  const zeroHarness = createFakeReact()
  const zeroDiagNodes = await renderSection(componentFromArtifact(zeroHarness.React), zeroHarness, {
    ok: true,
    data: snapshotOf({ scope: 'w-1', projectFile, userFile: snapshotFile('user', 'ok') }),
  })
  const zeroDiag = await expandFold(zeroDiagNodes, componentFromArtifact(zeroHarness.React), zeroHarness, '更多')
  assert.ok(joinedText(zeroDiag).includes('C:/u/.dsh/hooks.json'), '★ 路径仍在诊断里（不许把事实删掉）')

  // ② 另一份有 2 条 ⇒ 一行摘要 + ghost 动作（target ≠ 当前作用域）
  const twoFile = snapshotFile('user', 'ok', {
    UserPromptSubmit: [{ rawIndex: 0, matcher: null, hooks: [snapshotHook(0, 'echo u1'), snapshotHook(1, 'echo u2')] }],
  })
  const twoNodes = await render(twoFile)
  const twoJoined = joinedText(twoNodes)
  assert.ok(twoJoined.includes('用户级（全局）还有 2 个 hook'), '★ 有内容时说清"还有几个"')
  assert.equal(allByClass(twoNodes, 'dsh-hooks__other').length, 1, '有内容时那一行确实渲染')
  const twoSwitches = twoNodes.filter((node) => node.title === '切到用户级（全局）')
  assert.equal(twoSwitches.length, 1, '并且给一个 ghost「切过去」')
  assert.ok(!twoJoined.includes('C:/u/.dsh/hooks.json'), '★ 那一行的正文里没有盘符路径（路径在诊断里）')

  // ③ 另一份**读不出来** ⇒ 如实说"读不出来（详情见「更多」）"，**绝不**说成"0 条"或"没有"
  const brokenNodes = await render(snapshotFile('user', 'error'))
  const brokenJoined = joinedText(brokenNodes)
  assert.ok(
    brokenJoined.includes('用户级（全局）这份配置读不出来（详情见「更多」）'),
    '★ 读不出来如实说，并指向「更多」',
  )
  assert.ok(!brokenJoined.includes('还有 0 个 hook'), '★ 绝不把"读不到"说成"0 条"（§2.9）')
  assert.ok(!brokenJoined.includes('C:/u/.dsh/hooks.json'), '★ 那一行的正文里没有盘符路径')
})

await test('D32：7 个事件的中文名真的渲染出来，英文枚举仍然查得到，且中文名确实进了产物', async () => {
  // 名字的出处见 `src/client/labels.ts` 的文件头（官方中文 README 的「运行时机」一列）。
  // ⚠️ 这里**写死** 7 个中文名（不从 labels.ts import）：如果两边都从同一份数据推，
  //    改坏一个名字两边一起变 —— 那就是平凡断言（AGENTS §4.3 陷阱⑤）。
  const EXPECTED = ['会话开始', '提示词提交', '工具运行前', '工具运行后', '停止', '子代理启动', '子代理结束']

  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const collapsed = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })
  // 卡片标题 = 中文名主 + 英文枚举次要（两个都是**独立文本节点**，所以都能精确查到）
  const cardTexts = collapsed.filter((node) => node.text !== undefined).map((node) => node.text)
  assert.ok(cardTexts.includes('工具运行前'), '卡片标题里是中文名（主文案不该是英文枚举）')
  assert.ok(cardTexts.includes('PreToolUse'), '★ 英文枚举仍然在 DOM 里（title 与次要 mono 都给人原文）')

  // 折叠展开后 7 个事件行：7 个中文名都在可见文本里，英文枚举也都在
  const opened = await expandFold(collapsed, component, harness, '更多')
  const openedTexts = opened.filter((node) => node.text !== undefined).map((node) => node.text)
  for (const [index, event] of HOOK_EVENTS.entries()) {
    assert.ok(openedTexts.includes(EXPECTED[index]), `★ ${event} 必须渲染出中文名「${EXPECTED[index]}」`)
    assert.ok(openedTexts.includes(event), `${event} 的英文枚举同样要能被查到`)
  }
  // 中文名不是"把枚举抄一遍"（否则中文化是假的）
  for (const label of EXPECTED) assert.ok(!HOOK_EVENTS.includes(label), `「${label}」必须是中文名，不是枚举`)

  // ★ §4.8「源码存在 ≠ 已交付」：labels.ts 只能靠 import 进产物，没接线就会被 esbuild 静默丢掉。
  //   这里直接在**产物** lib/client.js 里查这 7 个中文字符串（客户端半边的唯一标记）。
  const artifact = fs.readFileSync(CLIENT, 'utf8')
  for (const label of EXPECTED) {
    assert.ok(artifact.includes(label), `产物 lib/client.js 里应当有「${label}」（labels.ts 是不是没被 import？）`)
  }
})

await test('D33：卡片只留一个状态词；匹配 / 超时进 ⋯；原因与证据进 title', async () => {
  const file = snapshotFile('user', 'ok', {
    PreToolUse: [
      {
        rawIndex: 0,
        matcher: 'pwsh|bash',
        hooks: [snapshotHook(0, 'echo never-run')],
      },
      // 第二条：matcher 为空（匹配全部）+ 显式超时 10 秒
      { rawIndex: 1, matcher: null, hooks: [snapshotHook(0, 'echo ten', { timeoutSec: 10 })] },
    ],
  })
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const nodes = await renderSection(component, harness, { ok: true, data: minimalSnapshot({ userFile: file }) })
  const texts = nodes.filter((node) => node.text !== undefined).map((node) => node.text)
  const joined = texts.join('')

  // ① 正文只说"未运行"（**一个词**）：v4 起连 `匹配 X` / `N 秒` 都不在正文里了（它们进 `⋯`）
  assert.ok(texts.includes('未运行'), '★ 正文只说"未运行"')
  assert.equal(texts.filter((text) => text === '未运行').length, 2, '两条 hook 各一个状态词（不多不少）')
  assert.ok(!joined.includes('未运行（没有执行记录）'), '★ 正文里不再有那个括号说明（用户说它是字段 dump）')
  assert.ok(!joined.includes('匹配'), '★ v4：匹配范围不进正文（在 ⋯ 里，见 ②）')
  assert.ok(!joined.includes('默认 600 秒'), '★ v4：超时也不进正文（在 ⋯ 里）')
  const dot = nodes.find((node) => typeof node.className === 'string' && node.className.includes('dsh-hooks__dot'))
  assert.ok(dot.title.includes('未运行') && dot.title.includes('没有执行记录'), '★ 原因仍在 title 里（不丢证据）')

  // ② `匹配 X` / `匹配全部` / `N 秒` 全部在 `⋯` 里，而且仍然是"说人话"的形态
  const menu0 = await openCardMenu(nodes, component, harness, 0)
  const menu0Texts = menu0.filter((node) => node.text !== undefined).map((node) => node.text)
  assert.ok(menu0Texts.includes('匹配 pwsh|bash'), '★ ⋯ 里说人话：匹配 X')
  assert.ok(menu0Texts.includes('默认 600 秒'), '★ 未写超时时说"默认 600 秒"')
  assert.ok(!joinedText(menu0).includes('matcher:'), '★ 不许出现 `matcher:` 这种接口字段名')
  assert.ok(!joinedText(menu0).includes('10s') && !joinedText(menu0).includes('600s'), '★ 不许出现裸的 `10s` / `600s`')

  const menu1 = await openCardMenu(menu0, component, harness, 1)
  const menu1Texts = menu1.filter((node) => node.text !== undefined).map((node) => node.text)
  assert.ok(menu1Texts.includes('匹配全部'), '★ matcher 为空时说"匹配全部"（过去这一格直接不渲染）')
  assert.ok(menu1Texts.includes('10 秒'), '★ 显式超时说"10 秒"')
})

await test('D34：折叠里的空事件行是「＋」字形按钮（可 Tab、有名字），有内容行仍是「N 个」', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const collapsed = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })
  const opened = await expandFold(collapsed, component, harness, '更多')
  const texts = opened.filter((node) => node.text !== undefined).map((node) => node.text)

  const glyphs = allByClass(opened, 'dsh-hooks__glyphbtn')
  assert.equal(glyphs.length, HOOK_EVENTS.length, '★ 7 个事件行各一个字形按钮')
  assert.equal(texts.filter((text) => text === '＋新建').length, 0, '★ 过去那七个「＋新建」文字按钮没了')
  assert.equal(texts.filter((text) => text === '＋').length, HOOK_EVENTS.length, '按钮上只有「＋」字形')
  for (const node of glyphs) {
    assert.equal(node.tag, 'button', '`＋` 必须是真的按钮（Tab 可达、可点）')
    assert.equal(node.disabled, false, '不忙的时候不许是禁用的（否则 Tab 到了也按不动）')
    assert.ok(
      typeof node.title === 'string' && node.title.startsWith('在 ') && node.title.endsWith(' 下新建'),
      `title 要说清在哪个事件下新建：${String(node.title)}`,
    )
    assert.ok(
      typeof node.ariaLabel === 'string' && node.ariaLabel.includes('下新建'),
      `aria-label 是"只有字形"的按钮唯一的无障碍名字：${String(node.ariaLabel)}`,
    )
  }
  assert.ok(
    glyphs.some((node) => node.title === '在 SessionStart 下新建'),
    '空事件行也有新建入口（"空"不是死路）',
  )
  // 有内容的那一行保持 `N 个`。按**行**取文本：整页拼起来查会被第二行的 `1 个 hook` 蒙混过去；
  // 而直接取"第一个 `__count`"也不行 —— 「生效配置」那一节在更上面（13 票起有三节）。
  const rowTextOf = (row) => {
    const at = opened.indexOf(row)
    const parts = []
    for (let i = at + 1; i < opened.length; i++) {
      const node = opened[i]
      if (typeof node.className === 'string' && node.className.split(' ').includes('dsh-hooks__eventrow')) break
      if (node.text !== undefined) parts.push(node.text)
    }
    return parts.join('')
  }
  const preRow = allByClass(opened, 'dsh-hooks__eventrow').find((row) => rowTextOf(row).includes('PreToolUse'))
  assert.ok(preRow !== undefined, '应当有一行是 PreToolUse')
  assert.ok(rowTextOf(preRow).includes('1 个'), `有内容的事件行说"1 个"：${rowTextOf(preRow)}`)

  // 它仍然真的工作：点 SessionStart 那一行的 `＋` ⇒ 表单出现且事件预选为 SessionStart
  const sessionStartButton = glyphs.find((node) => node.title === '在 SessionStart 下新建')
  sessionStartButton.onClick()
  const withForm = await advance(component, harness)
  assert.equal(allByClass(withForm, 'dsh-hooks__newform').length, 1, '★ 点 `＋` 必须真的打开新建表单')
  assert.equal(firstByClass(withForm, 'dsh-hooks__newselect').value, 'SessionStart', '并且预选了那个事件')
})

await test('D35：样式与源码的静态纪律（hex 只作 var() fallback / 无 inline 样式 / 提示行没有黄底）', () => {
  /** 取一条规则的规则体（样式是字符串，没有 DOM 可量 —— 对它做**字面**断言）。 */
  const ruleOf = ruleBodyOf
  // ① 颜色只用 token：把所有 `var(...)`（含嵌套 fallback）挖掉之后，样式串里**不许剩下十六进制**
  //    —— 十六进制只允许作 `var()` 的 fallback（§3.1：深色主题下硬编码就是白底白字）。
  //    ⚠️ 先剥掉 CSS 注释：注释里要留"真机解析成什么值"的证据（#2c2c2e / #565658 …），
  //    那些不是颜色声明 —— 不剥的话这条断言会逼着人不写证据。
  const styleCode = styles.replace(/\/\*[\s\S]*?\*\//g, '')
  let stripped = styleCode
  for (let round = 0; round < 8; round++) {
    const next = stripped.replace(/var\([^()]*\)/g, 'VAR')
    if (next === stripped) break
    stripped = next
  }
  const strayHex = stripped.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
  assert.deepEqual(strayHex, [], `★ 这些十六进制不在 var() 的 fallback 里（硬编码颜色）：${strayHex.join(', ')}`)

  // ⓪ 样式串里**不许出现反引号**：它会把 styles.ts 的模板字符串提前结束 —— 报错点在离现场很远
  //    的地方（esbuild 报 CSS 语法错 / node 报 TS 语法错），本仓库已经踩过两次。
  assert.ok(!styles.includes('`'), '★ 注入的 CSS 里出现了反引号：它会把模板字符串提前结束（注释里也不行，用「」代替）')

  // ② 不写 inline 样式（§3.2）：源码里不许出现 `style=` / `style={{`
  const clientDir = path.join(HERE, '..', 'src', 'client')
  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else if (/\.tsx?$/.test(entry.name)) out.push(full)
    }
    return out
  }
  const clientFiles = walk(clientDir)
  assert.ok(clientFiles.length >= 5, `应当扫到客户端源码（否则这条断言是空的）：${clientFiles.length}`)
  // ⚠️ `styles.ts` **本身就是样式表**：CSS 里天然有 `border-style:` 这种属性名，它不是"组件"。
  // 把它纳入扫描会让这条断言在**正确**的代码上变红（06 票加虚线边框时就是这么被假阳性抓到的）。
  // 防护意图不变：任何**组件**文件里出现 `style=` / `style:` 一律红。
  const componentFiles = clientFiles.filter((file) => path.basename(file) !== 'styles.ts')
  assert.ok(componentFiles.length >= 4, `应当扫到组件源码（否则这条断言是空的）：${componentFiles.length}`)
  const inline = componentFiles.filter((file) => /style\s*[=:]/.test(fs.readFileSync(file, 'utf8')))
  assert.deepEqual(
    inline.map((file) => path.basename(file)),
    [],
    '★ 组件里不许写 inline 样式（视觉与尺寸一律进 styles.ts）',
  )

  // ③ 提示行**不许用警告色**：黄底（state-warning-background）在这一轮被删掉了（R2 的机器护栏）。
  //   ⚠️ 只能对**提示行自己的规则**断言：状态点里的 `state-warn-primary` 是 §3.8 允许的状态色
  //   （"失败"必须能黄），全局禁用会误伤它 —— 那才是"为了让断言通过而收紧断言"。
  const alertRules = [...styleCode.matchAll(/([^{}]*?__alert[^{}]*?)\{([^{}]*)\}/g)]
  assert.ok(alertRules.length >= 3, `提示行的规则至少三条（基类 + error + info），实际 ${alertRules.length}`)
  for (const [, selector, body] of alertRules) {
    assert.ok(
      !body.includes('state-warn'),
      `★ 提示行不许用警告色（黄底横幅的来源）：${selector.trim()} { ${body.trim()} }`,
    )
  }
  const base = ruleOf('.dsh-hooks__alert {')
  assert.ok(!base.includes('background'), '★ `__alert` 基类不许有底色')
  // ★ v3：`--info` 是**中性信息行**（无底色、次要色文字 + ghost 动作）——
  //   非当前工作区那条提醒不该再有任何"横幅感"。有底色就红。
  const info = ruleOf('.dsh-hooks__alert--info {')
  assert.ok(!info.includes('background'), `★ -info 必须是中性信息行（不许有底色）：${info}`)
  assert.ok(info.includes('label-secondary'), '`--info` 的文字用次要色')
  // 真错误才上底色，而且用官方 `Tag[data-tone=danger]` 的 color-mix 配方（官方无 background 变体）
  const errorRule = ruleOf('.dsh-hooks__alert--error {')
  assert.ok(
    errorRule.includes('color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)'),
    `★ 错误底色照官方配方写：${errorRule}`,
  )
  // ④ P1 视觉：分区块之间只有 12 这一档；第二行有它自己的类（不是"又一个工具条"）
  assert.ok(ruleOf('.dsh-hooks {').includes('gap:12px'), '分区块之间 12px（P1：只用 12/16 两档）')
  assert.ok(styles.includes('.dsh-hooks__metaline {'), '第二行是 metaline（不是第二个 toolbar）')
  assert.ok(ruleOf('.dsh-hooks__glyphbtn {').includes('width:24px'), '字形按钮 24×24（和 28px 控件同一套尺度）')
})

await test('D36：卡片走官方配方（stroke + fill + radius-xl）、折叠区只画分隔线、死 token 一个都不许用', () => {
  const ruleOf = ruleBodyOf

  // ① **卡**：三个卡类容器都必须同时有官方描边 + 填充 + 官方圆角。
  //    证据（`hooks-fidelity` 在真机截图上逐像素量的）：settings-card-fill = bg-layer-2 = 面板底
  //    = `#2c2c2e`（ΔRGB 0，等于隐形）；settings-card-stroke = border-l4 = `#fff3` 叠上去 = `#565658`
  //    （ΔRGB 126，可见性全在这里）。上一轮把描边删掉 ⇒ 真机上"什么都没有"。
  for (const selector of ['.dsh-hooks__hookcard {', '.dsh-hooks__empty {', '.dsh-hooks__newform {']) {
    const body = ruleOf(selector)
    assert.ok(
      body.includes('var(--dsw-alias-settings-card-stroke'),
      `★ ${selector} 必须有卡描边（真机的可见性全在它上面，ΔRGB 126）`,
    )
    assert.ok(
      body.includes('var(--dsw-alias-settings-card-fill'),
      `${selector} 保留官方 fill（真机与面板同色，只作兜底）`,
    )
    assert.ok(
      /border-radius:\s*var\(--dsw-radius-xl/.test(body),
      `★ ${selector} 用官方的 20px 圆角（--dsw-radius-xl，官方卡片原文）`,
    )
    assert.ok(!body.includes('border:0'), `★ ${selector} 不许再把描边删掉（上一轮就是这么把卡画没的）`)
  }

  // ② **折叠区 / 诊断区**走官方"只画分隔线"那套（settings-general 的 .row），不许混卡片语言
  const foldBody = ruleOf('.dsh-hooks__foldbody {')
  assert.ok(!foldBody.includes('background'), '折叠容器不画底色（分隔线式条目没有卡面）')
  assert.ok(!foldBody.includes('border-radius'), '折叠容器不加圆角（官方分隔线式条目无圆角）')
  for (const selector of ['.dsh-hooks__eventrow {', '.dsh-hooks__diagrow {']) {
    assert.ok(
      ruleOf(selector).includes('border-bottom:.5px solid var(--dsw-alias-border-l2'),
      `★ ${selector} 用官方分隔线（border-l2，真机 ΔRGB 77）`,
    )
  }

  // ③ 死 token 否定断言：**声明里**一个都不许出现。
  //    证据：`@deepseek-ai/dsh-client-ui-theme/lib/client.js` 的 base_css_default 里这 5 个名字
  //    **0 处定义** ⇒ 真机永远走 fallback（黄横幅实测底色 `#453d27` 就是 fallback 在起作用）。
  //    ⚠️ 先剥掉注释：注释里**必须**能写下这些名字当证据（"为什么不许再用"这件事本身要留档）。
  const sourcePath = path.join(HERE, '..', 'src', 'client', 'styles.ts')
  const source = fs.readFileSync(sourcePath, 'utf8')
  const declarationText = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const DEAD_TOKENS = [
    '--dsw-alias-state-warning-background',
    '--dsw-alias-state-warning-primary',
    '--dsw-alias-state-error-background',
    '--dsw-alias-state-ok-',
    '--dsw-alias-interactive-bg-pressed',
  ]
  for (const dead of DEAD_TOKENS) {
    assert.ok(
      !declarationText.includes(dead),
      `★ ${dead} 在官方 token 表里 0 定义（真机永远走 fallback）—— 官方真名见 styles.ts 文件头`,
    )
  }

  // ④ 正面：状态族用的是官方拼写（warn 不是 warning、success 不是 ok）
  assert.ok(
    ruleOf('.dsh-hooks__dot--warn {').includes('var(--dsw-alias-state-warn-primary'),
    '警告族官方叫 state-warn-primary',
  )
  assert.ok(
    ruleOf('.dsh-hooks__dot--ok {').includes('var(--dsw-alias-state-success-primary'),
    '成功族官方叫 state-success-primary',
  )
  assert.ok(
    ruleOf('.dsh-hooks__dot--deny {').includes('var(--dsw-alias-state-error-primary'),
    '错误族官方叫 state-error-primary',
  )
  assert.ok(
    ruleOf('.dsh-hooks__newerror {').includes(
      'color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)',
    ),
    '表单错误行与页面级错误用同一套官方 danger 配方',
  )
  // ⑤ 开关照官方 Switch.module.css：关态轨道 border-l3 + 旋钮 switch-thumb（#adb2b8，比旧版近黑
  //    旋钮在 #353638 轨道上可分辨得多）；开态轨道 button-primary-fill（近白药丸）+ 近黑旋钮。
  assert.ok(ruleOf('.dsh-hooks__switch {').includes('var(--dsw-alias-border-l3'), '开关关态轨道用官方 border-l3')
  assert.ok(ruleOf('.dsh-hooks__knob {').includes('var(--dsw-alias-switch-thumb'), '关态旋钮用官方 switch-thumb')
  assert.ok(
    ruleOf('.dsh-hooks__switch--on .dsh-hooks__knob {').includes('var(--dsw-alias-label-primary-foreground'),
    '开态旋钮用 label-primary-foreground（配近白药丸）',
  )

  // ⑥ 白名单：样式里用到的每一个 token 都必须是**在官方 theme 表里核对过**的那一批。
  //    没有这一条的话，"再写一个看着很合理的死 token"永远没人发现（真机只会走 fallback）。
  const VERIFIED_TOKENS = new Set([
    // 官方 alias 层（判据：base_css_default 里有 `--名字:` 定义）
    '--dsw-alias-label-primary',
    '--dsw-alias-label-primary-foreground',
    '--dsw-alias-label-secondary',
    '--dsw-alias-label-tertiary',
    '--dsw-alias-border-l2',
    '--dsw-alias-border-l3',
    '--dsw-alias-border-l4',
    '--dsw-alias-interactive-bg-hover',
    '--dsw-alias-interactive-bg-active',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-bg-layer-2',
    '--dsw-alias-bg-layer-3',
    '--dsw-alias-bg-module-platform',
    '--dsw-alias-settings-card-fill',
    '--dsw-alias-settings-card-stroke',
    // 开关旋钮：官方 Switch.module.css 原文（`[aria-checked='false'] .thumb`），深色 = #adb2b8
    '--dsw-alias-switch-thumb',
    '--dsw-alias-button-primary-fill',
    '--dsw-alias-button-primary-hover',
    '--dsw-alias-brand-primary',
    '--dsw-alias-state-success-primary',
    '--dsw-alias-state-error-primary',
    '--dsw-alias-state-warn-primary',
    // 非 alias 层（同名 token 也在官方 theme 里有定义）
    '--dsw-radius-xl',
    '--dsw-shadow-lv3',
  ])
  const used = [...new Set([...styles.matchAll(/--dsw-[a-z0-9-]+/g)].map((match) => match[0]))].sort()
  assert.ok(used.length >= 15, `样式里应当用了一批 token（否则这条断言是空的）：${used.length}`)
  const unverified = used.filter((token) => !VERIFIED_TOKENS.has(token))
  assert.deepEqual(
    unverified,
    [],
    `★ 这些 token 没在官方 theme 表里核对过（先核对再写，核对方法见 styles.ts 文件头）：${unverified.join(', ')}`,
  )
})

//#endregion

//#region D37–D40. 打回轮的 3 条修复 + 1 条口径（F1 表单字段布局 / F2 中文标签 / F5 toggle 文案 / F3 路径边界）

/** 字段容器里允许出现的**控件**标签。 */
const CONTROL_TAGS = new Set(['select', 'input', 'textarea'])

/** 打开新建表单（工具条那个 toggle 按钮）。 */
async function openNewForm(nodes, component, harness) {
  toolButton(nodes, '新建').onClick()
  return advance(component, harness)
}

await test('D37：新建表单**每个字段是一个容器**（label 与它的控件同进同出，不会被换行拆散）', async () => {
  // 布局缺陷的原形（审查者放大图抓到的）：5 个兄弟节点平铺在同一个 `flex-wrap:wrap` 行里，
  // 564px 下 `匹配` 的 label 与它的输入框被分到两行。修法是"每个字段自己一个容器 + 容器内部
  // nowrap"，所以断言必须落在**结构**上（扁平列表看不出父子关系，见 flatten 的 parentClass）。
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const first = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })
  const form = await openNewForm(first, component, harness)
  assert.equal(allByClass(form, 'dsh-hooks__newform').length, 1, '前提：表单确实打开了')

  const isLabel = (node) => typeof node.className === 'string' && node.className.includes('dsh-hooks__newlabel')
  const isField = (node) => typeof node.className === 'string' && node.className.includes('dsh-hooks__newfield')
  const labels = form.filter(isLabel)
  // 5 个字段：事件 / 加到（该事件已有分组时才出现）/ 匹配 / 命令 / 超时。
  assert.equal(
    labels.length,
    5,
    `这份 fixture 的事件已经有一组，所以表单是五个字段：事件 / 加到 / 匹配 / 命令 / 超时（实际 ${labels.length}）`,
  )

  // ① 每个字段一个**独立**容器：label 的父容器必须是 __newfield，而且五个标签分属五个容器
  const containers = [...new Set(labels.map((node) => node.parentClass))]
  assert.equal(
    containers.length,
    5,
    `★ 五个标签必须分属五个容器（过去它们全在一个容器里 ⇒ 换行时 label 与控件被拆散）：${containers.join(' | ')}`,
  )
  for (const container of containers) {
    assert.ok(
      container.includes('dsh-hooks__newfield'),
      `★ 字段容器必须是 __newfield（label 直接挂在会换行的行容器上就是 F1 的原形）：${container}`,
    )
    const inner = form.filter((node) => node.parentClass === container)
    assert.equal(inner.filter(isLabel).length, 1, `${container} 里恰好一个 label（多了就是两个字段挤在一个容器里）`)
    assert.equal(
      inner.filter((node) => CONTROL_TAGS.has(node.tag)).length,
      1,
      `★ ${container} 里恰好一个控件（label 与控件必须同容器，否则会被换行拆到两行）`,
    )
  }

  // ② `匹配` 的 label 与它的 input 在**同一个**容器里 —— 直接守住 F1 复发
  const matcherContainer = containers.find((className) => className.includes('--matcher'))
  assert.ok(matcherContainer !== undefined, '`匹配` 字段要有自己的容器类（--matcher）')
  // ⚠️ 不能用 `textOfClass`：label 的文字在它**自己的 span 里**（textOfClass 只收"直接文本子节点"，
  //    遇到带类名的元素就停）—— 这里按文档顺序取 label 的下一个文本节点。
  const matcherLabelAt = form.findIndex((node) => isLabel(node) && node.parentClass === matcherContainer)
  assert.ok(matcherLabelAt >= 0, '`匹配` 容器里应当有一个 label')
  assert.equal(form[matcherLabelAt + 1].text, '匹配', '那个容器里的 label 就是「匹配」')
  const matcherInputs = form.filter((node) => node.parentClass === matcherContainer && node.tag === 'input')
  assert.equal(matcherInputs.length, 1, '★ `匹配` 的输入框就在这个容器里（和它的 label 同容器）')
  assert.equal(matcherInputs[0].placeholder, '留空 = 匹配全部', 'placeholder 保留')

  // ③ 不存在"label 是容器的最后一个子节点"这种结构（那正是会被拆散的那种）
  for (const label of labels) {
    const after = form.slice(form.indexOf(label) + 1).filter((node) => node.parentClass === label.parentClass)
    assert.ok(
      after.some((node) => CONTROL_TAGS.has(node.tag)),
      `★ ${label.parentClass} 里 label 之后必须有它的控件（label 是最后一个子节点 = 会被换行拆散）`,
    )
  }

  // ④ 短字段外面**只允许一层**会换行的容器（__newrow）；字段容器自己不许再 wrap
  const row = form.find((node) => typeof node.className === 'string' && node.className.includes('dsh-hooks__newrow'))
  assert.ok(row !== undefined, '短字段外面有一层 __newrow（只在这一层换行）')
  assert.equal(
    form.filter((node) => node.parentClass === row.className && isField(node)).length,
    3,
    '事件 + 加到 + 匹配三个字段在同一个行容器里（宽度够时同行，不够时**整块**换行）',
  )
  const fieldRule = ruleBodyOf('.dsh-hooks__newfield {')
  assert.ok(fieldRule.includes('flex-wrap:nowrap'), `★ 字段容器内部不许换行：${fieldRule}`)
  const rowRule = ruleBodyOf('.dsh-hooks__newrow {')
  assert.ok(rowRule.includes('flex-wrap:wrap'), '换行只发生在行容器这一层')
})

await test('D38：表单里没有裸英文标签 matcher（中文「匹配」），可见文本也不含这个词', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const first = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })
  const form = await openNewForm(first, component, harness)
  const joined = joinedText(form)
  assert.ok(joined.includes('匹配'), '标签是中文「匹配」（与卡片里的「匹配 pwsh|bash」同一套用词）')
  assert.ok(!joined.includes('matcher'), `★ 表单可见文本不许出现裸英文 matcher：${joined.slice(0, 160)}`)
  assert.ok(!joined.includes('matcher'), '（同一条断言在整页范围也成立：卡片那边说的是「匹配 pwsh」）')

  // matcherless 事件（UserPromptSubmit / Stop）的提示句同样不许把接口字段名丢给用户
  firstByClass(form, 'dsh-hooks__newselect').onChange({ target: { value: 'Stop' } })
  const stopForm = await advance(component, harness)
  const stopJoined = joinedText(stopForm)
  assert.ok(stopJoined.includes('这个事件不看匹配范围'), 'matcherless 事件给的是中文提示')
  assert.ok(
    !stopJoined.includes('matcher'),
    `★ 换到 matcherless 事件后同样不许出现 matcher：${stopJoined.slice(0, 160)}`,
  )
  assert.equal(allByClass(stopForm, 'dsh-hooks__input').length, 1, 'matcherless 事件下只剩超时一个输入框')
})

await test('D39：表单开着时工具条那个按钮写「收起」（带 aria-expanded），点了真的收起', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const closed = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })
  const expandButton = toolButton(closed, '新建')
  assert.equal(expandButton.ariaExpanded, false, '收起状态 aria-expanded=false')
  assert.ok(joinedText(closed).includes('＋ 新建'), '收起时按钮写「＋ 新建」')
  assert.equal(allByClass(closed, 'dsh-hooks__newform').length, 0, '前提：表单还没打开')

  const opened = await openNewForm(closed, component, harness)
  assert.equal(allByClass(opened, 'dsh-hooks__newform').length, 1, '点开后表单在')
  const collapse = toolButton(opened, '收起')
  assert.equal(collapse.ariaExpanded, true, '打开状态 aria-expanded=true')
  assert.ok(joinedText(opened).includes('收起'), '打开时按钮文案是「收起」')
  assert.ok(!joinedText(opened).includes('＋ 新建'), '★ 打开时不许还写「＋ 新建」—— 那时点它是收起，文案必须与动作一致')

  collapse.onClick()
  const back = await advance(component, harness)
  assert.equal(allByClass(back, 'dsh-hooks__newform').length, 0, '★ 点「收起」表单真的收起来了')
  assert.ok(joinedText(back).includes('＋ 新建'), '收起后回到「＋ 新建」')
})

await test('D40：盘符路径只允许出现在「更多」折叠里（正常态与空状态的首屏一个都不许有）', async () => {
  const DRIVE = /[A-Za-z]:[\\/]/

  // ① 正常态（有 hook、不是空状态）：首屏可见文本**零**盘符路径，也没有 .dsh-hooks__path 元素
  const normal = createFakeReact()
  const component = componentFromArtifact(normal.React)
  const nodes = await renderSection(component, normal, { ok: true, data: minimalSnapshot() })
  const visible = joinedText(nodes)
  assert.ok(!DRIVE.test(visible), `★ 正常态首屏不许出现盘符路径，实际命中：${String(visible.match(DRIVE))}`)
  assert.equal(allByClass(nodes, 'dsh-hooks__path').length, 0, '正常态不许有路径元素')
  // 反面证明这条不是平凡断言：**「更多」折叠里确实有**路径（那是唯一允许出现盘符路径的地方）
  const diag = await expandFold(nodes, component, normal, '更多')
  assert.ok(DRIVE.test(joinedText(diag)), '前提：「更多」折叠里确实有路径（否则"不许出现"是平凡断言）')

  // ② v4 收紧：**空状态块也不再上屏路径**（它只进按钮 title 与「更多」折叠）。
  //    v3 时它是"第二处例外"；现在例外只剩一处，判据更严了，不是放宽。
  const empty = createFakeReact()
  const emptyNodes = await renderSection(componentFromArtifact(empty.React), empty, {
    ok: true,
    data: snapshotOf({ scope: 'user', userFile: snapshotFile('user', 'absent') }),
  })
  const emptyVisible = joinedText(emptyNodes)
  assert.ok(
    !DRIVE.test(emptyVisible),
    `★ v4：空状态块首屏也不许出现盘符路径，实际命中：${String(emptyVisible.match(DRIVE))}`,
  )
  assert.equal(allByClass(emptyNodes, 'dsh-hooks__path').length, 0, '空状态块不再有路径元素（v4）')
  // 但路径必须**可达**：空状态块里那个「新建配置文件」按钮的 title 里就有它（不丢事实，只换渲染点）
  const createButton = buttonByLabel(emptyNodes, '新建配置文件（C:/u/.dsh/hooks.json）')
  assert.ok(DRIVE.test(String(createButton.title)), '路径在按钮 title 里仍然可达')
})

await test('D41：v4 密度 —— 首屏只有"状态点 + 一个状态词 + 命令 + 开关 + ⋯"，检测不占屏但一键可达', async () => {
  // 这条是 v4 的总闸：用户的原话是"非要使用一堆说明和检测"。所以断言分两半 ——
  //   ① 首屏**不许出现**那些字（这是"简洁"的可机器验证定义）；
  //   ② 一键之后**必须仍然可达**（这是"删渲染点 ≠ 删事实"的唯一证据）。
  const run = (exitCode, decision) => ({ at: 1, exitCode, decision, durationMs: 12, stdout: '', stderr: 'out' })
  const hooks = [
    snapshotHook(0, 'echo never-run'),
    snapshotHook(1, 'echo ok', { lastRun: run(0, 'pass') }),
    snapshotHook(2, 'echo off', { disabled: true }),
  ]
  const snapshot = snapshotOf({
    scope: 'w-1',
    projectFile: snapshotFile('project', 'ok', { PreToolUse: [{ rawIndex: 0, matcher: 'pwsh', hooks }] }),
    session: sessionEffect({ hookCount: 3, groupCount: 1, fromUser: 0, fromProject: 3 }),
  })
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })
  const visible = joinedText(nodes)

  // ① 首屏不许出现的东西（v3 里它们全都在首屏上）
  for (const forbidden of ['匹配', '秒', 'exit ', 'ms', '诊断', '项目根', 'cwd 来源', '版本']) {
    assert.ok(!visible.includes(forbidden), `★ v4 首屏不许出现「${forbidden}」：${visible}`)
  }
  // ② 每张卡只剩这几样：状态点 / （启用时）一个状态词 / 开关 / ⋯
  assert.equal(allByClass(nodes, 'dsh-hooks__hookcard').length, 3, '前提：3 条 hook = 3 张卡')
  assert.equal(allByClass(nodes, 'dsh-hooks__dot').length, 3, '每张卡一个状态点（颜色只来自台账 / disabled）')
  assert.equal(allByClass(nodes, 'dsh-hooks__status').length, 2, '★ 停用的那张不写状态词（标题行已有「已停用」标签）')
  assert.equal(allByClass(nodes, 'dsh-hooks__switch').length, 3, '每张卡一个开关')
  assert.equal(allByClass(nodes, 'dsh-hooks__morebtn').length, 3, '每张卡一个 ⋯')
  assert.equal(allByClass(nodes, 'dsh-hooks__cardmenu').length, 0, '★ ⋯ 默认收起：匹配 / 超时 / 动作一个字都不占屏')
  assert.equal(allByClass(nodes, 'dsh-hooks__btn').length, 0, '★ 首屏一个动作按钮都没有（全在 ⋯ 里）')
  assert.equal(allByClass(nodes, 'dsh-hooks__disclosure').length, 1, '★ 底部只有一个折叠开关（v3 是两个）')
  assert.ok(visible.includes('未运行') && visible.includes('通过'), '状态词还在（颜色之外必须有一个词）')

  // ③ 一键可达：点开 ⋯ → 详情真的在；再点一次 → 真的收回去
  const opened = await openCardMenu(nodes, component, harness)
  // 07 起「⋯」是**两条排**（字段排 + 动作排），所以按"展开的那一块"数（`__cardmenuwrap`），
  // 而不是按单排容器数 —— 判据仍是"只展开这一条"。
  assert.equal(allByClass(opened, 'dsh-hooks__cardmenuwrap').length, 1, '点开 ⋯ 只展开这一条')
  assert.ok(joinedText(opened).includes('匹配 pwsh'), '匹配范围在 ⋯ 里')
  assert.ok(joinedText(opened).includes('默认 600 秒'), '超时也在 ⋯ 里')
  assert.equal(allByClass(opened, 'dsh-hooks__btn').length, 4, '⋯ 里四个动作（试运行 / 编辑 / 删除 / 删除整组）')
  const menus = allByClass(opened, 'dsh-hooks__morebtn')
  assert.equal(menus[0].ariaExpanded, true, '⋯ 展开后 aria-expanded=true（按钮不许骗人）')
  menus[0].onClick()
  const shut = await advance(component, harness)
  assert.equal(allByClass(shut, 'dsh-hooks__cardmenu').length, 0, '再点一次必须真的收回去')
  assert.equal(allByClass(shut, 'dsh-hooks__morebtn')[0].ariaExpanded, false, '并且 aria-expanded 回到 false')

  // ④ 「更多」展开后，事实**一条都没丢**（v4 的承诺：不占屏 ≠ 看不见）
  const more = await expandFold(shut, component, harness, '更多')
  const moreText = joinedText(more)
  assert.ok(moreText.includes('项目根'), '项目根在「更多」里可达')
  assert.ok(moreText.includes('写入权限'), '写入权限在「更多」里可达')
  assert.equal(
    allByClass(more, 'dsh-hooks__eventrow').length,
    HOOK_EVENTS.length,
    '7 个事件同样在「更多」里（含 0 条）',
  )
})

await test('D42：新建表单的三个模板 —— 点一下填好字段，提交的就是那条命令（模板不是装饰品）', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const first = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })
  const form = await openNewForm(first, component, harness)

  const templates = allByClass(form, 'dsh-hooks__tplbtn')
  assert.equal(templates.length, 3, '★ 三个模板按钮（注入提醒 / 记到日志 / 直接拦住）')
  assert.ok(joinedText(form).includes('模板'), '有「模板」这一行提示词（否则用户不知道这三个按钮是什么）')
  assert.equal(
    allByClass(form, 'dsh-hooks__newfield').length,
    5,
    '模板行**不是**字段容器；字段容器是 事件 / 加到 / 匹配 / 命令 / 超时这五个（F1 的结构断言不受影响）',
  )

  // 静态纪律：模板命令必须是单行、且不许出现 `${`（会被 TS 插值 / 被当成 shell 变量）
  for (const template of HOOK_TEMPLATES) {
    assert.ok(!template.command.includes('\n'), `模板 ${template.id} 的命令必须是单行`)
    assert.ok(!template.command.includes('${'), `模板 ${template.id} 的命令里不许出现 \${`)
    assert.ok(template.command.startsWith('node -e "'), `模板 ${template.id} 必须用实测过的引号形态（外层双引号）`)
  }

  // 点「注入提醒」→ 事件 / 命令 / 超时被填好（用户还能改）
  templates[0].onClick()
  const filled = await advance(component, harness)
  assert.equal(firstByClass(filled, 'dsh-hooks__newselect').value, 'SessionStart', '事件被填成 SessionStart')
  const commandBox = allByClass(filled, 'dsh-hooks__editor')[0]
  assert.ok(commandBox.value.includes('additionalContext'), '命令框里就是模板命令（明文可见，不做黑盒预设）')
  assert.equal(allByClass(filled, 'dsh-hooks__input')[1].value, '10', '超时被填成 10 秒')

  // 提交 → addGroup 的实体逐字段等于模板（点一下就能用，不用手写 node -e）
  const calls = []
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return method === 'POST'
      ? { json: async () => ({ ok: true, data: { file: 'user', version: 'v2' } }) }
      : { json: async () => ({ ok: true, data: minimalSnapshot() }) }
  }
  // ⚠️ 先把 `advance` 那一次（会重跑取数 effect）走完，再清空记录、再点提交 ——
  // 否则数到的第一条是 GET，断言会变成"提交发了两次"的假失败。
  const ready = await advance(component, harness)
  calls.length = 0
  buttonByLabel(ready, '创建').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.length, 1, '提交只发一次请求')
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(withoutLock(calls[0].body), {
    file: 'user',
    op: 'addGroup',
    event: 'SessionStart',
    matcher: '',
    command: HOOK_TEMPLATES[0].command,
    timeoutSec: 10,
  })

  // ★ §4.8「源码存在 ≠ 已交付」：templates.ts 只能靠 import 进产物 —— 三个中文标签必须在**产物**里。
  const artifact = fs.readFileSync(CLIENT, 'utf8')
  for (const label of HOOK_TEMPLATES.map((template) => template.label)) {
    assert.ok(
      artifact.includes(label),
      `产物 lib/client.js 里应当有模板标签「${label}」（templates.ts 是不是没被 import？）`,
    )
  }
})

//#endregion

//#region D43. 乐观锁：每个写请求都必须带"页面看到的那一份文件"的版本

await test('D43：写请求带的是**目标文件**的版本（不是屏幕上另一份的），文件不存在时为 null', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  // 两份文件故意给**不同**的版本号：取错了立刻能看出来（用同一个 'v1' 就测不出"取错文件"）。
  const snapshot = snapshotOf({
    scope: 'user',
    userFile: snapshotFile(
      'user',
      'ok',
      { PreToolUse: [{ rawIndex: 0, matcher: 'pwsh', hooks: [snapshotHook(0, 'echo u')] }] },
      {
        version: 'u-v9',
      },
    ),
  })
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })

  const calls = []
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return {
      json: async () =>
        method === 'POST' ? { ok: true, data: { file: 'user', version: 'u-v10' } } : { ok: true, data: snapshot },
    }
  }

  // ① 默认作用域 = 用户级 ⇒ 锁必须是**用户级文件**的版本。
  switchNode(nodes).onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls[0].method, 'POST')
  assert.equal(
    calls[0].body.expectedVersion,
    'u-v9',
    '★ 写用户级文件就必须用用户级文件的版本做锁（这是"页面看到的那一版"的唯一来源）',
  )
})

await test('D43：切换到工作区后，锁换成**项目级文件**的版本（同一页面两份文件不许串）', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const snapshotFor = (scope) =>
    snapshotOf({
      scope,
      projectFile: snapshotFile(
        'project',
        'ok',
        { PreToolUse: [{ rawIndex: 0, matcher: 'pwsh', hooks: [snapshotHook(0, 'echo p')] }] },
        { version: 'p-v3' },
      ),
      userFile: snapshotFile('user', 'ok', {}, { version: 'u-v9' }),
    })
  const first = await renderSection(component, harness, (url) => ({
    ok: true,
    data: snapshotFor(String(url).includes('scope=workspace') ? 'w-1' : 'user'),
  }))

  const atWs = await pickScopeOption(first, component, harness, 'w-1')
  const calls = []
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return {
      json: async () =>
        method === 'POST'
          ? { ok: true, data: { file: 'project', version: 'p-v4' } }
          : { ok: true, data: snapshotFor('w-1') },
    }
  }
  switchNode(atWs).onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls[0].body.file, 'project', '前提：切换后写的是项目级那一份')
  assert.equal(calls[0].body.expectedVersion, 'p-v3', '★ 锁必须跟着**目标文件**换，不能还是 u-v9')
})

//#endregion

//#region D44–D45. 跑不了的东西必须有归属（不许说成"我没有配置"）

/**
 * 从**文件内容**造一份快照：真解析器 → 真快照（06 复查时补的）。
 *
 * 为什么必须这样：D44/D45 原先把 `rejected` 直接塞进 fixture，于是"解析器不给被拒组留记录"
 * 这个**真 bug** 在渲染断言里完全看不见 —— 页面显示"文件里还没有任何 hook"，断言照样绿。
 * 现在这条路是 `parseHookConfig(文件内容)` → `buildSnapshot(...)`，与宿主侧同一条。
 */
function snapshotFromRaw(raw) {
  const parsed = parseHookConfig(raw)
  return buildSnapshot(
    emptyInspection({
      writable: true,
      projectRoot: 'D:/p',
      scope: scopeView({ projectRoot: 'D:/p' }),
      sources: [sourceInspection('project', parsed.groups, { rejected: parsed.rejected, skipped: parsed.skipped })],
    }),
  )
}

await test('D44：被拒的组渲染成灰化的「不会运行」行（带原因），且不提供试运行', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  // ★ 走真解析器：matcher 少一个右括号 —— 这一组照样**记下来**、但一条都不跑。
  const snapshot = snapshotFromRaw({
    hooks: {
      PreToolUse: [
        {
          matcher: '(',
          hooks: [
            { type: 'command', command: 'echo a' },
            { type: 'command', command: 'echo b' },
          ],
        },
      ],
    },
  })
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })

  assert.equal(allByClass(nodes, 'dsh-hooks__hookcard').length, 1, '跑不了的那一组也要占一行（不许凭空消失）')
  const joined = joinedText(nodes)
  assert.ok(joined.includes('不会运行'), '例外态要看得见')
  assert.ok(joined.includes('匹配范围'), `要说清原因（匹配范围不合法）：${joined}`)
  assert.ok(!joined.includes('还没有任何 hook'), '★ 文件里有内容，绝不许可说成"还没有任何 hook"')

  // 那一行**不给试运行**：它根本不会运行，跑它只会得到一句假话。
  const menu = await openCardMenu(nodes, component, harness)
  const titles = allByClass(menu, 'dsh-hooks__btn').map((node) => node.title)
  assert.ok(!titles.includes('试运行'), `被拒的组不许提供试运行（现有动作：${titles.join('/')}）`)
  // 但它必须**能被修好**：改匹配范围是让这一组活过来的唯一入口（07 票）。
  assert.ok(
    menu.some((node) => typeof node.title === 'string' && node.title === '改匹配范围'),
    '被拒的组必须能就地改匹配范围（否则用户只能去手改 JSON）',
  )
})

await test('D45：全都跑不了（全是不支持的类型）时给出条数，而不是"文件里还没有任何 hook"', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  // ★ 06 复查抓到的真形态：三行 `type:"prompt"` —— 以前这种文件一条记录都不留，
  //   于是条数说"另有 3 条跑不了"，正文却说"文件里还没有任何 hook"（自相矛盾）。
  const snapshot = snapshotFromRaw({
    hooks: {
      Stop: [
        {
          hooks: [
            { type: 'prompt', prompt: 'a' },
            { type: 'prompt', prompt: 'b' },
            { type: 'prompt', prompt: 'c' },
          ],
        },
      ],
    },
  })
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })
  const joined = joinedText(nodes)
  assert.ok(joined.includes('3'), `要说得出"文件里有 3 条"：${joined}`)
  assert.ok(joined.includes('跑不了'), '要说得出它们跑不了')
  assert.ok(joined.includes('不会运行'), '并且它们必须各有一行灰化的归属（不是只剩一句话）')
  assert.ok(!joined.includes('文件里还没有任何 hook'), '★ 这里正是 v4 的撒谎点：文件里有 3 条，只是我们跑不了')
  assert.ok(!joined.includes('这个作用域还没有 hook'), '空状态块整块都不该出现（它不是"空"）')
})

//#endregion

//#region D46–D50. 能改的东西：匹配范围 / 超时 / 顺序 / 整组

await test('D46：⋯ 里能改匹配范围与超时（就地编辑 → 发 setGroupMatcher / setHookTimeout）', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const snapshot = snapshotOf({
    scope: 'user',
    userFile: snapshotFile('user', 'ok', {
      PreToolUse: [{ rawIndex: 0, matcher: 'pwsh', hooks: [snapshotHook(0, 'echo a')] }],
    }),
  })
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })
  const calls = []
  /** 只数 POST：advance() 会重跑 effect，GET 也会进 calls。 */
  const posts = () => calls.filter((call) => call.method === 'POST')
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return {
      json: async () =>
        method === 'POST' ? { ok: true, data: { file: 'user', version: 'v2' } } : { ok: true, data: snapshot },
    }
  }

  // ① 匹配范围：点开 → 输入框里是当前值 → 改 → 保存
  const opened = await openCardMenu(nodes, component, harness)
  menuFieldButton(opened, '改匹配范围').onClick()
  const editing = await advance(component, harness)
  const input = firstByClass(editing, 'dsh-hooks__input')
  assert.equal(input.value, 'pwsh', '就地编辑要预填当前值（不然等于让人重打一遍）')
  assert.equal(input.autoFocus, true, '★ 进入编辑态焦点要落在输入框（17 票）')
  input.onChange({ target: { value: 'bash' } })
  const typed = await advance(component, harness)
  buttonByLabel(typed, '保存').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(
    withoutLock(posts()[0].body),
    { file: 'user', op: 'setGroupMatcher', event: 'PreToolUse', groupIndex: 0, matcher: 'bash' },
    '改匹配范围 = 一次定点写（matcher 属于 group）',
  )

  // ② 超时：同一套编辑，落点是 hook 上的 timeout
  calls.length = 0
  const re2 = createFakeReact()
  const c2 = componentFromArtifact(re2.React)
  const nodes2 = await renderSection(c2, re2, { ok: true, data: snapshot })
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return {
      json: async () =>
        method === 'POST' ? { ok: true, data: { file: 'user', version: 'v3' } } : { ok: true, data: snapshot },
    }
  }
  const opened2 = await openCardMenu(nodes2, c2, re2)
  menuFieldButton(opened2, '改超时秒数').onClick()
  const editing2 = await advance(c2, re2)
  const input2 = firstByClass(editing2, 'dsh-hooks__input')
  assert.equal(input2.value, '', '没写 timeout 时输入框是空的（留空 = 默认）')
  input2.onChange({ target: { value: '30' } })
  const typed2 = await advance(c2, re2)
  buttonByLabel(typed2, '保存').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(withoutLock(posts()[0].body), {
    file: 'user',
    op: 'setHookTimeout',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 0,
    timeoutSec: 30,
  })
})

await test('D47：匹配范围写错时就地拦住（保存禁用 + 说明），不发请求', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const snapshot = snapshotOf({
    scope: 'user',
    userFile: snapshotFile('user', 'ok', {
      PreToolUse: [{ rawIndex: 0, matcher: 'pwsh', hooks: [snapshotHook(0, 'echo a')] }],
    }),
  })
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })
  const calls = []
  /** 只数 POST：advance() 会重跑 effect，GET 也会进 calls。 */
  const posts = () => calls.filter((call) => call.method === 'POST')
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method })
    return { json: async () => (method === 'POST' ? { ok: true, data: {} } : { ok: true, data: snapshot }) }
  }
  const opened = await openCardMenu(nodes, component, harness)
  menuFieldButton(opened, '改匹配范围').onClick()
  const editing = await advance(component, harness)
  firstByClass(editing, 'dsh-hooks__input').onChange({ target: { value: '(' } })
  const broken = await advance(component, harness)
  assert.equal(buttonByLabel(broken, '保存').disabled, true, '★ 非法 matcher 时保存必须禁用')
  assert.ok(joinedText(broken).includes('invalid regex'), '要就地说明哪里不合法（与宿主同一份判定）')
  assert.equal(posts().length, 0, '非法时一个请求都不许发')
})

await test('D48：不看匹配范围的事件（提示词提交 / 停止）不给"改匹配范围"入口', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const snapshot = snapshotOf({
    scope: 'user',
    userFile: snapshotFile('user', 'ok', {
      Stop: [{ rawIndex: 0, matcher: null, hooks: [snapshotHook(0, 'echo s')] }],
    }),
  })
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })
  const opened = await openCardMenu(nodes, component, harness)
  assert.ok(
    !opened.some((node) => typeof node.title === 'string' && node.title === '改匹配范围'),
    '★ Stop 的 matcher 会被协议丢弃 —— 给它编辑入口就是让用户白改',
  )
  assert.equal(
    opened.some((node) => typeof node.title === 'string' && node.title === '改超时秒数'),
    true,
    '超时仍然可改（它与 matcher 无关）',
  )
})

await test('D49：上移 / 下移 —— 边界禁用，点击带的是**文件里的**目标下标', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const snapshot = snapshotOf({
    scope: 'user',
    userFile: snapshotFile('user', 'ok', {
      PreToolUse: [
        {
          rawIndex: 0,
          matcher: 'pwsh',
          hooks: [snapshotHook(0, 'echo a'), snapshotHook(3, 'echo b'), snapshotHook(4, 'echo c')],
        },
      ],
    }),
  })
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })
  // 第二条（b）的 rawIndex 是 3 —— 上移的目标必须是 0（a 的文件下标），不是 2。
  const second = await openCardMenu(nodes, component, harness, 1)
  const up = menuFieldButton(second, '上移')
  const down = menuFieldButton(second, '下移')
  assert.equal(up.disabled, false, '中间那条两个方向都可用')
  assert.equal(down.disabled, false)

  const calls = []
  /** 只数 POST：advance() 会重跑 effect，GET 也会进 calls。 */
  const posts = () => calls.filter((call) => call.method === 'POST')
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return { json: async () => (method === 'POST' ? { ok: true, data: {} } : { ok: true, data: snapshot }) }
  }
  up.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(withoutLock(posts()[0].body), {
    file: 'user',
    op: 'moveHook',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 3,
    direction: -1,
    toIndex: 0,
  })

  // 第一条的上移、最后一条的下移都禁用（不发请求）
  const firstRow = await openCardMenu(nodes, component, harness, 0)
  assert.equal(menuFieldButton(firstRow, '上移').disabled, true, '第一条不能再往上')
})

await test('D50：删除整组走两步确认；新建时可**追加到已有组**（addHook，不新开组）', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const snapshot = snapshotOf({
    scope: 'user',
    userFile: snapshotFile('user', 'ok', {
      PreToolUse: [{ rawIndex: 0, matcher: 'pwsh', hooks: [snapshotHook(0, 'echo a')] }],
    }),
  })
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })
  const calls = []
  /** 只数 POST：advance() 会重跑 effect，GET 也会进 calls。 */
  const posts = () => calls.filter((call) => call.method === 'POST')
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return { json: async () => (method === 'POST' ? { ok: true, data: {} } : { ok: true, data: snapshot }) }
  }

  // ① 删除整组：第一步只改状态，第二步才发请求
  const opened = await openCardMenu(nodes, component, harness)
  buttonByLabel(opened, '删除整组').onClick()
  const asked = await advance(component, harness)
  assert.equal(posts().length, 0, '★ 第一步不许发请求（删除是唯一丢数据的操作）')
  assert.ok(joinedText(asked).includes('删除这一组'), '要问一次')
  buttonByLabel(asked, '确认删除整组').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(withoutLock(posts()[0].body), {
    file: 'user',
    op: 'removeGroup',
    event: 'PreToolUse',
    groupIndex: 0,
  })

  // ② 新建表单的落点选"已有组" → 发 addHook（带 groupIndex），而不是 addGroup
  calls.length = 0
  const h2 = createFakeReact()
  const c2 = componentFromArtifact(h2.React)
  const nodes2 = await renderSection(c2, h2, { ok: true, data: snapshot })
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return { json: async () => (method === 'POST' ? { ok: true, data: {} } : { ok: true, data: snapshot }) }
  }
  const form = await openNewForm(nodes2, c2, h2)
  /** 从当前节点里找"加到"那个下拉（它挂在 `__newfield--group` 容器下，与事件下拉是两个控件）。 */
  const groupSelectOf = (nodes) => {
    const field = firstByClass(nodes, 'dsh-hooks__newfield--group')
    const select = nodes.find((node) => node.parentClass === field.className && node.tag === 'select')
    assert.ok(select !== undefined, '表单里应当有一个"加到"下拉（与事件下拉分开）')
    return select
  }
  assert.equal(groupSelectOf(form).value, '', '缺省是"新开一组"')
  // 命令是**多行编辑器**（`__editor`），不是 `__input`（那是匹配范围 / 超时那种单行框）。
  firstByClass(form, 'dsh-hooks__editor').onChange({ target: { value: 'echo new' } })
  const filled = await advance(c2, h2)
  // 输入之后必须**重新查节点**（§4.5：事件闭包是当次渲染的）
  groupSelectOf(filled).onChange({ target: { value: '0' } })
  const chosen = await advance(c2, h2)
  buttonByLabel(chosen, '创建').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(posts()[0].body.op, 'addHook', '★ 选了已有组就必须追加，不许新开一组')
  assert.equal(posts()[0].body.groupIndex, 0)
  assert.equal(posts()[0].body.command, 'echo new')
})

//#endregion

//#region D51–D57. 时间证据 / 生效视图 / 输出可读 / 预算 / 搜索 / 可达性 / 分节

await test('D51：状态带"多久之前"；诊断里写明状态只记本次进程', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const threeMinutesAgo = Date.now() - 3 * 60_000
  const snapshot = snapshotOf({
    scope: 'user',
    userFile: snapshotFile('user', 'ok', {
      PreToolUse: [
        {
          rawIndex: 0,
          matcher: 'pwsh',
          hooks: [
            snapshotHook(0, 'echo a', {
              lastRun: { at: threeMinutesAgo, exitCode: 0, decision: 'pass', durationMs: 12, stdout: '', stderr: '' },
            }),
          ],
        },
      ],
    }),
  })
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })
  assert.ok(!joinedText(nodes).includes('分钟前'), '首屏仍然只有一个状态词（时间证据进 ⋯）')

  const opened = await openCardMenu(nodes, component, harness)
  const text = joinedText(opened)
  assert.ok(text.includes('3 分钟前'), `★ 要看得出"这是三分钟前的通过"：${text}`)
  assert.ok(text.includes('exit 0'), '与退出码放在同一处')
  assert.ok(text.includes('12ms'), '与耗时放在同一处')

  const more = await expandFold(opened, component, harness, '更多')
  assert.ok(joinedText(more).includes('只记录本次进程'), '★ 必须说明台账是进程级记忆（重启后回到「未运行」）')
})

await test('D52：生效视图 —— 按执行顺序列出用户级 / 项目级，条数口径两侧之和等于总数', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const group = (file, matcher, hooks) => ({
    file,
    rawIndex: 0,
    matcher,
    matcherOk: true,
    matcherProblem: null,
    hooks,
  })
  const events = HOOK_EVENTS.map((event) =>
    event === 'PreToolUse'
      ? {
          event,
          groups: [
            group('user', 'pwsh', [snapshotHook(0, 'echo u')]),
            group('project', null, [snapshotHook(0, 'echo p1'), snapshotHook(1, 'echo p2')]),
          ],
          hookCount: 3,
          disabledCount: 0,
          fromUser: 1,
          fromProject: 2,
          runCount: 0,
        }
      : { event, groups: [], hookCount: 0, disabledCount: 0, fromUser: 0, fromProject: 0, runCount: 0 },
  )
  const snapshot = snapshotOf({ scope: 'user', events })
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })
  const more = await expandFold(nodes, component, harness, '更多')
  const text = joinedText(more)

  assert.ok(text.includes('生效配置'), '有一节叫「生效配置」')
  assert.ok(text.includes('3 条（用户级 1 + 项目级 2）'), `★ 两侧之和必须等于总数：${text}`)
  assert.ok(text.includes('用户级 · 匹配 pwsh · 1 条'), '用户级那组要说出来源 / 匹配范围 / 条数')
  assert.ok(text.includes('项目级 · 匹配全部 · 2 条'), '项目级那组同样')
  // 顺序即执行顺序：用户级在前（宿主合并语义）
  assert.ok(
    text.indexOf('用户级 · 匹配 pwsh') < text.indexOf('项目级 · 匹配全部'),
    '★ 顺序必须是用户级在前、项目级在后（那就是实际执行顺序）',
  )
})

await test('D53：试运行的长输出被截断并可展开（不再把整张卡撑成一片糊字）', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const snapshot = snapshotOf({
    scope: 'user',
    userFile: snapshotFile('user', 'ok', {
      PreToolUse: [{ rawIndex: 0, matcher: 'pwsh', hooks: [snapshotHook(0, 'echo a')] }],
    }),
  })
  const first = await renderSection(component, harness, { ok: true, data: snapshot })
  const opened = await openCardMenu(first, component, harness)
  const long = `HEAD-${'x'.repeat(1200)}-TAIL`
  const drySnapshot = { ok: true, data: snapshot }
  globalThis.fetch = async (_url, options = {}) => ({
    json: async () =>
      (options.method ?? 'GET') === 'POST'
        ? {
            ok: true,
            data: {
              run: { command: 'echo a', exitCode: 0, decision: 'pass', durationMs: 3, stdout: long, stderr: '' },
            },
          }
        : drySnapshot,
  })
  buttonByLabel(opened, '试运行').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const after = await advance(component, harness)
  const dry = firstByClass(after, 'dsh-hooks__dry')
  const summary = textOfClass(after, 'dsh-hooks__drysummary')
  assert.ok(summary.includes('已截断'), `★ 超长输出要留"已截断"标记：${summary.slice(0, 80)}`)
  assert.ok(summary.length < 600, `摘要必须有上限（实际 ${summary.length} 字符）`)
  assert.ok(joinedText(after).includes('查看全文'), '被截断时给得到全文的入口')
  assert.equal(allByClass(after, 'dsh-hooks__drytext').length, 1, '全文用 pre 块呈现')
  assert.equal(dry.role, 'status', '异步结论要播报（role=status）')
})

await test('D54：写失败之后页面还能继续操作（时间预算不会把整页永久冻住）', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const snapshot = snapshotOf({
    scope: 'user',
    userFile: snapshotFile('user', 'ok', {
      PreToolUse: [{ rawIndex: 0, matcher: 'pwsh', hooks: [snapshotHook(0, 'echo a')] }],
    }),
  })
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })
  globalThis.fetch = async (_url, options = {}) => {
    if ((options.method ?? 'GET') === 'POST') {
      const aborted = new Error('The operation was aborted')
      aborted.name = 'AbortError'
      throw aborted
    }
    return { json: async () => ({ ok: true, data: snapshot }) }
  }
  switchNode(nodes).onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const after = await advance(component, harness)
  assert.ok(joinedText(after).includes('太久没有回应'), `★ 超时要有一句自己的话：${joinedText(after)}`)
  assert.equal(switchNode(after).disabled, false, '★ 失败之后开关必须重新可用（否则整页永久冻住）')
  assert.equal(toolButton(after, '刷新').disabled, false, '工具条也要恢复可用')
})

await test('D55：搜索匹配"页面上的字"（中文事件名 / 状态词 / 已停用）', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const snapshot = snapshotOf({
    scope: 'user',
    userFile: snapshotFile('user', 'ok', {
      PreToolUse: [
        {
          rawIndex: 0,
          matcher: 'pwsh',
          hooks: [
            snapshotHook(0, 'echo ok', {
              lastRun: { at: 1, exitCode: 0, decision: 'pass', durationMs: 1, stdout: '', stderr: '' },
            }),
            snapshotHook(1, 'echo bad', {
              lastRun: { at: 2, exitCode: 1, decision: 'pass', durationMs: 1, stdout: '', stderr: 'boom' },
            }),
            snapshotHook(2, 'echo off', { disabled: true }),
            snapshotHook(3, 'echo x'),
            snapshotHook(4, 'echo y'),
          ],
        },
      ],
    }),
  })
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })
  const search = firstByClass(nodes, 'dsh-hooks__search')

  const byLabel = async (word) => {
    const fresh = await renderSection(component, harness, { ok: true, data: snapshot })
    firstByClass(fresh, 'dsh-hooks__search').onChange({ target: { value: word } })
    const filtered = await advance(component, harness)
    return allByClass(filtered, 'dsh-hooks__hookcard').length
  }

  assert.ok(joinedText(nodes).includes('工具运行前'), '前提：页面上的事件名是中文')
  assert.equal(await byLabel('工具运行前'), 5, '★ 按中文事件名能搜到全部 5 条')
  assert.equal(await byLabel('已停用'), 1, '★ 按"已停用"能搜到那一条')
  assert.equal(await byLabel('失败'), 1, '★ 按状态词"失败"能搜到那一条')
  assert.equal(await byLabel('没有这个词'), 0, '反向：不存在的词得到 0 条')
  assert.ok(search !== undefined)
})

await test('D56：可达性 —— 播报、开关的名字、listbox 的高亮指认、表单首个字段的焦点', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const snapshot = snapshotOf({
    scope: 'user',
    userFile: snapshotFile('user', 'ok', {
      PreToolUse: [{ rawIndex: 0, matcher: 'pwsh', hooks: [snapshotHook(0, 'echo alpha')] }],
    }),
  })
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })

  // ① 开关的可访问名能分辨"是哪一条"
  const sw = switchNode(nodes)
  assert.ok(
    typeof sw.ariaLabel === 'string' && sw.ariaLabel.includes('工具运行前') && sw.ariaLabel.includes('echo alpha'),
    `开关必须有能分辨身份的名字：${String(sw.ariaLabel)}`,
  )

  // ② 作用域 popover：listbox 必须指认高亮项，且那一项真的有 id
  const opened = await openScopePicker(nodes, component, harness)
  const listbox = firstByClass(opened, 'dsh-hooks__popover')
  assert.equal(listbox.role, 'listbox')
  assert.equal(listbox.ariaActiveDescendant, 'dsh-hooks-scope-0', '★ aria-activedescendant 必须指到高亮项')
  assert.ok(
    opened.some((node) => node.id === 'dsh-hooks-scope-0'),
    '被指认的 id 必须真的存在（否则读屏指到空处）',
  )

  // ③ 新建表单：焦点落在第一个可编辑字段（没有真实 DOM，唯一可观察形态就是 autoFocus）
  const form = await openNewForm(nodes, component, harness)
  assert.equal(firstByClass(form, 'dsh-hooks__newselect').autoFocus, true, '★ 打开表单时焦点要落在事件下拉')
})

await test('D57：读取失败走 role="alert"（异步结论要播报）', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const nodes = await renderSection(component, harness, async () => ({
    ok: false,
    error: 'unknown-workspace',
    detail: '工作区 w-gone 不在宿主的清单里（可能被删过）',
  }))
  const alert = firstByClass(nodes, 'dsh-hooks__alert')
  assert.equal(alert.role, 'alert', '★ 页面级错误必须能播报')
})

await test('D58：「更多」分成三节（生效配置 / 全部事件 / 诊断），诊断值是人话不是字段名', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const nodes = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })
  const more = await expandFold(nodes, component, harness, '更多')
  const text = joinedText(more)

  const heads = more.filter(
    (node) => typeof node.className === 'string' && node.className.includes('dsh-hooks__foldhead'),
  )
  assert.equal(heads.length, 3, '★ 三节各有一个标题')
  for (const label of ['生效配置', '全部事件', '诊断']) {
    assert.ok(text.includes(label), `缺少分节标题「${label}」`)
  }
  for (const jargon of ['kind=', 'requested=', 'staleInUse', 'isCurrentSession=']) {
    assert.ok(!text.includes(jargon), `★ 诊断值不许直出内部字段名「${jargon}」：${text}`)
  }
  assert.ok(text.includes('沿用旧配置'), '原先那行内部字段改成了一句人话')
  assert.ok(text.includes('工作目录来源'), 'cwd 来源也翻成了人话')
  // 既有的两条可达性断言：7 个事件仍然全在
  assert.equal(allByClass(more, 'dsh-hooks__eventrow').length, HOOK_EVENTS.length, '7 个事件（含 0 条）仍在')
})

//#endregion

//#region E. 构建指纹：产物必须就是当前源码的产物（"过期但全绿"的唯一防线）

// `lib/**` 是**提交进版本库**的产物，所以必须能断言"它没过期"。没有这一区的话，
// 改完 src/** 忘记 pnpm build，自检会拿着旧产物全绿，而刚修好的 bug 看起来"没修"。
// 指纹由 tools/build.ts 产出（不带时间戳，可复现），这里重算并逐项比对。

const MANIFEST_PATH = path.join(HERE, '..', 'lib', '.build-manifest.json')

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

test('E：lib/.build-manifest.json 存在且结构正确', () => {
  assert.ok(fs.existsSync(MANIFEST_PATH), '缺少构建指纹：请先跑 pnpm build')
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  assert.ok(
    typeof manifest.tool === 'string' && manifest.tool.startsWith('esbuild@'),
    `tool 应当是 esbuild@<version>，实际 ${String(manifest.tool)}`,
  )
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'))
  assert.equal(manifest.package, pkg.name, '指纹里的包名应当与 package.json 一致')
  assert.ok(Array.isArray(manifest.targets) && manifest.targets.length > 0, '至少要有一个构建目标')
})

test('E：产物 sha256 与指纹一致（产物被手改过就会红）', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  for (const target of manifest.targets) {
    const outputPath = path.join(HERE, '..', target.output)
    assert.ok(fs.existsSync(outputPath), `产物不存在：${String(target.output)}`)
    assert.equal(
      sha256(fs.readFileSync(outputPath)),
      target.outputSha256,
      `${String(target.output)} 的内容与指纹不符 —— 要么手改了产物，要么忘了 pnpm build`,
    )
  }
})

test('E：指纹覆盖到的每个源文件都没有变（源改而没重建就会红）', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  let checked = 0
  for (const target of manifest.targets) {
    for (const [relPath, expected] of Object.entries(target.inputs)) {
      const full = path.join(HERE, '..', relPath)
      assert.ok(fs.existsSync(full), `指纹记录了不存在的源文件：${relPath}`)
      assert.equal(
        sha256(fs.readFileSync(full)),
        expected,
        `${relPath} 在构建之后被改过 —— 跑 pnpm build 重新生成产物（产物提交进版本库，别漏）`,
      )
      checked++
    }
  }
  assert.ok(checked > 0, '指纹里一个源文件都没有？')
})

test('E：构建脚本自身没变（改了 build.ts 也要重建）', () => {
  // 没有这一条的话，"产物与源码都对得上、但生成方式已经变了"是唯一抓不到的过期路径。
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  assert.ok(manifest.builder !== null && typeof manifest.builder === 'object', '指纹里应当记录构建脚本（builder）')
  assert.equal(manifest.builder.path, 'tools/build.ts')
  assert.equal(
    sha256(fs.readFileSync(path.join(HERE, '..', manifest.builder.path))),
    manifest.builder.sha256,
    'tools/build.ts 在构建之后被改过 —— 跑 pnpm build 重新生成产物',
  )
})

test('E：功能标记必须真的出现在产物里（源码存在 ≠ 已交付）', () => {
  // esbuild 只从入口 `src/host/index.ts` 沿 import 打包：**没有任何模块 import 的文件会被静默丢掉**，
  // 而"源码改了没重建""指纹对得上"这些断言全部照样通过 —— 插件实际没有那个功能。
  // P4b 的 write.ts 就真的没进产物（接线留到 P4c），这条断言是唯一能发现"忘了接线"的机器检查。
  // 运维提示：新增必须交付的模块时，把它的**唯一标记字符串**加到这个列表里。
  const source = fs.readFileSync(LIB, 'utf8')
  const markers = [
    '/api/hooks', // data-plane.ts：设置页路由
    '改写会动到目标之外的字段', // write.ts：写路径（接线之前它整块被 esbuild 丢掉了）
    '已截断', // ledger.ts：执行台账（状态色的唯一证据来源）
    'unknown-workspace', // index.ts + data-plane.ts：作用域写入的拒写码（§2.2）
  ]
  for (const marker of markers) {
    assert.ok(source.includes(marker), `产物里应当出现 ${marker} —— 检查它所在的模块是不是没被 import 进去`)
  }
})

test('E：src/** 下没有漏进指纹的文件', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const recorded = new Set()
  for (const target of manifest.targets) {
    for (const relPath of Object.keys(target.inputs)) recorded.add(relPath)
  }
  const walk = (dir) => {
    const out = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walk(full))
      else if (entry.isFile()) out.push(path.relative(path.join(HERE, '..'), full).split(path.sep).join('/'))
    }
    return out
  }
  const srcRoot = path.join(HERE, '..', 'src')
  const onDisk = fs.existsSync(srcRoot) ? walk(srcRoot) : []
  const missing = onDisk.filter((relPath) => !recorded.has(relPath))
  assert.deepEqual(missing, [], `这些源文件没有被任何构建目标覆盖：${missing.join(', ')}`)
})

//#endregion

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

test('产物导出面**恰好**是 apply/inject/name（不留只给自检看的死导出）', () => {
  // 迁移期产物里曾有一个 `internals` 导出，纯粹为了让自检拿到纯函数。P3b 之后纯函数由自检
  // 直接 import 源码，那个导出就删了。这条断言防止它（或任何别的死导出）被重新加回来。
  const source = fs.readFileSync(LIB, 'utf8')
  const match = source.match(/export \{([^}]*)\}/)
  assert.ok(match, '产物里应当有且只有一个 export 语句')
  const exported = match[1]
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .sort()
  assert.deepEqual(exported, ['apply', 'inject', 'name'], `产物导出了：${exported.join(', ')}`)
  assert.ok(!source.includes('internals'), '产物里不该再有迁移期为了自检而加的 internals 导出')
})

test('产物带"由构建生成、不要手改"的横幅', () => {
  // 没有横幅的话，下一个人完全可能把产物当源码手改 —— 然后下一次构建静默覆盖他的改动。
  const source = fs.readFileSync(LIB, 'utf8')
  assert.ok(source.startsWith('/**'), '产物应当以横幅注释开头')
  assert.ok(source.includes('由 tools/build.ts 从 src/** 生成'), '产物应当标明自己是由构建生成的')
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
  console.log(
    `  跳过的 handler: ${parsed.skipped.length ? parsed.skipped.map((s) => `${s.event}:${s.type}`).join(', ') : '(无)'}`,
  )
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
  assert.deepEqual(wrapped.groups.PreToolUse[0].hooks, [{ command: 'a', rawIndex: 0 }])
  const bare = parseHookConfig({ PreToolUse: [{ hooks: [{ command: 'a' }] }] })
  assert.deepEqual(bare.groups.PreToolUse[0].hooks, [{ command: 'a', rawIndex: 0 }])
})

test('parseHookConfig：timeout 是秒，缺省时不写', () => {
  const r = parseHookConfig({ hooks: { PostToolUse: [{ hooks: [{ command: 'a', timeout: 30 }, { command: 'b' }] }] } })
  assert.deepEqual(r.groups.PostToolUse[0].hooks, [
    { command: 'a', timeoutSec: 30, rawIndex: 0 },
    { command: 'b', rawIndex: 1 },
  ])
})

test('parseHookConfig：非 command handler 跳过并记录', () => {
  const r = parseHookConfig({
    hooks: {
      PreToolUse: [
        {
          hooks: [
            { type: 'http', url: 'http://x' },
            { type: 'command', command: 'a' },
          ],
        },
      ],
      Stop: [{ hooks: [{ type: 'prompt', prompt: 'p' }] }],
    },
  })
  assert.deepEqual(r.skipped, [
    // 06 票起带**文件下标**与**原因**：页面要能说清"第几组的第几条、为什么跑不了"。
    { event: 'PreToolUse', type: 'http', groupIndex: 0, hookIndex: 0, reason: 'unsupported-type' },
    { event: 'Stop', type: 'prompt', groupIndex: 0, hookIndex: 0, reason: 'unsupported-type' },
  ])
  assert.equal(r.groups.PreToolUse[0].hooks.length, 1)
  assert.equal(r.groups.Stop, undefined)
  // rawIndex 必须是**文件里的真实下标**：被跳过的是第 0 条，保留下来的这条是第 1 条。
  // 这条断言就是写路径寻址安全的地基 —— 拿 parsedIndex 去写会改错 hook。
  assert.equal(r.groups.PreToolUse[0].hooks[0].rawIndex, 1)
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
  assert.deepEqual(r.groups.PreToolUse[0].hooks, [{ command: 'good', rawIndex: 0 }])
  // 同理：被跳过的 group 在文件里是第 0 个，保留下来的这个 group 的 rawIndex 必须是 1。
  assert.equal(r.groups.PreToolUse[0].rawIndex, 1)
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
  const merged = mergeHookGroups(
    { PreToolUse: [{ hooks: [{ command: 'user' }] }] },
    {
      PreToolUse: [{ hooks: [{ command: 'project' }] }],
      Stop: [{ hooks: [{ command: 'stop' }] }],
    },
  )
  assert.deepEqual(
    merged.PreToolUse.map((g) => g.hooks[0].command),
    ['user', 'project'],
  )
  assert.deepEqual(
    merged.Stop.map((g) => g.hooks[0].command),
    ['stop'],
  )
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
  assert.deepEqual(mergeHookOutputs([{ additionalContext: 'a' }, { additionalContext: 'b' }, {}]).additionalContext, [
    'a',
    'b',
  ])
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

//#region F. 作用域：写路径 / 请求校验 / 台账匹配（纯函数，不碰 fs）
//   §8 的 F1–F4。全部**先红后绿**：每条都做过"注入违规 → 精确报错 → 还原"（见 docs/plan-workspace-scope.md §8）。

test('F：addGroup —— 新建事件数组 / 追加到已有组 / matcher·timeout 为 null 时不写键', () => {
  // ① 事件数组**不存在** → 创建它。两种顶层形状都要支持（与解析用同一条 `hooksMapOf` 判定）。
  const bare = applied({}, { op: 'addGroup', event: 'PreToolUse', matcher: 'pwsh', command: 'echo a', timeoutSec: 20 })
  assert.deepEqual(bare.doc, {
    PreToolUse: [{ matcher: 'pwsh', hooks: [{ type: 'command', command: 'echo a', timeout: 20 }] }],
  })
  assert.equal(preservationProblem({}, bare.doc, bare.changes), undefined, '新建事件数组也必须过保留性证明')

  const wrapped = applied(
    { hooks: {} },
    { op: 'addGroup', event: 'Stop', matcher: null, command: 'echo s', timeoutSec: null },
  )
  assert.deepEqual(wrapped.doc, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo s' }] }] } })
  assert.equal(preservationProblem({ hooks: {} }, wrapped.doc, wrapped.changes), undefined)

  // ② 追加到**已有**事件数组 → 落在末尾，前面的组一个字不动
  const doc = { hooks: { PreToolUse: [{ matcher: 'a', hooks: [{ command: 'x' }] }] } }
  const appended = applied(doc, {
    op: 'addGroup',
    event: 'PreToolUse',
    matcher: '',
    command: 'echo b',
    timeoutSec: null,
  })
  assert.equal(appended.doc.hooks.PreToolUse.length, 2)
  assert.deepEqual(appended.doc.hooks.PreToolUse[1], { hooks: [{ type: 'command', command: 'echo b' }] })
  assert.equal(
    'matcher' in appended.doc.hooks.PreToolUse[1],
    false,
    'matcher 为 null/空串 → 不写这个键（不是空字符串）',
  )
  assert.equal('timeout' in appended.doc.hooks.PreToolUse[1].hooks[0], false, 'timeoutSec 为 null → 不写这个键')
  assert.deepEqual(appended.doc.hooks.PreToolUse[0], doc.hooks.PreToolUse[0], '已有组一个字段都不许动')
  assert.equal(preservationProblem(doc, appended.doc, appended.changes), undefined)

  // ③ 空 command 是非法操作（不可信输入不许进 applyOp）
  const empty = applyOp(
    {},
    { file: 'project', op: 'addGroup', event: 'Stop', matcher: null, command: '', timeoutSec: null },
  )
  assert.equal(empty.ok, false)
  assert.equal(empty.reason, 'bad-op')
})

test('F：addGroup 的保留性证明（带 _comment + 未知键；顺手丢字段必须被拒）', () => {
  const doc = {
    _comment: 'keep me',
    hooks: { Stop: [{ hooks: [{ command: 'echo stop' }] }] },
    extra: { nested: [1, 2, 3] },
  }
  const { doc: next, changes } = applied(doc, {
    op: 'addGroup',
    event: 'PreToolUse',
    matcher: 'pwsh',
    command: 'echo a',
    timeoutSec: null,
  })
  assert.equal(next._comment, 'keep me')
  assert.deepEqual(next.extra, { nested: [1, 2, 3] }, '未知键必须原样保留（结构上不可能丢）')
  assert.deepEqual(next.hooks.Stop, doc.hooks.Stop, '别的事件一个字都不许动')
  assert.equal(preservationProblem(doc, next, changes), undefined)

  // 注入：顺手"重建整个 hooks 映射"（丢了 unknown 键）→ 必须被证明抓住、调用方据此**拒写**
  const lossy = JSON.parse(JSON.stringify(next))
  delete lossy.extra
  const problem = preservationProblem(doc, lossy, changes)
  assert.equal(typeof problem, 'string', '丢了未知键必须被抓住')
  assert.ok(problem.includes('目标之外的字段'), `提示要能看出性质：${String(problem)}`)

  // 反向验证点二：把"新建的事件数组"声明成 index 而不是 key → 新文档里会留下一个空数组 → 必须不过
  const wrong = [{ path: ['hooks', 'PreToolUse', 0], mode: 'index' }]
  assert.equal(
    typeof preservationProblem(doc, next, wrong),
    'string',
    '新建事件数组的 changes 声明成 index 时证明必须不过（否则这条断言是平凡通过的）',
  )
})

test('F：parseHooksRequest 校验 workspaceId（非字符串 / 空串 / file:user 带它 → 全 400）', () => {
  const base = {
    op: 'setHookDisabled',
    file: 'project',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 0,
    disabled: true,
  }
  for (const workspaceId of [42, '', null, {}, []]) {
    const parsed = parseHooksRequest({ ...base, workspaceId })
    assert.equal(parsed.ok, false, `workspaceId=${JSON.stringify(workspaceId)} 必须被拒`)
    assert.ok(parsed.reason.includes('workspaceId'), `拒了要说清是 workspaceId 的问题：${parsed.reason}`)
  }
  const user = parseHooksRequest({ ...base, file: 'user', workspaceId: 'w1' })
  assert.equal(user.ok, false, 'file:user 带 workspaceId 是自相矛盾的请求（用户级不属于任何工作区）')

  // 合法：原样带出来（宿主据此**定点**到那个工作区，绝不回落会话项目）
  const good = parseHooksRequest({ ...base, workspaceId: 'w1' })
  assert.equal(good.ok, true)
  assert.equal(good.request.workspaceId, 'w1')
  assert.equal(good.request.file, 'project')
  // 不给时**不许**凭空补一个 `workspaceId: undefined` 键（请求体形状是契约的一部分）
  const none = parseHooksRequest(base)
  assert.equal(none.ok, true)
  assert.equal('workspaceId' in none.request, false)
})

test('F：错误码目录 ↔ 用户文案表（每个码都要有自己的一句；缺一即红）', () => {
  // 前提：未知码确实走兜底分支。不做这一步，"每个码都有专属文案"可以靠"都走兜底"平凡通过。
  const fallback = writeErrorSentence('__not_a_code__')
  assert.ok(fallback.includes('__not_a_code__'), '前提：未知码必须走兜底分支')

  // 目录本身必须非空，且两半都在（否则空数组也能让下面的循环空转通过）。
  assert.ok(HOST_ERROR_CODES.length >= 15, '宿主错误码目录不许缩水（少一个码就等于少一条排查路径）')
  assert.ok(SENTENCE_ERROR_CODES.includes('network'), '只在浏览器半边产生的码也必须在目录里')
  assert.ok(SENTENCE_ERROR_CODES.includes('bad-timeout'), '纯前端校验的码也必须在目录里')

  const seen = new Map()
  for (const code of SENTENCE_ERROR_CODES) {
    const sentence = writeErrorSentence(code)
    assert.ok(sentence.length >= 8, `${code} 的文案太短，等于没说：${sentence}`)
    assert.notEqual(sentence, fallback, `错误码 ${code} 没有专属文案（页面会显示「写入失败（${code}）」这种内部码）`)
    assert.ok(!sentence.includes(code), `${code} 的文案里不许出现机器码本身：${sentence}`)
    assert.ok(
      !seen.has(sentence),
      `${code} 与 ${seen.get(sentence)} 用了同一句话 —— 页面据此分不清这两种情形：${sentence}`,
    )
    seen.set(sentence, code)
  }
})

test('F：请求被中止时折成 timeout（永不抛），调用方只需判 ok', async () => {
  // 15 票的客户端半边：写与试运行都带时间预算，预算用完就 abort —— 这条断言守的是
  // "abort 不以异常形态冒到调用点"，且被翻译成 `timeout` 而不是 `network`（两者文案与用户
  // 该做的事不同：前者可重试，后者多半是宿主没起）。
  const controller = new AbortController()
  controller.abort()
  const prevFetch = globalThis.fetch
  globalThis.fetch = async (_url, options = {}) => {
    if (options.signal !== undefined && options.signal.aborted) {
      const aborted = new Error('The operation was aborted')
      aborted.name = 'AbortError'
      throw aborted
    }
    return { json: async () => ({ ok: true }) }
  }
  try {
    const write = await requestWrite(
      { file: 'user', op: 'createFile', expectedVersion: null },
      undefined,
      controller.signal,
    )
    assert.equal(write.ok, false, '被中止不许抛，要折成结果形状')
    assert.equal(write.error, 'timeout')

    const dry = await requestDryRun(
      { file: 'user', event: 'PreToolUse', groupIndex: 0, hookIndex: 0 },
      undefined,
      controller.signal,
    )
    assert.equal(dry.ok, false)
    assert.equal(dry.error, 'timeout')
  } finally {
    globalThis.fetch = prevFetch
  }
})

test('F：删掉组里最后一条 hook ⇒ 整组回收（不留空壳），且仍过保留性证明', () => {
  const doc = {
    _comment: 'keep me',
    hooks: {
      PreToolUse: [
        { matcher: 'pwsh', hooks: [{ type: 'command', command: 'a' }] },
        { matcher: 'bash', hooks: [{ type: 'command', command: 'b' }] },
      ],
    },
  }
  const { doc: next, changes } = applied(doc, {
    op: 'removeHook',
    file: 'project',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 0,
  })
  assert.equal(next.hooks.PreToolUse.length, 1, '被删空的那一组必须整组回收 —— 否则文件里留下一个看不见也删不掉的空壳')
  assert.deepEqual(next.hooks.PreToolUse[0], doc.hooks.PreToolUse[1], '另一组一个字都不许动')
  assert.equal(next._comment, 'keep me', '未知键原样保留')
  assert.equal(preservationProblem(doc, next, changes), undefined, '回收空组也必须过保留性证明（两处下标删除）')

  // 反向：组里还有别的 hook ⇒ **不许**顺手回收
  const two = { hooks: { PreToolUse: [{ hooks: [{ command: 'a' }, { command: 'b' }] }] } }
  const kept = applied(two, { op: 'removeHook', file: 'project', event: 'PreToolUse', groupIndex: 0, hookIndex: 0 })
  assert.equal(kept.doc.hooks.PreToolUse.length, 1, '还有内容的组不许被回收')
  assert.equal(kept.doc.hooks.PreToolUse[0].hooks.length, 1)
  assert.equal(kept.doc.hooks.PreToolUse[0].hooks[0].command, 'b', '删的是第一条')
  assert.equal(preservationProblem(two, kept.doc, kept.changes), undefined)
})

test('F：事件键存在但不是数组 ⇒ 新增类操作拒写 malformed-event（绝不静默覆盖）', () => {
  const doc = { hooks: { PreToolUse: { oops: 'not an array' } } }
  const group = applyOp(doc, {
    file: 'project',
    op: 'addGroup',
    event: 'PreToolUse',
    matcher: null,
    command: 'echo x',
    timeoutSec: null,
  })
  assert.equal(group.ok, false, '结构坏了就拒写')
  assert.equal(group.reason, 'malformed-event')

  const hook = applyOp(doc, {
    file: 'project',
    op: 'addHook',
    event: 'PreToolUse',
    groupIndex: 0,
    command: 'echo x',
    timeoutSec: null,
  })
  assert.equal(hook.ok, false)
  assert.equal(hook.reason, 'malformed-event')

  // 反向：事件键**不存在**仍然是合法的"新建"（不许把正常路径也判成畸形）
  const fresh = applyOp(
    {},
    { file: 'project', op: 'addGroup', event: 'Stop', matcher: null, command: 'echo ok', timeoutSec: null },
  )
  assert.equal(fresh.ok, true)
  assert.equal(preservationProblem({}, fresh.applied.doc, fresh.applied.changes), undefined)
})

test('F：setGroupMatcher / setHookTimeout 只动目标那一个键（其余逐字段相等）', () => {
  const doc = {
    _comment: 'keep me',
    hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ type: 'command', command: 'a', timeout: 30 }] }] },
  }
  const setMatcher = applied(doc, {
    op: 'setGroupMatcher',
    file: 'project',
    event: 'PreToolUse',
    groupIndex: 0,
    matcher: 'bash',
  })
  assert.equal(setMatcher.doc.hooks.PreToolUse[0].matcher, 'bash')
  assert.equal(setMatcher.doc.hooks.PreToolUse[0].hooks[0].command, 'a', '改 matcher 不许碰命令')
  assert.equal(setMatcher.doc._comment, 'keep me')
  assert.equal(preservationProblem(doc, setMatcher.doc, setMatcher.changes), undefined)

  // 清空 = **删键**（回到全匹配），不是写一个空字符串
  const cleared = applied(doc, {
    op: 'setGroupMatcher',
    file: 'project',
    event: 'PreToolUse',
    groupIndex: 0,
    matcher: null,
  })
  assert.equal('matcher' in cleared.doc.hooks.PreToolUse[0], false, 'null = 删掉这个键')
  assert.equal(preservationProblem(doc, cleared.doc, cleared.changes), undefined)

  const setTimeout2 = applied(doc, {
    op: 'setHookTimeout',
    file: 'project',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 0,
    timeoutSec: 5,
  })
  assert.equal(setTimeout2.doc.hooks.PreToolUse[0].hooks[0].timeout, 5)
  assert.equal(preservationProblem(doc, setTimeout2.doc, setTimeout2.changes), undefined)

  const backToDefault = applied(setTimeout2.doc, {
    op: 'setHookTimeout',
    file: 'project',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 0,
    timeoutSec: null,
  })
  assert.equal('timeout' in backToDefault.doc.hooks.PreToolUse[0].hooks[0], false, 'null = 删键回默认')
  assert.equal(preservationProblem(setTimeout2.doc, backToDefault.doc, backToDefault.changes), undefined)
})

test('F：moveHook 用 toIndex 交换（页面上相邻 ≠ 文件里相邻）；边界与原地都拒', () => {
  const doc = {
    hooks: {
      PreToolUse: [
        {
          hooks: [
            { type: 'command', command: 'a' },
            // 这一条解析时会被跳过（非 command）—— 于是页面上 a 与 b 相邻，文件里隔着它。
            { type: 'prompt', prompt: 'p' },
            { type: 'command', command: 'b' },
          ],
        },
      ],
    },
  }
  const moved = applied(doc, {
    op: 'moveHook',
    file: 'project',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 2,
    direction: -1,
    toIndex: 0,
  })
  assert.deepEqual(
    moved.doc.hooks.PreToolUse[0].hooks.map((hook) => hook.command ?? hook.type),
    ['b', 'prompt', 'a'],
    '★ 换的是 b 与 a（页面上那条邻居），不是与文件里紧邻的 prompt 条互换',
  )
  assert.equal(preservationProblem(doc, moved.doc, moved.changes), undefined)

  const outOfRange = applyOp(doc, {
    file: 'project',
    op: 'moveHook',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 2,
    direction: -1,
    toIndex: 9,
  })
  assert.equal(outOfRange.ok, false)
  assert.equal(outOfRange.reason, 'out-of-range')

  const same = applyOp(doc, {
    file: 'project',
    op: 'moveHook',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 1,
    direction: -1,
    toIndex: 1,
  })
  assert.equal(same.ok, false, '原地移动要说"到边界了"，不许静默什么都不做')
  assert.equal(same.reason, 'out-of-range')
})

test('F：removeGroup 删整组；addHook 追加到**已有组**末尾（不是新开一组）', () => {
  const doc = {
    hooks: {
      PreToolUse: [
        { matcher: 'a', hooks: [{ type: 'command', command: 'x' }] },
        { matcher: 'b', hooks: [{ type: 'command', command: 'y' }] },
      ],
    },
  }
  const removed = applied(doc, { op: 'removeGroup', file: 'project', event: 'PreToolUse', groupIndex: 0 })
  assert.equal(removed.doc.hooks.PreToolUse.length, 1)
  assert.equal(removed.doc.hooks.PreToolUse[0].hooks[0].command, 'y', '删的是第一组')
  assert.equal(preservationProblem(doc, removed.doc, removed.changes), undefined)

  const appended = applied(doc, {
    op: 'addHook',
    file: 'project',
    event: 'PreToolUse',
    groupIndex: 1,
    command: 'z',
    timeoutSec: 7,
  })
  assert.equal(appended.doc.hooks.PreToolUse.length, 2, '不许新开一组')
  assert.equal(appended.doc.hooks.PreToolUse[1].hooks.length, 2)
  assert.equal(appended.doc.hooks.PreToolUse[1].hooks[1].command, 'z')
  assert.equal(appended.doc.hooks.PreToolUse[1].hooks[1].timeout, 7)
  assert.equal(appended.doc.hooks.PreToolUse[1].matcher, 'b', '沿用那一组的匹配范围')
  assert.equal(preservationProblem(doc, appended.doc, appended.changes), undefined)
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
            resolve({
              exitCode: undefined,
              stdout: { text: stdout },
              stderr: { text: String(error && error.message ? error.message : error) },
            })
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
    return {
      targetKey: path.resolve((opts && opts.cwd) || process.cwd(), p),
      get displayPath() {
        return this.targetKey
      },
    }
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
    /**
     * 写盘：按官方 `FsWriteIntent` 语义**仿真守卫** —— `replaceIfVersion` 版本不符抛
     * `FS_STALE_VERSION`（与真实 provider 的精确错误码一致），`createIfAbsent` 目标已存在抛错。
     * 这样"乐观锁真的传了、过期真的被拒"可以被离线断言，而不是靠线上试。
     */
    async writeText(target, content, expected) {
      if (options.writes) options.writes.push({ path: target.displayPath, content, expected })
      if (expected && expected.kind === 'replaceIfVersion') {
        const info = await fsImpl.stat(target)
        if (info === undefined || info.version !== expected.version) {
          throw new Error(`FS_STALE_VERSION: 期望 ${expected.version}，实际 ${String(info && info.version)}`)
        }
      }
      if (expected && expected.kind === 'createIfAbsent' && fs.existsSync(target.displayPath)) {
        throw new Error('FS_EXISTS: 目标已存在')
      }
      // 真实 provider 的 `writeFileAtomic` 里有 `mkdir(dirname, { recursive: true })`（已核实 asar 源码），
      // 父目录会被自动创建。假 fs 必须同样做到 —— 否则"新建项目级配置"会在自检里假失败。
      await fsp.mkdir(path.dirname(target.displayPath), { recursive: true })
      await fsp.writeFile(target.displayPath, content, 'utf8')
      return {
        operation: expected && expected.kind === 'createIfAbsent' ? 'create' : 'update',
        version: 'v-written',
        before: null,
        after: content,
      }
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
    /**
     * 声明式依赖：等服务就绪后再跑回调。
     *
     * **假 ctx 故意不把服务挂在属性上** —— 真实 Cordis 里服务是**渐进可用**的，`apply()` 时刻
     * 读 `ctx.connection` 很可能还是 `undefined`。这正是线上实测踩到的坑（界面活了、
     * `/api/hooks` 却是 web 服务器的 "not found"）：宿主半边当时写的是
     * `if (ctx.connection !== undefined)`，于是整条路由被**静默跳过**，而自检全绿 —— 因为
     * 假 ctx 把服务挂在属性上了。现在只经 inject 交付，"直接读属性"的写法在自检里就会红。
     */
    inject(deps, callback) {
      if (deps.includes('connection') && options.connection !== undefined) {
        callback({ connection: options.connection })
      }
      return () => {}
    },
    get(service) {
      if (service === 'agents') {
        return { get: (id) => agents.get(id), currentInitiator: () => options.initiator }
      }
      if (service === 'sandboxPolicy') return options.sandboxPolicy
      // 工作区清单：**默认缺席**（服务渐进可用，真实宿主上也可能还没加载）——
      // 于是"宿主没有提供工作区清单"这条降级路径默认就被覆盖到，而不是只靠显式构造。
      if (service === 'workspaceRegistry') return options.workspaceRegistry
      return undefined
    },
  }
  return { ctx, listeners, logs, disposers, agents }
}

/** 捕获 `connection.fetch.register()` 的路由声明，并给出一个能直接调用 handler 的入口。 */
function makeConnection() {
  const routes = []
  const connection = {
    fetch: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
  }
  const get = (request) => routes[0].fetch(request)
  /** 用绝对 URL 造请求：`dsh-skill-manager` 记过相对路径会 `Failed to parse URL`。 */
  const request = (query = '') => new Request(`http://127.0.0.1/api/hooks${query}`, { method: 'GET' })
  return { routes, connection, get, request }
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
  const decision = await h.listeners.get('tools/pre-execute')[0](
    { name: 'pwsh', arguments: {}, callId: 'c', agent },
    nextAllow,
  )
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
  const decision = await h.listeners.get('tools/pre-execute')[0](
    { name: 'anything', arguments: {}, callId: 'c', agent },
    nextAllow,
  )
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
    {
      agent,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      turn: 1,
      step: 1,
      signal: undefined,
    },
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
    {
      agent,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      turn: 1,
      step: 1,
      signal: undefined,
    },
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
  const s = await script(
    dir,
    'stop.mjs',
    `process.stdout.write(JSON.stringify({decision:'block',reason:'keep going'}))`,
  )
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
  const decision = await h.listeners.get('tools/pre-execute')[0](
    { name: 'pwsh', arguments: {}, callId: 'c', agent },
    nextAllow,
  )
  assert.deepEqual(decision, { kind: 'allow' })
  assert.equal(h.logs.filter((entry) => entry.level === 'warn').length, 0)
})

await test('集成：projectRoot 是最近的含 .git 祖先，子目录会话也命中项目配置', async () => {
  const dir = await makeProject('packages/app/src')
  const s = await script(dir, 'root.mjs', `process.stderr.write('from project root');process.exit(2)`)
  await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(path.join(dir, 'packages', 'app', 'src'))
  const h = await mount()
  const decision = await h.listeners.get('tools/pre-execute')[0](
    { name: 'any', arguments: {}, callId: 'c', agent },
    nextAllow,
  )
  assert.equal(decision.kind, 'deny')
  assert.equal(decision.reason, 'from project root')
})

await test('集成：hook 命令不存在时非阻断', async () => {
  const dir = await makeProject()
  await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: 'definitely-not-a-real-command-xyz-123' }] }] } })
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const decision = await h.listeners.get('tools/pre-execute')[0](
    { name: 'any', arguments: {}, callId: 'c', agent },
    nextAllow,
  )
  assert.deepEqual(decision, { kind: 'allow' })
})

await test('集成：hook 超时是非阻断且快速返回', async () => {
  const dir = await makeProject()
  const s = await script(dir, 'slow.mjs', 'setTimeout(()=>{},30000)')
  await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ timeout: 1, command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const started = Date.now()
  const decision = await h.listeners.get('tools/pre-execute')[0](
    { name: 'any', arguments: {}, callId: 'c', agent },
    nextAllow,
  )
  assert.deepEqual(decision, { kind: 'allow' })
  assert.ok(Date.now() - started < 20000, '超时应当很快返回')
})

await test('集成：Stop 的 stop_hook_active 说真话（第一次 false，续跑之后 true）', async () => {
  const dir = await makeProject()
  const flags = path.join(dir, 'stop-flags.txt')
  const s = await script(
    dir,
    'stopflag.mjs',
    // ⚠️ .mjs 里**没有** `require`（那是 CommonJS）—— 用 import 语句，别抄模板里的 `node -e` 写法。
    [
      "import { appendFileSync } from 'node:fs'",
      "let stdin = ''",
      "process.stdin.on('data', (chunk) => { stdin += chunk }).on('end', () => {",
      '  const payload = JSON.parse(stdin)',
      `  appendFileSync(${JSON.stringify(flags)}, String(payload.stop_hook_active) + '\\n')`,
      "  process.stdout.write(JSON.stringify({ decision: 'block', reason: 'again' }))",
      '})',
    ].join('\n'),
  )
  await writeHooks(dir, { hooks: { Stop: [{ hooks: [{ command: cmd(s) }] }] } })
  const { agent } = fakeAgent(dir)
  const h = await mount()
  const handler = h.listeners.get('agent/turn-stopping')[0]
  for (let i = 0; i < 3; i++) await handler({ agent, turn: i + 1, signal: undefined })

  // ★ 官方语义：`stop_hook_active` = "这一轮已经被 Stop hook 续跑过"。
  // 以前它恒为 false —— 按官方语义写的防死循环逻辑（看到 true 就放行）在我们这里永远不触发。
  const seen = fs.readFileSync(flags, 'utf8').trim().split('\n')
  assert.deepEqual(seen, ['false', 'true', 'true'], `hook 实际收到的值：${JSON.stringify(seen)}`)
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
    const decision = await h.listeners.get('tools/pre-execute')[0](
      { name: 'any', arguments: {}, callId: 'c', agent },
      nextAllow,
    )
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
  const decision = await h.listeners.get('tools/pre-execute')[0](
    { name: 'any', arguments: {}, callId: 'c', agent },
    nextAllow,
  )
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
      assert.ok(
        watchWarns().some((e) => e.message.includes(p)),
        `warn 文案里应带路径：${p}`,
      )
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

await test('fail-open：只有坏掉的那一侧回退 —— 另一侧的新改动必须照常生效', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const guard = await script(dir, 'guard.mjs', `process.stderr.write('project guard');process.exit(2)`)
    const stopV1 = await script(
      dir,
      'stop-v1.mjs',
      `process.stdout.write(JSON.stringify({decision:'block',reason:'v1'}))`,
    )
    const stopV2 = await script(
      dir,
      'stop-v2.mjs',
      `process.stdout.write(JSON.stringify({decision:'block',reason:'v2'}))`,
    )
    // 项目级：一条 PreToolUse 守卫（坏掉之后必须仍然从 last-good 拦住）。
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(guard) }] }] } })
    // 用户级：一条 Stop（稍后改成 v2 —— 它必须**不受**项目级坏掉的影响）。
    const userFile = path.join(process.env.DSH_HOME, 'hooks.json')
    await fsp.writeFile(
      userFile,
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: cmd(stopV1) }] }] } }),
      'utf8',
    )

    const { agent, steered } = fakeAgent(dir)
    const { h, invalidate } = await mountCaptured()

    // 基线：两侧都读到（这一次会写下 last-good）。
    await h.listeners.get('tools/pre-execute')[0]({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)
    await h.listeners.get('agent/turn-stopping')[0]({ agent, turn: 1, signal: undefined })
    assert.equal(steered[0].content[0].text, 'v1', '基线：用户级 Stop 是 v1')

    // 现在：项目级写坏，同时用户级改成 v2。
    await fsp.writeFile(path.join(dir, '.dsh', 'hooks.json'), '{"hooks": {"PreToolUse": [', 'utf8')
    await fsp.writeFile(
      userFile,
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: cmd(stopV2) }] }] } }),
      'utf8',
    )
    invalidate()

    // ① 坏掉的那一侧照旧拦住（last-good）
    const denied = await h.listeners.get('tools/pre-execute')[0](
      { name: 'pwsh', arguments: {}, callId: 'c2', agent },
      nextAllow,
    )
    assert.equal(denied.kind, 'deny', '坏掉的项目级必须继续沿用 last-good —— 守卫不许消失')
    assert.equal(denied.reason, 'project guard')

    // ② 好着的那一侧**用新的**（这正是 11 票要修的：以前会被连带回退成 v1）
    steered.length = 0
    await h.listeners.get('agent/turn-stopping')[0]({ agent, turn: 2, signal: undefined })
    assert.equal(steered[0].content[0].text, 'v2', '★ 项目级坏掉不该连累用户级：用户级刚改的 v2 必须生效')

    // ③ 两侧都坏 ⇒ 两侧**都**回退到各自的 last-good（这条兜底路径也必须被断言，
    //    否则"按侧回退"可能悄悄退化成"哪侧都不回退"）。
    await fsp.writeFile(userFile, '{"hooks": {', 'utf8')
    await fsp.writeFile(path.join(dir, '.dsh', 'hooks.json'), '{"hooks": {', 'utf8')
    invalidate()
    const bothBroken = await h.listeners.get('tools/pre-execute')[0](
      { name: 'pwsh', arguments: {}, callId: 'c3', agent },
      nextAllow,
    )
    assert.equal(bothBroken.kind, 'deny', '两侧都坏时，项目级的守卫仍然来自 last-good')
    assert.equal(bothBroken.reason, 'project guard')
    steered.length = 0
    await h.listeners.get('agent/turn-stopping')[0]({ agent, turn: 3, signal: undefined })
    assert.equal(
      steered[0]?.content[0].text,
      'v1',
      '★ 两侧都坏时用户级也回到它自己的 last-good（v1）—— 不许变成"一条都没有"',
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
  const decision = await h.listeners.get('tools/pre-execute')[0](
    { name: 'any', arguments: {}, callId: 'c', agent },
    nextAllow,
  )

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
  const decision = await h.listeners.get('tools/pre-execute')[0](
    { name: 'any', arguments: {}, callId: 'c', agent },
    nextAllow,
  )
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
  const decision = await h.listeners.get('tools/pre-execute')[0](
    { name: 'any', arguments: {}, callId: 'c', agent },
    nextAllow,
  )
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
  const sandboxPolicy = {
    resolve: (request) => ({
      mode: 'danger-full-access',
      workspaceRoot: dir,
      byChild: request.session === child.session,
    }),
  }
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

//#region P. 数据面 /api/hooks（只读快照）

// 全部离线：注册契约靠捕获 `connection.fetch.register()`，handler 行为靠**直接用 Request
// 调 handler**（与 dsh-skill-manager 的自检同款）—— 不需要浏览器，也不需要重启 DSH。

/** 取响应并**先补空形状**：失败响应没有 `data`，直接解引用会在第一处崩掉（AGENTS §4.4）。 */
async function callRoute(route, query = '') {
  const response = await route.fetch(new Request(`http://127.0.0.1/api/hooks${query}`, { method: 'GET' }))
  const body = await response.json()
  const emptyData = {
    route: '',
    projectRoot: null,
    cwd: null,
    cwdSource: 'none',
    scope: scopeView({ kind: 'user', requested: 'current', projectRoot: null, isCurrentSession: null }),
    workspaces: [],
    workspacesAvailable: false,
    session: null,
    files: [],
    events: [],
    total: { hookCount: 0, disabledCount: 0, groupCount: 0 },
    staleInUse: false,
    capabilities: { writable: false },
  }
  const data = body !== null && typeof body === 'object' && body.data ? body.data : emptyData
  return { status: response.status, body, data }
}

/**
 * 造一个作用域回显（`HooksSnapshot.scope`）。
 *
 * 缺省是"当前会话的项目"这一形态；测 `scope=user` / 别的 `workspace` 时用 overrides 覆盖。
 */
function scopeView(overrides = {}) {
  return {
    kind: 'workspace',
    requested: 'current',
    workspaceId: null,
    workspaceTitle: null,
    workspacePath: null,
    projectRoot: '/p',
    isCurrentSession: true,
    ...overrides,
  }
}

/**
 * 造一个"当前会话实际会跑什么"的条数视图（`HooksSnapshot.session`）。
 *
 * **三态**：`projectRoot` 拿不到时整块应当是 `null`（见 `sessionlessSnapshot`），
 * 所以这个 helper 只造"已知"那一态。
 */
function sessionEffect(overrides = {}) {
  return {
    projectRoot: '/p',
    hookCount: 1,
    disabledCount: 0,
    groupCount: 1,
    fromUser: 0,
    fromProject: 1,
    staleInUse: false,
    ...overrides,
  }
}

/** POST 一个定点操作（走真实 handler，不碰浏览器）。 */
async function postRoute(route, payload) {
  const response = await route.fetch(
    new Request('http://127.0.0.1/api/hooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  const body = await response.json()
  const data = body !== null && typeof body === 'object' && body.data ? body.data : {}
  return { status: response.status, body, data }
}

/** POST 一个**原始** body 字符串（测非 JSON 的请求体）。 */
async function postRaw(route, raw) {
  const response = await route.fetch(
    new Request('http://127.0.0.1/api/hooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    }),
  )
  return { status: response.status, body: await response.json() }
}

/** 造一个空的检视结果（纯函数测试用）。 */
function emptyInspection(overrides = {}) {
  return {
    projectRoot: '/p',
    cwd: '/p',
    cwdSource: 'session',
    scope: scopeView(),
    workspaces: [],
    workspacesAvailable: false,
    session: sessionEffect(),
    sources: [],
    effective: {},
    effectiveUserGroups: {},
    effectiveProjectGroups: {},
    staleInUse: false,
    writable: false,
    ledger: [],
    ...overrides,
  }
}

/** 造一个来源检视结果。 */
function sourceInspection(kind, groups, overrides = {}) {
  return {
    kind,
    path: kind === 'project' ? '/p/.dsh/hooks.json' : '/home/hooks.json',
    state: 'ok',
    message: null,
    version: 'v1',
    groups,
    skipped: [],
    rejected: [],
    matcherErrors: [],
    ...overrides,
  }
}

await test('P：路由注册契约（路径以 /api/ 开头、GET+POST、buffered）', async () => {
  const conn = makeConnection()
  await mount({ connection: conn.connection })
  assert.equal(conn.routes.length, 1, '应当恰好注册一条路由')
  const route = conn.routes[0]
  assert.equal(route.path, '/api/hooks')
  assert.ok(
    route.path.startsWith('/api/'),
    'connection.fetch 要求路径以 /api/ 开头，否则拿不到 Host/Origin 围栏与浏览器鉴权',
  )
  assert.deepEqual(route.methods, ['GET', 'POST'], '读快照 + 定点写都挂在这一条路由上')
  assert.equal(route.requestBody, 'buffered', '必须在 bridge 读字节之前声明请求体处理方式')
  assert.equal(typeof route.fetch, 'function')
})

await test('P：路由字面量与共享常量逐字一致，且原样出现在两份产物里', () => {
  assert.equal(HOOKS_ROUTE, '/api/hooks')
  const host = fs.readFileSync(LIB, 'utf8')
  assert.ok(host.includes(`"${HOOKS_ROUTE}"`), '宿主产物里应当出现与共享常量一致的路由字面量')
  // 两条产物的路由**必须逐字一致** —— 不一致就是静默 404（AGENTS §2.12）。
  const client = fs.readFileSync(CLIENT, 'utf8')
  assert.ok(client.includes(`"${HOOKS_ROUTE}"`), '客户端产物里必须是**同一个**字面量（不一致就是静默 404）')
})

await test('P：connection 只经 inject 交付 —— 直接读属性会静默丢掉整条路由（线上实测踩过）', async () => {
  // ① 服务缺席（shell 载体）：插件照常激活、事件照常接线，只是数据面不注册。
  const withoutConnection = await mount({})
  assert.equal(
    withoutConnection.listeners.get('tools/pre-execute').length,
    1,
    '数据面是便利设施，不是硬依赖：没有 connection 也必须照常接线',
  )

  // ② 假 ctx **刻意不把服务挂在属性上**：真实 Cordis 的服务是渐进可用的，apply 时刻读
  //    `ctx.connection` 很可能还是 undefined。宿主半边曾写 `if (ctx.connection !== undefined)`，
  //    于是路由被静默跳过 —— 页面拿到 web 服务器的纯文本 "not found"，而自检全绿。
  const conn = makeConnection()
  const { ctx } = makeCtx({ connection: conn.connection })
  assert.equal(
    ctx.connection,
    undefined,
    '假 ctx 不许把服务挂在属性上：那样"直接读属性"的写法会在自检里假绿（这正是线上的坑）',
  )
  let delivered = null
  ctx.inject(['connection'], (scope) => {
    delivered = scope.connection
  })
  assert.ok(delivered !== null, 'inject 必须把服务交给回调 —— 这是可选服务的唯一正确访问方式')

  // ③ 走完整挂载后，路由必须真的注册上（这条断言现在会抓住"直接读属性"的写法）。
  const mounted = await mount({ connection: conn.connection })
  assert.equal(conn.routes.length, 1, '服务就绪后必须注册 /api/hooks')
  assert.equal(mounted.listeners.get('tools/pre-execute').length, 1, '事件接线不受数据面影响')
})

await test('P：快照恒为 7 个事件（含 0 条），顺序即事件表顺序', () => {
  const snapshot = buildSnapshot(emptyInspection())
  assert.equal(snapshot.events.length, 7, '7 个事件分组必须全部渲染，含 0 条')
  assert.deepEqual(
    snapshot.events.map((event) => event.event),
    [...HOOK_EVENTS],
    '顺序必须与事件表一致（不是按有无内容排序）',
  )
  assert.ok(
    snapshot.events.every((event) => event.hookCount === 0 && event.groups.length === 0),
    '没有配置时每个事件都应当是 0 条、0 组',
  )
  assert.deepEqual(snapshot.total, { hookCount: 0, disabledCount: 0, groupCount: 0, unrunnable: 0 })
})

await test('P：快照把 disabled 单独计数（不许把"已停用"算成"在跑"）', () => {
  const groups = {
    PreToolUse: [
      {
        matcher: 'pwsh',
        hooks: [{ command: 'a' }, { command: 'b', disabled: true }],
      },
    ],
  }
  const snapshot = buildSnapshot(emptyInspection({ effective: groups }))
  const pre = snapshot.events.find((event) => event.event === 'PreToolUse')
  assert.equal(pre.hookCount, 1, '生效条数必须**不含**已停用的那条')
  assert.equal(pre.disabledCount, 1, '停用条数单独计数')
  assert.equal(snapshot.total.disabledCount, 1)
  assert.equal(pre.groups[0].hooks.length, 2, '页面仍要能看见停用的那条（否则没法重新启用）')
  assert.equal(pre.groups[0].hooks[1].disabled, true)
  assert.equal(pre.groups[0].hooks[0].disabled, false)
  assert.equal(pre.groups[0].hooks[0].defaultTimeoutSec, 600, '未写 timeout 时要告诉页面默认值')
  assert.equal(pre.groups[0].hooks[0].timeoutSec, null, '未写就是 null，不要编一个数字')
})

await test('P：非法 matcher 走**真解析器** → rejected 非空、可运行集合为空（页面据此说清为什么）', () => {
  // ⚠️ 这条以前喂的是**手工构造的 ParsedGroups**，而真实链路上 `parseHookConfig` 会把非法 matcher 的
  // 组直接丢掉 —— 于是断言永远是绿的，页面却什么也看不到（"平凡通过的断言"）。现在从**文件内容**出发。
  const raw = { hooks: { PreToolUse: [{ matcher: '(', hooks: [{ type: 'command', command: 'a' }] }] } }
  const parsed = parseHookConfig(raw)
  assert.deepEqual(parsed.groups, {}, '非法 matcher 的组照旧**不执行**（执行语义一字不改）')
  assert.equal(parsed.rejected.length, 1, '但它必须被**记下来** —— 否则页面上这几条就是"凭空消失"')
  assert.equal(parsed.rejected[0].reason, 'invalid-matcher')
  assert.equal(parsed.rejected[0].groupIndex, 0, '要带**文件下标**，页面才能定位到它')
  assert.equal(parsed.rejected[0].hookCount, 1)

  const snapshot = buildSnapshot(
    emptyInspection({
      sources: [sourceInspection('project', parsed.groups, { rejected: parsed.rejected, skipped: parsed.skipped })],
    }),
  )
  const project = snapshot.files.find((file) => file.kind === 'project')
  assert.equal(project.rejected.length, 1, '快照必须把"跑不了的那一组"带给页面')
  assert.equal(project.rejected[0].reason, 'invalid-matcher')
  assert.equal(project.unrunnable, 1, '页面要能说"文件里有 N 条，其中 M 条跑不了"')
  assert.equal(project.hookCount, 0, '可运行条数仍然是 0（不许把跑不了的算进去）')
})

await test('P：文件里有内容但一条都跑不了 ⇒ 快照说得出条数与原因（不是"0 条"）', () => {
  // 真机形态：别人写的 hooks.json 全是 `type: "prompt"`，外加一组 matcher 打错的正则。
  const raw = {
    hooks: {
      PreToolUse: [
        { hooks: [{ type: 'prompt', prompt: 'x' }] },
        { matcher: '(', hooks: [{ type: 'command', command: 'y' }] },
      ],
      Stop: [{ hooks: [] }],
    },
  }
  const parsed = parseHookConfig(raw)
  assert.deepEqual(parsed.groups, {}, '一条能跑的都没有（只跑 command）')
  assert.equal(parsed.skipped.length, 1, '非 command handler 要被记下（带下标与原因）')
  assert.equal(parsed.skipped[0].groupIndex, 0)
  assert.equal(parsed.skipped[0].reason, 'unsupported-type')
  assert.equal(parsed.rejected.length, 3, '只有不支持类型的一组 + 非法 matcher 一组 + 空组一组')
  assert.deepEqual(
    parsed.rejected.map((one) => one.reason).sort(),
    ['invalid-matcher', 'no-command', 'unsupported-type'],
    '三种原因都要能分别说清（复查时补上的那条：全是 prompt 的组以前一条记录都不留）',
  )
  // ★ `unsupported-type` 那一组的 hookCount 必须是 0：它的条目已经在 skipped 里计过，
  //   再算一次就会把"跑不了 3 条"说成"跑不了 5 条"。
  assert.equal(
    parsed.rejected.find((one) => one.reason === 'unsupported-type').hookCount,
    0,
    '不支持类型的组不许重复计数（那一条在 skipped 里）',
  )

  const snapshot = buildSnapshot(
    emptyInspection({
      sources: [sourceInspection('project', parsed.groups, { rejected: parsed.rejected, skipped: parsed.skipped })],
    }),
  )
  const project = snapshot.files.find((file) => file.kind === 'project')
  assert.equal(project.hookCount, 0)
  assert.ok(project.unrunnable >= 2, '跑不了的条数必须可数（页面据此说"3 条里 3 条跑不了"）')
  assert.deepEqual(
    snapshot.total.unrunnable,
    project.unrunnable,
    '顶层口径与文件口径必须同源（否则页面两处数字会打架）',
  )
})

await test('P：GET 正常路径 —— 两个来源、合并条数、只读能力位', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    await writeHooks(dir, {
      hooks: {
        PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: 'p1' }, { command: 'p2', timeout: 30 }] }],
        Stop: [{ hooks: [{ command: 'p3' }] }],
      },
    })
    await fsp.writeFile(
      path.join(process.env.DSH_HOME, 'hooks.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: 'u1' }] }] } }),
      'utf8',
    )
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: makeFs(), initiator: agent })

    const { status, body, data } = await callRoute(conn.routes[0])
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(data.route, '/api/hooks')
    assert.equal(data.files.length, 2, '两个来源永远都列')
    assert.deepEqual(
      data.files.map((file) => file.kind),
      ['project', 'user'],
    )
    assert.ok(
      data.files.every((file) => file.state === 'ok'),
      '两份文件都合法时状态应当是 ok',
    )
    assert.equal(data.total.hookCount, 4, '项目级 3 条 + 用户级 1 条（PreToolUse 生效必合并）')
    const pre = data.events.find((event) => event.event === 'PreToolUse')
    assert.equal(pre.hookCount, 3, 'PreToolUse：项目级 2 + 用户级 1')
    assert.equal(pre.fromProject, 2)
    assert.equal(pre.fromUser, 1)
    // 快照里的组顺序 = **生效顺序**：用户级在前、项目级在后（合并语义，不是展示顺序）。
    assert.equal(pre.groups.length, 2, '两个来源的 PreToolUse 组都要在')
    assert.equal(pre.groups[0].hooks[0].command, 'u1', '用户级在前 —— 顺序即执行顺序')
    assert.equal(pre.groups[1].hooks[0].command, 'p1', '项目级在后')
    assert.equal(pre.groups[1].hooks[1].timeoutSec, 30, '文件里的 timeout 要带出来（第 2 条才是写了 timeout 的那条）')
    assert.equal(pre.groups[1].hooks[0].timeoutSec, null, '没写 timeout 就该是 null，不要编一个数字')
    assert.equal(data.capabilities.writable, true, 'POST 已注册：页面应当显示可编辑')
    assert.equal(data.staleInUse, false)
  })
})

await test('P：GET —— 文件不存在是 absent（合法的空配置），不是 error', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: makeFs(), initiator: agent })
    const { data } = await callRoute(conn.routes[0])
    assert.deepEqual(
      data.files.map((file) => file.state),
      ['absent', 'absent'],
      'ENOENT 是"这份配置是空的"，绝不能被当成"读坏了"',
    )
    assert.ok(
      data.files.every((file) => file.message === null),
      'absent 不该带有错误文案',
    )
    assert.equal(data.events.length, 7, '没有配置时 7 个事件仍然全列（否则用户以为功能没做）')
  })
})

await test('P：GET —— 文件写坏时如实报 error，同时说清"运行中的还是上一份可用配置"', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const s = await script(dir, 'p.mjs', `process.exit(0)`)
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(s) }] }] } })
    const conn = makeConnection()
    const captured = []
    const { agent } = fakeAgent(dir)
    const h = await mount({ connection: conn.connection, fs: makeFs({ watch: 'capture', captured }), initiator: agent })

    // 先成功加载一次（写入 last-good），再写坏并强制失效 —— 与 fail-open 区同一套路。
    const handler = h.listeners.get('tools/pre-execute')[0]
    await handler({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)
    const projectFile = path.join(dir, '.dsh', 'hooks.json')
    await fsp.writeFile(projectFile, '{"hooks": {', 'utf8')
    for (const { changed } of captured) changed()
    await handler({ name: 'pwsh', arguments: {}, callId: 'c2', agent }, nextAllow)

    const { data } = await callRoute(conn.routes[0])
    const project = data.files.find((file) => file.kind === 'project')
    assert.equal(project.state, 'error', '磁盘此刻读不出来 → 如实报 error')
    assert.ok(typeof project.message === 'string' && project.message.length > 0, 'error 要带技术原文（放详情位）')
    assert.equal(data.staleInUse, true, '生效配置是 last-good 兜底，必须让用户知道')
    const pre = data.events.find((event) => event.event === 'PreToolUse')
    assert.equal(pre.hookCount, 1, '运行中的 hook 仍然在跑，页面必须照样显示它们')
    assert.equal(data.events.length, 7)
  })
})

await test('P：stale（沿用上一份可用配置）时来源条数必须自洽 —— 不许 0 + 0 对不上 hookCount', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const s = await script(dir, 'p.mjs', 'process.exit(0)')
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(s) }] }] } })
    await fsp.writeFile(
      path.join(process.env.DSH_HOME, 'hooks.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: 'u1' }] }] } }),
      'utf8',
    )
    const conn = makeConnection()
    const captured = []
    const { agent } = fakeAgent(dir)
    const h = await mount({
      connection: conn.connection,
      fs: makeFs({ version: true, watch: 'capture', captured }),
      initiator: agent,
    })

    // 先成功加载一次（写入 last-good），再把项目级文件写坏 → 运行中的仍是上一份可用配置。
    await h.listeners.get('tools/pre-execute')[0]({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)
    await fsp.writeFile(path.join(dir, '.dsh', 'hooks.json'), '{"hooks": {', 'utf8')
    for (const { changed } of captured) changed()

    const { data } = await callRoute(conn.routes[0])
    assert.equal(data.staleInUse, true)
    const pre = data.events.find((event) => event.event === 'PreToolUse')
    assert.equal(pre.hookCount, 2, '运行中的是上一份可用配置：用户级 1 + 项目级 1')
    assert.equal(pre.fromUser, 1)
    assert.equal(
      pre.fromProject,
      1,
      '**stale 时 fromProject 也不许是 0**：用"新鲜读"会得到 0，而 hookCount 是 2 —— 页面会显示' +
        '"生效 2 条（用户级 0 + 项目级 0）"，与它上面那条 stale 横幅直接打架',
    )
    // 不变式：每事件 + 总计都要 fromUser + fromProject === hookCount
    for (const view of data.events) {
      assert.equal(view.fromUser + view.fromProject, view.hookCount, `${view.event} 的来源条数必须自洽`)
    }
    assert.equal(
      data.events.reduce((sum, view) => sum + view.fromUser + view.fromProject, 0),
      data.total.hookCount,
      '总计也必须自洽',
    )
    // 会话生效口径（D3 那一行）同理：自洽，且不是 0 + 0
    assert.notEqual(data.session, null)
    assert.equal(data.session.fromUser + data.session.fromProject, data.session.hookCount)
    assert.equal(data.session.hookCount, 2)
    assert.equal(data.session.fromProject, 1)
    assert.equal(data.session.staleInUse, true)
    // 而 `files[]` **仍然**用新鲜读：那份文件此刻确实是坏的（与"运行中的条数"是两件事，都要说清）
    const project = data.files.find((file) => file.kind === 'project')
    assert.equal(project.state, 'error')
    assert.equal(project.hookCount, 0, 'files[] = 这份文件此刻长什么样（读不出来 → error + 0 条）')
  })
})

await test('P：GET —— 没有会话上下文时只列用户级，绝不编造项目路径', async () => {
  await withIsolatedHome(async () => {
    const conn = makeConnection()
    // 不传 initiator、agents 也取不到 → cwd 未知。
    await mount({ connection: conn.connection, fs: makeFs() })
    const { status, data } = await callRoute(conn.routes[0])
    assert.equal(status, 200, '这不是错误：用户级配置仍然是有意义的')
    assert.equal(data.cwd, null)
    assert.equal(data.cwdSource, 'none')
    assert.equal(data.projectRoot, null, '不知道项目就是不填，不许拿 process.cwd() 顶上')
    assert.deepEqual(
      data.files.map((file) => file.kind),
      ['user'],
      '只列用户级',
    )
    assert.equal(data.events.length, 7, '即使没有项目，7 个事件也要全列')
    assert.equal(
      data.session,
      null,
      '**三态**：当前会话未知 ⇒ `session` 整块 null（一个数字都不编）—— 页面必须说"当前会话未知"，' +
        '绝不许显示"当前会话生效 0 条"（读不到 ≠ 没有，AGENTS §2.8/§2.9）',
    )
  })
})

await test('P：GET —— 会话 cwd 来自 initiator（并如实标注来源）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject('sub')
    const conn = makeConnection()
    const { agent } = fakeAgent(path.join(dir, 'sub'))
    await mount({ connection: conn.connection, fs: makeFs(), initiator: agent })
    const { data } = await callRoute(conn.routes[0])
    assert.equal(data.cwdSource, 'initiator')
    assert.equal(data.projectRoot, dir, 'projectRoot 应当是最近的含 .git 祖先')
  })
})

await test('P：disabled 的 hook 真的不跑（不只是界面显示）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const running = path.join(dir, 'ran-enabled.txt')
    const skipped = path.join(dir, 'ran-disabled.txt')
    const s1 = await script(dir, 'enabled.cjs', `require('fs').writeFileSync(${JSON.stringify(running)}, 'x')`)
    const s2 = await script(dir, 'disabled.cjs', `require('fs').writeFileSync(${JSON.stringify(skipped)}, 'x')`)
    await writeHooks(dir, {
      hooks: {
        PreToolUse: [
          {
            matcher: 'pwsh',
            hooks: [{ command: cmd(s1) }, { command: cmd(s2), disabled: true }],
          },
        ],
      },
    })
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    const h = await mount({ connection: conn.connection, fs: makeFs(), initiator: agent })
    await h.listeners.get('tools/pre-execute')[0]({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)

    assert.equal(fs.existsSync(running), true, '启用的那条必须跑')
    assert.equal(
      fs.existsSync(skipped),
      false,
      'disabled 的那条**绝不能**跑 —— 否则就是"UI 显示已停用、实际照跑"（AGENTS §2.5）',
    )
    const { data } = await callRoute(conn.routes[0])
    const pre = data.events.find((event) => event.event === 'PreToolUse')
    assert.equal(pre.hookCount, 1)
    assert.equal(pre.disabledCount, 1)
  })
})

await test('P：handler 抛错 → 500 信封，且**没有 data**（错误契约）', async () => {
  const conn = makeConnection()
  registerHooksRoute(conn.connection, {
    inspect: async () => {
      throw new Error('boom')
    },
    write: async () => ({ ok: false, error: 'write-failed' }),
  })
  const { status, body, data } = await callRoute(conn.routes[0])
  assert.equal(status, 500)
  assert.equal(body.ok, false)
  assert.equal(body.error, 'internal')
  assert.equal(body.detail, 'boom', '技术原文放 detail，页面主文案自己措辞')
  assert.equal(body.data, undefined, '失败响应不该有 data')
  assert.deepEqual(data.events, [], '补空形状之后仍然可断言，而不是崩在第一处解引用')
})

//#endregion

//#region P5–P9. 作用域（`scope` / `workspaceId`）—— 只读快照的读路径
//   §8 的 P5–P9。搞错这一层就会"看着 A 项目、改到 B 项目"，所以每条都先红后绿。

/** 造一个假 `workspaceRegistry`（形状与官方 `dsh-workspace` 的记录对齐：id / path / title）。 */
function fakeRegistry(records, overrides = {}) {
  return {
    list: () => records,
    get: (id) => records.find((record) => record.id === id),
    ...overrides,
  }
}

await test('P：scope=user ⇒ 只列用户级；events 恒 7 项且等于用户级合并；会话生效视图仍如实给', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: 'p1' }] }] } })
    await fsp.writeFile(
      path.join(process.env.DSH_HOME, 'hooks.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: 'u1' }] }] } }),
      'utf8',
    )
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: makeFs({ version: true }), initiator: agent })

    const { status, data } = await callRoute(conn.routes[0], '?scope=user')
    assert.equal(status, 200)
    assert.deepEqual(
      data.files.map((file) => file.kind),
      ['user'],
      'scope=user 时只有用户级一份（项目级不在这个作用域里）',
    )
    assert.equal(data.files[0].path, path.join(process.env.DSH_HOME, 'hooks.json'))
    assert.equal(data.scope.kind, 'user')
    assert.equal(data.scope.requested, 'user')
    assert.equal(data.scope.projectRoot, null, '用户级作用域不绑任何项目 → projectRoot 必须是 null（不编造）')
    assert.equal(data.scope.workspaceId, null)
    assert.equal(data.events.length, 7, '7 个事件永远全列（含 0 条）')
    const pre = data.events.find((event) => event.event === 'PreToolUse')
    assert.equal(pre.hookCount, 1)
    assert.equal(pre.fromProject, 0, 'scope=user 的生效视图里没有项目级贡献')
    assert.equal(pre.groups[0].hooks[0].command, 'u1')

    // §2.6：作用域回答"我在改哪份文件"，`session` 回答"当前会话实际会跑什么" —— 两者都必须给。
    assert.equal(data.session.hookCount, 2, '会话生效 = 用户级 1 + 项目级 1（与所选作用域无关）')
    assert.equal(data.session.fromUser, 1)
    assert.equal(data.session.fromProject, 1)
    assert.equal(data.session.projectRoot, dir)
  })
})

await test('P：scope=workspace ⇒ 读 root(X)/.dsh/hooks.json；scope 三项各自正确、互不代替', async () => {
  await withIsolatedHome(async () => {
    const session = await makeProject('inner')
    const other = await makeProject('sub')
    await writeHooks(other, { hooks: { PreToolUse: [{ hooks: [{ command: 'other-1' }] }] } })
    await fsp.writeFile(
      path.join(process.env.DSH_HOME, 'hooks.json'),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'u1' }] }] } }),
      'utf8',
    )
    const conn = makeConnection()
    const { agent } = fakeAgent(session)
    await mount({
      connection: conn.connection,
      fs: makeFs({ version: true }),
      initiator: agent,
      workspaceRegistry: fakeRegistry([
        { id: 'w-other', title: 'agent-go', path: other },
        { id: 'w-sub', path: path.join(other, 'sub') },
        { id: 'w-current', title: 'current', path: path.join(session, 'inner') },
      ]),
    })

    const { status, data } = await callRoute(conn.routes[0], '?scope=workspace&workspaceId=w-other')
    assert.equal(status, 200)
    assert.deepEqual(
      data.files.map((file) => file.kind),
      ['project', 'user'],
      '工作区作用域 = 选中的那份项目级 + 用户级',
    )
    assert.equal(data.files[0].path, path.join(other, '.dsh', 'hooks.json'), '读的必须**就是** root(X)/.dsh/hooks.json')
    const pre = data.files[0].events.find((event) => event.event === 'PreToolUse')
    assert.equal(pre.groups[0].hooks[0].command, 'other-1', '读的是那个工作区的文件，不是会话项目的')
    // scope 三项：工作区路径、项目根、是否当前会话 —— 各自正确，页面必须分别显示
    assert.equal(data.scope.kind, 'workspace')
    assert.equal(data.scope.requested, 'workspace')
    assert.equal(data.scope.workspaceId, 'w-other')
    assert.equal(data.scope.workspaceTitle, 'agent-go')
    assert.equal(data.scope.workspacePath, other)
    assert.equal(data.scope.projectRoot, other)
    assert.equal(data.scope.isCurrentSession, false, '当前会话在另一个项目里 → false（页面据此出黄底横幅）')
    // 顶层 projectRoot/cwd 永远是**当前会话**在哪里（与所选作用域无关，AGENTS §2.8）
    assert.equal(data.projectRoot, session)
    assert.equal(data.cwd, session)
    // 生效视图 = 用户级在前、项目级在后（合并语义与运行时的那一份一致）
    const merged = data.events.find((event) => event.event === 'PreToolUse')
    assert.equal(merged.hookCount, 1)
    assert.equal(merged.groups[0].file, 'project', 'PreToolUse 只配在项目级，所以它的组来自 project')

    // 清单：每条都带 projectRoot 与 isCurrent；**项目根 ≠ 工作区路径**时两者分别给
    assert.equal(data.workspacesAvailable, true)
    assert.deepEqual(
      data.workspaces.map((workspace) => workspace.id),
      ['w-other', 'w-sub', 'w-current'],
    )
    assert.equal(data.workspaces[0].isCurrent, false)
    assert.equal(data.workspaces[0].projectRoot, other)
    assert.equal(data.workspaces[1].title, 'w-sub', '没有 title 时用 id 兜底（不留空字符串）')
    assert.equal(data.workspaces[1].path, path.join(other, 'sub'))
    assert.equal(
      data.workspaces[1].projectRoot,
      other,
      '工作区是仓库子目录时 projectRoot 是它的祖先 —— 两者必须**分别**给，页面才能分别显示',
    )
    assert.equal(data.workspaces[2].isCurrent, true, '当前会话的项目根就是它')

    // 选中**当前**工作区 ⇒ isCurrentSession 为 true（页面据此换掉那条黄底横幅）
    const current = await callRoute(conn.routes[0], '?scope=workspace&workspaceId=w-current')
    assert.equal(current.data.scope.isCurrentSession, true)
    assert.equal(current.data.scope.projectRoot, session, '工作区是仓库子目录 → 项目根是仓库根（两者不同）')
    assert.equal(current.data.scope.workspacePath, path.join(session, 'inner'), '工作区路径照原样给，不许拿项目根顶上')
    assert.equal(
      current.data.files[0].path,
      path.join(session, '.dsh', 'hooks.json'),
      '读的是 root(X)/.dsh/hooks.json —— X 是**项目根**（最近含 .git 的祖先），不是工作区路径',
    )
  })
})

await test('P：scope=workspace + 未知 id ⇒ 404 unknown-workspace（绝不回落会话项目）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: 'p1' }] }] } })
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    await mount({
      connection: conn.connection,
      fs: makeFs({ version: true }),
      initiator: agent,
      workspaceRegistry: fakeRegistry([{ id: 'w1', title: 'w1', path: dir }]),
    })

    const missing = await callRoute(conn.routes[0], '?scope=workspace&workspaceId=nope')
    assert.equal(missing.status, 404, '工作区已经不在清单里 = 目标不存在（不是 500）')
    assert.equal(missing.body.error, 'unknown-workspace')
    assert.equal(missing.body.data, undefined, '失败响应**没有 data**（页面先补空形状再解引用）')
    assert.ok(missing.body.detail.includes('nope'), 'detail 要能定位是哪个 id')
    assert.equal(
      missing.data.files.length,
      0,
      '**绝不回落**：请求了一个未知工作区时，不许把当前会话的项目文件当答案发下来（§2.2）',
    )

    const noId = await callRoute(conn.routes[0], '?scope=workspace')
    assert.equal(noId.status, 400, 'scope=workspace 缺 workspaceId 是请求不合法（只做字符串收窄，语义在宿主）')
    assert.equal(noId.body.error, 'bad-op')

    const typo = await callRoute(conn.routes[0], '?scope=wrokspace')
    assert.equal(typo.status, 400, '不认识的 scope 不许被静默当成 current 的别名')
  })
})

await test('P：宿主没有 workspaceRegistry ⇒ workspacesAvailable:false + 空清单，且不报 500', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: 'p1' }] }] } })
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    // 刻意**不给** workspaceRegistry：真实宿主上服务也可能还没加载（渐进可用）。
    await mount({ connection: conn.connection, fs: makeFs({ version: true }), initiator: agent })

    const { status, data } = await callRoute(conn.routes[0])
    assert.equal(status, 200, '"宿主没有清单"不是错误：当前项目与用户级配置照常可读可改')
    assert.equal(data.workspacesAvailable, false, '**false = 宿主没有清单**（≠ 没有工作区）—— 页面必须明说')
    assert.deepEqual(data.workspaces, [])
    assert.deepEqual(
      data.files.map((file) => file.kind),
      ['project', 'user'],
      '缺省作用域仍然是 current：两个来源照常都列',
    )

    // 显式要一个工作区：409（"这个宿主给不了那个能力"），不是 500
    const asked = await callRoute(conn.routes[0], '?scope=workspace&workspaceId=w1')
    assert.equal(asked.status, 409)
    assert.equal(asked.body.error, 'no-workspace-registry')
  })
})

await test('P：scope 缺省 = current（回归护栏：与显式 scope=current 逐字段一致）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    await writeHooks(dir, {
      hooks: {
        PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: 'p1' }, { command: 'p2', timeout: 30 }] }],
        Stop: [{ hooks: [{ command: 'p3' }] }],
      },
    })
    await fsp.writeFile(
      path.join(process.env.DSH_HOME, 'hooks.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: 'u1' }] }] } }),
      'utf8',
    )
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: makeFs({ version: true }), initiator: agent })

    const implicit = await callRoute(conn.routes[0])
    const explicit = await callRoute(conn.routes[0], '?scope=current')
    assert.deepEqual(implicit.data, explicit.data, '缺省与显式 current 必须逐字段一致')
    assert.deepEqual(
      implicit.data.files.map((file) => file.kind),
      ['project', 'user'],
      '缺省语义与今天一致：两个来源都列（老客户端不许被这次改动影响）',
    )
    assert.equal(implicit.data.projectRoot, dir)
    assert.equal(implicit.data.scope.kind, 'workspace')
    assert.equal(implicit.data.scope.requested, 'current')
    assert.equal(
      implicit.data.scope.workspaceId,
      null,
      'current 不是清单里的某一条 → 不许拿某条工作区来代称"当前项目"（AGENTS §2.8）',
    )
    assert.equal(implicit.data.scope.isCurrentSession, true)
  })
})

//#endregion

//#region P4. 执行台账（状态色的唯一证据来源）+ 可寻址视图

/** 造一条台账记录。 */
function ledgerEntry(overrides = {}) {
  return {
    at: 1,
    sessionId: 's1',
    event: 'PreToolUse',
    command: 'c',
    // 状态色的匹配条件是 event + command + **projectRoot** 三者（§2.3）。
    projectRoot: '/p',
    exitCode: 0,
    decision: 'pass',
    durationMs: 1,
    stdout: '',
    stderr: '',
    ...overrides,
  }
}

test('L：台账有界（全局 500 / 单会话 200）、输出截断、匹配按 event+command+projectRoot', () => {
  const global = new ExecutionLedger()
  // 每条一个独立会话，避免单会话上限先起作用（两个上限是**各自**生效的，要分开验）。
  for (let i = 0; i < MAX_GLOBAL + 200; i++) {
    global.push(ledgerEntry({ at: i, sessionId: `s${i}`, command: `c${i}` }))
  }
  assert.equal(global.size, MAX_GLOBAL, '全局必须封顶')

  const perSession = new ExecutionLedger()
  for (let i = 0; i < MAX_PER_SESSION + 100; i++) perSession.push(ledgerEntry({ at: i, sessionId: 'only' }))
  assert.equal(perSession.size, MAX_PER_SESSION, '单会话必须封顶')
  assert.equal(
    latestRunFor(perSession.entries(), { event: 'PreToolUse', command: 'c', projectRoot: '/p' }).at,
    MAX_PER_SESSION + 99,
    '丢的是最旧的，留的是最新的',
  )

  const long = new ExecutionLedger()
  long.push(ledgerEntry({ stdout: 'x'.repeat(MAX_TEXT_CHARS + 50) }))
  const kept = long.entries()[0]
  assert.ok(kept.stdout.length <= MAX_TEXT_CHARS + 40, '超长输出必须截断后才进快照（§2.11）')
  assert.ok(kept.stdout.includes('已截断'), '截断要有明确标记，不是静默切掉')

  const fresh = new ExecutionLedger()
  fresh.push(ledgerEntry({ event: 'PreToolUse', command: 'old' }))
  const query = (overrides) => ({ event: 'PreToolUse', command: 'old', projectRoot: '/p', ...overrides })
  assert.equal(latestRunFor(fresh.entries(), query({})).command, 'old')
  assert.equal(latestRunFor(fresh.entries(), query({ command: 'new' })), undefined, '命令改过 → 旧记录不匹配')
  assert.equal(latestRunFor(fresh.entries(), query({ event: 'Stop' })), undefined, '事件不同也不匹配')
  assert.equal(
    latestRunFor(fresh.entries(), query({ projectRoot: '/other' })),
    undefined,
    '**项目根不同也不匹配** —— 同一条命令在别的项目跑过，不许给这个项目的行上色（§2.3）',
  )
})

await test('P：行级状态来自真实执行；命令一改就回落到"未运行"（不许画旧状态）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const s = await script(dir, 'run.cjs', 'process.exit(0)')
    await writeHooks(dir, { hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(s) }] }] } })
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    const h = await mount({ connection: conn.connection, fs: makeFs({ version: true }), initiator: agent })

    // 先跑一次真实子进程 → 台账里应当有正面证据
    await h.listeners.get('tools/pre-execute')[0]({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)
    const after = await callRoute(conn.routes[0])
    const pre = after.data.events.find((event) => event.event === 'PreToolUse')
    const row = pre.groups[0].hooks[0]
    assert.equal(row.command, cmd(s))
    assert.ok(row.lastRun !== null, '跑过一次就必须有记录 —— 状态色只能来自这里')
    assert.equal(row.lastRun.exitCode, 0)
    assert.equal(row.lastRun.decision, 'pass')
    assert.equal(pre.runCount, 1)

    // 改掉命令：旧记录不再匹配 → 行回落"未运行"
    const changed = await postRoute(conn.routes[0], {
      op: 'setHookCommand',
      file: 'project',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 0,
      command: 'echo other',
    })
    assert.equal(changed.status, 200)
    const next = await callRoute(conn.routes[0])
    const nextPre = next.data.events.find((event) => event.event === 'PreToolUse')
    assert.equal(nextPre.groups[0].hooks[0].command, 'echo other')
    assert.equal(
      nextPre.groups[0].hooks[0].lastRun,
      null,
      '命令改过 → 退回灰色：拿旧命令的结果给新命令上色就是"界面在撒谎"',
    )
    assert.equal(nextPre.runCount, 1, '该事件跑过几次仍如实报告（解释"为什么这行是灰的"）')
  })
})

await test('P：三条新建模板的命令都**真能跑**（真子进程：注入 / deny / 落盘）', async () => {
  // 模板是"面向用户"的那一层：用户点一下就会把它写进 hooks.json，所以它**必须真的能跑**。
  // 这条走的是生产路径（`dryRun` 与真实运行共用 runSingleHook，§2.10），不是另写的演示执行器。
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const byId = (id) => HOOK_TEMPLATES.find((template) => template.id === id)
    const reminder = byId('session-reminder')
    const logger = byId('log-calls')
    const deny = byId('deny-calls')
    assert.ok(reminder !== undefined && logger !== undefined && deny !== undefined, '三个模板都在')
    await writeHooks(dir, {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', timeout: 20, command: reminder.command }] }],
        PostToolUse: [{ hooks: [{ type: 'command', timeout: 20, command: logger.command }] }],
        PreToolUse: [{ matcher: 'pwsh', hooks: [{ type: 'command', timeout: 20, command: deny.command }] }],
      },
    })
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: makeFs({ version: true }), initiator: agent })

    // ① 注入提醒：stdout 必须是宿主能解析的结构化 JSON，且**不阻断**任何东西
    const reminderRun = await postRoute(conn.routes[0], {
      op: 'dryRun',
      file: 'project',
      event: 'SessionStart',
      groupIndex: 0,
      hookIndex: 0,
    })
    assert.equal(reminderRun.status, 200)
    assert.equal(
      reminderRun.data.run.exitCode,
      0,
      `注入提醒模板必须 exit 0：${JSON.stringify(reminderRun.data.run).slice(0, 240)}`,
    )
    assert.ok(reminderRun.data.run.stdout.includes('additionalContext'), 'stdout 是宿主要解析的结构化 JSON')
    assert.equal(reminderRun.data.run.decision, 'pass', '注入提醒不该阻断任何东西')

    // ② 直接拦住：必须是 deny，而且走 exit 0 + 结构化 JSON（exit 2 在 PowerShell 里会被折叠成 1，§6）
    const denyRun = await postRoute(conn.routes[0], {
      op: 'dryRun',
      file: 'project',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 0,
    })
    assert.equal(denyRun.data.run.exitCode, 0, 'deny 模板也必须是 exit 0（不许依赖 exit 2）')
    assert.equal(denyRun.data.run.decision, 'deny', '必须真的被判成 deny')

    // ③ 记到日志：真跑一次之后项目里必须多出 .dsh/hook.log，内容就是这次的 stdin
    const logPath = path.join(dir, '.dsh', 'hook.log')
    assert.equal(fs.existsSync(logPath), false, '前提：跑之前没有日志文件')
    const logRun = await postRoute(conn.routes[0], {
      op: 'dryRun',
      file: 'project',
      event: 'PostToolUse',
      groupIndex: 0,
      hookIndex: 0,
    })
    assert.equal(logRun.data.run.exitCode, 0, `记日志模板必须 exit 0：${JSON.stringify(logRun.data.run).slice(0, 240)}`)
    assert.ok(fs.existsSync(logPath), '★ 真的落盘了（模板里的 process.env.DSH_PROJECT_DIR 必须被注入）')
    assert.ok(
      fs.readFileSync(logPath, 'utf8').includes('dry_run'),
      '写进去的就是这一次的 stdin（dry_run 标记能在里面看到）',
    )
  })
})

await test('P：试运行真的跑了那条命令，而且**不进执行台账**（§2.10 + §3.8）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    // 两条 hook：试运行必须打到**被指定的那一条**（下标寻址），不是"第一条"。
    const first = await script(dir, 'first.cjs', 'process.exit(0)')
    const second = await script(dir, 'second.cjs', "process.stderr.write('dry ok');process.exit(2)")
    await writeHooks(dir, {
      hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: cmd(first) }, { command: cmd(second) }] }] },
    })
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    const h = await mount({ connection: conn.connection, fs: makeFs({ version: true }), initiator: agent })

    // ① 试运行第 2 条：真的执行了，结果原样回来
    const run = await postRoute(conn.routes[0], {
      op: 'dryRun',
      file: 'project',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 1,
    })
    assert.equal(run.status, 200)
    assert.equal(run.body.ok, true)
    assert.equal(run.data.run.command, cmd(second), '必须跑**被指定的那一条**（下标寻址，不是第一条）')
    assert.equal(run.data.run.exitCode, 2, '真实退出码要如实带回')
    assert.ok(run.data.run.stderr.includes('dry ok'), 'stderr 也要带回来（页面要给人看）')
    assert.ok(typeof run.data.run.durationMs === 'number')

    // ② **试运行不进台账**：状态色只能来自真实运行（§3.8）
    const afterDry = await callRoute(conn.routes[0])
    const dryPre = afterDry.data.events.find((event) => event.event === 'PreToolUse')
    assert.equal(dryPre.runCount, 0, '试运行绝不能进执行台账 —— 否则一次预演就把那一行画绿了')
    assert.equal(dryPre.groups[0].hooks[1].lastRun, null, '试运行之后那一行仍然是灰的"未运行"')

    // ③ 真实运行才记台账 —— 两条路必须可区分
    await h.listeners.get('tools/pre-execute')[0]({ name: 'pwsh', arguments: {}, callId: 'c', agent }, nextAllow)
    const afterReal = await callRoute(conn.routes[0])
    const realPre = afterReal.data.events.find((event) => event.event === 'PreToolUse')
    assert.equal(realPre.runCount, 2, '真实运行把**匹配到的每一条**都记进台账')
    assert.ok(realPre.groups[0].hooks[1].lastRun !== null, '真实跑过之后那一行才有记录')

    // ④ 越界下标 → 404（不许"就近"跑一条）
    const outOfRange = await postRoute(conn.routes[0], {
      op: 'dryRun',
      file: 'project',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 9,
    })
    assert.equal(outOfRange.status, 404)
    assert.equal(outOfRange.body.error, 'not-found')

    // ⑤ 畸形请求 → 400，且一次执行都没发生
    const malformed = await postRoute(conn.routes[0], { op: 'dryRun', file: 'project', event: 'Nope', hookIndex: 0 })
    assert.equal(malformed.status, 400)
    assert.equal(malformed.body.error, 'bad-op')
  })
})

await test('P：files[].events 是可寻址视图（file + rawIndex），下标直接能用来发写操作', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const projectFile = path.join(dir, '.dsh', 'hooks.json')
    await writeHooks(dir, {
      hooks: {
        PreToolUse: [
          // 这个 group 的 matcher 非法 → 解析会跳过它，所以"保留下来的那个"在文件里是第 1 个。
          { matcher: '[bad', hooks: [{ command: 'skipped' }] },
          { matcher: 'pwsh', hooks: [{ command: 'ok' }] },
        ],
      },
    })
    await fsp.writeFile(
      path.join(process.env.DSH_HOME, 'hooks.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: 'from-user' }] }] } }),
      'utf8',
    )
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: makeFs({ version: true }), initiator: agent })

    const { data } = await callRoute(conn.routes[0])
    const project = data.files.find((file) => file.kind === 'project')
    assert.equal(project.events.length, 7, '每个文件也各有 7 个事件视图（含 0 条）')
    const pre = project.events.find((event) => event.event === 'PreToolUse')
    assert.equal(pre.groups.length, 1, '非法 matcher 的 group 不在可寻址列表里（它不会跑）')
    assert.equal(pre.groups[0].file, 'project')
    assert.equal(pre.groups[0].rawIndex, 1, 'rawIndex 必须是**文件里的**下标，不是解析后的下标')
    assert.equal(pre.groups[0].hooks[0].rawIndex, 0)

    // 合并视图要能标出来源：用户级在前、项目级在后
    const merged = data.events.find((event) => event.event === 'PreToolUse')
    assert.deepEqual(
      merged.groups.map((group) => group.file),
      ['user', 'project'],
      '生效视图必须标出每个 group 来自哪个文件（页面才知道该改哪一份）',
    )

    // 拿可寻址视图里的下标直接发写操作 → 必须落到文件里正确的那个 group
    const response = await postRoute(conn.routes[0], {
      op: 'setHookCommand',
      file: 'project',
      event: 'PreToolUse',
      groupIndex: pre.groups[0].rawIndex,
      hookIndex: pre.groups[0].hooks[0].rawIndex,
      command: 'changed',
    })
    assert.equal(response.status, 200)
    const onDisk = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
    assert.equal(onDisk.hooks.PreToolUse[1].hooks[0].command, 'changed', '必须落到文件里的第 1 个 group')
    assert.equal(onDisk.hooks.PreToolUse[0].hooks[0].command, 'skipped', '被跳过的那个 group 一个字都不许改')
  })
})

//#endregion

//#region P3. POST /api/hooks：定点写 + 乐观锁 + 拒写情形

await test('P：POST 改一条命令真的落盘、未知键保留、且用的是读到的版本（乐观锁）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const projectFile = path.join(dir, '.dsh', 'hooks.json')
    await writeHooks(dir, {
      _comment: 'keep me',
      hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ command: 'echo old' }] }] },
    })
    const conn = makeConnection()
    const writes = []
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: makeFs({ version: true, writes }), initiator: agent })

    // 页面就是照这个流程做的：先 GET 拿到版本，再拿这个版本去写。
    const before = await callRoute(conn.routes[0])
    const project = before.data.files.find((file) => file.kind === 'project')
    assert.equal(typeof project.version, 'string', 'GET 必须给出文件版本，否则页面没法做乐观锁')

    const response = await postRoute(conn.routes[0], {
      op: 'setHookCommand',
      file: 'project',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 0,
      command: 'echo NEW',
    })
    assert.equal(response.status, 200)
    assert.equal(response.body.ok, true)
    assert.equal(response.data.file, 'project')

    // ① 真的落盘了，而且**未知键还在**
    const onDisk = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
    assert.equal(onDisk._comment, 'keep me', '未知键必须还在 —— 这是"克隆整份文档"最直接的证明')
    assert.equal(onDisk.hooks.PreToolUse[0].hooks[0].command, 'echo NEW')
    assert.equal(onDisk.hooks.PreToolUse[0].matcher, 'pwsh', 'group 上的 matcher 不许被顺手改掉')

    // ② 写盘用的是**读到的那个版本**，不是无守卫覆盖
    assert.equal(writes.length, 1, '应当恰好写一次')
    assert.equal(writes[0].expected.kind, 'replaceIfVersion')
    assert.equal(writes[0].expected.version, project.version, '乐观锁必须用页面看到的那个版本')
    assert.equal(writes[0].path, projectFile)

    // ③ 写完再 GET，看到的应当是**新**配置（缓存失效链路也要跟着走）
    const after = await callRoute(conn.routes[0])
    const pre = after.data.events.find((event) => event.event === 'PreToolUse')
    assert.equal(pre.groups[0].hooks[0].command, 'echo NEW', '页面刷新后应当看到新命令')
  })
})

await test('P：版本冲突 → 409 stale，且文件一个字节都没变', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const projectFile = path.join(dir, '.dsh', 'hooks.json')
    await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: 'echo old' }] }] } })
    const original = fs.readFileSync(projectFile, 'utf8')

    const fsImpl = makeFs({ version: true })
    fsImpl.writeText = async () => {
      throw new Error('FS_STALE_VERSION: 期望 v1，实际 v2')
    }
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: fsImpl, initiator: agent })

    const response = await postRoute(conn.routes[0], {
      op: 'setHookCommand',
      file: 'project',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 0,
      command: 'echo NEW',
    })
    assert.equal(response.status, 409)
    assert.equal(response.body.error, 'stale', '页面据此提示"文件被别处改过了，请刷新"')
    assert.equal(fs.readFileSync(projectFile, 'utf8'), original, '写失败绝不能留下半成品')
  })
})

await test('P：文件读不出来 → 拒写 invalid-json（绝不许覆盖读不懂的内容）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const projectFile = path.join(dir, '.dsh', 'hooks.json')
    await fsp.mkdir(path.join(dir, '.dsh'), { recursive: true })
    const broken = '{"hooks": {\n'
    await fsp.writeFile(projectFile, broken, 'utf8')
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: makeFs({ version: true }), initiator: agent })

    const response = await postRoute(conn.routes[0], {
      op: 'setHookCommand',
      file: 'project',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 0,
      command: 'echo NEW',
    })
    assert.equal(response.status, 409)
    assert.equal(response.body.error, 'invalid-json')
    assert.ok(typeof response.body.detail === 'string' && response.body.detail.length > 0, '要说得出为什么')
    assert.equal(fs.readFileSync(projectFile, 'utf8'), broken, '读不懂的文件必须原封不动 —— 覆盖它等于删掉用户的内容')
  })
})

await test('P：文件不存在 → absent；createFile 建出可解析的空配置，再建一次是 exists', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const projectFile = path.join(dir, '.dsh', 'hooks.json')
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: makeFs({ version: true }), initiator: agent })

    const missing = await postRoute(conn.routes[0], {
      op: 'setHookCommand',
      file: 'project',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 0,
      command: 'x',
    })
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error, 'absent', '页面据此提示"这份配置还不存在，要不要新建"')

    const created = await postRoute(conn.routes[0], { op: 'createFile', file: 'project' })
    assert.equal(created.status, 200)
    const onDisk = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
    assert.deepEqual(Object.keys(onDisk), ['hooks'], '新建的文件应当是一个自解释的空配置')
    assert.deepEqual(parseHookConfig(onDisk).errors, [], '新建的文件必须立刻是合法配置')

    const again = await postRoute(conn.routes[0], { op: 'createFile', file: 'project' })
    assert.equal(again.status, 409)
    assert.equal(again.body.error, 'exists', '已存在就不能"创建" —— 那会覆盖')
  })
})

await test('P：越界寻址 → 404 not-found，文件不变', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const projectFile = path.join(dir, '.dsh', 'hooks.json')
    await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: 'echo a' }] }] } })
    const original = fs.readFileSync(projectFile, 'utf8')
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: makeFs({ version: true }), initiator: agent })

    const response = await postRoute(conn.routes[0], {
      op: 'setHookCommand',
      file: 'project',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 7,
      command: 'echo NEW',
    })
    assert.equal(response.status, 404)
    assert.equal(response.body.error, 'not-found')
    assert.equal(fs.readFileSync(projectFile, 'utf8'), original)
  })
})

await test('P：沙箱拒绝写入 → 403 sandbox（不是含混的"保存失败"）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: 'echo a' }] }] } })
    const fsImpl = makeFs({ version: true })
    fsImpl.writeText = async () => {
      throw new Error('FS_DENIED: sandbox mode read-only forbids writing workspaceRoot')
    }
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: fsImpl, initiator: agent })

    const response = await postRoute(conn.routes[0], {
      op: 'setHookCommand',
      file: 'project',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 0,
      command: 'echo NEW',
    })
    assert.equal(response.status, 403)
    assert.equal(response.body.error, 'sandbox')
  })
})

await test('P：畸形请求体 → 400，且什么都不写', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const projectFile = path.join(dir, '.dsh', 'hooks.json')
    await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: 'echo a' }] }] } })
    const original = fs.readFileSync(projectFile, 'utf8')
    const writes = []
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: makeFs({ version: true, writes }), initiator: agent })

    const notJson = await postRaw(conn.routes[0], 'not json at all')
    assert.equal(notJson.status, 400)
    assert.equal(notJson.body.error, 'bad-json')

    const badOp = await postRoute(conn.routes[0], { op: 'setHookCommand', file: 'project', groupIndex: -1 })
    assert.equal(badOp.status, 400)
    assert.equal(badOp.body.error, 'bad-op')
    assert.ok(typeof badOp.body.detail === 'string', '要说出哪一项不合法')

    assert.equal(writes.length, 0, '畸形请求绝不许触到写盘')
    assert.equal(fs.readFileSync(projectFile, 'utf8'), original)
  })
})

await test('P：not-preservable 会以 409 透传给页面（页面要能分别说清）', async () => {
  const conn = makeConnection()
  registerHooksRoute(conn.connection, {
    inspect: async () => emptyInspection(),
    write: async () => ({ ok: false, error: 'not-preservable', detail: '改写会动到目标之外的字段' }),
  })
  const response = await postRoute(conn.routes[0], { op: 'createFile', file: 'user' })
  assert.equal(response.status, 409)
  assert.equal(response.body.error, 'not-preservable')
  assert.equal(response.body.detail, '改写会动到目标之外的字段')
})

await test('P：试运行一个"被拒"的组 ⇒ rejected（说清它为什么不跑，而不是"这一条已经不在了"）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    await writeHooks(dir, {
      hooks: { PreToolUse: [{ matcher: '(', hooks: [{ type: 'command', command: 'echo a' }] }] },
    })
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: makeFs({ version: true }), initiator: agent })

    const response = await postRoute(conn.routes[0], {
      op: 'dryRun',
      file: 'project',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 0,
    })
    assert.equal(response.status, 409, '目标在文件里，只是跑不了 —— 不是 404')
    assert.equal(response.body.error, 'rejected', '必须与 not-found（真的不在了）区分开')
    assert.ok(
      typeof response.body.detail === 'string' && response.body.detail.includes('matcher'),
      `要说得出是哪一处不合法：${String(response.body.detail)}`,
    )
  })
})

await test('P：写请求带 expectedVersion —— 页面看到的版本就是写入的锁，过期即 stale（字节不变）', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const projectFile = path.join(dir, '.dsh', 'hooks.json')
    await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: 'echo old' }] }] } })
    const conn = makeConnection()
    const writes = []
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: makeFs({ version: true, writes }), initiator: agent })

    const before = await callRoute(conn.routes[0])
    const version = before.data.files.find((file) => file.kind === 'project').version
    assert.equal(typeof version, 'string')
    const original = fs.readFileSync(projectFile, 'utf8')
    const edit = (extra) => ({
      op: 'setHookCommand',
      file: 'project',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 0,
      command: 'echo NEW',
      ...extra,
    })

    // ① 页面上的版本已经过期（别处改过）→ 拒写，文件一个字节都不许变，也不许触到写盘。
    const stale = await postRoute(conn.routes[0], edit({ expectedVersion: 'v-page-saw-older' }))
    assert.equal(stale.status, 409)
    assert.equal(stale.body.error, 'stale', '页面据此说"文件被别处改过了，刷新后再改"')
    assert.equal(fs.readFileSync(projectFile, 'utf8'), original)
    assert.equal(writes.length, 0, '过期的请求绝不许触到写盘 —— 否则就是"改到了别的位置上"')

    // ② 页面是最新的：写盘必须用**页面给的那个版本**，而不是宿主自己重新读的一个版本。
    const ok = await postRoute(conn.routes[0], edit({ expectedVersion: version }))
    assert.equal(ok.status, 200)
    assert.equal(writes.length, 1)
    assert.equal(writes[0].expected.kind, 'replaceIfVersion')
    assert.equal(writes[0].expected.version, version, '锁必须是页面看到的那个版本')
    assert.equal(JSON.parse(fs.readFileSync(projectFile, 'utf8')).hooks.PreToolUse[0].hooks[0].command, 'echo NEW')

    // ③ `expectedVersion: null` = "我以为这个文件还不存在" → 它其实存在 ⇒ stale（绝不静默覆盖）。
    const wrongNew = await postRoute(conn.routes[0], edit({ expectedVersion: null }))
    assert.equal(wrongNew.status, 409)
    assert.equal(wrongNew.body.error, 'stale')

    // ④ 反向：`null` 且文件真的不存在 ⇒ 允许新建（否则"新建"这条路径就废了）。
    const fresh = await makeProject()
    const freshConn = makeConnection()
    const freshAgent = fakeAgent(fresh)
    await mount({ connection: freshConn.connection, fs: makeFs({ version: true }), initiator: freshAgent.agent })
    const created = await postRoute(freshConn.routes[0], {
      op: 'addGroup',
      file: 'project',
      event: 'PreToolUse',
      matcher: null,
      command: 'echo first',
      timeoutSec: null,
      expectedVersion: null,
    })
    assert.equal(created.status, 200, '页面认为它不存在 + 它确实不存在 ⇒ 允许新建')
    const createdFile = path.join(fresh, '.dsh', 'hooks.json')
    assert.equal(JSON.parse(fs.readFileSync(createdFile, 'utf8')).hooks.PreToolUse[0].hooks[0].command, 'echo first')

    // ⑤ 两个写请求用**同一个**版本（两个标签页同时点保存）：先到的成功，后到的拿 stale。
    //    没有这条，版本锁只证明了"能比"，没证明"并发时谁赢"。
    const currentVersion = (await callRoute(conn.routes[0])).data.files.find((file) => file.kind === 'project').version
    const first = await postRoute(conn.routes[0], edit({ expectedVersion: currentVersion, command: 'echo first-win' }))
    const second = await postRoute(
      conn.routes[0],
      edit({ expectedVersion: currentVersion, command: 'echo second-lose' }),
    )
    assert.equal(first.status, 200, '先到的那个必须成功')
    assert.equal(second.status, 409, '后到的那个必须被挡住')
    assert.equal(second.body.error, 'stale')
    assert.equal(
      JSON.parse(fs.readFileSync(projectFile, 'utf8')).hooks.PreToolUse[0].hooks[0].command,
      'echo first-win',
      '★ 先到的那个生效，后到的那个一个字都没写进去',
    )

    // ⑥ 文件在页面加载后被删掉：带旧版本写入 ⇒ stale（不是"顺手新建一份"）。
    fs.rmSync(projectFile)
    const gone = await postRoute(conn.routes[0], edit({ expectedVersion: version }))
    assert.equal(gone.status, 409)
    assert.equal(gone.body.error, 'stale')
    assert.equal(fs.existsSync(projectFile), false, '过期版本绝不许顺手把文件建回来')

    // ⑦ 旧客户端不传这个字段 ⇒ 行为与改动前逐字一致（读后写），向后兼容。
    await writeHooks(dir, { hooks: { PreToolUse: [{ hooks: [{ command: 'echo old' }] }] } })
    const legacy = await postRoute(conn.routes[0], edit({}))
    assert.equal(legacy.status, 200, '缺省 expectedVersion 时必须回退到"读后写"（不打断旧页面）')
  })
})

//#endregion

//#region P3b. 作用域写入（§8 的 P3-10 / P3-11 / P3-12）：绝不改错文件

await test('P3：带 workspaceId 的写 ⇒ 只改那个工作区的文件，当前会话项目的文件**字节不变**', async () => {
  await withIsolatedHome(async () => {
    const session = await makeProject()
    const other = await makeProject()
    await writeHooks(session, { hooks: { PreToolUse: [{ hooks: [{ command: 'session-1' }] }] } })
    await writeHooks(other, { hooks: { PreToolUse: [{ hooks: [{ command: 'other-1' }] }] } })
    const sessionFile = path.join(session, '.dsh', 'hooks.json')
    const otherFile = path.join(other, '.dsh', 'hooks.json')
    const before = fs.readFileSync(sessionFile, 'utf8')
    const beforeHash = sha256(before)

    const conn = makeConnection()
    const writes = []
    const { agent } = fakeAgent(session)
    await mount({
      connection: conn.connection,
      fs: makeFs({ version: true, writes }),
      initiator: agent,
      workspaceRegistry: fakeRegistry([{ id: 'w-other', title: 'other', path: other }]),
    })

    const response = await postRoute(conn.routes[0], {
      op: 'setHookCommand',
      file: 'project',
      workspaceId: 'w-other',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 0,
      command: 'changed-in-other',
    })
    assert.equal(response.status, 200)
    // ① 目标（另一个工作区）的文件真的变了
    assert.equal(
      JSON.parse(fs.readFileSync(otherFile, 'utf8')).hooks.PreToolUse[0].hooks[0].command,
      'changed-in-other',
    )
    // ② 落盘的路径**就是**那个工作区的文件（不是会话项目的）
    assert.equal(writes.length, 1)
    assert.equal(writes[0].path, otherFile, '写盘路径必须是 root(workspaceId)/.dsh/hooks.json')
    // ③ 当前会话项目的文件**一个字节都没变**（§2.2 的核心断言）
    assert.equal(fs.readFileSync(sessionFile, 'utf8'), before, '当前会话项目的文件不许被碰')
    assert.equal(sha256(fs.readFileSync(sessionFile, 'utf8')), beforeHash)

    // ④ 反向：**不带** workspaceId（= 页面里的「当前会话项目」，没有工作区 id 可带）
    //    必须落到会话项目，而且那个工作区的文件不许被碰。
    const sessionWrite = await postRoute(conn.routes[0], {
      op: 'setHookCommand',
      file: 'project',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 0,
      command: 'changed-in-session',
    })
    assert.equal(sessionWrite.status, 200, '不带 workspaceId 的写按会话 cwd 解析（旧语义，向后兼容）')
    assert.equal(writes.length, 2)
    assert.equal(writes[1].path, sessionFile, '「当前会话项目」的写必须落到会话项目的文件')
    assert.equal(
      JSON.parse(fs.readFileSync(sessionFile, 'utf8')).hooks.PreToolUse[0].hooks[0].command,
      'changed-in-session',
    )
    assert.equal(
      JSON.parse(fs.readFileSync(otherFile, 'utf8')).hooks.PreToolUse[0].hooks[0].command,
      'changed-in-other',
      '另一个工作区的文件不许被这次写碰到',
    )
  })
})

await test('P3：未知 workspaceId ⇒ 拒写 unknown-workspace，两边的文件都没变', async () => {
  await withIsolatedHome(async () => {
    const session = await makeProject()
    const other = await makeProject()
    await writeHooks(session, { hooks: { PreToolUse: [{ hooks: [{ command: 'session-1' }] }] } })
    await writeHooks(other, { hooks: { PreToolUse: [{ hooks: [{ command: 'other-1' }] }] } })
    const sessionFile = path.join(session, '.dsh', 'hooks.json')
    const otherFile = path.join(other, '.dsh', 'hooks.json')
    const sessionBefore = fs.readFileSync(sessionFile, 'utf8')
    const otherBefore = fs.readFileSync(otherFile, 'utf8')

    const conn = makeConnection()
    const writes = []
    const { agent } = fakeAgent(session)
    await mount({
      connection: conn.connection,
      fs: makeFs({ version: true, writes }),
      initiator: agent,
      workspaceRegistry: fakeRegistry([{ id: 'w-other', title: 'other', path: other }]),
    })

    const response = await postRoute(conn.routes[0], {
      op: 'setHookCommand',
      file: 'project',
      workspaceId: 'w-gone',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 0,
      command: 'should-never-land',
    })
    assert.equal(response.status, 404)
    assert.equal(response.body.error, 'unknown-workspace', '**绝不回落会话项目**：宁可写失败，也不改写错的文件')
    assert.equal(writes.length, 0, '拒写时一次都不许触到写盘')
    assert.equal(fs.readFileSync(sessionFile, 'utf8'), sessionBefore, '当前会话项目文件不许变')
    assert.equal(fs.readFileSync(otherFile, 'utf8'), otherBefore)

    // 宿主没有清单（服务缺席）是另一种错误：409，文案不同
    const noRegistry = makeConnection()
    const { agent: agent2 } = fakeAgent(session)
    await mount({ connection: noRegistry.connection, fs: makeFs({ version: true }), initiator: agent2 })
    const asked = await postRoute(noRegistry.routes[0], {
      op: 'setHookCommand',
      file: 'project',
      workspaceId: 'w-other',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 0,
      command: 'x',
    })
    assert.equal(asked.status, 409)
    assert.equal(asked.body.error, 'no-workspace-registry')
  })
})

await test('P3：addGroup 在文件不存在时自动建文件；createIfAbsent 竞态 ⇒ exists 如实拒写', async () => {
  await withIsolatedHome(async () => {
    const dir = await makeProject()
    const projectFile = path.join(dir, '.dsh', 'hooks.json')
    const conn = makeConnection()
    const { agent } = fakeAgent(dir)
    await mount({ connection: conn.connection, fs: makeFs({ version: true }), initiator: agent })

    // ① 「＋新建」一次搞定：文件不存在也能建出含这条 hook 的骨架（D2）
    const created = await postRoute(conn.routes[0], {
      op: 'addGroup',
      file: 'project',
      event: 'PreToolUse',
      matcher: 'pwsh',
      command: 'echo first',
      timeoutSec: 30,
    })
    assert.equal(created.status, 200)
    const onDisk = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
    assert.deepEqual(onDisk, {
      hooks: { PreToolUse: [{ matcher: 'pwsh', hooks: [{ type: 'command', command: 'echo first', timeout: 30 }] }] },
    })
    assert.deepEqual(parseHookConfig(onDisk).errors, [], '自动建出来的文件必须立刻是合法配置')

    // ② 竞态：prepareWrite 看到的是 absent，但别人在我们读完之后建了文件 →
    //    `createIfAbsent` 抛错，宿主必须**如实**报 exists 并提示刷新，绝不静默覆盖。
    const racing = await makeProject()
    const racingFile = path.join(racing, '.dsh', 'hooks.json')
    const fsImpl = makeFs({ version: true })
    fsImpl.writeText = async (target, content, expected) => {
      if (expected && expected.kind === 'createIfAbsent') {
        // 仿真：别人先写了一份（内容与我们要写的不同），provider 因此拒绝
        await fsp.mkdir(path.dirname(target.displayPath), { recursive: true })
        await fsp.writeFile(target.displayPath, '{"hooks":{"Stop":[]}}\n', 'utf8')
        throw new Error('FS_EXISTS: 目标已存在（createIfAbsent 只对不存在的目标生效）')
      }
      throw new Error('不该走到这里')
    }
    const conn2 = makeConnection()
    const { agent: agent2 } = fakeAgent(racing)
    await mount({ connection: conn2.connection, fs: fsImpl, initiator: agent2 })
    const conflicted = await postRoute(conn2.routes[0], {
      op: 'addGroup',
      file: 'project',
      event: 'PreToolUse',
      matcher: null,
      command: 'echo x',
      timeoutSec: null,
    })
    assert.equal(conflicted.status, 409)
    assert.equal(conflicted.body.error, 'exists', '竞态如实报 exists（页面提示刷新），不是 500、也不是静默覆盖')
    assert.equal(fs.readFileSync(racingFile, 'utf8'), '{"hooks":{"Stop":[]}}\n', '别人写下的内容一个字节都不许被覆盖')

    // ③ 非新增类 op 在文件不存在时仍然 absent 拒写（不许顺手建出一份空配置）
    const notNew = await postRoute(conn.routes[0], {
      op: 'setHookDisabled',
      file: 'user',
      event: 'PreToolUse',
      groupIndex: 0,
      hookIndex: 0,
      disabled: true,
    })
    assert.equal(notNew.status, 404)
    assert.equal(notNew.body.error, 'absent')
  })
})

//#endregion

//#region P2. 写路径：定点操作 + 保留性证明（纯函数，不碰 fs）

const RICH_DOC = {
  _comment: '本机 demo 配置（改文件前先读这一行）',
  hooks: {
    PreToolUse: [
      {
        matcher: 'pwsh',
        hooks: [
          { type: 'command', command: 'echo a' },
          { command: 'echo b', timeout: 30 },
        ],
      },
    ],
    Stop: [{ hooks: [{ command: 'echo stop' }] }],
  },
}

/** 取一次必须成功的改写结果（失败时直接断言失败，附上原因）。 */
function applied(doc, op) {
  const result = applyOp(doc, { file: 'project', ...op })
  assert.equal(result.ok, true, `applyOp 应当成功：${JSON.stringify(result)}`)
  return result.applied
}

test('W：风格探测与序列化是不动点（我们写的文件，后续编辑只会是最小 diff）', () => {
  const canonical = JSON.stringify(RICH_DOC, null, 2) + '\n'
  const style = detectStyle(canonical)
  assert.deepEqual(style, { indent: '  ', eol: '\n', finalNewline: true, compact: false })
  assert.equal(serialize(JSON.parse(canonical), style), canonical, '2 空格 + LF + 结尾换行必须逐字节还原')

  const tabs = '{\n\t"hooks": {}\n}\n'
  assert.equal(detectStyle(tabs).indent, '\t')
  assert.equal(serialize(JSON.parse(tabs), detectStyle(tabs)), tabs, 'tab 缩进也要还原')

  const crlf = '{\r\n  "hooks": {}\r\n}\r\n'
  assert.equal(serialize(JSON.parse(crlf), detectStyle(crlf)), crlf, 'CRLF 与结尾换行都要保持')

  const noFinalNewline = '{\n  "hooks": {}\n}'
  assert.equal(detectStyle(noFinalNewline).finalNewline, false)
  assert.equal(
    serialize(JSON.parse(noFinalNewline), detectStyle(noFinalNewline)),
    noFinalNewline,
    '原本没有结尾换行就不要凭空加一个',
  )
})

test('W：单行紧凑文件编辑后仍是单行（不许把整个文件重排）', () => {
  // 真机场景：手写 / 工具生成的 minified hooks.json。整份文件只有一行，
  // 而"按行首空白探测缩进"探不到任何东西 —— 于是回退两空格，一次编辑就把文件展开成十几行，
  // 用户看到的是"我只改了一条命令，整个文件全红了"。
  const compact = '{"hooks":{"PreToolUse":[{"matcher":"pwsh","hooks":[{"type":"command","command":"echo a"}]}]}}'
  const style = detectStyle(compact)
  assert.equal(style.compact, true, '完全没有换行的文件必须被识别成紧凑布局')
  assert.equal(serialize(JSON.parse(compact), style), compact, '紧凑风格必须是逐字节不动点')

  const { doc } = applied(JSON.parse(compact), {
    op: 'setHookCommand',
    file: 'project',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 0,
    command: 'echo b',
  })
  const text = serialize(doc, style)
  assert.equal(text.split('\n').length, 1, '改一条命令之后仍然是一行')
  assert.ok(text.includes('"echo b"'), '改动本身要落上')

  // 反向：多行文件**不许**被误判成紧凑（否则我们就会把用户的缩进全吃掉）。
  const pretty = JSON.stringify(JSON.parse(compact), null, 2)
  assert.equal(detectStyle(pretty).compact, false, '多行文件不是紧凑布局')
  assert.equal(serialize(JSON.parse(pretty), detectStyle(pretty)), pretty, '多行文件仍是逐字节不动点')
})

test('W：新文件内容是"能被解析成空配置"的自解释形状', () => {
  const text = starterText({ indent: '  ', eol: '\n', finalNewline: true, compact: false })
  const parsed = parseHookConfig(JSON.parse(text))
  assert.deepEqual(parsed.errors, [])
  assert.deepEqual(parsed.groups, {})
  assert.deepEqual(Object.keys(JSON.parse(text)), ['hooks'])
})

test('W：setHookCommand 只动目标 hook，未知键原样保留', () => {
  const { doc, changes } = applied(RICH_DOC, {
    op: 'setHookCommand',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 1,
    command: 'echo B',
  })
  assert.equal(doc.hooks.PreToolUse[0].hooks[1].command, 'echo B')
  assert.equal(doc.hooks.PreToolUse[0].hooks[0].command, 'echo a', '另一条 hook 不许动')
  assert.equal(doc._comment, RICH_DOC._comment, '未知键必须原样保留')
  assert.equal(doc.hooks.Stop[0].hooks[0].command, 'echo stop', '别的事件不许动')
  assert.equal(doc.hooks.PreToolUse[0].matcher, 'pwsh', 'group 上的 matcher 不许动')
  assert.equal(preservationProblem(RICH_DOC, doc, changes), undefined)
  assert.notEqual(doc, RICH_DOC, '必须返回新文档，不许原地改调用方的对象')
  assert.equal(RICH_DOC.hooks.PreToolUse[0].hooks[1].command, 'echo b', '原文档必须一个字节都没变')
})

test('W：disabled 开=写键、关=删键；timeout=null 也是删键（不留噪音）', () => {
  const on = applied(RICH_DOC, {
    op: 'setHookDisabled',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 0,
    disabled: true,
  })
  assert.equal(on.doc.hooks.PreToolUse[0].hooks[0].disabled, true)
  assert.equal(preservationProblem(RICH_DOC, on.doc, on.changes), undefined)

  const off = applied(on.doc, {
    op: 'setHookDisabled',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 0,
    disabled: false,
  })
  assert.equal('disabled' in off.doc.hooks.PreToolUse[0].hooks[0], false, '关掉要删键，不要留 disabled:false')
  assert.equal(preservationProblem(on.doc, off.doc, off.changes), undefined)

  const noTimeout = applied(RICH_DOC, {
    op: 'setHookTimeout',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 1,
    timeoutSec: null,
  })
  assert.equal('timeout' in noTimeout.doc.hooks.PreToolUse[0].hooks[1], false)
  assert.equal(preservationProblem(RICH_DOC, noTimeout.doc, noTimeout.changes), undefined)

  const withTimeout = applied(RICH_DOC, {
    op: 'setHookTimeout',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 0,
    timeoutSec: 45,
  })
  assert.equal(withTimeout.doc.hooks.PreToolUse[0].hooks[0].timeout, 45)
  assert.equal(preservationProblem(RICH_DOC, withTimeout.doc, withTimeout.changes), undefined)
})

test('W：addHook / removeHook / moveHook / removeGroup 只动目标（含顺序语义）', () => {
  const added = applied(RICH_DOC, {
    op: 'addHook',
    event: 'PreToolUse',
    groupIndex: 0,
    command: 'echo c',
    timeoutSec: 5,
  })
  assert.equal(added.doc.hooks.PreToolUse[0].hooks.length, 3)
  assert.deepEqual(added.doc.hooks.PreToolUse[0].hooks[2], { type: 'command', command: 'echo c', timeout: 5 })
  assert.equal(preservationProblem(RICH_DOC, added.doc, added.changes), undefined)

  const removed = applied(RICH_DOC, { op: 'removeHook', event: 'PreToolUse', groupIndex: 0, hookIndex: 0 })
  assert.equal(removed.doc.hooks.PreToolUse[0].hooks.length, 1)
  assert.equal(removed.doc.hooks.PreToolUse[0].hooks[0].command, 'echo b')
  assert.equal(preservationProblem(RICH_DOC, removed.doc, removed.changes), undefined)

  // 顺序即执行顺序，所以"上移/下移"是语义操作，不是界面装饰。
  const moved = applied(RICH_DOC, {
    op: 'moveHook',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 0,
    direction: 1,
  })
  assert.deepEqual(
    moved.doc.hooks.PreToolUse[0].hooks.map((hook) => hook.command),
    ['echo b', 'echo a'],
  )
  assert.equal(preservationProblem(RICH_DOC, moved.doc, moved.changes), undefined)

  const dropped = applied(RICH_DOC, { op: 'removeGroup', event: 'PreToolUse', groupIndex: 0 })
  assert.equal(dropped.doc.hooks.PreToolUse.length, 0)
  assert.equal(dropped.doc.hooks.Stop.length, 1, '别的事件不许动')
  assert.equal(dropped.doc._comment, RICH_DOC._comment)
  assert.equal(preservationProblem(RICH_DOC, dropped.doc, dropped.changes), undefined)
})

test('W：越界寻址一律拒写（宁可失败，也不许落到别的节点上）', () => {
  const notFound = [
    { op: 'setHookCommand', event: 'PreToolUse', groupIndex: 9, hookIndex: 0, command: 'x' },
    { op: 'setHookCommand', event: 'PreToolUse', groupIndex: 0, hookIndex: 9, command: 'x' },
    { op: 'setHookDisabled', event: 'PreToolUse', groupIndex: 0, hookIndex: 2, disabled: true },
    { op: 'removeHook', event: 'Stop', groupIndex: 0, hookIndex: 1 },
    { op: 'removeGroup', event: 'PreToolUse', groupIndex: 3 },
    { op: 'setGroupMatcher', event: 'Notification', groupIndex: 0, matcher: null },
    { op: 'addHook', event: 'Notification', groupIndex: 0, command: 'x', timeoutSec: null },
  ]
  for (const one of notFound) {
    const result = applyOp(RICH_DOC, { file: 'project', ...one })
    assert.equal(result.ok, false, `${one.op} 越界必须被拒`)
    assert.equal(result.reason, 'not-found', `${one.op} 的原因码应当是 not-found`)
  }
  // 移到数组外是另一种原因码：位置本身合法，但目标不存在。
  const outside = applyOp(RICH_DOC, {
    file: 'project',
    op: 'moveHook',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 0,
    direction: -1,
  })
  assert.equal(outside.ok, false)
  assert.equal(outside.reason, 'out-of-range')
})

test('W：保留性证明能抓住"改写顺手丢了字段"（证明本身也要能被证伪）', () => {
  const { changes } = applied(RICH_DOC, {
    op: 'setHookCommand',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 0,
    command: 'echo A',
  })

  // 对照：只改目标那一个字段 → 证明必须通过
  const clean = JSON.parse(JSON.stringify(RICH_DOC))
  clean.hooks.PreToolUse[0].hooks[0].command = 'echo A'
  assert.equal(preservationProblem(RICH_DOC, clean, changes), undefined)

  // 注入：顺手把 `_comment` 弄丢了 → 必须被抓住（调用方据此**拒写**）
  const lossy = JSON.parse(JSON.stringify(RICH_DOC))
  lossy.hooks.PreToolUse[0].hooks[0].command = 'echo A'
  delete lossy._comment
  const problem = preservationProblem(RICH_DOC, lossy, changes)
  assert.equal(typeof problem, 'string', '丢了未知键必须被证明抓到')
  assert.ok(problem.includes('目标之外的字段'), `提示要能看出性质：${String(problem)}`)

  // 注入二：顺手把 timeout 也改了 → 同样必须被抓住
  const extra = JSON.parse(JSON.stringify(RICH_DOC))
  extra.hooks.PreToolUse[0].hooks[0].command = 'echo A'
  extra.hooks.PreToolUse[0].hooks[1].timeout = 999
  assert.equal(typeof preservationProblem(RICH_DOC, extra, changes), 'string', '多改了字段也要被抓到')
})

test('W：请求体校验拒绝畸形输入（不可信输入不许进 applyOp）', () => {
  const malformed = [
    null,
    'x',
    42,
    [],
    { op: 'setHookCommand', file: 'other', event: 'PreToolUse', groupIndex: 0, hookIndex: 0, command: 'x' },
    { op: 'nope', file: 'project' },
    { op: 'setHookCommand', file: 'project', event: 'PreToolUse', groupIndex: -1, hookIndex: 0, command: 'x' },
    { op: 'setHookCommand', file: 'project', event: 'PreToolUse', groupIndex: '0', hookIndex: 0, command: 'x' },
    { op: 'setHookCommand', file: 'project', event: 'PreToolUse', groupIndex: 0, hookIndex: 1.5, command: 'x' },
    { op: 'setHookCommand', file: 'project', event: 'PreToolUse', groupIndex: 0, hookIndex: 0, command: '' },
    { op: 'setHookCommand', file: 'project', event: 'Notification', groupIndex: 0, hookIndex: 0, command: 'x' },
    { op: 'setHookDisabled', file: 'project', event: 'PreToolUse', groupIndex: 0, hookIndex: 0, disabled: 'yes' },
    { op: 'setHookTimeout', file: 'project', event: 'PreToolUse', groupIndex: 0, hookIndex: 0, timeoutSec: 0 },
    { op: 'setHookTimeout', file: 'project', event: 'PreToolUse', groupIndex: 0, hookIndex: 0, timeoutSec: -5 },
    { op: 'moveHook', file: 'project', event: 'PreToolUse', groupIndex: 0, hookIndex: 0, direction: 0 },
    { op: 'setGroupMatcher', file: 'project', event: 'PreToolUse', groupIndex: 0, matcher: 5 },
    { op: 'removeHook', file: 'project', event: 'PreToolUse', groupIndex: 0 },
  ]
  for (const body of malformed) {
    const parsed = parseHooksRequest(body)
    assert.equal(parsed.ok, false, `应当被拒：${JSON.stringify(body)}`)
    assert.ok(typeof parsed.reason === 'string' && parsed.reason.length > 0, '拒了要给得出原因')
  }

  const good = parseHooksRequest({
    op: 'setHookCommand',
    file: 'project',
    event: 'PreToolUse',
    groupIndex: 0,
    hookIndex: 0,
    command: 'x',
  })
  assert.equal(good.ok, true)
  assert.equal(good.request.event, 'PreToolUse')
  assert.equal(good.request.command, 'x')

  const create = parseHooksRequest({ op: 'createFile', file: 'user' })
  assert.equal(create.ok, true)
  assert.equal(create.request.file, 'user')
})

test('W：改写 → 序列化 → 再解析，未知键仍在（端到端）', () => {
  const text = JSON.stringify(RICH_DOC, null, 2) + '\n'
  const { doc } = applied(JSON.parse(text), {
    op: 'setHookCommand',
    event: 'Stop',
    groupIndex: 0,
    hookIndex: 0,
    command: 'echo STOP',
  })
  const written = serialize(doc, detectStyle(text))
  const reparsed = JSON.parse(written)
  assert.equal(reparsed._comment, RICH_DOC._comment, '写盘再读回来，未知键必须还在')
  assert.equal(reparsed.hooks.Stop[0].hooks[0].command, 'echo STOP')
  assert.deepEqual(parseHookConfig(reparsed).errors, [], '写出来的东西必须仍然是合法配置')
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

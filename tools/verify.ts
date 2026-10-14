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
  const requires = source.match(/\brequire\s*\(/g) || []
  assert.equal(requires.length, 1, '只允许一个 require（源码里手写第二个就会被这条抓住）')
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
          store.values[index] = value
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
  const flatten = (node, out = []) => {
    if (node === null || node === undefined || typeof node === 'boolean') return out
    if (Array.isArray(node)) {
      for (const child of node) flatten(child, out)
      return out
    }
    if (typeof node === 'string' || typeof node === 'number') {
      out.push({ text: String(node) })
      return out
    }
    if (node.type === 'style') return out
    // **展开函数组件**：这才是最小必要的"reconcile" —— 不展开的话 `SourceCard`/`EventRow`/
    // `HookRow` 的内部永远渲染不出来（第一版就踩了这个坑：断言看到 0 个事件名）。
    // 限制：只支持**不用 hook 的子组件**（本页只有最外层用 useState/useEffect）。
    if (typeof node.type === 'function') return flatten(node.type(node.props), out)
    const props = node.props ?? {}
    out.push({
      className: typeof props.className === 'string' ? props.className : '',
      title: typeof props.title === 'string' ? props.title : '',
      // `onClick` 要留着：渲染测试得能**真的点**它（§4.5：事件闭包是当次渲染的，点了要重新渲染再看）。
      onClick: typeof props.onClick === 'function' ? props.onClick : undefined,
      // 表单控件：渲染测试要能读到**当前值**并模拟输入（§4.5：输入后要重新渲染再看）。
      value: typeof props.value === 'string' ? props.value : undefined,
      onChange: typeof props.onChange === 'function' ? props.onChange : undefined,
    })
    flatten(node.children, out)
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

/** 渲染一次 + 跑完 effect 引发的重渲染。 */
async function renderSection(component, harness, respond) {
  globalThis.fetch = async () => ({ json: async () => respond })
  const pass = () => {
    harness.begin()
    return component()
  }
  let tree = pass()
  for (const effect of harness.store.effects) effect()
  // async IIFE 要跨好几个微任务才走到 setPhase；多让两轮宏任务过去。
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (harness.store.dirty) tree = pass()
  return harness.flatten(tree)
}

await test('D：真实渲染 —— 7 个事件全列、三态分别说清、状态色只来自台账', async () => {
  // 造一个"什么情况都有"的快照：三态文件各一个 + 四种状态的 hook。
  const run = (exitCode, decision) => ({ at: 1, exitCode, decision, durationMs: 12, stdout: '', stderr: 'out' })
  const hook = (rawIndex, command, extra = {}) => ({
    rawIndex,
    command,
    timeoutSec: null,
    defaultTimeoutSec: 600,
    disabled: false,
    lastRun: null,
    ...extra,
  })
  const groups = [
    {
      file: 'project',
      rawIndex: 0,
      matcher: 'pwsh',
      matcherOk: true,
      matcherProblem: null,
      hooks: [
        hook(0, 'echo never-run'),
        hook(1, 'echo ok', { lastRun: run(0, 'pass') }),
        hook(2, 'echo deny', { lastRun: run(0, 'deny') }),
        hook(3, 'echo off', { disabled: true }),
      ],
    },
  ]
  const fileOf = (kind, state, own = []) => {
    let hookCount = 0
    let disabledCount = 0
    for (const group of own) {
      for (const one of group.hooks) {
        if (one.disabled) disabledCount += 1
        else hookCount += 1
      }
    }
    return {
      kind,
      path: kind === 'user' ? 'C:/u/.dsh/hooks.json' : 'D:/proj/.dsh/hooks.json',
      state,
      message: state === 'error' ? 'FsError: cannot read text: Unexpected token {' : null,
      version: null,
      hookCount,
      skipped: [],
      matcherErrors: [],
      events: HOOK_EVENTS.map((event) => ({
        event,
        groups: event === 'PreToolUse' ? own : [],
        hookCount: event === 'PreToolUse' ? hookCount : 0,
        disabledCount: event === 'PreToolUse' ? disabledCount : 0,
        runCount: 0,
      })),
    }
  }
  const snapshot = {
    route: '/api/hooks',
    projectRoot: 'D:/proj',
    cwd: 'D:/proj',
    cwdSource: 'session',
    files: [fileOf('project', 'ok', groups), fileOf('user', 'error')],
    events: [],
    total: { hookCount: 4, disabledCount: 1, groupCount: 1 },
    staleInUse: false,
    capabilities: { writable: true },
  }

  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })
  const texts = nodes.filter((node) => node.text !== undefined).map((node) => node.text)
  // JSX 的 `{...}` 插值会变成**独立子节点**，所以像"生效 4 条"这种文案会被切成好几段；
  // 断言子串时要按文档顺序拼起来看（精确匹配事件名仍用 `texts`）。
  const joined = texts.join('')

  // ① 7 个事件**全列**（两张卡各 7 个）——"空"与"不存在"必须长得不一样（§3.6）
  for (const event of HOOK_EVENTS) {
    assert.equal(texts.filter((text) => text === event).length, 2, `${event} 必须在两张文件卡里都出现（含 0 条）`)
  }
  assert.ok(joined.includes('没有配置'), '0 条的事件必须明说"没有配置"，而不是消失')
  // ② 三态分别说清（§3.9）
  assert.ok(joined.includes('读不出来'), 'error 必须说"读不出来"（≠ 没有配置）')
  assert.ok(joined.includes('已读取'), 'ok 必须说"已读取"')
  assert.ok(!joined.includes('FsError'), '绝不把内部错误原文当文案 —— 本次渲染里它一次都不该出现')
  assert.ok(joined.includes('生效 4 条'), '总数必须来自快照')
  assert.ok(joined.includes('已停用'), '停用要有可见标签')

  // ③ 状态色**只**来自台账与 disabled（§3.8）
  const dots = nodes.filter((node) => typeof node.className === 'string' && node.className.includes('dsh-hooks__dot'))
  assert.equal(dots.length, 4, '每条 hook 恰好一个状态点')
  assert.ok(!dots[0].className.includes('--'), '没有记录 → 灰（"没报错就报绿"是被禁的）')
  assert.ok(dots[1].className.includes('--ok'), 'exitCode 0 + pass → 绿')
  assert.ok(dots[2].className.includes('--deny'), 'decision deny → 红')
  assert.ok(!dots[3].className.includes('--ok'), '已停用不许画绿')
  assert.ok(dots[0].title.includes('未运行'), '灰点必须能解释自己')
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

/** 造一份最小可用快照：项目级 1 条 hook + 用户级空（两份都是 `ok`，所以只有一个写入按钮）。 */
function minimalSnapshot() {
  const emptyEvents = HOOK_EVENTS.map((event) => ({ event, groups: [], hookCount: 0, disabledCount: 0, runCount: 0 }))
  return {
    route: '/api/hooks',
    projectRoot: 'D:/p',
    cwd: 'D:/p',
    cwdSource: 'session',
    files: [
      {
        kind: 'project',
        path: 'D:/p/.dsh/hooks.json',
        state: 'ok',
        message: null,
        version: 'v1',
        hookCount: 1,
        skipped: [],
        matcherErrors: [],
        events: HOOK_EVENTS.map((event) => ({
          event,
          groups:
            event === 'PreToolUse'
              ? [
                  {
                    file: 'project',
                    rawIndex: 0,
                    matcher: 'pwsh',
                    matcherOk: true,
                    matcherProblem: null,
                    hooks: [
                      {
                        rawIndex: 0,
                        command: 'echo a',
                        timeoutSec: null,
                        defaultTimeoutSec: 600,
                        disabled: false,
                        lastRun: null,
                      },
                    ],
                  },
                ]
              : [],
          hookCount: event === 'PreToolUse' ? 1 : 0,
          disabledCount: 0,
          runCount: 0,
        })),
      },
      {
        kind: 'user',
        path: 'C:/u/.dsh/hooks.json',
        state: 'ok',
        message: null,
        version: 'v1',
        hookCount: 0,
        skipped: [],
        matcherErrors: [],
        events: emptyEvents,
      },
    ],
    events: [],
    total: { hookCount: 1, disabledCount: 0, groupCount: 1 },
    staleInUse: false,
    capabilities: { writable: true },
  }
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

await test('D：点"停用"发的是定点写请求（file + 原始下标 + 目标值）', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const nodes = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })
  const buttons = writeButtons(nodes)
  assert.equal(buttons.length, 4, '可写时一行四个按钮：试运行、编辑、停用、删除（这里只有一条 hook）')

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
  buttonByLabel(nodes, '停用').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(calls[0].method, 'POST', '停用是一次写请求，不是又一次取数')
  assert.deepEqual(
    calls[0].body,
    { file: 'project', op: 'setHookDisabled', event: 'PreToolUse', groupIndex: 0, hookIndex: 0, disabled: true },
    '请求体只能是定点操作（绝不回传整份文件），且下标必须是**文件里的**下标',
  )
})

await test('D：写失败按错误码分别说清，且只渲染在页面级通道（§3.7/§3.9）', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const nodes = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })
  // 索引 1 是"停用"（索引 0 是"编辑"）—— 这里要触发的是写请求。
  const button = buttonByLabel(nodes, '停用')

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
  assert.ok(joined.includes('生效 1 条'), '失败**不**清空已有内容 —— 用户要对着旧内容决定下一步')
  const banners = after.filter((node) => typeof node.className === 'string' && node.className.includes('banner--error'))
  assert.equal(banners.length, 1, '一条错误只允许一个渲染点（§3.7）')
})

await test('D：行内编辑命令 —— 文本框里是当前命令，保存发的是定点写请求', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const first = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })

  // 没在编辑时：一行两个按钮（编辑、停用）
  const idle = writeButtons(first)
  assert.equal(idle.length, 4, '一行应当有"试运行"、"编辑"、"停用"、"删除"四个按钮')
  buttonByLabel(first, '编辑').onClick()

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
    calls[0].body,
    {
      file: 'project',
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

  const calls = []
  globalThis.fetch = async (_url: string, options: { method?: string; body?: string } = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return { json: async () => ({ ok: true, data: { file: 'project', version: 'v2' } }) }
  }

  // 第一步：点"删除"（索引 2）。**绝不能发请求**。
  buttonByLabel(first, '删除').onClick()
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
    calls[0].body,
    { file: 'project', op: 'removeHook', event: 'PreToolUse', groupIndex: 0, hookIndex: 0 },
    '删除也是定点操作：宿主拿这两个**文件下标**定位要删的那一条',
  )
})

await test('D：点"试运行"发 dryRun 请求，结果贴在这一行，且那一行仍然是灰的', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const first = await renderSection(component, harness, { ok: true, data: minimalSnapshot() })

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
  buttonByLabel(first, '试运行').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(calls.length, 1, '试运行只发一次请求')
  assert.deepEqual(
    calls[0].body,
    { op: 'dryRun', file: 'project', event: 'PreToolUse', groupIndex: 0, hookIndex: 0 },
    '试运行也是定点寻址（文件 + 事件 + 两个文件下标）',
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

await test('D：文件不存在时说"不存在"（不是"读不出来"），并给出"新建这个文件"', async () => {
  const harness = createFakeReact()
  const component = componentFromArtifact(harness.React)
  const snapshot = minimalSnapshot()
  // 用户级那份文件不存在 —— 这正是"用户删掉 hooks.json 之后"的状态。
  snapshot.files[1].state = 'absent'
  const nodes = await renderSection(component, harness, { ok: true, data: snapshot })
  const joined = nodes
    .filter((node) => node.text !== undefined)
    .map((node) => node.text)
    .join('')
  assert.ok(joined.includes('文件不存在'), '"不存在"必须**明说**，而不是让那一格空着')
  assert.ok(
    !joined.includes('读不出来'),
    '不存在 ≠ 读不出来：绝不能说成"读不出来"（用户会去修一个没坏的文件，§2.9/§3.9）',
  )
  assert.ok(joined.includes('已读取'), '同一页里另一份文件是好的，两种状态必须**同时**说得清')

  const calls = []
  globalThis.fetch = async (_url: string, options: { method?: string; body?: string } = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ method, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    return { json: async () => ({ ok: true, data: { file: 'user', version: 'v2' } }) }
  }
  buttonByLabel(nodes, '新建这个文件').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(calls.length, 1, '"新建"是一次写请求')
  assert.deepEqual(
    calls[0].body,
    { file: 'user', op: 'createFile' },
    '新建的必须是**那一份**不存在文件（用户级），不是项目级',
  )
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
    { event: 'PreToolUse', type: 'http' },
    { event: 'Stop', type: 'prompt' },
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
    files: [],
    events: [],
    total: { hookCount: 0, disabledCount: 0, groupCount: 0 },
    staleInUse: false,
    capabilities: { writable: false },
  }
  const data = body !== null && typeof body === 'object' && body.data ? body.data : emptyData
  return { status: response.status, body, data }
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
    sources: [],
    effective: {},
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
  assert.deepEqual(snapshot.total, { hookCount: 0, disabledCount: 0, groupCount: 0 })
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

await test('P：非法 matcher 在快照里被标出来（可分别说清，而不是静默消失）', () => {
  const groups = { PreToolUse: [{ matcher: '(', hooks: [{ command: 'a' }] }] }
  const snapshot = buildSnapshot(emptyInspection({ effective: groups }))
  const pre = snapshot.events.find((event) => event.event === 'PreToolUse')
  assert.equal(pre.groups.length, 1, '页面要能看见这个 group，才能告诉用户它为什么不跑')
  assert.equal(pre.groups[0].matcherOk, false)
  assert.ok(pre.groups[0].matcherProblem.includes('invalid regex matcher'))
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

//#region P4. 执行台账（状态色的唯一证据来源）+ 可寻址视图

/** 造一条台账记录。 */
function ledgerEntry(overrides = {}) {
  return {
    at: 1,
    sessionId: 's1',
    event: 'PreToolUse',
    command: 'c',
    exitCode: 0,
    decision: 'pass',
    durationMs: 1,
    stdout: '',
    stderr: '',
    ...overrides,
  }
}

test('L：台账有界（全局 500 / 单会话 200）、输出截断、匹配按 event+command', () => {
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
    latestRunFor(perSession.entries(), 'PreToolUse', 'c').at,
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
  assert.equal(latestRunFor(fresh.entries(), 'PreToolUse', 'old').command, 'old')
  assert.equal(latestRunFor(fresh.entries(), 'PreToolUse', 'new'), undefined, '命令改过 → 旧记录不匹配')
  assert.equal(latestRunFor(fresh.entries(), 'Stop', 'old'), undefined, '事件不同也不匹配')
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
  assert.deepEqual(style, { indent: '  ', eol: '\n', finalNewline: true })
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

test('W：新文件内容是"能被解析成空配置"的自解释形状', () => {
  const text = starterText({ indent: '  ', eol: '\n', finalNewline: true })
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

/**
 * dsh-hooks 构建脚本（P3b 起只有宿主目标；客户端目标在 P5 落地）。
 *
 *     node tools/build.ts      # 等价于 pnpm build
 *
 * ## 为什么必须 bundle 而不是 `tsc`
 * 宿主半边由 Loader 以 `file:///...` 绝对路径加载，**裸模块说明符解析不到**（都在 app.asar 里）。
 * 所以相对 import 必须被**内联进同一个文件** —— `tsc` 会留下 `import '../shared/constants.js'`，
 * 那样产物就加载不起来了。esbuild 的 `bundle: true` 解决的就是这一件事。
 *
 * ## 为什么还要写指纹
 * `lib/**` 是**提交进版本库**的产物。没有指纹的话，"产物是过期的"这件事无法被断言发现 ——
 * 自检会拿着旧产物全绿，而源码里刚修好的 bug 看起来"没修"。指纹记 sha256，自检重算比对。
 * 指纹里**不带时间戳**，保证可复现（CI 上能用 `git diff --exit-code lib/` 兜底）。
 *
 * ## 两个刻意的 esbuild 参数
 * - `charset: 'utf8'`：esbuild 默认把非 ASCII 转义成 `\uXXXX`，而本仓库的错误信息与注释
 *   全是中文 —— 转义之后所有"产物里必须出现某句中文"的断言会**静默失效**。
 * - `minify: false`：产物必须是可读、可断言的文本（常量名、错误串、注释都保留）。
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as esbuild from 'esbuild'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'lib')
const MANIFEST = join(LIB, '.build-manifest.json')
/** 本文件相对仓库根的路径（写进指纹用；`import.meta.url` 在类型剥离下也可靠）。 */
const BUILDER = 'tools/build.ts'

/** 产物头部的"不要手改"横幅。 */
const BANNER = [
  '/**',
  ' * ⚠️ 本文件由 tools/build.ts 从 src/** 生成 —— **不要直接编辑**。',
  ' * 手工改动会在下一次 `pnpm build` 时被静默覆盖（AGENTS §0）。',
  ' */',
].join('\n')

/** 递归列出目录下的文件，返回相对 ROOT 的 POSIX 路径（排序，保证指纹稳定）。 */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) out.push(relative(ROOT, full).split(sep).join('/'))
    }
  }
  await walk(join(ROOT, dir))
  return out.sort()
}

/** 单个文件的 sha256。 */
async function hashOf(relPath: string): Promise<string> {
  const content = await readFile(join(ROOT, relPath))
  return createHash('sha256').update(content).digest('hex')
}

/** 一次构建目标的结果。 */
interface TargetResult {
  output: string
  outputSha256: string
  inputs: Record<string, string>
}

/** 构建宿主半边 → lib/index.js。 */
async function buildHost(): Promise<TargetResult> {
  const inputs = [...(await listFiles('src/host')), ...(await listFiles('src/shared'))]
  const outfile = 'lib/index.js'
  await esbuild.build({
    entryPoints: [join(ROOT, 'src/host/index.ts')],
    outfile: join(ROOT, outfile),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    charset: 'utf8',
    minify: false,
    banner: { js: BANNER },
    logLevel: 'warning',
  })
  const fingerprints: Record<string, string> = {}
  for (const input of inputs) fingerprints[input] = await hashOf(input)
  return { output: outfile, outputSha256: await hashOf(outfile), inputs: fingerprints }
}

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as { name: string }

const targets: TargetResult[] = [await buildHost()]

const manifest = {
  tool: `esbuild@${esbuild.version}`,
  package: pkg.name,
  // 构建脚本**自己**也要进指纹：否则"改了 build.ts 忘了重建"是唯一抓不到的过期路径
  // （产物与源码都对得上，但生成方式已经变了）。自检 E 区会重算这个 sha256。
  builder: { path: BUILDER, sha256: await hashOf(BUILDER) },
  targets,
}
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

for (const target of targets) {
  console.log(
    `built ${target.output}  sha256=${target.outputSha256.slice(0, 12)}  inputs=${Object.keys(target.inputs).length}`,
  )
}
console.log(`manifest ${relative(ROOT, MANIFEST).split(sep).join('/')}`)

import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/** 只有这两半进类型检查；产物 / 工具 / 文档一律不进（工具的进度看 tsconfig.tools.wip.json）。 */
const TYPED = ['src/**/*.{ts,tsx}']

/**
 * 基础禁用语法。
 *
 * ⚠️ `no-restricted-syntax` 是**替换**而不是追加：后面的 override 必须把这几条重新列上，
 * 否则会静默失效（dsh-mcp-manager 的历史事故，见它的 eslint.config.js:20-24）。
 */
const BASE_RESTRICTED_SYNTAX = [
  {
    selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
    message: '禁止 dangerouslySetInnerHTML（官方 practices：不要往别人的 DOM 里塞 HTML）',
  },
  {
    selector: 'MemberExpression[object.name="document"][property.name="body"]',
    message: '禁止直接操作 document.body（官方 practices：不要往 body append）',
  },
  {
    selector: 'MemberExpression[object.name="window"][property.name="__ModuleLoader__"]',
    message: '禁止手写 window.__ModuleLoader__：loader wrapper 由 tools/build.ts 注入（AGENTS §2.2）',
  },
]

/**
 * 宿主半边零裸 import。
 *
 * 判据是**裸模块说明符**，不是"有没有 import"：相对 import 由打包器内联、
 * `import type` 被擦除，两者都允许（AGENTS §2.1）。
 */
const HOST_BARE_IMPORT = {
  selector: "ImportDeclaration[source.value=/^[^./]/]:not([importKind='type'])",
  message: '宿主半边零 import：裸模块说明符都在 app.asar 里，从磁盘路径解析不到（AGENTS §2.1）',
}

export default tseslint.config(
  {
    ignores: ['lib/**', 'node_modules/**', 'tools/**', 'docs/**', 'assets/**', '.github/**', '.tmp/**', '*.log'],
  },
  {
    files: TYPED,
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      // 不写死 project：新增 tsconfig 时这里不用改（projectService 自己找最近的 tsconfig）。
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // `import type` 要写成声明级（宿主那条裸 import 选择器只认声明级 import type）。
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

      // 宿主日志基本不可看（AGENTS §6），所以不许用 console 当"日志"。
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'no-restricted-syntax': ['error', ...BASE_RESTRICTED_SYNTAX],
    },
  },
  {
    files: ['src/host/**/*.ts'],
    rules: {
      // 必须重列基础项：这个规则是替换语义。
      'no-restricted-syntax': ['error', ...BASE_RESTRICTED_SYNTAX, HOST_BARE_IMPORT],
    },
  },
  {
    files: ['src/client/**/*.{ts,tsx}'],
    rules: {
      // Harness Client 包随版本变，运行时 require 它们会在升级后直接炸掉整个座位。
      // 类型 import 允许（会被擦除），值 import 禁止。
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@deepseek-ai/dsh-client-*', '@deepseek-ai/dsh-client-*/**'],
              allowTypeImports: true,
              message: '客户端半边不许运行时 require Harness Client 包：手写 CSS + 原生 DOM（AGENTS §3）',
            },
          ],
        },
      ],
    },
  },
)

/**
 * 客户端的**唯一** react 取值点。
 *
 * 为什么单独一个文件：产物里必须**只有一处** `require("react")`（自检会断言计数）。
 * 集中在这里还让"客户端只依赖这一个平台种子模块"这件事写在明面上 —— 官方 practices 明确
 * **禁止**运行时 require 其它 `@deepseek-ai/dsh-client-*` 包（eslint 也禁），所以除了 react，
 * 我们只用浏览器原生能力（`fetch` / DOM / `<style>`）。
 */
import * as React from 'react'

export const h = React.createElement
export const Fragment = React.Fragment
export const useCallback = React.useCallback
export const useEffect = React.useEffect
export const useMemo = React.useMemo
export const useState = React.useState

/**
 * 组件的返回类型。
 *
 * 用 `React.JSX.Element` 而不是全局 `JSX.Element`：后者在 @types/react 新版本里已标记
 * **deprecated**，eslint 的 `no-deprecated` 会当场打红。
 */
export type Jsx = React.JSX.Element

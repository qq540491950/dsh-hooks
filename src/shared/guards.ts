/**
 * 收窄工具：**不可信输入一律先收窄，禁止 `as` 硬转**。
 *
 * 这些函数不抛异常 —— 磁盘上的 JSON 是用户手写的，任何形状都可能出现，
 * 而"配置读坏了"绝不能把插件带崩（那就成了另一个 fail-open）。
 */

/** 非 null、非数组的对象。 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 从对象里读一个字符串字段；不是字符串就返回 undefined。 */
export function strField(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key]
  return typeof value === 'string' ? value : undefined
}

/** 从对象里读一个布尔字段；不是布尔就返回 undefined。 */
export function boolField(obj: Record<string, unknown>, key: string): boolean | undefined {
  const value = obj[key]
  return typeof value === 'boolean' ? value : undefined
}

/** 从对象里读一个正数字段（timeout 用）；非正数一律当"没写"。 */
export function positiveNumberField(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key]
  return typeof value === 'number' && value > 0 ? value : undefined
}

/** 把任意值拍成可读字符串（日志与错误消息用，绝不抛）。 */
export function messageOf(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') return error.message
  return String(error)
}

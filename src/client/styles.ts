/**
 * 页面样式。
 *
 * ## 为什么是"字符串 + React 元素"，而不是往 `document` 注入 `<style>`
 * 官方 `references/ui-plugin.md` 明确认可"组件局部样式以 React 元素渲染，卸载时随之移除"。
 * 这比 document 级注入更稳：不存在"`<style id>` 已存在就 return → 新加的 CSS 永远不出现"
 * 那个坑（AGENTS §3.2 记的正是那个坑），每次渲染都是新元素，天然是最新的。
 *
 * ## 纪律
 * - **绝不硬编码颜色**（§3.1）：只用 `var(--dsw-alias-*)`，十六进制只作 fallback。
 * - **面板靠底色分层，不加描边**（§3.11）：卡用 card-fill + card-stroke，面板无描边。
 * - 每个可收缩子项 `min-width: 0`；长路径 `overflow-wrap: anywhere`；长命令省略号（§3.12）。
 * - **不垫外层留白**（§3.12）：设置外壳已经有 `padding: 0 24px 24px`。
 */
export const styles = `
.dsh-hooks { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.dsh-hooks__head { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dsh-hooks__root { font-family: var(--dsw-font-mono, monospace); font-size: 12px; overflow-wrap: anywhere; color: var(--dsw-alias-text-secondary, inherit); }
.dsh-hooks__row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-hooks__muted { color: var(--dsw-alias-text-secondary, inherit); font-size: 12px; }
.dsh-hooks__banner { padding: 8px 10px; border-radius: 6px; font-size: 12px; background: var(--dsw-alias-bg-module-platform, rgba(127,127,127,.12)); }
.dsh-hooks__banner--warn { background: var(--dsw-alias-state-warning-background, rgba(200,150,0,.16)); }
.dsh-hooks__banner--error { background: var(--dsw-alias-state-error-background, rgba(200,60,60,.16)); }

.dsh-hooks__card { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 12px; border-radius: 8px;
  border: .5px solid var(--dsw-alias-settings-card-stroke, rgba(127,127,127,.25)); background: var(--dsw-alias-settings-card-fill, transparent); }
.dsh-hooks__cardhead { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex-wrap: wrap; }
.dsh-hooks__path { font-family: var(--dsw-font-mono, monospace); font-size: 12px; overflow-wrap: anywhere; min-width: 0; }
.dsh-hooks__count { font-size: 12px; color: var(--dsw-alias-text-secondary, inherit); flex: none; }

.dsh-hooks__events { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dsh-hooks__event { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.dsh-hooks__eventname { flex: none; font-size: 12px; font-weight: 600; min-width: 150px; }
.dsh-hooks__empty { color: var(--dsw-alias-text-secondary, inherit); font-size: 12px; }
.dsh-hooks__groups { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding-left: 10px;
  border-left: .5px solid var(--dsw-alias-settings-card-stroke, rgba(127,127,127,.25)); margin-left: 2px; }
.dsh-hooks__matcher { font-family: var(--dsw-font-mono, monospace); font-size: 12px; overflow-wrap: anywhere; }

.dsh-hooks__hook { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-hooks__cmd { font-family: var(--dsw-font-mono, monospace); font-size: 12px; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; min-width: 0; flex: 1 1 auto; }
.dsh-hooks__meta { flex: none; font-size: 12px; color: var(--dsw-alias-text-secondary, inherit); }
.dsh-hooks__dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-text-secondary, rgba(127,127,127,.6)); }
.dsh-hooks__dot--ok { background: var(--dsw-alias-state-success-primary, var(--dsw-alias-state-success-background, #3a3)); }
.dsh-hooks__dot--deny { background: var(--dsw-alias-state-error-primary, var(--dsw-alias-state-error-background, #c33)); }
.dsh-hooks__dot--warn { background: var(--dsw-alias-state-warning-primary, var(--dsw-alias-state-warning-background, #c93)); }
.dsh-hooks__tag { flex: none; font-size: 11px; padding: 1px 6px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform, rgba(127,127,127,.12)); }
.dsh-hooks__actions { display: flex; align-items: center; gap: 8px; flex: none; white-space: nowrap; }
.dsh-hooks__btn { font: inherit; font-size: 12px; padding: 2px 8px; border-radius: 6px; cursor: pointer; flex: none;
  border: .5px solid var(--dsw-alias-settings-card-stroke, rgba(127,127,127,.35)); background: transparent;
  color: var(--dsw-alias-text-primary, inherit); }
.dsh-hooks__btn:hover:not(:disabled) { background: var(--dsw-alias-bg-module-platform, rgba(127,127,127,.12)); }
.dsh-hooks__btn:disabled { opacity: .5; cursor: default; }
.dsh-hooks__editor { font-family: var(--dsw-font-mono, monospace); font-size: 12px; line-height: 1.4; min-width: 0;
  flex: 1 1 auto; resize: vertical; padding: 2px 6px; border-radius: 6px;
  border: .5px solid var(--dsw-alias-settings-card-stroke, rgba(127,127,127,.35));
  background: var(--dsw-alias-bg-module-platform, transparent); color: var(--dsw-alias-text-primary, inherit); }
`

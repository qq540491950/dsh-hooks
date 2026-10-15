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
 *
 * ## 新增 token 先核对（本轮）
 * `--dsw-alias-label-primary/secondary`、`--dsw-alias-border-l3`、`--dsw-alias-interactive-bg-hover`、
 * `--dsw-alias-button-primary-fill`、`--dsw-alias-brand-primary`、`--dsw-alias-settings-card-*`
 * 都在安装目录的官方 CSS（`dsh-client-ui-primitives` / `dsh-client-ui-agent-preset`）里出现过。
 * ⚠️ 已核对**不存在**的（因此永远落到 fallback）：`--dsw-alias-text-*`（旧类在用，见方案 §6.4 ——
 * 那批名字的清理照计划单独做，不和本轮功能混在一起）与 `--dsw-alias-state-warning-primary`。
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

/* ── 作用域选择 + 工具条（本轮新增；token 名逐个核对过安装目录里的官方用法） ── */
.dsh-hooks__toolbar { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.dsh-hooks__scope { display: flex; align-items: center; gap: 6px; flex: none; min-width: 0; }
.dsh-hooks__select { font: inherit; font-size: 12px; padding: 2px 6px; border-radius: 6px; max-width: 260px;
  border: .5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35));
  background: var(--dsw-alias-bg-module-platform, transparent); color: var(--dsw-alias-label-primary, inherit); }
.dsh-hooks__search { font: inherit; font-size: 12px; padding: 2px 8px; border-radius: 6px; min-width: 0; flex: 1 1 160px;
  border: .5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35));
  background: var(--dsw-alias-bg-module-platform, transparent); color: var(--dsw-alias-label-primary, inherit); }
.dsh-hooks__installed { font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); flex: none; }
.dsh-hooks__toolbarActions { display: flex; align-items: center; gap: 8px; flex: none; margin-left: auto; white-space: nowrap; }
/* 工具条按钮刻意**不复用** __btn：那个类同时被"行内动作按钮计数"的断言用着，混在一起会掩盖回归。 */
.dsh-hooks__toolbtn { font: inherit; font-size: 12px; padding: 2px 8px; border-radius: 6px; cursor: pointer; flex: none;
  border: .5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35)); background: transparent;
  color: var(--dsw-alias-label-primary, inherit); }
.dsh-hooks__toolbtn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dsh-hooks__toolbtn:disabled { opacity: .5; cursor: default; }
/* 「突出显示」的那一个（失败态里"该按哪个"）：填充 + 前景色成对取自官方 Button 的 primary 变体
   （button-primary-fill + label-primary-foreground）——
   只用 brand-primary 当背景会在深色主题下变成"近白底 + 近白字"（§3.1 记的正是这个坑）。 */
.dsh-hooks__toolbtn--primary { border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary));
  color: var(--dsw-alias-label-primary-foreground, inherit); }
.dsh-hooks__toolbtn--primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))); }

/* ── hook 卡列表 ── */
.dsh-hooks__list { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dsh-hooks__hookcard { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 8px 10px; border-radius: 8px;
  border: .5px solid var(--dsw-alias-settings-card-stroke, rgba(127,127,127,.25));
  background: var(--dsw-alias-settings-card-fill, transparent); }
.dsh-hooks__cardmain { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-hooks__detail { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dsh-hooks__detailRow { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }

/* ── 开关：轨道 + 旋钮，尺寸与配色全部进样式表（绝不 inline，§3.2） ── */
.dsh-hooks__switch { position: relative; flex: none; box-sizing: border-box; width: 32px; height: 18px; padding: 2px;
  border-radius: 999px; cursor: pointer; display: block;
  border: .5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35));
  background: var(--dsw-alias-bg-module-platform, rgba(127,127,127,.2)); }
.dsh-hooks__switch--on { background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary)); border-color: transparent; }
.dsh-hooks__switch:disabled { opacity: .5; cursor: default; }
.dsh-hooks__knob { display: block; width: 12px; height: 12px; border-radius: 50%;
  background: var(--dsw-alias-label-primary, #fff); transition: transform .12s ease; }
.dsh-hooks__switch--on .dsh-hooks__knob { transform: translateX(14px); }

/* ── 新建表单（错误只渲染在表单里，§3.7） ── */
.dsh-hooks__newform { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 10px; border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform, rgba(127,127,127,.08)); }
.dsh-hooks__newfield { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.dsh-hooks__newfield > .dsh-hooks__editor { flex: 1 1 240px; }
.dsh-hooks__newlabel { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); min-width: 56px; }
/* 表单里的文本输入（与工具条的搜索框**刻意不同类**：一个是过滤，一个是编辑字段）。 */
.dsh-hooks__input { font: inherit; font-size: 12px; padding: 2px 8px; border-radius: 6px; min-width: 0; flex: 0 1 220px;
  border: .5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35));
  background: var(--dsw-alias-bg-module-platform, transparent); color: var(--dsw-alias-label-primary, inherit); }
.dsh-hooks__newerror { padding: 6px 8px; border-radius: 6px; font-size: 12px;
  background: var(--dsw-alias-state-error-background, rgba(200,60,60,.16)); }

/* ── 折叠的只读「当前会话生效」（默认折叠，AGENTS §2.6） ── */
.dsh-hooks__effective { display: flex; flex-direction: column; gap: 6px; min-width: 0; align-items: flex-start; }
.dsh-hooks__effectivelist { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding-left: 10px;
  border-left: .5px solid var(--dsw-alias-settings-card-stroke, rgba(127,127,127,.25)); }
`

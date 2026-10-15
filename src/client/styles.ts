/**
 * 页面样式。
 *
 * ## 为什么是"字符串 + React 元素"，而不是往 `document` 注入 `<style>`
 * 官方 `references/ui-plugin.md` 明确认可"组件局部样式以 React 元素渲染，卸载时随之移除"。
 * 这比 document 级注入更稳：不存在"`<style id>` 已存在就 return → 新加的 CSS 永远不出现"
 * 那个坑（AGENTS §3.2 记的正是那个坑），每次渲染都是新元素，天然是最新的。
 *
 * ## 统一尺度（Fix C：用户说"整体风格乱" = 同一行里混了太多尺寸/对齐）
 *   - 控件高 **28px**（按钮 / 输入 / 下拉触发器 / 开关所在行都按它）；字号 **12px**（辅助）
 *     与 **13px**（正文/标题）；命令一律等宽 12px。
 *   - 圆角 **8px**（卡）/ **6px**（控件）；卡 padding `10px 12px`；图标格 28×28、圆角 6px。
 *   - 间距只用 **8 / 12 / 16** 三档（行内 `gap` 用 8，区块之间 12）。
 *   - 同一行里只允许一种行高：所有直接子项 `align-items:center` + 行 `min-height:28px`。
 *     **例外**：折叠里的 7 个事件行固定 **32px**（等距成一列，右侧 ghost 按钮不再忽高忽低）。
 *
 * ## 纪律
 * - **绝不硬编码颜色**（§3.1）：只用 `var(--dsw-alias-*)`，十六进制只作 fallback。
 * - **不写 inline 样式**（§3.2）；开关/卡的分层全部在这里。
 * - 每个可收缩子项 `min-width: 0`；长命令省略号；**不垫外层留白**（§3.12）。
 * - 卡**无描边**（靠 `settings-card-fill` 分层），hover 用 `interactive-bg-hover`。
 *   ⚠️ 这是对 §3.11 字面写法的一处**有意偏离**（§3.11 允许卡带 `settings-card-stroke`）：
 *   用户看真机截图后的原话是"整体风格乱"，卡描边 + 卡片内按钮描边叠起来正是"描边套描边"的画面。
 *   现在只留 fill 分层 + hover 底色，靠间距和圆角区分层级（记录在 README 的对应小节）。
 * - **描边按钮只允许出现在工具条**（`__toolbtn`，即 `↻ 刷新` / `＋ 新建`）。内容区（卡片动作 /
 *   折叠事件行 / 空状态 / 表单）一律走无描边的 `__btn`（ghost 或 primary）。这条有机器断言：
 *   `tools/verify.ts` 数 `__btn--outline`，收起态必须是 0（真机那屏就是 7 个描边小按钮 = 乱）。
 *
 * ## 新增 token 先核对（本轮）
 * `--dsw-alias-label-primary/secondary/tertiary`、`--dsw-alias-border-l3`、
 * `--dsw-alias-interactive-bg-hover`、`--dsw-alias-button-primary-fill`、
 * `--dsw-alias-button-primary-hover`、`--dsw-alias-label-primary-foreground`、
 * `--dsw-alias-brand-primary`、`--dsw-alias-bg-layer-3`、`--dsw-alias-settings-card-*`
 * 都在安装目录的官方 CSS（`dsh-client-ui-primitives` / `dsh-client-ui-agent-preset`）里出现过。
 * ⚠️ 已核对**不存在**的（因此永远落到 fallback）：`--dsw-alias-text-*` 与
 * `--dsw-alias-state-warning-primary`（方案 §6.4 把它们的清理划给单独一次提交，本轮不动）。
 */
export const styles = `
/* ── 页面骨架：只用 8/12/16 三档间距 ──
   max-width:720px 与同目录 dsh-skill-manager 的基准一致：设置面板内容区本身约 660px 宽，
   但在宽窗口 / 独立渲染时卡片不该被拉到满屏（预览里的第 ② 屏就是用来盯这件事的）。 */
.dsh-hooks { box-sizing:border-box; display:flex; flex-direction:column; gap:12px; min-width:0; max-width:720px;
  color:var(--dsw-alias-label-primary, inherit); font-size:13px; line-height:18px; }
.dsh-hooks *, .dsh-hooks *::before, .dsh-hooks *::after { box-sizing:border-box; }

/* ── 两行工具条 ── */
.dsh-hooks__toolbar { display:flex; align-items:center; gap:8px; min-width:0; min-height:28px; flex-wrap:wrap; }
.dsh-hooks__field { display:flex; align-items:center; gap:6px; min-width:0; flex:none; }
.dsh-hooks__label { flex:none; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__count { flex:none; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__installed { flex:none; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }
/* 「当前会话生效 N 条」：一条**行内**短句，不是横幅（用户反馈"堆叠横幅"是噪音）。 */
.dsh-hooks__session { flex:1 1 auto; min-width:0; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, inherit)); }
.dsh-hooks__actions { display:flex; align-items:center; gap:8px; flex:none; white-space:nowrap; }
.dsh-hooks__toolbarActions { display:flex; align-items:center; gap:8px; flex:none; margin-left:auto; white-space:nowrap; }

/* ── 控件：统一 28px 高 / 12px 字 / 6px 圆角 ──
   **描边按钮只允许出现在工具条**（__toolbtn）与输入类控件上。内容区（卡片动作 / 折叠区 /
   空状态 / 表单）一律走无描边的 ghost 文字按钮 —— 用户看真机截图的原话是"乱"，
   而"每行右边一个描边小按钮"正是那个乱的主要来源（7 个事件行 = 7 个描边按钮）。 */
.dsh-hooks__toolbtn, .dsh-hooks__trigger, .dsh-hooks__input, .dsh-hooks__search {
  font:inherit; font-size:12px; line-height:1; height:28px; padding:0 10px; border-radius:6px;
  display:inline-flex; align-items:center; gap:6px; min-width:0;
  border:.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35)); background:transparent;
  color:var(--dsw-alias-label-primary, inherit); }
.dsh-hooks__btn {
  font:inherit; font-size:12px; line-height:1; height:28px; padding:0 8px; border-radius:6px;
  display:inline-flex; align-items:center; gap:6px; min-width:0; border:0; background:transparent;
  color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__btn, .dsh-hooks__toolbtn, .dsh-hooks__trigger { cursor:pointer; flex:none; }
.dsh-hooks__btn:hover:not(:disabled), .dsh-hooks__toolbtn:hover:not(:disabled), .dsh-hooks__trigger:hover:not(:disabled) {
  background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
/* ghost：次要色，**hover 才转主色**（安静，但鼠标一到就亮起来）。显式类名让"这一行是 ghost"
   在 DOM 里可断言（D 区按它数）。 */
.dsh-hooks__btn--ghost { color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__btn--ghost:hover:not(:disabled) { color:var(--dsw-alias-label-primary, inherit); }
/* 醒目动作（空状态的主按钮 / 表单提交）：填充 + 前景色**成对**取自官方 Button 的 primary 变体 ——
   只用 brand-primary 当背景会在深色主题下变成"近白底 + 近白字"（§3.1 记的正是这个坑）。 */
.dsh-hooks__btn--primary { border-color:transparent;
  background:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary));
  color:var(--dsw-alias-label-primary-foreground, inherit); }
.dsh-hooks__btn--primary:hover:not(:disabled) {
  background:var(--dsw-alias-button-primary-hover, var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))); }
/* ⚠️ --outline 是**显式的描边修饰符**，内容区一律不许用。它保留在这里的唯一目的是让
   "内容区不许有描边按钮"这条纪律**可被机器断言**：tools/verify.ts 的 D 区直接数
   __btn--outline（收起态必须是 0），加一个上去就当场红。工具条的描边走 __toolbtn。 */
.dsh-hooks__btn--outline { border:.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35)); }
.dsh-hooks__btn:disabled, .dsh-hooks__toolbtn:disabled { opacity:.5; cursor:default; }
/* 卡内动作按钮（hover/聚焦才显形；DOM 里始终在 —— 键盘用户靠 :focus-within 也能到达）。
   它们**不参与** 28px 的行高：卡内用 24px，视觉更轻。 */
.dsh-hooks__actions .dsh-hooks__btn { height:24px; padding:0 8px; opacity:0; }
.dsh-hooks__hookcard:hover .dsh-hooks__actions .dsh-hooks__btn,
.dsh-hooks__hookcard:focus-within .dsh-hooks__actions .dsh-hooks__btn { opacity:1; }
/* 「突出显示」的那一个（失败态里"该按哪个"）：填充 + 前景色成对取自官方 Button 的 primary 变体
   （button-primary-fill + label-primary-foreground）——只用 brand-primary 当背景会在深色主题下
   变成"近白底 + 近白字"（§3.1 记的正是这个坑）。 */
.dsh-hooks__toolbtn--primary { border-color:transparent;
  background:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary));
  color:var(--dsw-alias-label-primary-foreground, inherit); }
.dsh-hooks__toolbtn--primary:hover:not(:disabled) {
  background:var(--dsw-alias-button-primary-hover, var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))); }
.dsh-hooks__search { flex:1 1 180px; }
.dsh-hooks__input { flex:0 1 220px; }
.dsh-hooks__input::placeholder, .dsh-hooks__search::placeholder {
  color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, inherit)); }
.dsh-hooks__muted { font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__path { font-family:ui-monospace, monospace; font-size:12px; overflow-wrap:anywhere; min-width:0;
  color:var(--dsw-alias-label-secondary, inherit); }

/* ── 作用域 popover（自绘；分组 + 当前项打勾 + 键盘 + 点外部关闭） ── */
.dsh-hooks__popoverwrap { position:relative; min-width:0; flex:none; }
.dsh-hooks__trigger { max-width:280px; }
.dsh-hooks__triggerlabel { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-hooks__caret { flex:none; font-size:10px; color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__backdrop { position:fixed; inset:0; z-index:40; }
/* 工作区一多（8+ 个）popover 会超出屏幕高度 → 给它在**自己内部**滚动，而不是靠页面滚。
   overscroll-behavior:contain 防止滚到底之后把滚动"传给"底下的页面（滚动链）。 */
.dsh-hooks__popover { position:absolute; z-index:41; top:100%; left:0; margin-top:4px; min-width:220px; max-width:320px; padding:4px;
  max-height:320px; overflow-y:auto; overscroll-behavior:contain;
  border-radius:8px; border:.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-layer-3, var(--dsw-alias-settings-card-fill, #2a2a2a));
  box-shadow:var(--dsw-shadow-lv3, 0 8px 24px rgba(0,0,0,.28)); }
.dsh-hooks__group { padding:6px 8px 2px; font-size:11px;
  color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, inherit)); }
.dsh-hooks__option { display:flex; align-items:center; gap:8px; width:100%; height:28px; padding:0 8px; border:0; border-radius:6px;
  background:transparent; color:var(--dsw-alias-label-primary, inherit); font:inherit; font-size:12px; text-align:left; cursor:pointer; }
.dsh-hooks__option--active { background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dsh-hooks__optionlabel { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-hooks__check { flex:none; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }

/* ── 一条 hook 一张卡：无描边、靠底色分层 + hover 底色 ── */
.dsh-hooks__list { display:flex; flex-direction:column; gap:8px; min-width:0; }
.dsh-hooks__hookcard { display:flex; flex-direction:column; gap:6px; min-width:0; padding:10px 12px; border-radius:8px;
  background:var(--dsw-alias-settings-card-fill, rgba(127,127,127,.06)); border:0; }
.dsh-hooks__hookcard:hover { background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dsh-hooks__cardmain { display:flex; align-items:center; gap:12px; min-width:0; }
.dsh-hooks__icon { flex:none; width:28px; height:28px; border-radius:6px; display:flex; align-items:center; justify-content:center;
  font-family:ui-monospace, monospace; font-size:12px; font-weight:600;
  background:var(--dsw-alias-bg-module-platform, rgba(127,127,127,.12));
  color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__cardtext { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1 1 auto; }
.dsh-hooks__eventname { font-size:13px; font-weight:500; line-height:18px; min-width:0;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-hooks__cmd { font-family:ui-monospace, monospace; font-size:12px; line-height:16px; min-width:0;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__tag { flex:none; font-size:11px; padding:1px 6px; border-radius:999px;
  background:var(--dsw-alias-bg-module-platform, rgba(127,127,127,.12)); color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__meta { flex:none; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__detailRow { display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:wrap; }
.dsh-hooks__editor { font-family:ui-monospace, monospace; font-size:12px; line-height:16px; min-width:0; flex:1 1 240px;
  resize:vertical; padding:6px 8px; border-radius:6px;
  border:.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-module-platform, transparent); color:var(--dsw-alias-label-primary, inherit); }
.dsh-hooks__dry { font-size:12px; color:var(--dsw-alias-label-secondary, inherit); overflow-wrap:anywhere; }

/* ── 状态点（颜色只能来自台账 / disabled，§3.8） ── */
.dsh-hooks__dot { flex:none; width:8px; height:8px; border-radius:50%;
  background:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, rgba(127,127,127,.6))); }
.dsh-hooks__dot--ok { background:var(--dsw-alias-state-success-primary, var(--dsw-alias-state-success-background, #3a3)); }
.dsh-hooks__dot--deny { background:var(--dsw-alias-state-error-primary, var(--dsw-alias-state-error-background, #c33)); }
.dsh-hooks__dot--warn { background:var(--dsw-alias-state-warning-primary, var(--dsw-alias-state-warning-background, #c93)); }

/* ── 开关：36×20、旋钮 16（参考图尺度），语义仍是 role="switch" ── */
.dsh-hooks__switch { position:relative; flex:none; width:36px; height:20px; padding:2px; border-radius:999px; cursor:pointer;
  border:.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-module-platform, rgba(127,127,127,.2)); }
.dsh-hooks__switch--on { background:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary)); border-color:transparent; }
.dsh-hooks__switch:disabled { opacity:.5; cursor:default; }
.dsh-hooks__knob { display:block; width:16px; height:16px; border-radius:50%; transition:transform .12s ease;
  background:var(--dsw-alias-label-primary-foreground, #fff); }
.dsh-hooks__switch--on .dsh-hooks__knob { transform:translateX(16px); }

/* ── 唯一的提示行（0–1 条；不再堆叠横幅） ── */
.dsh-hooks__alert { display:flex; align-items:flex-start; gap:8px; padding:8px 10px; border-radius:6px; font-size:12px;
  line-height:18px; background:var(--dsw-alias-state-warning-background, rgba(200,150,0,.16)); }
.dsh-hooks__alert--error { background:var(--dsw-alias-state-error-background, rgba(200,60,60,.16)); }
.dsh-hooks__alert--info { background:var(--dsw-alias-bg-module-platform, rgba(127,127,127,.12)); }
.dsh-hooks__strong { font-weight:600; }

/* ── 空状态块（一个作用域一条 hook 都没有时替代主列表）──
   底色分层、**无描边**（§3.11：描边套描边就是"乱"的来源）；引导条不带分隔线，只靠间距。 */
.dsh-hooks__empty { display:flex; flex-direction:column; gap:8px; min-width:0; padding:12px; border-radius:8px;
  background:var(--dsw-alias-settings-card-fill, rgba(127,127,127,.06)); border:0; }
.dsh-hooks__emptytitle { font-size:13px; font-weight:500; line-height:18px; min-width:0; }
.dsh-hooks__emptyactions { display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:wrap; }
.dsh-hooks__emptyguide { display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:wrap; }

/* ── 折叠区（全部事件 / 诊断）：默认收起，一行一个开关 ── */
.dsh-hooks__folds { display:flex; align-items:center; gap:12px; min-width:0; flex-wrap:wrap; }
.dsh-hooks__disclosure { display:flex; align-items:center; gap:6px; border:0; background:transparent; cursor:pointer;
  font:inherit; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); padding:0; }
.dsh-hooks__disclosure:hover { color:var(--dsw-alias-label-primary, inherit); }
.dsh-hooks__foldbody { display:flex; flex-direction:column; gap:8px; min-width:0; padding:10px 12px; border-radius:8px;
  background:var(--dsw-alias-settings-card-fill, rgba(127,127,127,.06)); }
/* 事件行：**行高固定 32px**（7 行等距，扫起来是"一张表"而不是"一堆按钮"），
   右侧的「＋新建」是 ghost 文字按钮（无描边）。中间那格占满剩余宽度 ⇒ 按钮被推到行尾、对齐成一列。 */
.dsh-hooks__eventrow { display:flex; align-items:center; gap:8px; min-width:0; height:32px; }
.dsh-hooks__eventrow > .dsh-hooks__muted, .dsh-hooks__eventrow > .dsh-hooks__count {
  flex:1 1 auto; min-width:0; }
.dsh-hooks__eventname--fold { flex:none; min-width:150px; }
.dsh-hooks__diagrow { display:flex; gap:8px; min-width:0; }
.dsh-hooks__diagkey { flex:none; min-width:96px; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__diagval { font-size:12px; min-width:0; overflow-wrap:anywhere; }

/* ── 新建表单（错误只渲染在表单里，§3.7） ── */
.dsh-hooks__newform { display:flex; flex-direction:column; gap:8px; min-width:0; padding:12px; border-radius:8px;
  background:var(--dsw-alias-settings-card-fill, rgba(127,127,127,.06)); }
.dsh-hooks__newfield { display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:wrap; }
.dsh-hooks__newfield > .dsh-hooks__editor { flex:1 1 240px; }
.dsh-hooks__newlabel { flex:none; min-width:56px; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__newerror { padding:8px 10px; border-radius:6px; font-size:12px; line-height:18px;
  background:var(--dsw-alias-state-error-background, rgba(200,60,60,.16)); }
.dsh-hooks__select { font:inherit; font-size:12px; line-height:1; height:28px; padding:0 6px; border-radius:6px; max-width:260px;
  border:.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-module-platform, transparent); color:var(--dsw-alias-label-primary, inherit); }
`

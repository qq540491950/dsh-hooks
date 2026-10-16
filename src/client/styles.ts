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
 *     与 **13px**（正文/标题）；命令一律等宽 12px；事件名后面的英文枚举 11px。
 *   - 圆角 **8px**（卡）/ **6px**（控件）；卡 padding `10px 12px`；槽位 28×28、圆角 6px。
 *   - **区块之间只有 12 / 16 两档**（`.dsh-hooks` 的 `gap:12px`；同层级内部的行/卡间距用 8，
 *     那是"一组兄弟"而不是"两个区块"）。
 *   - 同一行里只允许一种行高：所有直接子项 `align-items:center` + 行 `min-height:28px`。
 *     **例外**：折叠里的 7 个事件行固定 **32px**（等距成一列，右侧的 `＋` 不再忽高忽低）。
 *   - **同级只用一种字符风格**：折叠开关 `▸/▾`、动作 `＋/↻`、勾选 `✓` —— 不再混 `+` / `>` 之类。
 *
 * ## 纪律
 * - **绝不硬编码颜色**（§3.1）：只用 `var(--dsw-alias-*)`，十六进制只作 fallback。
 * - **不写 inline 样式**（§3.2）；分层全部在这里。
 * - 每个可收缩子项 `min-width: 0`；长命令省略号；**不垫外层留白**（§3.12）。
 * - **卡 = 官方卡片配方**：`settings-card-stroke`（可见的发丝描边）+ `settings-card-fill`（兜底填充）
 *   + `--dsw-radius-xl`（20px），与 `agent-preset` / `settings-models` / `settings-plugin-inventory`
 *   三个官方包一致。⚠️ 上一轮曾经"靠 fill 分层、去掉描边"（当时的理由是"描边套描边 = 乱"）——
 *   真机上 `settings-card-fill` = `bg-layer-2` = **与设置面板底色逐位相同（ΔRGB 0）**，等于什么都
 *   没画；`stroke` = `border-l4` = `#fff3` 叠上去 = `#565658`（ΔRGB 126）。**该偏离已撤销**，
 *   理由是实测（`hooks-fidelity` 的逐像素 token 事实表），不是审美。
 * - **折叠区 / 诊断区走另一套官方语言**：只画分隔线（`border-bottom:.5px solid var(--dsw-alias-border-l2)`，
 *   ΔRGB 77），不加底色、不加圆角、不加卡片描边 —— 卡片语言与分隔线语言**不混在同一层**。
 * - **描边按钮只允许出现在工具条**（`__toolbtn`，即 `↻ 刷新` / `＋ 新建`）。内容区（卡片动作 /
 *   折叠事件行 / 空状态 / 表单）一律走无描边的 `__btn`（ghost 或 primary）。这条有机器断言：
 *   `tools/verify.ts` 数 `__btn--outline`，收起态必须是 0（真机那屏就是 7 个描边小按钮 = 乱）。
 *
 * ## token 必须先核对（判据 = 官方 theme 的 token 表，不是"看着像"）
 * 判据文件：安装目录 asar 里 `@deepseek-ai/dsh-client-ui-theme/lib/client.js` 的
 * `base_css_default`（第 1142 行，`body{--dsw-alias-…}` 两套：亮色 + `body[data-ds-dark-theme]`）
 * 与 `design_platform_css_default`（第 1148 行，`--dsw-static-*` 调色板）。
 * 已核对**有定义**：`label-primary/secondary/tertiary`、`label-primary-foreground`、`border-l2/l3/l4`、
 * `interactive-bg-hover/active`、`bg-layer-1/2/3`、`bg-module-platform`、`settings-card-fill/stroke`、
 * `button-primary-fill/hover`、`brand-primary`、`state-success-primary`、`state-error-primary`、
 * `state-warn-primary`、`state-warn-tertiary`、`shadow-lv3`、`radius-xl`。
 * ⚠️ 已核对**一处定义都没有**（真机永远走 fallback —— 黄横幅实测底色 `#453d27` 就是 fallback 在
 * 起作用）：`--dsw-alias-state-warning-primary`、`--dsw-alias-state-warning-background`、
 * `--dsw-alias-state-error-background`、`--dsw-alias-state-success-background`、
 * `--dsw-alias-state-ok-*`、`--dsw-alias-interactive-bg-pressed`、`--dsw-alias-text-*`。
 * 官方真名分别是 `state-warn-primary` / `state-warn-tertiary` / （错误底无变体，用官方
 * `Tag[data-tone=danger]` 的 `color-mix` 配方）/ `state-success-*` / `interactive-bg-active`。
 * `tools/verify.ts` 的 D35 对这份名单做**否定断言**（注释里写名字可以，声明里写就不行）。
 */
export const styles = `
/* ── 页面骨架：区块之间只有 12 / 16 两档间距 ──
   max-width:720px 与同目录 dsh-skill-manager 的基准一致。
   ⚠️ 设置面板的**内容区真宽是 564px**（panel 800 / 导航 188 / 内容 padding:0 24px 24px，
   由 hooks-fidelity 在真机截图上逐像素量出）—— 离线自查截图必须按 564px 渲染，按 660/612 做出来
   的换行位置全是错的（上一轮"预览看着对、真机不对"的根因就是这个）。
   ⚠️ 本模板字符串里**不许出现反引号**：会提前结束模板，esbuild 报的是 CSS 语法错（离现场很远）。 */
.dsh-hooks { box-sizing:border-box; display:flex; flex-direction:column; gap:12px; min-width:0; max-width:720px;
  color:var(--dsw-alias-label-primary, inherit); font-size:13px; line-height:18px; }
.dsh-hooks *, .dsh-hooks *::before, .dsh-hooks *::after { box-sizing:border-box; }

/* ── 工具条**只有一行**（v3）；第二行是一句人话（.dsh-hooks__metaline，次要色、12px） ──
   .dsh-hooks__spacer 是唯一的"把后面的东西推到右边"的手段（工具条的 刷新/新建、第二行的
   会话口径都靠它）—— 同一条纪律不要用两种写法（真机截图里"第一行有刷新、第二行有计数"的错位
   就是两行各自为政造成的）。 */
.dsh-hooks__toolbar { display:flex; align-items:center; gap:8px; min-width:0; min-height:28px; flex-wrap:wrap; }
.dsh-hooks__metaline { display:flex; align-items:center; gap:12px; min-width:0; min-height:18px; }
.dsh-hooks__spacer { flex:1 1 auto; min-width:0; }
.dsh-hooks__field { display:flex; align-items:center; gap:6px; min-width:0; flex:none; }
.dsh-hooks__label { flex:none; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__count { flex:none; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__filecount { flex:none; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }
/* 「本会话生效 N 个」：一条**行内**短句，不是横幅（用户反馈"堆叠横幅"是噪音）。
   它只在"和屏幕上这一份不是同一件事"时渲染（见 section.tsx 的 sessionLineNeeded）。 */
.dsh-hooks__session { flex:none; min-width:0; max-width:100%; font-size:12px; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, inherit)); }
.dsh-hooks__actions { display:flex; align-items:center; gap:8px; flex:none; white-space:nowrap; }
.dsh-hooks__toolbarActions { display:flex; align-items:center; gap:8px; flex:none; white-space:nowrap; }

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
/* 卡内动作按钮（v4：它们只在「⋯」展开的块里）。**不再靠 hover 显形** —— 菜单是用户主动点开的，
   里面的按钮就必须立刻看得见（v3 是 opacity:0 + :hover 才显形，因为那时它们常驻一行）。
   卡内用 24px，比工具条的 28px 轻一档。 */
.dsh-hooks__cardmenu .dsh-hooks__btn { height:24px; padding:0 8px; }
/* 「⋯」（每张卡右上角）：24×24 的字形按钮，安静但不隐形。刻意**不用** __btn 类 ——
   D 区按 __btn 数"这一行有几个动作按钮"，把「⋯」混进去那条计数就测错了对象。 */
.dsh-hooks__morebtn { flex:none; width:24px; height:24px; padding:0; border:0; border-radius:6px; cursor:pointer;
  display:inline-flex; align-items:center; justify-content:center; font:inherit; font-size:14px; line-height:1;
  background:transparent; color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__morebtn:hover:not(:disabled) { color:var(--dsw-alias-label-primary, inherit);
  background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dsh-hooks__morebtn:disabled { opacity:.5; cursor:default; }
/* 「突出显示」的那一个（失败态里"该按哪个"）：填充 + 前景色成对取自官方 Button 的 primary 变体
   （button-primary-fill + label-primary-foreground）——只用 brand-primary 当背景会在深色主题下
   变成"近白底 + 近白字"（§3.1 记的正是这个坑）。 */
.dsh-hooks__toolbtn--primary { border-color:transparent;
  background:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary));
  color:var(--dsw-alias-label-primary-foreground, inherit); }
.dsh-hooks__toolbtn--primary:hover:not(:disabled) {
  background:var(--dsw-alias-button-primary-hover, var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))); }
.dsh-hooks__search { flex:0 1 200px; }
.dsh-hooks__input { flex:0 1 220px; }
.dsh-hooks__input::placeholder, .dsh-hooks__search::placeholder {
  color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, inherit)); }
.dsh-hooks__muted { font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }
/* ★ **盘符路径的口径**（v4 收紧）：盘符路径只允许出现在**一处** —— 「更多」折叠里的诊断行
   （用 __diagval）。v3 里空状态块也算一处（.dsh-hooks__path 一行字），现在不算了：
   它只进「新建配置文件」按钮的 title。正文其它地方一律不许出现。
   D 区有断言守着"正常态**与空状态**的首屏可见文本都不含盘符路径"。 */

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

/* ── 一条 hook 一张卡：**官方卡片配方**（agent-preset / settings-models /
   settings-plugin-inventory 三个官方包是同一套原文）──
       border: .5px solid var(--dsw-alias-settings-card-stroke);   ← 可见性全在这里
       background: var(--dsw-alias-settings-card-fill);            ← 与面板同色（等于没有）
       border-radius: var(--dsw-radius-xl);                        ← 官方 20px
   ⚠️ 上一轮曾经"靠底色分层、去掉描边"（当时以为描边套描边是"乱"的来源）—— 在真机上
   settings-card-fill 解析成 bg-layer-2，**与设置面板底色逐位相同（ΔRGB 0）**，于是卡片
   什么都没画。hooks-fidelity 逐像素量过：stroke = border-l4 = #fff3 叠在 #2c2c2e 上
   = #565658（ΔRGB 126）。所以**撤销那次偏离**，回到 AGENTS §3.11 的写法。
   hover 底色仍然用 interactive-bg-hover（#ffffff14 → #3d3d3e，Δ49）。 */
.dsh-hooks__list { display:flex; flex-direction:column; gap:8px; min-width:0; }
.dsh-hooks__hookcard { display:flex; flex-direction:column; gap:6px; min-width:0; padding:10px 12px;
  border-radius:var(--dsw-radius-xl, 20px);
  background:var(--dsw-alias-settings-card-fill, rgba(127,127,127,.06));
  border:.5px solid var(--dsw-alias-settings-card-stroke, rgba(127,127,127,.35)); }
.dsh-hooks__hookcard:hover { background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dsh-hooks__cardmain { display:flex; align-items:center; gap:12px; min-width:0; }
/* 28×28 槽位：装**状态点**（v3 起不再装事件首字母 —— 事件名中文化之后那个字母没有信息量，
   而状态色正好需要一个位置；颜色仍然只来自台账 / disabled，§3.8）。
   槽位底色用 bg-module-platform（真机 #353638，比卡片底 #2c2c2e 亮一档，ΔRGB 29）。 */
.dsh-hooks__slot { flex:none; width:28px; height:28px; border-radius:6px; display:flex; align-items:center; justify-content:center;
  background:var(--dsw-alias-bg-module-platform, rgba(127,127,127,.12)); }
.dsh-hooks__slot .dsh-hooks__dot { width:10px; height:10px; }
.dsh-hooks__cardtext { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1 1 auto; }
.dsh-hooks__eventname { font-size:13px; font-weight:500; line-height:18px; min-width:0;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* 中文名是主、英文枚举是次要（mono、11px、第三级色）：用户查文档 / 配 hooks.json 时需要原文，
   但**主文案**不该是一个英文枚举（用户原话"不像面向用户看的"）。 */
.dsh-hooks__eventid { margin-left:6px; font-family:ui-monospace, monospace; font-size:11px; font-weight:400;
  color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, inherit)); }
.dsh-hooks__cmd { font-family:ui-monospace, monospace; font-size:12px; line-height:16px; min-width:0;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__tag { flex:none; font-size:11px; padding:1px 6px; border-radius:999px;
  background:var(--dsw-alias-bg-module-platform, rgba(127,127,127,.12)); color:var(--dsw-alias-label-secondary, inherit); }
/* 「不会运行」标签（matcher 非法）：**例外态**才出现，所以它允许在这一屏多占一点位置。
   颜色走官方 state-warn-primary（token 名以官方 theme 表为准，见本文件开头的核对名单）。 */
.dsh-hooks__tag--warn { color:var(--dsw-alias-state-warn-primary, #c93); }
/* 正文里那**一个**状态词（未运行 / 通过 / 失败 / 已阻断）。它旁边就是状态点，
   所以这里的颜色不承担语义（颜色在点上；词是给色觉障碍与纯文本渲染的答案）。 */
.dsh-hooks__status { flex:none; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }
/* 「⋯」展开出来的那一块：左边一句"匹配 X · 超时 Y"，右边三个动作。 */
.dsh-hooks__cardmenu { display:flex; align-items:center; gap:8px; min-width:0; min-height:24px; flex-wrap:wrap; }
.dsh-hooks__meta { flex:none; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__detailRow { display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:wrap; }
.dsh-hooks__editor { font-family:ui-monospace, monospace; font-size:12px; line-height:16px; min-width:0; flex:1 1 240px;
  resize:vertical; padding:6px 8px; border-radius:6px;
  border:.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-module-platform, transparent); color:var(--dsw-alias-label-primary, inherit); }
.dsh-hooks__dry { font-size:12px; color:var(--dsw-alias-label-secondary, inherit); overflow-wrap:anywhere; }

/* ── 状态点（颜色只能来自台账 / disabled，§3.8）──
   ⚠️ token 名以官方 theme 表为准（dsh-client-ui-theme/lib/client.js 的 base_css_default）：
   警告族写作 **state-warn-**，成功族是 **state-success-**。过去写的
   state-warning-primary / state-success-background 等名字官方**一处定义都没有** ⇒ 真机上
   永远走 fallback（黄横幅实测底色 #453d27 就是 fallback 在起作用）。 */
.dsh-hooks__dot { flex:none; width:8px; height:8px; border-radius:50%;
  background:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, rgba(127,127,127,.6))); }
.dsh-hooks__dot--ok { background:var(--dsw-alias-state-success-primary, #3a3); }
.dsh-hooks__dot--deny { background:var(--dsw-alias-state-error-primary, #c33); }
.dsh-hooks__dot--warn { background:var(--dsw-alias-state-warn-primary, #c93); }

/* ── 开关：36×20、旋钮 16，语义仍是 role="switch" —— **照官方 Switch.module.css 的原文**：
   关：轨道 border-l3（#ffffff29 → #4e4e50）、旋钮 switch-thumb（#adb2b8）；
   开：轨道 brand-primary（深色下 = #f9fafb 近白药丸）、旋钮 label-primary-foreground（#0f1115）。
   真机截图量到的正是"白色药丸 + 近黑旋钮"，这样两种状态都有足够对比度（旧版关态旋钮也是近黑，
   在 #353638 轨道上几乎看不见）。 */
.dsh-hooks__switch { position:relative; flex:none; width:36px; height:20px; padding:2px; border-radius:999px; cursor:pointer;
  border:0; background:var(--dsw-alias-border-l3, rgba(127,127,127,.35)); }
.dsh-hooks__switch--on { background:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary)); }
.dsh-hooks__switch:disabled { opacity:.5; cursor:default; }
.dsh-hooks__knob { display:block; width:16px; height:16px; border-radius:50%; transition:transform .12s ease;
  background:var(--dsw-alias-switch-thumb, #adb2b8); }
.dsh-hooks__switch--on .dsh-hooks__knob { transform:translateX(16px);
  background:var(--dsw-alias-label-primary-foreground, #0f1115); }

/* ── 唯一的提示行（0–1 条；不再堆叠横幅） ──
   ⚠️ 基类**只有布局、没有底色**。两种 tone：
   - --info（非当前工作区 / 只读）＝ **中性信息行**：无底色、次要色文字 + ghost 动作。
     过去它是黄底两行 + 绝对路径 + "报 sandbox 属预期"，用户的原话是"太差了"；而那个黄底
     其实来自**不存在的 token**（state-warning-background 官方 0 定义 ⇒ 走 fallback）。
   - --error（真错误）＝ 官方 Tag[data-tone=danger] 的配方：
     color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)
     （官方无 state-error-background 这个变体，不许自己配 rgba）。 */
.dsh-hooks__alert { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:6px; font-size:12px;
  line-height:18px; min-width:0; }
.dsh-hooks__alerttext { flex:1 1 auto; min-width:0; }
.dsh-hooks__alert--info { color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__alert--error {
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.dsh-hooks__strong { font-weight:600; }

/* 「另一个来源」那一行（只在有内容 / 读不出来时出现）：一行里"还有 N 个 hook" + ghost 动作。
   **正文不许出现盘符路径**（路径/状态/版本都在诊断折叠里）。 */
.dsh-hooks__other { display:flex; align-items:center; gap:8px; min-width:0; min-height:28px; flex-wrap:wrap; }

/* ── 空状态块（一个作用域一条 hook 都没有时替代主列表）──
   与 hook 卡片**同一套官方配方**（stroke 给可见性、fill 兜底、radius-xl），别在这里换语言。 */
.dsh-hooks__empty { display:flex; flex-direction:column; gap:8px; min-width:0; padding:12px;
  border-radius:var(--dsw-radius-xl, 20px);
  background:var(--dsw-alias-settings-card-fill, rgba(127,127,127,.06));
  border:.5px solid var(--dsw-alias-settings-card-stroke, rgba(127,127,127,.35)); }
.dsh-hooks__emptytitle { font-size:13px; font-weight:500; line-height:18px; min-width:0; }
.dsh-hooks__emptyactions { display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:wrap; }

/* ── 折叠区（全部事件 / 诊断）：默认收起，一行一个开关 ──
   这里是**官方"只画分隔线"那套语言**（settings-general 的 .row：border-bottom:.5px solid
   var(--dsw-alias-border-l2)，真机 ΔRGB 77）—— 不加底色、不加圆角、不加卡片描边：
   卡片语言（hook 卡片 / 空状态 / 表单）与分隔线语言**不许混在同一层**。 */
.dsh-hooks__folds { display:flex; align-items:center; gap:12px; min-width:0; flex-wrap:wrap; }
.dsh-hooks__disclosure { display:flex; align-items:center; gap:6px; border:0; background:transparent; cursor:pointer;
  font:inherit; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); padding:0; }
.dsh-hooks__disclosure:hover { color:var(--dsw-alias-label-primary, inherit); }
.dsh-hooks__foldbody { display:flex; flex-direction:column; min-width:0; padding:0; }
/* 事件行：**行高固定 32px**（7 行等距，扫起来是"一张表"而不是"一堆按钮"），
   右侧的「＋」是 ghost **字形按钮**（24×24、无描边、只有动作、不抢视线；title / aria-label
   说清"在哪个事件下新建"）。中间那格占满剩余宽度 ⇒ 按钮被推到行尾、对齐成一列。 */
.dsh-hooks__eventrow { display:flex; align-items:center; gap:8px; min-width:0; height:32px; padding:0 12px;
  border-bottom:.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.12)); }
.dsh-hooks__eventrow > .dsh-hooks__muted, .dsh-hooks__eventrow > .dsh-hooks__count {
  flex:1 1 auto; min-width:0; }
.dsh-hooks__eventname--fold { flex:none; min-width:150px; }
.dsh-hooks__glyphbtn { width:24px; height:24px; padding:0; justify-content:center; font-size:14px;
  color:var(--dsw-alias-label-secondary, inherit); }
/* 诊断行同样走"分隔线"语言（label + value 的表格式条目，官方 settings 的行就是这样）。 */
.dsh-hooks__diagrow { display:flex; gap:8px; min-width:0; padding:6px 12px;
  border-bottom:.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.12)); }
.dsh-hooks__diagkey { flex:none; min-width:96px; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__diagval { font-size:12px; min-width:0; overflow-wrap:anywhere; }

/* ── 新建表单（错误只渲染在表单里，§3.7）── 与卡片同一套官方配方 ──
   F1：**每个字段一个容器**（label + 控件同进同出），容器内部 nowrap ⇒ label 与它的控件
   永远在同一行；只有**容器之间**才允许换行（.dsh-hooks__newrow 是那层 wrap）。
   过去 5 个兄弟节点平铺在一个 wrap 行里，564px 下"匹配"的 label 与输入框被拆到两行。 */
.dsh-hooks__newform { display:flex; flex-direction:column; gap:8px; min-width:0; padding:12px;
  border-radius:var(--dsw-radius-xl, 20px);
  background:var(--dsw-alias-settings-card-fill, rgba(127,127,127,.06));
  border:.5px solid var(--dsw-alias-settings-card-stroke, rgba(127,127,127,.35)); }
.dsh-hooks__newrow { display:flex; align-items:center; gap:16px; min-width:0; flex-wrap:wrap; }
/* 模板行（v4）：**不是字段容器** —— 它没有 label + 控件的配对，所以既不是 __newfield
   也不是 __newrow（D37 按"每个 __newfield 恰好一个 label + 一个控件"守 F1，混进去会失真）。 */
.dsh-hooks__tplrow { display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:wrap; }
/* 模板按钮：ghost 文字按钮（内容区不许描边）。刻意**不用** __btn 类 ——
   断言按 __btn 数"这一屏有几个动作按钮"，模板按钮不是动作按钮。 */
.dsh-hooks__tplbtn { font:inherit; font-size:12px; line-height:1; height:24px; padding:0 8px; border:0; border-radius:6px;
  cursor:pointer; flex:none; background:transparent; color:var(--dsw-alias-label-secondary, inherit); }
.dsh-hooks__tplbtn:hover:not(:disabled) { color:var(--dsw-alias-label-primary, inherit);
  background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dsh-hooks__tplbtn:disabled { opacity:.5; cursor:default; }
.dsh-hooks__newfield { display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:nowrap; }
.dsh-hooks__newfield > .dsh-hooks__editor { flex:1 1 240px; }
.dsh-hooks__newlabel { flex:none; min-width:56px; font-size:12px; color:var(--dsw-alias-label-secondary, inherit); }
/* 动作区（创建 / 取消）：不是字段容器，所以不叫 __newfield */
.dsh-hooks__newactions { display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:wrap; }
/* 表单里"这个事件什么时候触发"的补充说明（官方 README 的「运行时机」，见 labels.ts 的出处） */
.dsh-hooks__hint { flex:none; font-size:12px; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, inherit)); }
/* 表单内的错误行：与页面级错误**同一套官方 danger 配方**（Tag[data-tone=danger]）。
   官方没有 state-error-background 这个变体 —— 自己配 rgba 就是硬编码颜色。 */
.dsh-hooks__newerror { padding:8px 10px; border-radius:6px; font-size:12px; line-height:18px;
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.dsh-hooks__select { font:inherit; font-size:12px; line-height:1; height:28px; padding:0 6px; border-radius:6px; max-width:260px;
  border:.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-module-platform, transparent); color:var(--dsw-alias-label-primary, inherit); }
`

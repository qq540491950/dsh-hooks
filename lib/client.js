/**
 * ⚠️ 本文件由 tools/build.ts 从 src/** 生成 —— **不要直接编辑**（AGENTS §0/§4.8）。
 * 浏览器半边：一个 classic script（**不是 ESM**），执行时只做一件事 ——
 * 向 `__ModuleLoader__` 注册一个 lazy factory；`id` 必须等于 package.json 的 name。
 * wrapper 由构建脚本注入，所以源码里不许手写 `__ModuleLoader__`。
 */
window.__ModuleLoader__.load({
	id: "dsh-hooks",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	var __create = Object.create;
	var __defProp = Object.defineProperty;
	var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
	var __getOwnPropNames = Object.getOwnPropertyNames;
	var __getProtoOf = Object.getPrototypeOf;
	var __hasOwnProp = Object.prototype.hasOwnProperty;
	var __export = (target, all) => {
	  for (var name in all)
	    __defProp(target, name, { get: all[name], enumerable: true });
	};
	var __copyProps = (to, from, except, desc) => {
	  if (from && typeof from === "object" || typeof from === "function") {
	    for (let key of __getOwnPropNames(from))
	      if (!__hasOwnProp.call(to, key) && key !== except)
	        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
	  }
	  return to;
	};
	var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
	  // If the importer is in node compatibility mode or this is not an ESM
	  // file that has been converted to a CommonJS file using a Babel-
	  // compatible transform (i.e. "__esModule" has not been set), then set
	  // "default" to the CommonJS "module.exports" for node compatibility.
	  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
	  mod
	));
	var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

	// src/client/index.ts
	var index_exports = {};
	__export(index_exports, {
	  apply: () => apply
	});
	module.exports = __toCommonJS(index_exports);

	// src/client/react.ts
	var React = __toESM(require("react"), 1);
	var h = React.createElement;
	var Fragment2 = React.Fragment;
	var useEffect2 = React.useEffect;
	var useState2 = React.useState;

	// src/shared/constants.ts
	var HOOK_EVENTS = [
	  "SessionStart",
	  "UserPromptSubmit",
	  "PreToolUse",
	  "PostToolUse",
	  "Stop",
	  "SubagentStart",
	  "SubagentStop"
	];
	var HOOKS_ROUTE = "/api/hooks";

	// src/client/styles.ts
	var styles = `
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
	`;

	// src/client/labels.ts
	var EVENT_LABEL = {
	  SessionStart: "会话开始",
	  UserPromptSubmit: "提示词提交",
	  PreToolUse: "工具运行前",
	  PostToolUse: "工具运行后",
	  Stop: "停止",
	  SubagentStart: "子代理启动",
	  SubagentStop: "子代理结束"
	};
	var EVENT_HINT = {
	  SessionStart: "会话开始时",
	  UserPromptSubmit: "agent 收到提示词时",
	  PreToolUse: "工具运行前",
	  PostToolUse: "工具运行后",
	  Stop: "运行即将停止时",
	  SubagentStart: "subagent 启动时",
	  SubagentStop: "subagent 结束时"
	};
	function eventLabel(event) {
	  return EVENT_LABEL[event] ?? event;
	}
	function eventHint(event) {
	  return EVENT_HINT[event] ?? event;
	}
	function eventTitle(event) {
	  return `${eventHint(event)} · ${event}`;
	}

	// src/client/hook-card.tsx
	function statusOf(hook) {
	  const run = hook.lastRun;
	  const last = run === null ? "" : `exit ${run.exitCode === null ? "spawn-failed" : String(run.exitCode)} · ${String(run.durationMs)}ms`;
	  if (hook.disabled) {
	    return {
	      className: "dsh-hooks__dot",
	      label: "",
	      evidence: last === "" ? "已停用，不会运行" : `已停用，不会运行（上次 ${last}）`
	    };
	  }
	  if (run === null) return { className: "dsh-hooks__dot", label: "未运行", evidence: "没有执行记录" };
	  if (run.decision === "deny" || run.decision === "block") {
	    return {
	      className: "dsh-hooks__dot dsh-hooks__dot--deny",
	      label: "已阻断",
	      evidence: `decision ${run.decision} · ${last}`
	    };
	  }
	  if (run.exitCode === 0) {
	    return {
	      className: "dsh-hooks__dot dsh-hooks__dot--ok",
	      label: "通过",
	      evidence: `exit 0 · ${String(run.durationMs)}ms`
	    };
	  }
	  return {
	    className: "dsh-hooks__dot dsh-hooks__dot--warn",
	    label: "失败",
	    evidence: `exit ${String(run.exitCode)} · ${String(run.durationMs)}ms`
	  };
	}
	function HookCard(props) {
	  const { hook, event, matcher, matcherProblem, writable, busy, editing, draft, confirming, menuOpen, dryText } = props;
	  const status = statusOf(hook);
	  const run = hook.lastRun;
	  const dotTitle = `${status.label === "" ? status.evidence : `${status.label}（${status.evidence}）`}${run === null ? "" : `
	${run.stderr || run.stdout || "(无输出)"}`}`;
	  const matchText = matcherProblem !== null ? "匹配范围非法，这一组不会运行" : matcher === null ? "匹配全部" : `匹配 ${matcher}`;
	  const timeoutText = hook.timeoutSec === null ? `默认 ${String(hook.defaultTimeoutSec)} 秒` : `${String(hook.timeoutSec)} 秒`;
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks__hookcard" }, /* @__PURE__ */ h("div", { className: "dsh-hooks__cardmain" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__slot", "aria-hidden": "true" }, /* @__PURE__ */ h("span", { className: status.className, title: dotTitle })), /* @__PURE__ */ h("span", { className: "dsh-hooks__cardtext" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__eventname", title: eventTitle(event) }, eventLabel(event), /* @__PURE__ */ h("span", { className: "dsh-hooks__eventid" }, event), hook.disabled ? /* @__PURE__ */ h("span", { className: "dsh-hooks__tag" }, "已停用") : null, matcherProblem === null ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__tag dsh-hooks__tag--warn" }, "不会运行")), editing ? (
	    // command 是 mono + multiline（§3.10）：真 `<textarea>`，不是 input。
	    /* @__PURE__ */ h(
	      "textarea",
	      {
	        className: "dsh-hooks__editor",
	        value: draft,
	        rows: 1,
	        onChange: (changeEvent) => {
	          props.onDraftChange(changeEvent.target.value);
	        }
	      }
	    )
	  ) : /* @__PURE__ */ h("span", { className: "dsh-hooks__cmd", title: hook.command }, hook.command)), status.label === "" ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__status", title: status.evidence }, status.label), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      role: "switch",
	      "aria-checked": !hook.disabled,
	      className: hook.disabled ? "dsh-hooks__switch" : "dsh-hooks__switch dsh-hooks__switch--on",
	      title: hook.disabled ? "启用" : "停用",
	      disabled: busy,
	      onClick: props.onToggle
	    },
	    /* @__PURE__ */ h("span", { className: "dsh-hooks__knob" })
	  ), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__morebtn",
	      title: "更多",
	      "aria-label": `更多操作：${eventLabel(event)}`,
	      "aria-expanded": menuOpen,
	      disabled: busy,
	      onClick: props.onToggleMenu
	    },
	    "⋯"
	  )), menuOpen ? /* @__PURE__ */ h("div", { className: "dsh-hooks__cardmenu" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__meta", title: matcherProblem ?? `${matchText} · 超时 ${timeoutText}` }, matchText, " · ", timeoutText), /* @__PURE__ */ h("span", { className: "dsh-hooks__spacer" }), writable ? editing ? /* @__PURE__ */ h("span", { className: "dsh-hooks__actions" }, /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn dsh-hooks__btn--ghost",
	      title: "保存",
	      disabled: busy,
	      onClick: props.onSave
	    },
	    "保存"
	  ), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn dsh-hooks__btn--ghost",
	      title: "取消编辑",
	      disabled: busy,
	      onClick: props.onCancelEdit
	    },
	    "取消"
	  )) : confirming ? /* @__PURE__ */ h("span", { className: "dsh-hooks__actions" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__meta" }, "删除这一条？"), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn dsh-hooks__btn--ghost",
	      title: "确认删除",
	      disabled: busy,
	      onClick: props.onRemove
	    },
	    "确认删除"
	  ), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn dsh-hooks__btn--ghost",
	      title: "取消删除",
	      disabled: busy,
	      onClick: props.onCancelRemove
	    },
	    "取消"
	  )) : /* @__PURE__ */ h("span", { className: "dsh-hooks__actions" }, /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn dsh-hooks__btn--ghost",
	      title: "试运行",
	      disabled: busy,
	      onClick: props.onDryRun
	    },
	    "试运行"
	  ), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn dsh-hooks__btn--ghost",
	      title: "编辑",
	      disabled: busy,
	      onClick: props.onStartEdit
	    },
	    "编辑"
	  ), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn dsh-hooks__btn--ghost",
	      title: "删除",
	      disabled: busy,
	      onClick: props.onAskRemove
	    },
	    "删除"
	  )) : null) : null, dryText === "" ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__dry" }, dryText));
	}

	// src/client/templates.ts
	var HOOK_TEMPLATES = [
	  {
	    id: "session-reminder",
	    label: "注入提醒",
	    hint: "会话开始时，把一句话作为上下文交给 agent（不阻断任何东西）",
	    event: "SessionStart",
	    matcher: "",
	    command: `node -e "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'动手前先读本仓库的 AGENTS.md。'}}))"`,
	    timeout: "10"
	  },
	  {
	    id: "log-calls",
	    label: "记到日志",
	    hint: "每次工具调用后，把这行输入追加到项目里的 .dsh/hook.log",
	    event: "PostToolUse",
	    matcher: "",
	    command: `node -e "const fs=require('node:fs');fs.appendFileSync(process.env.DSH_PROJECT_DIR+'/.dsh/hook.log',fs.readFileSync(0).toString()+'\\n')"`,
	    timeout: "10"
	  },
	  {
	    id: "deny-calls",
	    label: "直接拦住",
	    hint: "命中的工具调用一律拒绝（拦哪些由「匹配」决定）",
	    event: "PreToolUse",
	    matcher: "pwsh|bash",
	    command: `node -e "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'被项目 hook 拒绝'}}))"`,
	    timeout: "10"
	  }
	];

	// src/client/new-hook.tsx
	var MATCHERLESS = /* @__PURE__ */ new Set(["UserPromptSubmit", "Stop"]);
	function NewHookForm(props) {
	  const { draft, error, errorDetail, busy, writable } = props;
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks__newform" }, /* @__PURE__ */ h("div", { className: "dsh-hooks__tplrow" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__hint" }, "模板"), HOOK_TEMPLATES.map((template) => /* @__PURE__ */ h(
	    "button",
	    {
	      key: template.id,
	      type: "button",
	      className: "dsh-hooks__tplbtn",
	      title: `${template.hint}（会覆盖当前四个字段）`,
	      disabled: busy,
	      onClick: () => {
	        props.onTemplate(template.id);
	      }
	    },
	    template.label
	  ))), /* @__PURE__ */ h("div", { className: "dsh-hooks__newrow" }, /* @__PURE__ */ h("div", { className: "dsh-hooks__newfield dsh-hooks__newfield--event" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__newlabel" }, "事件"), /* @__PURE__ */ h(
	    "select",
	    {
	      className: "dsh-hooks__select dsh-hooks__newselect",
	      value: draft.event,
	      onChange: (changeEvent) => {
	        props.onEvent(changeEvent.target.value);
	      }
	    },
	    HOOK_EVENTS.map((event) => /* @__PURE__ */ h("option", { key: event, value: event, title: eventHint(event) }, eventLabel(event), "（", event, "）"))
	  ), /* @__PURE__ */ h("span", { className: "dsh-hooks__hint" }, eventHint(draft.event))), MATCHERLESS.has(draft.event) ? (
	    // 这一句里**不许出现** `matcher`：表单是给用户看的，接口字段名只留在诊断折叠里。
	    /* @__PURE__ */ h("span", { className: "dsh-hooks__hint" }, "这个事件不看匹配范围（填了也不生效）")
	  ) : /* @__PURE__ */ h("div", { className: "dsh-hooks__newfield dsh-hooks__newfield--matcher" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__newlabel" }, "匹配"), /* @__PURE__ */ h(
	    "input",
	    {
	      className: "dsh-hooks__input",
	      type: "text",
	      value: draft.matcher,
	      placeholder: "留空 = 匹配全部",
	      onChange: (changeEvent) => {
	        props.onMatcher(changeEvent.target.value);
	      }
	    }
	  ))), /* @__PURE__ */ h("div", { className: "dsh-hooks__newfield dsh-hooks__newfield--command" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__newlabel" }, "命令"), /* @__PURE__ */ h(
	    "textarea",
	    {
	      className: "dsh-hooks__editor",
	      value: draft.command,
	      rows: 2,
	      onChange: (changeEvent) => {
	        props.onCommand(changeEvent.target.value);
	      }
	    }
	  )), /* @__PURE__ */ h("div", { className: "dsh-hooks__newfield dsh-hooks__newfield--timeout" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__newlabel" }, "超时"), /* @__PURE__ */ h(
	    "input",
	    {
	      className: "dsh-hooks__input",
	      type: "text",
	      value: draft.timeout,
	      placeholder: "秒；留空用默认 600 秒",
	      onChange: (changeEvent) => {
	        props.onTimeout(changeEvent.target.value);
	      }
	    }
	  )), error === null ? null : /* @__PURE__ */ h("div", { className: "dsh-hooks__newerror" }, error, errorDetail === "" ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__muted" }, "（", errorDetail, "）")), /* @__PURE__ */ h("div", { className: "dsh-hooks__newactions" }, /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn dsh-hooks__btn--primary",
	      title: "创建",
	      disabled: busy || !writable || draft.command.trim() === "",
	      onClick: props.onSubmit
	    },
	    "创建"
	  ), /* @__PURE__ */ h("button", { type: "button", className: "dsh-hooks__btn dsh-hooks__btn--ghost", disabled: busy, onClick: props.onCancel }, "取消")));
	}

	// src/client/scope-picker.tsx
	function ScopePicker(props) {
	  const { label, hint, options, value, open, active, busy } = props;
	  const current = options.find((option) => option.value === value);
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks__field" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__label" }, "作用域"), /* @__PURE__ */ h("div", { className: "dsh-hooks__popoverwrap" }, /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__trigger",
	      title: hint,
	      "aria-haspopup": "listbox",
	      "aria-expanded": open,
	      disabled: busy,
	      onClick: props.onToggle,
	      onKeyDown: (event) => {
	        props.onKey(event);
	      }
	    },
	    /* @__PURE__ */ h("span", { className: "dsh-hooks__triggerlabel" }, current === void 0 ? label : current.label),
	    /* @__PURE__ */ h("span", { className: "dsh-hooks__caret", "aria-hidden": "true" }, "▾")
	  ), open ? /* @__PURE__ */ h(Fragment2, null, /* @__PURE__ */ h(
	    "div",
	    {
	      className: "dsh-hooks__backdrop",
	      onClick: () => {
	        props.onClose();
	      }
	    }
	  ), /* @__PURE__ */ h("div", { className: "dsh-hooks__popover", role: "listbox", "aria-label": "作用域" }, options.map((option, index) => /* @__PURE__ */ h(Fragment2, { key: option.value }, index === 0 || options[index - 1]?.group !== option.group ? /* @__PURE__ */ h("div", { className: "dsh-hooks__group" }, option.group) : null, /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: index === active ? "dsh-hooks__option dsh-hooks__option--active" : "dsh-hooks__option",
	      role: "option",
	      "aria-selected": option.value === value,
	      value: option.value,
	      onClick: () => {
	        props.onPick(option.value);
	      },
	      onMouseEnter: () => {
	        props.onMove(index - active);
	      }
	    },
	    /* @__PURE__ */ h("span", { className: "dsh-hooks__optionlabel" }, option.label),
	    /* @__PURE__ */ h("span", { className: "dsh-hooks__check", "aria-hidden": "true" }, option.value === value ? "✓" : "")
	  ))))) : null));
	}

	// src/client/write.ts
	var CURRENT_SCOPE = "current";
	function scopeTargetOf(scope) {
	  if (scope === "user") return { file: "user" };
	  if (scope === CURRENT_SCOPE) return { file: "project" };
	  return { file: "project", workspaceId: scope };
	}
	function scopeQuery(scope) {
	  if (scope === "user") return "?scope=user";
	  if (scope === CURRENT_SCOPE) return "?scope=current";
	  return `?scope=workspace&workspaceId=${encodeURIComponent(scope)}`;
	}
	function sessionQuery(sessionId) {
	  return sessionId === void 0 || sessionId === "" ? "" : `?sessionId=${encodeURIComponent(sessionId)}`;
	}
	function snapshotPath(scope, sessionId) {
	  const scopePart = scopeQuery(scope).slice(1);
	  const sessionPart = sessionQuery(sessionId).slice(1);
	  return `${HOOKS_ROUTE}?${[scopePart, sessionPart].filter((part) => part !== "").join("&")}`;
	}
	function intentFor(scope, op) {
	  return { ...scopeTargetOf(scope), ...op };
	}
	function writeErrorSentence(error) {
	  switch (error) {
	    case "stale":
	      return "这个文件刚被别处改过了，页面上的内容已经不是最新的。请刷新后再改。";
	    case "invalid-json":
	      return "文件现在读不出来（内容不是合法 JSON）。为避免覆盖你的内容，这次没有写入，请先手工修好文件。";
	    case "not-preservable":
	      return "这次改动会动到目标以外的字段。为避免破坏文件，已拒绝写入。";
	    case "sandbox":
	      return "当前会话的权限不允许写这个文件（沙箱限制）。";
	    case "absent":
	      return "这份配置文件还不存在。";
	    case "exists":
	      return '文件已经存在，不能再"新建"。';
	    case "not-found":
	      return "要改的那一条已经不在了（文件可能刚被改过），请刷新。";
	    case "bad-op":
	      return "这次请求不合法（界面与宿主的版本可能不一致）。";
	    case "bad-timeout":
	      return "超时必须是正数秒；留空就用默认 600s。";
	    case "no-project":
	      return "无法确定当前项目，所以不能写项目级配置。";
	    case "unknown-workspace":
	      return "这个工作区已经不在宿主的清单里了（可能被删过），请刷新页面后重试。";
	    case "no-workspace-registry":
	      return "宿主没有提供工作区清单，只能改当前项目和用户级配置。";
	    case "network":
	      return "连不上宿主，写入没有发生。";
	    default:
	      return `写入失败（${error}）。`;
	  }
	}
	async function requestWrite(intent, sessionId, signal) {
	  try {
	    const response = await fetch(`${HOOKS_ROUTE}${sessionQuery(sessionId)}`, {
	      method: "POST",
	      headers: { "content-type": "application/json" },
	      // 鉴权是 host-only 的同源 cookie（官方 connection 层管），带上同源凭据即可。
	      credentials: "same-origin",
	      body: JSON.stringify(intent),
	      ...signal === void 0 ? {} : { signal }
	    });
	    const body = await response.json();
	    if (body.ok) {
	      const version = body.data === void 0 ? null : body.data.version;
	      return version === null ? { ok: true } : { ok: true, version };
	    }
	    const outcome = { ok: false, error: typeof body.error === "string" ? body.error : "internal" };
	    return typeof body.detail === "string" ? { ...outcome, detail: body.detail } : outcome;
	  } catch (error) {
	    return { ok: false, error: "network", detail: error instanceof Error ? error.message : String(error) };
	  }
	}
	function dryRunFor(scope, address) {
	  return { ...scopeTargetOf(scope), ...address };
	}
	async function requestDryRun(intent, sessionId, signal) {
	  try {
	    const response = await fetch(`${HOOKS_ROUTE}${sessionQuery(sessionId)}`, {
	      method: "POST",
	      headers: { "content-type": "application/json" },
	      credentials: "same-origin",
	      body: JSON.stringify({ op: "dryRun", ...intent }),
	      ...signal === void 0 ? {} : { signal }
	    });
	    const body = await response.json();
	    if (body.ok) {
	      const run = body.data === void 0 ? void 0 : body.data.run;
	      return run === void 0 ? { ok: false, error: "internal" } : { ok: true, run };
	    }
	    const outcome = { ok: false, error: typeof body.error === "string" ? body.error : "internal" };
	    return typeof body.detail === "string" ? { ...outcome, detail: body.detail } : outcome;
	  } catch (error) {
	    return { ok: false, error: "network", detail: error instanceof Error ? error.message : String(error) };
	  }
	}

	// src/client/section.tsx
	var REQUEST_TIMEOUT_MS = 1e4;
	function findMainSessionId(state) {
	  if (typeof state !== "object" || state === null) return void 0;
	  const byId = state.byId;
	  if (typeof byId !== "object" || byId === null) return void 0;
	  for (const [key, value] of Object.entries(byId)) {
	    if (typeof value !== "object" || value === null) continue;
	    const row = value;
	    const retained = typeof row.retainedBy?.mainView === "number" ? row.retainedBy.mainView : 0;
	    if (retained > 0) return typeof row.id === "string" && row.id !== "" ? row.id : key;
	  }
	  return void 0;
	}
	function useNoSession(selector) {
	  return selector({ byId: void 0 });
	}
	function sentenceFor(code) {
	  switch (code) {
	    case "network":
	      return "连不上宿主。可能是宿主刚重启，或者这个页面是旧标签页。";
	    case "internal":
	      return "宿主在读取配置时出错了（这是插件的问题，不是你的配置写错了）。";
	    case "bad-json":
	      return "宿主返回的内容不是合法 JSON（版本不匹配？）。";
	    case "unknown-workspace":
	      return "这个工作区已经不在宿主的清单里了（可能被删过），请刷新页面后重试。";
	    case "no-workspace-registry":
	      return "宿主没有提供工作区清单，只能改当前项目和用户级配置。";
	    default:
	      return `读取失败（${code}）。`;
	  }
	}
	function stateToken(file) {
	  switch (file.state) {
	    case "absent":
	      return "文件不存在";
	    case "ok":
	      return "已读取";
	    default:
	      return "读不出来";
	  }
	}
	function formatDryRun(run) {
	  const outcome = run.exitCode === null ? "启动失败（子进程没起来）" : run.decision === "deny" || run.decision === "block" ? `已阻断（exit ${String(run.exitCode)}）` : run.exitCode === 0 ? "通过（exit 0）" : `失败（exit ${String(run.exitCode)}）`;
	  const text = run.stderr.trim() === "" ? run.stdout.trim() : run.stderr.trim();
	  return `试运行：${outcome} · ${String(run.durationMs)}ms${text === "" ? "" : ` · ${text}`}`;
	}
	function rowKey(kind, event, groupRawIndex, hookIndex) {
	  return `${kind}|${event}|${String(groupRawIndex)}|${String(hookIndex)}`;
	}
	function lastSegment(value) {
	  const parts = value.split(/[\\/]+/).filter((part) => part !== "");
	  const last = parts[parts.length - 1];
	  return last === void 0 ? value : last;
	}
	function currentProjectMissing(snapshot) {
	  if (snapshot.projectRoot === null) return false;
	  return !snapshot.workspaces.some((workspace) => workspace.projectRoot === snapshot.projectRoot);
	}
	function currentProjectLabel(snapshot) {
	  const root = snapshot.projectRoot ?? snapshot.scope.projectRoot;
	  return `当前会话项目（${lastSegment(String(root))}）`;
	}
	function scopeOptions(snapshot) {
	  const options = [{ value: "user", label: "用户（全局）", group: "用户" }];
	  if (currentProjectMissing(snapshot)) {
	    options.push({ value: CURRENT_SCOPE, label: currentProjectLabel(snapshot), group: "工作区" });
	  }
	  for (const workspace of snapshot.workspaces) {
	    options.push({ value: workspace.id, label: workspace.title, group: "工作区" });
	  }
	  return options;
	}
	function echoedScopeOf(snapshot) {
	  if (snapshot.scope.kind === "user") return "user";
	  return snapshot.scope.workspaceId === null ? CURRENT_SCOPE : snapshot.scope.workspaceId;
	}
	function echoedLabelOf(snapshot) {
	  if (snapshot.scope.kind === "user") return "用户（全局）";
	  if (snapshot.scope.workspaceId !== null) {
	    return snapshot.scope.workspaceTitle ?? snapshot.scope.workspaceId;
	  }
	  return currentProjectLabel(snapshot);
	}
	function scopeHelp(snapshot, scope) {
	  const { scope: view } = snapshot;
	  if (view.kind === "user") {
	    return "用户级配置对所有项目生效；每个项目还会叠加它自己的项目级配置（用户级先跑）。";
	  }
	  const viaCurrent = view.workspaceId === null && view.workspacePath === null;
	  if (view.isCurrentSession === true) {
	    return viaCurrent ? `当前会话就在这个项目（项目根 ${String(view.projectRoot)}），改动对之后的调用立即生效。` : `当前会话就在这个工作区（项目根 ${String(view.projectRoot)}），改动对之后的调用立即生效。`;
	  }
	  const where = scopeWhere(snapshot, scope);
	  if (view.isCurrentSession === false) {
	    return `你正在看/改 ${where}；改动不会作用于当前会话（项目根 ${String(snapshot.projectRoot)}），只影响以后在 ${where} 里打开的会话。写入还可能被当前会话的沙箱拒绝（报 sandbox 属预期）。`;
	  }
	  return `你正在看/改 ${where}；但当前会话未知，无法判断它是不是当前会话的项目。`;
	}
	function wantSwitchTo(snapshot, target) {
	  return target !== echoedScopeOf(snapshot);
	}
	function fileKindLabel(kind) {
	  return kind === "user" ? "用户级（全局）" : "项目级";
	}
	function primaryFileOf(snapshot) {
	  const wanted = snapshot.scope.kind === "user" ? "user" : "project";
	  return snapshot.files.find((file) => file.kind === wanted) ?? snapshot.files[0];
	}
	function disabledCountOf(file) {
	  let disabled = 0;
	  for (const view of file.events) disabled += view.disabledCount;
	  return disabled;
	}
	function scopeWhere(snapshot, fallback) {
	  const { scope: view } = snapshot;
	  if (view.kind === "user") return "用户（全局）";
	  if (view.workspaceId === null && view.workspacePath === null) return "当前会话的项目";
	  return view.workspaceTitle ?? view.workspaceId ?? fallback;
	}
	function sessionLineNeeded(snapshot) {
	  if (snapshot.session === null) return true;
	  return snapshot.scope.isCurrentSession !== true;
	}
	function currentScopeTarget(snapshot) {
	  const root = snapshot.projectRoot;
	  const known = snapshot.workspaces.find((workspace) => workspace.projectRoot === root);
	  return known === void 0 ? CURRENT_SCOPE : known.id;
	}
	function emptyGuideOf(snapshot) {
	  const raw = rawEmptyGuideOf(snapshot);
	  if (raw === null || !wantSwitchTo(snapshot, raw.target)) return null;
	  return raw;
	}
	function rawEmptyGuideOf(snapshot) {
	  if (snapshot.scope.kind === "user") {
	    const session = snapshot.session;
	    if (session === null || session.fromProject <= 0) return null;
	    return {
	      text: `当前会话项目（${lastSegment(session.projectRoot)}）里有 ${String(session.fromProject)} 个 hook。`,
	      action: "切换过去",
	      target: currentScopeTarget(snapshot)
	    };
	  }
	  const userFile = snapshot.files.find((file) => file.kind === "user");
	  if (userFile === void 0 || userFile.state !== "ok" || userFile.hookCount <= 0) return null;
	  return {
	    text: `用户级（全局）里有 ${String(userFile.hookCount)} 个 hook。`,
	    action: "切换过去",
	    target: "user"
	  };
	}
	function emptyBlockOf(snapshot, file) {
	  const absent = file.state === "absent";
	  return {
	    // v4：**一句**。v3 那两句各带一个括号解释（"(这是"空的"，不是出错)"），用户读完不知道先点哪个。
	    body: absent ? "这份 hooks.json 还不存在 —— 这是空的，不是出错。" : "文件里还没有任何 hook。",
	    path: file.path,
	    canCreateFile: absent,
	    guide: emptyGuideOf(snapshot)
	  };
	}
	function EmptyState(props) {
	  const { block, writable, busy } = props;
	  const guide = block.guide;
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks__empty" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__emptytitle" }, "这个作用域还没有 hook"), /* @__PURE__ */ h("span", { className: "dsh-hooks__muted" }, block.body), writable ? /* @__PURE__ */ h("span", { className: "dsh-hooks__emptyactions" }, /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn dsh-hooks__btn--primary",
	      title: "新建第一条 hook",
	      disabled: busy,
	      onClick: props.onCreateHook
	    },
	    "＋ 新建第一条 hook"
	  ), block.canCreateFile ? (
	    // 路径进 title（v4 起它不再单独占一行）：想手动建文件的人在这里能拿到它。
	    /* @__PURE__ */ h(
	      "button",
	      {
	        type: "button",
	        className: "dsh-hooks__btn dsh-hooks__btn--ghost",
	        title: `新建配置文件（${block.path}）`,
	        disabled: busy,
	        onClick: props.onCreateFile
	      },
	      "新建配置文件"
	    )
	  ) : null, guide === null ? null : /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn dsh-hooks__btn--ghost dsh-hooks__guidebtn",
	      title: guide.text,
	      disabled: busy,
	      onClick: () => {
	        props.onGuide(guide.target);
	      }
	    },
	    guide.action
	  )) : null);
	}
	function cardRows(file, matches) {
	  const rows = [];
	  for (const view of file.events) {
	    for (const group of view.groups) {
	      for (const hook of group.hooks) {
	        if (!matches(hook, group, view.event)) continue;
	        rows.push({
	          event: view.event,
	          groupRawIndex: group.rawIndex,
	          matcher: group.matcher,
	          matcherProblem: group.matcherOk ? null : group.matcherProblem ?? "matcher 非法",
	          hook
	        });
	      }
	    }
	  }
	  return rows;
	}
	function HooksSection(props) {
	  const useSessions = typeof props?.useSessions === "function" ? props.useSessions : useNoSession;
	  const mainSession = useSessions(findMainSessionId);
	  const sessionId = typeof mainSession === "string" && mainSession !== "" ? mainSession : void 0;
	  const [phase, setPhase] = useState2({ kind: "loading" });
	  const [banner, setBanner] = useState2(null);
	  const [busy, setBusy] = useState2(false);
	  const [nonce, setNonce] = useState2(0);
	  const [scope, setScope] = useState2("user");
	  const [query, setQuery] = useState2("");
	  const [editingKey, setEditingKey] = useState2("");
	  const [draft, setDraft] = useState2("");
	  const [confirmKey, setConfirmKey] = useState2("");
	  const [dryKey, setDryKey] = useState2("");
	  const [dryText, setDryText] = useState2("");
	  const [newOpen, setNewOpen] = useState2(false);
	  const [newEvent, setNewEvent] = useState2("PreToolUse");
	  const [newMatcher, setNewMatcher] = useState2("");
	  const [newCommand, setNewCommand] = useState2("");
	  const [newTimeout, setNewTimeout] = useState2("");
	  const [formError, setFormError] = useState2(null);
	  const [scopeOpen, setScopeOpen] = useState2(false);
	  const [scopeActive, setScopeActive] = useState2(0);
	  const [moreOpen, setMoreOpen] = useState2(false);
	  const [menuKey, setMenuKey] = useState2("");
	  useEffect2(() => {
	    const controller = new AbortController();
	    const timer = setTimeout(() => {
	      controller.abort();
	    }, REQUEST_TIMEOUT_MS);
	    void (async () => {
	      try {
	        const response = await fetch(snapshotPath(scope, sessionId), {
	          method: "GET",
	          signal: controller.signal,
	          // 鉴权是 host-only 的同源 cookie（官方 connection 层管），这里只需带上同源凭据。
	          credentials: "same-origin"
	        });
	        const body = await response.json();
	        if (body.ok) {
	          setPhase({ kind: "ready", snapshot: body.data });
	        } else {
	          if (body.error === "unknown-workspace" || body.error === "no-workspace-registry") setScope("user");
	          setPhase({ kind: "failed", code: body.error, detail: body.detail ?? "" });
	        }
	      } catch (error) {
	        setPhase({
	          kind: "failed",
	          code: "network",
	          detail: error instanceof Error ? error.message : String(error)
	        });
	      } finally {
	        clearTimeout(timer);
	      }
	    })();
	    return () => {
	      clearTimeout(timer);
	      controller.abort();
	    };
	  }, [nonce, scope, sessionId]);
	  const displayScope = phase.kind === "ready" ? echoedScopeOf(phase.snapshot) : scope;
	  const runRequest = (op, channel, onSuccess) => {
	    if (busy) return;
	    setBusy(true);
	    if (channel === "page") setBanner(null);
	    else setFormError(null);
	    void (async () => {
	      const outcome = await requestWrite(intentFor(displayScope, op), sessionId);
	      if (outcome.ok) {
	        setNonce((value) => value + 1);
	        onSuccess();
	      } else {
	        const problem = { code: outcome.error ?? "internal", detail: outcome.detail ?? "" };
	        if (channel === "page") setBanner(problem);
	        else setFormError(problem);
	      }
	      setBusy(false);
	    })();
	  };
	  const runWrite = (op) => {
	    runRequest(op, "page", () => {
	      setEditingKey("");
	      setConfirmKey("");
	      setMenuKey("");
	    });
	  };
	  const changeScope = (next) => {
	    setScopeOpen(false);
	    if (next === scope) return;
	    setScope(next);
	    setEditingKey("");
	    setDraft("");
	    setConfirmKey("");
	    setDryKey("");
	    setDryText("");
	    setMenuKey("");
	    setFormError(null);
	    setNewOpen(false);
	  };
	  const applyTemplate = (id) => {
	    const template = HOOK_TEMPLATES.find((one) => one.id === id);
	    if (template === void 0) return;
	    setNewEvent(template.event);
	    setNewMatcher(template.matcher);
	    setNewCommand(template.command);
	    setNewTimeout(template.timeout);
	    setFormError(null);
	  };
	  const dryRun = (kind, event, groupRawIndex, hook) => {
	    if (busy) return;
	    setBusy(true);
	    setBanner(null);
	    void (async () => {
	      const outcome = await requestDryRun(
	        dryRunFor(displayScope, { event, groupIndex: groupRawIndex, hookIndex: hook.rawIndex }),
	        sessionId
	      );
	      if (outcome.ok && outcome.run !== void 0) {
	        setDryKey(rowKey(kind, event, groupRawIndex, hook.rawIndex));
	        setDryText(formatDryRun(outcome.run));
	      } else {
	        setBanner({ code: outcome.error ?? "internal", detail: outcome.detail ?? "" });
	      }
	      setBusy(false);
	    })();
	  };
	  const submitNew = () => {
	    const timeoutText = newTimeout.trim();
	    let timeoutSec = null;
	    if (timeoutText !== "") {
	      const value = Number(timeoutText);
	      if (!Number.isFinite(value) || value <= 0) {
	        setFormError({ code: "bad-timeout", detail: "" });
	        return;
	      }
	      timeoutSec = value;
	    }
	    runRequest(
	      { op: "addGroup", event: newEvent, matcher: newMatcher, command: newCommand, timeoutSec },
	      "form",
	      () => {
	        setNewOpen(false);
	        setNewCommand("");
	        setNewMatcher("");
	        setNewTimeout("");
	      }
	    );
	  };
	  if (phase.kind === "loading") {
	    return /* @__PURE__ */ h("div", { className: "dsh-hooks" }, /* @__PURE__ */ h("style", null, styles), /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, "读取中…"));
	  }
	  if (phase.kind === "failed") {
	    const prefersUser = phase.code === "unknown-workspace" || phase.code === "no-workspace-registry";
	    return /* @__PURE__ */ h("div", { className: "dsh-hooks" }, /* @__PURE__ */ h("style", null, styles), /* @__PURE__ */ h("div", { className: "dsh-hooks__alert dsh-hooks__alert--error" }, sentenceFor(phase.code)), phase.detail === "" ? null : /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, phase.detail), /* @__PURE__ */ h("div", { className: "dsh-hooks__toolbar" }, /* @__PURE__ */ h(
	      "button",
	      {
	        type: "button",
	        className: prefersUser ? "dsh-hooks__toolbtn" : "dsh-hooks__toolbtn dsh-hooks__toolbtn--primary",
	        title: "重试",
	        onClick: () => {
	          setNonce((value) => value + 1);
	        }
	      },
	      "↻ 重试"
	    ), /* @__PURE__ */ h(
	      "button",
	      {
	        type: "button",
	        className: prefersUser ? "dsh-hooks__toolbtn dsh-hooks__toolbtn--primary" : "dsh-hooks__toolbtn",
	        title: "回到用户级配置",
	        onClick: () => {
	          setPhase({ kind: "loading" });
	          setScope("user");
	          setNonce((value) => value + 1);
	        }
	      },
	      "回到用户级配置"
	    )));
	  }
	  const { snapshot } = phase;
	  const writable = snapshot.capabilities.writable;
	  const primary = primaryFileOf(snapshot);
	  const others = snapshot.files.filter((file) => file !== primary);
	  const needle = query.trim().toLowerCase();
	  const matches = (hook, group, event) => {
	    if (needle === "") return true;
	    return hook.command.toLowerCase().includes(needle) || (group.matcher ?? "").toLowerCase().includes(needle) || event.toLowerCase().includes(needle);
	  };
	  const options = scopeOptions(snapshot);
	  const rows = primary === void 0 ? [] : cardRows(primary, matches);
	  const fileTotal = primary === void 0 ? 0 : primary.hookCount;
	  const disabledTotal = primary === void 0 ? 0 : disabledCountOf(primary);
	  const shown = rows.length;
	  const showSearch = fileTotal >= 5 || needle !== "";
	  const countText = needle === "" ? `${String(fileTotal)} 个 hook` : `匹配 ${String(shown)} / 共 ${String(fileTotal)}`;
	  const metaText = disabledTotal === 0 ? countText : `${countText} · 其中 ${String(disabledTotal)} 个已停用`;
	  const displayLabel = echoedLabelOf(snapshot);
	  const currentIndex = Math.max(
	    0,
	    options.findIndex((option) => option.value === displayScope)
	  );
	  const help = scopeHelp(snapshot, displayScope);
	  const switchTarget = currentScopeTarget(snapshot);
	  const canSwitchBack = wantSwitchTo(snapshot, switchTarget);
	  const brokenFile = snapshot.files.find((file) => file.state === "error");
	  const alert = banner !== null ? (
	    // 技术原文只作**补充**（§3.9：绝不作为主文案，但排查要用得上）
	    { tone: "error", text: writeErrorSentence(banner.code), detail: banner.detail, action: null }
	  ) : brokenFile !== void 0 || snapshot.staleInUse ? {
	    tone: "error",
	    text: "有配置文件现在读不出来（内容不是合法 JSON）—— 运行中的 hook 仍在沿用上一份可用配置。",
	    detail: brokenFile?.message ?? "",
	    action: null
	  } : snapshot.scope.kind === "workspace" && snapshot.scope.isCurrentSession === false ? {
	    tone: "info",
	    // 一句话说清"这一份不是本会话在读的"，**不带路径**、不提内部机制（用户反馈黄底两行
	    // 横幅"太差了"）。被删掉的两条事实进了诊断折叠：`项目根` 一行仍在，另加 `写入权限`。
	    text: `本会话不读这份配置 —— 改动只影响以后在 ${scopeWhere(snapshot, displayScope)} 里打开的会话。`,
	    detail: "",
	    action: canSwitchBack ? {
	      label: "切回当前会话项目",
	      onClick: () => {
	        changeScope(switchTarget);
	      }
	    } : null
	  } : writable ? null : { tone: "info", text: "本页当前是只读模式（宿主没有提供写入能力）。", detail: "", action: null };
	  const eventRows = primary === void 0 ? HOOK_EVENTS.map((event) => ({ event, file: void 0 })) : primary.events.map((view) => ({ event: view.event, file: view }));
	  const moveActive = (delta) => {
	    const total = options.length;
	    if (total === 0) return;
	    const next = scopeActive + delta;
	    setScopeActive((next % total + total) % total);
	  };
	  const onScopeKey = (event) => {
	    if (event.key === "Escape") {
	      setScopeOpen(false);
	      return;
	    }
	    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
	      event.preventDefault?.();
	      if (!scopeOpen) {
	        setScopeActive(currentIndex);
	        setScopeOpen(true);
	        return;
	      }
	      const picked = options[scopeActive];
	      if (picked !== void 0) changeScope(picked.value);
	      return;
	    }
	    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
	      event.preventDefault?.();
	      if (!scopeOpen) {
	        setScopeActive(currentIndex);
	        setScopeOpen(true);
	        return;
	      }
	      moveActive(event.key === "ArrowDown" ? 1 : -1);
	    }
	  };
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks" }, /* @__PURE__ */ h("style", null, styles), /* @__PURE__ */ h("div", { className: "dsh-hooks__toolbar" }, /* @__PURE__ */ h(
	    ScopePicker,
	    {
	      label: displayLabel,
	      hint: help,
	      options,
	      value: displayScope,
	      open: scopeOpen,
	      active: scopeActive,
	      busy,
	      onToggle: () => {
	        setScopeActive(currentIndex);
	        setScopeOpen(!scopeOpen);
	      },
	      onMove: moveActive,
	      onPick: changeScope,
	      onKey: onScopeKey,
	      onClose: () => {
	        setScopeOpen(false);
	      }
	    }
	  ), /* @__PURE__ */ h("span", { className: "dsh-hooks__spacer" }), showSearch ? /* @__PURE__ */ h(
	    "input",
	    {
	      className: "dsh-hooks__search",
	      type: "search",
	      value: query,
	      placeholder: "搜索钩子…",
	      onChange: (changeEvent) => {
	        setQuery(changeEvent.target.value);
	      }
	    }
	  ) : null, /* @__PURE__ */ h("span", { className: "dsh-hooks__toolbarActions" }, /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__toolbtn",
	      title: "刷新",
	      disabled: busy,
	      onClick: () => {
	        setNonce((value) => value + 1);
	      }
	    },
	    "↻ 刷新"
	  ), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__toolbtn",
	      title: newOpen ? "收起" : "新建",
	      "aria-expanded": newOpen,
	      disabled: busy || !writable,
	      onClick: () => {
	        setNewOpen(!newOpen);
	        setFormError(null);
	      }
	    },
	    newOpen ? "收起" : "＋ 新建"
	  ))), /* @__PURE__ */ h("div", { className: "dsh-hooks__metaline" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__filecount" }, metaText), /* @__PURE__ */ h("span", { className: "dsh-hooks__spacer" }), sessionLineNeeded(snapshot) ? /* @__PURE__ */ h("span", { className: "dsh-hooks__session", title: "当前会话实际会跑的那一份（与所选作用域无关）" }, sessionShortLine(snapshot)) : null), alert === null ? null : /* @__PURE__ */ h("div", { className: `dsh-hooks__alert dsh-hooks__alert--${alert.tone}` }, /* @__PURE__ */ h("span", { className: "dsh-hooks__alerttext" }, alert.text, alert.detail === "" ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__muted" }, "（", alert.detail, "）")), alert.action === null ? null : /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn dsh-hooks__btn--ghost",
	      title: alert.action.label,
	      disabled: busy,
	      onClick: alert.action.onClick
	    },
	    alert.action.label
	  )), newOpen ? /* @__PURE__ */ h(
	    NewHookForm,
	    {
	      draft: { event: newEvent, matcher: newMatcher, command: newCommand, timeout: newTimeout },
	      error: formError === null ? null : writeErrorSentence(formError.code),
	      errorDetail: formError === null ? "" : formError.detail,
	      busy,
	      writable,
	      onTemplate: applyTemplate,
	      onEvent: setNewEvent,
	      onMatcher: setNewMatcher,
	      onCommand: setNewCommand,
	      onTimeout: setNewTimeout,
	      onSubmit: submitNew,
	      onCancel: () => {
	        setNewOpen(false);
	        setFormError(null);
	      }
	    }
	  ) : null, needle !== "" && rows.length === 0 ? /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, "没有匹配的 hook") : rows.length === 0 && primary !== void 0 ? primary.state === "error" ? /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, "文件读不出来，无法判断里面有没有 hook（见上面的提示）。") : /* @__PURE__ */ h(
	    EmptyState,
	    {
	      block: emptyBlockOf(snapshot, primary),
	      writable,
	      busy,
	      onCreateHook: () => {
	        setNewOpen(true);
	        setFormError(null);
	      },
	      onCreateFile: () => {
	        runWrite({ op: "createFile" });
	      },
	      onGuide: changeScope
	    }
	  ) : rows.length === 0 ? /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, "这个作用域没有可编辑的文件。") : /* @__PURE__ */ h("div", { className: "dsh-hooks__list" }, rows.map((row) => {
	    const kind = primary === void 0 ? "project" : primary.kind;
	    const key = rowKey(kind, row.event, row.groupRawIndex, row.hook.rawIndex);
	    return /* @__PURE__ */ h(
	      HookCard,
	      {
	        key,
	        hook: row.hook,
	        event: row.event,
	        matcher: row.matcher,
	        matcherProblem: row.matcherProblem,
	        writable,
	        busy,
	        editing: editingKey === key,
	        draft,
	        confirming: confirmKey === key,
	        menuOpen: menuKey === key || editingKey === key || confirmKey === key,
	        dryText: dryKey === key ? dryText : "",
	        onToggle: () => {
	          runWrite({
	            op: "setHookDisabled",
	            event: row.event,
	            groupIndex: row.groupRawIndex,
	            hookIndex: row.hook.rawIndex,
	            disabled: !row.hook.disabled
	          });
	        },
	        onToggleMenu: () => {
	          if (menuKey === key) {
	            setMenuKey("");
	            setEditingKey("");
	            setConfirmKey("");
	            setDraft("");
	            return;
	          }
	          setMenuKey(key);
	        },
	        onStartEdit: () => {
	          setEditingKey(key);
	          setDraft(row.hook.command);
	          setConfirmKey("");
	        },
	        onDraftChange: (value) => {
	          setDraft(value);
	        },
	        onCancelEdit: () => {
	          setEditingKey("");
	          setDraft("");
	          setMenuKey("");
	        },
	        onSave: () => {
	          runWrite({
	            op: "setHookCommand",
	            event: row.event,
	            groupIndex: row.groupRawIndex,
	            hookIndex: row.hook.rawIndex,
	            command: draft
	          });
	        },
	        onAskRemove: () => {
	          setConfirmKey(key);
	          setEditingKey("");
	        },
	        onCancelRemove: () => {
	          setConfirmKey("");
	          setMenuKey("");
	        },
	        onRemove: () => {
	          runWrite({
	            op: "removeHook",
	            event: row.event,
	            groupIndex: row.groupRawIndex,
	            hookIndex: row.hook.rawIndex
	          });
	        },
	        onDryRun: () => {
	          dryRun(kind, row.event, row.groupRawIndex, row.hook);
	        }
	      }
	    );
	  })), others.filter((file) => file.hookCount > 0 || file.state === "error").map((file) => {
	    const name = fileKindLabel(file.kind);
	    const target = file.kind === "user" ? "user" : currentScopeTarget(snapshot);
	    const switchable = wantSwitchTo(snapshot, target);
	    return /* @__PURE__ */ h("div", { className: "dsh-hooks__other", key: file.kind }, file.state === "error" ? /* @__PURE__ */ h("span", { className: "dsh-hooks__muted" }, name, "这份配置读不出来（详情见「更多」）") : /* @__PURE__ */ h(Fragment2, null, /* @__PURE__ */ h("span", { className: "dsh-hooks__muted" }, name, "还有 ", String(file.hookCount), " 个 hook"), switchable ? /* @__PURE__ */ h(
	      "button",
	      {
	        type: "button",
	        className: "dsh-hooks__btn dsh-hooks__btn--ghost",
	        title: `切到${name}`,
	        disabled: busy,
	        onClick: () => {
	          changeScope(target);
	        }
	      },
	      "切过去"
	    ) : null));
	  }), /* @__PURE__ */ h("div", { className: "dsh-hooks__folds" }, /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__disclosure",
	      title: "更多",
	      "aria-expanded": moreOpen,
	      onClick: () => {
	        setMoreOpen(!moreOpen);
	      }
	    },
	    moreOpen ? "▾" : "▸",
	    " 更多"
	  )), moreOpen ? /* @__PURE__ */ h("div", { className: "dsh-hooks__foldbody" }, eventRows.map(({ event, file }) => /* @__PURE__ */ h("div", { className: "dsh-hooks__eventrow", key: event }, /* @__PURE__ */ h("span", { className: "dsh-hooks__eventname dsh-hooks__eventname--fold", title: eventTitle(event) }, eventLabel(event), /* @__PURE__ */ h("span", { className: "dsh-hooks__eventid" }, event)), file === void 0 || file.groups.length === 0 ? /* @__PURE__ */ h("span", { className: "dsh-hooks__muted" }, "没有配置", file !== void 0 && file.runCount > 0 ? `（但历史上跑过 ${String(file.runCount)} 次）` : "") : /* @__PURE__ */ h("span", { className: "dsh-hooks__count" }, String(file.hookCount), " 个", file.disabledCount > 0 ? `（另有 ${String(file.disabledCount)} 个已停用）` : ""), writable ? (
	    // 空事件行右侧是 **`＋` 字形按钮**（过去是六个「＋新建」文字按钮 = 用户说的"噪音"）。
	    // 它仍然是一个真按钮：`title` / `aria-label` 说清"在哪个事件下新建"，键盘能 Tab 到。
	    /* @__PURE__ */ h(
	      "button",
	      {
	        type: "button",
	        className: "dsh-hooks__btn dsh-hooks__btn--ghost dsh-hooks__glyphbtn",
	        title: `在 ${event} 下新建`,
	        "aria-label": `在 ${eventLabel(event)}（${event}）下新建`,
	        disabled: busy,
	        onClick: () => {
	          setNewEvent(event);
	          setNewOpen(true);
	          setFormError(null);
	        }
	      },
	      "＋"
	    )
	  ) : null))) : null, moreOpen ? /* @__PURE__ */ h("div", { className: "dsh-hooks__foldbody" }, /* @__PURE__ */ h(DiagRow, { label: "作用域", value: help }), /* @__PURE__ */ h(DiagRow, { label: "当前会话", value: sessionLine(snapshot) }), /* @__PURE__ */ h(DiagRow, { label: "项目根", value: snapshot.projectRoot ?? "未知（没有会话上下文，不编造）" }), /* @__PURE__ */ h(DiagRow, { label: "cwd 来源", value: snapshot.cwdSource }), /* @__PURE__ */ h(DiagRow, { label: "写入权限", value: "按调用会话的沙箱策略判定；被拒绝时报 sandbox" }), /* @__PURE__ */ h(
	    DiagRow,
	    {
	      label: "作用域回显",
	      value: `kind=${snapshot.scope.kind} requested=${snapshot.scope.requested} workspaceId=${String(
	        snapshot.scope.workspaceId
	      )} isCurrentSession=${String(snapshot.scope.isCurrentSession)}`
	    }
	  ), primary === void 0 ? null : /* @__PURE__ */ h(
	    DiagRow,
	    {
	      label: "当前文件",
	      value: `${primary.path} · ${stateToken(primary)} · 版本 ${String(primary.version)} · ${String(
	        primary.hookCount
	      )} 个`
	    }
	  ), others.map((file) => /* @__PURE__ */ h(
	    DiagRow,
	    {
	      key: file.kind,
	      label: file.kind === "user" ? "用户级文件" : "项目级文件",
	      value: `${file.path} · ${stateToken(file)} · 版本 ${String(file.version)} · ${String(file.hookCount)} 个`
	    }
	  )), snapshot.scope.workspacePath !== null && snapshot.scope.workspacePath !== snapshot.scope.projectRoot ? /* @__PURE__ */ h(
	    DiagRow,
	    {
	      label: "工作区路径",
	      value: `${snapshot.scope.workspacePath}（≠ 项目根，配置落在项目根的 .dsh/hooks.json）`
	    }
	  ) : null, /* @__PURE__ */ h(DiagRow, { label: "staleInUse", value: snapshot.staleInUse ? "是（沿用上一份可用配置）" : "否" }), /* @__PURE__ */ h(
	    DiagRow,
	    {
	      label: "工作区清单",
	      value: snapshot.workspacesAvailable ? `${String(snapshot.workspaces.length)} 项` : "宿主没有提供工作区清单，只能改当前项目和用户级配置"
	    }
	  ), snapshot.workspacesAvailable && currentProjectMissing(snapshot) ? /* @__PURE__ */ h(
	    DiagRow,
	    {
	      label: "当前会话项目",
	      value: `${String(snapshot.projectRoot)} 不在清单里 —— 用作用域下拉的「当前会话项目（${lastSegment(
	        String(snapshot.projectRoot)
	      )}）」编辑它`
	    }
	  ) : null, primary === void 0 ? null : /* @__PURE__ */ h(
	    DiagRow,
	    {
	      label: "matcher 诊断",
	      value: primary.matcherErrors.length === 0 ? "无" : primary.matcherErrors.join("；")
	    }
	  ), primary === void 0 ? null : /* @__PURE__ */ h(
	    DiagRow,
	    {
	      label: "跳过的 handler",
	      value: primary.skipped.length === 0 ? "无" : primary.skipped.map((item) => `${item.event}:${item.type}`).join("、")
	    }
	  ), banner === null ? null : /* @__PURE__ */ h(DiagRow, { label: "错误详情", value: `${banner.code} ${banner.detail}` })) : null);
	}
	function DiagRow(props) {
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks__diagrow" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__diagkey" }, props.label), /* @__PURE__ */ h("span", { className: "dsh-hooks__diagval" }, props.value));
	}
	function sessionLine(snapshot) {
	  const session = snapshot.session;
	  if (session === null) return "当前会话未知，无法判断实际会跑什么";
	  const counts = `${String(session.hookCount)} 个（用户级 ${String(session.fromUser)} + 项目级 ${String(
	    session.fromProject
	  )}）`;
	  return session.staleInUse ? `当前会话生效 ${counts} · 正在沿用上一份可用配置` : `当前会话生效 ${counts}`;
	}
	function sessionShortLine(snapshot) {
	  const session = snapshot.session;
	  if (session === null) return "当前会话未知，无法判断实际会跑什么";
	  return `本会话生效 ${String(session.hookCount)} 个`;
	}

	// src/client/index.ts
	var SECTION_ID = "hooks";
	var SECTION_LABEL = "Hooks";
	var SECTION_ORDER = 920;
	function apply(ctx) {
	  ctx.inject(["slots"], (scope) => {
	    scope.slots.inject(
	      "settings.section",
	      () => scope.slots.register(
	        {
	          name: "settings.section",
	          id: SECTION_ID,
	          order: SECTION_ORDER,
	          label: () => SECTION_LABEL
	        },
	        HooksSection
	      )
	    );
	  });
	}

		return module.exports;
	},
});

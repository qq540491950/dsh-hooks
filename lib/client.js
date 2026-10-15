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
	`;

	// src/client/hook-card.tsx
	function statusOf(hook) {
	  if (hook.disabled) return { className: "dsh-hooks__dot", label: "已停用（不会运行）" };
	  const run = hook.lastRun;
	  if (run === null) return { className: "dsh-hooks__dot", label: "未运行（没有执行记录）" };
	  const where = `exit ${run.exitCode === null ? "spawn-failed" : String(run.exitCode)} · ${run.durationMs}ms`;
	  if (run.decision === "deny" || run.decision === "block") {
	    return { className: "dsh-hooks__dot dsh-hooks__dot--deny", label: `已阻断 · ${where}` };
	  }
	  if (run.exitCode === 0) return { className: "dsh-hooks__dot dsh-hooks__dot--ok", label: `通过 · ${where}` };
	  return { className: "dsh-hooks__dot dsh-hooks__dot--warn", label: `失败 · ${where}` };
	}
	function initialOf(event) {
	  return event.slice(0, 1).toUpperCase();
	}
	function HookCard(props) {
	  const { hook, event, matcher, matcherProblem, writable, busy, editing, draft, confirming, dryText } = props;
	  const status = statusOf(hook);
	  const run = hook.lastRun;
	  const dotTitle = run === null ? status.label : `${status.label}
	${run.stderr || run.stdout || "(无输出)"}`;
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks__hookcard" }, /* @__PURE__ */ h("div", { className: "dsh-hooks__cardmain" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__icon", "aria-hidden": "true", title: event }, initialOf(event)), /* @__PURE__ */ h("span", { className: "dsh-hooks__cardtext" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__eventname", title: event }, event, hook.disabled ? /* @__PURE__ */ h("span", { className: "dsh-hooks__tag" }, "已停用") : null), editing ? (
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
	  ) : /* @__PURE__ */ h("span", { className: "dsh-hooks__cmd", title: hook.command }, hook.command)), /* @__PURE__ */ h(
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
	  )), /* @__PURE__ */ h("div", { className: "dsh-hooks__detailRow" }, /* @__PURE__ */ h("span", { className: status.className, title: dotTitle }), /* @__PURE__ */ h("span", { className: "dsh-hooks__meta" }, status.label), matcher === null ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__meta", title: matcherProblem ?? "matcher" }, "matcher: ", matcher), /* @__PURE__ */ h("span", { className: "dsh-hooks__meta", title: "超时（未写则为默认值）" }, hook.timeoutSec === null ? `${String(hook.defaultTimeoutSec)}s 默认` : `${String(hook.timeoutSec)}s`), matcherProblem === null ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__tag" }, "matcher 非法，这一组不会运行"), writable ? editing ? /* @__PURE__ */ h("span", { className: "dsh-hooks__actions" }, /* @__PURE__ */ h(
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
	  )) : null), dryText === "" ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__dry" }, dryText));
	}

	// src/client/new-hook.tsx
	var MATCHERLESS = /* @__PURE__ */ new Set(["UserPromptSubmit", "Stop"]);
	function NewHookForm(props) {
	  const { draft, error, errorDetail, busy, writable } = props;
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks__newform" }, /* @__PURE__ */ h("div", { className: "dsh-hooks__newfield" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__newlabel" }, "事件"), /* @__PURE__ */ h(
	    "select",
	    {
	      className: "dsh-hooks__select dsh-hooks__newselect",
	      value: draft.event,
	      onChange: (changeEvent) => {
	        props.onEvent(changeEvent.target.value);
	      }
	    },
	    HOOK_EVENTS.map((event) => /* @__PURE__ */ h("option", { key: event, value: event }, event))
	  ), MATCHERLESS.has(draft.event) ? /* @__PURE__ */ h("span", { className: "dsh-hooks__muted" }, "这个事件没有 matcher（写了也不生效）") : /* @__PURE__ */ h(Fragment2, null, /* @__PURE__ */ h("span", { className: "dsh-hooks__newlabel" }, "matcher"), /* @__PURE__ */ h(
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
	  ))), /* @__PURE__ */ h("div", { className: "dsh-hooks__newfield" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__newlabel" }, "命令"), /* @__PURE__ */ h(
	    "textarea",
	    {
	      className: "dsh-hooks__editor",
	      value: draft.command,
	      rows: 2,
	      onChange: (changeEvent) => {
	        props.onCommand(changeEvent.target.value);
	      }
	    }
	  )), /* @__PURE__ */ h("div", { className: "dsh-hooks__newfield" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__newlabel" }, "超时"), /* @__PURE__ */ h(
	    "input",
	    {
	      className: "dsh-hooks__input",
	      type: "text",
	      value: draft.timeout,
	      placeholder: "秒；留空用默认 600s",
	      onChange: (changeEvent) => {
	        props.onTimeout(changeEvent.target.value);
	      }
	    }
	  )), error === null ? null : /* @__PURE__ */ h("div", { className: "dsh-hooks__newerror" }, error, errorDetail === "" ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__muted" }, "（", errorDetail, "）")), /* @__PURE__ */ h("div", { className: "dsh-hooks__newfield" }, /* @__PURE__ */ h(
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
	  const where = viaCurrent ? "当前会话的项目" : view.workspaceTitle ?? view.workspaceId ?? scope;
	  if (view.isCurrentSession === false) {
	    return `你正在看/改 ${where}；改动不会作用于当前会话（项目根 ${String(snapshot.projectRoot)}），只影响以后在 ${where} 里打开的会话。写入还可能被当前会话的沙箱拒绝（报 sandbox 属预期）。`;
	  }
	  return `你正在看/改 ${where}；但当前会话未知，无法判断它是不是当前会话的项目。`;
	}
	function otherFileGuide(selected, file) {
	  if (file === "user") return selected === "user" ? null : "用户（全局）";
	  return selected === "workspace" ? null : "对应的工作区";
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
	function currentScopeTarget(snapshot) {
	  const root = snapshot.projectRoot;
	  const known = snapshot.workspaces.find((workspace) => workspace.projectRoot === root);
	  return known === void 0 ? CURRENT_SCOPE : known.id;
	}
	function emptyGuideOf(snapshot) {
	  const raw = rawEmptyGuideOf(snapshot);
	  if (raw === null || raw.target === echoedScopeOf(snapshot)) return null;
	  return raw;
	}
	function rawEmptyGuideOf(snapshot) {
	  if (snapshot.scope.kind === "user") {
	    const session = snapshot.session;
	    if (session === null || session.fromProject <= 0) return null;
	    return {
	      text: `当前会话项目（${lastSegment(session.projectRoot)}）里有 ${String(session.fromProject)} 条。`,
	      action: "切换过去",
	      target: currentScopeTarget(snapshot)
	    };
	  }
	  const userFile = snapshot.files.find((file) => file.kind === "user");
	  if (userFile === void 0 || userFile.state !== "ok" || userFile.hookCount <= 0) return null;
	  return {
	    text: `用户级（全局）里有 ${String(userFile.hookCount)} 条。`,
	    action: "切换过去",
	    target: "user"
	  };
	}
	function emptyBlockOf(snapshot, file) {
	  const absent = file.state === "absent";
	  return {
	    body: absent ? "这份 hooks.json 还不存在（这是“空的”，不是出错）。" : "文件里没有任何 hook。",
	    path: file.path,
	    canCreateFile: absent,
	    guide: emptyGuideOf(snapshot)
	  };
	}
	function EmptyState(props) {
	  const { block, writable, busy } = props;
	  const guide = block.guide;
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks__empty" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__emptytitle" }, "这个作用域还没有 hook"), /* @__PURE__ */ h("span", { className: "dsh-hooks__muted" }, block.body), /* @__PURE__ */ h("span", { className: "dsh-hooks__path" }, block.path), writable ? /* @__PURE__ */ h("span", { className: "dsh-hooks__emptyactions" }, /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn dsh-hooks__btn--primary",
	      title: "新建第一条 hook",
	      disabled: busy,
	      onClick: props.onCreateHook
	    },
	    "＋ 新建第一条 hook"
	  ), block.canCreateFile ? /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn dsh-hooks__btn--ghost",
	      title: "新建配置文件",
	      disabled: busy,
	      onClick: props.onCreateFile
	    },
	    "新建配置文件"
	  ) : null) : null, guide === null ? null : /* @__PURE__ */ h("div", { className: "dsh-hooks__emptyguide" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__muted" }, guide.text), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn dsh-hooks__btn--ghost",
	      title: guide.action,
	      disabled: busy,
	      onClick: () => {
	        props.onGuide(guide.target);
	      }
	    },
	    guide.action
	  )));
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
	  const [allEventsOpen, setAllEventsOpen] = useState2(false);
	  const [diagOpen, setDiagOpen] = useState2(false);
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
	    setFormError(null);
	    setNewOpen(false);
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
	  const installed = fileTotal - (primary === void 0 ? 0 : disabledCountOf(primary));
	  const shown = rows.length;
	  const displayLabel = echoedLabelOf(snapshot);
	  const currentIndex = Math.max(
	    0,
	    options.findIndex((option) => option.value === displayScope)
	  );
	  const help = scopeHelp(snapshot, displayScope);
	  const brokenFile = snapshot.files.find((file) => file.state === "error");
	  const alert = banner !== null ? (
	    // 技术原文只作**补充**（§3.9：绝不作为主文案，但排查要用得上）
	    { tone: "error", text: writeErrorSentence(banner.code), detail: banner.detail }
	  ) : brokenFile !== void 0 || snapshot.staleInUse ? {
	    tone: "error",
	    text: "有配置文件现在读不出来（内容不是合法 JSON）—— 运行中的 hook 仍在沿用上一份可用配置。",
	    detail: brokenFile?.message ?? ""
	  } : snapshot.scope.kind === "workspace" && snapshot.scope.isCurrentSession === false ? { tone: "warn", text: help, detail: "" } : writable ? null : { tone: "info", text: "本页当前是只读模式（宿主没有提供写入能力）。", detail: "" };
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
	  ), /* @__PURE__ */ h("span", { className: "dsh-hooks__count", title: "这个作用域文件里的 hook 条数（含已停用）" }, "钩子 ", String(fileTotal)), /* @__PURE__ */ h("span", { className: "dsh-hooks__spacer" }), /* @__PURE__ */ h(
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
	  )), /* @__PURE__ */ h("div", { className: "dsh-hooks__toolbar" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__installed" }, "已安装 ", String(installed), fileTotal - installed > 0 ? ` · 已停用 ${String(fileTotal - installed)}` : "", needle === "" ? "" : ` · 筛选后 ${String(shown)} / 共 ${String(fileTotal)}`), /* @__PURE__ */ h("span", { className: "dsh-hooks__session", title: "当前会话实际会跑的那一份（与所选作用域无关）" }, sessionLine(snapshot)), /* @__PURE__ */ h("span", { className: "dsh-hooks__toolbarActions" }, /* @__PURE__ */ h(
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
	      title: "新建",
	      disabled: busy || !writable,
	      onClick: () => {
	        setNewOpen(!newOpen);
	        setFormError(null);
	      }
	    },
	    "＋ 新建"
	  ))), alert === null ? null : /* @__PURE__ */ h(
	    "div",
	    {
	      className: `dsh-hooks__alert${alert.tone === "error" ? " dsh-hooks__alert--error" : alert.tone === "info" ? " dsh-hooks__alert--info" : ""}`
	    },
	    alert.text,
	    alert.detail === "" ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__muted" }, "（", alert.detail, "）")
	  ), newOpen ? /* @__PURE__ */ h(
	    NewHookForm,
	    {
	      draft: { event: newEvent, matcher: newMatcher, command: newCommand, timeout: newTimeout },
	      error: formError === null ? null : writeErrorSentence(formError.code),
	      errorDetail: formError === null ? "" : formError.detail,
	      busy,
	      writable,
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
	  })), others.map((file) => {
	    const guide = otherFileGuide(snapshot.scope.kind, file.kind);
	    return /* @__PURE__ */ h("div", { className: "dsh-hooks__muted", key: file.kind }, file.kind === "user" ? "用户级（全局）" : "项目级", " · ", /* @__PURE__ */ h("span", { className: "dsh-hooks__path" }, file.path), " ", "· ", String(file.hookCount), " 条 · ", stateToken(file), guide === null ? null : /* @__PURE__ */ h(Fragment2, null, " · 要编辑请把作用域切到「", guide, "」"));
	  }), /* @__PURE__ */ h("div", { className: "dsh-hooks__folds" }, /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__disclosure",
	      title: "查看全部事件",
	      "aria-expanded": allEventsOpen,
	      onClick: () => {
	        setAllEventsOpen(!allEventsOpen);
	      }
	    },
	    allEventsOpen ? "▾" : "▸",
	    " 查看全部事件（",
	    String(HOOK_EVENTS.length),
	    "）"
	  ), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__disclosure",
	      title: "诊断",
	      "aria-expanded": diagOpen,
	      onClick: () => {
	        setDiagOpen(!diagOpen);
	      }
	    },
	    diagOpen ? "▾" : "▸",
	    " 诊断"
	  )), allEventsOpen ? /* @__PURE__ */ h("div", { className: "dsh-hooks__foldbody" }, eventRows.map(({ event, file }) => /* @__PURE__ */ h("div", { className: "dsh-hooks__eventrow", key: event }, /* @__PURE__ */ h("span", { className: "dsh-hooks__eventname dsh-hooks__eventname--fold" }, event), file === void 0 || file.groups.length === 0 ? /* @__PURE__ */ h("span", { className: "dsh-hooks__muted" }, "没有配置", file !== void 0 && file.runCount > 0 ? `（但历史上跑过 ${String(file.runCount)} 次）` : "") : /* @__PURE__ */ h("span", { className: "dsh-hooks__count" }, String(file.hookCount), " 条", file.disabledCount > 0 ? `（另有 ${String(file.disabledCount)} 条已停用）` : ""), writable ? /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn dsh-hooks__btn--ghost",
	      title: `在 ${event} 下新建`,
	      disabled: busy,
	      onClick: () => {
	        setNewEvent(event);
	        setNewOpen(true);
	        setFormError(null);
	      }
	    },
	    "＋新建"
	  ) : null))) : null, diagOpen ? /* @__PURE__ */ h("div", { className: "dsh-hooks__foldbody" }, /* @__PURE__ */ h(DiagRow, { label: "作用域", value: help }), /* @__PURE__ */ h(DiagRow, { label: "当前会话", value: sessionLine(snapshot) }), /* @__PURE__ */ h(DiagRow, { label: "项目根", value: snapshot.projectRoot ?? "未知（没有会话上下文，不编造）" }), /* @__PURE__ */ h(DiagRow, { label: "cwd 来源", value: snapshot.cwdSource }), /* @__PURE__ */ h(
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
	      )} 条`
	    }
	  ), others.map((file) => /* @__PURE__ */ h(
	    DiagRow,
	    {
	      key: file.kind,
	      label: file.kind === "user" ? "用户级文件" : "项目级文件",
	      value: `${file.path} · ${stateToken(file)} · 版本 ${String(file.version)} · ${String(file.hookCount)} 条`
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
	  const counts = `${String(session.hookCount)} 条（用户级 ${String(session.fromUser)} + 项目级 ${String(
	    session.fromProject
	  )}）`;
	  return session.staleInUse ? `当前会话生效 ${counts}· 正在沿用上一份可用配置` : `当前会话生效 ${counts}`;
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

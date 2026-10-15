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
	function HookCard(props) {
	  const { hook, writable, busy, editing, draft, confirming, dryText } = props;
	  const status = statusOf(hook);
	  const run = hook.lastRun;
	  const dotTitle = run === null ? status.label : `${status.label}
	${run.stderr || run.stdout || "(无输出)"}`;
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks__hookcard" }, /* @__PURE__ */ h("div", { className: "dsh-hooks__cardmain" }, /* @__PURE__ */ h("span", { className: status.className, title: dotTitle }), editing ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__cmd", title: hook.command }, hook.command), hook.disabled ? /* @__PURE__ */ h("span", { className: "dsh-hooks__tag" }, "已停用") : null, /* @__PURE__ */ h(
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
	  )), editing ? /* @__PURE__ */ h("div", { className: "dsh-hooks__detailRow" }, /* @__PURE__ */ h(
	    "textarea",
	    {
	      className: "dsh-hooks__editor",
	      value: draft,
	      rows: 1,
	      onChange: (changeEvent) => {
	        props.onDraftChange(changeEvent.target.value);
	      }
	    }
	  ), /* @__PURE__ */ h("button", { type: "button", className: "dsh-hooks__btn", title: "保存", disabled: busy, onClick: props.onSave }, "保存"), /* @__PURE__ */ h("button", { type: "button", className: "dsh-hooks__btn", disabled: busy, onClick: props.onCancelEdit }, "取消")) : confirming ? /* @__PURE__ */ h("div", { className: "dsh-hooks__detailRow" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__meta" }, "删除这一条？"), /* @__PURE__ */ h("button", { type: "button", className: "dsh-hooks__btn", title: "确认删除", disabled: busy, onClick: props.onRemove }, "确认删除"), /* @__PURE__ */ h("button", { type: "button", className: "dsh-hooks__btn", disabled: busy, onClick: props.onCancelRemove }, "取消")) : /* @__PURE__ */ h("div", { className: "dsh-hooks__detailRow" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__meta", title: "超时（未写则为默认值）" }, hook.timeoutSec === null ? `${String(hook.defaultTimeoutSec)}s 默认` : `${String(hook.timeoutSec)}s`), /* @__PURE__ */ h("span", { className: "dsh-hooks__meta" }, status.label), writable ? /* @__PURE__ */ h("span", { className: "dsh-hooks__actions" }, /* @__PURE__ */ h("button", { type: "button", className: "dsh-hooks__btn", title: "试运行", disabled: busy, onClick: props.onDryRun }, "试运行"), /* @__PURE__ */ h("button", { type: "button", className: "dsh-hooks__btn", title: "编辑", disabled: busy, onClick: props.onStartEdit }, "编辑"), /* @__PURE__ */ h("button", { type: "button", className: "dsh-hooks__btn", title: "删除", disabled: busy, onClick: props.onAskRemove }, "删除")) : null), dryText === "" ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__dry" }, dryText));
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
	      className: "dsh-hooks__btn",
	      title: "创建",
	      disabled: busy || !writable || draft.command.trim() === "",
	      onClick: props.onSubmit
	    },
	    "创建"
	  ), /* @__PURE__ */ h("button", { type: "button", className: "dsh-hooks__btn", disabled: busy, onClick: props.onCancel }, "取消")));
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
	function intentFor(scope, op) {
	  return { ...scopeTargetOf(scope), ...op };
	}
	function writeErrorSentence(error) {
	  switch (error) {
	    case "stale":
	      return "这个文件刚被别处改过了，页面上的内容已经不是最新的。请刷新后再改。";
	    case "invalid-json":
	      return "文件现在读不出来（内容不是合法 JSON）。为避免覆盖你的内容，这次**没有写入**，请先手工修好文件。";
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
	async function requestWrite(intent, signal) {
	  try {
	    const response = await fetch(HOOKS_ROUTE, {
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
	async function requestDryRun(intent, signal) {
	  try {
	    const response = await fetch(HOOKS_ROUTE, {
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
	function fileStateText(file) {
	  switch (file.state) {
	    case "absent":
	      return '文件不存在（这表示"这份配置是空的"，不是出错）';
	    case "ok":
	      return "已读取";
	    default:
	      return "读不出来 —— 文件内容不是合法 JSON，请手工修好；运行中的 hook 仍在沿用上一份可用配置";
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
	function scopeLabel(snapshot, scope) {
	  if (scope === "user") return "用户级";
	  if (scope === CURRENT_SCOPE) return "当前会话项目";
	  const found = snapshot.workspaces.find((workspace) => workspace.id === scope);
	  return found === void 0 ? scope : found.title;
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
	function scopeBanner(snapshot, scope) {
	  const { scope: view } = snapshot;
	  if (view.kind === "user") {
	    return {
	      tone: "info",
	      text: "用户级配置：对**所有**项目生效；每个项目还会叠加它自己的项目级配置（用户级先跑）。"
	    };
	  }
	  const roots = view.workspacePath !== null && view.workspacePath !== view.projectRoot ? `；工作区路径 ${view.workspacePath}，项目根 ${String(view.projectRoot)}（配置落在项目根的 .dsh/hooks.json）` : view.projectRoot === null ? "" : `（项目根 ${view.projectRoot}）`;
	  const viaCurrent = view.workspaceId === null && view.workspacePath === null;
	  if (view.isCurrentSession === true) {
	    return {
	      tone: "info",
	      text: `当前会话就在${viaCurrent ? "这个项目" : "这个工作区"}${roots}，改动对之后的调用**立即**生效。`
	    };
	  }
	  const where = viaCurrent ? "当前会话的项目" : view.workspaceTitle ?? view.workspaceId ?? scope;
	  if (view.isCurrentSession === false) {
	    return {
	      tone: "warn",
	      text: `你正在看/改 **${where}**${roots}；当前会话的项目根是 ${String(snapshot.projectRoot)}。这次改动**不会**影响当前会话，只影响以后在它里面打开的会话。另外，当前会话的沙箱权限可能不允许写这个文件（那会报 sandbox）—— 那是预期行为，不是 bug。`
	    };
	  }
	  return {
	    tone: "warn",
	    text: `你正在看/改 **${where}**${roots}；但**当前会话未知**，无法判断它是不是当前会话的项目。`
	  };
	}
	function primaryFileOf(snapshot) {
	  const wanted = snapshot.scope.kind === "user" ? "user" : "project";
	  return snapshot.files.find((file) => file.kind === wanted) ?? snapshot.files[0];
	}
	function HooksSection() {
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
	  const [showEffective, setShowEffective] = useState2(false);
	  useEffect2(() => {
	    const controller = new AbortController();
	    const timer = setTimeout(() => {
	      controller.abort();
	    }, REQUEST_TIMEOUT_MS);
	    void (async () => {
	      try {
	        const response = await fetch(`${HOOKS_ROUTE}${scopeQuery(scope)}`, {
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
	  }, [nonce, scope]);
	  const runRequest = (op, channel, onSuccess) => {
	    if (busy) return;
	    setBusy(true);
	    if (channel === "page") setBanner(null);
	    else setFormError(null);
	    void (async () => {
	      const outcome = await requestWrite(intentFor(scope, op));
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
	        dryRunFor(scope, { event, groupIndex: groupRawIndex, hookIndex: hook.rawIndex })
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
	    return /* @__PURE__ */ h("div", { className: "dsh-hooks" }, /* @__PURE__ */ h("style", null, styles), /* @__PURE__ */ h("div", { className: "dsh-hooks__banner dsh-hooks__banner--error" }, sentenceFor(phase.code)), phase.detail === "" ? null : /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, phase.detail), /* @__PURE__ */ h("div", { className: "dsh-hooks__toolbar" }, /* @__PURE__ */ h(
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
	  const installed = primary === void 0 ? 0 : primary.hookCount - primaryDisabled(primary);
	  const scopeSentence = scopeBanner(snapshot, scope);
	  const renderEvent = (view, file) => {
	    const groups = view.groups.map((group) => ({ group, hooks: group.hooks.filter((hook) => matches(hook, group, view.event)) })).filter((entry) => entry.hooks.length > 0);
	    const shown = groups.reduce((sum, entry) => sum + entry.hooks.length, 0);
	    return /* @__PURE__ */ h(Fragment2, { key: view.event }, /* @__PURE__ */ h("div", { className: "dsh-hooks__event" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__eventname" }, view.event), groups.length === 0 ? /* @__PURE__ */ h("span", { className: "dsh-hooks__empty" }, needle === "" ? "没有配置" : "没有匹配的 hook", needle === "" && "runCount" in view && view.runCount > 0 ? `（但历史上跑过 ${String(view.runCount)} 次）` : "") : /* @__PURE__ */ h("span", { className: "dsh-hooks__count" }, String(shown), " 条"), writable ? /* @__PURE__ */ h(
	      "button",
	      {
	        type: "button",
	        className: "dsh-hooks__toolbtn",
	        title: `在 ${view.event} 下新建`,
	        disabled: busy,
	        onClick: () => {
	          setNewEvent(view.event);
	          setNewOpen(true);
	          setFormError(null);
	        }
	      },
	      "＋新建"
	    ) : null), groups.map(({ group, hooks }) => /* @__PURE__ */ h(Fragment2, { key: `${view.event}:${String(group.rawIndex)}` }, /* @__PURE__ */ h("div", { className: "dsh-hooks__matcher" }, group.matcher === null ? "匹配全部" : `matcher: ${group.matcher}`, group.matcherOk ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__tag" }, "matcher 非法，这一组不会运行"), group.file === null ? /* @__PURE__ */ h("span", { className: "dsh-hooks__tag" }, "来源无法确定（正在沿用上一份配置）") : null), /* @__PURE__ */ h("div", { className: "dsh-hooks__list" }, hooks.map((hook) => {
	      const kind = group.file ?? file.kind;
	      const key = rowKey(kind, view.event, group.rawIndex, hook.rawIndex);
	      return /* @__PURE__ */ h(
	        HookCard,
	        {
	          key: `${String(group.rawIndex)}:${String(hook.rawIndex)}`,
	          hook,
	          writable: writable && group.file !== null,
	          busy,
	          editing: editingKey === key,
	          draft,
	          confirming: confirmKey === key,
	          dryText: dryKey === key ? dryText : "",
	          onToggle: () => {
	            runWrite({
	              op: "setHookDisabled",
	              event: view.event,
	              groupIndex: group.rawIndex,
	              hookIndex: hook.rawIndex,
	              disabled: !hook.disabled
	            });
	          },
	          onStartEdit: () => {
	            setEditingKey(key);
	            setDraft(hook.command);
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
	              event: view.event,
	              groupIndex: group.rawIndex,
	              hookIndex: hook.rawIndex,
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
	              event: view.event,
	              groupIndex: group.rawIndex,
	              hookIndex: hook.rawIndex
	            });
	          },
	          onDryRun: () => {
	            dryRun(kind, view.event, group.rawIndex, hook);
	          }
	        }
	      );
	    })))));
	  };
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks" }, /* @__PURE__ */ h("style", null, styles), /* @__PURE__ */ h("div", { className: "dsh-hooks__toolbar" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__scope" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__newlabel" }, "作用域"), /* @__PURE__ */ h(
	    "select",
	    {
	      className: "dsh-hooks__select",
	      value: scope,
	      onChange: (changeEvent) => {
	        changeScope(changeEvent.target.value);
	      }
	    },
	    /* @__PURE__ */ h("option", { value: "user" }, "用户（全局）"),
	    currentProjectMissing(snapshot) ? /* @__PURE__ */ h("option", { value: CURRENT_SCOPE }, "当前会话项目（", lastSegment(String(snapshot.projectRoot)), "）") : null,
	    snapshot.workspaces.length === 0 ? null : /* @__PURE__ */ h("optgroup", { label: "工作区" }, snapshot.workspaces.map((workspace) => /* @__PURE__ */ h("option", { key: workspace.id, value: workspace.id }, workspace.title)))
	  )), primary === void 0 ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__count", title: "这个文件里的 hook 条数（含已停用）" }, "钩子 ", String(primary.hookCount)), /* @__PURE__ */ h(
	    "input",
	    {
	      className: "dsh-hooks__search",
	      type: "text",
	      value: query,
	      placeholder: "搜索钩子…",
	      onChange: (changeEvent) => {
	        setQuery(changeEvent.target.value);
	      }
	    }
	  ), /* @__PURE__ */ h("span", { className: "dsh-hooks__toolbarActions" }, /* @__PURE__ */ h(
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
	  ))), /* @__PURE__ */ h("div", { className: "dsh-hooks__toolbar" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__installed" }, "已安装 ", String(installed), primary !== void 0 && primary.hookCount - installed > 0 ? ` · 已停用 ${String(primary.hookCount - installed)}` : ""), primary === void 0 ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__path" }, primary.path)), snapshot.projectRoot === null ? /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, "当前会话的项目根未知（没有会话上下文）—— 不编造一个路径。") : /* @__PURE__ */ h("div", { className: "dsh-hooks__root", title: "当前会话的项目根（hook 运行时按它解析）" }, "当前会话项目根：", snapshot.projectRoot), snapshot.workspacesAvailable ? null : /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, '宿主没有提供工作区清单（只能改用户级配置）—— 这是"这个宿主给不了这个能力"，不是"你没有工作区"。'), snapshot.workspacesAvailable && snapshot.workspaces.length === 0 ? /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, "还没有工作区。") : null, snapshot.workspacesAvailable && currentProjectMissing(snapshot) ? /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, "当前会话的项目（", snapshot.projectRoot, "）不在工作区清单里：用上面下拉框里的「当前会话项目（", lastSegment(String(snapshot.projectRoot)), "）」就能编辑它 —— 它一直照常参与运行时合并。") : null, scopeSentence === null ? null : /* @__PURE__ */ h(
	    "div",
	    {
	      className: scopeSentence.tone === "warn" ? "dsh-hooks__banner dsh-hooks__banner--warn" : "dsh-hooks__banner"
	    },
	    scopeSentence.text
	  ), snapshot.staleInUse ? /* @__PURE__ */ h("div", { className: "dsh-hooks__banner dsh-hooks__banner--warn" }, "磁盘上的配置当前读不出来，运行中的 hook 仍在沿用**上一份可用配置**。修好文件后会自动恢复。") : null, writable ? null : /* @__PURE__ */ h("div", { className: "dsh-hooks__banner" }, "本页当前是只读模式（宿主没有提供写入能力）。"), banner === null ? null : /* @__PURE__ */ h("div", { className: "dsh-hooks__banner dsh-hooks__banner--error" }, writeErrorSentence(banner.code), banner.detail === "" ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__muted" }, "（", banner.detail, "）")), /* @__PURE__ */ h("div", { className: "dsh-hooks__effective" }, /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__toolbtn",
	      title: "展开/收起所选作用域的生效视图",
	      onClick: () => {
	        setShowEffective(!showEffective);
	      }
	    },
	    sessionSentence(snapshot),
	    showEffective ? " ▾" : " ▸"
	  ), showEffective ? /* @__PURE__ */ h("div", { className: "dsh-hooks__effectivelist" }, /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, "下面是**所选作用域**（", scopeLabel(snapshot, scope), "）的生效视图：宿主给的合并顺序是用户级在前、项目级在后。"), snapshot.events.map((view) => /* @__PURE__ */ h("div", { className: "dsh-hooks__event", key: view.event }, /* @__PURE__ */ h("span", { className: "dsh-hooks__eventname" }, view.event), /* @__PURE__ */ h("span", { className: "dsh-hooks__count" }, String(view.hookCount), " 条（用户级 ", String(view.fromUser), " + 项目级 ", String(view.fromProject), "）")))) : null), newOpen ? /* @__PURE__ */ h(
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
	  ) : null, primary === void 0 ? /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, "宿主没有给出这个作用域的文件（不该发生，请刷新）。") : /* @__PURE__ */ h("div", { className: "dsh-hooks__card" }, /* @__PURE__ */ h("div", { className: "dsh-hooks__cardhead" }, /* @__PURE__ */ h("strong", null, primary.kind === "project" ? "项目级（选中的工作区）" : "用户级（全局）"), /* @__PURE__ */ h("span", { className: "dsh-hooks__path" }, primary.path), /* @__PURE__ */ h("span", { className: "dsh-hooks__count" }, String(primary.hookCount), " 条"), writable && primary.state === "absent" ? /* @__PURE__ */ h("span", { className: "dsh-hooks__actions" }, /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn",
	      title: "新建这个文件",
	      disabled: busy,
	      onClick: () => {
	        runWrite({ op: "createFile" });
	      }
	    },
	    "新建这个文件"
	  )) : null), /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, fileStateText(primary)), needle === "" ? null : /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, "筛选后 ", String(countShown(primary, matches)), " / 共 ", String(primary.hookCount)), primary.matcherErrors.length > 0 ? /* @__PURE__ */ h("div", { className: "dsh-hooks__banner dsh-hooks__banner--warn" }, primary.matcherErrors.length, " 处 matcher 非法（那些组不会运行）：", primary.matcherErrors.join("；")) : null, primary.skipped.length > 0 ? /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, "跳过 ", primary.skipped.length, ' 个非 command handler（本插件只运行 `type: "command"`）') : null, /* @__PURE__ */ h("div", { className: "dsh-hooks__events" }, primary.events.map((view) => renderEvent(view, primary)))), others.map((file) => /* @__PURE__ */ h("div", { className: "dsh-hooks__card", key: file.kind }, /* @__PURE__ */ h("div", { className: "dsh-hooks__cardhead" }, /* @__PURE__ */ h("strong", null, file.kind === "user" ? "用户级（全局）" : "项目级"), /* @__PURE__ */ h("span", { className: "dsh-hooks__path" }, file.path), /* @__PURE__ */ h("span", { className: "dsh-hooks__count" }, String(file.hookCount), " 条")), /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, fileStateText(file), " —— 这份配置同样会参与合并运行；要编辑它请把上面的作用域切到", file.kind === "user" ? "「用户（全局）」" : "对应的工作区", "。"))));
	}
	function sessionSentence(snapshot) {
	  const session = snapshot.session;
	  if (session === null) return "当前会话未知，无法判断实际会跑什么";
	  const counts = `${String(session.hookCount)} 条（用户级 ${String(session.fromUser)} + 项目级 ${String(
	    session.fromProject
	  )}）`;
	  return session.staleInUse ? `当前会话生效 ${counts}· 正在沿用上一份可用配置` : `当前会话生效 ${counts}`;
	}
	function primaryDisabled(file) {
	  let disabled = 0;
	  for (const view of file.events) disabled += view.disabledCount;
	  return disabled;
	}
	function countShown(file, matches) {
	  let shown = 0;
	  for (const view of file.events) {
	    for (const group of view.groups) {
	      for (const hook of group.hooks) {
	        if (matches(hook, group, view.event)) shown++;
	      }
	    }
	  }
	  return shown;
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

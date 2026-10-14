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
	`;

	// src/client/write.ts
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
	    case "no-project":
	      return "无法确定当前项目，所以不能写项目级配置。";
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
	function formatDryRun(run) {
	  const outcome = run.exitCode === null ? "启动失败（子进程没起来）" : run.decision === "deny" || run.decision === "block" ? `已阻断（exit ${String(run.exitCode)}）` : run.exitCode === 0 ? "通过（exit 0）" : `失败（exit ${String(run.exitCode)}）`;
	  const text = run.stderr.trim() === "" ? run.stdout.trim() : run.stderr.trim();
	  return `试运行：${outcome} · ${String(run.durationMs)}ms${text === "" ? "" : ` · ${text}`}`;
	}
	function rowKey(file, event, groupRawIndex, hookIndex) {
	  return `${file.kind}|${event}|${String(groupRawIndex)}|${String(hookIndex)}`;
	}
	function HookRow(props) {
	  const { hook, file, event, groupRawIndex, writable, busy, onToggle, editor } = props;
	  const key = rowKey(file, event, groupRawIndex, hook.rawIndex);
	  const editing = editor.key === key;
	  const confirming = editor.confirmKey === key;
	  const dryText = editor.dryKey === key ? editor.dryText : "";
	  const status = statusOf(hook);
	  const run = hook.lastRun;
	  const title = run === null ? status.label : `${status.label}
	${run.stderr || run.stdout || "(无输出)"}`;
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks__hook" }, /* @__PURE__ */ h("span", { className: status.className, title }), editing ? null : /* @__PURE__ */ h(Fragment2, null, /* @__PURE__ */ h("span", { className: "dsh-hooks__cmd", title: hook.command }, hook.command), hook.disabled ? /* @__PURE__ */ h("span", { className: "dsh-hooks__tag" }, "已停用") : null, /* @__PURE__ */ h("span", { className: "dsh-hooks__meta", title: "超时（未写则为默认值）" }, hook.timeoutSec === null ? `${String(hook.defaultTimeoutSec)}s 默认` : `${String(hook.timeoutSec)}s`)), writable && editing ? /* @__PURE__ */ h("span", { className: "dsh-hooks__actions" }, /* @__PURE__ */ h(
	    "textarea",
	    {
	      className: "dsh-hooks__editor",
	      value: editor.draft,
	      rows: 1,
	      onChange: (changeEvent) => {
	        editor.change(changeEvent.target.value);
	      }
	    }
	  ), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn",
	      title: "保存",
	      disabled: busy,
	      onClick: () => {
	        editor.save(file, event, groupRawIndex, hook);
	      }
	    },
	    "保存"
	  ), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn",
	      disabled: busy,
	      onClick: () => {
	        editor.cancel();
	      }
	    },
	    "取消"
	  )) : null, writable && !editing && !confirming ? /* @__PURE__ */ h("span", { className: "dsh-hooks__actions" }, /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn",
	      title: "试运行",
	      disabled: busy,
	      onClick: () => {
	        editor.run(file, event, groupRawIndex, hook);
	      }
	    },
	    "试运行"
	  ), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn",
	      title: "编辑",
	      disabled: busy,
	      onClick: () => {
	        editor.start(key, hook.command);
	      }
	    },
	    "编辑"
	  ), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn",
	      title: hook.disabled ? "启用" : "停用",
	      disabled: busy,
	      onClick: () => {
	        onToggle(file, event, groupRawIndex, hook);
	      }
	    },
	    hook.disabled ? "启用" : "停用"
	  ), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn",
	      title: "删除",
	      disabled: busy,
	      onClick: () => {
	        editor.askRemove(key);
	      }
	    },
	    "删除"
	  )) : null, writable && confirming && !editing ? /* @__PURE__ */ h("span", { className: "dsh-hooks__actions" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__meta" }, "删除这一条？"), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn",
	      title: "确认删除",
	      disabled: busy,
	      onClick: () => {
	        editor.remove(file, event, groupRawIndex, hook);
	      }
	    },
	    "确认删除"
	  ), /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn",
	      disabled: busy,
	      onClick: () => {
	        editor.cancelRemove();
	      }
	    },
	    "取消"
	  )) : null, dryText === "" ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__dry" }, dryText));
	}
	function GroupBlock(props) {
	  const { group, file, event, writable, busy, onToggle, editor } = props;
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks__groups" }, /* @__PURE__ */ h("div", { className: "dsh-hooks__matcher" }, group.matcher === null ? "匹配全部" : `matcher: ${group.matcher}`, group.matcherOk ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__tag" }, "matcher 非法，这一组不会运行")), group.hooks.map((hook) => /* @__PURE__ */ h(
	    HookRow,
	    {
	      key: `${String(group.rawIndex)}:${String(hook.rawIndex)}`,
	      hook,
	      file,
	      event,
	      groupRawIndex: group.rawIndex,
	      writable,
	      busy,
	      onToggle,
	      editor
	    }
	  )));
	}
	function EventRow({ view }) {
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks__event" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__eventname" }, view.event), view.groups.length === 0 ? /* @__PURE__ */ h("span", { className: "dsh-hooks__empty" }, "没有配置", view.runCount > 0 ? `（但历史上跑过 ${String(view.runCount)} 次）` : "") : /* @__PURE__ */ h("span", { className: "dsh-hooks__count" }, String(view.hookCount), " 条", view.disabledCount > 0 ? `（另有 ${String(view.disabledCount)} 条已停用）` : ""));
	}
	function SourceCard(props) {
	  const { file, writable, busy, onToggle, onCreate, editor } = props;
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks__card" }, /* @__PURE__ */ h("div", { className: "dsh-hooks__cardhead" }, /* @__PURE__ */ h("strong", null, file.kind === "project" ? "项目级" : "用户级"), /* @__PURE__ */ h("span", { className: "dsh-hooks__path" }, file.path), /* @__PURE__ */ h("span", { className: "dsh-hooks__count" }, String(file.hookCount), " 条"), writable && file.state === "absent" ? /* @__PURE__ */ h("span", { className: "dsh-hooks__actions" }, /* @__PURE__ */ h(
	    "button",
	    {
	      type: "button",
	      className: "dsh-hooks__btn",
	      title: "新建这个文件",
	      disabled: busy,
	      onClick: () => {
	        onCreate(file);
	      }
	    },
	    "新建这个文件"
	  )) : null), /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, fileStateText(file)), file.matcherErrors.length > 0 ? /* @__PURE__ */ h("div", { className: "dsh-hooks__banner dsh-hooks__banner--warn" }, file.matcherErrors.length, " 处 matcher 非法（那些组不会运行）：", file.matcherErrors.join("；")) : null, file.skipped.length > 0 ? /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, "跳过 ", file.skipped.length, ' 个非 command handler（本插件只运行 `type: "command"`）') : null, /* @__PURE__ */ h("div", { className: "dsh-hooks__events" }, file.events.map((view) => /* @__PURE__ */ h(Fragment2, { key: view.event }, /* @__PURE__ */ h(EventRow, { view }), view.groups.map((group) => /* @__PURE__ */ h(
	    GroupBlock,
	    {
	      key: String(group.rawIndex),
	      group,
	      file,
	      event: view.event,
	      writable,
	      busy,
	      onToggle,
	      editor
	    }
	  ))))));
	}
	function HooksSection() {
	  const [phase, setPhase] = useState2({ kind: "loading" });
	  const [banner, setBanner] = useState2(null);
	  const [busy, setBusy] = useState2(false);
	  const [nonce, setNonce] = useState2(0);
	  const [editingKey, setEditingKey] = useState2("");
	  const [draft, setDraft] = useState2("");
	  const [confirmKey, setConfirmKey] = useState2("");
	  const [dryKey, setDryKey] = useState2("");
	  const [dryText, setDryText] = useState2("");
	  useEffect2(() => {
	    const controller = new AbortController();
	    const timer = setTimeout(() => {
	      controller.abort();
	    }, REQUEST_TIMEOUT_MS);
	    void (async () => {
	      try {
	        const response = await fetch(HOOKS_ROUTE, {
	          method: "GET",
	          signal: controller.signal,
	          // 鉴权是 host-only 的同源 cookie（官方 connection 层管），这里只需带上同源凭据。
	          credentials: "same-origin"
	        });
	        const body = await response.json();
	        if (body.ok) setPhase({ kind: "ready", snapshot: body.data });
	        else setPhase({ kind: "failed", code: body.error, detail: body.detail ?? "" });
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
	  }, [nonce]);
	  const runWrite = (intent) => {
	    if (busy) return;
	    setBusy(true);
	    setBanner(null);
	    void (async () => {
	      const outcome = await requestWrite(intent);
	      if (outcome.ok) {
	        setNonce((value) => value + 1);
	        setEditingKey("");
	        setConfirmKey("");
	      } else {
	        setBanner({ code: outcome.error ?? "internal", detail: outcome.detail ?? "" });
	      }
	      setBusy(false);
	    })();
	  };
	  const onToggle = (file, event, groupRawIndex, hook) => {
	    runWrite({
	      file: file.kind,
	      op: "setHookDisabled",
	      event,
	      groupIndex: groupRawIndex,
	      hookIndex: hook.rawIndex,
	      disabled: !hook.disabled
	    });
	  };
	  const onCreate = (file) => {
	    runWrite({ file: file.kind, op: "createFile" });
	  };
	  const editor = {
	    key: editingKey,
	    draft,
	    confirmKey,
	    start: (key, command) => {
	      setEditingKey(key);
	      setDraft(command);
	    },
	    change: (value) => {
	      setDraft(value);
	    },
	    cancel: () => {
	      setEditingKey("");
	      setDraft("");
	    },
	    save: (file, event, groupRawIndex, hook) => {
	      runWrite({
	        file: file.kind,
	        op: "setHookCommand",
	        event,
	        groupIndex: groupRawIndex,
	        hookIndex: hook.rawIndex,
	        command: draft
	      });
	    },
	    askRemove: (key) => {
	      setConfirmKey(key);
	      setEditingKey("");
	    },
	    cancelRemove: () => {
	      setConfirmKey("");
	    },
	    remove: (file, event, groupRawIndex, hook) => {
	      runWrite({
	        file: file.kind,
	        op: "removeHook",
	        event,
	        groupIndex: groupRawIndex,
	        hookIndex: hook.rawIndex
	      });
	    },
	    dryKey,
	    dryText,
	    run: (file, event, groupRawIndex, hook) => {
	      if (busy) return;
	      setBusy(true);
	      setBanner(null);
	      void (async () => {
	        const outcome = await requestDryRun({
	          file: file.kind,
	          event,
	          groupIndex: groupRawIndex,
	          hookIndex: hook.rawIndex
	        });
	        if (outcome.ok && outcome.run !== void 0) {
	          setDryKey(rowKey(file, event, groupRawIndex, hook.rawIndex));
	          setDryText(formatDryRun(outcome.run));
	        } else {
	          setBanner({ code: outcome.error ?? "internal", detail: outcome.detail ?? "" });
	        }
	        setBusy(false);
	      })();
	    }
	  };
	  if (phase.kind === "loading") {
	    return /* @__PURE__ */ h("div", { className: "dsh-hooks" }, /* @__PURE__ */ h("style", null, styles), /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, "读取中…"));
	  }
	  if (phase.kind === "failed") {
	    return /* @__PURE__ */ h("div", { className: "dsh-hooks" }, /* @__PURE__ */ h("style", null, styles), /* @__PURE__ */ h("div", { className: "dsh-hooks__banner dsh-hooks__banner--error" }, sentenceFor(phase.code)), phase.detail === "" ? null : /* @__PURE__ */ h("div", { className: "dsh-hooks__muted" }, phase.detail));
	  }
	  const { snapshot } = phase;
	  return /* @__PURE__ */ h("div", { className: "dsh-hooks" }, /* @__PURE__ */ h("style", null, styles), /* @__PURE__ */ h("div", { className: "dsh-hooks__head" }, /* @__PURE__ */ h("div", { className: "dsh-hooks__row" }, /* @__PURE__ */ h("span", { className: "dsh-hooks__count" }, "生效 ", String(snapshot.total.hookCount), " 条 · 分组 ", String(snapshot.total.groupCount), " 个", snapshot.total.disabledCount > 0 ? ` · 已停用 ${String(snapshot.total.disabledCount)} 条` : "")), snapshot.projectRoot === null ? /* @__PURE__ */ h("div", { className: "dsh-hooks__banner" }, "无法确定当前项目（没有会话上下文）—— 只显示用户级配置。请从某个项目的会话里打开设置。") : /* @__PURE__ */ h("div", { className: "dsh-hooks__root" }, "项目根：", snapshot.projectRoot), snapshot.staleInUse ? /* @__PURE__ */ h("div", { className: "dsh-hooks__banner dsh-hooks__banner--warn" }, "磁盘上的配置当前读不出来，运行中的 hook 仍在沿用**上一份可用配置**。修好文件后会自动恢复。") : null, snapshot.capabilities.writable ? null : /* @__PURE__ */ h("div", { className: "dsh-hooks__banner" }, "本页当前是只读模式（宿主没有提供写入能力）。"), banner === null ? null : /* @__PURE__ */ h("div", { className: "dsh-hooks__banner dsh-hooks__banner--error" }, writeErrorSentence(banner.code), banner.detail === "" ? null : /* @__PURE__ */ h("span", { className: "dsh-hooks__muted" }, "（", banner.detail, "）"))), snapshot.files.map((file) => /* @__PURE__ */ h(
	    SourceCard,
	    {
	      key: file.kind,
	      file,
	      writable: snapshot.capabilities.writable,
	      busy,
	      onToggle,
	      onCreate,
	      editor
	    }
	  )));
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

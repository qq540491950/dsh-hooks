/**
 * ⚠️ 本文件由 tools/build.ts 从 src/** 生成 —— **不要直接编辑**。
 * 手工改动会在下一次 `pnpm build` 时被静默覆盖（AGENTS §0）。
 */

// src/shared/constants.ts
var PROJECT_DIR = ".dsh";
var HOOKS_FILE = "hooks.json";
var DEFAULT_TIMEOUT_MS = 6e5;
var MAX_PROJECT_DEPTH = 64;
var STOP_FORCE_LIMIT = 3;
var NEGATIVE_TTL_MS = 2e3;
var POSITIVE_TTL_MS = 4e3;
var INVALIDATE_LOG_INTERVAL_MS = 1e3;
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
var MATCHERLESS_EVENTS = ["UserPromptSubmit", "Stop"];
function eventHasMatcher(event) {
  return !MATCHERLESS_EVENTS.includes(event);
}
var CONTEXT_SOURCE = { kind: "dsh-hooks" };
var LITERAL_ALTERNATIVES = /^[A-Za-z0-9_|]+$/;
var SUBAGENT_TYPE = "general-purpose";

// src/shared/guards.ts
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isUnknownArray(value) {
  return Array.isArray(value);
}
function strField(obj, key) {
  const value = obj[key];
  return typeof value === "string" ? value : void 0;
}
function boolField(obj, key) {
  const value = obj[key];
  return typeof value === "boolean" ? value : void 0;
}
function messageOf(error) {
  if (error instanceof Error && typeof error.message === "string") return error.message;
  return String(error);
}

// src/shared/protocol.ts
function newMessageId() {
  const g = globalThis;
  if (g.crypto !== void 0 && typeof g.crypto.randomUUID === "function") return g.crypto.randomUUID();
  return `dsh-hooks-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function joinPath(base, ...parts) {
  const text = base;
  const sep = text.includes("\\") || /^[A-Za-z]:/.test(text) ? "\\" : "/";
  let out = text.replace(/[\\/]+$/, "");
  for (const part of parts) out += sep + String(part).replace(/^[\\/]+|[\\/]+$/g, "");
  return out;
}
function parentOf(p) {
  const s = p.replace(/[\\/]+$/, "");
  const idx = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  if (idx < 0) return void 0;
  let parent = s.slice(0, idx);
  if (parent === "") return void 0;
  if (/^[A-Za-z]:$/.test(parent)) parent += "\\";
  return parent;
}
function rawText(value) {
  if (value === void 0 || value === null) return "";
  if (typeof value === "string") return value;
  return String(value);
}
function substituteCommand(command, vars) {
  let out = command;
  if (vars.projectDir !== void 0) out = out.split("${DSH_PROJECT_DIR}").join(vars.projectDir);
  if (vars.pluginRoot !== void 0) out = out.split("${DSH_PLUGIN_ROOT}").join(vars.pluginRoot);
  return out;
}
function matcherDiagnostic(matcher) {
  if (matcher === void 0 || matcher === "" || matcher === "*") return void 0;
  if (LITERAL_ALTERNATIVES.test(matcher)) return void 0;
  try {
    new RegExp(matcher);
    return void 0;
  } catch {
    return `invalid regex matcher ${JSON.stringify(matcher)}`;
  }
}
function matchesMatcher(matcher, query) {
  if (matcher === void 0 || matcher === "" || matcher === "*") return true;
  if (LITERAL_ALTERNATIVES.test(matcher)) return matcher.split("|").includes(query);
  try {
    return new RegExp(matcher).test(query);
  } catch {
    return false;
  }
}
function parseHookConfig(raw, vars = {}) {
  const groups = {};
  const skipped = [];
  const rejected = [];
  const errors = [];
  if (!isObject(raw)) return { groups, skipped, rejected, errors };
  const hooksMap = hooksMapOf(raw);
  for (const event of HOOK_EVENTS) {
    const rawGroups = hooksMap[event];
    if (!Array.isArray(rawGroups)) continue;
    const parsedGroups = [];
    for (let groupIndex = 0; groupIndex < rawGroups.length; groupIndex++) {
      const rawGroup = rawGroups[groupIndex];
      if (!isObject(rawGroup) || !Array.isArray(rawGroup.hooks)) {
        rejected.push({ event, groupIndex, reason: "malformed-group", hookCount: 0 });
        continue;
      }
      const skippedBefore = skipped.length;
      const commands = [];
      for (let hookIndex = 0; hookIndex < rawGroup.hooks.length; hookIndex++) {
        const rawHook = rawGroup.hooks[hookIndex];
        if (!isObject(rawHook)) continue;
        const type = typeof rawHook.type === "string" ? rawHook.type : "command";
        if (type !== "command") {
          skipped.push({ event, type, groupIndex, hookIndex, reason: "unsupported-type" });
          continue;
        }
        const command = rawHook.command;
        if (typeof command !== "string" || command.length === 0) {
          skipped.push({ event, type, groupIndex, hookIndex, reason: "empty-command" });
          continue;
        }
        const timeoutSec = typeof rawHook.timeout === "number" && rawHook.timeout > 0 ? rawHook.timeout : void 0;
        const disabled = rawHook.disabled === true;
        commands.push({
          command: substituteCommand(command, vars),
          ...timeoutSec !== void 0 ? { timeoutSec } : {},
          ...disabled ? { disabled: true } : {},
          rawIndex: hookIndex
        });
      }
      if (commands.length === 0) {
        rejected.push(
          skipped.length > skippedBefore ? {
            event,
            groupIndex,
            reason: "unsupported-type",
            hookCount: 0,
            ...typeof rawGroup.matcher === "string" ? { matcher: rawGroup.matcher } : {}
          } : {
            event,
            groupIndex,
            reason: "no-command",
            hookCount: rawGroup.hooks.length,
            ...typeof rawGroup.matcher === "string" ? { matcher: rawGroup.matcher } : {}
          }
        );
        continue;
      }
      const matcher = eventHasMatcher(event) ? typeof rawGroup.matcher === "string" ? rawGroup.matcher : void 0 : void 0;
      const diagnostic = matcherDiagnostic(matcher);
      if (diagnostic !== void 0) {
        errors.push(`${diagnostic} on event ${JSON.stringify(event)}`);
        rejected.push({
          event,
          groupIndex,
          reason: "invalid-matcher",
          hookCount: commands.length,
          ...matcher !== void 0 ? { matcher } : {}
        });
        continue;
      }
      parsedGroups.push({ ...matcher !== void 0 ? { matcher } : {}, hooks: commands, rawIndex: groupIndex });
    }
    if (parsedGroups.length > 0) groups[event] = parsedGroups;
  }
  return { groups, skipped, rejected, errors };
}
function hooksMapOf(raw) {
  return isObject(raw.hooks) ? raw.hooks : raw;
}
function mergeHookGroups(userGroups, projectGroups) {
  const out = {};
  for (const event of HOOK_EVENTS) {
    const list = [...userGroups[event] ?? [], ...projectGroups[event] ?? []];
    if (list.length > 0) out[event] = list;
  }
  return out;
}
function topLevelDecisionOf(value) {
  return value === "approve" || value === "block" ? value : void 0;
}
function permissionDecisionOf(value) {
  return value === "allow" || value === "deny" || value === "ask" ? value : void 0;
}
function applyStructured(output, parsed, expectedEventName) {
  const cont = boolField(parsed, "continue");
  if (cont !== void 0) output.continue = cont;
  const stopReason = strField(parsed, "stopReason");
  if (stopReason !== void 0) output.stopReason = stopReason;
  const sysMsg = strField(parsed, "systemMessage");
  if (sysMsg !== void 0) output.systemMessage = sysMsg;
  const topDecision = topLevelDecisionOf(strField(parsed, "decision"));
  if (topDecision !== void 0) output.decision = topDecision;
  const topReason = strField(parsed, "reason");
  if (topReason !== void 0) output.reason = topReason;
  if (!isObject(parsed.hookSpecificOutput)) return;
  const hso = parsed.hookSpecificOutput;
  const eventName = strField(hso, "hookEventName");
  if (eventName !== void 0) output.hookEventName = eventName;
  if (expectedEventName !== void 0 && eventName !== expectedEventName) return;
  const permission = permissionDecisionOf(strField(hso, "permissionDecision"));
  if (permission !== void 0) output.decision = permission;
  const permissionReason = strField(hso, "permissionDecisionReason");
  if (permissionReason !== void 0) output.reason = permissionReason;
  const addCtx = strField(hso, "additionalContext");
  if (addCtx !== void 0) output.additionalContext = addCtx;
  if (isObject(hso.updatedInput)) output.updatedInput = hso.updatedInput;
}
function parseHookOutput(exitCode, stdout, stderr, expectedEventName) {
  const trimmedErr = rawText(stderr).trim();
  const trimmedOut = rawText(stdout).trim();
  const output = { exitCode, stderr: trimmedErr, stdout: trimmedOut };
  if (exitCode === 2) {
    output.decision = "block";
    if (trimmedErr.length > 0) output.reason = trimmedErr;
  }
  if (exitCode === 0 && trimmedOut.startsWith("{")) {
    let parsed;
    try {
      const candidate = JSON.parse(trimmedOut);
      parsed = isObject(candidate) ? candidate : void 0;
    } catch {
      parsed = void 0;
    }
    if (parsed !== void 0) applyStructured(output, parsed, expectedEventName);
  }
  return output;
}
function rank(decision) {
  switch (decision) {
    case "deny":
    case "block":
      return 3;
    case "ask":
      return 2;
    case "approve":
    case "allow":
      return 1;
    default:
      return 0;
  }
}
function decisionForRank(maxRank) {
  switch (maxRank) {
    case 3:
      return "deny";
    case 2:
      return "ask";
    case 1:
      return "allow";
    default:
      return "none";
  }
}
function mergeHookOutputs(outputs) {
  let maxRank = 0;
  const reasonsByRank = /* @__PURE__ */ new Map();
  let stop = false;
  let stopReason;
  const additionalContext = [];
  const systemMessages = [];
  for (const out of outputs) {
    const r = rank(out.decision);
    if (r > maxRank) maxRank = r;
    if ((r === 3 || r === 2) && out.reason !== void 0 && out.reason.length > 0) {
      const list = reasonsByRank.get(r) ?? [];
      list.push(out.reason);
      reasonsByRank.set(r, list);
    }
    if (out.continue === false && !stop) {
      stop = true;
      if (out.stopReason !== void 0) stopReason = out.stopReason;
    }
    if (out.additionalContext !== void 0 && out.additionalContext.length > 0) {
      additionalContext.push(out.additionalContext);
    }
    if (out.systemMessage !== void 0 && out.systemMessage.length > 0) systemMessages.push(out.systemMessage);
  }
  const reasons = reasonsByRank.get(maxRank) ?? [];
  return {
    decision: decisionForRank(maxRank),
    ...reasons.length > 0 ? { reason: reasons.join("\n\n") } : {},
    stop,
    ...stopReason !== void 0 ? { stopReason } : {},
    additionalContext,
    systemMessages
  };
}
function blocksToText(content) {
  if (!Array.isArray(content)) return "";
  return content.filter(
    (block) => isObject(block) && block.type === "text" && typeof block.text === "string"
  ).map((block) => block.text).join("");
}
function contextMessage(merged) {
  if (merged.additionalContext.length === 0) return void 0;
  return {
    id: newMessageId(),
    role: "user",
    content: merged.additionalContext.map((text) => ({ type: "text", text })),
    source: { kind: "dsh-hooks" }
  };
}

// src/shared/errors.ts
var HOST_ERROR_CODES = [
  /** 请求体不是合法 JSON。 */
  "bad-json",
  /** 请求体的形状/取值不合法（含 `expectedVersion` 类型错）。 */
  "bad-op",
  /** 目标文件不存在，而这个操作必须作用在已有文件上。 */
  "absent",
  /** "新建"撞上"已经存在"。 */
  "exists",
  /** 文件存在但读不懂（JSON 非法 / 顶层不是对象）。**绝不在这种文件上落笔**。 */
  "invalid-json",
  /** 事件键存在但不是数组（文件结构坏了）。 */
  "malformed-event",
  /** 项目根解析不出来。 */
  "no-project",
  /** fs provider 不返回版本号 ⇒ 不做无守卫写入。 */
  "no-version",
  /** 宿主没有工作区清单（≠ 没有工作区）。 */
  "no-workspace-registry",
  /** 要改的那一条/那一组不在文件里（含下标越界）。 */
  "not-found",
  /** 改写会动到目标之外的字段 ⇒ 拒写。 */
  "not-preservable",
  /** 移动已经到头了。 */
  "out-of-range",
  /** 目标组存在，但它的 matcher 非法，所以这一条跑不了（试运行专用）。 */
  "rejected",
  /** 目标路径解析失败。 */
  "resolve-failed",
  /** 调用会话的沙箱策略不允许写这个路径。 */
  "sandbox",
  /** 版本冲突：页面看到的版本已经不是磁盘上的版本。 */
  "stale",
  /** 工作区 id 不在宿主的清单里。 */
  "unknown-workspace",
  /** 写盘本身失败（IO / provider 抛错），且不属于上面任何一类。 */
  "write-failed",
  /** 插件内部错误（真正的 bug）。 */
  "internal"
];
var CLIENT_ERROR_CODES = [
  /** 纯前端校验：超时字段不是正数。 */
  "bad-timeout",
  /** fetch 抛了 / 断网。 */
  "network",
  /** 等太久自己放弃（写请求与试运行都有时间预算 —— 否则"忙"会让整页永久不可操作）。 */
  "timeout"
];
var SENTENCE_ERROR_CODES = [...HOST_ERROR_CODES, ...CLIENT_ERROR_CODES];
function hostErrorCodeOf(value) {
  const known = HOST_ERROR_CODES.includes(value ?? "");
  return known ? value : "internal";
}

// src/host/ledger.ts
var MAX_GLOBAL = 500;
var MAX_PER_SESSION = 200;
var MAX_TEXT_CHARS = 2e3;
function truncateText(text, max = MAX_TEXT_CHARS) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…（已截断 ${text.length - max} 字符）`;
}
var ExecutionLedger = class {
  items = [];
  /** 记一次执行（stdout/stderr 在这里就截断，快照里天然不会超限）。 */
  push(entry) {
    this.items.push({ ...entry, stdout: truncateText(entry.stdout), stderr: truncateText(entry.stderr) });
    this.enforceSessionCap(entry.sessionId);
    while (this.items.length > MAX_GLOBAL) this.items.shift();
  }
  /** 当前所有记录（从旧到新）。 */
  entries() {
    return [...this.items];
  }
  get size() {
    return this.items.length;
  }
  /** 清空（fiber 释放时用）。 */
  clear() {
    this.items.length = 0;
  }
  /** 单会话超限时丢该会话最旧的一条。 */
  enforceSessionCap(sessionId) {
    let count = 0;
    for (const item of this.items) if (item.sessionId === sessionId) count++;
    while (count > MAX_PER_SESSION) {
      const index = this.items.findIndex((item) => item.sessionId === sessionId);
      if (index < 0) return;
      this.items.splice(index, 1);
      count--;
    }
  }
};
function latestRunFor(entries, query) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry !== void 0 && entry.event === query.event && entry.command === query.command && entry.projectRoot === query.projectRoot) {
      return entry;
    }
  }
  return void 0;
}

// src/host/write.ts
function detectStyle(text) {
  const indentMatch = text.match(/^([ \t]+)"/m);
  const captured = indentMatch === null ? void 0 : indentMatch[1];
  return {
    indent: captured !== void 0 && captured.length > 0 ? captured : "  ",
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    finalNewline: text.endsWith("\n"),
    compact: text.length > 0 && !text.includes("\n")
  };
}
function reindent(text, indent) {
  return text.replace(/^( +)/gm, (spaces) => indent.repeat(Math.floor(spaces.length / 2)));
}
function serialize(doc, style) {
  if (style.compact) return JSON.stringify(doc);
  const pretty = JSON.stringify(doc, null, 2);
  const body = style.indent === "  " ? pretty : reindent(pretty, style.indent);
  const withEol = style.eol === "\n" ? body : body.split("\n").join(style.eol);
  return style.finalNewline ? withEol + style.eol : withEol;
}
var DEFAULT_STYLE = { indent: "  ", eol: "\n", finalNewline: true, compact: false };
function starterText(style) {
  return serialize({ hooks: {} }, style);
}
function cloneJson(value) {
  const cloned = JSON.parse(JSON.stringify(value));
  return cloned;
}
function canonical(value) {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(value) {
  if (isUnknownArray(value)) return value.map(sortKeys);
  if (isObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}
function parentAt(root, path) {
  let node = root;
  for (const key of path.slice(0, -1)) {
    if (isUnknownArray(node)) {
      const index = typeof key === "number" ? key : Number(key);
      node = node[index];
    } else if (isObject(node)) {
      node = node[String(key)];
    } else {
      return void 0;
    }
  }
  return node;
}
function strip(value, changes, side) {
  const clone = cloneJson(value);
  const active = changes.filter((change) => (change.area ?? "both") === "both" || change.area === side);
  const indexes = active.filter((change) => change.mode === "index").slice().sort((left, right) => Number(right.path[right.path.length - 1]) - Number(left.path[left.path.length - 1]));
  for (const change of indexes) {
    const parent = parentAt(clone, change.path);
    const last = change.path[change.path.length - 1];
    if (isUnknownArray(parent) && typeof last === "number" && last >= 0 && last < parent.length) parent.splice(last, 1);
  }
  for (const change of active.filter((one) => one.mode === "key")) {
    const parent = parentAt(clone, change.path);
    const last = change.path[change.path.length - 1];
    if (isObject(parent) && typeof last === "string") Reflect.deleteProperty(parent, last);
  }
  return clone;
}
function preservationProblem(original, updated, changes) {
  const before = canonical(strip(original, changes, "original"));
  const after = canonical(strip(updated, changes, "updated"));
  if (before === after) return void 0;
  const length = Math.min(before.length, after.length);
  let at = 0;
  while (at < length && before[at] === after[at]) at++;
  return `改写会动到目标之外的字段（第 ${at} 字节起：…${before.slice(Math.max(0, at - 40), at + 40)} ≠ …${after.slice(
    Math.max(0, at - 40),
    at + 40
  )}）`;
}
function eventListOf(doc, event) {
  const list = hooksMapOf(doc)[event];
  return isUnknownArray(list) ? list : void 0;
}
function hasMalformedEvent(doc, event) {
  const value = hooksMapOf(doc)[event];
  return value !== void 0 && !isUnknownArray(value);
}
function groupAt(doc, event, groupIndex) {
  const list = eventListOf(doc, event);
  if (list === void 0 || groupIndex < 0 || groupIndex >= list.length) return void 0;
  const group = list[groupIndex];
  return isObject(group) ? group : void 0;
}
function hookAt(doc, event, groupIndex, hookIndex) {
  const group = groupAt(doc, event, groupIndex);
  if (group === void 0 || !isUnknownArray(group.hooks)) return void 0;
  if (hookIndex < 0 || hookIndex >= group.hooks.length) return void 0;
  const hook = group.hooks[hookIndex];
  return isObject(hook) ? hook : void 0;
}
function mapPath(doc) {
  return hooksMapOf(doc) === doc ? [] : ["hooks"];
}
function hookPath(doc, op) {
  return [...mapPath(doc), op.event, op.groupIndex, "hooks", op.hookIndex];
}
function groupPath(doc, op) {
  return [...mapPath(doc), op.event, op.groupIndex];
}
function applyOp(doc, op) {
  const next = cloneJson(doc);
  if (!isObject(next)) return { ok: false, reason: "bad-op" };
  switch (op.op) {
    case "setHookCommand": {
      if (op.command.length === 0) return { ok: false, reason: "bad-op" };
      const hook = hookAt(next, op.event, op.groupIndex, op.hookIndex);
      if (hook === void 0) return { ok: false, reason: "not-found" };
      hook.command = op.command;
      return { ok: true, applied: { doc: next, changes: [{ path: [...hookPath(next, op), "command"], mode: "key" }] } };
    }
    case "setHookTimeout": {
      const hook = hookAt(next, op.event, op.groupIndex, op.hookIndex);
      if (hook === void 0) return { ok: false, reason: "not-found" };
      if (op.timeoutSec === null) delete hook.timeout;
      else if (op.timeoutSec > 0) hook.timeout = op.timeoutSec;
      else return { ok: false, reason: "bad-op" };
      return { ok: true, applied: { doc: next, changes: [{ path: [...hookPath(next, op), "timeout"], mode: "key" }] } };
    }
    case "setHookDisabled": {
      const hook = hookAt(next, op.event, op.groupIndex, op.hookIndex);
      if (hook === void 0) return { ok: false, reason: "not-found" };
      if (op.disabled) hook.disabled = true;
      else delete hook.disabled;
      return { ok: true, applied: { doc: next, changes: [{ path: [...hookPath(next, op), "disabled"], mode: "key" }] } };
    }
    case "setGroupMatcher": {
      const group = groupAt(next, op.event, op.groupIndex);
      if (group === void 0) return { ok: false, reason: "not-found" };
      if (op.matcher === null) delete group.matcher;
      else group.matcher = op.matcher;
      return { ok: true, applied: { doc: next, changes: [{ path: [...groupPath(next, op), "matcher"], mode: "key" }] } };
    }
    case "addHook": {
      if (op.command.length === 0) return { ok: false, reason: "bad-op" };
      if (hasMalformedEvent(next, op.event)) return { ok: false, reason: "malformed-event" };
      const group = groupAt(next, op.event, op.groupIndex);
      if (group === void 0 || !isUnknownArray(group.hooks)) return { ok: false, reason: "not-found" };
      const added = { type: "command", command: op.command };
      if (op.timeoutSec !== null && op.timeoutSec > 0) added.timeout = op.timeoutSec;
      const index = group.hooks.length;
      group.hooks.push(added);
      return {
        ok: true,
        applied: { doc: next, changes: [{ path: [...groupPath(next, op), "hooks", index], mode: "index" }] }
      };
    }
    case "removeHook": {
      const list = eventListOf(next, op.event);
      const group = groupAt(next, op.event, op.groupIndex);
      if (list === void 0 || group === void 0 || !isUnknownArray(group.hooks)) {
        return { ok: false, reason: "not-found" };
      }
      if (op.hookIndex < 0 || op.hookIndex >= group.hooks.length) return { ok: false, reason: "not-found" };
      group.hooks.splice(op.hookIndex, 1);
      const changes = [
        // `original`：那一项**只有原文**有（新文档里已经删掉了），抹两侧会对不上。
        { path: [...groupPath(next, op), "hooks", op.hookIndex], mode: "index", area: "original" }
      ];
      if (group.hooks.length === 0) {
        list.splice(op.groupIndex, 1);
        changes.push({ path: [...mapPath(next), op.event, op.groupIndex], mode: "index", area: "original" });
      }
      return { ok: true, applied: { doc: next, changes } };
    }
    case "moveHook": {
      const group = groupAt(next, op.event, op.groupIndex);
      if (group === void 0 || !isUnknownArray(group.hooks)) return { ok: false, reason: "not-found" };
      const from = op.hookIndex;
      const to = op.toIndex === void 0 ? from + op.direction : op.toIndex;
      if (from < 0 || from >= group.hooks.length || to < 0 || to >= group.hooks.length) {
        return { ok: false, reason: "out-of-range" };
      }
      if (from === to) return { ok: false, reason: "out-of-range" };
      const moved = group.hooks[from];
      group.hooks[from] = group.hooks[to];
      group.hooks[to] = moved;
      return {
        ok: true,
        applied: {
          doc: next,
          changes: [
            { path: [...groupPath(next, op), "hooks", from], mode: "index" },
            { path: [...groupPath(next, op), "hooks", to], mode: "index" }
          ]
        }
      };
    }
    case "addGroup": {
      if (op.command.length === 0) return { ok: false, reason: "bad-op" };
      if (hasMalformedEvent(next, op.event)) return { ok: false, reason: "malformed-event" };
      const map = hooksMapOf(next);
      const existing = map[op.event];
      const created = !isUnknownArray(existing);
      let list;
      if (created) {
        list = [];
        map[op.event] = list;
      } else {
        list = existing;
      }
      const group = {};
      if (op.matcher !== null && op.matcher.length > 0) group.matcher = op.matcher;
      const hook = { type: "command", command: op.command };
      if (op.timeoutSec !== null && op.timeoutSec > 0) hook.timeout = op.timeoutSec;
      group.hooks = [hook];
      list.push(group);
      const index = list.length - 1;
      const changes = created ? [{ path: [...mapPath(next), op.event], mode: "key" }] : [{ path: [...mapPath(next), op.event, index], mode: "index" }];
      return { ok: true, applied: { doc: next, changes } };
    }
    case "removeGroup": {
      const list = eventListOf(next, op.event);
      if (list === void 0 || op.groupIndex < 0 || op.groupIndex >= list.length)
        return { ok: false, reason: "not-found" };
      list.splice(op.groupIndex, 1);
      return {
        ok: true,
        applied: {
          doc: next,
          changes: [{ path: [...mapPath(next), op.event, op.groupIndex], mode: "index", area: "original" }]
        }
      };
    }
    default:
      return { ok: false, reason: "bad-op" };
  }
}
function isHookEvent(value) {
  return typeof value === "string" && HOOK_EVENTS.includes(value);
}
function fileOf(value) {
  return value === "project" || value === "user" ? value : void 0;
}
function indexOf(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : void 0;
}
function positiveOf(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}
function parseHooksRequest(body) {
  if (!isObject(body)) return { ok: false, reason: "body 必须是 JSON 对象" };
  const file = fileOf(body.file);
  if (file === void 0) return { ok: false, reason: "file 必须是 project 或 user" };
  if (typeof body.op !== "string") return { ok: false, reason: "op 必须是字符串" };
  const op = body.op;
  const rawWorkspaceId = body.workspaceId;
  if (rawWorkspaceId !== void 0) {
    if (typeof rawWorkspaceId !== "string" || rawWorkspaceId.length === 0) {
      return { ok: false, reason: "workspaceId 必须是非空字符串" };
    }
    if (file === "user") {
      return { ok: false, reason: "file 为 user 时不许带 workspaceId（用户级配置不属于任何工作区）" };
    }
  }
  const envelope = rawWorkspaceId === void 0 ? {} : { workspaceId: rawWorkspaceId };
  const rawVersion = body.expectedVersion;
  if (rawVersion !== void 0 && rawVersion !== null && typeof rawVersion !== "string") {
    return { ok: false, reason: "expectedVersion 必须是字符串、null 或缺省" };
  }
  if (rawVersion !== void 0) envelope.expectedVersion = rawVersion;
  const ok = (request) => ({
    ok: true,
    request: { ...request, ...envelope }
  });
  const eventOnly = () => {
    if (!isHookEvent(body.event)) return "event 不是受支持的事件";
    return { event: body.event };
  };
  const head = () => {
    if (!isHookEvent(body.event)) return "event 不是受支持的事件";
    const groupIndex = indexOf(body.groupIndex);
    if (groupIndex === void 0) return "groupIndex 必须是非负整数";
    return { event: body.event, groupIndex };
  };
  const withHook = () => {
    const base = head();
    if (typeof base === "string") return base;
    const hookIndex = indexOf(body.hookIndex);
    if (hookIndex === void 0) return "hookIndex 必须是非负整数";
    return { ...base, hookIndex };
  };
  switch (op) {
    case "createFile":
      return ok({ op: "createFile", file });
    case "setHookCommand": {
      const where = withHook();
      if (typeof where === "string") return { ok: false, reason: where };
      if (typeof body.command !== "string" || body.command.length === 0) {
        return { ok: false, reason: "command 必须是非空字符串" };
      }
      return ok({ op, file, ...where, command: body.command });
    }
    case "setHookTimeout": {
      const where = withHook();
      if (typeof where === "string") return { ok: false, reason: where };
      if (body.timeoutSec !== null) {
        const timeoutSec = positiveOf(body.timeoutSec);
        if (timeoutSec === void 0) return { ok: false, reason: "timeoutSec 必须是 null 或正数" };
        return ok({ op, file, ...where, timeoutSec });
      }
      return ok({ op, file, ...where, timeoutSec: null });
    }
    case "setHookDisabled": {
      const where = withHook();
      if (typeof where === "string") return { ok: false, reason: where };
      if (typeof body.disabled !== "boolean") return { ok: false, reason: "disabled 必须是布尔值" };
      return ok({ op, file, ...where, disabled: body.disabled });
    }
    case "setGroupMatcher": {
      const base = head();
      if (typeof base === "string") return { ok: false, reason: base };
      if (body.matcher === null) return ok({ op, file, ...base, matcher: null });
      if (typeof body.matcher !== "string") return { ok: false, reason: "matcher 必须是字符串或 null" };
      return ok({ op, file, ...base, matcher: body.matcher });
    }
    case "addHook": {
      const base = head();
      if (typeof base === "string") return { ok: false, reason: base };
      if (typeof body.command !== "string" || body.command.length === 0) {
        return { ok: false, reason: "command 必须是非空字符串" };
      }
      if (body.timeoutSec === null || body.timeoutSec === void 0) {
        return ok({ op, file, ...base, command: body.command, timeoutSec: null });
      }
      const timeoutSec = positiveOf(body.timeoutSec);
      if (timeoutSec === void 0) return { ok: false, reason: "timeoutSec 必须是 null 或正数" };
      return ok({ op, file, ...base, command: body.command, timeoutSec });
    }
    case "addGroup": {
      const where = eventOnly();
      if (typeof where === "string") return { ok: false, reason: where };
      const event = where.event;
      if (typeof body.command !== "string" || body.command.length === 0) {
        return { ok: false, reason: "command 必须是非空字符串" };
      }
      let matcher = null;
      if (body.matcher !== null && body.matcher !== void 0) {
        if (typeof body.matcher !== "string") return { ok: false, reason: "matcher 必须是字符串或 null" };
        matcher = body.matcher;
      }
      if (body.timeoutSec === null || body.timeoutSec === void 0) {
        return ok({ op, file, event, matcher, command: body.command, timeoutSec: null });
      }
      const timeoutSec = positiveOf(body.timeoutSec);
      if (timeoutSec === void 0) return { ok: false, reason: "timeoutSec 必须是 null 或正数" };
      return ok({ op, file, event, matcher, command: body.command, timeoutSec });
    }
    case "removeHook": {
      const where = withHook();
      if (typeof where === "string") return { ok: false, reason: where };
      return ok({ op, file, ...where });
    }
    case "moveHook": {
      const where = withHook();
      if (typeof where === "string") return { ok: false, reason: where };
      const direction = body.direction === -1 ? -1 : body.direction === 1 ? 1 : void 0;
      const toIndex = body.toIndex === void 0 ? void 0 : indexOf(body.toIndex);
      if (body.toIndex !== void 0 && toIndex === void 0) {
        return { ok: false, reason: "toIndex 必须是非负整数" };
      }
      if (direction === void 0 && toIndex === void 0) {
        return { ok: false, reason: "direction 必须是 -1 或 1（或给 toIndex）" };
      }
      return ok({
        op,
        file,
        ...where,
        direction: direction ?? 1,
        ...toIndex === void 0 ? {} : { toIndex }
      });
    }
    case "removeGroup": {
      const base = head();
      if (typeof base === "string") return { ok: false, reason: base };
      return ok({ op, file, ...base });
    }
    default:
      return { ok: false, reason: `未知操作 ${JSON.stringify(op)}` };
  }
}

// src/host/data-plane.ts
function groupViewOf(group, options) {
  const matcher = group.matcher ?? null;
  const problem = matcherDiagnostic(matcher ?? void 0);
  return {
    file: options.file,
    rawIndex: group.rawIndex,
    matcher,
    matcherOk: problem === void 0,
    matcherProblem: problem ?? null,
    hooks: group.hooks.map((hook) => {
      const record = latestRunFor(options.ledger, {
        event: options.event,
        command: hook.command,
        projectRoot: options.projectRoot
      });
      return {
        rawIndex: hook.rawIndex,
        command: hook.command,
        timeoutSec: hook.timeoutSec ?? null,
        defaultTimeoutSec: DEFAULT_TIMEOUT_MS / 1e3,
        disabled: hook.disabled === true,
        lastRun: record === void 0 ? null : {
          at: record.at,
          exitCode: record.exitCode ?? null,
          decision: record.decision,
          durationMs: record.durationMs,
          stdout: record.stdout,
          stderr: record.stderr
        }
      };
    })
  };
}
function countsFor(groups, event) {
  let hookCount = 0;
  let disabledCount = 0;
  for (const group of groups[event] ?? []) {
    for (const hook of group.hooks) {
      if (hook.disabled === true) disabledCount++;
      else hookCount++;
    }
  }
  return { hookCount, disabledCount };
}
function runCountFor(ledger, event) {
  let count = 0;
  for (const entry of ledger) if (entry.event === event) count++;
  return count;
}
function buildSnapshot(inspection) {
  const ledger = inspection.ledger;
  const projectRoot = inspection.scope.projectRoot ?? inspection.projectRoot ?? "";
  const files = inspection.sources.map((source) => {
    let hookCount = 0;
    const rejected = source.rejected.map((one) => ({
      event: one.event,
      groupIndex: one.groupIndex,
      matcher: one.matcher ?? null,
      reason: one.reason,
      hookCount: one.hookCount
    }));
    const unrunnable = rejected.reduce((sum, one) => sum + one.hookCount, 0) + source.skipped.length;
    const events2 = HOOK_EVENTS.map((event) => {
      const parsed = source.groups[event] ?? [];
      const count = countsFor(source.groups, event);
      hookCount += count.hookCount + count.disabledCount;
      return {
        event,
        groups: parsed.map((group) => groupViewOf(group, { file: source.kind, event, ledger, projectRoot })),
        hookCount: count.hookCount,
        disabledCount: count.disabledCount,
        runCount: runCountFor(ledger, event)
      };
    });
    return {
      kind: source.kind,
      path: source.path,
      state: source.state,
      message: source.message,
      version: source.version,
      hookCount,
      rejected,
      unrunnable,
      skipped: source.skipped,
      matcherErrors: source.matcherErrors,
      events: events2
    };
  });
  let totalHooks = 0;
  let totalDisabled = 0;
  let totalGroups = 0;
  let totalUnrunnable = 0;
  for (const file of files) totalUnrunnable += file.unrunnable;
  const events = HOOK_EVENTS.map((event) => {
    const count = countsFor(inspection.effective, event);
    const fromUser = countsFor(inspection.effectiveUserGroups, event).hookCount;
    const fromProject = countsFor(inspection.effectiveProjectGroups, event).hookCount;
    const userCount = (inspection.effectiveUserGroups[event] ?? []).length;
    const groups = (inspection.effective[event] ?? []).map(
      (group, index) => groupViewOf(group, {
        file: inspection.staleInUse ? null : index < userCount ? "user" : "project",
        event,
        ledger,
        projectRoot
      })
    );
    totalHooks += count.hookCount;
    totalDisabled += count.disabledCount;
    totalGroups += groups.length;
    return {
      event,
      groups,
      hookCount: count.hookCount,
      disabledCount: count.disabledCount,
      fromProject,
      fromUser,
      runCount: runCountFor(ledger, event)
    };
  });
  return {
    route: HOOKS_ROUTE,
    projectRoot: inspection.projectRoot,
    cwd: inspection.cwd,
    cwdSource: inspection.cwdSource,
    // 作用域三件套原样透传（纯函数不做任何推导：它是宿主的答案，页面只负责显示与回传）。
    scope: inspection.scope,
    workspaces: inspection.workspaces,
    workspacesAvailable: inspection.workspacesAvailable,
    session: inspection.session,
    files,
    events,
    total: {
      hookCount: totalHooks,
      disabledCount: totalDisabled,
      groupCount: totalGroups,
      unrunnable: totalUnrunnable
    },
    staleInUse: inspection.staleInUse,
    // 由宿主的 inspection 决定（路由注册了 POST 才为 true）。
    capabilities: { writable: inspection.writable }
  };
}
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
function sessionIdOf(request) {
  try {
    const url = new URL(request.url);
    const value = url.searchParams.get("sessionId");
    return value === null || value.length === 0 ? void 0 : value;
  } catch {
    return void 0;
  }
}
function scopeOf(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return { ok: true, target: { kind: "current" } };
  }
  const scope = url.searchParams.get("scope");
  if (scope === null || scope === "" || scope === "current") return { ok: true, target: { kind: "current" } };
  if (scope === "user") return { ok: true, target: { kind: "user" } };
  if (scope === "workspace") {
    const workspaceId = url.searchParams.get("workspaceId");
    if (workspaceId === null || workspaceId.length === 0) {
      return { ok: false, reason: "scope=workspace 时必须给 workspaceId" };
    }
    return { ok: true, target: { kind: "workspace", workspaceId } };
  }
  return { ok: false, reason: `未知的 scope ${JSON.stringify(scope)}（只认 current / user / workspace）` };
}
function writeTargetOf(file, workspaceId) {
  if (file === "user") return { kind: "user" };
  return workspaceId === void 0 ? { kind: "current" } : { kind: "workspace", workspaceId };
}
var ScopeError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "ScopeError";
    this.code = code;
  }
};
function parseDryRunRequest(body) {
  if (!isObject(body)) return { ok: false, reason: "请求体不是对象" };
  const { file, event, groupIndex, hookIndex, workspaceId } = body;
  if (file !== "project" && file !== "user") return { ok: false, reason: "file 必须是 project / user" };
  if (typeof event !== "string") return { ok: false, reason: "event 不是支持的 7 个事件之一" };
  if (!isHookEvent(event)) return { ok: false, reason: "event 不是支持的 7 个事件之一" };
  if (typeof groupIndex !== "number" || !Number.isInteger(groupIndex) || groupIndex < 0) {
    return { ok: false, reason: "groupIndex 必须是非负整数" };
  }
  if (typeof hookIndex !== "number" || !Number.isInteger(hookIndex) || hookIndex < 0) {
    return { ok: false, reason: "hookIndex 必须是非负整数" };
  }
  if (workspaceId !== void 0) {
    if (typeof workspaceId !== "string" || workspaceId.length === 0) {
      return { ok: false, reason: "workspaceId 必须是非空字符串" };
    }
    if (file === "user") return { ok: false, reason: "file 为 user 时不许带 workspaceId" };
  }
  const request = workspaceId === void 0 ? { file, event, groupIndex, hookIndex } : { file, event, groupIndex, hookIndex, workspaceId };
  return { ok: true, request, target: writeTargetOf(file, workspaceId) };
}
var STATUS_OF = {
  stale: 409,
  exists: 409,
  "not-preservable": 409,
  "invalid-json": 409,
  "no-project": 409,
  "no-version": 409,
  // 目标组在文件里，但它不会运行（matcher 非法 / 结构坏了）—— 与"真的不在了"分开。
  rejected: 409,
  // 事件键存在但不是数组：文件结构坏了，先修文件再改。
  "malformed-event": 409,
  // 宿主没有工作区清单：不是"你的请求错了"，而是"这个宿主给不了那个能力"。
  "no-workspace-registry": 409,
  absent: 404,
  "not-found": 404,
  // 工作区已经不在清单里（可能被删过）—— 当成"目标不存在"，与 not-found 同档。
  "unknown-workspace": 404,
  sandbox: 403,
  "bad-op": 400,
  "bad-json": 400,
  "out-of-range": 400,
  "resolve-failed": 500,
  "write-failed": 500,
  internal: 500
};
function statusFor(error) {
  return STATUS_OF[error];
}
function registerHooksRoute(connection, deps) {
  connection.fetch.register({
    path: HOOKS_ROUTE,
    // POST 与 GET 同时在册：页面用 `capabilities.writable` 决定要不要真的发写请求。
    methods: ["GET", "POST"],
    // 必须在 bridge 读任何字节**之前**声明（官方契约）。body 只有几百字节，不必流式。
    requestBody: "buffered",
    async fetch(request) {
      const sessionId = sessionIdOf(request);
      try {
        if (request.method === "POST") {
          let body;
          try {
            body = await request.json();
          } catch {
            return jsonResponse(400, { ok: false, error: "bad-json" });
          }
          if (isObject(body) && body.op === "dryRun") {
            const parsedDryRun = parseDryRunRequest(body);
            if (!parsedDryRun.ok) return jsonResponse(400, { ok: false, error: "bad-op", detail: parsedDryRun.reason });
            const outcome2 = await deps.dryRun(parsedDryRun.request, parsedDryRun.target, sessionId, request.signal);
            if (!outcome2.ok) {
              const code = hostErrorCodeOf(outcome2.error);
              return jsonResponse(statusFor(code), {
                ok: false,
                error: code,
                ...outcome2.detail !== void 0 ? { detail: outcome2.detail } : {}
              });
            }
            return jsonResponse(200, { ok: true, data: { run: outcome2.run } });
          }
          const parsed = parseHooksRequest(body);
          if (!parsed.ok) return jsonResponse(400, { ok: false, error: "bad-op", detail: parsed.reason });
          const outcome = await deps.write(
            parsed.request,
            writeTargetOf(parsed.request.file, parsed.request.workspaceId),
            sessionId,
            request.signal
          );
          if (!outcome.ok) {
            const code = hostErrorCodeOf(outcome.error);
            return jsonResponse(statusFor(code), {
              ok: false,
              error: code,
              ...outcome.detail !== void 0 ? { detail: outcome.detail } : {}
            });
          }
          return jsonResponse(200, {
            ok: true,
            data: { file: parsed.request.file, version: outcome.version ?? null }
          });
        }
        const scope = scopeOf(request);
        if (!scope.ok) return jsonResponse(400, { ok: false, error: "bad-op", detail: scope.reason });
        const inspection = await deps.inspect(sessionId, scope.target);
        return jsonResponse(200, { ok: true, data: buildSnapshot(inspection) });
      } catch (error) {
        if (error instanceof ScopeError) {
          const code = hostErrorCodeOf(error.code);
          return jsonResponse(statusFor(code), { ok: false, error: code, detail: error.message });
        }
        return jsonResponse(500, { ok: false, error: "internal", detail: messageOf(error) });
      }
    }
  });
}

// src/host/index.ts
var name = "dsh-hooks";
var inject = ["shell", "fs"];
function isMissingFile(message) {
  return /ENOENT|not found|no such file/i.test(message);
}
function dshHome() {
  const configured = process.env.DSH_HOME;
  if (typeof configured === "string" && configured.length > 0) return configured;
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  return home !== "" ? joinPath(home, PROJECT_DIR) : PROJECT_DIR;
}
function apply(ctx) {
  const fsSvc = ctx.fs;
  const shell = ctx.shell;
  const log = ctx.logger;
  const projectCache = /* @__PURE__ */ new Map();
  const rootCache = /* @__PURE__ */ new Map();
  const watched = /* @__PURE__ */ new Set();
  const watchWarned = /* @__PURE__ */ new Set();
  const invalidateLoggedAt = /* @__PURE__ */ new Map();
  const loadedSignature = /* @__PURE__ */ new Map();
  const lastGood = /* @__PURE__ */ new Map();
  const lastErrorText = /* @__PURE__ */ new Map();
  const watchers = [];
  const detached = /* @__PURE__ */ new Set();
  const stopForced = /* @__PURE__ */ new Map();
  const subagentChildren = /* @__PURE__ */ new Map();
  const ledger = new ExecutionLedger();
  const watcherAbort = new AbortController();
  let disposed = false;
  ctx.effect(
    () => () => {
      disposed = true;
      ledger.clear();
      watcherAbort.abort(new Error("dsh-hooks disposed"));
      for (const close of watchers) {
        try {
          void close().catch(() => void 0);
        } catch {
        }
      }
      watchers.length = 0;
      return Promise.allSettled([...detached]);
    },
    "dsh-hooks: 释放 watcher 与 detached 运行"
  );
  function warn(message) {
    try {
      if (log !== void 0 && typeof log.warn === "function") log.warn(message);
    } catch {
    }
  }
  function info(message) {
    try {
      if (log !== void 0 && typeof log.info === "function") log.info(message);
    } catch {
    }
  }
  function infoThrottled(key, message) {
    const now = Date.now();
    const last = invalidateLoggedAt.get(key);
    if (last !== void 0 && now - last < INVALIDATE_LOG_INTERVAL_MS) return;
    invalidateLoggedAt.set(key, now);
    info(message);
  }
  function track(run) {
    detached.add(run);
    const settle = () => {
      detached.delete(run);
    };
    void run.then(settle, settle);
  }
  async function exists(path) {
    try {
      const target = await fsSvc.resolve(path);
      const stat = await fsSvc.stat(target);
      return stat !== void 0;
    } catch {
      return false;
    }
  }
  async function readJsonFile(path, signal) {
    let target;
    let version;
    try {
      target = await fsSvc.resolve(path);
      const stat = await fsSvc.stat(target, signal);
      if (stat === void 0 || stat.type !== "file") return { path, state: "absent", target, version: void 0 };
      version = stat.version === void 0 || stat.version === null ? void 0 : stat.version;
    } catch (error) {
      const message = messageOf(error);
      return isMissingFile(message) ? { path, state: "absent", target: void 0, version: void 0 } : { path, state: "error", target: void 0, message, version: void 0 };
    }
    let text;
    try {
      text = await fsSvc.readText(target, signal);
    } catch (error) {
      const message = messageOf(error);
      return isMissingFile(message) ? { path, state: "absent", target, version } : { path, state: "error", target, message, version };
    }
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch (error) {
      return { path, state: "error", target, message: messageOf(error), version };
    }
    if (!isObject(parsed)) {
      return { path, state: "error", target, message: "顶层不是 JSON 对象", version };
    }
    return { path, state: "ok", target, raw: parsed, text, version };
  }
  async function findProjectRoot(cwd) {
    let start = cwd;
    try {
      const target = await fsSvc.resolve(cwd);
      start = target.displayPath;
    } catch {
      return cwd;
    }
    let node = start;
    for (let i = 0; i < MAX_PROJECT_DEPTH; i++) {
      if (await exists(joinPath(node, ".git"))) return node;
      const parent = parentOf(node);
      if (parent === void 0 || parent === node) break;
      node = parent;
    }
    return start;
  }
  async function projectRootFor(cwd) {
    const key = cwd === "" ? "" : cwd;
    const hit = rootCache.get(key);
    if (hit !== void 0) return hit;
    const root = await findProjectRoot(key);
    rootCache.set(key, root);
    return root;
  }
  async function ensureWatch(path, invalidate) {
    if (disposed || watched.has(path)) return;
    if (typeof fsSvc.watch !== "function") {
      if (!watchWarned.has(path)) {
        watchWarned.add(path);
        warn(
          `dsh-hooks: ctx.fs 不提供 watch()，无法监听 ${path} —— 热重载退化为 ${POSITIVE_TTL_MS / 1e3}s 正向 TTL 兜底（改配置最坏延迟这么多秒生效）`
        );
      }
      return;
    }
    watched.add(path);
    try {
      const target = await fsSvc.resolve(path);
      const stat = await fsSvc.stat(target);
      const kind = stat === void 0 ? "尚不存在（等待创建）" : stat.type === "directory" ? "目录" : stat.type === "file" ? "文件" : `其他类型 ${String(stat.type)}`;
      const close = await fsSvc.watch(
        target,
        (error) => {
          if (error !== void 0) warn(`dsh-hooks: 监听 ${path} 出错：${String(error)}`);
          infoThrottled(path, `dsh-hooks: 监听到变化 → 失效配置缓存（${path}）`);
          invalidate();
        },
        watcherAbort.signal
      );
      watchers.push(close);
      watchWarned.delete(path);
      info(`dsh-hooks: 已监听 ${path}（判定为${kind}）`);
    } catch (error) {
      watched.delete(path);
      if (!watchWarned.has(path)) {
        watchWarned.add(path);
        warn(`dsh-hooks: 无法监听 ${path}：${messageOf(error)}`);
      }
    }
  }
  async function readVersions(projectRoot) {
    const probe = async (path) => {
      try {
        const target = await fsSvc.resolve(path);
        const stat = await fsSvc.stat(target);
        if (stat === void 0 || stat.type !== "file") return { known: true, version: void 0 };
        if (stat.version === void 0 || stat.version === null) return { known: false, version: void 0 };
        return { known: true, version: stat.version };
      } catch (error) {
        return isMissingFile(messageOf(error)) ? { known: true, version: void 0 } : { known: false, version: void 0 };
      }
    };
    const [user, project] = await Promise.all([
      probe(joinPath(dshHome(), HOOKS_FILE)),
      probe(joinPath(projectRoot, PROJECT_DIR, HOOKS_FILE))
    ]);
    if (!user.known || !project.known) return void 0;
    return { user: user.version, project: project.version };
  }
  function sameVersions(previous, next) {
    return previous !== void 0 && previous.user === next.user && previous.project === next.project;
  }
  function configFor(projectRoot) {
    const cached = projectCache.get(projectRoot);
    if (cached !== void 0 && !cached.state.settled) return cached.promise;
    const probe = cached === void 0 ? Promise.resolve(void 0) : readVersions(projectRoot);
    return probe.then((versions) => {
      const current = projectCache.get(projectRoot);
      if (current !== void 0 && !current.state.settled) return current.promise;
      if (current !== void 0 && current.state.settled) {
        if (versions !== void 0 && sameVersions(current.state.versions, versions)) {
          current.state.expiresAt = Date.now() + (current.state.hasHooks ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS);
          return current.promise;
        }
        if (versions === void 0 && Date.now() < current.state.expiresAt) return current.promise;
      }
      projectCache.delete(projectRoot);
      return loadConfig(projectRoot);
    });
  }
  function loadConfig(projectRoot) {
    const userPath = joinPath(dshHome(), HOOKS_FILE);
    const projectPath = joinPath(projectRoot, PROJECT_DIR, HOOKS_FILE);
    const state = {
      settled: false,
      expiresAt: Number.POSITIVE_INFINITY,
      versions: void 0,
      hasHooks: false,
      stale: false
    };
    const promise = (async () => {
      const [userRead, projectRead] = await Promise.all([readJsonFile(userPath), readJsonFile(projectPath)]);
      const failures = [];
      if (userRead.state === "error") failures.push(userRead);
      if (projectRead.state === "error") failures.push(projectRead);
      for (const failure of failures) {
        const key = `${projectRoot}\0${failure.path}`;
        if (lastErrorText.get(key) !== failure.message) {
          lastErrorText.set(key, failure.message);
          warn(`dsh-hooks: 读取 ${failure.path} 失败：${failure.message}`);
        }
      }
      const previous = lastGood.get(projectRoot);
      const pick = (read) => read.state === "ok" ? read.raw : void 0;
      const userStale = userRead.state === "error" && previous !== void 0;
      const projectStale = projectRead.state === "error" && previous !== void 0;
      const stale = userStale || projectStale;
      if (stale) {
        const sides = [userStale ? "用户级" : "", projectStale ? "项目级" : ""].filter((one) => one !== "").join(" + ");
        infoThrottled(
          `${projectRoot}\0stale`,
          `dsh-hooks: ${sides}配置当前读不出来，继续沿用上一份可用配置（${projectPath}）`
        );
      }
      const versionOf = (read) => read.version === void 0 || read.version === null ? void 0 : read.version;
      const userRaw = userStale ? previous.userRaw : pick(userRead);
      const projectRaw = projectStale ? previous.projectRaw : pick(projectRead);
      const vars = { projectDir: projectRoot };
      const user = parseHookConfig(userRaw, vars);
      const project = parseHookConfig(projectRaw, vars);
      for (const skipped of [...user.skipped, ...project.skipped]) {
        warn(
          skipped.reason === "empty-command" ? `dsh-hooks: 跳过一条没有命令的 command 条目（事件 ${skipped.event}）` : `dsh-hooks: 跳过不支持的 ${JSON.stringify(skipped.type)} handler（事件 ${skipped.event}）—— 只运行 command hook`
        );
      }
      for (const message of [...user.errors, ...project.errors]) warn(`dsh-hooks: ${message}`);
      const groups = mergeHookGroups(user.groups, project.groups);
      const summary = HOOK_EVENTS.filter((event) => groups[event] !== void 0).join(",");
      const hasHooks = summary.length > 0;
      if (failures.length === 0) {
        lastGood.set(projectRoot, { userRaw: pick(userRead), projectRaw: pick(projectRead), at: Date.now() });
        for (const failurePath of [userPath, projectPath]) {
          lastErrorText.delete(`${projectRoot}\0${failurePath}`);
        }
      }
      const signature = `${projectPath}\0${summary}`;
      if (loadedSignature.get(projectRoot) !== signature) {
        loadedSignature.set(projectRoot, signature);
        const suffix = stale ? "（沿用上一份可用配置）" : "";
        info(`dsh-hooks: ${projectPath} ${hasHooks ? "已加载事件 " + summary : "无可用 hook"}${suffix}`);
      }
      state.settled = true;
      state.expiresAt = Date.now() + (failures.length > 0 || !hasHooks ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS);
      state.versions = { user: versionOf(userRead), project: versionOf(projectRead) };
      state.hasHooks = hasHooks;
      state.stale = stale;
      return { groups, userGroups: user.groups, projectGroups: project.groups, projectPath, userPath };
    })().catch((error) => {
      warn(`dsh-hooks: 加载 ${projectRoot} 的 hook 配置失败：${messageOf(error)}`);
      state.settled = true;
      state.expiresAt = Date.now() + NEGATIVE_TTL_MS;
      state.versions = { user: void 0, project: void 0 };
      state.hasHooks = false;
      state.stale = false;
      return { groups: {}, userGroups: {}, projectGroups: {}, projectPath, userPath };
    });
    projectCache.set(projectRoot, { state, promise });
    track(
      (async () => {
        await ensureWatch(joinPath(projectRoot, PROJECT_DIR), () => projectCache.delete(projectRoot));
        await ensureWatch(projectPath, () => projectCache.delete(projectRoot));
        await ensureWatch(userPath, () => {
          projectCache.clear();
        });
      })()
    );
    return promise;
  }
  function sandboxPolicyFor(agent) {
    const sandboxPolicy = ctx.get("sandboxPolicy");
    if (sandboxPolicy === void 0 || typeof sandboxPolicy.resolve !== "function") return void 0;
    try {
      const session = agent?.session;
      const policy = sandboxPolicy.resolve(session === void 0 ? {} : { session });
      if (!isObject(policy) || typeof policy.mode !== "string" || typeof policy.workspaceRoot !== "string") {
        return void 0;
      }
      return { passthrough: policy, mode: policy.mode };
    } catch (error) {
      warn(`dsh-hooks: 解析沙箱策略失败，本次 hook 回退到部署策略：${messageOf(error)}`);
      return void 0;
    }
  }
  async function contextFor(agent) {
    const cwd = agent?.session?.header?.cwd ?? process.cwd();
    const projectRoot = await projectRootFor(cwd);
    const config = await configFor(projectRoot);
    return { cwd, projectRoot, config, sandboxPolicy: sandboxPolicyFor(agent) };
  }
  function agentOf(exec) {
    if (exec.agent !== void 0) return exec.agent;
    const agents = ctx.get("agents");
    if (agents !== void 0 && typeof agents.currentInitiator === "function") {
      try {
        return agents.currentInitiator();
      } catch {
        return void 0;
      }
    }
    return void 0;
  }
  async function runSingleHook(hook, point, context, payload, signal) {
    const sandboxPolicy = context.sandboxPolicy;
    const started = Date.now();
    const timeoutMs = hook.timeoutSec !== void 0 ? hook.timeoutSec * 1e3 : DEFAULT_TIMEOUT_MS;
    let output;
    try {
      const request = {
        command: hook.command,
        workdir: context.cwd,
        timeoutMs,
        stdin: JSON.stringify(payload) + "\n",
        signal,
        env: { DSH_PROJECT_DIR: context.projectRoot },
        // 关键：hook 子进程按**调用会话**的档位与会话 cwd 跑，而不是部署默认档。
        // 拿不到策略时整条字段省略（回退部署策略），绝不让 hook 跑不起来。
        ...sandboxPolicy !== void 0 ? { sandboxPolicy: sandboxPolicy.passthrough } : {}
      };
      const spec = shell.resolve(request);
      const execution = await shell.execute(spec);
      const result = await execution.result();
      output = parseHookOutput(
        result.exitCode === null || result.exitCode === void 0 ? void 0 : result.exitCode,
        result.stdout?.text,
        result.stderr?.text,
        point
      );
    } catch (error) {
      output = parseHookOutput(void 0, "", messageOf(error), point);
    }
    return { output, durationMs: Date.now() - started };
  }
  async function runPoint(context, point, matchQuery, payload, signal) {
    const groups = context.config.groups[point] ?? [];
    if (groups.length === 0) return mergeHookOutputs([]);
    const sandboxPolicy = context.sandboxPolicy;
    const sandboxLabel = sandboxPolicy !== void 0 ? sandboxPolicy.mode : "deployment";
    const outputs = [];
    for (const group of groups) {
      if (!matchesMatcher(group.matcher, matchQuery)) continue;
      for (const hook of group.hooks) {
        if (hook.disabled === true) continue;
        const { output, durationMs } = await runSingleHook(hook, point, context, payload, signal);
        ledger.push({
          at: Date.now() - durationMs,
          sessionId: typeof payload.session_id === "string" ? payload.session_id : "",
          event: point,
          command: hook.command,
          // 记下这次执行发生在哪个项目根下 —— 状态色的匹配条件是 event + command + projectRoot
          // 三者（§2.3）：少了它，同命令在别的项目跑过就会给这一行上色。
          projectRoot: context.projectRoot,
          exitCode: output.exitCode,
          decision: output.decision ?? "pass",
          durationMs,
          stdout: output.stdout,
          stderr: output.stderr
        });
        info(
          `dsh-hooks: [${point}] ${JSON.stringify(hook.command)} exit=${output.exitCode === void 0 ? "spawn-failed" : output.exitCode} decision=${output.decision ?? "pass"} sandbox=${sandboxLabel} ${durationMs}ms`
        );
        outputs.push(output);
      }
    }
    return mergeHookOutputs(outputs);
  }
  function basePayload(agent, event, context) {
    return {
      session_id: agent?.session?.header?.id ?? "",
      // DSH 的会话日志是 zstd 压缩的，shell 脚本读不了，这里与官方桥保持一致恒为空串。
      transcript_path: "",
      cwd: context.cwd,
      hook_event_name: event
    };
  }
  function sessionStartPayload(agent, source, context) {
    return { ...basePayload(agent, "SessionStart", context), source };
  }
  function promptPayload(agent, content, context) {
    return { ...basePayload(agent, "UserPromptSubmit", context), prompt: blocksToText(content) };
  }
  function preToolPayload(exec, context) {
    return {
      ...basePayload(exec.agent, "PreToolUse", context),
      tool_name: exec.name,
      tool_input: exec.arguments,
      tool_use_id: exec.callId
    };
  }
  function postToolPayload(exec, result, context) {
    const content = isObject(result) ? result.content : void 0;
    return {
      ...basePayload(exec.agent, "PostToolUse", context),
      tool_name: exec.name,
      tool_input: exec.arguments,
      tool_use_id: exec.callId,
      tool_response: blocksToText(content)
    };
  }
  function stopPayload(agent, context, forced) {
    return { ...basePayload(agent, "Stop", context), stop_hook_active: forced };
  }
  function subagentPayload(event, info2, child, context) {
    return {
      ...basePayload(child, event, context),
      agent_id: info2.id,
      agent_type: SUBAGENT_TYPE,
      ...event === "SubagentStop" ? { stop_hook_active: false } : {}
    };
  }
  function agentForSession(sessionId) {
    const agents = ctx.get("agents");
    if (sessionId !== void 0 && agents !== void 0 && typeof agents.get === "function") {
      try {
        const agent = agents.get(sessionId);
        const cwd = agent?.session?.header?.cwd;
        if (typeof cwd === "string" && cwd.length > 0) return { agent, source: "session" };
      } catch {
      }
    }
    if (agents !== void 0 && typeof agents.currentInitiator === "function") {
      try {
        const agent = agents.currentInitiator();
        const cwd = agent?.session?.header?.cwd;
        if (typeof cwd === "string" && cwd.length > 0) return { agent, source: "initiator" };
      } catch {
      }
    }
    return { agent: void 0, source: "none" };
  }
  async function sessionContextFor(sessionId) {
    const found = agentForSession(sessionId);
    const cwd = found.agent?.session?.header?.cwd;
    if (typeof cwd !== "string" || cwd.length === 0) return { cwd: null, cwdSource: "none", projectRoot: null };
    return { cwd, cwdSource: found.source, projectRoot: await projectRootFor(cwd) };
  }
  function workspaceRecordOf(value) {
    if (!isObject(value)) return void 0;
    const { id, path, title } = value;
    if (typeof id !== "string" || id.length === 0) return void 0;
    if (typeof path !== "string" || path.length === 0) return void 0;
    return { id, path, ...typeof title === "string" && title.length > 0 ? { title } : {} };
  }
  function workspaceService() {
    const registry = ctx.get("workspaceRegistry");
    if (registry === void 0) return void 0;
    if (typeof registry.list !== "function" && typeof registry.get !== "function") return void 0;
    return registry;
  }
  async function workspaceList() {
    const registry = workspaceService();
    if (registry === void 0 || typeof registry.list !== "function") return { available: false, records: [] };
    let raw;
    try {
      raw = await registry.list();
    } catch (error) {
      warn(`dsh-hooks: 读取工作区清单失败：${messageOf(error)}`);
      return { available: false, records: [] };
    }
    if (!isUnknownArray(raw)) return { available: false, records: [] };
    const records = [];
    for (const item of raw) {
      const record = workspaceRecordOf(item);
      if (record !== void 0) records.push(record);
    }
    return { available: true, records };
  }
  async function lookupWorkspace(id) {
    const registry = workspaceService();
    if (registry === void 0) return { available: false, record: void 0 };
    if (typeof registry.get === "function") {
      try {
        const record = workspaceRecordOf(registry.get(id));
        if (record !== void 0) return { available: true, record };
      } catch (error) {
        warn(`dsh-hooks: 查询工作区 ${id} 失败：${messageOf(error)}`);
      }
    }
    if (typeof registry.list === "function") {
      const listed = await workspaceList();
      if (!listed.available) return { available: false, record: void 0 };
      return { available: true, record: listed.records.find((record) => record.id === id) };
    }
    return { available: true, record: void 0 };
  }
  async function resolveScope(session, target) {
    if (target.kind === "user") return { kind: "user", projectRoot: null, workspace: null, isCurrentSession: null };
    if (target.kind === "current") {
      if (session.projectRoot === null) {
        return { kind: "user", projectRoot: null, workspace: null, isCurrentSession: null };
      }
      return { kind: "workspace", projectRoot: session.projectRoot, workspace: null, isCurrentSession: true };
    }
    const lookup = await lookupWorkspace(target.workspaceId);
    if (!lookup.available) {
      throw new ScopeError(
        "no-workspace-registry",
        "宿主没有提供工作区清单（workspaceRegistry），只能改当前项目和用户级配置"
      );
    }
    if (lookup.record === void 0) {
      throw new ScopeError("unknown-workspace", `工作区 ${target.workspaceId} 不在宿主的清单里（可能被删过）`);
    }
    const path = lookup.record.path;
    const projectRoot = await projectRootFor(path);
    return {
      kind: "workspace",
      projectRoot,
      workspace: { id: lookup.record.id, title: lookup.record.title ?? lookup.record.id, path },
      // 比较的是**项目根**而不是工作区路径：工作区是仓库子目录时也能判对。
      isCurrentSession: session.projectRoot === null ? null : session.projectRoot === projectRoot
    };
  }
  async function workspacesFor(session) {
    const listed = await workspaceList();
    if (!listed.available) return { items: [], available: false };
    const items = await Promise.all(
      listed.records.map(async (record) => {
        const projectRoot = await projectRootFor(record.path);
        return {
          id: record.id,
          title: record.title ?? record.id,
          path: record.path,
          projectRoot,
          isCurrent: session.projectRoot !== null && session.projectRoot === projectRoot
        };
      })
    );
    return { items, available: true };
  }
  function countsOf(groups) {
    let hookCount = 0;
    let disabled = 0;
    let groupCount = 0;
    for (const event of HOOK_EVENTS) {
      for (const group of groups[event] ?? []) {
        groupCount++;
        for (const hook of group.hooks) {
          if (hook.disabled === true) disabled++;
          else hookCount++;
        }
      }
    }
    return { hookCount, disabledCount: disabled, groupCount };
  }
  async function sessionEffectOf(session) {
    if (session.projectRoot === null) return null;
    const projectRoot = session.projectRoot;
    const config = await configFor(projectRoot);
    const counts = countsOf(config.groups);
    return {
      projectRoot,
      hookCount: counts.hookCount,
      disabledCount: counts.disabledCount,
      groupCount: counts.groupCount,
      fromUser: countsOf(config.userGroups).hookCount,
      fromProject: countsOf(config.projectGroups).hookCount,
      staleInUse: projectCache.get(projectRoot)?.state.stale === true
    };
  }
  function sourceViewOf(kind, read, vars) {
    const parsed = parseHookConfig(read.state === "ok" ? read.raw : void 0, vars);
    return {
      kind,
      path: read.path,
      state: read.state,
      // 技术原文只在 error 时给出，且只放"详情"位（AGENTS §3.9：不作为页面主文案）。
      message: read.state === "error" ? read.message : null,
      version: read.version === void 0 || read.version === null ? null : read.version,
      groups: parsed.groups,
      skipped: parsed.skipped,
      rejected: parsed.rejected,
      matcherErrors: parsed.errors
    };
  }
  async function inspect(sessionId, target) {
    const session = await sessionContextFor(sessionId);
    const userPath = joinPath(dshHome(), HOOKS_FILE);
    const userRead = await readJsonFile(userPath);
    const resolved = await resolveScope(session, target);
    const listed = await workspacesFor(session);
    const scope = {
      kind: resolved.kind,
      requested: target.kind,
      workspaceId: resolved.workspace?.id ?? null,
      workspaceTitle: resolved.workspace?.title ?? null,
      workspacePath: resolved.workspace?.path ?? null,
      projectRoot: resolved.projectRoot,
      isCurrentSession: resolved.isCurrentSession
    };
    const base = {
      projectRoot: session.projectRoot,
      cwd: session.cwd,
      cwdSource: session.cwdSource,
      scope,
      workspaces: listed.items,
      workspacesAvailable: listed.available,
      // 数据面本身就是"能写"的入口：路由注册了 POST，页面据此显示可编辑。
      writable: true,
      ledger: ledger.entries()
    };
    if (resolved.kind === "user") {
      const userOnly = sourceViewOf("user", userRead, {});
      return {
        ...base,
        session: await sessionEffectOf(session),
        sources: [userOnly],
        effective: userOnly.groups,
        // 这个作用域里没有项目级贡献：合并输入就是用户级自己（`fromProject` 因此恒为 0）。
        effectiveUserGroups: userOnly.groups,
        effectiveProjectGroups: {},
        staleInUse: false
      };
    }
    const projectRoot = resolved.projectRoot ?? "";
    const vars = { projectDir: projectRoot };
    const projectRead = await readJsonFile(joinPath(projectRoot, PROJECT_DIR, HOOKS_FILE));
    const project = sourceViewOf("project", projectRead, vars);
    const user = sourceViewOf("user", userRead, vars);
    const config = await configFor(projectRoot);
    const stale = projectCache.get(projectRoot)?.state.stale === true;
    return {
      ...base,
      // 会话生效视图**只有一处实现**（`sessionEffectOf`）：目标就是当前会话的项目时它照样成立
      // （`configFor(projectRoot)` 命中同一份缓存，不多读一次文件）。刻意**不**在这里再抄一份
      // 计数逻辑 —— 两处必然漂移，而漂移的就是"实际会跑几条"这个数字。
      session: await sessionEffectOf(session),
      // 展示顺序：项目级在前（它才是"这个项目"的配置）。合并顺序由 effective 决定，与这里无关。
      sources: [project, user],
      effective: config.groups,
      // 合并输入（**与 effective 同源**：磁盘或 last-good 由同一条路径决定）——页面据此标来源。
      effectiveUserGroups: config.userGroups,
      effectiveProjectGroups: config.projectGroups,
      staleInUse: stale
    };
  }
  ctx.inject(["connection"], (scope) => {
    registerHooksRoute(scope.connection, { inspect, write: handleWrite, dryRun: dryRunHook });
  });
  async function prepareWrite(path, signal) {
    const read = await readJsonFile(path, signal);
    if (read.state === "error") {
      return { ok: false, error: "invalid-json", detail: read.message };
    }
    if (read.target === void 0) return { ok: false, error: "resolve-failed" };
    if (read.state === "absent") return { ok: true, state: "absent", target: read.target };
    const version = read.version;
    if (typeof version !== "string" || version.length === 0) {
      return { ok: false, error: "no-version" };
    }
    return { ok: true, state: "ok", target: read.target, doc: read.raw, text: read.text, version };
  }
  function writeErrorCode(error) {
    const message = messageOf(error);
    if (message.includes("FS_STALE_VERSION")) return "stale";
    if (/FS_EXISTS|FS_ALREADY_EXISTS|already exists|EEXIST/i.test(message)) return "exists";
    if (/FS_(DENIED|SANDBOX|READ_ONLY)|read-only|permission denied|EPERM|EACCES/i.test(message)) return "sandbox";
    return "write-failed";
  }
  async function writeHookFile(request, projectRoot, signal, policy) {
    const path = request.file === "user" ? joinPath(dshHome(), HOOKS_FILE) : projectRoot === null ? void 0 : joinPath(projectRoot, PROJECT_DIR, HOOKS_FILE);
    if (path === void 0) return { ok: false, error: "no-project" };
    const prep = await prepareWrite(path, signal);
    if (!prep.ok) return { ok: false, error: prep.error, ...prep.detail !== void 0 ? { detail: prep.detail } : {} };
    const sandboxPolicy = policy?.passthrough;
    const pageVersion = request.expectedVersion;
    try {
      if (request.op === "createFile") {
        if (typeof pageVersion === "string") return { ok: false, error: "stale" };
        if (prep.state !== "absent") return { ok: false, error: "exists" };
        const created = await fsSvc.writeText(
          prep.target,
          starterText(DEFAULT_STYLE),
          { kind: "createIfAbsent" },
          signal,
          sandboxPolicy
        );
        return { ok: true, version: created.version };
      }
      if (prep.state === "absent") {
        if (pageVersion !== void 0 && pageVersion !== null) return { ok: false, error: "stale" };
        if (request.op !== "addGroup" && request.op !== "addHook") return { ok: false, error: "absent" };
        const skeleton = { hooks: {} };
        const seeding = request.op === "addHook" ? { ...request, op: "addGroup", matcher: null } : request;
        const applied2 = applyOp(skeleton, seeding);
        if (!applied2.ok) return { ok: false, error: applied2.reason };
        const problem2 = preservationProblem(skeleton, applied2.applied.doc, applied2.applied.changes);
        if (problem2 !== void 0) return { ok: false, error: "not-preservable", detail: problem2 };
        const text2 = serialize(applied2.applied.doc, DEFAULT_STYLE);
        const created = await fsSvc.writeText(prep.target, text2, { kind: "createIfAbsent" }, signal, sandboxPolicy);
        return { ok: true, version: created.version };
      }
      const applied = applyOp(prep.doc, request);
      if (!applied.ok) return { ok: false, error: applied.reason };
      if (typeof pageVersion === "string" && prep.version !== pageVersion) {
        return { ok: false, error: "stale", detail: `页面版本 ${pageVersion} ≠ 磁盘版本 ${prep.version}` };
      }
      if (pageVersion === null) return { ok: false, error: "stale", detail: "页面认为文件不存在，但它存在" };
      const problem = preservationProblem(prep.doc, applied.applied.doc, applied.applied.changes);
      if (problem !== void 0) return { ok: false, error: "not-preservable", detail: problem };
      const text = serialize(applied.applied.doc, detectStyle(prep.text));
      const written = await fsSvc.writeText(
        prep.target,
        text,
        { kind: "replaceIfVersion", version: prep.version },
        signal,
        sandboxPolicy
      );
      return { ok: true, version: written.version };
    } catch (error) {
      return { ok: false, error: writeErrorCode(error), detail: messageOf(error) };
    }
  }
  async function writeRootFor(target, sessionId) {
    if (target.kind === "user") return { ok: true, projectRoot: null };
    if (target.kind === "current") {
      const found = agentForSession(sessionId);
      const cwd = found.agent?.session?.header?.cwd;
      return {
        ok: true,
        projectRoot: typeof cwd === "string" && cwd.length > 0 ? await projectRootFor(cwd) : null
      };
    }
    const lookup = await lookupWorkspace(target.workspaceId);
    if (!lookup.available) return { ok: false, error: "no-workspace-registry" };
    if (lookup.record === void 0) return { ok: false, error: "unknown-workspace" };
    return { ok: true, projectRoot: await projectRootFor(lookup.record.path) };
  }
  async function handleWrite(request, target, sessionId, signal) {
    const found = agentForSession(sessionId);
    const root = await writeRootFor(target, sessionId);
    if (!root.ok) return { ok: false, error: root.error };
    return writeHookFile(request, root.projectRoot, signal, sandboxPolicyFor(found.agent));
  }
  async function dryRunHook(request, target, sessionId, signal) {
    const found = agentForSession(sessionId);
    const session = await sessionContextFor(sessionId);
    const root = await writeRootFor(target, sessionId);
    if (!root.ok) return { ok: false, error: root.error };
    const projectRoot = root.projectRoot;
    const path = request.file === "user" ? joinPath(dshHome(), HOOKS_FILE) : projectRoot === null ? void 0 : joinPath(projectRoot, PROJECT_DIR, HOOKS_FILE);
    if (path === void 0) return { ok: false, error: "no-project" };
    const read = await readJsonFile(path, signal);
    if (read.state === "error") return { ok: false, error: "invalid-json", detail: read.message };
    if (read.state === "absent") return { ok: false, error: "absent" };
    const parsed = parseHookConfig(read.raw, { projectDir: projectRoot ?? "" });
    const group = (parsed.groups[request.event] ?? []).find((candidate) => candidate.rawIndex === request.groupIndex);
    if (group === void 0) {
      const rejected = parsed.rejected.find(
        (candidate) => candidate.event === request.event && candidate.groupIndex === request.groupIndex
      );
      if (rejected !== void 0) {
        const where = rejected.matcher === void 0 ? "" : `：${rejected.matcher}`;
        return { ok: false, error: "rejected", detail: `这一组不会运行（${rejected.reason}）${where}` };
      }
      return { ok: false, error: "not-found", detail: "这个分组不在文件里（可能刚被改过）" };
    }
    const hook = group.hooks.find((candidate) => candidate.rawIndex === request.hookIndex);
    if (hook === void 0) return { ok: false, error: "not-found", detail: "这一条不在文件里（可能刚被改过）" };
    const cwd = projectRoot !== null && session.projectRoot === projectRoot && session.cwd !== null ? session.cwd : projectRoot ?? session.cwd ?? "";
    const context = {
      cwd,
      projectRoot: projectRoot ?? "",
      sandboxPolicy: sandboxPolicyFor(found.agent)
    };
    const payload = { ...basePayload(found.agent, request.event, context), dry_run: true };
    const { output, durationMs } = await runSingleHook(hook, request.event, context, payload, signal);
    return {
      ok: true,
      run: {
        command: hook.command,
        // `null` = 子进程没起来（与台账里的语义一致，页面据此显示"启动失败"而不是绿）。
        exitCode: output.exitCode ?? null,
        decision: output.decision ?? "pass",
        durationMs,
        stdout: output.stdout,
        stderr: output.stderr
      }
    };
  }
  ctx.on("agent/created", async ({ agent, source, signal }) => {
    try {
      const context = await contextFor(agent);
      if (context.config.groups.SessionStart === void 0) return;
      const merged = await runPoint(
        context,
        "SessionStart",
        source,
        sessionStartPayload(agent, source, context),
        signal
      );
      const message = contextMessage(merged);
      if (message !== void 0 && typeof agent.inject === "function") agent.inject(message);
    } catch (error) {
      warn(`dsh-hooks: SessionStart 失败：${messageOf(error)}`);
    }
  });
  ctx.on("agent/pre-step", async ({ agent, messages, signal }, next) => {
    let merged;
    try {
      const context = await contextFor(agent);
      if (context.config.groups.UserPromptSubmit !== void 0 && isUnknownArray(messages) && messages.length > 0) {
        const content = messages.flatMap(
          (message2) => isObject(message2) && isUnknownArray(message2.content) ? message2.content : []
        );
        merged = await runPoint(context, "UserPromptSubmit", "", promptPayload(agent, content, context), signal);
        if (merged.decision === "deny") return { kind: "reject" };
      }
    } catch (error) {
      warn(`dsh-hooks: UserPromptSubmit 失败：${messageOf(error)}`);
      return next();
    }
    const downstream = await next();
    const message = merged === void 0 ? void 0 : contextMessage(merged);
    if (message === void 0 || !isObject(downstream) || downstream.kind !== "enter") return downstream;
    const existing = isUnknownArray(downstream.messages) ? downstream.messages : [];
    return { ...downstream, messages: [...existing, message] };
  });
  ctx.on("tools/pre-execute", async (exec, next) => {
    try {
      const context = await contextFor(agentOf(exec));
      if (context.config.groups.PreToolUse !== void 0) {
        const merged = await runPoint(context, "PreToolUse", exec.name, preToolPayload(exec, context), exec.signal);
        if (merged.decision === "deny") {
          return { kind: "deny", reason: merged.reason ?? "blocked by PreToolUse hook (dsh-hooks)" };
        }
        if (merged.decision === "ask") {
          return { kind: "ask", ...merged.reason !== void 0 ? { reason: merged.reason } : {} };
        }
      }
    } catch (error) {
      warn(`dsh-hooks: PreToolUse 失败：${messageOf(error)}`);
    }
    return next();
  });
  ctx.on("tools/post-execute", async (exec, result, next) => {
    let merged;
    let message;
    try {
      const context = await contextFor(agentOf(exec));
      if (context.config.groups.PostToolUse !== void 0) {
        merged = await runPoint(context, "PostToolUse", exec.name, postToolPayload(exec, result, context), exec.signal);
        message = contextMessage(merged);
        if (merged.decision === "deny") {
          return {
            kind: "block",
            feedback: [{ type: "text", text: merged.reason ?? "blocked by PostToolUse hook (dsh-hooks)" }],
            ...message !== void 0 ? { additionalContexts: [message] } : {}
          };
        }
      }
    } catch (error) {
      warn(`dsh-hooks: PostToolUse 失败：${messageOf(error)}`);
      return next();
    }
    const downstream = await next();
    if (message === void 0) return downstream;
    const inherited = isObject(downstream) && isUnknownArray(downstream.additionalContexts) ? downstream.additionalContexts : [];
    return { ...downstream, additionalContexts: [message, ...inherited] };
  });
  ctx.on("agent/turn-stopping", async ({ agent, signal }) => {
    try {
      const context = await contextFor(agent);
      if (context.config.groups.Stop === void 0) return;
      const sessionId = agent.session?.header?.id ?? "";
      const forced = stopForced.get(sessionId) ?? 0;
      const merged = await runPoint(context, "Stop", "", stopPayload(agent, context, forced > 0), signal);
      if (merged.decision !== "deny") {
        stopForced.delete(sessionId);
        return;
      }
      if (forced >= STOP_FORCE_LIMIT) {
        warn(`dsh-hooks: Stop hook 已连续强制续跑 ${forced} 次，达到上限 ${STOP_FORCE_LIMIT}，本次放行以免死循环`);
        stopForced.delete(sessionId);
        return;
      }
      stopForced.set(sessionId, forced + 1);
      agent.steer?.({
        id: newMessageId(),
        role: "user",
        content: [{ type: "text", text: merged.reason ?? "continue: blocked by Stop hook (dsh-hooks)" }],
        source: CONTEXT_SOURCE
      });
    } catch (error) {
      warn(`dsh-hooks: Stop 失败：${messageOf(error)}`);
    }
  });
  ctx.on("subagent/start", (info2) => {
    try {
      const agents = ctx.get("agents");
      const child = agents !== void 0 && typeof agents.get === "function" ? agents.get(info2.id) : void 0;
      if (child !== void 0) subagentChildren.set(info2.runId, child);
      const run = (async () => {
        const anchor = child?.session !== void 0 ? child : void 0;
        const cwd = anchor?.session?.header?.cwd ?? process.cwd();
        const projectRoot = await projectRootFor(cwd);
        const config = await configFor(projectRoot);
        if (config.groups.SubagentStart === void 0) return;
        const context = { cwd, projectRoot, config, sandboxPolicy: sandboxPolicyFor(anchor) };
        const merged = await runPoint(
          context,
          "SubagentStart",
          SUBAGENT_TYPE,
          subagentPayload("SubagentStart", info2, anchor, context),
          void 0
        );
        const message = contextMessage(merged);
        if (message !== void 0 && typeof child?.inject === "function") child.inject(message);
      })().catch((error) => {
        warn(`dsh-hooks: SubagentStart 失败：${messageOf(error)}`);
      });
      track(run);
    } catch (error) {
      warn(`dsh-hooks: SubagentStart 接线失败：${messageOf(error)}`);
    }
  });
  ctx.on("subagent/end", (info2) => {
    try {
      const agents = ctx.get("agents");
      const child = subagentChildren.get(info2.runId) ?? (agents !== void 0 && typeof agents.get === "function" ? agents.get(info2.id) : void 0);
      subagentChildren.delete(info2.runId);
      const run = (async () => {
        const anchor = child?.session !== void 0 ? child : void 0;
        const cwd = anchor?.session?.header?.cwd ?? process.cwd();
        const projectRoot = await projectRootFor(cwd);
        const config = await configFor(projectRoot);
        if (config.groups.SubagentStop === void 0) return;
        const context = { cwd, projectRoot, config, sandboxPolicy: sandboxPolicyFor(anchor) };
        await runPoint(
          context,
          "SubagentStop",
          SUBAGENT_TYPE,
          subagentPayload("SubagentStop", info2, anchor, context),
          void 0
        );
      })().catch((error) => {
        warn(`dsh-hooks: SubagentStop 失败：${messageOf(error)}`);
      });
      track(run);
    } catch (error) {
      warn(`dsh-hooks: SubagentStop 接线失败：${messageOf(error)}`);
    }
  });
}
export {
  apply,
  inject,
  name
};

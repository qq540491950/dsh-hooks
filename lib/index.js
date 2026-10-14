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
  const errors = [];
  if (!isObject(raw)) return { groups, skipped, errors };
  const hooksMap = isObject(raw.hooks) ? raw.hooks : raw;
  for (const event of HOOK_EVENTS) {
    const rawGroups = hooksMap[event];
    if (!Array.isArray(rawGroups)) continue;
    const parsedGroups = [];
    for (const rawGroup of rawGroups) {
      if (!isObject(rawGroup) || !Array.isArray(rawGroup.hooks)) continue;
      const commands = [];
      for (const rawHook of rawGroup.hooks) {
        if (!isObject(rawHook)) continue;
        const type = typeof rawHook.type === "string" ? rawHook.type : "command";
        if (type !== "command") {
          skipped.push({ event, type });
          continue;
        }
        const command = rawHook.command;
        if (typeof command !== "string" || command.length === 0) continue;
        const timeoutSec = typeof rawHook.timeout === "number" && rawHook.timeout > 0 ? rawHook.timeout : void 0;
        const disabled = rawHook.disabled === true;
        commands.push({
          command: substituteCommand(command, vars),
          ...timeoutSec !== void 0 ? { timeoutSec } : {},
          ...disabled ? { disabled: true } : {}
        });
      }
      if (commands.length === 0) continue;
      const matcher = event === "UserPromptSubmit" || event === "Stop" ? void 0 : typeof rawGroup.matcher === "string" ? rawGroup.matcher : void 0;
      const diagnostic = matcherDiagnostic(matcher);
      if (diagnostic !== void 0) {
        errors.push(`${diagnostic} on event ${JSON.stringify(event)}`);
        continue;
      }
      parsedGroups.push({ ...matcher !== void 0 ? { matcher } : {}, hooks: commands });
    }
    if (parsedGroups.length > 0) groups[event] = parsedGroups;
  }
  return { groups, skipped, errors };
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

// src/host/data-plane.ts
var HOOKS_ROUTE = "/api/hooks";
function groupViewOf(group) {
  const matcher = group.matcher ?? null;
  const problem = matcherDiagnostic(matcher ?? void 0);
  return {
    matcher,
    matcherOk: problem === void 0,
    matcherProblem: problem ?? null,
    hooks: group.hooks.map((hook) => ({
      command: hook.command,
      timeoutSec: hook.timeoutSec ?? null,
      defaultTimeoutSec: DEFAULT_TIMEOUT_MS / 1e3,
      disabled: hook.disabled === true
    }))
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
function buildSnapshot(inspection) {
  const files = inspection.sources.map((source) => {
    let hookCount = 0;
    for (const event of HOOK_EVENTS)
      hookCount += countsFor(source.groups, event).hookCount + countsFor(source.groups, event).disabledCount;
    return {
      kind: source.kind,
      path: source.path,
      state: source.state,
      message: source.message,
      version: source.version,
      hookCount,
      skipped: source.skipped,
      matcherErrors: source.matcherErrors
    };
  });
  let totalHooks = 0;
  let totalDisabled = 0;
  let totalGroups = 0;
  const events = HOOK_EVENTS.map((event) => {
    const count = countsFor(inspection.effective, event);
    let fromUser = 0;
    let fromProject = 0;
    for (const source of inspection.sources) {
      const hits = countsFor(source.groups, event).hookCount;
      if (source.kind === "user") fromUser += hits;
      else fromProject += hits;
    }
    const groups = (inspection.effective[event] ?? []).map(groupViewOf);
    totalHooks += count.hookCount;
    totalDisabled += count.disabledCount;
    totalGroups += groups.length;
    return {
      event,
      groups,
      hookCount: count.hookCount,
      disabledCount: count.disabledCount,
      fromProject,
      fromUser
    };
  });
  return {
    route: HOOKS_ROUTE,
    projectRoot: inspection.projectRoot,
    cwd: inspection.cwd,
    cwdSource: inspection.cwdSource,
    files,
    events,
    total: { hookCount: totalHooks, disabledCount: totalDisabled, groupCount: totalGroups },
    staleInUse: inspection.staleInUse,
    // P4b 接上写入后改成 true；在那之前页面显示只读横幅，而不是让用户点了没反应。
    capabilities: { writable: false }
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
function registerHooksRoute(connection, inspect) {
  connection.fetch.register({
    path: HOOKS_ROUTE,
    methods: ["GET"],
    // 必须在 bridge 读任何字节**之前**声明（官方契约）。body 只有几百字节，不必流式。
    requestBody: "buffered",
    async fetch(request) {
      try {
        const inspection = await inspect(sessionIdOf(request));
        return jsonResponse(200, { ok: true, data: buildSnapshot(inspection) });
      } catch (error) {
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
  const watcherAbort = new AbortController();
  let disposed = false;
  ctx.effect(
    () => () => {
      disposed = true;
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
  async function readJsonFile(path) {
    let target;
    let version;
    try {
      target = await fsSvc.resolve(path);
      const stat = await fsSvc.stat(target);
      if (stat === void 0 || stat.type !== "file") return { path, state: "absent", version: void 0 };
      version = stat.version === void 0 || stat.version === null ? void 0 : stat.version;
    } catch (error) {
      const message = messageOf(error);
      return isMissingFile(message) ? { path, state: "absent", version: void 0 } : { path, state: "error", message, version: void 0 };
    }
    let text;
    try {
      text = await fsSvc.readText(target);
    } catch (error) {
      const message = messageOf(error);
      return isMissingFile(message) ? { path, state: "absent", version } : { path, state: "error", message, version };
    }
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch (error) {
      return { path, state: "error", message: messageOf(error), version };
    }
    if (!isObject(parsed)) {
      return { path, state: "error", message: "顶层不是 JSON 对象", version };
    }
    return { path, state: "ok", raw: parsed, version };
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
      const stale = failures.length > 0 && previous !== void 0;
      if (stale) {
        infoThrottled(
          `${projectRoot}\0stale`,
          `dsh-hooks: 配置当前读不出来，继续沿用上一份可用配置（${projectPath}）`
        );
      }
      const pick = (read) => read.state === "ok" ? read.raw : void 0;
      const versionOf = (read) => read.version === void 0 || read.version === null ? void 0 : read.version;
      const userRaw = stale ? previous.userRaw : pick(userRead);
      const projectRaw = stale ? previous.projectRaw : pick(projectRead);
      const vars = { projectDir: projectRoot };
      const user = parseHookConfig(userRaw, vars);
      const project = parseHookConfig(projectRaw, vars);
      for (const skipped of [...user.skipped, ...project.skipped]) {
        warn(
          `dsh-hooks: 跳过不支持的 ${JSON.stringify(skipped.type)} handler（事件 ${skipped.event}）—— 只运行 command hook`
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
      return { groups, projectPath, userPath };
    })().catch((error) => {
      warn(`dsh-hooks: 加载 ${projectRoot} 的 hook 配置失败：${messageOf(error)}`);
      state.settled = true;
      state.expiresAt = Date.now() + NEGATIVE_TTL_MS;
      state.versions = { user: void 0, project: void 0 };
      state.hasHooks = false;
      state.stale = false;
      return { groups: {}, projectPath, userPath };
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
        const durationMs = Date.now() - started;
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
  function stopPayload(agent, context) {
    return { ...basePayload(agent, "Stop", context), stop_hook_active: false };
  }
  function subagentPayload(event, info2, child, context) {
    return {
      ...basePayload(child, event, context),
      agent_id: info2.id,
      agent_type: SUBAGENT_TYPE,
      ...event === "SubagentStop" ? { stop_hook_active: false } : {}
    };
  }
  function cwdFor(sessionId) {
    const agents = ctx.get("agents");
    if (sessionId !== void 0 && agents !== void 0 && typeof agents.get === "function") {
      try {
        const cwd = agents.get(sessionId)?.session?.header?.cwd;
        if (typeof cwd === "string" && cwd.length > 0) return { cwd, source: "session" };
      } catch {
      }
    }
    if (agents !== void 0 && typeof agents.currentInitiator === "function") {
      try {
        const cwd = agents.currentInitiator()?.session?.header?.cwd;
        if (typeof cwd === "string" && cwd.length > 0) return { cwd, source: "initiator" };
      } catch {
      }
    }
    return { cwd: null, source: "none" };
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
      matcherErrors: parsed.errors
    };
  }
  async function inspect(sessionId) {
    const { cwd, source } = cwdFor(sessionId);
    const userPath = joinPath(dshHome(), HOOKS_FILE);
    const userRead = await readJsonFile(userPath);
    if (cwd === null) {
      const userOnly = sourceViewOf("user", userRead, {});
      return {
        projectRoot: null,
        cwd: null,
        cwdSource: "none",
        sources: [userOnly],
        effective: userOnly.groups,
        staleInUse: false
      };
    }
    const projectRoot = await projectRootFor(cwd);
    const projectRead = await readJsonFile(joinPath(projectRoot, PROJECT_DIR, HOOKS_FILE));
    const vars = { projectDir: projectRoot };
    const project = sourceViewOf("project", projectRead, vars);
    const user = sourceViewOf("user", userRead, vars);
    const config = await configFor(projectRoot);
    return {
      projectRoot,
      cwd,
      cwdSource: source,
      // 展示顺序：项目级在前（它才是"这个项目"的配置）。合并顺序由 effective 决定，与这里无关。
      sources: [project, user],
      effective: config.groups,
      staleInUse: projectCache.get(projectRoot)?.state.stale === true
    };
  }
  if (ctx.connection !== void 0) {
    registerHooksRoute(ctx.connection, inspect);
  } else {
    info("dsh-hooks: 当前载体没有 connection 服务，设置页数据面未注册（hooks 本身不受影响）");
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
      const merged = await runPoint(context, "Stop", "", stopPayload(agent, context), signal);
      if (merged.decision !== "deny") {
        stopForced.delete(sessionId);
        return;
      }
      const forced = stopForced.get(sessionId) ?? 0;
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

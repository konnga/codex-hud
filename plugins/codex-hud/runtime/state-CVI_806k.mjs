import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { createHash } from "node:crypto";

//#region src/codex/context-usage.ts
const BASELINE_TOKENS = 12e3;
function clamp(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value));
}
function calculateContextUsage(usage, contextWindow) {
	if (!usage || !contextWindow || contextWindow <= 0) return null;
	const rawUsed = Math.max(0, usage.total_tokens ?? 0);
	let used;
	let total;
	if (contextWindow <= 12e3) {
		total = contextWindow;
		used = clamp(rawUsed, 0, total);
	} else {
		total = contextWindow - BASELINE_TOKENS;
		used = clamp(rawUsed - BASELINE_TOKENS, 0, total);
	}
	const percent = total > 0 ? Math.round(used / total * 100) : 0;
	return {
		used,
		total,
		percent: clamp(percent, 0, 100),
		remainingPercent: clamp(100 - percent, 0, 100),
		inputTokens: Math.max(0, (usage.input_tokens ?? 0) - (usage.cached_input_tokens ?? 0)),
		outputTokens: Math.max(0, usage.output_tokens ?? 0),
		cachedTokens: Math.max(0, usage.cached_input_tokens ?? 0)
	};
}

//#endregion
//#region src/codex/jsonl-tail.ts
var JsonlTail = class {
	offset = 0;
	remainder = "";
	inode = null;
	reset() {
		this.offset = 0;
		this.remainder = "";
		this.inode = null;
	}
	read(filePath) {
		const stat = fs.statSync(filePath);
		const replaced = this.inode !== null && stat.ino !== this.inode;
		const truncated = stat.size < this.offset;
		const reset = replaced || truncated;
		if (reset) {
			this.offset = 0;
			this.remainder = "";
		}
		this.inode = stat.ino;
		if (stat.size === this.offset) return {
			lines: [],
			reset
		};
		const length = stat.size - this.offset;
		const descriptor = fs.openSync(filePath, "r");
		try {
			const buffer = Buffer.allocUnsafe(length);
			fs.readSync(descriptor, buffer, 0, length, this.offset);
			this.offset = stat.size;
			const parts = (this.remainder + buffer.toString("utf8")).split(/\r?\n/);
			this.remainder = parts.pop() ?? "";
			return {
				lines: parts.filter(Boolean),
				reset
			};
		} finally {
			fs.closeSync(descriptor);
		}
	}
};

//#endregion
//#region src/config/constants.ts
const CONFIG_DIRECTORY_NAME = "codex-hud";
const LEGACY_CONFIG_DIRECTORY_NAME = "codex-hub";
const CONFIG_FILE_NAME = "config.json";
const KNOWN_ELEMENTS = /* @__PURE__ */ new Set([
	"project",
	"addedDirs",
	"context",
	"usage",
	"promptCache",
	"memory",
	"environment",
	"tools",
	"skills",
	"mcp",
	"agents",
	"todos",
	"turns",
	"sessionTime"
]);
const MAX_REFRESH_INTERVAL_MS = 6e4;
const MAX_PROMPT_CACHE_TTL_SECONDS = 86400;

//#endregion
//#region src/config/paths.ts
function getCodexHome(env = process.env) {
	return path.resolve(env.CODEX_HOME || path.join(os.homedir(), ".codex"));
}
function getConfigPath(env = process.env) {
	const explicit = env.CODEX_HUD_CONFIG || env.CODEX_HUB_CONFIG;
	if (explicit) return path.resolve(explicit);
	const canonical = path.join(getCodexHome(env), CONFIG_DIRECTORY_NAME, CONFIG_FILE_NAME);
	const legacy = path.join(getCodexHome(env), LEGACY_CONFIG_DIRECTORY_NAME, CONFIG_FILE_NAME);
	return !fs.existsSync(canonical) && fs.existsSync(legacy) ? legacy : canonical;
}
function getHudStateDirectory(env = process.env) {
	return path.join(getCodexHome(env), CONFIG_DIRECTORY_NAME);
}
function getLegacyStateDirectory(env = process.env) {
	return path.join(getCodexHome(env), LEGACY_CONFIG_DIRECTORY_NAME);
}

//#endregion
//#region src/runtime/timed-cache.ts
function pruneTimedCache(cache, now, maxAgeMs, maxEntries) {
	for (const [key, entry] of cache) if (now - entry.at > maxAgeMs) cache.delete(key);
	if (cache.size <= maxEntries) return;
	const oldest = [...cache.entries()].sort((left, right) => left[1].at - right[1].at).slice(0, cache.size - maxEntries);
	for (const [key] of oldest) cache.delete(key);
}
function setTimedCache(cache, key, entry, maxAgeMs, maxEntries) {
	cache.set(key, entry);
	pruneTimedCache(cache, entry.at, maxAgeMs, maxEntries);
}

//#endregion
//#region src/codex/session-endpoint.ts
const SESSION_ID_PATTERN = /^[\w-]{1,128}$/;
const LOG_DATABASE_PATTERN = /^logs(?:_(\d+))?\.sqlite$/;
const QUERY_TIMEOUT_MS = 750;
const PROCESS_SESSION_QUERY_TIMEOUT_MS = 3e3;
const ENDPOINT_CACHE_MS = 3e4;
const PROCESS_SESSION_CACHE_MS = 1e3;
const CACHE_MAX_AGE_MS$1 = 30 * 6e4;
const CACHE_MAX_ENTRIES$1 = 256;
const NEWEST_FIRST = "ORDER BY ts DESC, id DESC LIMIT 1";
const endpointCache = /* @__PURE__ */ new Map();
const processSessionCache = /* @__PURE__ */ new Map();
/**
* Codex writes its tracing log to `logs_<schema>.sqlite`; pick the newest
* schema so a Codex upgrade that bumps the suffix keeps working.
*/
function findCodexLogDatabase(codexHome = getCodexHome()) {
	let best = null;
	let entries;
	try {
		entries = fs.readdirSync(codexHome, { withFileTypes: true });
	} catch {
		return null;
	}
	for (const entry of entries) {
		const match = LOG_DATABASE_PATTERN.exec(entry.name);
		if (!match || !entry.isFile()) continue;
		const version = Number(match[1] ?? 0);
		if (!best || version > best.version) best = {
			file: path.join(codexHome, entry.name),
			version
		};
	}
	return best?.file ?? null;
}
function query(database, sql, timeout = QUERY_TIMEOUT_MS) {
	const result = spawnSync("sqlite3", [
		"-readonly",
		"-noheader",
		"-batch",
		database,
		sql
	], {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		],
		timeout
	});
	return typeof result.stdout === "string" ? result.stdout.split("\n") : [];
}
function firstUrl(value) {
	const url = value.trim().split(/[\s"]/)[0];
	return url.startsWith("http") ? url : null;
}
function endpointOrigin(value) {
	try {
		return new URL(value).origin.toLowerCase();
	} catch {
		return null;
	}
}
/** Only official OpenAI origins are authoritative for Codex subscription limits. */
function isOfficialOpenAIEndpoint(value) {
	if (!value) return false;
	try {
		const hostname = new URL(value).hostname.toLowerCase();
		return hostname === "api.openai.com" || hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com");
	} catch {
		return false;
	}
}
const INIT_ROW = [
	`SELECT 'init|' || substr(feedback_log_body, instr(feedback_log_body, 'base_url: Some("') + 16, 200)`,
	`  FROM logs`,
	` WHERE thread_id IS NULL`,
	`   AND target = 'codex_core::session::session'`,
	`   AND instr(feedback_log_body, 'base_url: Some("') > 0`
].join("\n");
/** `process_uuid` is `pid:<PID>:<uuid>`, so a PID is a prefix range on it. */
function processRange(pid) {
	return `(process_uuid >= 'pid:${pid}:' AND process_uuid < 'pid:${pid};')`;
}
/**
* Codex runs behind an npm wrapper script, so the process that logs is a child
* of the one the launcher spawned.
*/
function processFamily(pid) {
	const result = spawnSync("pgrep", ["-P", String(pid)], {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		],
		timeout: QUERY_TIMEOUT_MS
	});
	return [pid, ...typeof result.stdout === "string" ? result.stdout.split("\n").map((line) => Number.parseInt(line.trim(), 10)).filter(Number.isInteger) : []];
}
function shellSql(value) {
	return value.replaceAll("'", "''");
}
/**
* Resolve a session from the Codex process that owns it. This is needed before
* a HUD binding has a rollout path: selecting by cwd at that point can borrow a
* different concurrent session in the same project.
*/
function resolveProcessSession(codexPid, cwd, since, env = process.env, now = Date.now()) {
	if (!Number.isInteger(codexPid) || codexPid <= 0) return null;
	const cacheKey = `${getCodexHome(env)}:${codexPid}:${cwd}`;
	const cached = processSessionCache.get(cacheKey);
	if (cached && now - cached.at < PROCESS_SESSION_CACHE_MS) return cached.value ? { ...cached.value } : null;
	const remember = (value) => {
		setTimedCache(processSessionCache, cacheKey, {
			at: now,
			value
		}, CACHE_MAX_AGE_MS$1, CACHE_MAX_ENTRIES$1);
		return value ? { ...value } : null;
	};
	const database = findCodexLogDatabase(getCodexHome(env));
	if (!database) return remember(null);
	const ranges = processFamily(codexPid).map(processRange).join(" OR ");
	if (!ranges) return remember(null);
	const ids = query(database, [
		"SELECT DISTINCT thread_id",
		"  FROM logs",
		" WHERE thread_id IS NOT NULL",
		`   AND ts >= ${Math.floor(since.getTime() / 1e3) - 60}`,
		`   AND (${ranges})`,
		" ORDER BY ts ASC, id ASC;"
	].join("\n"), PROCESS_SESSION_QUERY_TIMEOUT_MS).filter((id) => SESSION_ID_PATTERN.test(id.trim()));
	if (ids.length === 0) return remember(null);
	const candidates = ids.map((id) => `'${shellSql(id.trim())}'`).join(",");
	const rows = query(path.join(getCodexHome(env), "state_5.sqlite"), [
		"SELECT id || '|' || rollout_path",
		"  FROM threads",
		` WHERE id IN (${candidates})`,
		`   AND cwd = '${shellSql(path.resolve(cwd))}'`,
		"   AND (thread_source = 'user' OR thread_source IS NULL)",
		"   AND (agent_path IS NULL OR agent_path = '')",
		" ORDER BY created_at_ms ASC, id ASC",
		" LIMIT 1;"
	].join("\n"), PROCESS_SESSION_QUERY_TIMEOUT_MS);
	for (const row of rows) {
		const separator = row.indexOf("|");
		if (separator < 0) continue;
		const sessionId = row.slice(0, separator);
		const rolloutPath = row.slice(separator + 1);
		if (SESSION_ID_PATTERN.test(sessionId) && fs.existsSync(rolloutPath)) return remember({
			sessionId,
			rolloutPath
		});
	}
	return remember(null);
}
/**
* The endpoint of a Codex process that has not created a session yet. Codex
* writes no rollout until the first message, so between launch and that message
* the process is the only thing the HUD can key on.
*
* `since` bounds the scan to this launch: the timestamp column is the indexed
* one, and without a bound the lookup walks every threadless row ever logged.
*/
function resolveProcessEndpoint(codexPid, since, env = process.env, now = Date.now()) {
	if (!Number.isInteger(codexPid) || codexPid <= 0) return null;
	const codexHome = getCodexHome(env);
	const cacheKey = `${codexHome}:pid:${codexPid}`;
	const cached = endpointCache.get(cacheKey);
	if (cached && now - cached.at < ENDPOINT_CACHE_MS) return cached.value ? { ...cached.value } : null;
	const database = findCodexLogDatabase(codexHome);
	const ranges = database ? processFamily(codexPid).map(processRange).join(" OR ") : "";
	const lines = ranges ? query(database, [
		INIT_ROW,
		`   AND ts >= ${Math.floor(since.getTime() / 1e3) - 60}`,
		`   AND (${ranges})`,
		` ${NEWEST_FIRST};`
	].join("\n")) : [];
	let value = null;
	for (const line of lines) {
		const url = line.startsWith("init|") ? firstUrl(line.slice(5)) : null;
		if (url) {
			value = {
				url,
				source: "log-init"
			};
			break;
		}
	}
	sweep(now);
	setTimedCache(endpointCache, cacheKey, {
		at: now,
		value
	}, CACHE_MAX_AGE_MS$1, CACHE_MAX_ENTRIES$1);
	return value ? { ...value } : null;
}
function sweep(now) {
	pruneTimedCache(endpointCache, now, CACHE_MAX_AGE_MS$1, CACHE_MAX_ENTRIES$1);
	pruneTimedCache(processSessionCache, now, CACHE_MAX_AGE_MS$1, CACHE_MAX_ENTRIES$1);
}
/**
* The session id doubles as the tracing `thread_id`, so Codex's own log is the
* only record of which endpoint a session really used: `config.toml` may have
* been rewritten since, and the rollout stores just the provider id.
*
* Both queries are index-backed. `AND thread_id IS NULL` on the second one is
* load-bearing for speed, not only correctness: without it the lookup degrades
* to a full scan of a multi-hundred-megabyte table on the render path.
*/
function resolveSessionEndpoint(sessionId, env = process.env, now = Date.now()) {
	if (!SESSION_ID_PATTERN.test(sessionId)) return null;
	const codexHome = getCodexHome(env);
	const cacheKey = `${codexHome}:${sessionId}`;
	const cached = endpointCache.get(cacheKey);
	if (cached && now - cached.at < ENDPOINT_CACHE_MS) return cached.value ? { ...cached.value } : null;
	const remember = (value) => {
		sweep(now);
		setTimedCache(endpointCache, cacheKey, {
			at: now,
			value
		}, CACHE_MAX_AGE_MS$1, CACHE_MAX_ENTRIES$1);
		return value ? { ...value } : null;
	};
	const database = findCodexLogDatabase(codexHome);
	if (!database) return remember(null);
	const lines = query(database, [
		`SELECT 'request|' || substr(feedback_log_body, instr(feedback_log_body, 'url=') + 4, 200)`,
		`  FROM logs`,
		` WHERE thread_id = '${sessionId}'`,
		`   AND target IN ('codex_http_client::default_client', 'codex_http_client::client')`,
		`   AND instr(feedback_log_body, 'url=') > 0`,
		` ${NEWEST_FIRST};`,
		INIT_ROW,
		`   AND process_uuid = (SELECT process_uuid FROM logs WHERE thread_id = '${sessionId}' ${NEWEST_FIRST})`,
		`   AND ts <= (SELECT min(ts) FROM logs WHERE thread_id = '${sessionId}')`,
		` ${NEWEST_FIRST};`
	].join("\n"));
	let fallback = null;
	for (const line of lines) {
		const separator = line.indexOf("|");
		if (separator < 0) continue;
		const tag = line.slice(0, separator);
		const url = firstUrl(line.slice(separator + 1));
		if (!url) continue;
		if (tag === "request") return remember({
			url,
			source: "log-request"
		});
		if (tag === "init" && !fallback) fallback = {
			url,
			source: "log-init"
		};
	}
	return remember(fallback);
}

//#endregion
//#region src/codex/rate-limits.ts
function numberValue$1(...values) {
	for (const value of values) if (typeof value === "number" && Number.isFinite(value)) return value;
	return null;
}
function resetDate(value) {
	if (typeof value === "number" && Number.isFinite(value)) {
		const milliseconds = value > 1e10 ? value : value * 1e3;
		const date = new Date(milliseconds);
		return Number.isNaN(date.getTime()) ? null : date;
	}
	if (typeof value === "string" && value) {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date;
	}
	return null;
}
function labelForWindow(window, fallback) {
	const minutes = numberValue$1(window.window_minutes);
	if (minutes === null) return fallback;
	if (minutes % 10080 === 0) return `${minutes / 10080}w`;
	if (minutes % 1440 === 0) return `${minutes / 1440}d`;
	if (minutes % 60 === 0) return `${minutes / 60}h`;
	return `${minutes}m`;
}
function normalizeWindow(value, fallbackLabel, individual = false) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const window = value;
	const rawPercent = individual ? numberValue$1(typeof window.remaining_percent === "number" ? 100 - window.remaining_percent : null, window.used_percent, window.used_percentage, window.utilization) : numberValue$1(window.used_percent, window.used_percentage, window.utilization);
	const percent = rawPercent === null ? null : Math.min(100, Math.max(0, rawPercent));
	return {
		label: labelForWindow(window, fallbackLabel),
		percent,
		resetAt: resetDate(window.resets_at ?? window.reset_at),
		windowMinutes: numberValue$1(window.window_minutes)
	};
}
function normalizeRateLimits(raw) {
	if (!raw) return null;
	const credits = raw.credits && typeof raw.credits === "object" ? raw.credits : null;
	const balance = credits && typeof credits.balance === "string" ? credits.balance : null;
	return {
		primary: normalizeWindow(raw.primary, "limit"),
		secondary: normalizeWindow(raw.secondary, "limit"),
		individual: normalizeWindow(raw.individual_limit, "spend", true),
		planType: typeof raw.plan_type === "string" ? raw.plan_type : null,
		balanceLabel: balance,
		limitReachedType: typeof raw.rate_limit_reached_type === "string" ? raw.rate_limit_reached_type : raw.spend_control_reached === true ? "spend_control_reached" : null
	};
}
function sameWindow(left, right) {
	if (left.windowMinutes !== null && left.windowMinutes !== void 0 && right.windowMinutes !== null && right.windowMinutes !== void 0) return left.windowMinutes === right.windowMinutes;
	if (left.label !== "limit" && right.label !== "limit" && left.label === right.label) return true;
	return Boolean(left.resetAt && right.resetAt && Math.abs(left.resetAt.getTime() - right.resetAt.getTime()) <= 6e4);
}
function mergeWindows(current, observed) {
	const windows = [current.primary, current.secondary].filter((window) => Boolean(window));
	for (const window of [observed.primary, observed.secondary]) {
		if (!window) continue;
		const index = windows.findIndex((candidate) => sameWindow(candidate, window));
		if (index >= 0) windows[index] = window;
		else windows.push(window);
	}
	windows.sort((left, right) => (left.windowMinutes ?? Number.MAX_SAFE_INTEGER) - (right.windowMinutes ?? Number.MAX_SAFE_INTEGER));
	return [windows[0] ?? null, windows[1] ?? null];
}
/** Merge a newer account-wide observation without confusing its window slots. */
function mergeUsageData(current, observed) {
	if (!current) return observed;
	if (!observed) return current;
	const [primary, secondary] = mergeWindows(current, observed);
	return {
		primary,
		secondary,
		individual: observed.individual ?? current.individual,
		planType: observed.planType ?? current.planType,
		balanceLabel: observed.balanceLabel ?? current.balanceLabel,
		limitReachedType: observed.limitReachedType ?? current.limitReachedType
	};
}
/** Third-party relays can imitate Codex limit events, but those are not the user's OpenAI subscription limits. */
function trustedUsageDataForEndpoint(endpoint, current, observed) {
	return isOfficialOpenAIEndpoint(endpoint) ? mergeUsageData(current, observed) : null;
}

//#endregion
//#region src/codex/rollout-parser.ts
const MAX_TARGET_LENGTH = 80;
const IMAGE_EXTENSIONS = /* @__PURE__ */ new Set([
	".png",
	".jpg",
	".jpeg",
	".webp",
	".gif",
	".bmp",
	".tif",
	".tiff"
]);
const IMAGE_PATH_PATTERN = /(?:^|[\s"'`(])(\/[^\s"'`),;]+\.(?:png|jpe?g|webp|gif|bmp|tiff?)|[a-z]:[\\/][^\s"'`),;]+\.(?:png|jpe?g|webp|gif|bmp|tiff?))(?:$|[\s"'`),;.])/gi;
function initialState() {
	return {
		session: null,
		context: null,
		usage: null,
		sessionTokens: null,
		tools: [],
		images: [],
		skills: [],
		mcpServers: [],
		todos: [],
		goal: null,
		conversationTurns: [],
		compactCount: 0
	};
}
function safeDate$1(value, fallback) {
	if (typeof value !== "string" && typeof value !== "number") return fallback;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? fallback : date;
}
function policyLabel(value) {
	if (typeof value === "string") return value;
	if (value && typeof value === "object" && !Array.isArray(value)) {
		if ("type" in value && typeof value.type === "string") return value.type;
		if ("granular" in value) return "granular";
	}
}
function parseArguments(value) {
	if (!value) return null;
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
function truncate(value) {
	const normalized = Array.from(value, (character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint <= 31 || codePoint === 127 ? " " : character;
	}).join("").replace(/\s+/g, " ").trim();
	return normalized.length <= MAX_TARGET_LENGTH ? normalized : `${normalized.slice(0, MAX_TARGET_LENGTH - 1)}…`;
}
function nestedToolName(input) {
	if (!input) return null;
	return /\btools\.(\w+)/.exec(input)?.[1] ?? null;
}
function displayToolName(payload) {
	if (payload.name === "exec") return nestedToolName(payload.input) ?? payload.name;
	return payload.name || "tool";
}
function toolTarget(payload) {
	const args = parseArguments(payload.arguments);
	if (args) {
		const target = [
			args.file_path,
			args.path,
			args.file,
			args.pattern,
			args.command,
			args.cmd,
			args.description,
			args.question,
			args.target
		].find((value) => typeof value === "string");
		if (typeof target === "string") return truncate(target);
	}
	if (payload.name === "exec") return nestedToolName(payload.input) ? void 0 : payload.input ? truncate(payload.input) : void 0;
}
function isErrorOutput(output) {
	if (output && typeof output === "object" && !Array.isArray(output)) {
		const record = output;
		return record.success === false || record.status === "error" || record.is_error === true;
	}
	return false;
}
function imageIsAvailable(value) {
	try {
		return fs.statSync(value).isFile() && IMAGE_EXTENSIONS.has(path.extname(value).toLowerCase());
	} catch {
		return false;
	}
}
function normalizeImagePath(value) {
	const candidate = value.trim().replace(/[.,;)]+$/, "");
	if (!path.isAbsolute(candidate) || !IMAGE_EXTENSIONS.has(path.extname(candidate).toLowerCase())) return null;
	return path.normalize(candidate);
}
function imagePathsFromValue(value) {
	const result = /* @__PURE__ */ new Set();
	const visit = (current, depth) => {
		if (depth > 3 || result.size >= 20) return;
		if (typeof current === "string") {
			try {
				const parsed = JSON.parse(current);
				if (parsed !== current) visit(parsed, depth + 1);
			} catch {}
			for (const match of current.matchAll(IMAGE_PATH_PATTERN)) {
				const normalized = normalizeImagePath(match[1]);
				if (normalized) result.add(normalized);
			}
			const direct = normalizeImagePath(current);
			if (direct) result.add(direct);
			return;
		}
		if (Array.isArray(current)) {
			current.forEach((item) => visit(item, depth + 1));
			return;
		}
		if (current && typeof current === "object") Object.values(current).forEach((item) => visit(item, depth + 1));
	};
	visit(value, 0);
	return [...result];
}
function imageSourceForTool(name) {
	if (name === "view_image") return "view_image";
	return /image|img|picture|photo/i.test(name) && /imagegen|generate|create|edit|save|output/i.test(name) ? "generated_image" : null;
}
function registerImagePaths(images, paths, source, createdAt, callId) {
	for (const imagePath of paths) if (!images.has(imagePath)) images.set(imagePath, {
		path: imagePath,
		source,
		createdAt,
		callId
	});
}
function toSessionTokens(usage) {
	if (!usage) return null;
	return {
		inputTokens: Math.max(0, usage.input_tokens ?? 0),
		outputTokens: Math.max(0, usage.output_tokens ?? 0),
		reasoningOutputTokens: Math.max(0, usage.reasoning_output_tokens ?? 0),
		cachedInputTokens: Math.max(0, usage.cached_input_tokens ?? 0),
		cacheWriteInputTokens: Math.max(0, usage.cache_write_input_tokens ?? 0),
		totalTokens: Math.max(0, usage.total_tokens ?? 0)
	};
}
function normalizePlan(plan) {
	if (!Array.isArray(plan)) return [];
	return plan.flatMap((item) => {
		if (typeof item.step !== "string" || !item.step.trim()) return [];
		const status = item.status === "in_progress" ? "in_progress" : item.status === "completed" ? "completed" : "pending";
		return [{
			content: truncate(item.step),
			status
		}];
	});
}
function normalizeGoal(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const goal = value;
	return {
		objective: typeof goal.objective === "string" ? truncate(goal.objective) : void 0,
		status: typeof goal.status === "string" ? goal.status : void 0,
		tokenBudget: typeof (goal.tokenBudget ?? goal.token_budget) === "number" ? goal.tokenBudget ?? goal.token_budget : null,
		tokensUsed: typeof (goal.tokensUsed ?? goal.tokens_used) === "number" ? goal.tokensUsed ?? goal.tokens_used : void 0,
		timeUsedSeconds: typeof (goal.timeUsedSeconds ?? goal.time_used_seconds) === "number" ? goal.timeUsedSeconds ?? goal.time_used_seconds : void 0
	};
}
var RolloutParser = class {
	tail = new JsonlTail();
	state = initialState();
	filePath = null;
	runningTools = /* @__PURE__ */ new Map();
	images = /* @__PURE__ */ new Map();
	latestTokenUsage = null;
	setFile(filePath) {
		if (filePath === this.filePath) return;
		this.filePath = filePath;
		this.reset();
	}
	reset() {
		this.tail.reset();
		this.state = initialState();
		this.runningTools.clear();
		this.images.clear();
		this.latestTokenUsage = null;
	}
	getState() {
		this.state.images = Array.from(this.images.values()).filter((image) => imageIsAvailable(image.path));
		return structuredClone(this.state);
	}
	parse() {
		if (!this.filePath) return this.getState();
		const result = this.tail.read(this.filePath);
		if (result.reset) {
			this.state = initialState();
			this.runningTools.clear();
			this.images.clear();
			this.latestTokenUsage = null;
		}
		for (const line of result.lines) this.parseLine(line);
		return this.getState();
	}
	parseLine(line) {
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			return;
		}
		const timestamp = safeDate$1(entry.timestamp, /* @__PURE__ */ new Date());
		if (entry.type === "session_meta") {
			this.onSessionMeta(entry.payload, timestamp);
			return;
		}
		if (entry.type === "turn_context") {
			this.onTurnContext(entry.payload);
			return;
		}
		if (entry.type === "response_item") {
			this.onResponseItem(entry.payload, timestamp);
			return;
		}
		if (entry.type === "event_msg") this.onEvent(entry.payload, timestamp);
	}
	onSessionMeta(payload, timestamp) {
		const id = payload.session_id ?? payload.id;
		if (!id || !this.filePath) return;
		this.state.session = {
			id,
			rolloutPath: this.filePath,
			startTime: safeDate$1(payload.timestamp, timestamp),
			cwd: payload.cwd ?? process.cwd(),
			originator: payload.originator,
			cliVersion: payload.cli_version,
			modelProvider: payload.model_provider,
			source: payload.thread_source ?? payload.source
		};
	}
	onTurnContext(payload) {
		if (!this.state.session) return;
		this.state.session.turnId = payload.turn_id;
		this.state.session.cwd = payload.cwd ?? this.state.session.cwd;
		this.state.session.workspaceRoots = payload.workspace_roots ?? this.state.session.workspaceRoots;
		this.state.session.model = payload.model ?? payload.collaboration_mode?.settings?.model ?? this.state.session.model;
		this.state.session.reasoningEffort = payload.effort ?? payload.reasoning_effort ?? payload.collaboration_mode?.settings?.reasoning_effort ?? this.state.session.reasoningEffort;
		this.state.session.collaborationMode = payload.collaboration_mode?.mode;
		this.state.session.approvalPolicy = policyLabel(payload.approval_policy);
		this.state.session.sandboxMode = policyLabel(payload.sandbox_policy);
		this.state.session.permissionProfile = policyLabel(payload.permission_profile);
	}
	onResponseItem(payload, timestamp) {
		if ((payload.type === "function_call" || payload.type === "custom_tool_call") && payload.name) {
			const id = payload.call_id ?? payload.id ?? `${payload.name}-${timestamp.getTime()}`;
			const tool = {
				id,
				name: displayToolName(payload),
				target: toolTarget(payload),
				status: "running",
				startTime: timestamp
			};
			this.runningTools.set(id, tool);
			this.state.tools.push(tool);
			this.state.tools = this.state.tools.slice(-100);
			const imageSource = imageSourceForTool(payload.name);
			if (imageSource) registerImagePaths(this.images, imagePathsFromValue(payload.arguments), imageSource, timestamp, id);
			if (tool.name === "Skill" && tool.target) this.state.skills = Array.from(/* @__PURE__ */ new Set([...this.state.skills, tool.target]));
			const mcp = /^mcp__(.+?)__/.exec(tool.name)?.[1];
			if (mcp) this.state.mcpServers = Array.from(/* @__PURE__ */ new Set([...this.state.mcpServers, mcp]));
			return;
		}
		if ((payload.type === "function_call_output" || payload.type === "custom_tool_call_output") && payload.call_id) {
			const running = this.runningTools.get(payload.call_id);
			if (!running) return;
			running.status = isErrorOutput(payload.output) ? "error" : "completed";
			running.endTime = timestamp;
			running.durationMs = Math.max(0, timestamp.getTime() - running.startTime.getTime());
			const imageSource = imageSourceForTool(running.name);
			if (imageSource) registerImagePaths(this.images, imagePathsFromValue(payload.output), imageSource, timestamp, payload.call_id);
			this.runningTools.delete(payload.call_id);
			return;
		}
		if (payload.type === "message" && payload.role === "assistant" && this.state.session) {
			registerImagePaths(this.images, imagePathsFromValue(payload.content), "generated_image", timestamp, payload.id);
			this.state.session.lastResponseAt = timestamp;
		}
	}
	onEvent(payload, timestamp) {
		if (payload.type === "mcp_tool_call_end" || payload.type === "mcp_tool_call_begin") {
			const invocation = payload.invocation;
			const server = invocation && typeof invocation === "object" && !Array.isArray(invocation) ? invocation.server : null;
			if (typeof server === "string" && server.trim()) this.state.mcpServers = Array.from(/* @__PURE__ */ new Set([...this.state.mcpServers, server.trim()]));
			return;
		}
		if (payload.type === "user_message" && typeof payload.message === "string") {
			const userMessage = payload.message.trim();
			if (userMessage) {
				const turnId = payload.turn_id ?? this.state.session?.turnId;
				this.state.conversationTurns.push({
					id: turnId ?? `turn-${String(this.state.conversationTurns.length + 1)}`,
					turnId,
					startedAt: timestamp,
					userMessage,
					assistantMessage: ""
				});
			}
			return;
		}
		if (payload.type === "agent_message" && typeof payload.message === "string") {
			const turn = this.state.conversationTurns.at(-1);
			const message = payload.message.trim();
			if (!turn || !message) return;
			if (payload.phase === "final_answer") {
				turn.assistantMessage = message;
				turn.assistantPhase = payload.phase;
			} else if (turn.assistantPhase !== "final_answer") {
				turn.assistantMessage = turn.assistantMessage ? `${turn.assistantMessage}\n\n${message}` : message;
				turn.assistantPhase = payload.phase;
			}
			return;
		}
		if (payload.type === "token_count") {
			this.latestTokenUsage = payload.info ?? this.latestTokenUsage;
			this.state.context = calculateContextUsage(this.latestTokenUsage?.last_token_usage, this.latestTokenUsage?.model_context_window);
			this.state.sessionTokens = toSessionTokens(this.latestTokenUsage?.total_token_usage);
			this.state.usage = normalizeRateLimits(payload.rate_limits) ?? this.state.usage;
			return;
		}
		if (payload.type === "plan_update") {
			this.state.todos = normalizePlan(payload.plan);
			return;
		}
		if (payload.type === "thread_goal_updated") {
			this.state.goal = normalizeGoal(payload.goal);
			return;
		}
		if (payload.type === "context_compacted") {
			this.state.compactCount += 1;
			return;
		}
		if (!this.state.session) return;
		if (payload.type === "task_started") {
			this.state.session.lastTurnStartedAt = safeDate$1(payload.started_at, timestamp);
			if (typeof payload.model_context_window === "number") this.latestTokenUsage = {
				total_token_usage: this.latestTokenUsage?.total_token_usage ?? {},
				last_token_usage: this.latestTokenUsage?.last_token_usage ?? {},
				model_context_window: payload.model_context_window
			};
			return;
		}
		if (payload.type === "task_complete" || payload.type === "turn_aborted") {
			this.state.session.lastTurnCompletedAt = safeDate$1(payload.completed_at, timestamp);
			this.state.session.lastTurnDurationMs = typeof payload.duration_ms === "number" ? payload.duration_ms : void 0;
			this.state.session.timeToFirstTokenMs = typeof payload.time_to_first_token_ms === "number" ? payload.time_to_first_token_ms : void 0;
			const outputTokens = this.latestTokenUsage?.last_token_usage?.output_tokens;
			const generationMs = (this.state.session.lastTurnDurationMs ?? 0) - (this.state.session.timeToFirstTokenMs ?? 0);
			const outputSpeed = typeof outputTokens === "number" && outputTokens >= 0 && generationMs > 0 ? outputTokens / (generationMs / 1e3) : void 0;
			this.state.session.outputTokensPerSecond = outputSpeed !== void 0 && outputSpeed <= 2e3 ? outputSpeed : void 0;
		}
	}
};

//#endregion
//#region src/codex/session-finder.ts
const MAX_SESSION_META_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 336 * 60 * 60 * 1e3;
function realPath(value) {
	try {
		return fs.realpathSync.native(value);
	} catch {
		return path.resolve(value);
	}
}
function normalizedPath(value) {
	const resolved = realPath(value);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function isWithinProject(candidateCwd, targetCwd) {
	const candidate = normalizedPath(candidateCwd);
	const target = normalizedPath(targetCwd);
	return candidate === target || candidate.startsWith(`${target}${path.sep}`);
}
function readFirstLine(filePath) {
	const descriptor = fs.openSync(filePath, "r");
	try {
		const chunks = [];
		let total = 0;
		let position = 0;
		while (total < MAX_SESSION_META_BYTES) {
			const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_SESSION_META_BYTES - total));
			const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, position);
			if (bytesRead === 0) break;
			const chunk = buffer.subarray(0, bytesRead);
			const newline = chunk.indexOf(10);
			if (newline >= 0) {
				chunks.push(chunk.subarray(0, newline));
				return Buffer.concat(chunks).toString("utf8").replace(/\r$/, "");
			}
			chunks.push(chunk);
			total += bytesRead;
			position += bytesRead;
		}
		return chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : null;
	} finally {
		fs.closeSync(descriptor);
	}
}
function collectRolloutPaths(directory, output) {
	let entries;
	try {
		entries = fs.readdirSync(directory, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) collectRolloutPaths(entryPath, output);
		else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) output.push(entryPath);
	}
}
function isSubagentSource(source) {
	if (!source || typeof source === "string") return typeof source === "string" && source.toLowerCase().includes("subagent");
	return "subagent" in source || "thread_spawn" in source;
}
function threadSpawnMetadata(source) {
	if (!source || typeof source !== "object" || Array.isArray(source)) return null;
	const sourceRecord = source;
	const subagent = sourceRecord.subagent;
	if (subagent && typeof subagent === "object" && !Array.isArray(subagent)) {
		const threadSpawn = subagent.thread_spawn;
		if (threadSpawn && typeof threadSpawn === "object" && !Array.isArray(threadSpawn)) return threadSpawn;
	}
	const direct = sourceRecord.thread_spawn;
	return direct && typeof direct === "object" && !Array.isArray(direct) ? direct : null;
}
function readSessionCandidate(filePath) {
	try {
		const line = readFirstLine(filePath);
		if (!line) return null;
		const entry = JSON.parse(line);
		if (entry.type !== "session_meta" || !entry.payload) return null;
		const payload = entry.payload;
		const sessionId = payload.session_id ?? payload.id;
		const cwd = payload.cwd;
		if (typeof sessionId !== "string" || typeof cwd !== "string") return null;
		const stat = fs.statSync(filePath);
		const startTime = new Date(typeof payload.timestamp === "string" ? payload.timestamp : entry.timestamp ?? stat.mtimeMs);
		const source = payload.thread_source ?? payload.source;
		const threadSpawn = threadSpawnMetadata(source);
		return {
			path: filePath,
			sessionId,
			cwd,
			startTime: Number.isNaN(startTime.getTime()) ? new Date(stat.mtimeMs) : startTime,
			mtimeMs: stat.mtimeMs,
			source,
			parentThreadId: typeof (payload.parent_thread_id ?? threadSpawn?.parent_thread_id) === "string" ? payload.parent_thread_id ?? threadSpawn?.parent_thread_id : void 0,
			agentPath: typeof (payload.agent_path ?? threadSpawn?.agent_path) === "string" ? payload.agent_path ?? threadSpawn?.agent_path : void 0,
			agentNickname: typeof threadSpawn?.agent_nickname === "string" ? threadSpawn.agent_nickname : void 0,
			agentRole: typeof threadSpawn?.agent_role === "string" ? threadSpawn.agent_role : void 0
		};
	} catch {
		return null;
	}
}
function listSessionCandidates(codexHome = getCodexHome()) {
	const paths = [];
	collectRolloutPaths(path.join(codexHome, "sessions"), paths);
	return paths.flatMap((filePath) => {
		const candidate = readSessionCandidate(filePath);
		return candidate ? [candidate] : [];
	});
}
function findActiveSession(options) {
	const now = options.now ?? /* @__PURE__ */ new Date();
	const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
	const launchedAfterMs = options.launchedAfter?.getTime() ?? 0;
	const allowModifiedBeforeLaunch = options.allowModifiedBeforeLaunch ?? true;
	return listSessionCandidates(options.codexHome).filter((candidate) => !isSubagentSource(candidate.source)).filter((candidate) => isWithinProject(candidate.cwd, options.cwd)).filter((candidate) => candidate.mtimeMs >= now.getTime() - maxAgeMs).filter((candidate) => candidate.startTime.getTime() >= launchedAfterMs || allowModifiedBeforeLaunch && candidate.mtimeMs >= launchedAfterMs).sort((left, right) => right.mtimeMs - left.mtimeMs)[0] ?? null;
}

//#endregion
//#region src/codex/external-usage.ts
const MAX_BALANCE_LABEL = 80;
const MAX_RESPONSE_BYTES = 64 * 1024;
const WRITE_HEARTBEAT_MS = 6e4;
const WRITE_CACHE_MAX_AGE_MS = 30 * 6e4;
const WRITE_CACHE_MAX_ENTRIES = 64;
const QUERY_FAILURE_RETRY_MS = 15e3;
const QUERY_STALE_MAX_MS = 15 * 6e4;
const QUERY_CACHE_MAX_AGE_MS = 1440 * 6e4;
const QUERY_CACHE_MAX_ENTRIES = 64;
const lastWrites = /* @__PURE__ */ new Map();
const queryCache = /* @__PURE__ */ new Map();
const inFlightQueries = /* @__PURE__ */ new Map();
function safePercent(value) {
	return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null;
}
function safeReset(value) {
	if (typeof value !== "string" && typeof value !== "number") return null;
	const date = new Date(typeof value === "number" && value < 1e10 ? value * 1e3 : value);
	return Number.isNaN(date.getTime()) ? null : date;
}
function sanitizeLabel(value) {
	if (typeof value !== "string") return null;
	const label = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
	return label ? label.slice(0, MAX_BALANCE_LABEL) : null;
}
function formatCredits(value) {
	return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
function usageData(balanceLabel) {
	return {
		primary: null,
		secondary: null,
		individual: null,
		planType: null,
		balanceLabel,
		limitReachedType: null
	};
}
function credentialFingerprint(value) {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
async function responseJson(response) {
	const contentLength = response.headers.get("content-length");
	if (contentLength) {
		const declaredLength = Number(contentLength);
		if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) return null;
	}
	try {
		if (!response.body) {
			const text = await response.text();
			if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) return null;
			return JSON.parse(text);
		}
		const reader = response.body.getReader();
		const chunks = [];
		let size = 0;
		try {
			while (true) {
				const result = await reader.read();
				if (result.done) break;
				size += result.value.byteLength;
				if (size > MAX_RESPONSE_BYTES) {
					await reader.cancel();
					return null;
				}
				chunks.push(result.value);
			}
		} finally {
			reader.releaseLock();
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return null;
	}
}
function newApiUsage(body, quotaPerCredit) {
	const response = body;
	const quota = response?.success === true && typeof response.data?.quota === "number" && Number.isFinite(response.data.quota) ? response.data.quota : null;
	if (quota === null) return null;
	const group = sanitizeLabel(response.data?.group);
	return usageData(`${group ? `${group}: ` : ""}$${formatCredits(Math.max(0, quota) / quotaPerCredit)}`);
}
function sub2ApiUsage(body) {
	const response = body;
	const balance = response?.code === 0 && typeof response.data?.balance === "number" && Number.isFinite(response.data.balance) ? response.data.balance : null;
	if (balance === null) return null;
	return usageData(`$${formatCredits(Math.max(0, balance))}`);
}
function generalUsage(body) {
	const response = body;
	if (response?.isValid === false) return null;
	const rawBalance = response?.remaining ?? response?.balance;
	const balance = typeof rawBalance === "number" && Number.isFinite(rawBalance) ? rawBalance : null;
	if (balance === null) return null;
	const unit = sanitizeLabel(response.unit) ?? "USD";
	const planName = sanitizeLabel(response.planName);
	const amount = formatCredits(Math.max(0, balance));
	const formatted = unit === "USD" ? `$${amount}` : `${amount} ${unit}`;
	return usageData(planName ? `${planName}: ${formatted}` : formatted);
}
function generalQueryUrls(endpoint, origin) {
	const urls = [`${origin}/user/balance`];
	try {
		const usageUrl = `${origin}${new URL(endpoint).pathname.replace(/\/(?:responses|chat\/completions)\/?$/, "")}/usage`.replace(/([^:]\/)\/+/, "$1");
		if (!urls.includes(usageUrl)) urls.push(usageUrl);
	} catch {}
	return urls;
}
function configuredQuery(queries, endpoint) {
	if (!endpoint) return null;
	let origin;
	try {
		origin = new URL(endpoint).origin.toLowerCase();
	} catch {
		return null;
	}
	if (isOfficialOpenAIEndpoint(origin)) return null;
	const query = queries.find((query) => query.enabled && query.origin === origin) ?? queries.find((query) => query.enabled && query.origin === "*" && query.template === "general");
	return query ? {
		...query,
		origin
	} : null;
}
function inferenceApiKey(env) {
	if (env.OPENAI_API_KEY) return env.OPENAI_API_KEY;
	try {
		const auth = JSON.parse(fs.readFileSync(path.join(getCodexHome(env), "auth.json"), "utf8"));
		return typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY ? auth.OPENAI_API_KEY : null;
	} catch {
		return null;
	}
}
function configuredQueryContext(queries, endpoint, env) {
	const query = configuredQuery(queries, endpoint);
	if (!query || !endpoint) return null;
	const credentialEnv = query.template === "general" ? query.apiKeyEnv : query.accessTokenEnv;
	const accessToken = query.template === "general" ? credentialEnv ? env[credentialEnv] : inferenceApiKey(env) : env[credentialEnv];
	const userId = env[query.userIdEnv];
	if (!accessToken || query.template === "newApi" && !userId) return null;
	return {
		query,
		endpoint,
		accessToken,
		userId,
		cacheKey: [
			query.origin,
			query.template,
			credentialEnv,
			query.userIdEnv,
			query.quotaPerCredit,
			credentialFingerprint(accessToken),
			query.template === "newApi" ? credentialFingerprint(userId) : ""
		].join(":")
	};
}
function cachedQueryValue(cached, now) {
	return cached?.value && now - cached.valueAt <= QUERY_STALE_MAX_MS ? structuredClone(cached.value) : null;
}
async function performConfiguredQuery(context, now) {
	const { query, endpoint, accessToken, userId, cacheKey } = context;
	const cached = queryCache.get(cacheKey);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 3e3);
	let value = null;
	try {
		const urls = query.template === "general" ? generalQueryUrls(endpoint, query.origin) : [`${query.origin}${query.template === "newApi" ? "/api/user/self" : "/api/v1/auth/me"}`];
		for (const url of urls) {
			const response = await fetch(url, {
				headers: {
					"Accept": "application/json",
					"Authorization": `Bearer ${accessToken}`,
					"User-Agent": "codex-hud/0.5",
					...query.template === "newApi" ? { "New-Api-User": userId } : {}
				},
				redirect: "error",
				signal: controller.signal
			});
			if (!response.ok) continue;
			const body = await responseJson(response);
			if (body === null) continue;
			value = query.template === "general" ? generalUsage(body) : query.template === "newApi" ? newApiUsage(body, query.quotaPerCredit) : sub2ApiUsage(body);
			if (value) break;
		}
	} catch {} finally {
		clearTimeout(timeout);
	}
	if (value) {
		setTimedCache(queryCache, cacheKey, {
			at: now,
			valueAt: now,
			value: structuredClone(value)
		}, QUERY_CACHE_MAX_AGE_MS, QUERY_CACHE_MAX_ENTRIES);
		return structuredClone(value);
	}
	setTimedCache(queryCache, cacheKey, {
		at: now,
		valueAt: cached?.valueAt ?? 0,
		failedAt: now,
		value: cached?.value ? structuredClone(cached.value) : null
	}, QUERY_CACHE_MAX_AGE_MS, QUERY_CACHE_MAX_ENTRIES);
	return cachedQueryValue(cached, now);
}
function startConfiguredQuery(context, now) {
	const existing = inFlightQueries.get(context.cacheKey);
	if (existing) return existing;
	const promise = performConfiguredQuery(context, now).finally(() => {
		inFlightQueries.delete(context.cacheKey);
	});
	inFlightQueries.set(context.cacheKey, promise);
	return promise;
}
/**
* Query a matching relay balance endpoint. Dedicated credentials are read
* only from named environment variables and never persisted.
*/
async function readConfiguredExternalUsage(queries, endpoint, env, now = Date.now()) {
	const context = configuredQueryContext(queries, endpoint, env);
	if (!context) return null;
	const cached = queryCache.get(context.cacheKey);
	if (cached?.valueAt && now - cached.valueAt < context.query.refreshMs) return cached.value ? structuredClone(cached.value) : null;
	if (cached?.failedAt && now - cached.failedAt < QUERY_FAILURE_RETRY_MS) return cachedQueryValue(cached, now);
	return startConfiguredQuery(context, now);
}
function readCachedConfiguredExternalUsage(queries, endpoint, env, onUpdate, now = Date.now()) {
	const context = configuredQueryContext(queries, endpoint, env);
	if (!context) return null;
	const cached = queryCache.get(context.cacheKey);
	if (cached?.valueAt && now - cached.valueAt < context.query.refreshMs) return cached.value ? structuredClone(cached.value) : null;
	if (!cached?.failedAt || now - cached.failedAt >= QUERY_FAILURE_RETRY_MS) {
		if (!inFlightQueries.has(context.cacheKey)) startConfiguredQuery(context, now).finally(onUpdate);
	}
	return cachedQueryValue(cached, now);
}
function snapshotWindow(value, label, fallbackMinutes) {
	if (!value || typeof value !== "object") return null;
	const percent = safePercent(value.used_percentage ?? value.used_percent);
	if (percent === null) return null;
	return {
		label,
		percent,
		resetAt: safeReset(value.resets_at),
		windowMinutes: typeof value.window_minutes === "number" && value.window_minutes > 0 ? value.window_minutes : fallbackMinutes
	};
}
function validSnapshotPath(filePath, write = false) {
	if (!filePath || !path.isAbsolute(filePath) || !filePath.toLowerCase().endsWith(".json")) return false;
	if (!write) return true;
	try {
		return fs.statSync(path.dirname(filePath)).isDirectory();
	} catch {
		return false;
	}
}
function readExternalUsage(filePath, freshnessMs, now = /* @__PURE__ */ new Date()) {
	if (!validSnapshotPath(filePath)) return null;
	try {
		const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
		const updatedAt = safeReset(snapshot.updated_at);
		if (!updatedAt || Math.abs(now.getTime() - updatedAt.getTime()) > freshnessMs) return null;
		const primary = snapshotWindow(snapshot.five_hour, "5h", 300);
		const secondary = snapshotWindow(snapshot.seven_day, "1w", 10080);
		const individual = snapshotWindow(snapshot.individual, "spend", 43200);
		const balanceLabel = sanitizeLabel(snapshot.balance_label);
		if (!primary && !secondary && !individual && !balanceLabel) return null;
		return {
			primary,
			secondary,
			individual,
			planType: null,
			balanceLabel,
			limitReachedType: null
		};
	} catch {
		return null;
	}
}
function serializableWindow(window) {
	if (!window || window.percent === null) return null;
	return {
		used_percentage: window.percent,
		resets_at: window.resetAt?.toISOString() ?? null,
		window_minutes: window.windowMinutes ?? null
	};
}
function writeExternalUsage(filePath, usage, now = /* @__PURE__ */ new Date()) {
	if (!validSnapshotPath(filePath, true)) return;
	const content = {
		five_hour: serializableWindow(usage.primary),
		seven_day: serializableWindow(usage.secondary),
		individual: serializableWindow(usage.individual),
		balance_label: usage.balanceLabel
	};
	const fingerprint = JSON.stringify(content);
	const previous = lastWrites.get(filePath);
	if (previous?.fingerprint === fingerprint && now.getTime() - previous.at < WRITE_HEARTBEAT_MS) return;
	const snapshot = {
		updated_at: now.toISOString(),
		...content
	};
	try {
		fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, {
			encoding: "utf8",
			mode: 384
		});
		fs.chmodSync(filePath, 384);
		setTimedCache(lastWrites, filePath, {
			fingerprint,
			at: now.getTime()
		}, WRITE_CACHE_MAX_AGE_MS, WRITE_CACHE_MAX_ENTRIES);
	} catch {}
}
function resolveUsageData(nativeUsage, display, now = /* @__PURE__ */ new Date()) {
	const external = readExternalUsage(display.externalUsagePath, display.externalUsageFreshnessMs, now);
	if (nativeUsage) {
		if (display.externalUsageWritePath) writeExternalUsage(display.externalUsageWritePath, nativeUsage, now);
		return external?.balanceLabel && !nativeUsage.balanceLabel ? {
			...nativeUsage,
			balanceLabel: external.balanceLabel
		} : nativeUsage;
	}
	return external;
}

//#endregion
//#region src/types/config.ts
const DEFAULT_GENERAL_EXTERNAL_USAGE_QUERY = {
	enabled: true,
	origin: "*",
	template: "general",
	apiKeyEnv: "",
	accessTokenEnv: "",
	userIdEnv: "",
	refreshMs: 3e5,
	quotaPerCredit: 5e5
};
const DEFAULT_ELEMENT_ORDER = [
	"project",
	"addedDirs",
	"context",
	"usage",
	"promptCache",
	"memory",
	"environment",
	"tools",
	"skills",
	"mcp",
	"agents",
	"todos",
	"turns",
	"sessionTime"
];
const DEFAULT_MERGE_GROUPS = [["context", "usage"]];
const DEFAULT_CONFIG = {
	language: "en",
	lineLayout: "expanded",
	showSeparators: false,
	pathLevels: 1,
	maxWidth: null,
	forceMaxWidth: false,
	refreshIntervalMs: 300,
	elementOrder: [...DEFAULT_ELEMENT_ORDER],
	gitStatus: {
		enabled: true,
		showDirty: true,
		showAheadBehind: false,
		showFileStats: true,
		branchOverflow: "truncate",
		pushWarningThreshold: 0,
		pushCriticalThreshold: 0
	},
	display: {
		showModel: true,
		showProject: true,
		showAddedDirs: true,
		addedDirsLayout: "inline",
		showContextBar: true,
		contextValue: "percent",
		showConfigCounts: false,
		showCost: false,
		showDuration: false,
		showSpeed: false,
		showTokenBreakdown: true,
		showUsage: true,
		usageValue: "percent",
		usageBarEnabled: true,
		usageCompact: false,
		showResetLabel: true,
		showTools: false,
		showSkills: false,
		showMcp: false,
		toolNameMaxLength: 0,
		toolsMaxVisible: 4,
		showAgents: false,
		showTodos: false,
		showGoal: true,
		showTurns: true,
		showSessionName: false,
		showAuth: true,
		showAuthUser: false,
		authUserLength: 8,
		showCodexVersion: false,
		showEffortLevel: false,
		showApprovalPolicy: false,
		showPermissionProfile: false,
		showSandboxMode: false,
		showCollaborationMode: false,
		showMemoryUsage: false,
		showPromptCache: false,
		promptCacheTtlSeconds: 300,
		showSessionTokens: false,
		showSessionStartDate: false,
		showLastResponseAt: false,
		showCompactions: false,
		showSessionId: false,
		mergeGroups: DEFAULT_MERGE_GROUPS.map((group) => [...group]),
		contextWarningThreshold: 70,
		contextCriticalThreshold: 85,
		usageThreshold: 0,
		sevenDayThreshold: 80,
		environmentThreshold: 0,
		externalUsagePath: "",
		externalUsageWritePath: "",
		externalUsageFreshnessMs: 3e5,
		externalUsageQueries: [],
		modelFormat: "full",
		modelOverride: "",
		showProvider: false,
		providerName: "",
		customLine: "",
		customLinePosition: "last",
		timeFormat: "relative",
		autoCompactWindow: null
	},
	colors: {
		context: "green",
		usage: "brightBlue",
		warning: "yellow",
		usageWarning: "brightMagenta",
		critical: "red",
		model: "cyan",
		project: "yellow",
		git: "magenta",
		gitBranch: "cyan",
		label: "dim",
		custom: 208,
		barFilled: "█",
		barEmpty: "░"
	}
};

//#endregion
//#region src/config/validate.ts
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const UNSAFE_CODEPOINT = /[\p{Cc}\p{Cf}\p{Variation_Selector}\p{Zl}\p{Zp}\p{Cn}]/u;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function enumValue(value, allowed, fallback) {
	return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
function booleanValue(value, fallback) {
	return typeof value === "boolean" ? value : fallback;
}
function stringValue(value, fallback) {
	return typeof value === "string" && !UNSAFE_CODEPOINT.test(value) ? value : fallback;
}
function numberValue(value, fallback, min, max, integer = false) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	const clamped = Math.min(max, Math.max(min, value));
	return integer ? Math.round(clamped) : clamped;
}
function nullablePositiveInteger(value, fallback) {
	if (value === null) return null;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
	return Math.round(value);
}
function externalUsageQueries(value, fallback) {
	if (!Array.isArray(value)) return structuredClone(fallback);
	return value.flatMap((item) => {
		if (!isRecord(item) || typeof item.origin !== "string") return [];
		let origin = "*";
		if (item.origin !== "*") {
			let url;
			try {
				url = new URL(item.origin);
			} catch {
				return [];
			}
			if (url.protocol !== "http:" && url.protocol !== "https:") return [];
			origin = url.origin.toLowerCase();
		}
		const apiKeyEnv = stringValue(item.apiKeyEnv, "");
		const accessTokenEnv = stringValue(item.accessTokenEnv, "");
		const userIdEnv = stringValue(item.userIdEnv, "");
		const template = enumValue(item.template, [
			"general",
			"newApi",
			"sub2Api"
		], "newApi");
		if (template !== "general" && !accessTokenEnv || template === "newApi" && !userIdEnv) return [];
		return [{
			enabled: booleanValue(item.enabled, false),
			origin,
			template,
			apiKeyEnv,
			accessTokenEnv,
			userIdEnv,
			refreshMs: numberValue(item.refreshMs, 3e5, 1e4, 864e5, true),
			quotaPerCredit: numberValue(item.quotaPerCredit, 5e5, 1, 1e9)
		}];
	});
}
function colorValue(value, fallback) {
	if (typeof value === "string" && ([
		"dim",
		"red",
		"green",
		"yellow",
		"magenta",
		"cyan",
		"brightBlue",
		"brightMagenta"
	].includes(value) || HEX_COLOR_PATTERN.test(value))) return value;
	if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) return value;
	return fallback;
}
function barCharacter(value, fallback) {
	if (typeof value !== "string" || !value || UNSAFE_CODEPOINT.test(value)) return fallback;
	const segmenter = new Intl.Segmenter(void 0, { granularity: "grapheme" });
	return Array.from(segmenter.segment(value)).length === 1 ? value : fallback;
}
function languageValue(value, fallback) {
	if (value === "zh" || value === "zh-TW" || value === "zh-Hant") return "zh-Hans";
	return enumValue(value, ["en", "zh-Hans"], fallback);
}
function elementOrder(value) {
	if (!Array.isArray(value)) return [...DEFAULT_ELEMENT_ORDER];
	const seen = /* @__PURE__ */ new Set();
	const result = [];
	for (const item of value) {
		if (typeof item !== "string" || !KNOWN_ELEMENTS.has(item)) continue;
		const element = item;
		if (!seen.has(element)) {
			seen.add(element);
			result.push(element);
		}
	}
	if (result.length > 0 && !seen.has("turns")) {
		const sessionIndex = result.indexOf("sessionTime");
		result.splice(sessionIndex >= 0 ? sessionIndex : result.length, 0, "turns");
	}
	return result.length > 0 ? result : [...DEFAULT_ELEMENT_ORDER];
}
function mergeGroups(value) {
	if (!Array.isArray(value)) return DEFAULT_MERGE_GROUPS.map((group) => [...group]);
	if (value.length === 0) return [];
	const used = /* @__PURE__ */ new Set();
	const result = [];
	for (const rawGroup of value) {
		if (!Array.isArray(rawGroup)) continue;
		const group = [];
		for (const item of rawGroup) {
			if (typeof item !== "string" || !KNOWN_ELEMENTS.has(item)) continue;
			const element = item;
			if (!used.has(element) && !group.includes(element)) group.push(element);
		}
		if (group.length >= 2) {
			group.forEach((element) => used.add(element));
			result.push(group);
		}
	}
	return result.length > 0 ? result : DEFAULT_MERGE_GROUPS.map((group) => [...group]);
}
function validateConfig(value) {
	const root = isRecord(value) ? value : {};
	const rawGit = isRecord(root.gitStatus) ? root.gitStatus : {};
	const rawDisplay = isRecord(root.display) ? root.display : {};
	const rawColors = isRecord(root.colors) ? root.colors : {};
	const fallback = DEFAULT_CONFIG;
	return {
		language: languageValue(root.language, fallback.language),
		lineLayout: enumValue(root.lineLayout, ["compact", "expanded"], fallback.lineLayout),
		showSeparators: booleanValue(root.showSeparators, fallback.showSeparators),
		pathLevels: numberValue(root.pathLevels, fallback.pathLevels, 1, 3, true),
		maxWidth: nullablePositiveInteger(root.maxWidth, fallback.maxWidth),
		forceMaxWidth: booleanValue(root.forceMaxWidth, fallback.forceMaxWidth),
		refreshIntervalMs: numberValue(root.refreshIntervalMs, fallback.refreshIntervalMs, 100, MAX_REFRESH_INTERVAL_MS, true),
		elementOrder: elementOrder(root.elementOrder),
		gitStatus: {
			enabled: booleanValue(rawGit.enabled, fallback.gitStatus.enabled),
			showDirty: booleanValue(rawGit.showDirty, fallback.gitStatus.showDirty),
			showAheadBehind: booleanValue(rawGit.showAheadBehind, fallback.gitStatus.showAheadBehind),
			showFileStats: booleanValue(rawGit.showFileStats, fallback.gitStatus.showFileStats),
			branchOverflow: enumValue(rawGit.branchOverflow, ["truncate", "wrap"], fallback.gitStatus.branchOverflow),
			pushWarningThreshold: numberValue(rawGit.pushWarningThreshold, fallback.gitStatus.pushWarningThreshold, 0, 1e4, true),
			pushCriticalThreshold: numberValue(rawGit.pushCriticalThreshold, fallback.gitStatus.pushCriticalThreshold, 0, 1e4, true)
		},
		display: {
			showModel: booleanValue(rawDisplay.showModel, fallback.display.showModel),
			showProject: booleanValue(rawDisplay.showProject, fallback.display.showProject),
			showAddedDirs: booleanValue(rawDisplay.showAddedDirs, fallback.display.showAddedDirs),
			addedDirsLayout: enumValue(rawDisplay.addedDirsLayout, ["inline", "line"], fallback.display.addedDirsLayout),
			showContextBar: booleanValue(rawDisplay.showContextBar, fallback.display.showContextBar),
			contextValue: enumValue(rawDisplay.contextValue, [
				"percent",
				"tokens",
				"remaining",
				"both"
			], fallback.display.contextValue),
			showConfigCounts: booleanValue(rawDisplay.showConfigCounts, fallback.display.showConfigCounts),
			showCost: booleanValue(rawDisplay.showCost, fallback.display.showCost),
			showDuration: booleanValue(rawDisplay.showDuration, fallback.display.showDuration),
			showSpeed: booleanValue(rawDisplay.showSpeed, fallback.display.showSpeed),
			showTokenBreakdown: booleanValue(rawDisplay.showTokenBreakdown, fallback.display.showTokenBreakdown),
			showUsage: booleanValue(rawDisplay.showUsage, fallback.display.showUsage),
			usageValue: enumValue(rawDisplay.usageValue, ["percent", "remaining"], fallback.display.usageValue),
			usageBarEnabled: booleanValue(rawDisplay.usageBarEnabled, fallback.display.usageBarEnabled),
			usageCompact: booleanValue(rawDisplay.usageCompact, fallback.display.usageCompact),
			showResetLabel: booleanValue(rawDisplay.showResetLabel, fallback.display.showResetLabel),
			showTools: booleanValue(rawDisplay.showTools, fallback.display.showTools),
			showSkills: booleanValue(rawDisplay.showSkills, fallback.display.showSkills),
			showMcp: booleanValue(rawDisplay.showMcp, fallback.display.showMcp),
			toolNameMaxLength: numberValue(rawDisplay.toolNameMaxLength, fallback.display.toolNameMaxLength, 0, 256, true),
			toolsMaxVisible: numberValue(rawDisplay.toolsMaxVisible, fallback.display.toolsMaxVisible, 0, 100, true),
			showAgents: booleanValue(rawDisplay.showAgents, fallback.display.showAgents),
			showTodos: booleanValue(rawDisplay.showTodos, fallback.display.showTodos),
			showGoal: booleanValue(rawDisplay.showGoal, fallback.display.showGoal),
			showTurns: booleanValue(rawDisplay.showTurns, fallback.display.showTurns),
			showSessionName: booleanValue(rawDisplay.showSessionName, fallback.display.showSessionName),
			showAuth: booleanValue(rawDisplay.showAuth, fallback.display.showAuth),
			showAuthUser: booleanValue(rawDisplay.showAuthUser, fallback.display.showAuthUser),
			authUserLength: numberValue(rawDisplay.authUserLength, fallback.display.authUserLength, 0, 256, true),
			showCodexVersion: booleanValue(rawDisplay.showCodexVersion, fallback.display.showCodexVersion),
			showEffortLevel: booleanValue(rawDisplay.showEffortLevel, fallback.display.showEffortLevel),
			showApprovalPolicy: booleanValue(rawDisplay.showApprovalPolicy, fallback.display.showApprovalPolicy),
			showPermissionProfile: booleanValue(rawDisplay.showPermissionProfile, fallback.display.showPermissionProfile),
			showSandboxMode: booleanValue(rawDisplay.showSandboxMode, fallback.display.showSandboxMode),
			showCollaborationMode: booleanValue(rawDisplay.showCollaborationMode, fallback.display.showCollaborationMode),
			showMemoryUsage: booleanValue(rawDisplay.showMemoryUsage, fallback.display.showMemoryUsage),
			showPromptCache: booleanValue(rawDisplay.showPromptCache, fallback.display.showPromptCache),
			promptCacheTtlSeconds: numberValue(rawDisplay.promptCacheTtlSeconds, fallback.display.promptCacheTtlSeconds, 1, MAX_PROMPT_CACHE_TTL_SECONDS, true),
			showSessionTokens: booleanValue(rawDisplay.showSessionTokens, fallback.display.showSessionTokens),
			showSessionStartDate: booleanValue(rawDisplay.showSessionStartDate, fallback.display.showSessionStartDate),
			showLastResponseAt: booleanValue(rawDisplay.showLastResponseAt, fallback.display.showLastResponseAt),
			showCompactions: booleanValue(rawDisplay.showCompactions, fallback.display.showCompactions),
			showSessionId: booleanValue(rawDisplay.showSessionId, fallback.display.showSessionId),
			mergeGroups: mergeGroups(rawDisplay.mergeGroups),
			contextWarningThreshold: numberValue(rawDisplay.contextWarningThreshold, fallback.display.contextWarningThreshold, 0, 100),
			contextCriticalThreshold: numberValue(rawDisplay.contextCriticalThreshold, fallback.display.contextCriticalThreshold, 0, 100),
			usageThreshold: numberValue(rawDisplay.usageThreshold, fallback.display.usageThreshold, 0, 100),
			sevenDayThreshold: numberValue(rawDisplay.sevenDayThreshold, fallback.display.sevenDayThreshold, 0, 100),
			environmentThreshold: numberValue(rawDisplay.environmentThreshold, fallback.display.environmentThreshold, 0, 100),
			externalUsagePath: stringValue(rawDisplay.externalUsagePath, fallback.display.externalUsagePath),
			externalUsageWritePath: stringValue(rawDisplay.externalUsageWritePath, fallback.display.externalUsageWritePath),
			externalUsageFreshnessMs: numberValue(rawDisplay.externalUsageFreshnessMs, fallback.display.externalUsageFreshnessMs, 1e3, 864e5, true),
			externalUsageQueries: externalUsageQueries(rawDisplay.externalUsageQueries, fallback.display.externalUsageQueries),
			modelFormat: enumValue(rawDisplay.modelFormat, [
				"full",
				"compact",
				"short"
			], fallback.display.modelFormat),
			modelOverride: stringValue(rawDisplay.modelOverride, fallback.display.modelOverride),
			showProvider: booleanValue(rawDisplay.showProvider, fallback.display.showProvider),
			providerName: stringValue(rawDisplay.providerName, fallback.display.providerName),
			customLine: stringValue(rawDisplay.customLine, fallback.display.customLine),
			customLinePosition: enumValue(rawDisplay.customLinePosition, ["first", "last"], fallback.display.customLinePosition),
			timeFormat: enumValue(rawDisplay.timeFormat, [
				"relative",
				"absolute",
				"both",
				"elapsed",
				"elapsedAndAbsolute"
			], fallback.display.timeFormat),
			autoCompactWindow: nullablePositiveInteger(rawDisplay.autoCompactWindow, fallback.display.autoCompactWindow)
		},
		colors: {
			context: colorValue(rawColors.context, fallback.colors.context),
			usage: colorValue(rawColors.usage, fallback.colors.usage),
			warning: colorValue(rawColors.warning, fallback.colors.warning),
			usageWarning: colorValue(rawColors.usageWarning, fallback.colors.usageWarning),
			critical: colorValue(rawColors.critical, fallback.colors.critical),
			model: colorValue(rawColors.model, fallback.colors.model),
			project: colorValue(rawColors.project, fallback.colors.project),
			git: colorValue(rawColors.git, fallback.colors.git),
			gitBranch: colorValue(rawColors.gitBranch, fallback.colors.gitBranch),
			label: colorValue(rawColors.label, fallback.colors.label),
			custom: colorValue(rawColors.custom, fallback.colors.custom),
			barFilled: barCharacter(rawColors.barFilled, fallback.colors.barFilled),
			barEmpty: barCharacter(rawColors.barEmpty, fallback.colors.barEmpty)
		}
	};
}

//#endregion
//#region src/config/version.ts
const CURRENT_CONFIG_VERSION = 1;
function rawConfigVersion(raw) {
	const value = raw.configVersion;
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}
function applyConfigMigrations(config, raw) {
	const fromVersion = rawConfigVersion(raw);
	if (fromVersion >= 1) return {
		config,
		fromVersion,
		toVersion: fromVersion,
		migrated: false
	};
	const migrated = structuredClone(config);
	if (fromVersion < 1) migrated.gitStatus.showFileStats = true;
	return {
		config: migrated,
		fromVersion,
		toVersion: 1,
		migrated: true
	};
}

//#endregion
//#region src/config/load.ts
function loadConfig(env = process.env) {
	const configPath = getConfigPath(env);
	try {
		const source = fs.readFileSync(configPath, "utf8");
		const parsed = JSON.parse(source);
		const raw = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
		return {
			config: applyConfigMigrations(validateConfig(raw), raw).config,
			path: configPath,
			raw,
			error: null
		};
	} catch (error) {
		const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
		return {
			config: validateConfig({}),
			path: configPath,
			raw: {},
			error: missing ? null : error
		};
	}
}
function reloadConfig(previous, env = process.env) {
	const next = loadConfig(env);
	return next.error ? {
		...previous,
		error: next.error
	} : next;
}

//#endregion
//#region src/collectors/agents.ts
const COMPLETED_VISIBLE_MS = 3e4;
const STARTING_VISIBLE_MS = 15 * 6e4;
const CACHE_MS = 1e3;
const ROLLOUT_CACHE_MAX_AGE_MS = 60 * 6e4;
const ROLLOUT_CACHE_MAX_ENTRIES = 256;
let cache$1 = null;
const rolloutCache = /* @__PURE__ */ new Map();
function safeDate(value, fallback) {
	if (typeof value === "number" && Number.isFinite(value)) {
		const date = new Date(value > 1e10 ? value : value * 1e3);
		return Number.isNaN(date.getTime()) ? fallback : date;
	}
	if (typeof value === "string") {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? fallback : date;
	}
	return fallback;
}
function label(candidate) {
	if (candidate.agentNickname) return candidate.agentNickname;
	if (candidate.agentPath) return candidate.agentPath.slice(candidate.agentPath.lastIndexOf("/") + 1);
	if (candidate.agentRole) return candidate.agentRole;
	return `agent-${candidate.sessionId.slice(0, 8)}`;
}
function readAgentRollout(candidate) {
	let stat;
	try {
		stat = fs.statSync(candidate.path);
	} catch {
		return null;
	}
	let cached = rolloutCache.get(candidate.path);
	if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
		cached.at = Date.now();
		return {
			active: cached.activeTurns.size > 0,
			model: cached.model,
			startedAt: new Date(cached.startedAt),
			lastTimestamp: new Date(cached.lastTimestamp)
		};
	}
	if (!cached) cached = {
		at: Date.now(),
		mtimeMs: 0,
		size: 0,
		tail: new JsonlTail(),
		activeTurns: /* @__PURE__ */ new Set(),
		startedAt: candidate.startTime,
		lastTimestamp: candidate.startTime
	};
	try {
		const { lines, reset } = cached.tail.read(candidate.path);
		if (reset) {
			cached.activeTurns.clear();
			cached.model = void 0;
			cached.startedAt = candidate.startTime;
			cached.lastTimestamp = candidate.startTime;
		}
		for (const line of lines) {
			let entry;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			cached.lastTimestamp = safeDate(entry.timestamp, cached.lastTimestamp);
			const payload = entry.payload;
			if (!payload) continue;
			if (entry.type === "turn_context") {
				const collaboration = payload.collaboration_mode;
				const settings = collaboration && typeof collaboration === "object" && !Array.isArray(collaboration) ? collaboration.settings : null;
				cached.model = typeof payload.model === "string" ? payload.model : settings && typeof settings === "object" && !Array.isArray(settings) && typeof settings.model === "string" ? settings.model : cached.model;
			}
			if (entry.type !== "event_msg") continue;
			if (payload.type === "task_started" && typeof payload.turn_id === "string") {
				cached.activeTurns.add(payload.turn_id);
				cached.startedAt = safeDate(payload.started_at, cached.lastTimestamp);
			} else if (payload.type === "task_complete" && typeof payload.turn_id === "string") cached.activeTurns.delete(payload.turn_id);
			else if (payload.type === "turn_aborted") if (typeof payload.turn_id === "string") cached.activeTurns.delete(payload.turn_id);
			else cached.activeTurns.clear();
		}
	} catch {
		return null;
	}
	cached.at = Date.now();
	cached.mtimeMs = stat.mtimeMs;
	cached.size = stat.size;
	setTimedCache(rolloutCache, candidate.path, cached, ROLLOUT_CACHE_MAX_AGE_MS, ROLLOUT_CACHE_MAX_ENTRIES);
	const value = {
		active: cached.activeTurns.size > 0,
		model: cached.model,
		startedAt: cached.startedAt,
		lastTimestamp: cached.lastTimestamp
	};
	return structuredClone(value);
}
function parseAgent(candidate, now) {
	const parsed = readAgentRollout(candidate);
	if (!parsed) return null;
	const active = parsed.active;
	const ageMs = now.getTime() - candidate.mtimeMs;
	const starting = !active && ageMs < STARTING_VISIBLE_MS && candidate.mtimeMs === candidate.startTime.getTime();
	if (!active && !starting && ageMs > COMPLETED_VISIBLE_MS) return null;
	return {
		parentThreadId: candidate.parentThreadId ?? "",
		active,
		entry: {
			id: candidate.sessionId,
			type: label(candidate),
			model: parsed.model,
			description: candidate.agentRole,
			path: candidate.agentPath,
			status: active ? "running" : starting ? "starting" : "completed",
			startTime: parsed.startedAt,
			endTime: active || starting ? void 0 : parsed.lastTimestamp
		}
	};
}
function descendants(rootThreadId, runtimes) {
	const visible = /* @__PURE__ */ new Set([rootThreadId]);
	const result = [];
	let changed = true;
	while (changed) {
		changed = false;
		for (const runtime of runtimes) if (!visible.has(runtime.entry.id) && visible.has(runtime.parentThreadId)) {
			visible.add(runtime.entry.id);
			result.push(runtime);
			changed = true;
		}
	}
	return result;
}
function collectAgentEntries(session, env = process.env, now = /* @__PURE__ */ new Date()) {
	if (!session) return [];
	const codexHome = getCodexHome(env);
	pruneTimedCache(rolloutCache, now.getTime(), ROLLOUT_CACHE_MAX_AGE_MS, ROLLOUT_CACHE_MAX_ENTRIES);
	const key = `${codexHome}:${session.id}`;
	if (cache$1?.key === key && now.getTime() - cache$1.at < CACHE_MS) return structuredClone(cache$1.agents);
	const runtimes = listSessionCandidates(codexHome).filter((candidate) => isSubagentSource(candidate.source) && candidate.parentThreadId).flatMap((candidate) => {
		const runtime = parseAgent(candidate, now);
		return runtime ? [runtime] : [];
	});
	const tree = descendants(session.id, runtimes);
	const childrenByParent = /* @__PURE__ */ new Map();
	for (const runtime of tree) {
		const siblings = childrenByParent.get(runtime.parentThreadId) ?? [];
		siblings.push(runtime);
		childrenByParent.set(runtime.parentThreadId, siblings);
	}
	const agents = (childrenByParent.get(session.id) ?? []).map((runtime) => {
		let activeDescendantCount = 0;
		const queue = [...childrenByParent.get(runtime.entry.id) ?? []];
		while (queue.length > 0) {
			const child = queue.shift();
			if (child.active || child.entry.status === "starting") activeDescendantCount += 1;
			queue.push(...childrenByParent.get(child.entry.id) ?? []);
		}
		return {
			...runtime.entry,
			activeDescendantCount
		};
	});
	cache$1 = {
		key,
		at: now.getTime(),
		agents
	};
	return structuredClone(agents);
}

//#endregion
//#region src/collectors/git.ts
const GIT_TIMEOUT_MS = 1500;
const STATUS_CACHE_MS = 2e3;
const ROOT_CACHE_MS = 5 * 6e4;
const CACHE_MAX_AGE_MS = 30 * 6e4;
const CACHE_MAX_ENTRIES = 64;
const statusCache = /* @__PURE__ */ new Map();
const rootCache = /* @__PURE__ */ new Map();
function git(cwd, args) {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		],
		timeout: GIT_TIMEOUT_MS
	});
	return result.status === 0 ? result.stdout.trim() : null;
}
function findGitRoot(cwd, now = Date.now()) {
	const cached = rootCache.get(cwd);
	if (cached && now - cached.at < ROOT_CACHE_MS) return cached.root;
	const root = git(cwd, ["rev-parse", "--show-toplevel"]);
	setTimedCache(rootCache, cwd, {
		at: now,
		root
	}, CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES);
	return root;
}
function changeType(xy) {
	return xy[0] !== "." ? xy[0] : xy[1] ?? ".";
}
function collectGitStatus(cwd) {
	const now = Date.now();
	const cached = statusCache.get(cwd);
	if (cached && now - cached.at < STATUS_CACHE_MS) return cached.status ? structuredClone(cached.status) : null;
	const root = findGitRoot(cwd, now);
	if (!root) {
		setTimedCache(statusCache, cwd, {
			at: now,
			status: null
		}, CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES);
		return null;
	}
	const output = git(root, [
		"status",
		"--porcelain=v2",
		"--branch",
		"-z",
		"--untracked-files=normal"
	]);
	if (output === null) {
		setTimedCache(statusCache, cwd, {
			at: now,
			status: null
		}, CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES);
		return null;
	}
	const records = output.split("\0").filter(Boolean);
	let branch = null;
	let oid = null;
	let ahead = 0;
	let behind = 0;
	let modified = 0;
	let added = 0;
	let deleted = 0;
	let untracked = 0;
	let renamed = 0;
	let copied = 0;
	let typeChanged = 0;
	let conflicted = 0;
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (record.startsWith("# branch.head ")) {
			const value = record.slice(14);
			branch = value === "(detached)" ? null : value;
			continue;
		}
		if (record.startsWith("# branch.oid ")) {
			const value = record.slice(13);
			oid = value === "(initial)" ? null : value.slice(0, 7);
			continue;
		}
		if (record.startsWith("# branch.ab ")) {
			const match = /\+(\d+) -(\d+)/.exec(record);
			ahead = Number(match?.[1] ?? 0);
			behind = Number(match?.[2] ?? 0);
			continue;
		}
		if (record.startsWith("? ")) {
			untracked += 1;
			continue;
		}
		if (record.startsWith("u ")) {
			conflicted += 1;
			continue;
		}
		if (record.startsWith("1 ") || record.startsWith("2 ")) {
			const type = changeType(record.slice(2, 4));
			if (type === "R") renamed += 1;
			else if (type === "C") copied += 1;
			else if (type === "A") added += 1;
			else if (type === "D") deleted += 1;
			else if (type === "T") typeChanged += 1;
			else modified += 1;
			if (record.startsWith("2 ")) index += 1;
		}
	}
	const status = {
		isGitRepo: true,
		branch: branch ?? oid,
		isDirty: modified + added + deleted + untracked + renamed + copied + typeChanged + conflicted > 0,
		ahead,
		behind,
		modified,
		added,
		deleted,
		untracked,
		renamed,
		copied,
		typeChanged,
		conflicted
	};
	setTimedCache(statusCache, cwd, {
		at: now,
		status
	}, CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES);
	return structuredClone(status);
}

//#endregion
//#region src/collectors/memory.ts
const MEMORY_CACHE_MS = 5e3;
const RECLAIMABLE_PAGES = [
	"free",
	"inactive",
	"speculative",
	"purgeable"
];
let cache = null;
/**
* `os.freemem()` on macOS counts only wholly free pages, so cached and inactive
* memory reads as used and every Mac reports ~100%. vm_stat exposes the pages
* the kernel can actually reclaim.
*/
function darwinAvailableBytes() {
	const result = spawnSync("vm_stat", [], {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		],
		timeout: 500
	});
	if (result.status !== 0 || typeof result.stdout !== "string") return null;
	const pageSize = Number(/page size of (\d+) bytes/.exec(result.stdout)?.[1]);
	if (!Number.isFinite(pageSize) || pageSize <= 0) return null;
	let pages = 0;
	for (const name of RECLAIMABLE_PAGES) {
		const match = new RegExp(`^Pages ${name}:\\s+(\\d+)`, "im").exec(result.stdout);
		if (match) pages += Number(match[1]);
	}
	return pages > 0 ? pages * pageSize : null;
}
function collectMemoryInfo(now = Date.now()) {
	if (cache && now - cache.at < MEMORY_CACHE_MS) return { ...cache.value };
	const totalBytes = os.totalmem();
	const freeBytes = (process.platform === "darwin" ? darwinAvailableBytes() : null) ?? os.freemem();
	const usedBytes = Math.max(0, totalBytes - freeBytes);
	const value = {
		totalBytes,
		usedBytes,
		freeBytes,
		usedPercent: totalBytes > 0 ? Math.round(usedBytes / totalBytes * 100) : 0
	};
	cache = {
		at: now,
		value
	};
	return { ...value };
}

//#endregion
//#region node_modules/.pnpm/smol-toml@1.7.0/node_modules/smol-toml/dist/date.js
/*!
* Copyright (c) Squirrel Chat et al., All rights reserved.
* SPDX-License-Identifier: BSD-3-Clause
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice, this
*    list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright notice,
*    this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holder nor the names of its contributors
*    may be used to endorse or promote products derived from this software without
*    specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
* ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
* FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
* DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
* OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
let DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|[-+]\d{2}:\d{2})?$/i;
var TomlDate = class TomlDate extends Date {
	#hasDate = false;
	#hasTime = false;
	#offset = null;
	constructor(date) {
		let hasDate = true;
		let hasTime = true;
		let offset = "Z";
		if (typeof date === "string") {
			let match = date.match(DATE_TIME_RE);
			if (match) {
				if (!match[1]) {
					hasDate = false;
					date = `0000-01-01T${date}`;
				}
				hasTime = !!match[2];
				hasTime && date[10] === " " && (date = date.replace(" ", "T"));
				if (match[2] && +match[2] > 23) date = "";
				else {
					offset = match[3] || null;
					date = date.toUpperCase();
					if (!offset && hasTime) date += "Z";
				}
			} else date = "";
		}
		super(date);
		if (!isNaN(this.getTime())) {
			this.#hasDate = hasDate;
			this.#hasTime = hasTime;
			this.#offset = offset;
		}
	}
	isDateTime() {
		return this.#hasDate && this.#hasTime;
	}
	isLocal() {
		return !this.#hasDate || !this.#hasTime || !this.#offset;
	}
	isDate() {
		return this.#hasDate && !this.#hasTime;
	}
	isTime() {
		return this.#hasTime && !this.#hasDate;
	}
	isValid() {
		return this.#hasDate || this.#hasTime;
	}
	toISOString() {
		let iso = super.toISOString();
		if (this.isDate()) return iso.slice(0, 10);
		if (this.isTime()) return iso.slice(11, 23);
		if (this.#offset === null) return iso.slice(0, -1);
		if (this.#offset === "Z") return iso;
		let offset = +this.#offset.slice(1, 3) * 60 + +this.#offset.slice(4, 6);
		offset = this.#offset[0] === "-" ? offset : -offset;
		return (/* @__PURE__ */ new Date(this.getTime() - offset * 6e4)).toISOString().slice(0, -1) + this.#offset;
	}
	static wrapAsOffsetDateTime(jsDate, offset = "Z") {
		let date = new TomlDate(jsDate);
		date.#offset = offset;
		return date;
	}
	static wrapAsLocalDateTime(jsDate) {
		let date = new TomlDate(jsDate);
		date.#offset = null;
		return date;
	}
	static wrapAsLocalDate(jsDate) {
		let date = new TomlDate(jsDate);
		date.#hasTime = false;
		date.#offset = null;
		return date;
	}
	static wrapAsLocalTime(jsDate) {
		let date = new TomlDate(jsDate);
		date.#hasDate = false;
		date.#offset = null;
		return date;
	}
};

//#endregion
//#region node_modules/.pnpm/smol-toml@1.7.0/node_modules/smol-toml/dist/error.js
/*!
* Copyright (c) Squirrel Chat et al., All rights reserved.
* SPDX-License-Identifier: BSD-3-Clause
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice, this
*    list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright notice,
*    this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holder nor the names of its contributors
*    may be used to endorse or promote products derived from this software without
*    specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
* ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
* FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
* DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
* OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
function getLineColFromPtr(string, ptr) {
	let lines = string.slice(0, ptr).split(/\r\n|\n|\r/g);
	return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
	let lines = string.split(/\r\n|\n|\r/g);
	let codeblock = "";
	let numberLen = (Math.log10(line + 1) | 0) + 1;
	for (let i = line - 1; i <= line + 1; i++) {
		let l = lines[i - 1];
		if (!l) continue;
		codeblock += i.toString().padEnd(numberLen, " ");
		codeblock += ":  ";
		codeblock += l;
		codeblock += "\n";
		if (i === line) {
			codeblock += " ".repeat(numberLen + column + 2);
			codeblock += "^\n";
		}
	}
	return codeblock;
}
var TomlError = class extends Error {
	line;
	column;
	codeblock;
	constructor(message, options) {
		const [line, column] = getLineColFromPtr(options.toml, options.ptr);
		const codeblock = makeCodeBlock(options.toml, line, column);
		super(`Invalid TOML document: ${message}\n\n${codeblock}`, options);
		this.line = line;
		this.column = column;
		this.codeblock = codeblock;
	}
};

//#endregion
//#region node_modules/.pnpm/smol-toml@1.7.0/node_modules/smol-toml/dist/primitive.js
/*!
* Copyright (c) Squirrel Chat et al., All rights reserved.
* SPDX-License-Identifier: BSD-3-Clause
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice, this
*    list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright notice,
*    this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holder nor the names of its contributors
*    may be used to endorse or promote products derived from this software without
*    specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
* ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
* FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
* DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
* OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
let INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
let FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
let LEADING_ZERO = /^[+-]?0[0-9_]/;
function parseString(str, ptr) {
	let c = str[ptr++];
	let first = c;
	let isLiteral = c === "'";
	let isMultiline = c === str[ptr] && c === str[ptr + 1];
	if (isMultiline) {
		if (str[ptr += 2] === "\n") ptr++;
		else if (str[ptr] === "\r" && str[ptr + 1] === "\n") ptr += 2;
	}
	let parsed = "";
	let sliceStart = ptr;
	let state = 0;
	for (let i = ptr; i < str.length; i++) {
		c = str[i];
		if (isMultiline && (c === "\n" || c === "\r" && str[i + 1] === "\n")) state = state && 3;
		else if (c < " " && c !== "	" || c === "") throw new TomlError("control characters are not allowed in strings", {
			toml: str,
			ptr: i
		});
		else if ((!state || state === 3) && c === first && (!isMultiline || str[i + 1] === first && str[i + 2] === first)) {
			if (isMultiline) {
				if (str[i + 3] === first) i++;
				if (str[i + 3] === first) i++;
			}
			return [state ? parsed : parsed + str.slice(sliceStart, i), i + (isMultiline ? 3 : 1)];
		} else if (!state) {
			if (!isLiteral && c === "\\") {
				parsed += str.slice(sliceStart, sliceStart = i);
				state = 1;
			}
		} else if (state === 1) if (c === "x" || c === "u" || c === "U") {
			let value = 0;
			let len = c === "x" ? 2 : c === "u" ? 4 : 8;
			for (let j = 0; j < len; j++, i++) {
				let hex = str.charCodeAt(i + 1);
				let digit = hex >= 48 && hex <= 57 ? hex - 48 : hex >= 65 && hex <= 70 ? hex - 65 + 10 : hex >= 97 && hex <= 102 ? hex - 97 + 10 : -1;
				if (digit < 0) throw new TomlError("invalid non-hex character in unicode escape", {
					toml: str,
					ptr: i + 1
				});
				value = value << 4 | digit;
			}
			if (value < 0 || value > 1114111 || value >= 55296 && value <= 57343) throw new TomlError("invalid unicode escape", {
				toml: str,
				ptr: i
			});
			parsed += String.fromCodePoint(value);
			sliceStart = i + 1;
			state = 0;
		} else if (c === " " || c === "	") state = 2;
		else {
			if (c === "b") parsed += "\b";
			else if (c === "t") parsed += "	";
			else if (c === "n") parsed += "\n";
			else if (c === "f") parsed += "\f";
			else if (c === "r") parsed += "\r";
			else if (c === "e") parsed += "\x1B";
			else if (c === "\"") parsed += "\"";
			else if (c === "\\") parsed += "\\";
			else throw new TomlError("unrecognized escape sequence", {
				toml: str,
				ptr: i
			});
			sliceStart = i + 1;
			state = 0;
		}
		else if (c !== " " && c !== "	") {
			if (state === 2) throw new TomlError("invalid escape: only line-ending whitespace may be escaped", {
				toml: str,
				ptr: sliceStart
			});
			state = !isLiteral && c === "\\" ? 1 : 0;
			sliceStart = i;
		}
	}
	throw new TomlError("unfinished string", {
		toml: str,
		ptr
	});
}
function parseValue(value, toml, ptr, integersAsBigInt) {
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "-inf") return -Infinity;
	if (value === "inf" || value === "+inf") return Infinity;
	if (value === "nan" || value === "+nan" || value === "-nan") return NaN;
	if (value === "-0") return integersAsBigInt ? 0n : 0;
	let isInt = INT_REGEX.test(value);
	if (isInt || FLOAT_REGEX.test(value)) {
		if (LEADING_ZERO.test(value)) throw new TomlError("leading zeroes are not allowed", {
			toml,
			ptr
		});
		value = value.replace(/_/g, "");
		let numeric = +value;
		if (isNaN(numeric)) throw new TomlError("invalid number", {
			toml,
			ptr
		});
		if (isInt) {
			if ((isInt = !Number.isSafeInteger(numeric)) && !integersAsBigInt) throw new TomlError("integer value cannot be represented losslessly", {
				toml,
				ptr
			});
			if (isInt || integersAsBigInt === true) numeric = BigInt(value);
		}
		return numeric;
	}
	const date = new TomlDate(value);
	if (!date.isValid()) throw new TomlError("invalid value", {
		toml,
		ptr
	});
	return date;
}

//#endregion
//#region node_modules/.pnpm/smol-toml@1.7.0/node_modules/smol-toml/dist/util.js
/*!
* Copyright (c) Squirrel Chat et al., All rights reserved.
* SPDX-License-Identifier: BSD-3-Clause
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice, this
*    list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright notice,
*    this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holder nor the names of its contributors
*    may be used to endorse or promote products derived from this software without
*    specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
* ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
* FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
* DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
* OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
function indexOfNewline(str, start = 0, end = str.length) {
	let idx = str.indexOf("\n", start);
	if (str[idx - 1] === "\r") idx--;
	return idx <= end ? idx : -1;
}
function skipComment(str, ptr) {
	for (let i = ptr; i < str.length; i++) {
		let c = str[i];
		if (c === "\n") return i;
		if (c === "\r" && str[i + 1] === "\n") return i + 1;
		if (c < " " && c !== "	" || c === "") throw new TomlError("control characters are not allowed in comments", {
			toml: str,
			ptr
		});
	}
	return str.length;
}
function skipVoid(str, ptr, banNewLines, banComments) {
	let c;
	while (1) {
		while ((c = str[ptr]) === " " || c === "	" || !banNewLines && (c === "\n" || c === "\r" && str[ptr + 1] === "\n")) ptr++;
		if (banComments || c !== "#") break;
		ptr = skipComment(str, ptr);
	}
	return ptr;
}
function skipUntil(str, ptr, sep, end, banNewLines = false) {
	if (!end) {
		ptr = indexOfNewline(str, ptr);
		return ptr < 0 ? str.length : ptr;
	}
	for (let i = ptr; i < str.length; i++) {
		let c = str[i];
		if (c === "#") i = indexOfNewline(str, i);
		else if (c === sep) return i + 1;
		else if (c === end || banNewLines && (c === "\n" || c === "\r" && str[i + 1] === "\n")) return i;
	}
	throw new TomlError("cannot find end of structure", {
		toml: str,
		ptr
	});
}

//#endregion
//#region node_modules/.pnpm/smol-toml@1.7.0/node_modules/smol-toml/dist/extract.js
/*!
* Copyright (c) Squirrel Chat et al., All rights reserved.
* SPDX-License-Identifier: BSD-3-Clause
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice, this
*    list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright notice,
*    this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holder nor the names of its contributors
*    may be used to endorse or promote products derived from this software without
*    specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
* ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
* FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
* DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
* OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
function sliceAndTrimEndOf(str, startPtr, endPtr) {
	let value = str.slice(startPtr, endPtr);
	let commentIdx = value.indexOf("#");
	if (commentIdx > -1) {
		skipComment(str, commentIdx);
		value = value.slice(0, commentIdx);
	}
	return [value.trimEnd(), commentIdx];
}
function extractValue(str, ptr, end, depth, integersAsBigInt) {
	if (depth === 0) throw new TomlError("document contains excessively nested structures. aborting.", {
		toml: str,
		ptr
	});
	let c = str[ptr];
	if (c === "[" || c === "{") {
		let [value, endPtr] = c === "[" ? parseArray(str, ptr, depth, integersAsBigInt) : parseInlineTable(str, ptr, depth, integersAsBigInt);
		if (end) {
			endPtr = skipVoid(str, endPtr);
			if (str[endPtr] === ",") endPtr++;
			else if (str[endPtr] !== end) throw new TomlError("expected comma or end of structure", {
				toml: str,
				ptr: endPtr
			});
		}
		return [value, endPtr];
	}
	if (c === "\"" || c === "'") {
		let [parsed, endPtr] = parseString(str, ptr);
		if (end) {
			endPtr = skipVoid(str, endPtr);
			if (str[endPtr] && str[endPtr] !== "," && str[endPtr] !== end && str[endPtr] !== "\n" && str[endPtr] !== "\r") throw new TomlError("unexpected character encountered", {
				toml: str,
				ptr: endPtr
			});
			if (str[endPtr] === ",") endPtr++;
		}
		return [parsed, endPtr];
	}
	let endPtr = skipUntil(str, ptr, ",", end);
	let slice = sliceAndTrimEndOf(str, ptr, endPtr - (str[endPtr - 1] === "," ? 1 : 0));
	if (!slice[0]) throw new TomlError("incomplete key-value declaration: no value specified", {
		toml: str,
		ptr
	});
	if (end && slice[1] > -1) {
		endPtr = skipVoid(str, ptr + slice[1]);
		if (str[endPtr] === ",") endPtr++;
	}
	return [parseValue(slice[0], str, ptr, integersAsBigInt), endPtr];
}

//#endregion
//#region node_modules/.pnpm/smol-toml@1.7.0/node_modules/smol-toml/dist/struct.js
/*!
* Copyright (c) Squirrel Chat et al., All rights reserved.
* SPDX-License-Identifier: BSD-3-Clause
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice, this
*    list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright notice,
*    this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holder nor the names of its contributors
*    may be used to endorse or promote products derived from this software without
*    specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
* ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
* FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
* DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
* OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
let KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
function parseKey(str, ptr, end = "=") {
	let dot = ptr - 1;
	let parsed = [];
	let endPtr = str.indexOf(end, ptr);
	if (endPtr < 0) throw new TomlError("incomplete key-value: cannot find end of key", {
		toml: str,
		ptr
	});
	do {
		let c = str[ptr = ++dot];
		if (c !== " " && c !== "	") if (c === "\"" || c === "'") {
			if (c === str[ptr + 1] && c === str[ptr + 2]) throw new TomlError("multiline strings are not allowed in keys", {
				toml: str,
				ptr
			});
			let [part, eos] = parseString(str, ptr);
			dot = str.indexOf(".", eos);
			let strEnd = str.slice(eos, dot < 0 || dot > endPtr ? endPtr : dot);
			let newLine = indexOfNewline(strEnd);
			if (newLine > -1) throw new TomlError("newlines are not allowed in keys", {
				toml: str,
				ptr: ptr + dot + newLine
			});
			if (strEnd.trimStart()) throw new TomlError("found extra tokens after the string part", {
				toml: str,
				ptr: eos
			});
			if (endPtr < eos) {
				endPtr = str.indexOf(end, eos);
				if (endPtr < 0) throw new TomlError("incomplete key-value: cannot find end of key", {
					toml: str,
					ptr
				});
			}
			parsed.push(part);
		} else {
			dot = str.indexOf(".", ptr);
			let part = str.slice(ptr, dot < 0 || dot > endPtr ? endPtr : dot);
			if (!KEY_PART_RE.test(part)) throw new TomlError("only letter, numbers, dashes and underscores are allowed in keys", {
				toml: str,
				ptr
			});
			parsed.push(part.trimEnd());
		}
	} while (dot + 1 && dot < endPtr);
	return [parsed, skipVoid(str, endPtr + 1, true, true)];
}
function parseInlineTable(str, ptr, depth, integersAsBigInt) {
	let res = {};
	let seen = /* @__PURE__ */ new Set();
	let c;
	ptr++;
	while ((c = str[ptr++]) !== "}" && c) if (c === ",") throw new TomlError("expected value, found comma", {
		toml: str,
		ptr: ptr - 1
	});
	else if (c === "#") ptr = skipComment(str, ptr);
	else if (c !== " " && c !== "	" && c !== "\n" && c !== "\r") {
		let k;
		let t = res;
		let hasOwn = false;
		let [key, keyEndPtr] = parseKey(str, ptr - 1);
		for (let i = 0; i < key.length; i++) {
			if (i) t = hasOwn ? t[k] : t[k] = {};
			k = key[i];
			if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) throw new TomlError("trying to redefine an already defined value", {
				toml: str,
				ptr
			});
			if (!hasOwn && k === "__proto__") Object.defineProperty(t, k, {
				enumerable: true,
				configurable: true,
				writable: true
			});
		}
		if (hasOwn) throw new TomlError("trying to redefine an already defined value", {
			toml: str,
			ptr
		});
		let [value, valueEndPtr] = extractValue(str, keyEndPtr, "}", depth - 1, integersAsBigInt);
		seen.add(value);
		t[k] = value;
		ptr = valueEndPtr;
	}
	if (!c) throw new TomlError("unfinished table encountered", {
		toml: str,
		ptr
	});
	return [res, ptr];
}
function parseArray(str, ptr, depth, integersAsBigInt) {
	let res = [];
	let c;
	ptr++;
	while ((c = str[ptr++]) !== "]" && c) if (c === ",") throw new TomlError("expected value, found comma", {
		toml: str,
		ptr: ptr - 1
	});
	else if (c === "#") ptr = skipComment(str, ptr);
	else if (c !== " " && c !== "	" && c !== "\n" && c !== "\r") {
		let e = extractValue(str, ptr - 1, "]", depth - 1, integersAsBigInt);
		res.push(e[0]);
		ptr = e[1];
	}
	if (!c) throw new TomlError("unfinished array encountered", {
		toml: str,
		ptr
	});
	return [res, ptr];
}

//#endregion
//#region node_modules/.pnpm/smol-toml@1.7.0/node_modules/smol-toml/dist/parse.js
/*!
* Copyright (c) Squirrel Chat et al., All rights reserved.
* SPDX-License-Identifier: BSD-3-Clause
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice, this
*    list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright notice,
*    this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holder nor the names of its contributors
*    may be used to endorse or promote products derived from this software without
*    specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
* ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
* FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
* DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
* OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
function peekTable(key, table, meta, type) {
	let t = table;
	let m = meta;
	let k;
	let hasOwn = false;
	let state;
	for (let i = 0; i < key.length; i++) {
		if (i) {
			t = hasOwn ? t[k] : t[k] = {};
			m = (state = m[k]).c;
			if (type === 0 && (state.t === 1 || state.t === 2)) return null;
			if (state.t === 2) {
				let l = t.length - 1;
				t = t[l];
				m = m[l].c;
			}
		}
		k = key[i];
		if ((hasOwn = Object.hasOwn(t, k)) && m[k]?.t === 0 && m[k]?.d) return null;
		if (!hasOwn) {
			if (k === "__proto__") {
				Object.defineProperty(t, k, {
					enumerable: true,
					configurable: true,
					writable: true
				});
				Object.defineProperty(m, k, {
					enumerable: true,
					configurable: true,
					writable: true
				});
			}
			m[k] = {
				t: i < key.length - 1 && type === 2 ? 3 : type,
				d: false,
				i: 0,
				c: {}
			};
		}
	}
	state = m[k];
	if (state.t !== type && !(type === 1 && state.t === 3)) return null;
	if (type === 2) {
		if (!state.d) {
			state.d = true;
			t[k] = [];
		}
		t[k].push(t = {});
		state.c[state.i++] = state = {
			t: 1,
			d: false,
			i: 0,
			c: {}
		};
	}
	if (state.d) return null;
	state.d = true;
	if (type === 1) t = hasOwn ? t[k] : t[k] = {};
	else if (type === 0 && hasOwn) return null;
	return [
		k,
		t,
		state.c
	];
}
function parse(toml, { maxDepth = 1e3, integersAsBigInt } = {}) {
	let res = {};
	let meta = {};
	let tbl = res;
	let m = meta;
	for (let ptr = skipVoid(toml, 0); ptr < toml.length;) {
		if (toml[ptr] === "[") {
			let isTableArray = toml[++ptr] === "[";
			let k = parseKey(toml, ptr += +isTableArray, "]");
			if (isTableArray) {
				if (toml[k[1] - 1] !== "]") throw new TomlError("expected end of table declaration", {
					toml,
					ptr: k[1] - 1
				});
				k[1]++;
			}
			let p = peekTable(k[0], res, meta, isTableArray ? 2 : 1);
			if (!p) throw new TomlError("trying to redefine an already defined table or value", {
				toml,
				ptr
			});
			m = p[2];
			tbl = p[1];
			ptr = k[1];
		} else {
			let k = parseKey(toml, ptr);
			let p = peekTable(k[0], tbl, m, 0);
			if (!p) throw new TomlError("trying to redefine an already defined table or value", {
				toml,
				ptr
			});
			let v = extractValue(toml, k[1], void 0, maxDepth, integersAsBigInt);
			p[1][p[0]] = v[0];
			ptr = v[1];
		}
		ptr = skipVoid(toml, ptr, true);
		if (toml[ptr] && toml[ptr] !== "\n" && toml[ptr] !== "\r") throw new TomlError("each key-value declaration must be followed by an end-of-line", {
			toml,
			ptr
		});
		ptr = skipVoid(toml, ptr);
	}
	return res;
}

//#endregion
//#region src/collectors/project.ts
const IGNORED_DIRECTORIES = /* @__PURE__ */ new Set([
	".git",
	".pnpm",
	".turbo",
	".next",
	".nuxt",
	"node_modules",
	"dist",
	"build",
	"coverage",
	"target"
]);
const PROJECT_CACHE_MS = 3e4;
const PROJECT_CACHE_MAX_AGE_MS = 30 * 6e4;
const PROJECT_CACHE_MAX_ENTRIES = 32;
const projectCache = /* @__PURE__ */ new Map();
function isDirectory(value) {
	try {
		return fs.statSync(value).isDirectory();
	} catch {
		return false;
	}
}
function countNamedFiles(root, fileName, maxDepth = 6) {
	if (!isDirectory(root)) return 0;
	let count = 0;
	const visit = (directory, depth) => {
		if (depth > maxDepth) return;
		let entries;
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) if (entry.isFile() && entry.name === fileName) count += 1;
		else if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) visit(path.join(directory, entry.name), depth + 1);
	};
	visit(root, 0);
	return count;
}
function countFiles(root, predicate) {
	if (!isDirectory(root)) return 0;
	try {
		return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && predicate(entry.name)).length;
	} catch {
		return 0;
	}
}
function countSkillDirectories(root) {
	return countNamedFiles(root, "SKILL.md", 8);
}
function readToml(filePath) {
	try {
		const value = parse(fs.readFileSync(filePath, "utf8"));
		return value && typeof value === "object" ? value : {};
	} catch {
		return {};
	}
}
function tableSize(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).length : 0;
}
function hookCountFromJson(filePath) {
	try {
		const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
		const hooks = value.hooks && typeof value.hooks === "object" && !Array.isArray(value.hooks) ? value.hooks : value;
		return Object.values(hooks).reduce((total, entry) => total + (Array.isArray(entry) ? entry.length : 0), 0);
	} catch {
		return 0;
	}
}
function collectProjectInfo(cwd, workspaceRoots = [], env = process.env, includeCounts = true, now = Date.now()) {
	const codexHome = getCodexHome(env);
	const projectRoot = findGitRoot(cwd) ?? path.resolve(cwd);
	const roots = Array.from(/* @__PURE__ */ new Set([projectRoot, ...workspaceRoots.map((root) => path.resolve(root))]));
	const cacheKey = `${codexHome}:${projectRoot}:${includeCounts}:${roots.join("\0")}`;
	const cached = projectCache.get(cacheKey);
	if (cached && now - cached.at < PROJECT_CACHE_MS) return structuredClone(cached.value);
	const globalConfigPath = path.join(codexHome, "config.toml");
	const projectConfigPath = path.join(projectRoot, ".codex", "config.toml");
	const globalConfig = includeCounts ? readToml(globalConfigPath) : {};
	const projectConfig = includeCounts ? readToml(projectConfigPath) : {};
	const configCount = includeCounts ? [globalConfigPath, projectConfigPath].filter((filePath) => fs.existsSync(filePath)).length : 0;
	const globalHooksPath = path.join(codexHome, "hooks.json");
	const projectHooksPath = path.join(projectRoot, ".codex", "hooks.json");
	const value = {
		cwd: path.resolve(cwd),
		projectRoot,
		projectName: path.basename(projectRoot),
		workspaceRoots: roots,
		agentsMdCount: includeCounts ? roots.reduce((total, root) => total + countNamedFiles(root, "AGENTS.md"), 0) : 0,
		codexConfigCount: includeCounts ? configCount : 0,
		rulesCount: includeCounts ? countFiles(path.join(codexHome, "rules"), (name) => name.endsWith(".rules")) + countFiles(path.join(projectRoot, ".codex", "rules"), (name) => name.endsWith(".rules")) : 0,
		hooksCount: includeCounts ? hookCountFromJson(globalHooksPath) + hookCountFromJson(projectHooksPath) + tableSize(globalConfig.hooks) + tableSize(projectConfig.hooks) : 0,
		skillsCount: includeCounts ? countSkillDirectories(path.join(codexHome, "skills")) + countSkillDirectories(path.join(projectRoot, ".codex", "skills")) : 0,
		pluginsCount: includeCounts ? tableSize(globalConfig.plugins) + tableSize(projectConfig.plugins) : 0,
		mcpCount: includeCounts ? tableSize(globalConfig.mcp_servers) + tableSize(projectConfig.mcp_servers) : 0
	};
	setTimedCache(projectCache, cacheKey, {
		at: now,
		value
	}, PROJECT_CACHE_MAX_AGE_MS, PROJECT_CACHE_MAX_ENTRIES);
	return structuredClone(value);
}

//#endregion
//#region src/collectors/session-metadata.ts
const titleCache = /* @__PURE__ */ new Map();
const authCache = /* @__PURE__ */ new Map();
const METADATA_CACHE_MS = 3e4;
const METADATA_CACHE_MAX_AGE_MS = 30 * 6e4;
const METADATA_CACHE_MAX_ENTRIES = 256;
function record(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function decodeJwt(value) {
	const payload = value.split(".")[1];
	if (!payload) return null;
	try {
		return record(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
	} catch {
		return null;
	}
}
function findString(value, keys, depth = 0) {
	if (depth > 5) return null;
	const item = record(value);
	if (!item) return null;
	for (const [key, child] of Object.entries(item)) if (keys.has(key.toLowerCase()) && typeof child === "string" && child.trim()) return child.trim();
	for (const child of Object.values(item)) {
		const found = findString(child, keys, depth + 1);
		if (found) return found;
	}
	return null;
}
function jwtUser(value, depth = 0) {
	if (depth > 5) return null;
	if (typeof value === "string") {
		const email = findString(decodeJwt(value), /* @__PURE__ */ new Set([
			"email",
			"preferred_username",
			"name"
		]));
		return email ? email.split("@")[0] : null;
	}
	const item = record(value);
	if (!item) return null;
	for (const child of Object.values(item)) {
		const found = jwtUser(child, depth + 1);
		if (found) return found;
	}
	return null;
}
const GENERIC_SUFFIX = /^(?:com|co|net|org|edu|gov|ac|or|ne|gob|mil|int)$/;
function providerLabel(baseUrl) {
	let hostname;
	try {
		hostname = new URL(baseUrl).hostname;
	} catch {
		return null;
	}
	const bare = hostname.replace(/^www\./, "").replace(/^\[|\]$/g, "").replace(/\.$/, "");
	if (!bare) return null;
	if (/^[\d.]+$/.test(bare) || bare.includes(":")) return bare;
	const labels = bare.split(".");
	const index = labels.length - 2;
	if (index < 0) return bare;
	return index > 0 && GENERIC_SUFFIX.test(labels[index]) ? labels[index - 1] : labels[index];
}
function isChatGptEndpoint(baseUrl) {
	if (!baseUrl) return false;
	try {
		const hostname = new URL(baseUrl).hostname.toLowerCase();
		return hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com");
	} catch {
		return false;
	}
}
/**
* The endpoint declared in config.toml is only evidence about a session if the
* file has not been rewritten since Codex read it at session start. Before a
* session is bound the HUD has nothing to attribute the file to, so it must not
* borrow the label: that window is exactly Codex's startup, when a provider the
* user just switched away from is still the newest thing on disk.
*/
function configuredBaseUrl(session, env) {
	try {
		const configPath = path.join(getCodexHome(env), "config.toml");
		if (fs.statSync(configPath).mtimeMs > session.startTime.getTime()) return null;
		const config = record(parse(fs.readFileSync(configPath, "utf8")));
		const providerName = session?.modelProvider ?? (typeof config?.model_provider === "string" ? config.model_provider : null);
		if (!providerName) return null;
		const provider = record(record(config?.model_providers)?.[providerName]);
		return typeof provider?.base_url === "string" ? provider.base_url : null;
	} catch {
		return null;
	}
}
function collectAuthInfo(planType, session = null, env = process.env, codexProcess = null) {
	const cacheKey = `${getCodexHome(env)}:${planType ?? ""}:${session?.id ?? codexProcess?.pid ?? ""}:${Boolean(env.OPENAI_API_KEY)}`;
	const cached = authCache.get(cacheKey);
	if (cached && Date.now() - cached.at < METADATA_CACHE_MS) return cached.value ? structuredClone(cached.value) : null;
	const authPath = path.join(getCodexHome(env), "auth.json");
	let auth = {};
	try {
		auth = record(JSON.parse(fs.readFileSync(authPath, "utf8"))) ?? {};
	} catch {}
	const hasApiKey = typeof auth.OPENAI_API_KEY === "string" || Boolean(env.OPENAI_API_KEY);
	const user = jwtUser(auth) ?? findString(auth, /* @__PURE__ */ new Set([
		"email",
		"preferred_username",
		"username"
	]))?.split("@")[0];
	const endpoint = session ? resolveSessionEndpoint(session.id, env) : codexProcess && resolveProcessEndpoint(codexProcess.pid, codexProcess.launchedAt, env);
	const baseUrl = session ? endpoint?.url ?? configuredBaseUrl(session, env) : endpoint?.url ?? null;
	if (planType && (isChatGptEndpoint(baseUrl) || !hasApiKey)) {
		const value = {
			method: `ChatGPT ${planType}`,
			user: user ?? void 0
		};
		setTimedCache(authCache, cacheKey, {
			at: Date.now(),
			value
		}, METADATA_CACHE_MAX_AGE_MS, METADATA_CACHE_MAX_ENTRIES);
		return structuredClone(value);
	}
	if (hasApiKey) {
		const value = { method: (baseUrl ? providerLabel(baseUrl) : null) || "API Key" };
		setTimedCache(authCache, cacheKey, {
			at: Date.now(),
			value
		}, METADATA_CACHE_MAX_AGE_MS, METADATA_CACHE_MAX_ENTRIES);
		return value;
	}
	if (Object.keys(auth).length > 0) {
		const value = {
			method: "ChatGPT",
			user: user ?? void 0
		};
		setTimedCache(authCache, cacheKey, {
			at: Date.now(),
			value
		}, METADATA_CACHE_MAX_AGE_MS, METADATA_CACHE_MAX_ENTRIES);
		return structuredClone(value);
	}
	setTimedCache(authCache, cacheKey, {
		at: Date.now(),
		value: null
	}, METADATA_CACHE_MAX_AGE_MS, METADATA_CACHE_MAX_ENTRIES);
	return null;
}
function collectSessionTitle(session, env = process.env) {
	if (!session) return null;
	const cacheKey = `${getCodexHome(env)}:${session.id}`;
	const cached = titleCache.get(cacheKey);
	if (cached && Date.now() - cached.at < METADATA_CACHE_MS) return cached.title;
	const database = path.join(getCodexHome(env), "state_5.sqlite");
	if (!fs.existsSync(database)) {
		setTimedCache(titleCache, cacheKey, {
			at: Date.now(),
			title: null
		}, METADATA_CACHE_MAX_AGE_MS, METADATA_CACHE_MAX_ENTRIES);
		return null;
	}
	const result = spawnSync("sqlite3", [
		database,
		"-noheader",
		"-batch",
		`SELECT CASE WHEN title <> first_user_message THEN title ELSE '' END FROM threads WHERE id='${session.id.replaceAll("'", "''")}' LIMIT 1;`
	], {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		],
		timeout: 750
	});
	if (result.status !== 0) {
		setTimedCache(titleCache, cacheKey, {
			at: Date.now(),
			title: null
		}, METADATA_CACHE_MAX_AGE_MS, METADATA_CACHE_MAX_ENTRIES);
		return null;
	}
	const title = result.stdout.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
	const normalized = title ? title.slice(0, 80) : null;
	setTimedCache(titleCache, cacheKey, {
		at: Date.now(),
		title: normalized
	}, METADATA_CACHE_MAX_AGE_MS, METADATA_CACHE_MAX_ENTRIES);
	return normalized;
}

//#endregion
//#region src/runtime/state.ts
function buildHudState(cwd, rollout, sessionStart, config, now = /* @__PURE__ */ new Date(), codexProcess = null, loggedUsage = null, queriedUsage = null, endpoint = null) {
	const workspaceRoots = rollout.session?.workspaceRoots ?? [];
	const usage = resolveUsageData(trustedUsageDataForEndpoint(endpoint, rollout.usage, loggedUsage), config.display, now);
	const title = config.display.showSessionName ? collectSessionTitle(rollout.session) : null;
	const session = rollout.session ? {
		...rollout.session,
		sessionName: title ?? rollout.session.sessionName
	} : null;
	const auth = config.display.showAuth ? collectAuthInfo(usage?.planType ?? null, session, process.env, codexProcess) : null;
	return {
		session,
		project: collectProjectInfo(cwd, workspaceRoots, process.env, config.display.showConfigCounts),
		git: config.gitStatus.enabled ? collectGitStatus(cwd) : null,
		context: rollout.context,
		usage,
		sessionTokens: rollout.sessionTokens,
		tools: rollout.tools,
		images: rollout.images,
		skills: rollout.skills,
		mcpServers: rollout.mcpServers,
		agents: config.display.showAgents ? collectAgentEntries(session) : [],
		todos: rollout.todos,
		goal: rollout.goal,
		conversationTurns: rollout.conversationTurns,
		compactCount: rollout.compactCount,
		memory: config.display.showMemoryUsage ? collectMemoryInfo() : null,
		auth: auth && queriedUsage?.balanceLabel ? {
			...auth,
			balanceLabel: queriedUsage.balanceLabel
		} : auth,
		sessionStart: session?.startTime ?? sessionStart
	};
}

//#endregion
export { getConfigPath as C, getCodexHome as S, getLegacyStateDirectory as T, isOfficialOpenAIEndpoint as _, rawConfigVersion as a, resolveSessionEndpoint as b, readCachedConfiguredExternalUsage as c, isSubagentSource as d, listSessionCandidates as f, findCodexLogDatabase as g, endpointOrigin as h, applyConfigMigrations as i, readConfiguredExternalUsage as l, normalizeRateLimits as m, loadConfig as n, DEFAULT_CONFIG as o, RolloutParser as p, reloadConfig as r, DEFAULT_GENERAL_EXTERNAL_USAGE_QUERY as s, buildHudState as t, findActiveSession as u, resolveProcessEndpoint as v, getHudStateDirectory as w, setTimedCache as x, resolveProcessSession as y };
//# sourceMappingURL=state-CVI_806k.mjs.map
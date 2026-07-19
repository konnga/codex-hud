import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

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
		primary: normalizeWindow(raw.primary, "5h"),
		secondary: normalizeWindow(raw.secondary, "7d"),
		individual: normalizeWindow(raw.individual_limit, "spend", true),
		planType: typeof raw.plan_type === "string" ? raw.plan_type : null,
		balanceLabel: balance,
		limitReachedType: typeof raw.rate_limit_reached_type === "string" ? raw.rate_limit_reached_type : raw.spend_control_reached === true ? "spend_control_reached" : null
	};
}

//#endregion
//#region src/codex/rollout-parser.ts
const MAX_TARGET_LENGTH = 80;
function initialState() {
	return {
		session: null,
		context: null,
		usage: null,
		sessionTokens: null,
		tools: [],
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
		this.latestTokenUsage = null;
	}
	getState() {
		return structuredClone(this.state);
	}
	parse() {
		if (!this.filePath) return this.getState();
		const result = this.tail.read(this.filePath);
		if (result.reset) {
			this.state = initialState();
			this.runningTools.clear();
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
			this.runningTools.delete(payload.call_id);
			return;
		}
		if (payload.type === "message" && payload.role === "assistant" && this.state.session) this.state.session.lastResponseAt = timestamp;
	}
	onEvent(payload, timestamp) {
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
function normalizedPath$1(value) {
	const resolved = realPath(value);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function isWithinProject(candidateCwd, targetCwd) {
	const candidate = normalizedPath$1(candidateCwd);
	const target = normalizedPath$1(targetCwd);
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
//#region src/types/config.ts
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
		showFileStats: false,
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
		showAuth: false,
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
	if (value === "zh") return "zh-Hans";
	if (value === "zh-TW") return "zh-Hant";
	return enumValue(value, [
		"en",
		"zh-Hans",
		"zh-Hant"
	], fallback);
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
//#region src/config/load.ts
function loadConfig(env = process.env) {
	const configPath = getConfigPath(env);
	try {
		const source = fs.readFileSync(configPath, "utf8");
		const parsed = JSON.parse(source);
		const raw = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
		return {
			config: validateConfig(raw),
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

//#endregion
//#region src/render/colors.ts
const RESET = "\x1B[0m";
const NAMED_CODES = {
	dim: 2,
	red: 31,
	green: 32,
	yellow: 33,
	magenta: 35,
	cyan: 36,
	brightBlue: 94,
	brightMagenta: 95
};
function color(text, value, enabled) {
	if (!enabled || !text) return text;
	if (typeof value === "number") return `\u001B[38;5;${value}m${text}${RESET}`;
	if (/^#[0-9a-f]{6}$/i.test(value)) return `\u001B[38;2;${Number.parseInt(value.slice(1, 3), 16)};${Number.parseInt(value.slice(3, 5), 16)};${Number.parseInt(value.slice(5, 7), 16)}m${text}${RESET}`;
	const code = NAMED_CODES[value];
	return code ? `\u001B[${code}m${text}${RESET}` : text;
}
function statusColor(percent, base, warning, critical, warningThreshold, criticalThreshold) {
	if (percent >= criticalThreshold) return critical;
	if (percent >= warningThreshold) return warning;
	return base;
}

//#endregion
//#region node_modules/.pnpm/ansi-styles@6.2.3/node_modules/ansi-styles/index.js
const ANSI_BACKGROUND_OFFSET = 10;
const wrapAnsi16 = (offset = 0) => (code) => `\u001B[${code + offset}m`;
const wrapAnsi256 = (offset = 0) => (code) => `\u001B[${38 + offset};5;${code}m`;
const wrapAnsi16m = (offset = 0) => (red, green, blue) => `\u001B[${38 + offset};2;${red};${green};${blue}m`;
const styles = {
	modifier: {
		reset: [0, 0],
		bold: [1, 22],
		dim: [2, 22],
		italic: [3, 23],
		underline: [4, 24],
		overline: [53, 55],
		inverse: [7, 27],
		hidden: [8, 28],
		strikethrough: [9, 29]
	},
	color: {
		black: [30, 39],
		red: [31, 39],
		green: [32, 39],
		yellow: [33, 39],
		blue: [34, 39],
		magenta: [35, 39],
		cyan: [36, 39],
		white: [37, 39],
		blackBright: [90, 39],
		gray: [90, 39],
		grey: [90, 39],
		redBright: [91, 39],
		greenBright: [92, 39],
		yellowBright: [93, 39],
		blueBright: [94, 39],
		magentaBright: [95, 39],
		cyanBright: [96, 39],
		whiteBright: [97, 39]
	},
	bgColor: {
		bgBlack: [40, 49],
		bgRed: [41, 49],
		bgGreen: [42, 49],
		bgYellow: [43, 49],
		bgBlue: [44, 49],
		bgMagenta: [45, 49],
		bgCyan: [46, 49],
		bgWhite: [47, 49],
		bgBlackBright: [100, 49],
		bgGray: [100, 49],
		bgGrey: [100, 49],
		bgRedBright: [101, 49],
		bgGreenBright: [102, 49],
		bgYellowBright: [103, 49],
		bgBlueBright: [104, 49],
		bgMagentaBright: [105, 49],
		bgCyanBright: [106, 49],
		bgWhiteBright: [107, 49]
	}
};
const modifierNames = Object.keys(styles.modifier);
const foregroundColorNames = Object.keys(styles.color);
const backgroundColorNames = Object.keys(styles.bgColor);
const colorNames = [...foregroundColorNames, ...backgroundColorNames];
function assembleStyles() {
	const codes = /* @__PURE__ */ new Map();
	for (const [groupName, group] of Object.entries(styles)) {
		for (const [styleName, style] of Object.entries(group)) {
			styles[styleName] = {
				open: `\u001B[${style[0]}m`,
				close: `\u001B[${style[1]}m`
			};
			group[styleName] = styles[styleName];
			codes.set(style[0], style[1]);
		}
		Object.defineProperty(styles, groupName, {
			value: group,
			enumerable: false
		});
	}
	Object.defineProperty(styles, "codes", {
		value: codes,
		enumerable: false
	});
	styles.color.close = "\x1B[39m";
	styles.bgColor.close = "\x1B[49m";
	styles.color.ansi = wrapAnsi16();
	styles.color.ansi256 = wrapAnsi256();
	styles.color.ansi16m = wrapAnsi16m();
	styles.bgColor.ansi = wrapAnsi16(ANSI_BACKGROUND_OFFSET);
	styles.bgColor.ansi256 = wrapAnsi256(ANSI_BACKGROUND_OFFSET);
	styles.bgColor.ansi16m = wrapAnsi16m(ANSI_BACKGROUND_OFFSET);
	Object.defineProperties(styles, {
		rgbToAnsi256: {
			value(red, green, blue) {
				if (red === green && green === blue) {
					if (red < 8) return 16;
					if (red > 248) return 231;
					return Math.round((red - 8) / 247 * 24) + 232;
				}
				return 16 + 36 * Math.round(red / 255 * 5) + 6 * Math.round(green / 255 * 5) + Math.round(blue / 255 * 5);
			},
			enumerable: false
		},
		hexToRgb: {
			value(hex) {
				const matches = /[a-f\d]{6}|[a-f\d]{3}/i.exec(hex.toString(16));
				if (!matches) return [
					0,
					0,
					0
				];
				let [colorString] = matches;
				if (colorString.length === 3) colorString = [...colorString].map((character) => character + character).join("");
				const integer = Number.parseInt(colorString, 16);
				return [
					integer >> 16 & 255,
					integer >> 8 & 255,
					integer & 255
				];
			},
			enumerable: false
		},
		hexToAnsi256: {
			value: (hex) => styles.rgbToAnsi256(...styles.hexToRgb(hex)),
			enumerable: false
		},
		ansi256ToAnsi: {
			value(code) {
				if (code < 8) return 30 + code;
				if (code < 16) return 90 + (code - 8);
				let red;
				let green;
				let blue;
				if (code >= 232) {
					red = ((code - 232) * 10 + 8) / 255;
					green = red;
					blue = red;
				} else {
					code -= 16;
					const remainder = code % 36;
					red = Math.floor(code / 36) / 5;
					green = Math.floor(remainder / 6) / 5;
					blue = remainder % 6 / 5;
				}
				const value = Math.max(red, green, blue) * 2;
				if (value === 0) return 30;
				let result = 30 + (Math.round(blue) << 2 | Math.round(green) << 1 | Math.round(red));
				if (value === 2) result += 60;
				return result;
			},
			enumerable: false
		},
		rgbToAnsi: {
			value: (red, green, blue) => styles.ansi256ToAnsi(styles.rgbToAnsi256(red, green, blue)),
			enumerable: false
		},
		hexToAnsi: {
			value: (hex) => styles.ansi256ToAnsi(styles.hexToAnsi256(hex)),
			enumerable: false
		}
	});
	return styles;
}
const ansiStyles = assembleStyles();

//#endregion
//#region node_modules/.pnpm/get-east-asian-width@1.6.0/node_modules/get-east-asian-width/lookup-data.js
const ambiguousMaximumCodePoint = 1114109;
const ambiguousRanges = [
	161,
	161,
	164,
	164,
	167,
	168,
	170,
	170,
	173,
	174,
	176,
	180,
	182,
	186,
	188,
	191,
	198,
	198,
	208,
	208,
	215,
	216,
	222,
	225,
	230,
	230,
	232,
	234,
	236,
	237,
	240,
	240,
	242,
	243,
	247,
	250,
	252,
	252,
	254,
	254,
	257,
	257,
	273,
	273,
	275,
	275,
	283,
	283,
	294,
	295,
	299,
	299,
	305,
	307,
	312,
	312,
	319,
	322,
	324,
	324,
	328,
	331,
	333,
	333,
	338,
	339,
	358,
	359,
	363,
	363,
	462,
	462,
	464,
	464,
	466,
	466,
	468,
	468,
	470,
	470,
	472,
	472,
	474,
	474,
	476,
	476,
	593,
	593,
	609,
	609,
	708,
	708,
	711,
	711,
	713,
	715,
	717,
	717,
	720,
	720,
	728,
	731,
	733,
	733,
	735,
	735,
	768,
	879,
	913,
	929,
	931,
	937,
	945,
	961,
	963,
	969,
	1025,
	1025,
	1040,
	1103,
	1105,
	1105,
	8208,
	8208,
	8211,
	8214,
	8216,
	8217,
	8220,
	8221,
	8224,
	8226,
	8228,
	8231,
	8240,
	8240,
	8242,
	8243,
	8245,
	8245,
	8251,
	8251,
	8254,
	8254,
	8308,
	8308,
	8319,
	8319,
	8321,
	8324,
	8364,
	8364,
	8451,
	8451,
	8453,
	8453,
	8457,
	8457,
	8467,
	8467,
	8470,
	8470,
	8481,
	8482,
	8486,
	8486,
	8491,
	8491,
	8531,
	8532,
	8539,
	8542,
	8544,
	8555,
	8560,
	8569,
	8585,
	8585,
	8592,
	8601,
	8632,
	8633,
	8658,
	8658,
	8660,
	8660,
	8679,
	8679,
	8704,
	8704,
	8706,
	8707,
	8711,
	8712,
	8715,
	8715,
	8719,
	8719,
	8721,
	8721,
	8725,
	8725,
	8730,
	8730,
	8733,
	8736,
	8739,
	8739,
	8741,
	8741,
	8743,
	8748,
	8750,
	8750,
	8756,
	8759,
	8764,
	8765,
	8776,
	8776,
	8780,
	8780,
	8786,
	8786,
	8800,
	8801,
	8804,
	8807,
	8810,
	8811,
	8814,
	8815,
	8834,
	8835,
	8838,
	8839,
	8853,
	8853,
	8857,
	8857,
	8869,
	8869,
	8895,
	8895,
	8978,
	8978,
	9312,
	9449,
	9451,
	9547,
	9552,
	9587,
	9600,
	9615,
	9618,
	9621,
	9632,
	9633,
	9635,
	9641,
	9650,
	9651,
	9654,
	9655,
	9660,
	9661,
	9664,
	9665,
	9670,
	9672,
	9675,
	9675,
	9678,
	9681,
	9698,
	9701,
	9711,
	9711,
	9733,
	9734,
	9737,
	9737,
	9742,
	9743,
	9756,
	9756,
	9758,
	9758,
	9792,
	9792,
	9794,
	9794,
	9824,
	9825,
	9827,
	9829,
	9831,
	9834,
	9836,
	9837,
	9839,
	9839,
	9886,
	9887,
	9919,
	9919,
	9926,
	9933,
	9935,
	9939,
	9941,
	9953,
	9955,
	9955,
	9960,
	9961,
	9963,
	9969,
	9972,
	9972,
	9974,
	9977,
	9979,
	9980,
	9982,
	9983,
	10045,
	10045,
	10102,
	10111,
	11094,
	11097,
	12872,
	12879,
	57344,
	63743,
	65024,
	65039,
	65533,
	65533,
	127232,
	127242,
	127248,
	127277,
	127280,
	127337,
	127344,
	127373,
	127375,
	127376,
	127387,
	127404,
	917760,
	917999,
	983040,
	1048573,
	1048576,
	1114109
];
const fullwidthMinimalCodePoint = 12288;
const fullwidthMaximumCodePoint = 65510;
const fullwidthRanges = [
	12288,
	12288,
	65281,
	65376,
	65504,
	65510
];
const wideMinimalCodePoint = 4352;
const wideMaximumCodePoint = 262141;
const wideRanges = [
	4352,
	4447,
	8986,
	8987,
	9001,
	9002,
	9193,
	9196,
	9200,
	9200,
	9203,
	9203,
	9725,
	9726,
	9748,
	9749,
	9776,
	9783,
	9800,
	9811,
	9855,
	9855,
	9866,
	9871,
	9875,
	9875,
	9889,
	9889,
	9898,
	9899,
	9917,
	9918,
	9924,
	9925,
	9934,
	9934,
	9940,
	9940,
	9962,
	9962,
	9970,
	9971,
	9973,
	9973,
	9978,
	9978,
	9981,
	9981,
	9989,
	9989,
	9994,
	9995,
	10024,
	10024,
	10060,
	10060,
	10062,
	10062,
	10067,
	10069,
	10071,
	10071,
	10133,
	10135,
	10160,
	10160,
	10175,
	10175,
	11035,
	11036,
	11088,
	11088,
	11093,
	11093,
	11904,
	11929,
	11931,
	12019,
	12032,
	12245,
	12272,
	12287,
	12289,
	12350,
	12353,
	12438,
	12441,
	12543,
	12549,
	12591,
	12593,
	12686,
	12688,
	12773,
	12783,
	12830,
	12832,
	12871,
	12880,
	42124,
	42128,
	42182,
	43360,
	43388,
	44032,
	55203,
	63744,
	64255,
	65040,
	65049,
	65072,
	65106,
	65108,
	65126,
	65128,
	65131,
	94176,
	94180,
	94192,
	94198,
	94208,
	101589,
	101631,
	101662,
	101760,
	101874,
	110576,
	110579,
	110581,
	110587,
	110589,
	110590,
	110592,
	110882,
	110898,
	110898,
	110928,
	110930,
	110933,
	110933,
	110948,
	110951,
	110960,
	111355,
	119552,
	119638,
	119648,
	119670,
	126980,
	126980,
	127183,
	127183,
	127374,
	127374,
	127377,
	127386,
	127488,
	127490,
	127504,
	127547,
	127552,
	127560,
	127568,
	127569,
	127584,
	127589,
	127744,
	127776,
	127789,
	127797,
	127799,
	127868,
	127870,
	127891,
	127904,
	127946,
	127951,
	127955,
	127968,
	127984,
	127988,
	127988,
	127992,
	128062,
	128064,
	128064,
	128066,
	128252,
	128255,
	128317,
	128331,
	128334,
	128336,
	128359,
	128378,
	128378,
	128405,
	128406,
	128420,
	128420,
	128507,
	128591,
	128640,
	128709,
	128716,
	128716,
	128720,
	128722,
	128725,
	128728,
	128732,
	128735,
	128747,
	128748,
	128756,
	128764,
	128992,
	129003,
	129008,
	129008,
	129292,
	129338,
	129340,
	129349,
	129351,
	129535,
	129648,
	129660,
	129664,
	129674,
	129678,
	129734,
	129736,
	129736,
	129741,
	129756,
	129759,
	129770,
	129775,
	129784,
	131072,
	196605,
	196608,
	262141
];

//#endregion
//#region node_modules/.pnpm/get-east-asian-width@1.6.0/node_modules/get-east-asian-width/utilities.js
/**
Binary search on a sorted flat array of [start, end] pairs.

@param {number[]} ranges - Flat array of inclusive [start, end] range pairs, e.g. [0, 5, 10, 20].
@param {number} codePoint - The value to search for.
@returns {boolean} Whether the value falls within any of the ranges.
*/
const isInRange = (ranges, codePoint) => {
	let low = 0;
	let high = Math.floor(ranges.length / 2) - 1;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const i = mid * 2;
		if (codePoint < ranges[i]) high = mid - 1;
		else if (codePoint > ranges[i + 1]) low = mid + 1;
		else return true;
	}
	return false;
};

//#endregion
//#region node_modules/.pnpm/get-east-asian-width@1.6.0/node_modules/get-east-asian-width/lookup.js
const commonCjkCodePoint = 19968;
const [wideFastPathStart, wideFastPathEnd] = /* #__PURE__ */ findWideFastPathRange(wideRanges);
function findWideFastPathRange(ranges) {
	let fastPathStart = ranges[0];
	let fastPathEnd = ranges[1];
	for (let index = 0; index < ranges.length; index += 2) {
		const start = ranges[index];
		const end = ranges[index + 1];
		if (commonCjkCodePoint >= start && commonCjkCodePoint <= end) return [start, end];
		if (end - start > fastPathEnd - fastPathStart) {
			fastPathStart = start;
			fastPathEnd = end;
		}
	}
	return [fastPathStart, fastPathEnd];
}
const isAmbiguous = (codePoint) => {
	if (codePoint < 161 || codePoint > 1114109) return false;
	return isInRange(ambiguousRanges, codePoint);
};
const isFullWidth = (codePoint) => {
	if (codePoint < 12288 || codePoint > 65510) return false;
	return isInRange(fullwidthRanges, codePoint);
};
const isWide = (codePoint) => {
	if (codePoint >= wideFastPathStart && codePoint <= wideFastPathEnd) return true;
	if (codePoint < 4352 || codePoint > 262141) return false;
	return isInRange(wideRanges, codePoint);
};

//#endregion
//#region node_modules/.pnpm/get-east-asian-width@1.6.0/node_modules/get-east-asian-width/index.js
function validate(codePoint) {
	if (!Number.isSafeInteger(codePoint)) throw new TypeError(`Expected a code point, got \`${typeof codePoint}\`.`);
}
function eastAsianWidth(codePoint, { ambiguousAsWide = false } = {}) {
	validate(codePoint);
	if (isFullWidth(codePoint) || isWide(codePoint) || ambiguousAsWide && isAmbiguous(codePoint)) return 2;
	return 1;
}

//#endregion
//#region node_modules/.pnpm/is-fullwidth-code-point@5.1.0/node_modules/is-fullwidth-code-point/index.js
function isFullwidthCodePoint(codePoint) {
	if (!Number.isInteger(codePoint)) return false;
	return isFullWidth(codePoint) || isWide(codePoint);
}

//#endregion
//#region node_modules/.pnpm/slice-ansi@9.0.0/node_modules/slice-ansi/tokenize-ansi.js
const ESCAPE_CODE_POINT = 27;
const C1_DCS_CODE_POINT = 144;
const C1_SOS_CODE_POINT = 152;
const C1_CSI_CODE_POINT = 155;
const C1_ST_CODE_POINT = 156;
const C1_OSC_CODE_POINT = 157;
const C1_PM_CODE_POINT = 158;
const C1_APC_CODE_POINT = 159;
const ESCAPES = /* @__PURE__ */ new Set([
	ESCAPE_CODE_POINT,
	C1_DCS_CODE_POINT,
	C1_SOS_CODE_POINT,
	C1_CSI_CODE_POINT,
	C1_ST_CODE_POINT,
	C1_OSC_CODE_POINT,
	C1_PM_CODE_POINT,
	C1_APC_CODE_POINT
]);
const ESCAPE = "\x1B";
const ANSI_BELL = "\x07";
const ANSI_CSI = "[";
const ANSI_OSC = "]";
const ANSI_DCS = "P";
const ANSI_SOS = "X";
const ANSI_PM = "^";
const ANSI_APC = "_";
const ANSI_SGR_TERMINATOR = "m";
const ANSI_OSC_TERMINATOR = "\\";
const ANSI_STRING_TERMINATOR = `${ESCAPE}${ANSI_OSC_TERMINATOR}`;
const C1_OSC = "";
const C1_STRING_TERMINATOR = "";
const ANSI_HYPERLINK_ESC_PREFIX = `${ESCAPE}${ANSI_OSC}8;`;
const ANSI_HYPERLINK_C1_PREFIX = `${C1_OSC}8;`;
const ANSI_HYPERLINK_ESC_CLOSE = `${ANSI_HYPERLINK_ESC_PREFIX};`;
const ANSI_HYPERLINK_C1_CLOSE = `${ANSI_HYPERLINK_C1_PREFIX};`;
const CODE_POINT_0 = "0".codePointAt(0);
const CODE_POINT_9 = "9".codePointAt(0);
const CODE_POINT_SEMICOLON = ";".codePointAt(0);
const CODE_POINT_COLON = ":".codePointAt(0);
const CODE_POINT_CSI_PARAMETER_START = "0".codePointAt(0);
const CODE_POINT_CSI_PARAMETER_END = "?".codePointAt(0);
const CODE_POINT_CSI_INTERMEDIATE_START = " ".codePointAt(0);
const CODE_POINT_CSI_INTERMEDIATE_END = "/".codePointAt(0);
const CODE_POINT_CSI_FINAL_START = "@".codePointAt(0);
const CODE_POINT_CSI_FINAL_END = "~".codePointAt(0);
const REGIONAL_INDICATOR_SYMBOL_LETTER_A = 127462;
const REGIONAL_INDICATOR_SYMBOL_LETTER_Z = 127487;
const SGR_RESET_CODE = 0;
const SGR_EXTENDED_FOREGROUND_CODE = 38;
const SGR_DEFAULT_FOREGROUND_CODE = 39;
const SGR_EXTENDED_BACKGROUND_CODE = 48;
const SGR_DEFAULT_BACKGROUND_CODE = 49;
const SGR_COLOR_TYPE_ANSI_256 = 5;
const SGR_COLOR_TYPE_TRUECOLOR = 2;
const SGR_ANSI_256_FRAGMENT_LENGTH = 3;
const SGR_TRUECOLOR_FRAGMENT_LENGTH = 5;
const SGR_ANSI_256_LAST_PARAMETER_OFFSET = 2;
const SGR_TRUECOLOR_LAST_PARAMETER_OFFSET = 4;
const VARIATION_SELECTOR_16_CODE_POINT = 65039;
const COMBINING_ENCLOSING_KEYCAP_CODE_POINT = 8419;
const EMOJI_PRESENTATION_GRAPHEME_REGEX = /\p{Emoji_Presentation}/v;
const GRAPHEME_SEGMENTER = new Intl.Segmenter(void 0, { granularity: "grapheme" });
const endCodeNumbers = /* @__PURE__ */ new Set();
for (const [, end] of ansiStyles.codes) endCodeNumbers.add(end);
function isSgrParameterCharacter(codePoint) {
	return codePoint >= CODE_POINT_0 && codePoint <= CODE_POINT_9 || codePoint === CODE_POINT_SEMICOLON || codePoint === CODE_POINT_COLON;
}
function isCsiParameterCharacter(codePoint) {
	return codePoint >= CODE_POINT_CSI_PARAMETER_START && codePoint <= CODE_POINT_CSI_PARAMETER_END;
}
function isCsiIntermediateCharacter(codePoint) {
	return codePoint >= CODE_POINT_CSI_INTERMEDIATE_START && codePoint <= CODE_POINT_CSI_INTERMEDIATE_END;
}
function isCsiFinalCharacter(codePoint) {
	return codePoint >= CODE_POINT_CSI_FINAL_START && codePoint <= CODE_POINT_CSI_FINAL_END;
}
function isRegionalIndicatorCodePoint(codePoint) {
	return codePoint >= REGIONAL_INDICATOR_SYMBOL_LETTER_A && codePoint <= REGIONAL_INDICATOR_SYMBOL_LETTER_Z;
}
function createControlParseResult(code, endIndex) {
	return {
		token: {
			type: "control",
			code
		},
		endIndex
	};
}
function isEmojiStyleGrapheme(grapheme) {
	if (EMOJI_PRESENTATION_GRAPHEME_REGEX.test(grapheme)) return true;
	for (const character of grapheme) {
		const codePoint = character.codePointAt(0);
		if (codePoint === VARIATION_SELECTOR_16_CODE_POINT || codePoint === COMBINING_ENCLOSING_KEYCAP_CODE_POINT) return true;
	}
	return false;
}
function getGraphemeWidth(grapheme) {
	let regionalIndicatorCount = 0;
	for (const character of grapheme) {
		const codePoint = character.codePointAt(0);
		if (isFullwidthCodePoint(codePoint)) return 2;
		if (isRegionalIndicatorCodePoint(codePoint)) regionalIndicatorCount++;
	}
	if (regionalIndicatorCount >= 1) return 2;
	if (isEmojiStyleGrapheme(grapheme)) return 2;
	return 1;
}
function getSgrPrefix(code) {
	if (code.startsWith("")) return "";
	return `${ESCAPE}${ANSI_CSI}`;
}
function createSgrCode(prefix, values) {
	return `${prefix}${values.join(";")}${ANSI_SGR_TERMINATOR}`;
}
function getSgrFragments(code) {
	const fragments = [];
	const sgrPrefix = getSgrPrefix(code);
	let parameterString;
	if (code.startsWith(`${ESCAPE}${ANSI_CSI}`)) parameterString = code.slice(2, -1);
	else if (code.startsWith("")) parameterString = code.slice(1, -1);
	else return fragments;
	const rawCodes = parameterString.length === 0 ? [String(SGR_RESET_CODE)] : parameterString.split(";");
	let index = 0;
	while (index < rawCodes.length) {
		const codeNumber = Number.parseInt(rawCodes[index], 10);
		if (Number.isNaN(codeNumber)) {
			index++;
			continue;
		}
		if (codeNumber === SGR_RESET_CODE) {
			fragments.push({ type: "reset" });
			index++;
			continue;
		}
		if (codeNumber === SGR_EXTENDED_FOREGROUND_CODE || codeNumber === SGR_EXTENDED_BACKGROUND_CODE) {
			const colorType = Number.parseInt(rawCodes[index + 1], 10);
			if (colorType === SGR_COLOR_TYPE_ANSI_256 && index + SGR_ANSI_256_LAST_PARAMETER_OFFSET < rawCodes.length) {
				const openCode = createSgrCode(sgrPrefix, rawCodes.slice(index, index + SGR_ANSI_256_FRAGMENT_LENGTH));
				fragments.push({
					type: "start",
					code: openCode,
					endCode: ansiStyles.color.ansi(codeNumber === SGR_EXTENDED_FOREGROUND_CODE ? SGR_DEFAULT_FOREGROUND_CODE : SGR_DEFAULT_BACKGROUND_CODE)
				});
				index += SGR_ANSI_256_FRAGMENT_LENGTH;
				continue;
			}
			if (colorType === SGR_COLOR_TYPE_TRUECOLOR && index + SGR_TRUECOLOR_LAST_PARAMETER_OFFSET < rawCodes.length) {
				const openCode = createSgrCode(sgrPrefix, rawCodes.slice(index, index + SGR_TRUECOLOR_FRAGMENT_LENGTH));
				fragments.push({
					type: "start",
					code: openCode,
					endCode: ansiStyles.color.ansi(codeNumber === SGR_EXTENDED_FOREGROUND_CODE ? SGR_DEFAULT_FOREGROUND_CODE : SGR_DEFAULT_BACKGROUND_CODE)
				});
				index += SGR_TRUECOLOR_FRAGMENT_LENGTH;
				continue;
			}
			const openCode = createSgrCode(sgrPrefix, [rawCodes[index]]);
			fragments.push({
				type: "start",
				code: openCode,
				endCode: ansiStyles.color.ansi(codeNumber === SGR_EXTENDED_FOREGROUND_CODE ? SGR_DEFAULT_FOREGROUND_CODE : SGR_DEFAULT_BACKGROUND_CODE)
			});
			index++;
			continue;
		}
		if (endCodeNumbers.has(codeNumber)) {
			fragments.push({
				type: "end",
				endCode: ansiStyles.color.ansi(codeNumber)
			});
			index++;
			continue;
		}
		const mappedEndCode = ansiStyles.codes.get(codeNumber);
		if (mappedEndCode !== void 0) {
			const openCode = createSgrCode(sgrPrefix, [rawCodes[index]]);
			fragments.push({
				type: "start",
				code: openCode,
				endCode: ansiStyles.color.ansi(mappedEndCode)
			});
			index++;
			continue;
		}
		const openCode = createSgrCode(sgrPrefix, [rawCodes[index]]);
		fragments.push({
			type: "start",
			code: openCode,
			endCode: ansiStyles.reset.open
		});
		index++;
	}
	if (fragments.length === 0) fragments.push({ type: "reset" });
	return fragments;
}
function parseCsiCode(string, index) {
	const escapeCodePoint = string.codePointAt(index);
	let sequenceStartIndex;
	if (escapeCodePoint === ESCAPE_CODE_POINT) {
		if (string[index + 1] !== ANSI_CSI) return;
		sequenceStartIndex = index + 2;
	} else if (escapeCodePoint === C1_CSI_CODE_POINT) sequenceStartIndex = index + 1;
	else return;
	let hasCanonicalSgrParameters = true;
	for (let sequenceIndex = sequenceStartIndex; sequenceIndex < string.length; sequenceIndex++) {
		const codePoint = string.codePointAt(sequenceIndex);
		if (isCsiFinalCharacter(codePoint)) {
			const code = string.slice(index, sequenceIndex + 1);
			if (string[sequenceIndex] !== ANSI_SGR_TERMINATOR || !hasCanonicalSgrParameters) return createControlParseResult(code, sequenceIndex + 1);
			return {
				token: {
					type: "sgr",
					code,
					fragments: getSgrFragments(code)
				},
				endIndex: sequenceIndex + 1
			};
		}
		if (isCsiParameterCharacter(codePoint)) {
			if (!isSgrParameterCharacter(codePoint)) hasCanonicalSgrParameters = false;
			continue;
		}
		if (isCsiIntermediateCharacter(codePoint)) {
			hasCanonicalSgrParameters = false;
			continue;
		}
		const endIndex = sequenceIndex;
		return createControlParseResult(string.slice(index, endIndex), endIndex);
	}
	return createControlParseResult(string.slice(index), string.length);
}
function parseHyperlinkCode(string, index) {
	let hyperlinkPrefix;
	let hyperlinkClose;
	const codePoint = string.codePointAt(index);
	if (codePoint === ESCAPE_CODE_POINT && string.startsWith(ANSI_HYPERLINK_ESC_PREFIX, index)) {
		hyperlinkPrefix = ANSI_HYPERLINK_ESC_PREFIX;
		hyperlinkClose = ANSI_HYPERLINK_ESC_CLOSE;
	} else if (codePoint === C1_OSC_CODE_POINT && string.startsWith(ANSI_HYPERLINK_C1_PREFIX, index)) {
		hyperlinkPrefix = ANSI_HYPERLINK_C1_PREFIX;
		hyperlinkClose = ANSI_HYPERLINK_C1_CLOSE;
	} else return;
	const uriStart = string.indexOf(";", index + hyperlinkPrefix.length);
	if (uriStart === -1) return createControlParseResult(string.slice(index), string.length);
	for (let sequenceIndex = uriStart + 1; sequenceIndex < string.length; sequenceIndex++) {
		const character = string[sequenceIndex];
		if (character === ANSI_BELL) return {
			token: {
				type: "hyperlink",
				code: string.slice(index, sequenceIndex + 1),
				action: sequenceIndex === uriStart + 1 ? "close" : "open",
				closePrefix: hyperlinkClose,
				terminator: ANSI_BELL
			},
			endIndex: sequenceIndex + 1
		};
		if (character === ESCAPE && string[sequenceIndex + 1] === ANSI_OSC_TERMINATOR) return {
			token: {
				type: "hyperlink",
				code: string.slice(index, sequenceIndex + 2),
				action: sequenceIndex === uriStart + 1 ? "close" : "open",
				closePrefix: hyperlinkClose,
				terminator: ANSI_STRING_TERMINATOR
			},
			endIndex: sequenceIndex + 2
		};
		if (character === C1_STRING_TERMINATOR) return {
			token: {
				type: "hyperlink",
				code: string.slice(index, sequenceIndex + 1),
				action: sequenceIndex === uriStart + 1 ? "close" : "open",
				closePrefix: hyperlinkClose,
				terminator: C1_STRING_TERMINATOR
			},
			endIndex: sequenceIndex + 1
		};
	}
	return createControlParseResult(string.slice(index), string.length);
}
function parseControlStringCode(string, index) {
	const codePoint = string.codePointAt(index);
	let sequenceStartIndex;
	let supportsBellTerminator = false;
	switch (codePoint) {
		case ESCAPE_CODE_POINT:
			switch (string[index + 1]) {
				case ANSI_OSC:
					sequenceStartIndex = index + 2;
					supportsBellTerminator = true;
					break;
				case ANSI_DCS:
				case ANSI_SOS:
				case ANSI_PM:
				case ANSI_APC:
					sequenceStartIndex = index + 2;
					break;
				case ANSI_OSC_TERMINATOR: return createControlParseResult(ANSI_STRING_TERMINATOR, index + 2);
				default: return;
			}
			break;
		case C1_OSC_CODE_POINT:
			sequenceStartIndex = index + 1;
			supportsBellTerminator = true;
			break;
		case C1_DCS_CODE_POINT:
		case C1_SOS_CODE_POINT:
		case C1_PM_CODE_POINT:
		case C1_APC_CODE_POINT:
			sequenceStartIndex = index + 1;
			break;
		case C1_ST_CODE_POINT: return createControlParseResult(C1_STRING_TERMINATOR, index + 1);
		default: return;
	}
	for (let sequenceIndex = sequenceStartIndex; sequenceIndex < string.length; sequenceIndex++) {
		if (supportsBellTerminator && string[sequenceIndex] === ANSI_BELL) return createControlParseResult(string.slice(index, sequenceIndex + 1), sequenceIndex + 1);
		if (string[sequenceIndex] === ESCAPE && string[sequenceIndex + 1] === ANSI_OSC_TERMINATOR) return createControlParseResult(string.slice(index, sequenceIndex + 2), sequenceIndex + 2);
		if (string[sequenceIndex] === C1_STRING_TERMINATOR) return createControlParseResult(string.slice(index, sequenceIndex + 1), sequenceIndex + 1);
	}
	return createControlParseResult(string.slice(index), string.length);
}
function parseAnsiCode(string, index) {
	const codePoint = string.codePointAt(index);
	if (codePoint === ESCAPE_CODE_POINT || codePoint === C1_OSC_CODE_POINT) {
		const hyperlinkCode = parseHyperlinkCode(string, index);
		if (hyperlinkCode) return hyperlinkCode;
	}
	const controlStringCode = parseControlStringCode(string, index);
	if (controlStringCode) return controlStringCode;
	return parseCsiCode(string, index);
}
function appendTrailingAnsiTokens(string, index, tokens) {
	while (index < string.length) {
		const nextCodePoint = string.codePointAt(index);
		if (!ESCAPES.has(nextCodePoint)) break;
		const escapeCode = parseAnsiCode(string, index);
		if (!escapeCode) break;
		tokens.push(escapeCode.token);
		index = escapeCode.endIndex;
	}
	return index;
}
function parseCharacterTokenWithRawSegmentation(string, index, graphemeSegments) {
	const segment = graphemeSegments.containing(index);
	if (!segment || segment.index !== index) return;
	return {
		token: {
			type: "character",
			value: segment.segment,
			visibleWidth: getGraphemeWidth(segment.segment),
			isGraphemeContinuation: false
		},
		endIndex: index + segment.segment.length
	};
}
function collectVisibleCharacters(string) {
	const visibleCharacters = [];
	let index = 0;
	while (index < string.length) {
		const codePoint = string.codePointAt(index);
		if (ESCAPES.has(codePoint)) {
			const code = parseAnsiCode(string, index);
			if (code) {
				index = code.endIndex;
				continue;
			}
		}
		const value = String.fromCodePoint(codePoint);
		visibleCharacters.push({
			value,
			visibleWidth: 1,
			isGraphemeContinuation: false
		});
		index += value.length;
	}
	return visibleCharacters;
}
function applyGraphemeMetadata(visibleCharacters) {
	if (visibleCharacters.length === 0) return;
	const visibleString = visibleCharacters.map(({ value }) => value).join("");
	const scalarOffsets = [];
	let scalarOffset = 0;
	for (const visibleCharacter of visibleCharacters) {
		scalarOffsets.push(scalarOffset);
		scalarOffset += visibleCharacter.value.length;
	}
	let scalarIndex = 0;
	for (const segment of GRAPHEME_SEGMENTER.segment(visibleString)) {
		while (scalarIndex < visibleCharacters.length && scalarOffsets[scalarIndex] < segment.index) scalarIndex++;
		let graphemeIndex = scalarIndex;
		let isFirstInGrapheme = true;
		while (graphemeIndex < visibleCharacters.length && scalarOffsets[graphemeIndex] < segment.index + segment.segment.length) {
			visibleCharacters[graphemeIndex].visibleWidth = isFirstInGrapheme ? getGraphemeWidth(segment.segment) : 0;
			visibleCharacters[graphemeIndex].isGraphemeContinuation = !isFirstInGrapheme;
			isFirstInGrapheme = false;
			graphemeIndex++;
		}
		scalarIndex = graphemeIndex;
	}
}
function tokenizeAnsiWithVisibleSegmentation(string, { endCharacter = Number.POSITIVE_INFINITY } = {}) {
	const tokens = [];
	const visibleCharacters = collectVisibleCharacters(string);
	applyGraphemeMetadata(visibleCharacters);
	let index = 0;
	let visibleCharacterIndex = 0;
	let visibleCount = 0;
	while (index < string.length) {
		const codePoint = string.codePointAt(index);
		if (ESCAPES.has(codePoint)) {
			const code = parseAnsiCode(string, index);
			if (code) {
				tokens.push(code.token);
				index = code.endIndex;
				continue;
			}
		}
		const value = String.fromCodePoint(codePoint);
		const visibleCharacter = visibleCharacters[visibleCharacterIndex];
		let visibleWidth = isFullwidthCodePoint(codePoint) ? 2 : value.length;
		if (visibleCharacter) visibleWidth = visibleCharacter.visibleWidth;
		const token = {
			type: "character",
			value,
			visibleWidth,
			isGraphemeContinuation: visibleCharacter ? visibleCharacter.isGraphemeContinuation : false
		};
		tokens.push(token);
		index += value.length;
		visibleCharacterIndex++;
		visibleCount += token.visibleWidth;
		if (visibleCount >= endCharacter) {
			const nextVisibleCharacter = visibleCharacters[visibleCharacterIndex];
			if (!nextVisibleCharacter || !nextVisibleCharacter.isGraphemeContinuation) {
				index = appendTrailingAnsiTokens(string, index, tokens);
				break;
			}
		}
	}
	return tokens;
}
function areValuesInSameGrapheme(leftValue, rightValue) {
	const pair = `${leftValue}${rightValue}`;
	const splitIndex = leftValue.length;
	for (const segment of GRAPHEME_SEGMENTER.segment(pair)) {
		if (segment.index === splitIndex) return false;
		if (segment.index > splitIndex) return true;
	}
	return true;
}
function hasAnsiSplitContinuationAhead(string, startIndex, previousVisibleValue, graphemeSegments) {
	if (!previousVisibleValue) return false;
	let index = startIndex;
	let hasAnsiCode = false;
	while (index < string.length) {
		const codePoint = string.codePointAt(index);
		if (ESCAPES.has(codePoint)) {
			const code = parseAnsiCode(string, index);
			if (code) {
				hasAnsiCode = true;
				index = code.endIndex;
				continue;
			}
		}
		if (!hasAnsiCode) return false;
		const characterToken = parseCharacterTokenWithRawSegmentation(string, index, graphemeSegments);
		if (!characterToken) return true;
		return areValuesInSameGrapheme(previousVisibleValue, characterToken.token.value);
	}
	return false;
}
function tokenizeAnsi(string, { endCharacter = Number.POSITIVE_INFINITY } = {}) {
	const tokens = [];
	const graphemeSegments = GRAPHEME_SEGMENTER.segment(string);
	let index = 0;
	let visibleCount = 0;
	let previousVisibleValue;
	let hasAnsiSinceLastVisible = false;
	while (index < string.length) {
		const codePoint = string.codePointAt(index);
		if (ESCAPES.has(codePoint)) {
			const code = parseAnsiCode(string, index);
			if (code) {
				tokens.push(code.token);
				index = code.endIndex;
				hasAnsiSinceLastVisible = true;
				continue;
			}
		}
		const characterToken = parseCharacterTokenWithRawSegmentation(string, index, graphemeSegments);
		if (!characterToken) return tokenizeAnsiWithVisibleSegmentation(string, { endCharacter });
		if (hasAnsiSinceLastVisible && previousVisibleValue && areValuesInSameGrapheme(previousVisibleValue, characterToken.token.value)) return tokenizeAnsiWithVisibleSegmentation(string, { endCharacter });
		tokens.push(characterToken.token);
		index = characterToken.endIndex;
		visibleCount += characterToken.token.visibleWidth;
		hasAnsiSinceLastVisible = false;
		previousVisibleValue = characterToken.token.value;
		if (visibleCount >= endCharacter) {
			if (hasAnsiSplitContinuationAhead(string, index, previousVisibleValue, graphemeSegments)) return tokenizeAnsiWithVisibleSegmentation(string, { endCharacter });
			index = appendTrailingAnsiTokens(string, index, tokens);
			break;
		}
	}
	return tokens;
}

//#endregion
//#region node_modules/.pnpm/slice-ansi@9.0.0/node_modules/slice-ansi/index.js
function applySgrFragments(activeStyles, fragments) {
	for (const fragment of fragments) switch (fragment.type) {
		case "reset":
			activeStyles.clear();
			break;
		case "end":
			activeStyles.delete(fragment.endCode);
			break;
		case "start":
			activeStyles.delete(fragment.endCode);
			activeStyles.set(fragment.endCode, fragment.code);
			break;
		default: break;
	}
	return activeStyles;
}
function undoAnsiCodes(activeStyles) {
	return [...activeStyles.keys()].toReversed().join("");
}
function closeHyperlink(hyperlinkToken) {
	return `${hyperlinkToken.closePrefix}${hyperlinkToken.terminator}`;
}
function shouldIncludeSgrAfterEnd(token, activeStyles) {
	let hasStartFragment = false;
	let hasClosingEffect = false;
	for (const fragment of token.fragments) {
		if (fragment.type === "start") {
			hasStartFragment = true;
			continue;
		}
		if (fragment.type === "reset" && activeStyles.size > 0) {
			hasClosingEffect = true;
			continue;
		}
		if (fragment.type === "end" && activeStyles.has(fragment.endCode)) hasClosingEffect = true;
	}
	return hasClosingEffect && !hasStartFragment;
}
function hasSgrStartFragment(token) {
	return token.fragments.some((fragment) => fragment.type === "start");
}
function discardPendingHyperlink(parameters) {
	if (parameters.activeHyperlink && !parameters.activeHyperlinkHasVisibleText && parameters.activeHyperlinkOutputIndex !== void 0) {
		const openCodeLength = parameters.activeHyperlink.code.length;
		parameters.returnValue = parameters.returnValue.slice(0, parameters.activeHyperlinkOutputIndex) + parameters.returnValue.slice(parameters.activeHyperlinkOutputIndex + openCodeLength);
		if (parameters.pendingSgrOutputIndex !== void 0 && parameters.pendingSgrOutputIndex > parameters.activeHyperlinkOutputIndex) parameters.pendingSgrOutputIndex -= openCodeLength;
	}
	parameters.activeHyperlink = void 0;
	parameters.activeHyperlinkHasVisibleText = false;
	parameters.activeHyperlinkOutputIndex = void 0;
}
function applySgrToken(parameters) {
	if (parameters.isPastEnd && !shouldIncludeSgrAfterEnd(parameters.token, parameters.activeStyles)) return parameters;
	if (parameters.include && hasSgrStartFragment(parameters.token) && parameters.pendingSgrOutputIndex === void 0) {
		parameters.pendingSgrOutputIndex = parameters.returnValue.length;
		parameters.pendingSgrActiveStyles = new Map(parameters.activeStyles);
	}
	parameters.activeStyles = applySgrFragments(parameters.activeStyles, parameters.token.fragments);
	if (parameters.include) parameters.returnValue += parameters.token.code;
	return parameters;
}
function applyHyperlinkToken(parameters) {
	if (parameters.isPastEnd && (parameters.token.action !== "close" || !parameters.activeHyperlink)) return parameters;
	if (parameters.token.action === "open") {
		parameters.activeHyperlink = parameters.token;
		parameters.activeHyperlinkHasVisibleText = false;
		parameters.activeHyperlinkOutputIndex = void 0;
		if (parameters.include) parameters.activeHyperlinkOutputIndex = parameters.returnValue.length;
	} else if (parameters.token.action === "close") {
		if (parameters.include && parameters.activeHyperlink && !parameters.activeHyperlinkHasVisibleText) {
			discardPendingHyperlink(parameters);
			return parameters;
		}
		parameters.activeHyperlink = void 0;
		parameters.activeHyperlinkHasVisibleText = false;
		parameters.activeHyperlinkOutputIndex = void 0;
	}
	if (parameters.include) parameters.returnValue += parameters.token.code;
	return parameters;
}
function applyControlToken(parameters) {
	if (!parameters.isPastEnd && parameters.include) parameters.returnValue += parameters.token.code;
	return parameters;
}
function applyCharacterToken(parameters) {
	if (!parameters.include && parameters.position >= parameters.start && !parameters.token.isGraphemeContinuation) {
		parameters.include = true;
		parameters.returnValue = [...parameters.activeStyles.values()].join("");
		if (parameters.activeHyperlink) {
			parameters.activeHyperlinkOutputIndex = parameters.returnValue.length;
			parameters.returnValue += parameters.activeHyperlink.code;
		}
	}
	if (parameters.include) {
		parameters.returnValue += parameters.token.value;
		parameters.pendingSgrOutputIndex = void 0;
		parameters.pendingSgrActiveStyles = void 0;
		if (parameters.activeHyperlink) parameters.activeHyperlinkHasVisibleText = true;
	}
	parameters.position += parameters.token.visibleWidth;
	return parameters;
}
const tokenHandlers = {
	sgr: applySgrToken,
	hyperlink: applyHyperlinkToken,
	control: applyControlToken,
	character: applyCharacterToken
};
function applyToken(parameters) {
	const tokenHandler = tokenHandlers[parameters.token.type];
	if (!tokenHandler) return parameters;
	return tokenHandler(parameters);
}
function createHasContinuationAheadMap(tokens) {
	const hasContinuationAhead = Array.from({ length: tokens.length }, () => false);
	let nextCharacterIsContinuation = false;
	for (let tokenIndex = tokens.length - 1; tokenIndex >= 0; tokenIndex--) {
		const token = tokens[tokenIndex];
		hasContinuationAhead[tokenIndex] = nextCharacterIsContinuation;
		if (token.type === "character") nextCharacterIsContinuation = Boolean(token.isGraphemeContinuation);
	}
	return hasContinuationAhead;
}
function isPastEndBoundary(token, position, end) {
	if (end === void 0) return false;
	if (position >= end) return true;
	return token.type === "character" && !token.isGraphemeContinuation && position + token.visibleWidth > end;
}
function sliceAnsi(string, start, end) {
	const tokens = tokenizeAnsi(string, { endCharacter: end });
	const hasContinuationAhead = createHasContinuationAheadMap(tokens);
	let activeStyles = /* @__PURE__ */ new Map();
	let activeHyperlink;
	let activeHyperlinkHasVisibleText = false;
	let activeHyperlinkOutputIndex;
	let pendingSgrOutputIndex;
	let pendingSgrActiveStyles;
	let position = 0;
	let returnValue = "";
	let include = false;
	for (const [tokenIndex, token] of tokens.entries()) {
		let isPastEnd = isPastEndBoundary(token, position, end);
		if (isPastEnd && token.type !== "character" && hasContinuationAhead[tokenIndex]) isPastEnd = false;
		if (isPastEnd && token.type === "character" && !token.isGraphemeContinuation) {
			if (activeHyperlink && !activeHyperlinkHasVisibleText) {
				const hyperlinkState = {
					activeHyperlink,
					activeHyperlinkHasVisibleText,
					activeHyperlinkOutputIndex,
					pendingSgrOutputIndex,
					returnValue
				};
				discardPendingHyperlink(hyperlinkState);
				({activeHyperlink, activeHyperlinkHasVisibleText, activeHyperlinkOutputIndex, pendingSgrOutputIndex, returnValue} = hyperlinkState);
			}
			if (pendingSgrOutputIndex !== void 0) {
				returnValue = returnValue.slice(0, pendingSgrOutputIndex);
				activeStyles = pendingSgrActiveStyles;
				pendingSgrOutputIndex = void 0;
				pendingSgrActiveStyles = void 0;
			}
			break;
		}
		({activeStyles, activeHyperlink, activeHyperlinkHasVisibleText, activeHyperlinkOutputIndex, pendingSgrOutputIndex, pendingSgrActiveStyles, position, returnValue, include} = applyToken({
			token,
			isPastEnd,
			start,
			activeStyles,
			activeHyperlink,
			activeHyperlinkHasVisibleText,
			activeHyperlinkOutputIndex,
			pendingSgrOutputIndex,
			pendingSgrActiveStyles,
			position,
			returnValue,
			include
		}));
	}
	if (!include) return "";
	if (activeHyperlink) returnValue += closeHyperlink(activeHyperlink);
	returnValue += undoAnsiCodes(activeStyles);
	return returnValue;
}

//#endregion
//#region node_modules/.pnpm/ansi-regex@6.2.2/node_modules/ansi-regex/index.js
function ansiRegex({ onlyFirst = false } = {}) {
	return new RegExp(`(?:\\u001B\\][\\s\\S]*?(?:\\u0007|\\u001B\\u005C|\\u009C))|[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]`, onlyFirst ? void 0 : "g");
}

//#endregion
//#region node_modules/.pnpm/strip-ansi@7.2.0/node_modules/strip-ansi/index.js
const regex = ansiRegex();
function stripAnsi(string) {
	if (typeof string !== "string") throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``);
	if (!string.includes("\x1B") && !string.includes("")) return string;
	return string.replace(regex, "");
}

//#endregion
//#region node_modules/.pnpm/string-width@8.2.2/node_modules/string-width/index.js
/**
Logic:
- Segment graphemes to match how terminals render clusters.
- Width rules:
1. Skip non-printing clusters (Default_Ignorable, Control, pure nonspacing/enclosing Mark, lone Surrogates). Tabs are ignored by design.
2. RGI emoji clusters (\p{RGI_Emoji}) are double-width.
3. Minimally-qualified/unqualified emoji clusters (ZWJ sequences with 2+ Extended_Pictographic, or keycap sequences) are double-width.
4. Hangul jamo collapse each standard modern Hangul L+V or L+V+T syllable piece to width 2.
Unmatched repeated leading/vowel/trailing jamo stay additive because that matches how the terminals we target render them.
5. Otherwise use East Asian Width of the cluster's first visible code point, and add widths for trailing spacing marks and Halfwidth/Fullwidth Forms within the same cluster (e.g., dakuten/handakuten/prolonged sound mark).
*/
const segmenter = new Intl.Segmenter();
const zeroWidthClusterRegex = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Format}|\p{Nonspacing_Mark}|\p{Enclosing_Mark}|\p{Surrogate})+$/v;
const leadingNonPrintingRegex = /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Nonspacing_Mark}\p{Enclosing_Mark}\p{Surrogate}]+/v;
const spacingMarkRegex = /\p{Spacing_Mark}/v;
const rgiEmojiRegex = /^\p{RGI_Emoji}$/v;
const unqualifiedKeycapRegex = /^[\d#*]\u20E3$/;
const extendedPictographicRegex = /\p{Extended_Pictographic}/gu;
function isDoubleWidthNonRgiEmojiSequence(segment) {
	if (segment.length > 50) return false;
	if (unqualifiedKeycapRegex.test(segment)) return true;
	if (segment.includes("‍")) {
		const pictographics = segment.match(extendedPictographicRegex);
		return pictographics !== null && pictographics.length >= 2;
	}
	return false;
}
function baseVisible(segment) {
	return segment.replace(leadingNonPrintingRegex, "");
}
function isZeroWidthCluster(segment) {
	return zeroWidthClusterRegex.test(segment);
}
function isHangulLeadingJamo(codePoint) {
	return codePoint >= 4352 && codePoint <= 4447 || codePoint >= 43360 && codePoint <= 43388;
}
function isHangulVowelJamo(codePoint) {
	return codePoint >= 4448 && codePoint <= 4519 || codePoint >= 55216 && codePoint <= 55238;
}
function isHangulTrailingJamo(codePoint) {
	return codePoint >= 4520 && codePoint <= 4607 || codePoint >= 55243 && codePoint <= 55291;
}
function isHangulJamo(codePoint) {
	return isHangulLeadingJamo(codePoint) || isHangulVowelJamo(codePoint) || isHangulTrailingJamo(codePoint);
}
function hangulClusterWidth(visibleSegment, eastAsianWidthOptions) {
	const codePoints = [];
	for (const character of visibleSegment) {
		if (zeroWidthClusterRegex.test(character)) continue;
		codePoints.push(character.codePointAt(0));
	}
	if (codePoints.length === 0) return;
	let width = 0;
	for (let index = 0; index < codePoints.length; index++) {
		const codePoint = codePoints[index];
		if (!isHangulJamo(codePoint)) {
			if (width === 0) return;
			for (let remaining = index; remaining < codePoints.length; remaining++) width += eastAsianWidth(codePoints[remaining], eastAsianWidthOptions);
			return width;
		}
		if (isHangulLeadingJamo(codePoint) && isHangulVowelJamo(codePoints[index + 1])) {
			width += 2;
			index += isHangulTrailingJamo(codePoints[index + 2]) ? 2 : 1;
			continue;
		}
		width += eastAsianWidth(codePoint, eastAsianWidthOptions);
	}
	return width;
}
function trailingWidth(visibleSegment, eastAsianWidthOptions) {
	let extra = 0;
	let first = true;
	for (const character of visibleSegment) {
		if (first) {
			first = false;
			continue;
		}
		if (spacingMarkRegex.test(character) || character >= "＀" && character <= "￯") extra += eastAsianWidth(character.codePointAt(0), eastAsianWidthOptions);
	}
	return extra;
}
function stringWidth(input, options = {}) {
	if (typeof input !== "string" || input.length === 0) return 0;
	const { ambiguousIsNarrow = true, countAnsiEscapeCodes = false } = options;
	let string = input;
	if (!countAnsiEscapeCodes && (string.includes("\x1B") || string.includes(""))) string = stripAnsi(string);
	if (string.length === 0) return 0;
	if (/^[\u0020-\u007E]*$/.test(string)) return string.length;
	let width = 0;
	const eastAsianWidthOptions = { ambiguousAsWide: !ambiguousIsNarrow };
	for (const { segment } of segmenter.segment(string)) {
		if (isZeroWidthCluster(segment)) continue;
		if (rgiEmojiRegex.test(segment) || isDoubleWidthNonRgiEmojiSequence(segment)) {
			width += 2;
			continue;
		}
		const visibleSegment = baseVisible(segment);
		const hangulWidth = hangulClusterWidth(visibleSegment, eastAsianWidthOptions);
		if (hangulWidth !== void 0) {
			width += hangulWidth;
			continue;
		}
		const codePoint = visibleSegment.codePointAt(0);
		width += eastAsianWidth(codePoint, eastAsianWidthOptions);
		width += trailingWidth(visibleSegment, eastAsianWidthOptions);
	}
	return width;
}

//#endregion
//#region src/render/format.ts
function safeText(value) {
	return Array.from(value, (character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint <= 31 || codePoint === 127 ? " " : character;
	}).join("").replace(/\s+/g, " ").trim();
}
function visibleWidth(value) {
	return stringWidth(stripAnsi(value));
}
function truncateAnsi(value, width) {
	if (width <= 0) return "";
	if (visibleWidth(value) <= width) return value;
	if (width === 1) return "…";
	const reset = value === stripAnsi(value) ? "" : "\x1B[0m";
	return `${sliceAnsi(value, 0, width - 1)}…${reset}`;
}
function formatTokens(value) {
	const absolute = Math.abs(value);
	if (absolute >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
	if (absolute >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
	return String(Math.round(value));
}
function formatDuration(milliseconds) {
	return formatMinuteDuration(milliseconds, "floor");
}
function formatMinuteDuration(milliseconds, rounding) {
	const safeMilliseconds = Math.max(0, milliseconds);
	if (safeMilliseconds < 6e4) return "<1m";
	const minutes = Math[rounding](safeMilliseconds / 6e4);
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor(minutes % 1440 / 60);
	const remainingMinutes = minutes % 60;
	const parts = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (remainingMinutes > 0) parts.push(`${remainingMinutes}m`);
	return parts.join(" ");
}
function relativeTime(resetAt, now) {
	return formatMinuteDuration(Math.max(0, resetAt.getTime() - now.getTime()), "ceil");
}
function formatResetTime(resetAt, now, mode, windowMinutes) {
	if (!resetAt) return null;
	const relative = relativeTime(resetAt, now);
	const absolute = resetAt.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit"
	});
	if (mode === "absolute") return absolute;
	if (mode === "both") return `${relative} (${absolute})`;
	if (mode === "elapsed" || mode === "elapsedAndAbsolute") {
		if (!windowMinutes || windowMinutes <= 0) return mode === "elapsedAndAbsolute" ? absolute : relative;
		const remaining = Math.max(0, resetAt.getTime() - now.getTime());
		const elapsedPercent = Math.min(100, Math.max(0, Math.round(100 - remaining / (windowMinutes * 6e4) * 100)));
		return mode === "elapsedAndAbsolute" ? `${elapsedPercent}% elapsed (${absolute})` : `${elapsedPercent}% elapsed`;
	}
	return relative;
}
function progressBar(percent, width, filled, empty) {
	const safeWidth = Math.max(1, width);
	const filledCount = Math.round(Math.min(100, Math.max(0, percent)) / 100 * safeWidth);
	return `${filled.repeat(filledCount)}${empty.repeat(safeWidth - filledCount)}`;
}
function projectPath(value, levels) {
	const normalized = value.replace(/\\/g, "/").replace(/\/$/, "");
	return normalized.split("/").filter(Boolean).slice(-levels).join("/") || normalized;
}

//#endregion
//#region src/render/i18n.ts
const MESSAGES = {
	"en": {
		context: "Context",
		usage: "Usage",
		resetsIn: "resets in",
		tools: "Tools",
		skills: "Skills",
		mcps: "MCPs",
		agents: "Agents",
		goal: "Goal",
		allComplete: "All tasks complete",
		configs: "configs",
		rules: "rules",
		hooks: "hooks",
		session: "Session",
		tokens: "Tokens",
		compactions: "Compactions",
		memory: "Memory",
		promptCache: "Cache TTL",
		addedDirs: "Added dirs",
		approval: "Approval",
		permissions: "Permissions",
		sandbox: "Sandbox",
		mode: "Mode",
		started: "Started",
		lastResponse: "Last response",
		input: "in",
		cache: "cache",
		output: "out",
		turns: "Turns",
		navigate: "click HUD and press n"
	},
	"zh-Hans": {
		context: "上下文",
		usage: "额度",
		resetsIn: "重置于",
		tools: "工具",
		skills: "技能",
		mcps: "MCP",
		agents: "子代理",
		goal: "目标",
		allComplete: "全部任务已完成",
		configs: "配置",
		rules: "规则",
		hooks: "钩子",
		session: "会话",
		tokens: "Token",
		compactions: "压缩",
		memory: "内存",
		promptCache: "缓存有效期",
		addedDirs: "附加目录",
		approval: "审批",
		permissions: "权限",
		sandbox: "沙箱",
		mode: "模式",
		started: "开始",
		lastResponse: "最近响应",
		input: "输入",
		cache: "缓存",
		output: "输出",
		turns: "轮次",
		navigate: "点击 HUD 后按 n 导航"
	},
	"zh-Hant": {
		context: "上下文",
		usage: "額度",
		resetsIn: "重置於",
		tools: "工具",
		skills: "技能",
		mcps: "MCP",
		agents: "子代理",
		goal: "目標",
		allComplete: "全部任務已完成",
		configs: "配置",
		rules: "規則",
		hooks: "鉤子",
		session: "會話",
		tokens: "Token",
		compactions: "壓縮",
		memory: "記憶體",
		promptCache: "快取有效期",
		addedDirs: "附加目錄",
		approval: "審批",
		permissions: "權限",
		sandbox: "沙箱",
		mode: "模式",
		started: "開始",
		lastResponse: "最近回應",
		input: "輸入",
		cache: "快取",
		output: "輸出",
		turns: "輪次",
		navigate: "點擊 HUD 後按 n 導航"
	}
};
const ICONS = {
	agents: "🤖",
	mcps: "🔌",
	skills: "🧩",
	todos: "📋",
	tools: "🛠️"
};
function message(language, key) {
	return MESSAGES[language][key];
}
function icon(key) {
	return ICONS[key];
}

//#endregion
//#region src/render/activity-lines.ts
function elapsed(agent, now) {
	return formatDuration((agent.endTime ?? now).getTime() - agent.startTime.getTime());
}
function toolName(ctx, value) {
	const maximum = ctx.config.display.toolNameMaxLength;
	if (maximum <= 0 || value.length <= maximum) return value;
	const mcpLeaf = value.startsWith("mcp__") ? value.split("__").at(-1) ?? value : value;
	const candidate = mcpLeaf.length <= maximum ? mcpLeaf : value;
	return maximum === 1 ? "…" : `${candidate.slice(0, maximum - 1)}…`;
}
function renderToolsLine(ctx) {
	if (!ctx.config.display.showTools || ctx.state.tools.length === 0) return null;
	const running = ctx.state.tools.filter((tool) => tool.status === "running").slice(-2);
	const completed = ctx.state.tools.filter((tool) => tool.status !== "running");
	const parts = running.map((tool) => {
		const target = tool.target ? `: ${safeText(tool.target)}` : "";
		return `${color("◐", "yellow", ctx.options.color)} ${color(safeText(toolName(ctx, tool.name)), "cyan", ctx.options.color)}${target}`;
	});
	const counts = /* @__PURE__ */ new Map();
	for (const tool of completed) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
	const visible = Array.from(counts.entries()).sort((left, right) => right[1] - left[1]).slice(0, ctx.config.display.toolsMaxVisible || void 0);
	for (const [name, count] of visible) parts.push(`${color("✓", "green", ctx.options.color)} ${safeText(toolName(ctx, name))} ×${count}`);
	return parts.length > 0 ? `${icon("tools")} ${message(ctx.config.language, "tools")}: ${parts.join(" │ ")}` : null;
}
function renderNames(ctx, title, names) {
	if (names.length === 0) return null;
	const visible = names.slice(0, 4).map((name) => color(safeText(name), "cyan", ctx.options.color));
	if (names.length > 4) visible.push(`+${names.length - 4} more`);
	return `${icon(title)} ${color("✓", "green", ctx.options.color)} ${message(ctx.config.language, title)} (${names.length}): ${visible.join(", ")}`;
}
function renderSkillsLine(ctx) {
	return ctx.config.display.showSkills ? renderNames(ctx, "skills", ctx.state.skills) : null;
}
function renderMcpLine(ctx) {
	return ctx.config.display.showMcp ? renderNames(ctx, "mcps", ctx.state.mcpServers) : null;
}
function renderAgentsLine(ctx) {
	if (!ctx.config.display.showAgents || ctx.state.agents.length === 0) return null;
	return ctx.state.agents.slice(-3).map((agent) => {
		const statusIcon = agent.status === "completed" ? color("✓", "green", ctx.options.color) : agent.status === "error" ? color("✗", "red", ctx.options.color) : color("◐", "yellow", ctx.options.color);
		const model = agent.model ? ` [${safeText(agent.model)}]` : "";
		const description = agent.description ? `: ${safeText(agent.description)}` : "";
		const descendants = agent.activeDescendantCount ? ` ↳${agent.activeDescendantCount}` : "";
		return `${icon("agents")} ${statusIcon} ${color(safeText(agent.type), "magenta", ctx.options.color)}${model}${description} (${elapsed(agent, ctx.now)})${descendants}`;
	}).join("\n");
}
function renderTodosLine(ctx) {
	if (ctx.config.display.showTodos && ctx.state.todos.length > 0) {
		const completed = ctx.state.todos.filter((todo) => todo.status === "completed").length;
		const current = ctx.state.todos.find((todo) => todo.status === "in_progress");
		if (current) return `${icon("todos")} ${color("▸", "yellow", ctx.options.color)} ${safeText(current.content)} (${completed}/${ctx.state.todos.length})`;
		if (completed === ctx.state.todos.length) return `${icon("todos")} ${color("✓", "green", ctx.options.color)} ${message(ctx.config.language, "allComplete")} (${completed}/${ctx.state.todos.length})`;
	}
	if (ctx.config.display.showGoal && ctx.state.goal?.objective) {
		const usage = ctx.state.goal.tokenBudget ? ` ${Math.round((ctx.state.goal.tokensUsed ?? 0) / ctx.state.goal.tokenBudget * 100)}%` : "";
		const prefix = `${color("◆", "yellow", ctx.options.color)} ${message(ctx.config.language, "goal")}: `;
		const status = ctx.state.goal.status && ctx.state.goal.status !== "active" ? ` [${ctx.state.goal.status}]` : "";
		const objectiveWidth = Math.max(20, Math.min(Math.floor(ctx.options.width * .65), ctx.options.width - 24));
		return `${prefix}${truncateAnsi(safeText(ctx.state.goal.objective), objectiveWidth)}${status}${usage}`;
	}
	return null;
}

//#endregion
//#region src/render/context-line.ts
function renderContextLine(ctx) {
	const rawContext = ctx.state.context;
	if (!rawContext) return null;
	const config = ctx.config.display;
	const effectiveTotal = config.autoCompactWindow ? Math.max(1, config.autoCompactWindow - 12e3) : rawContext.total;
	const effectiveUsed = Math.min(effectiveTotal, rawContext.used);
	const effectivePercent = Math.min(100, Math.max(0, Math.round(effectiveUsed / effectiveTotal * 100)));
	const context = {
		...rawContext,
		used: effectiveUsed,
		total: effectiveTotal,
		percent: effectivePercent,
		remainingPercent: 100 - effectivePercent
	};
	const selectedColor = statusColor(context.percent, ctx.config.colors.context, ctx.config.colors.warning, ctx.config.colors.critical, config.contextWarningThreshold, config.contextCriticalThreshold);
	const parts = [message(ctx.config.language, "context")];
	if (config.showContextBar) parts.push(progressBar(context.percent, 10, ctx.config.colors.barFilled, ctx.config.colors.barEmpty));
	if (config.contextValue === "tokens") parts.push(`${formatTokens(context.used)}/${formatTokens(context.total)}`);
	else if (config.contextValue === "remaining") parts.push(`${context.remainingPercent}% left`);
	else if (config.contextValue === "both") parts.push(`${context.percent}% (${formatTokens(context.used)}/${formatTokens(context.total)})`);
	else parts.push(`${context.percent}%`);
	if (config.showTokenBreakdown && context.percent >= config.contextCriticalThreshold) parts.push(`in ${formatTokens(context.inputTokens)} cache ${formatTokens(context.cachedTokens)} out ${formatTokens(context.outputTokens)}`);
	return color(parts.join(" "), selectedColor, ctx.options.color);
}

//#endregion
//#region src/render/environment-line.ts
function renderEnvironmentLine(ctx) {
	const project = ctx.state.project;
	const parts = [];
	const totalCounts = project.codexConfigCount + project.agentsMdCount + project.rulesCount + project.hooksCount + project.skillsCount + project.mcpCount;
	if (ctx.config.display.showConfigCounts && totalCounts >= ctx.config.display.environmentThreshold) {
		if (project.codexConfigCount > 0) parts.push(`${project.codexConfigCount} ${message(ctx.config.language, "configs")}`);
		if (project.agentsMdCount > 0) parts.push(`${project.agentsMdCount} AGENTS.md`);
		if (project.rulesCount > 0) parts.push(`${project.rulesCount} ${message(ctx.config.language, "rules")}`);
		if (project.hooksCount > 0) parts.push(`${project.hooksCount} ${message(ctx.config.language, "hooks")}`);
		if (project.skillsCount > 0) parts.push(`${project.skillsCount} ${message(ctx.config.language, "skills")}`);
		if (project.mcpCount > 0) parts.push(`${project.mcpCount} MCPs`);
	}
	const session = ctx.state.session;
	if (ctx.config.display.showApprovalPolicy && session?.approvalPolicy) parts.push(`${message(ctx.config.language, "approval")}: ${session.approvalPolicy}`);
	if (ctx.config.display.showPermissionProfile && session?.permissionProfile) parts.push(`${message(ctx.config.language, "permissions")}: ${session.permissionProfile}`);
	if (ctx.config.display.showSandboxMode && session?.sandboxMode) parts.push(`${message(ctx.config.language, "sandbox")}: ${session.sandboxMode}`);
	if (ctx.config.display.showCollaborationMode && session?.collaborationMode) parts.push(`${message(ctx.config.language, "mode")}: ${session.collaborationMode}`);
	return parts.length > 0 ? parts.join(" │ ") : null;
}
function renderMemoryLine(ctx) {
	if (!ctx.config.display.showMemoryUsage || !ctx.state.memory) return null;
	const memory = ctx.state.memory;
	return `${message(ctx.config.language, "memory")} ${progressBar(memory.usedPercent, 6, ctx.config.colors.barFilled, ctx.config.colors.barEmpty)} ${memory.usedPercent}% (${formatTokens(memory.usedBytes / 1024 / 1024)}MiB)`;
}

//#endregion
//#region src/render/project-line.ts
function addedDirectories(ctx, prefix) {
	const projectRoot = ctx.state.project.projectRoot.replace(/[\\/]+$/, "");
	const roots = ctx.state.project.workspaceRoots.filter((root) => root.replace(/[\\/]+$/, "") !== projectRoot).slice(0, 5).map((root) => {
		const name = projectPath(root, 1);
		const shortened = name.length > 24 ? `${name.slice(0, 23)}…` : name;
		return prefix ? `+${shortened}` : shortened;
	});
	const extra = ctx.state.project.workspaceRoots.filter((root) => root.replace(/[\\/]+$/, "") !== projectRoot).length - roots.length;
	if (extra > 0) roots.push(prefix ? `+${extra} more` : `+${extra} more`);
	return roots;
}
function modelName(ctx) {
	const model = ctx.config.display.modelOverride.trim() || ctx.state.session?.model;
	if (!model || !ctx.config.display.showModel) return null;
	const compact = ctx.config.display.modelFormat === "full" ? model : model.replace(/^openai\//, "").replace(/-\d+k(?:-context)?$/i, "");
	const effort = ctx.config.display.showEffortLevel && ctx.state.session?.reasoningEffort ? ` ${ctx.state.session.reasoningEffort}` : "";
	const provider = ctx.config.display.showProvider ? ctx.config.display.providerName || ctx.state.session?.modelProvider : null;
	return color(`[${safeText(provider ? `${provider} | ${compact}${effort}` : `${compact}${effort}`)}]`, ctx.config.colors.model, ctx.options.color);
}
function gitSegment(ctx) {
	if (!ctx.config.gitStatus.enabled || !ctx.state.git?.isGitRepo || !ctx.state.git.branch) return null;
	const status = ctx.state.git;
	const dirty = ctx.config.gitStatus.showDirty && status.isDirty ? "*" : "";
	const wrapper = color("git:(", ctx.config.colors.git, ctx.options.color);
	let branch = color(`${safeText(status.branch ?? "")}${dirty}`, ctx.config.colors.gitBranch, ctx.options.color);
	if (ctx.config.gitStatus.showAheadBehind && status.ahead > 0) {
		const aheadColor = ctx.config.gitStatus.pushCriticalThreshold > 0 && status.ahead >= ctx.config.gitStatus.pushCriticalThreshold ? ctx.config.colors.critical : ctx.config.gitStatus.pushWarningThreshold > 0 && status.ahead >= ctx.config.gitStatus.pushWarningThreshold ? ctx.config.colors.warning : ctx.config.colors.gitBranch;
		branch += color(` ↑${status.ahead}`, aheadColor, ctx.options.color);
	}
	if (ctx.config.gitStatus.showAheadBehind && status.behind > 0) branch += color(` ↓${status.behind}`, ctx.config.colors.gitBranch, ctx.options.color);
	const statParts = [
		status.modified > 0 ? `!${status.modified}` : null,
		status.added > 0 ? `+${status.added}` : null,
		status.deleted > 0 ? `✘${status.deleted}` : null,
		status.untracked > 0 ? `?${status.untracked}` : null
	].filter((value) => Boolean(value));
	const stats = ctx.config.gitStatus.showFileStats && statParts.length > 0 ? ` ${statParts.join(" ")}` : "";
	return `${wrapper}${branch}${color(")", ctx.config.colors.git, ctx.options.color)}${stats}`;
}
function authSegment(ctx) {
	if (!ctx.config.display.showAuth || !ctx.state.auth) return null;
	const maximum = ctx.config.display.authUserLength;
	const rawUser = ctx.state.auth.user ?? "";
	const user = maximum > 0 && rawUser.length > maximum ? `${rawUser.slice(0, Math.max(1, maximum - 1))}…` : rawUser;
	return ctx.config.display.showAuthUser && user ? `${ctx.state.auth.method} (${user})` : ctx.state.auth.method;
}
function renderProjectLine(ctx) {
	const model = modelName(ctx);
	let project = null;
	if (ctx.config.display.showProject) {
		project = color(projectPath(ctx.state.project.projectRoot, ctx.config.pathLevels), ctx.config.colors.project, ctx.options.color);
		if (ctx.config.display.showAddedDirs && ctx.config.display.addedDirsLayout === "inline") {
			const added = addedDirectories(ctx, true);
			if (added.length > 0) project = `${project} ${added.join(" ")}`;
		}
	}
	const git = gitSegment(ctx);
	const projectAndGit = [project, git].filter((part) => Boolean(part)).join(" ") || null;
	const sessionName = ctx.config.display.showSessionName && ctx.state.session?.sessionName ? safeText(ctx.state.session.sessionName) : null;
	const rawAuth = authSegment(ctx);
	const auth = rawAuth ? safeText(rawAuth) : null;
	const parts = [
		model,
		projectAndGit,
		sessionName,
		auth
	].filter((part) => Boolean(part));
	const line = parts.length > 0 ? parts.join(" │ ") : null;
	if (line && git && ctx.config.gitStatus.branchOverflow === "wrap" && visibleWidth(line) > ctx.options.width) {
		const firstLine = [
			model,
			project,
			sessionName,
			auth
		].filter((part) => Boolean(part)).join(" │ ");
		return firstLine ? `${firstLine}\n${git}` : git;
	}
	return line;
}
function renderAddedDirsLine(ctx) {
	if (!ctx.config.display.showAddedDirs || ctx.config.display.addedDirsLayout !== "line") return null;
	const roots = addedDirectories(ctx, false);
	return roots.length > 0 ? `${message(ctx.config.language, "addedDirs")}: ${roots.join(", ")}` : null;
}

//#endregion
//#region src/render/prompt-cache-line.ts
function formatPromptCacheCountdown(remainingMs) {
	if (remainingMs <= 0) return "expired";
	return formatMinuteDuration(remainingMs, "ceil");
}
function renderPromptCacheLine(ctx) {
	const responseAt = ctx.state.session?.lastResponseAt;
	if (!ctx.config.display.showPromptCache || !responseAt) return null;
	const ttlSeconds = ctx.config.display.promptCacheTtlSeconds;
	const remainingMs = responseAt.getTime() + ttlSeconds * 1e3 - ctx.now.getTime();
	const warningSeconds = Math.min(ttlSeconds, Math.max(60, Math.floor(ttlSeconds / 5)));
	const selectedColor = remainingMs <= 0 ? ctx.config.colors.label : remainingMs <= warningSeconds * 1e3 ? ctx.config.colors.warning : ctx.config.colors.context;
	return `${message(ctx.config.language, "promptCache")} ${color(`⏱️ ${formatPromptCacheCountdown(remainingMs)}`, selectedColor, ctx.options.color)}`;
}

//#endregion
//#region src/render/session-line.ts
function renderSessionLine(ctx) {
	const session = ctx.state.session;
	const parts = [];
	if (ctx.config.display.showDuration) parts.push(`⏱️ ${formatDuration(ctx.now.getTime() - ctx.state.sessionStart.getTime())}`);
	if (ctx.config.display.showSessionStartDate && session?.startTime) {
		const locale = ctx.config.language === "en" ? "en" : ctx.config.language === "zh-Hant" ? "zh-TW" : "zh-CN";
		parts.push(`${message(ctx.config.language, "started")} ${session.startTime.toLocaleString(locale)}`);
	}
	if (ctx.config.display.showSpeed && session?.outputTokensPerSecond !== void 0) parts.push(`${message(ctx.config.language, "output")}: ${session.outputTokensPerSecond.toFixed(1)} tok/s`);
	if (ctx.config.display.showSessionTokens && ctx.state.sessionTokens) {
		const usage = ctx.state.sessionTokens;
		parts.push(`${message(ctx.config.language, "tokens")}: ${formatTokens(usage.totalTokens)} (${message(ctx.config.language, "input")} ${formatTokens(usage.inputTokens)}, ${message(ctx.config.language, "cache")} ${formatTokens(usage.cachedInputTokens)}, ${message(ctx.config.language, "output")} ${formatTokens(usage.outputTokens)})`);
	}
	if (ctx.config.display.showCompactions && ctx.state.compactCount > 0) parts.push(`${message(ctx.config.language, "compactions")}: ${ctx.state.compactCount}`);
	if (ctx.config.display.showCodexVersion && session?.cliVersion) parts.push(`Codex ${session.cliVersion}`);
	if (ctx.config.display.showSessionId && session?.id) parts.push(`${message(ctx.config.language, "session")}: ${session.id.slice(0, 8)}`);
	if (ctx.config.display.showLastResponseAt && session?.lastResponseAt) parts.push(`${message(ctx.config.language, "lastResponse")}: ${formatDuration(ctx.now.getTime() - session.lastResponseAt.getTime())}`);
	return parts.length > 0 ? parts.join(" │ ") : null;
}

//#endregion
//#region src/render/turns-line.ts
function renderTurnsLine(ctx) {
	if (!ctx.config.display.showTurns || ctx.state.conversationTurns.length === 0) return null;
	const count = ctx.state.conversationTurns.length;
	return `${color(`↕ ${message(ctx.config.language, "turns")}`, ctx.config.colors.label, ctx.options.color)}: ${String(count)} · ${message(ctx.config.language, "navigate")}`;
}

//#endregion
//#region src/render/usage-line.ts
function renderWindow(ctx, window) {
	if (window.percent === null) return null;
	const value = ctx.config.display.usageValue === "remaining" ? 100 - window.percent : window.percent;
	const suffix = ctx.config.display.usageValue === "remaining" ? "% left" : "%";
	const bar = ctx.config.display.usageBarEnabled && !ctx.config.display.usageCompact ? `${progressBar(window.percent, 10, ctx.config.colors.barFilled, ctx.config.colors.barEmpty)} ` : "";
	const reset = formatResetTime(window.resetAt, ctx.now, ctx.config.display.timeFormat, window.windowMinutes);
	const resetText = reset ? ` (${ctx.config.display.showResetLabel ? `${message(ctx.config.language, "resetsIn")} ` : ""}${reset})` : "";
	return `${window.label}: ${bar}${value}${suffix}${resetText}`;
}
function renderUsageLine(ctx) {
	if (!ctx.config.display.showUsage || !ctx.state.usage) return null;
	const usage = ctx.state.usage;
	if (Math.max(usage.primary?.percent ?? 0, usage.secondary?.percent ?? 0, usage.individual?.percent ?? 0) < ctx.config.display.usageThreshold) return usage.balanceLabel ? color(`${message(ctx.config.language, "usage")} ${usage.balanceLabel}`, ctx.config.colors.usage, ctx.options.color) : null;
	const secondary = usage.secondary && (!usage.primary || (usage.secondary.percent ?? 0) >= ctx.config.display.sevenDayThreshold) ? usage.secondary : null;
	const windows = [
		usage.primary,
		secondary,
		usage.individual
	].flatMap((window) => window ? [renderWindow(ctx, window)] : []).filter((value) => Boolean(value));
	if (usage.balanceLabel) windows.push(usage.balanceLabel);
	if (windows.length === 0) return null;
	const maxPercent = Math.max(usage.primary?.percent ?? 0, usage.secondary?.percent ?? 0, usage.individual?.percent ?? 0);
	const selectedColor = maxPercent >= 100 ? ctx.config.colors.critical : maxPercent >= 80 ? ctx.config.colors.usageWarning : ctx.config.colors.usage;
	return color(`${message(ctx.config.language, "usage")} ${windows.join(" │ ")}`, selectedColor, ctx.options.color);
}

//#endregion
//#region src/render/index.ts
function renderElement(ctx, element) {
	switch (element) {
		case "project": return renderProjectLine(ctx);
		case "addedDirs": return renderAddedDirsLine(ctx);
		case "context": return renderContextLine(ctx);
		case "usage": return renderUsageLine(ctx);
		case "memory": return renderMemoryLine(ctx);
		case "environment": return renderEnvironmentLine(ctx);
		case "tools": return renderToolsLine(ctx);
		case "skills": return renderSkillsLine(ctx);
		case "mcp": return renderMcpLine(ctx);
		case "agents": return renderAgentsLine(ctx);
		case "todos": return renderTodosLine(ctx);
		case "turns": return renderTurnsLine(ctx);
		case "sessionTime": return renderSessionLine(ctx);
		case "promptCache": return renderPromptCacheLine(ctx);
	}
}
function mergeLookup(groups) {
	const result = /* @__PURE__ */ new Map();
	for (const group of groups) {
		const set = new Set(group);
		group.forEach((element) => result.set(element, set));
	}
	return result;
}
function expandedLines(ctx) {
	const lines = [];
	const seen = /* @__PURE__ */ new Set();
	const lookup = mergeLookup(ctx.config.display.mergeGroups);
	for (let index = 0; index < ctx.config.elementOrder.length; index += 1) {
		const element = ctx.config.elementOrder[index];
		if (seen.has(element)) continue;
		const group = lookup.get(element);
		if (group) {
			const sequence = [];
			for (let next = index; next < ctx.config.elementOrder.length; next += 1) {
				const candidate = ctx.config.elementOrder[next];
				if (!group.has(candidate) || seen.has(candidate)) break;
				sequence.push(candidate);
			}
			if (sequence.length > 1) {
				sequence.forEach((item) => seen.add(item));
				index += sequence.length - 1;
				const rendered = sequence.map((item) => renderElement(ctx, item)).filter((line) => Boolean(line));
				const combined = rendered.join(" │ ");
				if (rendered.length > 1 && visibleWidth(combined) <= ctx.options.width) lines.push(combined);
				else lines.push(...rendered);
				continue;
			}
		}
		seen.add(element);
		const line = renderElement(ctx, element);
		if (line) lines.push(...line.split("\n"));
	}
	return lines;
}
function compactLines(ctx) {
	const rendered = [
		renderProjectLine(ctx),
		renderContextLine(ctx),
		renderUsageLine(ctx),
		renderPromptCacheLine(ctx),
		renderEnvironmentLine(ctx),
		renderSessionLine(ctx)
	].filter((line) => Boolean(line));
	const lines = [];
	const overflow = [];
	for (const value of rendered) {
		const [first, ...rest] = value.split("\n");
		if (first) lines.push(first);
		overflow.push(...rest.filter(Boolean));
	}
	const combined = lines.join(" │ ");
	const activity = [
		renderMemoryLine(ctx),
		renderToolsLine(ctx),
		renderSkillsLine(ctx),
		renderMcpLine(ctx),
		renderAgentsLine(ctx),
		renderTodosLine(ctx),
		renderTurnsLine(ctx)
	].filter((line) => Boolean(line)).flatMap((line) => line.split("\n"));
	return [
		combined,
		...overflow,
		...activity
	].filter(Boolean);
}
function renderHud(ctx) {
	let lines = ctx.config.lineLayout === "compact" ? compactLines(ctx) : expandedLines(ctx);
	if (ctx.config.display.customLine) lines = ctx.config.display.customLinePosition === "first" ? [ctx.config.display.customLine, ...lines] : [...lines, ctx.config.display.customLine];
	if (ctx.config.showSeparators && lines.length > 2) lines.splice(2, 0, "─".repeat(Math.min(ctx.options.width, Math.max(20, visibleWidth(lines[0] ?? "")))));
	const height = Math.max(1, ctx.options.height);
	return lines.slice(0, height).map((line) => truncateAnsi(line, ctx.options.width));
}

//#endregion
//#region src/runtime/pane-size.ts
const INITIAL_HUD_PANE_HEIGHT = 5;
function viewportRenderHeight(maximum, rows) {
	const safeMaximum = Math.max(1, Math.round(maximum));
	if (!rows || !Number.isFinite(rows)) return safeMaximum;
	return Math.min(safeMaximum, Math.max(1, Math.floor(rows)));
}
function desiredPaneHeight(lineCount, maximum, minimum = 5) {
	return Math.min(Math.max(minimum, Math.round(maximum)), Math.max(minimum, Math.round(lineCount)));
}
function resizeHudPane(paneId, desiredHeight, previousHeight, runner = (args) => spawnSync("tmux", args, { stdio: "ignore" })) {
	if (!paneId) return null;
	if (previousHeight === desiredHeight) return previousHeight;
	return runner([
		"resize-pane",
		"-t",
		paneId,
		"-y",
		String(desiredHeight)
	]).status === 0 ? desiredHeight : previousHeight;
}
function resizeCmuxPane(paneId, desiredHeight, previousHeight, runner = (args) => spawnSync("cmux", args, { stdio: "ignore" })) {
	if (!paneId) return null;
	if (previousHeight === desiredHeight) return previousHeight;
	return runner([
		"resize-pane",
		"-t",
		paneId,
		"-y",
		String(desiredHeight)
	]).status === 0 ? desiredHeight : previousHeight;
}

//#endregion
//#region src/codex/external-usage.ts
const MAX_BALANCE_LABEL = 80;
const WRITE_HEARTBEAT_MS = 6e4;
const lastWrites = /* @__PURE__ */ new Map();
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
		lastWrites.set(filePath, {
			fingerprint,
			at: now.getTime()
		});
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
//#region src/collectors/agents.ts
const COMPLETED_VISIBLE_MS = 3e4;
const STARTING_VISIBLE_MS = 15 * 6e4;
const CACHE_MS$1 = 1e3;
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
	const cached = rolloutCache.get(candidate.path);
	if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value ? structuredClone(cached.value) : null;
	const activeTurns = /* @__PURE__ */ new Set();
	let model;
	let startedAt = candidate.startTime;
	let lastTimestamp = candidate.startTime;
	try {
		const lines = fs.readFileSync(candidate.path, "utf8").split(/\r?\n/).filter(Boolean);
		for (const line of lines) {
			let entry;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			lastTimestamp = safeDate(entry.timestamp, lastTimestamp);
			const payload = entry.payload;
			if (!payload) continue;
			if (entry.type === "turn_context") {
				const collaboration = payload.collaboration_mode;
				const settings = collaboration && typeof collaboration === "object" && !Array.isArray(collaboration) ? collaboration.settings : null;
				model = typeof payload.model === "string" ? payload.model : settings && typeof settings === "object" && !Array.isArray(settings) && typeof settings.model === "string" ? settings.model : model;
			}
			if (entry.type !== "event_msg") continue;
			if (payload.type === "task_started" && typeof payload.turn_id === "string") {
				activeTurns.add(payload.turn_id);
				startedAt = safeDate(payload.started_at, lastTimestamp);
			} else if (payload.type === "task_complete" && typeof payload.turn_id === "string") activeTurns.delete(payload.turn_id);
			else if (payload.type === "turn_aborted") if (typeof payload.turn_id === "string") activeTurns.delete(payload.turn_id);
			else activeTurns.clear();
		}
	} catch {
		rolloutCache.set(candidate.path, {
			mtimeMs: stat.mtimeMs,
			size: stat.size,
			value: null
		});
		return null;
	}
	const value = {
		active: activeTurns.size > 0,
		model,
		startedAt,
		lastTimestamp
	};
	rolloutCache.set(candidate.path, {
		mtimeMs: stat.mtimeMs,
		size: stat.size,
		value
	});
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
	const key = `${codexHome}:${session.id}`;
	if (cache$1?.key === key && now.getTime() - cache$1.at < CACHE_MS$1) return structuredClone(cache$1.agents);
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
const CACHE_MS = 2e3;
const cache = /* @__PURE__ */ new Map();
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
function findGitRoot(cwd) {
	return git(cwd, ["rev-parse", "--show-toplevel"]);
}
function collectGitStatus(cwd) {
	const now = Date.now();
	const cached = cache.get(cwd);
	if (cached && now - cached.at < CACHE_MS) return cached.status ? structuredClone(cached.status) : null;
	const root = findGitRoot(cwd);
	if (!root) {
		cache.set(cwd, {
			at: now,
			status: null
		});
		return null;
	}
	const branch = git(root, [
		"symbolic-ref",
		"--quiet",
		"--short",
		"HEAD"
	]) ?? git(root, [
		"rev-parse",
		"--short",
		"HEAD"
	]);
	const records = (git(root, [
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=normal"
	]) ?? "").split("\0").filter(Boolean);
	let modified = 0;
	let added = 0;
	let deleted = 0;
	let untracked = 0;
	for (const record of records) {
		const status = record.slice(0, 2);
		if (status === "??") {
			untracked += 1;
			continue;
		}
		if (status.includes("D")) deleted += 1;
		else if (status.includes("A")) added += 1;
		else modified += 1;
	}
	const divergence = git(root, [
		"rev-list",
		"--left-right",
		"--count",
		"HEAD...@{upstream}"
	]);
	const [ahead = 0, behind = 0] = divergence ? divergence.split(/\s+/).map((value) => Number.parseInt(value, 10) || 0) : [0, 0];
	const status = {
		isGitRepo: true,
		branch,
		isDirty: records.length > 0,
		ahead,
		behind,
		modified,
		added,
		deleted,
		untracked
	};
	cache.set(cwd, {
		at: now,
		status
	});
	return structuredClone(status);
}

//#endregion
//#region src/collectors/memory.ts
function collectMemoryInfo() {
	const totalBytes = os.totalmem();
	const freeBytes = os.freemem();
	const usedBytes = Math.max(0, totalBytes - freeBytes);
	return {
		totalBytes,
		usedBytes,
		freeBytes,
		usedPercent: totalBytes > 0 ? Math.round(usedBytes / totalBytes * 100) : 0
	};
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
	projectCache.set(cacheKey, {
		at: now,
		value
	});
	return structuredClone(value);
}

//#endregion
//#region src/collectors/session-metadata.ts
const titleCache = /* @__PURE__ */ new Map();
const authCache = /* @__PURE__ */ new Map();
const METADATA_CACHE_MS = 3e4;
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
function collectAuthInfo(planType, env = process.env) {
	const cacheKey = `${getCodexHome(env)}:${planType ?? ""}:${Boolean(env.OPENAI_API_KEY)}`;
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
	if (planType) {
		const value = {
			method: `ChatGPT ${planType}`,
			user: user ?? void 0
		};
		authCache.set(cacheKey, {
			at: Date.now(),
			value
		});
		return structuredClone(value);
	}
	if (hasApiKey) {
		const value = { method: "API Key" };
		authCache.set(cacheKey, {
			at: Date.now(),
			value
		});
		return value;
	}
	if (Object.keys(auth).length > 0) {
		const value = {
			method: "ChatGPT",
			user: user ?? void 0
		};
		authCache.set(cacheKey, {
			at: Date.now(),
			value
		});
		return structuredClone(value);
	}
	authCache.set(cacheKey, {
		at: Date.now(),
		value: null
	});
	return null;
}
function collectSessionTitle(session, env = process.env) {
	if (!session) return null;
	const cacheKey = `${getCodexHome(env)}:${session.id}`;
	const cached = titleCache.get(cacheKey);
	if (cached && Date.now() - cached.at < METADATA_CACHE_MS) return cached.title;
	const database = path.join(getCodexHome(env), "state_5.sqlite");
	if (!fs.existsSync(database)) {
		titleCache.set(cacheKey, {
			at: Date.now(),
			title: null
		});
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
		titleCache.set(cacheKey, {
			at: Date.now(),
			title: null
		});
		return null;
	}
	const title = result.stdout.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
	const normalized = title ? title.slice(0, 80) : null;
	titleCache.set(cacheKey, {
		at: Date.now(),
		title: normalized
	});
	return normalized;
}

//#endregion
//#region src/runtime/state.ts
function buildHudState(cwd, rollout, sessionStart, config, now = /* @__PURE__ */ new Date()) {
	const workspaceRoots = rollout.session?.workspaceRoots ?? [];
	const usage = resolveUsageData(rollout.usage, config.display, now);
	const title = config.display.showSessionName ? collectSessionTitle(rollout.session) : null;
	const session = rollout.session ? {
		...rollout.session,
		sessionName: title ?? rollout.session.sessionName
	} : null;
	return {
		session,
		project: collectProjectInfo(cwd, workspaceRoots, process.env, config.display.showConfigCounts),
		git: config.gitStatus.enabled ? collectGitStatus(cwd) : null,
		context: rollout.context,
		usage,
		sessionTokens: rollout.sessionTokens,
		tools: rollout.tools,
		skills: rollout.skills,
		mcpServers: rollout.mcpServers,
		agents: config.display.showAgents ? collectAgentEntries(session) : [],
		todos: rollout.todos,
		goal: rollout.goal,
		conversationTurns: rollout.conversationTurns,
		compactCount: rollout.compactCount,
		memory: config.display.showMemoryUsage ? collectMemoryInfo() : null,
		auth: config.display.showAuth ? collectAuthInfo(usage?.planType ?? null) : null,
		sessionStart: session?.startTime ?? sessionStart
	};
}

//#endregion
//#region src/runtime/session-binding.ts
const DISCOVERY_TIMEOUT_MS = 1e4;
const LOCK_STALE_MS = 3e4;
function normalizedPath(value) {
	let resolved;
	try {
		resolved = fs.realpathSync.native(value);
	} catch {
		resolved = path.resolve(value);
	}
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function rootSessions(cwd, codexHome = getCodexHome()) {
	const normalizedCwd = normalizedPath(cwd);
	return listSessionCandidates(codexHome).filter((candidate) => !isSubagentSource(candidate.source)).filter((candidate) => normalizedPath(candidate.cwd) === normalizedCwd);
}
function snapshotRootSessions(cwd, codexHome = getCodexHome()) {
	return new Map(rootSessions(cwd, codexHome).map((candidate) => [candidate.path, candidate.mtimeMs]));
}
function findNewRootSession(cwd, snapshot, codexHome = getCodexHome(), allowModified = false) {
	return rootSessions(cwd, codexHome).filter((candidate) => !snapshot.has(candidate.path) || allowModified && candidate.mtimeMs > (snapshot.get(candidate.path) ?? 0)).sort((left, right) => {
		const leftIsNew = !snapshot.has(left.path);
		if (leftIsNew !== !snapshot.has(right.path)) return leftIsNew ? -1 : 1;
		return left.startTime.getTime() - right.startTime.getTime();
	})[0] ?? null;
}
function createSessionBindingPath(cwd, env = process.env) {
	const digest = createHash("sha1").update(normalizedPath(cwd)).digest("hex").slice(0, 12);
	return path.join(getHudStateDirectory(env), "bindings", `${digest}-${randomUUID()}.json`);
}
function writeSessionBinding(bindingPath, rolloutPath) {
	fs.mkdirSync(path.dirname(bindingPath), {
		recursive: true,
		mode: 448
	});
	const temporaryPath = `${bindingPath}.${process.pid}.tmp`;
	fs.writeFileSync(temporaryPath, `${JSON.stringify({ rolloutPath })}\n`, { mode: 384 });
	fs.renameSync(temporaryPath, bindingPath);
}
function readSessionBinding(bindingPath) {
	try {
		const value = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
		return typeof value.rolloutPath === "string" && fs.existsSync(value.rolloutPath) ? value.rolloutPath : null;
	} catch {
		return null;
	}
}
function lockPath(cwd, env = process.env) {
	const digest = createHash("sha1").update(normalizedPath(cwd)).digest("hex");
	return path.join(getHudStateDirectory(env), "bindings", "locks", digest);
}
function delay(milliseconds, signal) {
	if (signal?.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		let timer;
		const finish = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", finish);
			resolve();
		};
		timer = setTimeout(finish, milliseconds);
		signal?.addEventListener("abort", finish, { once: true });
	});
}
async function acquireSessionDiscoveryLock(cwd, env = process.env) {
	const target = lockPath(cwd, env);
	fs.mkdirSync(path.dirname(target), {
		recursive: true,
		mode: 448
	});
	while (true) try {
		fs.mkdirSync(target, { mode: 448 });
		return () => fs.rmSync(target, {
			recursive: true,
			force: true
		});
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		try {
			if (Date.now() - fs.statSync(target).mtimeMs > LOCK_STALE_MS) {
				fs.rmSync(target, {
					recursive: true,
					force: true
				});
				continue;
			}
		} catch {
			continue;
		}
		await delay(25);
	}
}
async function waitForNewRootSession(cwd, snapshot, codexHome = getCodexHome(), timeoutMs = DISCOVERY_TIMEOUT_MS, signal, allowModified = false) {
	const deadline = Date.now() + timeoutMs;
	do {
		if (signal?.aborted) return null;
		const session = findNewRootSession(cwd, snapshot, codexHome, allowModified);
		if (session) return session.path;
		await delay(25, signal);
	} while (Date.now() < deadline);
	return null;
}

//#endregion
export { getLegacyStateDirectory as C, getHudStateDirectory as S, loadConfig as _, waitForNewRootSession as a, getCodexHome as b, desiredPaneHeight as c, viewportRenderHeight as d, renderHud as f, sliceAnsi as g, visibleWidth as h, snapshotRootSessions as i, resizeCmuxPane as l, truncateAnsi as m, createSessionBindingPath as n, writeSessionBinding as o, safeText as p, readSessionBinding as r, buildHudState as s, acquireSessionDiscoveryLock as t, resizeHudPane as u, DEFAULT_CONFIG as v, RolloutParser as w, getConfigPath as x, findActiveSession as y };
//# sourceMappingURL=session-binding-B7WQz9fR.mjs.map
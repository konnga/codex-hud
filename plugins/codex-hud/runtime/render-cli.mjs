#!/usr/bin/env node
import { T as RolloutParser, _ as sliceAnsi, b as findActiveSession, c as desiredPaneHeight, d as resizeHudPane, f as viewportRenderHeight, g as visibleWidth, h as truncateAnsi, l as isExternalCmuxResize, m as safeText, p as renderHud, r as readSessionBinding, s as buildHudState, u as resizeCmuxPane, v as loadConfig } from "./session-binding-BJelLPyI.mjs";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

//#region src/navigator/index.ts
const LABELS = {
	"en": {
		title: "Conversation navigator",
		turns: "turns",
		search: "Search",
		noMatches: "No matching user messages",
		user: "User",
		assistant: "Assistant",
		waiting: "Waiting for a response…",
		listHelp: "j/k move · Enter open · / search · q/Esc close",
		detailHelp: "j/k scroll · h/←/Esc list · q close"
	},
	"zh-Hans": {
		title: "会话历史导航",
		turns: "轮",
		search: "搜索",
		noMatches: "没有匹配的用户输入",
		user: "用户",
		assistant: "助手",
		waiting: "正在等待回复…",
		listHelp: "j/k 选择 · Enter 查看 · / 搜索 · q/Esc 关闭",
		detailHelp: "j/k 滚动 · h/←/Esc 返回 · q 关闭"
	},
	"zh-Hant": {
		title: "會話歷史導航",
		turns: "輪",
		search: "搜尋",
		noMatches: "沒有符合的使用者輸入",
		user: "使用者",
		assistant: "助手",
		waiting: "正在等待回應…",
		listHelp: "j/k 選擇 · Enter 查看 · / 搜尋 · q/Esc 關閉",
		detailHelp: "j/k 捲動 · h/←/Esc 返回 · q 關閉"
	}
};
function createNavigatorState() {
	return {
		active: false,
		view: "list",
		selectedIndex: 0,
		query: "",
		searchMode: false,
		detailScroll: 0
	};
}
const KEY_SEQUENCES = [
	"\x1B[A",
	"\x1B[B",
	"\x1B[C",
	"\x1B[D",
	"\x1B[5~",
	"\x1B[6~"
];
function splitNavigatorInput(value) {
	const result = [];
	let remaining = value;
	while (remaining) {
		const sequence = KEY_SEQUENCES.find((candidate) => remaining.startsWith(candidate));
		if (sequence) {
			result.push(sequence);
			remaining = remaining.slice(sequence.length);
			continue;
		}
		const character = Array.from(remaining)[0];
		if (!character) break;
		result.push(character);
		remaining = remaining.slice(character.length);
	}
	return result;
}
function matchingTurnIndices(turns, query) {
	const normalized = query.trim().toLocaleLowerCase();
	if (!normalized) return turns.map((_turn, index) => index);
	return turns.flatMap((turn, index) => {
		return `${turn.userMessage}\n${turn.assistantMessage}`.toLocaleLowerCase().includes(normalized) ? [index] : [];
	});
}
function normalizeNavigatorSelection(state, turns) {
	const matches = matchingTurnIndices(turns, state.query);
	if (matches.length === 0) {
		state.selectedIndex = 0;
		return matches;
	}
	if (!matches.includes(state.selectedIndex)) state.selectedIndex = matches.at(-1) ?? 0;
	return matches;
}
function sanitizeMultiline(value) {
	return value.replace(/\r/g, "").split("\n").map((line) => Array.from(line, (character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint <= 31 || codePoint === 127 ? " " : character;
	}).join("").trimEnd());
}
function wrapLine(value, width) {
	if (!value) return [""];
	const lines = [];
	let remaining = value;
	while (visibleWidth(remaining) > width) {
		const part = sliceAnsi(remaining, 0, width);
		lines.push(part);
		remaining = sliceAnsi(remaining, width);
	}
	lines.push(remaining);
	return lines;
}
function wrapText(value, width) {
	const safeWidth = Math.max(1, width);
	return sanitizeMultiline(value).flatMap((line) => wrapLine(line, safeWidth));
}
function inverse(value, enabled) {
	return enabled ? `\u001B[7m${value}\u001B[0m` : `> ${value}`;
}
function padLine(value, width) {
	const truncated = truncateAnsi(value, width);
	return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}
function timeLabel(date) {
	return date.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit"
	});
}
function renderList(turns, state, options) {
	const labels = LABELS[options.language];
	const width = Math.max(20, options.width);
	const height = Math.max(5, options.height);
	const matches = normalizeNavigatorSelection(state, turns);
	const header = `${labels.title} · ${String(turns.length)} ${labels.turns}`;
	const search = state.searchMode || state.query ? `${labels.search}: ${state.query}${state.searchMode ? "█" : ""}` : "";
	const rowCount = Math.max(1, height - (search ? 3 : 2));
	const selectedPosition = Math.max(0, matches.indexOf(state.selectedIndex));
	const start = Math.max(0, Math.min(selectedPosition - Math.floor(rowCount / 2), matches.length - rowCount));
	const visible = matches.slice(start, start + rowCount);
	const lines = [truncateAnsi(header, width)];
	if (search) lines.push(truncateAnsi(search, width));
	if (visible.length === 0) lines.push(labels.noMatches);
	else for (const index of visible) {
		const turn = turns[index];
		const row = padLine(`${`#${String(index + 1).padStart(2, "0")} ${timeLabel(turn.startedAt)} `}${safeText(turn.userMessage)}`, width);
		lines.push(index === state.selectedIndex ? inverse(row, options.color) : row);
	}
	lines.push(truncateAnsi(labels.listHelp, width));
	return lines.slice(0, height);
}
function renderDetail(turns, state, options) {
	const labels = LABELS[options.language];
	const width = Math.max(20, options.width);
	const height = Math.max(5, options.height);
	const turn = turns[state.selectedIndex];
	if (!turn) {
		state.view = "list";
		return renderList(turns, state, options);
	}
	const body = [
		`${labels.user} · #${String(state.selectedIndex + 1)} · ${timeLabel(turn.startedAt)}`,
		...wrapText(turn.userMessage, width),
		"",
		labels.assistant,
		...wrapText(turn.assistantMessage || labels.waiting, width)
	];
	const bodyHeight = Math.max(1, height - 2);
	const maximumScroll = Math.max(0, body.length - bodyHeight);
	const scroll = Math.min(maximumScroll, Math.max(0, state.detailScroll));
	state.detailScroll = scroll;
	return [
		truncateAnsi(`${labels.title} · #${String(state.selectedIndex + 1)}/${String(turns.length)}`, width),
		...body.slice(scroll, scroll + bodyHeight).map((line) => truncateAnsi(line, width)),
		truncateAnsi(labels.detailHelp, width)
	].slice(0, height);
}
function renderNavigator(turns, state, options) {
	return state.view === "detail" ? renderDetail(turns, state, options) : renderList(turns, state, options);
}

//#endregion
//#region src/runtime/config-watch.ts
function isConfigPathEvent(configPath, filename) {
	return filename === null || filename.toString() === path.basename(configPath);
}
function watchConfigPath(configPath, onChange) {
	try {
		return fs.watch(path.dirname(configPath), (_event, filename) => {
			if (isConfigPathEvent(configPath, filename)) onChange();
		});
	} catch {
		return null;
	}
}

//#endregion
//#region src/render-cli.ts
function parseOptions(args) {
	const options = {
		cwd: process.cwd(),
		color: process.stdout.isTTY && !process.env.NO_COLOR,
		once: false,
		sessionPath: null,
		sessionBindingPath: null,
		launchedAfter: null,
		allowModifiedSession: false,
		cmuxPaneId: null,
		cmuxSourcePaneId: null,
		cmuxWorkspaceId: null,
		maxHeight: Number(process.env.CODEX_HUD_HEIGHT) || 30
	};
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--cwd" && args[index + 1]) options.cwd = args[++index];
		else if (argument === "--session" && args[index + 1]) options.sessionPath = args[++index];
		else if (argument === "--once") options.once = true;
		else if (argument === "--session-binding" && args[index + 1]) options.sessionBindingPath = args[++index];
		else if (argument === "--launched-after" && args[index + 1]) {
			const value = new Date(args[++index]);
			options.launchedAfter = Number.isNaN(value.getTime()) ? null : value;
		} else if (argument === "--no-color") options.color = false;
		else if (argument === "--allow-modified-session") options.allowModifiedSession = true;
		else if (argument === "--cmux-pane" && args[index + 1]) options.cmuxPaneId = args[++index];
		else if (argument === "--cmux-source-pane" && args[index + 1]) options.cmuxSourcePaneId = args[++index];
		else if (argument === "--cmux-workspace" && args[index + 1]) options.cmuxWorkspaceId = args[++index];
		else if (argument === "--max-height" && args[index + 1]) options.maxHeight = Math.max(5, Math.min(30, Number(args[++index]) || 30));
	}
	return options;
}
async function runRenderCli(args = process.argv.slice(2)) {
	const options = parseOptions(args);
	let loaded = loadConfig();
	const parser = new RolloutParser();
	const navigator = createNavigatorState();
	let currentSessionPath = options.sessionPath;
	let lastDiscoveryAt = 0;
	let sessionWatcher = null;
	let debounceTimer = null;
	let resizeTimer = null;
	parser.setFile(currentSessionPath);
	const startedAt = /* @__PURE__ */ new Date();
	let lastFrame = "";
	let lastViewport = "";
	let paneHeight = null;
	let cmuxManualHeight = false;
	let cmuxResizePending = false;
	let latestTurns = parser.getState().conversationTurns;
	const paneId = process.env.TMUX_PANE ?? null;
	const configMtime = () => {
		try {
			return fs.statSync(loaded.path).mtimeMs;
		} catch {
			return 0;
		}
	};
	let lastConfigMtime = configMtime();
	const render = () => {
		const nowMs = Date.now();
		if (currentSessionPath && !fs.existsSync(currentSessionPath)) {
			currentSessionPath = null;
			parser.setFile(null);
			sessionWatcher?.close();
			sessionWatcher = null;
		}
		if (!options.sessionPath && !currentSessionPath && nowMs - lastDiscoveryAt >= 250) {
			lastDiscoveryAt = nowMs;
			const bound = options.sessionBindingPath ? readSessionBinding(options.sessionBindingPath) : null;
			const discovered = bound ? { path: bound } : findActiveSession({
				cwd: options.cwd,
				launchedAfter: options.launchedAfter,
				allowModifiedBeforeLaunch: options.allowModifiedSession
			});
			if (discovered?.path !== currentSessionPath) {
				currentSessionPath = discovered?.path ?? null;
				parser.setFile(currentSessionPath);
				sessionWatcher?.close();
				sessionWatcher = null;
				if (currentSessionPath && !options.once) try {
					sessionWatcher = fs.watch(currentSessionPath, () => {
						if (debounceTimer) clearTimeout(debounceTimer);
						debounceTimer = setTimeout(render, 40);
					});
				} catch {
					sessionWatcher = null;
				}
			}
		}
		const rollout = parser.parse();
		const state = buildHudState(options.cwd, rollout, startedAt, loaded.config, /* @__PURE__ */ new Date());
		latestTurns = state.conversationTurns;
		const width = process.stdout.columns || Number(process.env.COLUMNS) || loaded.config.maxWidth || 120;
		const height = viewportRenderHeight(options.maxHeight, process.stdout.rows);
		const lines = navigator.active ? renderNavigator(latestTurns, navigator, {
			width,
			height,
			color: options.color,
			language: loaded.config.language
		}) : renderHud({
			config: loaded.config,
			state,
			options: {
				width,
				height,
				color: options.color
			},
			now: /* @__PURE__ */ new Date()
		});
		const frame = lines.join("\n");
		if (options.once) {
			process.stdout.write(`${frame}\n`);
			return;
		}
		const desiredHeight = navigator.active ? options.maxHeight : desiredPaneHeight(lines.length, options.maxHeight);
		if (options.cmuxPaneId) {
			if (!cmuxManualHeight && !cmuxResizePending) paneHeight = resizeCmuxPane(options.cmuxPaneId, options.cmuxSourcePaneId, options.cmuxWorkspaceId, desiredHeight, process.stdout.rows, paneHeight);
		} else paneHeight = resizeHudPane(paneId, desiredHeight, paneHeight);
		const viewport = `${width}x${String(process.stdout.rows ?? "")}`;
		const viewportChanged = viewport !== lastViewport;
		if (frame !== lastFrame || viewportChanged) {
			lastFrame = frame;
			lastViewport = viewport;
			const clear = viewportChanged ? "\x1B[2J\x1B[H" : "\x1B[H";
			process.stdout.write(`\u001B[?25l${clear}${lines.map((line) => `\u001B[2K${line}`).join("\n")}\u001B[J`);
		}
	};
	render();
	if (options.once) return;
	const interval = setInterval(render, 1e3);
	const configSafetyInterval = setInterval(() => {
		const nextMtime = configMtime();
		if (nextMtime !== lastConfigMtime) {
			loaded = loadConfig();
			lastConfigMtime = nextMtime;
			render();
		}
	}, 1e4);
	const configWatcher = watchConfigPath(loaded.path, () => {
		loaded = loadConfig();
		lastConfigMtime = configMtime();
		render();
	});
	const onResize = () => {
		if (options.cmuxPaneId) {
			cmuxResizePending = true;
			if (resizeTimer) clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				cmuxResizePending = false;
				if (isExternalCmuxResize(process.stdout.rows, paneHeight)) cmuxManualHeight = true;
				render();
			}, 150);
		}
		render();
	};
	process.on("SIGWINCH", onResize);
	const focusCodexPane = () => {
		if (options.cmuxPaneId) {
			const workspace = process.env.CMUX_WORKSPACE_ID;
			spawnSync("cmux", ["last-pane", ...workspace ? ["--workspace", workspace] : []], { stdio: "ignore" });
			return;
		}
		if (paneId) spawnSync("tmux", ["select-pane", "-U"], { stdio: "ignore" });
	};
	const closeNavigator = () => {
		navigator.active = false;
		navigator.view = "list";
		navigator.searchMode = false;
		navigator.detailScroll = 0;
		render();
		focusCodexPane();
	};
	const moveSelection = (delta) => {
		const matches = normalizeNavigatorSelection(navigator, latestTurns);
		if (matches.length === 0) return;
		const current = Math.max(0, matches.indexOf(navigator.selectedIndex));
		const next = Math.min(matches.length - 1, Math.max(0, current + delta));
		navigator.selectedIndex = matches[next] ?? navigator.selectedIndex;
		navigator.detailScroll = 0;
	};
	let shutdown = () => {};
	const onKey = (key) => {
		if (key === "") {
			shutdown();
			return;
		}
		if (!navigator.active) {
			if (loaded.config.display.showTurns && (key === "n" || key === "N" || key === "\r") && latestTurns.length > 0) {
				navigator.active = true;
				navigator.view = "list";
				navigator.searchMode = false;
				navigator.detailScroll = 0;
				navigator.selectedIndex = latestTurns.length - 1;
				render();
			}
			return;
		}
		if (navigator.searchMode) {
			if (key === "\x1B" || key === "\r") navigator.searchMode = false;
			else if (key === "" || key === "\b") navigator.query = Array.from(navigator.query).slice(0, -1).join("");
			else if (!key.startsWith("\x1B") && Array.from(key).every((character) => {
				const codePoint = character.codePointAt(0) ?? 0;
				return codePoint > 31 && codePoint !== 127;
			})) navigator.query += key;
			normalizeNavigatorSelection(navigator, latestTurns);
			navigator.detailScroll = 0;
			render();
			return;
		}
		if (key === "q" || key === "Q") {
			closeNavigator();
			return;
		}
		if (navigator.view === "detail") {
			if (key === "\x1B" || key === "h" || key === "\x1B[D") {
				navigator.view = "list";
				navigator.detailScroll = 0;
			} else if (key === "j" || key === "\x1B[B") navigator.detailScroll += 1;
			else if (key === "k" || key === "\x1B[A") navigator.detailScroll = Math.max(0, navigator.detailScroll - 1);
			else if (key === "\x1B[6~" || key === " ") navigator.detailScroll += Math.max(1, options.maxHeight - 4);
			else if (key === "\x1B[5~") navigator.detailScroll = Math.max(0, navigator.detailScroll - Math.max(1, options.maxHeight - 4));
			render();
			return;
		}
		if (key === "\x1B") {
			closeNavigator();
			return;
		}
		if (key === "/") navigator.searchMode = true;
		else if (key === "j" || key === "\x1B[B") moveSelection(1);
		else if (key === "k" || key === "\x1B[A") moveSelection(-1);
		else if (key === "g") navigator.selectedIndex = matchingTurnIndices(latestTurns, navigator.query)[0] ?? navigator.selectedIndex;
		else if (key === "G") navigator.selectedIndex = matchingTurnIndices(latestTurns, navigator.query).at(-1) ?? navigator.selectedIndex;
		else if (key === "\r" || key === "l" || key === "\x1B[C") {
			if (latestTurns[navigator.selectedIndex]) {
				navigator.view = "detail";
				navigator.detailScroll = 0;
			}
		}
		render();
	};
	const onInput = (value) => {
		splitNavigatorInput(value.toString()).forEach(onKey);
	};
	shutdown = () => {
		clearInterval(interval);
		clearInterval(configSafetyInterval);
		if (debounceTimer) clearTimeout(debounceTimer);
		if (resizeTimer) clearTimeout(resizeTimer);
		sessionWatcher?.close();
		configWatcher?.close();
		process.off("SIGWINCH", onResize);
		process.stdin.off("data", onInput);
		if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
		process.stdout.write("\x1B[?25h\x1B[0m");
		process.exit(0);
	};
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.on("data", onInput);
	}
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
	process.on("SIGHUP", shutdown);
}
const entrypoint = process.argv[1];
if (entrypoint && pathToFileURL(entrypoint).href === import.meta.url) runRenderCli().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

//#endregion
export { runRenderCli };
//# sourceMappingURL=render-cli.mjs.map
#!/usr/bin/env node
import { A as evaluateUsageTrust, B as resolveSessionEndpoint, E as RolloutParser, L as isOfficialOpenAIEndpoint, M as readCachedConfiguredExternalUsage, N as readConfiguredExternalUsage, O as persistRolloutRateLimits, R as resolveProcessEndpoint, T as findActiveSession, V as HUD_VERSION, _ as sliceAnsi, c as desiredPaneHeight, d as resizeCmuxPane, f as resizeHudPane, g as visibleWidth, h as truncateAnsi, k as readLatestLoggedRateLimits, l as hudRenderHeight, m as renderHud, o as writeSessionBinding, p as settleCmuxPaneHeight, r as readSessionBinding, s as buildHudState, u as readCmuxPaneGeometry, v as loadConfig, w as hasTrustedOpenAiAuth, y as reloadConfig, z as resolveProcessSession } from "./session-binding-C46L2ABs.mjs";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

//#region src/runtime/clipboard.ts
function copyText(value) {
	const commands = process.platform === "darwin" ? [["pbcopy", []]] : process.platform === "win32" ? [["clip", []]] : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]]];
	for (const [command, args] of commands) if (spawnSync(command, args, {
		input: value,
		stdio: [
			"pipe",
			"ignore",
			"ignore"
		]
	}).status === 0) return true;
	return false;
}

//#endregion
//#region src/images/viewer.ts
const LABELS$1 = {
	"en": {
		title: "Image gallery",
		images: "images",
		noImages: "No available images",
		missing: "Image file is no longer available",
		listHelp: "j/k move · Enter preview · o open · y copy path · q/Esc close",
		previewHelp: "←/→ previous/next · j/k scroll · o open · y copy path · q/Esc back",
		open: "Open",
		copied: "Path copied",
		unavailable: "unavailable",
		path: "Path",
		info: "Info",
		inlineRequired: "Inline preview requires chafa.",
		openHint: "Press o to open with the system image viewer."
	},
	"zh-Hans": {
		title: "图片画廊",
		images: "张图片",
		noImages: "没有可用图片",
		missing: "图片文件已不存在",
		listHelp: "j/k 选择 · Enter 预览 · o 打开 · y 复制路径 · q/Esc 关闭",
		previewHelp: "←/→ 上一张/下一张 · j/k 滚动 · o 打开 · y 复制路径 · q/Esc 返回",
		open: "打开",
		copied: "路径已复制",
		unavailable: "不可用",
		path: "路径",
		info: "信息",
		inlineRequired: "内联预览需要安装 chafa。",
		openHint: "按 o 使用系统图片查看器打开。"
	}
};
function createImageViewerState() {
	return {
		active: false,
		view: "list",
		selectedIndex: 0,
		previewScroll: 0,
		previewPath: null,
		previewLines: []
	};
}
function imageInfo(image, unavailable = "unavailable") {
	try {
		const stat = fs.statSync(image.path);
		const size = stat.size < 1024 * 1024 ? `${Math.max(1, Math.round(stat.size / 1024))} KB` : `${(stat.size / (1024 * 1024)).toFixed(1)} MB`;
		return `${path.extname(image.path).slice(1).toUpperCase()} · ${size}`;
	} catch {
		return unavailable;
	}
}
function timeLabel$1(image) {
	return image.createdAt.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit"
	});
}
function padLine$1(value, width) {
	const line = truncateAnsi(value, width);
	return `${line}${" ".repeat(Math.max(0, width - visibleWidth(line)))}`;
}
function selectedIndex(state, images) {
	if (images.length === 0) {
		state.selectedIndex = 0;
		return 0;
	}
	state.selectedIndex = Math.min(images.length - 1, Math.max(0, state.selectedIndex));
	return state.selectedIndex;
}
function renderImageViewer(images, state, options) {
	const labels = LABELS$1[options.language];
	const width = Math.max(24, options.width);
	const height = Math.max(8, options.height);
	if (state.view === "preview" && images.length > 0) {
		const image = images[selectedIndex(state, images)];
		const header = `${labels.title} · ${String(state.selectedIndex + 1)}/${String(images.length)} · ${path.basename(image.path)}`;
		const bodyHeight = Math.max(1, height - 2);
		const maximumScroll = Math.max(0, state.previewLines.length - bodyHeight);
		state.previewScroll = Math.min(maximumScroll, Math.max(0, state.previewScroll));
		return [
			truncateAnsi(header, width),
			...state.previewLines.slice(state.previewScroll, state.previewScroll + bodyHeight).map((line) => truncateAnsi(line, width)),
			truncateAnsi(labels.previewHelp, width)
		].slice(0, height);
	}
	const header = `${labels.title} · ${String(images.length)} ${labels.images}`;
	if (images.length === 0) return [
		header,
		labels.noImages,
		labels.listHelp
	].map((line) => truncateAnsi(line, width));
	const rows = Math.max(1, height - 2);
	const start = Math.max(0, Math.min(state.selectedIndex - Math.floor(rows / 2), images.length - rows));
	const lines = [truncateAnsi(header, width)];
	for (let index = start; index < Math.min(images.length, start + rows); index += 1) {
		const image = images[index];
		const row = `${index === selectedIndex(state, images) ? "> " : "  "}#${String(index + 1).padStart(2, "0")} ${timeLabel$1(image)} ${path.basename(image.path)} · ${imageInfo(image, labels.unavailable)}`;
		lines.push(padLine$1(row, width));
	}
	lines.push(truncateAnsi(labels.listHelp, width));
	return lines.slice(0, height);
}
function createImagePreview(image, width, height, language = "en") {
	const maxWidth = Math.max(20, width);
	const maxHeight = Math.max(4, height - 3);
	const result = spawnSync("chafa", [
		"--format",
		"symbols",
		"--colors",
		"256",
		"--size",
		`${String(maxWidth)}x${String(maxHeight)}`,
		"--animate",
		"off",
		image.path
	], {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		],
		timeout: 2e3
	});
	if (result.status === 0 && result.stdout.trim()) return result.stdout.replace(/\r/g, "").trimEnd().split("\n");
	const labels = LABELS$1[language];
	return [
		`${labels.path}: ${image.path}`,
		`${labels.info}: ${imageInfo(image, labels.unavailable)}`,
		"",
		labels.inlineRequired,
		labels.openHint
	];
}
function openImage(image) {
	if (process.platform === "darwin") spawnSync("open", [image.path], { stdio: "ignore" });
	else if (process.platform === "win32") spawnSync("cmd", [
		"/c",
		"start",
		"",
		image.path
	], { stdio: "ignore" });
	else spawnSync("xdg-open", [image.path], { stdio: "ignore" });
}
function copyImagePath(image) {
	return copyText(image.path);
}

//#endregion
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
		listHelp: "j/k move · Enter open · / search · y copy ID · q/Esc close",
		detailHelp: "j/k scroll · h/←/Esc list · y copy ID · q close",
		copy: "⧉  y",
		copied: "✓ copied",
		copyFailed: "! copy failed"
	},
	"zh-Hans": {
		title: "会话历史导航",
		turns: "轮",
		search: "搜索",
		noMatches: "没有匹配的用户输入",
		user: "用户",
		assistant: "助手",
		waiting: "正在等待回复…",
		listHelp: "j/k 选择 · Enter 查看 · / 搜索 · y 复制 ID · q/Esc 关闭",
		detailHelp: "j/k 滚动 · h/←/Esc 返回 · y 复制 ID · q 关闭",
		copy: "⧉  y",
		copied: "✓ 已复制",
		copyFailed: "! 复制失败"
	}
};
function createNavigatorState() {
	return {
		active: false,
		view: "list",
		selectedIndex: 0,
		query: "",
		searchMode: false,
		detailScroll: 0,
		copyStatus: "idle"
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
function renderListItem(turn, index, selected, width, color) {
	const prefix = `#${String(index + 1).padStart(2, "0")} ${timeLabel(turn.startedAt)} `;
	const prefixWidth = visibleWidth(prefix);
	const messageWidth = Math.max(1, width - prefixWidth);
	const indent = " ".repeat(prefixWidth);
	return wrapText(turn.userMessage, messageWidth).map((line, lineIndex) => {
		const row = padLine(`${lineIndex === 0 ? prefix : indent}${line}`, width);
		return selected ? inverse(row, color) : row;
	});
}
function visibleListItems(items, selectedPosition, lineBudget) {
	const selected = items[selectedPosition];
	if (!selected) return [];
	if (selected.lines.length >= lineBudget) return selected.lines.slice(0, lineBudget);
	let start = selectedPosition;
	let end = selectedPosition + 1;
	let used = selected.lines.length;
	const beforeTarget = Math.floor((lineBudget - used) / 2);
	let beforeUsed = 0;
	while (start > 0) {
		const candidate = items[start - 1];
		if (!candidate || beforeUsed + candidate.lines.length > beforeTarget) break;
		start -= 1;
		beforeUsed += candidate.lines.length;
		used += candidate.lines.length;
	}
	while (end < items.length) {
		const candidate = items[end];
		if (!candidate || used + candidate.lines.length > lineBudget) break;
		end += 1;
		used += candidate.lines.length;
	}
	while (start > 0) {
		const candidate = items[start - 1];
		if (!candidate || used + candidate.lines.length > lineBudget) break;
		start -= 1;
		used += candidate.lines.length;
	}
	return items.slice(start, end).flatMap((item) => item.lines).slice(0, lineBudget);
}
function timeLabel(date) {
	return date.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit"
	});
}
function navigatorHeader(title, state, options) {
	if (!options.sessionId) return `${title} · HUD v${HUD_VERSION}`;
	const labels = LABELS[options.language];
	const copy = state.copyStatus === "copied" ? labels.copied : state.copyStatus === "failed" ? labels.copyFailed : labels.copy;
	return `${options.sessionId} [${copy}] · ${title} · HUD v${HUD_VERSION}`;
}
function fitNavigatorHeader(value, width) {
	if (visibleWidth(value) <= width) return value;
	const versionSeparator = ` · HUD v${HUD_VERSION}`;
	return truncateAnsi(value.endsWith(versionSeparator) ? value.slice(0, -versionSeparator.length) : value, width);
}
function renderList(turns, state, options) {
	const labels = LABELS[options.language];
	const width = Math.max(20, options.width);
	const height = Math.max(5, options.height);
	const matches = normalizeNavigatorSelection(state, turns);
	const header = navigatorHeader(`${labels.title} · ${String(turns.length)} ${labels.turns}`, state, options);
	const search = state.searchMode || state.query ? `${labels.search}: ${state.query}${state.searchMode ? "█" : ""}` : "";
	const lineBudget = Math.max(1, height - (search ? 3 : 2));
	const selectedPosition = Math.max(0, matches.indexOf(state.selectedIndex));
	const lines = [fitNavigatorHeader(header, width)];
	if (search) lines.push(truncateAnsi(search, width));
	if (matches.length === 0) lines.push(labels.noMatches);
	else {
		const items = matches.map((index) => ({
			index,
			lines: renderListItem(turns[index], index, index === state.selectedIndex, width, options.color)
		}));
		lines.push(...visibleListItems(items, selectedPosition, lineBudget));
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
		fitNavigatorHeader(navigatorHeader(`${labels.title} · #${String(state.selectedIndex + 1)}/${String(turns.length)}`, state, options), width),
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
//#region src/runtime/heartbeat.ts
function createHeartbeatScheduler(callback) {
	let timer = null;
	return {
		reschedule(intervalMs) {
			if (timer) clearInterval(timer);
			timer = setInterval(callback, intervalMs);
		},
		stop() {
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
		}
	};
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
	const parser = new RolloutParser({ captureConversationBodies: false });
	const navigator = createNavigatorState();
	const imageViewer = createImageViewerState();
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
	let cmuxSelfFraction = null;
	let latestTurns = parser.getState().conversationTurns;
	let latestImages = parser.getState().images;
	let latestSessionId = null;
	let codexPid = null;
	const paneId = process.env.TMUX_PANE ?? null;
	const configMtime = () => {
		try {
			return fs.statSync(loaded.path).mtimeMs;
		} catch {
			return 0;
		}
	};
	let lastConfigMtime = configMtime();
	let render;
	const heartbeat = createHeartbeatScheduler(() => void render());
	const loadLatestConfig = () => {
		loaded = reloadConfig(loaded);
	};
	const renderFrame = async () => {
		const nowMs = Date.now();
		if (currentSessionPath && !fs.existsSync(currentSessionPath)) {
			currentSessionPath = null;
			parser.setFile(null);
			sessionWatcher?.close();
			sessionWatcher = null;
		}
		if (!options.sessionPath && !currentSessionPath && nowMs - lastDiscoveryAt >= 250) {
			lastDiscoveryAt = nowMs;
			const binding = options.sessionBindingPath ? readSessionBinding(options.sessionBindingPath) : null;
			codexPid = binding?.codexPid ?? codexPid;
			let bound = binding?.rolloutPath ?? null;
			if (!bound && options.sessionBindingPath && codexPid) {
				const processSession = resolveProcessSession(codexPid, options.cwd, options.launchedAfter ?? startedAt);
				if (processSession) {
					bound = processSession.rolloutPath;
					writeSessionBinding(options.sessionBindingPath, bound, codexPid);
				}
			}
			const discovered = bound ? { path: bound } : options.sessionBindingPath ? null : findActiveSession({
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
		const codexProcess = codexPid ? {
			pid: codexPid,
			launchedAt: options.launchedAfter ?? startedAt
		} : null;
		const now = /* @__PURE__ */ new Date();
		const endpoint = rollout.session ? resolveSessionEndpoint(rollout.session.id) : codexProcess ? resolveProcessEndpoint(codexProcess.pid, codexProcess.launchedAt) : null;
		const usageTrust = evaluateUsageTrust(endpoint?.url ?? null, hasTrustedOpenAiAuth(rollout.session, process.env));
		if ((loaded.config.display.showUsage || loaded.config.display.showAuth) && usageTrust.trusted) persistRolloutRateLimits(rollout.usage, rollout.usageObservedAt, usageTrust.effectiveEndpoint);
		const loggedUsage = (loaded.config.display.showUsage || loaded.config.display.showAuth) && usageTrust.trusted && isOfficialOpenAIEndpoint(usageTrust.effectiveEndpoint) ? readLatestLoggedRateLimits(process.env, now.getTime(), usageTrust.effectiveEndpoint)?.usage ?? null : null;
		const queriedUsage = loaded.config.display.showAuth ? options.once ? await readConfiguredExternalUsage(loaded.config.display.externalUsageQueries, endpoint?.url ?? null, process.env, now.getTime()) : readCachedConfiguredExternalUsage(loaded.config.display.externalUsageQueries, endpoint?.url ?? null, process.env, () => void render(), now.getTime()) : null;
		const state = buildHudState(options.cwd, rollout, startedAt, loaded.config, now, codexProcess, loggedUsage, queriedUsage, endpoint?.url ?? null);
		latestTurns = state.conversationTurns;
		latestImages = state.images;
		if (latestSessionId !== (state.session?.id ?? null)) {
			latestSessionId = state.session?.id ?? null;
			navigator.copyStatus = "idle";
		}
		const width = process.stdout.columns || Number(process.env.COLUMNS) || loaded.config.maxWidth || 120;
		const constrainToViewport = options.once || Boolean(options.cmuxPaneId && (cmuxManualHeight || cmuxResizePending));
		const height = hudRenderHeight(options.maxHeight, process.stdout.rows, constrainToViewport);
		const lines = imageViewer.active ? renderImageViewer(latestImages, imageViewer, {
			width,
			height,
			color: options.color,
			language: loaded.config.language
		}) : navigator.active ? renderNavigator(latestTurns, navigator, {
			width,
			height,
			color: options.color,
			language: loaded.config.language,
			sessionId: state.session?.id ?? null
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
		const desiredHeight = imageViewer.active || navigator.active ? options.maxHeight : desiredPaneHeight(lines.length, options.maxHeight);
		if (options.cmuxPaneId) {
			if (!cmuxManualHeight && !cmuxResizePending) {
				const resized = resizeCmuxPane(options.cmuxPaneId, options.cmuxSourcePaneId, options.cmuxWorkspaceId, desiredHeight, process.stdout.rows, paneHeight);
				paneHeight = resized.height;
				if (resized.issued) cmuxSelfFraction = resized.fraction;
			}
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
	let renderPromise = null;
	let renderQueued = false;
	render = () => {
		if (renderPromise) {
			renderQueued = true;
			return renderPromise;
		}
		const run = async () => {
			do {
				renderQueued = false;
				await renderFrame();
			} while (renderQueued);
		};
		renderPromise = run().finally(() => {
			renderPromise = null;
		});
		return renderPromise;
	};
	await render();
	if (options.once) return;
	const scheduleHeartbeat = () => {
		heartbeat.reschedule(loaded.config.refreshIntervalMs);
	};
	scheduleHeartbeat();
	const configSafetyInterval = setInterval(() => {
		const nextMtime = configMtime();
		if (nextMtime !== lastConfigMtime) {
			loadLatestConfig();
			lastConfigMtime = nextMtime;
			scheduleHeartbeat();
			render();
		}
	}, 1e4);
	const configWatcher = watchConfigPath(loaded.path, () => {
		loadLatestConfig();
		lastConfigMtime = configMtime();
		scheduleHeartbeat();
		render();
	});
	const onResize = () => {
		if (options.cmuxPaneId) {
			cmuxResizePending = true;
			if (resizeTimer) clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				cmuxResizePending = false;
				const geometry = readCmuxPaneGeometry(options.cmuxWorkspaceId, options.cmuxPaneId);
				const settled = settleCmuxPaneHeight(process.stdout.rows, paneHeight, cmuxSelfFraction, geometry);
				paneHeight = settled.height;
				if (settled.manual) cmuxManualHeight = true;
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
		navigator.copyStatus = "idle";
		parser.setConversationCapture(false);
		render();
		focusCodexPane();
	};
	const closeImageViewer = () => {
		imageViewer.active = false;
		imageViewer.view = "list";
		imageViewer.previewScroll = 0;
		imageViewer.previewPath = null;
		imageViewer.previewLines = [];
		render();
		focusCodexPane();
	};
	const selectedImage = () => latestImages[imageViewer.selectedIndex];
	const loadImagePreview = () => {
		const image = selectedImage();
		if (!image) {
			imageViewer.previewLines = [];
			imageViewer.previewPath = null;
			return;
		}
		imageViewer.previewPath = image.path;
		imageViewer.previewScroll = 0;
		imageViewer.previewLines = createImagePreview(image, process.stdout.columns || 120, options.maxHeight, loaded.config.language);
	};
	const moveImageSelection = (delta) => {
		if (latestImages.length === 0) return;
		imageViewer.selectedIndex = Math.min(latestImages.length - 1, Math.max(0, imageViewer.selectedIndex + delta));
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
	let copyFeedbackTimer = null;
	const copySessionId = () => {
		if (!latestSessionId) return;
		navigator.copyStatus = copyText(latestSessionId) ? "copied" : "failed";
		if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
		copyFeedbackTimer = setTimeout(() => {
			copyFeedbackTimer = null;
			navigator.copyStatus = "idle";
			render();
		}, 1500);
	};
	const onKey = (key) => {
		if (key === "") {
			shutdown();
			return;
		}
		if (!navigator.active && !imageViewer.active) {
			if (key === "i" || key === "I") {
				if (!loaded.config.display.showImages || latestImages.length === 0) return;
				imageViewer.active = true;
				imageViewer.view = "list";
				imageViewer.selectedIndex = latestImages.length - 1;
				render();
				return;
			}
			if (loaded.config.display.showTurns && (key === "n" || key === "N" || key === "\r") && latestTurns.length > 0) {
				parser.setConversationCapture(true);
				latestTurns = parser.parse().conversationTurns;
				navigator.active = true;
				navigator.view = "list";
				navigator.searchMode = false;
				navigator.detailScroll = 0;
				navigator.copyStatus = "idle";
				navigator.selectedIndex = latestTurns.length - 1;
				render();
			}
			return;
		}
		if (imageViewer.active) {
			if (key === "q" || key === "Q") {
				closeImageViewer();
				return;
			}
			if (imageViewer.view === "preview") {
				if (key === "\x1B" || key === "h") {
					imageViewer.view = "list";
					imageViewer.previewScroll = 0;
				} else if (key === "o" || key === "O") {
					const image = selectedImage();
					if (image) openImage(image);
				} else if (key === "y" || key === "Y") {
					const image = selectedImage();
					if (image) copyImagePath(image);
				} else if (key === "j" || key === "\x1B[B") imageViewer.previewScroll += 1;
				else if (key === "k" || key === "\x1B[A") imageViewer.previewScroll = Math.max(0, imageViewer.previewScroll - 1);
				else if (key === "\x1B[C") {
					moveImageSelection(1);
					loadImagePreview();
				} else if (key === "\x1B[D") {
					moveImageSelection(-1);
					loadImagePreview();
				}
				render();
				return;
			}
			if (key === "\x1B") closeImageViewer();
			else if (key === "j" || key === "\x1B[B") moveImageSelection(1);
			else if (key === "k" || key === "\x1B[A") moveImageSelection(-1);
			else if (key === "o" || key === "O") {
				const image = selectedImage();
				if (image) openImage(image);
			} else if (key === "y" || key === "Y") {
				const image = selectedImage();
				if (image) copyImagePath(image);
			} else if (key === "\r" || key === "l" || key === "\x1B[C") {
				if (selectedImage()) {
					imageViewer.view = "preview";
					loadImagePreview();
				}
			}
			render();
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
		if (key === "y" || key === "Y") {
			copySessionId();
			render();
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
		heartbeat.stop();
		clearInterval(configSafetyInterval);
		if (debounceTimer) clearTimeout(debounceTimer);
		if (resizeTimer) clearTimeout(resizeTimer);
		if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
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
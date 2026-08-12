#!/usr/bin/env node
import { A as resolveProcessSession, C as readLatestLoggedRateLimits, E as RolloutParser, O as isOfficialOpenAIEndpoint, T as findActiveSession, _ as visibleWidth, c as desiredPaneHeight, d as resizeCmuxPane, f as resizeHudPane, g as truncateAnsi, h as safeText, j as resolveSessionEndpoint, k as resolveProcessEndpoint, l as hudRenderHeight, m as renderHud, o as writeSessionBinding, p as settleCmuxPaneHeight, r as readSessionBinding, s as buildHudState, u as readCmuxPaneGeometry, v as sliceAnsi, w as readConfiguredExternalUsage, y as loadConfig } from "./session-binding-BdADnIfH.mjs";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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
		copied: "Path copied"
	},
	"zh-Hans": {
		title: "图片画廊",
		images: "张图片",
		noImages: "没有可用图片",
		missing: "图片文件已不存在",
		listHelp: "j/k 选择 · Enter 预览 · o 打开 · y 复制路径 · q/Esc 关闭",
		previewHelp: "←/→ 上一张/下一张 · j/k 滚动 · o 打开 · y 复制路径 · q/Esc 返回",
		open: "打开",
		copied: "路径已复制"
	},
	"zh-Hant": {
		title: "圖片畫廊",
		images: "張圖片",
		noImages: "沒有可用圖片",
		missing: "圖片檔案已不存在",
		listHelp: "j/k 選擇 · Enter 預覽 · o 開啟 · y 複製路徑 · q/Esc 關閉",
		previewHelp: "←/→ 上一張/下一張 · j/k 捲動 · o 開啟 · y 複製路徑 · q/Esc 返回",
		open: "開啟",
		copied: "路徑已複製"
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
function imageInfo(image) {
	try {
		const stat = fs.statSync(image.path);
		const size = stat.size < 1024 * 1024 ? `${Math.max(1, Math.round(stat.size / 1024))} KB` : `${(stat.size / (1024 * 1024)).toFixed(1)} MB`;
		return `${path.extname(image.path).slice(1).toUpperCase()} · ${size}`;
	} catch {
		return "unavailable";
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
		const row = `${index === selectedIndex(state, images) ? "> " : "  "}#${String(index + 1).padStart(2, "0")} ${timeLabel$1(image)} ${path.basename(image.path)} · ${imageInfo(image)}`;
		lines.push(padLine$1(row, width));
	}
	lines.push(truncateAnsi(labels.listHelp, width));
	return lines.slice(0, height);
}
function createImagePreview(image, width, height) {
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
	return [
		`Path: ${image.path}`,
		`Info: ${imageInfo(image)}`,
		"",
		"Inline preview requires chafa.",
		"Press o to open with the system image viewer."
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
	const commands = process.platform === "darwin" ? [["pbcopy", []]] : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]]];
	for (const [command, args] of commands) if (spawnSync(command, args, {
		input: image.path,
		stdio: [
			"pipe",
			"ignore",
			"ignore"
		]
	}).status === 0) return true;
	return false;
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
	const header = `${options.sessionId ? `${options.sessionId} · ` : ""}${labels.title} · ${String(turns.length)} ${labels.turns}`;
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
		truncateAnsi(`${options.sessionId ? `${options.sessionId} · ` : ""}${labels.title} · #${String(state.selectedIndex + 1)}/${String(turns.length)}`, width),
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
		const loggedUsage = (loaded.config.display.showUsage || loaded.config.display.showAuth) && isOfficialOpenAIEndpoint(endpoint?.url) ? readLatestLoggedRateLimits(process.env, now.getTime(), endpoint?.url ?? null)?.usage ?? null : null;
		const queriedUsage = loaded.config.display.showAuth ? await readConfiguredExternalUsage(loaded.config.display.externalUsageQueries, endpoint?.url ?? null, process.env, now.getTime()) : null;
		const state = buildHudState(options.cwd, rollout, startedAt, loaded.config, now, codexProcess, loggedUsage, queriedUsage, endpoint?.url ?? null);
		latestTurns = state.conversationTurns;
		latestImages = state.images;
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
	const interval = setInterval(() => void render(), 1e3);
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
		imageViewer.previewLines = createImagePreview(image, process.stdout.columns || 120, options.maxHeight);
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
	const onKey = (key) => {
		if (key === "") {
			shutdown();
			return;
		}
		if (!navigator.active && !imageViewer.active) {
			if (key === "i" || key === "I") {
				if (latestImages.length === 0) return;
				imageViewer.active = true;
				imageViewer.view = "list";
				imageViewer.selectedIndex = latestImages.length - 1;
				render();
				return;
			}
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
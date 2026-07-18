#!/usr/bin/env node
import { b as RolloutParser, c as desiredPaneHeight, d as viewportRenderHeight, f as renderHud, h as findActiveSession, l as resizeCmuxPane, p as loadConfig, r as readSessionBinding, s as buildHudState, u as resizeHudPane } from "./session-binding-D2aIzZHE.mjs";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

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
		else if (argument === "--max-height" && args[index + 1]) options.maxHeight = Math.max(5, Math.min(30, Number(args[++index]) || 30));
	}
	return options;
}
async function runRenderCli(args = process.argv.slice(2)) {
	const options = parseOptions(args);
	let loaded = loadConfig();
	const parser = new RolloutParser();
	let currentSessionPath = options.sessionPath;
	let lastDiscoveryAt = 0;
	let sessionWatcher = null;
	let debounceTimer = null;
	parser.setFile(currentSessionPath);
	const startedAt = /* @__PURE__ */ new Date();
	let lastFrame = "";
	let lastViewport = "";
	let paneHeight = null;
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
		const width = process.stdout.columns || Number(process.env.COLUMNS) || loaded.config.maxWidth || 120;
		const height = viewportRenderHeight(options.maxHeight, process.stdout.rows);
		const lines = renderHud({
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
		const desiredHeight = desiredPaneHeight(lines.length, options.maxHeight);
		paneHeight = options.cmuxPaneId ? resizeCmuxPane(options.cmuxPaneId, desiredHeight, paneHeight) : resizeHudPane(paneId, desiredHeight, paneHeight);
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
	process.on("SIGWINCH", render);
	const shutdown = () => {
		clearInterval(interval);
		clearInterval(configSafetyInterval);
		if (debounceTimer) clearTimeout(debounceTimer);
		sessionWatcher?.close();
		configWatcher?.close();
		process.off("SIGWINCH", render);
		process.stdout.write("\x1B[?25h\x1B[0m");
		process.exit(0);
	};
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
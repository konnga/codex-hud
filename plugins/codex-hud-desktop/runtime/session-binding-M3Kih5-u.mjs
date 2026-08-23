import { S as getCodexHome, d as isSubagentSource, f as listSessionCandidates, g as findCodexLogDatabase, h as endpointOrigin, m as normalizeRateLimits, w as getHudStateDirectory, x as setTimedCache } from "./state-CVI_806k.mjs";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

//#region src/codex/log-rate-limits.ts
const EVENT_PREFIX = "SSE event: ";
const QUERY_TIMEOUT_MS = 750;
const CACHE_MS = 15e3;
const MAX_EVENT_AGE_SECONDS = 11520 * 60;
const RESETLESS_FRESHNESS_MS = 360 * 60 * 1e3;
const MAX_ROW_LOOKBACK = 2e5;
const MAX_EVENT_CANDIDATES = 1e3;
const SNAPSHOT_FILE_NAME = "account-usage.json";
const MAX_STORED_BODY_LENGTH = 16384;
const CACHE_MAX_AGE_MS = 30 * 6e4;
const CACHE_MAX_ENTRIES = 64;
const cache = /* @__PURE__ */ new Map();
function record(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function decodeHex(value) {
	if (!value || value.length % 2 !== 0 || !/^[\dA-F]+$/i.test(value)) return null;
	try {
		return Buffer.from(value, "hex").toString("utf8");
	} catch {
		return null;
	}
}
function parseEvent(body) {
	const marker = body.indexOf(EVENT_PREFIX);
	if (marker < 0) return null;
	try {
		const event = record(JSON.parse(body.slice(marker + 11)));
		const limits = record(event?.rate_limits);
		if (event?.type !== "codex.rate_limits" || !limits) return null;
		return normalizeRateLimits({
			...limits,
			credits: record(event.credits),
			plan_type: typeof event.plan_type === "string" ? event.plan_type : null,
			rate_limit_reached_type: limits.limit_reached === true ? "rate_limit_reached" : null
		});
	} catch {
		return null;
	}
}
function freshWindow(window, observedAt, now) {
	if (!window) return null;
	if (window.resetAt) return window.resetAt.getTime() > now ? window : null;
	return now - observedAt.getTime() <= RESETLESS_FRESHNESS_MS ? window : null;
}
function freshUsage(usage, observedAt, now) {
	const primary = freshWindow(usage.primary, observedAt, now);
	const secondary = freshWindow(usage.secondary, observedAt, now);
	const individual = freshWindow(usage.individual, observedAt, now);
	if (!primary && !secondary && !individual && !usage.balanceLabel) return null;
	return {
		...usage,
		primary,
		secondary,
		individual
	};
}
function cloneSnapshot(value) {
	return value ? structuredClone(value) : null;
}
function storedSnapshotPath(env) {
	return path.join(getHudStateDirectory(env), SNAPSHOT_FILE_NAME);
}
function readStoredSnapshot(env, now, expectedOrigin) {
	try {
		const stored = record(JSON.parse(fs.readFileSync(storedSnapshotPath(env), "utf8")));
		const entries = record(stored?.entries);
		if (stored?.version !== 2 || !entries) return null;
		const candidates = expectedOrigin === void 0 ? Object.entries(entries) : [[expectedOrigin, entries[expectedOrigin]]];
		let newest = null;
		for (const [origin, rawEntry] of candidates) {
			const entry = record(rawEntry);
			const observedAt = typeof entry?.observed_at === "string" ? new Date(entry.observed_at) : null;
			const body = typeof entry?.body === "string" ? entry.body : null;
			if (!observedAt || Number.isNaN(observedAt.getTime()) || !body || body.length > MAX_STORED_BODY_LENGTH || now - observedAt.getTime() > MAX_EVENT_AGE_SECONDS * 1e3) continue;
			const usage = parseEvent(body);
			const fresh = usage ? freshUsage(usage, observedAt, now) : null;
			if (fresh && (!newest || observedAt > newest.observedAt)) newest = {
				usage: fresh,
				observedAt,
				origin
			};
		}
		return newest;
	} catch {
		return null;
	}
}
function writeStoredSnapshot(env, body, observedAt, origin) {
	if (body.length > MAX_STORED_BODY_LENGTH) return;
	const filePath = storedSnapshotPath(env);
	const temporaryPath = `${filePath}.${process.pid}.tmp`;
	try {
		let stored = null;
		try {
			stored = record(JSON.parse(fs.readFileSync(filePath, "utf8")));
		} catch {}
		const currentEntries = stored?.version === 2 ? record(stored.entries) : null;
		const entries = currentEntries ? { ...currentEntries } : {};
		const current = record(entries[origin]);
		const currentObservedAt = typeof current?.observed_at === "string" ? new Date(current.observed_at) : null;
		if (currentObservedAt && !Number.isNaN(currentObservedAt.getTime()) && currentObservedAt > observedAt) return;
		entries[origin] = {
			observed_at: observedAt.toISOString(),
			body
		};
		fs.mkdirSync(path.dirname(filePath), {
			recursive: true,
			mode: 448
		});
		fs.writeFileSync(temporaryPath, `${JSON.stringify({
			version: 2,
			entries
		}, null, 2)}\n`, {
			encoding: "utf8",
			mode: 384
		});
		fs.renameSync(temporaryPath, filePath);
		fs.chmodSync(filePath, 384);
	} catch {
		try {
			fs.rmSync(temporaryPath, { force: true });
		} catch {}
	}
}
function eventOrigin(database, processUuid, timestamp) {
	const result = spawnSync("sqlite3", [
		"-readonly",
		"-noheader",
		"-batch",
		database,
		[
			"SELECT feedback_log_body",
			"  FROM logs",
			` WHERE process_uuid = '${processUuid.replaceAll("'", "''")}'`,
			`   AND ts BETWEEN ${timestamp - MAX_EVENT_AGE_SECONDS} AND ${timestamp + 60}`,
			`   AND target IN ('codex_http_client::default_client', 'codex_http_client::client')`,
			`   AND instr(feedback_log_body, 'url=') > 0`,
			` ORDER BY abs(ts - ${timestamp}) ASC, id DESC`,
			" LIMIT 1;"
		].join("\n")
	], {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		],
		timeout: QUERY_TIMEOUT_MS
	});
	const match = typeof result.stdout === "string" ? /\burl=(https?:\/\/[^\s"]+)/.exec(result.stdout) : null;
	return match ? endpointOrigin(match[1]) : null;
}
/**
* Codex currently logs `codex.rate_limits` SSE events but does not copy them
* into rollout token-count events for every provider. The newest event per
* provider origin is account-wide, so persist it for other open HUD processes
* too. `expectedEndpoint` names the provider the caller is bound to; passing
* null means the endpoint is unknown, and showing no usage beats showing
* another provider's account.
*/
function readLatestLoggedRateLimits(env = process.env, now = Date.now(), expectedEndpoint) {
	const expectedOrigin = expectedEndpoint === void 0 ? void 0 : expectedEndpoint ? endpointOrigin(expectedEndpoint) : null;
	if (expectedOrigin === null) return null;
	const codexHome = getCodexHome(env);
	const cacheKey = `${codexHome}:${expectedOrigin ?? "*"}`;
	const cached = cache.get(cacheKey);
	if (cached && now - cached.at < CACHE_MS) return cloneSnapshot(cached.value);
	const remember = (value) => {
		setTimedCache(cache, cacheKey, {
			at: now,
			value: cloneSnapshot(value)
		}, CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES);
		return cloneSnapshot(value);
	};
	let previous = readStoredSnapshot(env, now, expectedOrigin);
	if (cached?.value) {
		const fallback = freshUsage(cached.value.usage, cached.value.observedAt, now);
		if (fallback) previous = {
			usage: fallback,
			observedAt: cached.value.observedAt,
			origin: cached.value.origin
		};
	}
	const database = findCodexLogDatabase(codexHome);
	if (!database) return remember(previous);
	const since = Math.floor(now / 1e3) - MAX_EVENT_AGE_SECONDS;
	const result = spawnSync("sqlite3", [
		"-readonly",
		"-noheader",
		"-batch",
		database,
		[
			`SELECT ts || '|' || hex(process_uuid) || '|' || hex(feedback_log_body)`,
			"  FROM logs",
			` WHERE id >= (SELECT max(id) - ${MAX_ROW_LOOKBACK} FROM logs)`,
			`   AND ts >= ${since}`,
			`   AND target = 'codex_api::sse::responses'`,
			`   AND instr(feedback_log_body, '"type":"codex.rate_limits"') > 0`,
			" ORDER BY id DESC",
			` LIMIT ${MAX_EVENT_CANDIDATES};`
		].join("\n")
	], {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		],
		timeout: QUERY_TIMEOUT_MS
	});
	if (typeof result.stdout !== "string") return remember(previous);
	const origins = /* @__PURE__ */ new Map();
	for (const line of result.stdout.split("\n")) {
		const [timestampValue, processValue, bodyValue] = line.split("|");
		const timestamp = Number(timestampValue);
		const processUuid = decodeHex(processValue ?? "");
		const body = decodeHex(bodyValue ?? "");
		if (!Number.isFinite(timestamp) || !processUuid || !body) continue;
		const observedAt = /* @__PURE__ */ new Date(timestamp * 1e3);
		const usage = parseEvent(body);
		const fresh = usage ? freshUsage(usage, observedAt, now) : null;
		if (!fresh) continue;
		const origin = origins.has(processUuid) ? origins.get(processUuid) ?? null : eventOrigin(database, processUuid, timestamp);
		origins.set(processUuid, origin);
		if (!origin || expectedOrigin !== void 0 && origin !== expectedOrigin) continue;
		writeStoredSnapshot(env, body, observedAt, origin);
		return remember({
			usage: fresh,
			observedAt,
			origin
		});
	}
	return remember(previous);
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
function formatBytes(value) {
	const units = [
		"B",
		"KB",
		"MB",
		"GB",
		"TB"
	];
	let size = Math.max(0, value);
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit += 1;
	}
	return `${size.toFixed(unit > 1 ? 1 : 0).replace(/\.0$/, "")} ${units[unit]}`;
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
		navigate: "click HUD or press F12, then n"
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
		navigate: "点击 HUD 或按 F12，再按 n 导航"
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
function isCompletedGoal(status) {
	return status === "complete" || status === "completed";
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
function renderImagesLine(ctx) {
	if (ctx.state.images.length === 0) return null;
	const latest = ctx.state.images.at(-1);
	const filename = latest ? path.basename(latest.path) : "";
	const suffix = filename ? ` · ${safeText(filename)}` : "";
	return `🖼 Images: ${ctx.state.images.length}${suffix} · i gallery`;
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
	if (ctx.config.display.showGoal && ctx.state.goal?.objective && !isCompletedGoal(ctx.state.goal.status)) {
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
	return `${message(ctx.config.language, "memory")} ${progressBar(memory.usedPercent, 6, ctx.config.colors.barFilled, ctx.config.colors.barEmpty)} ${memory.usedPercent}% (${formatBytes(memory.usedBytes)}/${formatBytes(memory.totalBytes)})`;
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
		[
			"!",
			status.conflicted ?? 0,
			ctx.config.colors.critical
		],
		[
			"M",
			status.modified,
			"yellow"
		],
		[
			"A",
			status.added,
			"green"
		],
		[
			"D",
			status.deleted,
			"red"
		],
		[
			"R",
			status.renamed ?? 0,
			"cyan"
		],
		[
			"C",
			status.copied ?? 0,
			"brightBlue"
		],
		[
			"T",
			status.typeChanged ?? 0,
			"magenta"
		],
		[
			"?",
			status.untracked,
			"dim"
		]
	].filter(([, count]) => count > 0).map(([label, count, clr]) => color(`${label}${count}`, clr, ctx.options.color));
	const stats = ctx.config.gitStatus.showFileStats && statParts.length > 0 ? ` ${statParts.join(" ")}` : "";
	return `${wrapper}${branch}${color(")", ctx.config.colors.git, ctx.options.color)}${stats}`;
}
function authSegment(ctx) {
	if (!ctx.config.display.showAuth || !ctx.state.auth) return null;
	const maximum = ctx.config.display.authUserLength;
	const rawUser = ctx.state.auth.user ?? "";
	const user = maximum > 0 && rawUser.length > maximum ? `${rawUser.slice(0, Math.max(1, maximum - 1))}…` : rawUser;
	const method = ctx.config.display.showAuthUser && user ? `${ctx.state.auth.method} (${user})` : ctx.state.auth.method;
	return ctx.state.auth.balanceLabel ? `${method} · ${ctx.state.auth.balanceLabel}` : method;
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
function cacheUsage(ctx, inputTokens, cachedInputTokens) {
	const percent = inputTokens > 0 ? ` · ${Math.min(100, Math.max(0, Math.round(cachedInputTokens / inputTokens * 100)))}%` : "";
	return `${message(ctx.config.language, "cache")} ${formatTokens(cachedInputTokens)}${percent}`;
}
function renderSessionLine(ctx) {
	const session = ctx.state.session;
	const parts = [];
	if (ctx.config.display.showDuration) parts.push(`⏱️ ${formatDuration(ctx.now.getTime() - ctx.state.sessionStart.getTime())}`);
	if (ctx.config.display.showSessionStartDate && session?.startTime) {
		const locale = ctx.config.language === "en" ? "en" : "zh-CN";
		parts.push(`${message(ctx.config.language, "started")} ${session.startTime.toLocaleString(locale)}`);
	}
	if (ctx.config.display.showSpeed && session?.outputTokensPerSecond !== void 0) parts.push(`${message(ctx.config.language, "output")}: ${session.outputTokensPerSecond.toFixed(1)} tok/s`);
	if (ctx.config.display.showSessionTokens && ctx.state.sessionTokens) {
		const usage = ctx.state.sessionTokens;
		const itemSeparator = ctx.config.language === "en" ? ", " : "，";
		const groupSeparator = ctx.config.language === "en" ? "; " : "；";
		const input = `${message(ctx.config.language, "input")} ${formatTokens(usage.inputTokens)}${itemSeparator}${cacheUsage(ctx, usage.inputTokens, usage.cachedInputTokens)}`;
		parts.push(`${message(ctx.config.language, "tokens")}: ${formatTokens(usage.totalTokens)} (${input}${groupSeparator}${message(ctx.config.language, "output")} ${formatTokens(usage.outputTokens)})`);
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
	const renderedWindows = [
		usage.primary,
		secondary,
		usage.individual
	].flatMap((window) => window ? [renderWindow(ctx, window)] : []).filter((value) => Boolean(value));
	const parts = [...renderedWindows];
	if (usage.balanceLabel) parts.push(usage.balanceLabel);
	if (parts.length === 0) return null;
	const maxPercent = Math.max(usage.primary?.percent ?? 0, usage.secondary?.percent ?? 0, usage.individual?.percent ?? 0);
	const selectedColor = maxPercent >= 100 ? ctx.config.colors.critical : maxPercent >= 80 ? ctx.config.colors.usageWarning : ctx.config.colors.usage;
	return color(`${renderedWindows.length === 0 ? `${message(ctx.config.language, "usage")} ` : ""}${parts.join(" │ ")}`, selectedColor, ctx.options.color);
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
	const images = renderImagesLine(ctx);
	if (images) lines.push(images);
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
		renderTurnsLine(ctx),
		renderImagesLine(ctx)
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
const CMUX_RESIZE_POINTS_PER_ROW = 20;
const CMUX_MANUAL_RESIZE_TOLERANCE_ROWS = 1.5;
const defaultCmuxRunner = (args) => {
	const result = spawnSync("cmux", args, {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		],
		timeout: 1500
	});
	return {
		status: result.status,
		stdout: typeof result.stdout === "string" ? result.stdout : void 0
	};
};
function viewportRenderHeight(maximum, rows) {
	const safeMaximum = Math.max(1, Math.round(maximum));
	if (!rows || !Number.isFinite(rows)) return safeMaximum;
	return Math.min(safeMaximum, Math.max(1, Math.floor(rows)));
}
function hudRenderHeight(maximum, rows, constrainToViewport) {
	const safeMaximum = Math.max(1, Math.round(maximum));
	return constrainToViewport ? viewportRenderHeight(safeMaximum, rows) : safeMaximum;
}
function desiredPaneHeight(lineCount, maximum, minimum = 5) {
	return Math.min(Math.max(minimum, Math.round(maximum)), Math.max(minimum, Math.round(lineCount)));
}
function resizeHudPane(paneId, desiredHeight, previousHeight, runner = (args) => ({ status: spawnSync("tmux", args, { stdio: "ignore" }).status })) {
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
function readCmuxPaneGeometry(workspaceId, paneId, runner = defaultCmuxRunner) {
	if (!workspaceId || !paneId) return null;
	const result = runner([
		"--json",
		"--id-format",
		"both",
		"list-panes",
		"--workspace",
		workspaceId
	]);
	if (result.status !== 0 || !result.stdout) return null;
	try {
		const payload = JSON.parse(result.stdout);
		const containerHeightPoints = Number(payload.container_frame?.height);
		const pane = Array.isArray(payload.panes) ? payload.panes.find((entry) => entry?.id === paneId) : void 0;
		const rows = Number(pane?.rows);
		const heightPoints = Number(pane?.pixel_frame?.height);
		if (!pane || !Number.isFinite(rows) || rows <= 0 || !Number.isFinite(heightPoints) || heightPoints <= 0 || !Number.isFinite(containerHeightPoints) || containerHeightPoints <= 0) return null;
		return {
			rows,
			heightPoints,
			containerHeightPoints,
			pointsPerRow: Math.min(40, Math.max(12, heightPoints / rows))
		};
	} catch {
		return null;
	}
}
function resizeCmuxPane(paneId, sourcePaneId, workspaceId, desiredHeight, currentRows, previousHeight, runner = defaultCmuxRunner) {
	if (!paneId || !sourcePaneId || !workspaceId) return {
		height: null,
		issued: false,
		fraction: null
	};
	if (previousHeight === desiredHeight) return {
		height: previousHeight,
		issued: false,
		fraction: null
	};
	const geometry = readCmuxPaneGeometry(workspaceId, paneId, runner);
	const rows = geometry?.rows ?? (currentRows && Number.isFinite(currentRows) ? Math.floor(currentRows) : null);
	if (!rows) return {
		height: null,
		issued: false,
		fraction: null
	};
	const delta = Math.round(desiredHeight) - rows;
	if (delta === 0) return {
		height: desiredHeight,
		issued: false,
		fraction: null
	};
	const growing = delta > 0;
	const amount = Math.max(1, Math.round(Math.abs(delta) * (geometry?.pointsPerRow ?? 20)));
	if (runner([
		"resize-pane",
		"--workspace",
		workspaceId,
		"--pane",
		growing ? paneId : sourcePaneId,
		growing ? "-U" : "-D",
		"--amount",
		String(amount)
	]).status !== 0) return {
		height: previousHeight,
		issued: false,
		fraction: null
	};
	const after = readCmuxPaneGeometry(workspaceId, paneId, runner);
	return {
		height: desiredHeight,
		issued: true,
		fraction: after ? after.heightPoints / after.containerHeightPoints : null
	};
}
function settleCmuxPaneHeight(currentRows, managedHeight, selfFraction, geometry) {
	if (geometry && selfFraction !== null) {
		const expectedPoints = selfFraction * geometry.containerHeightPoints;
		const tolerancePoints = geometry.pointsPerRow * CMUX_MANUAL_RESIZE_TOLERANCE_ROWS;
		if (Math.abs(geometry.heightPoints - expectedPoints) > tolerancePoints) return {
			height: managedHeight,
			manual: true
		};
	}
	if (currentRows && Number.isFinite(currentRows)) return {
		height: Math.floor(currentRows),
		manual: false
	};
	return {
		height: managedHeight,
		manual: false
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
/**
* Written once right after Codex is spawned so the HUD can identify the process
* before Codex creates a rollout, then again with the rollout once it appears.
*/
function writeSessionBinding(bindingPath, rolloutPath, codexPid) {
	fs.mkdirSync(path.dirname(bindingPath), {
		recursive: true,
		mode: 448
	});
	const temporaryPath = `${bindingPath}.${process.pid}.tmp`;
	const payload = {
		...rolloutPath ? { rolloutPath } : {},
		...codexPid ? { codexPid } : {}
	};
	fs.writeFileSync(temporaryPath, `${JSON.stringify(payload)}\n`, { mode: 384 });
	fs.renameSync(temporaryPath, bindingPath);
}
function readSessionBinding(bindingPath) {
	try {
		const value = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
		return {
			rolloutPath: typeof value.rolloutPath === "string" && fs.existsSync(value.rolloutPath) ? value.rolloutPath : null,
			codexPid: typeof value.codexPid === "number" && Number.isInteger(value.codexPid) ? value.codexPid : null
		};
	} catch {
		return {
			rolloutPath: null,
			codexPid: null
		};
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
export { sliceAnsi as _, waitForNewRootSession as a, hudRenderHeight as c, resizeHudPane as d, settleCmuxPaneHeight as f, visibleWidth as g, truncateAnsi as h, snapshotRootSessions as i, readCmuxPaneGeometry as l, safeText as m, createSessionBindingPath as n, writeSessionBinding as o, renderHud as p, readSessionBinding as r, desiredPaneHeight as s, acquireSessionDiscoveryLock as t, resizeCmuxPane as u, readLatestLoggedRateLimits as v };
//# sourceMappingURL=session-binding-M3Kih5-u.mjs.map
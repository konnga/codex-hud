#!/usr/bin/env node
import { a as waitForNewRootSession, c as renderHud, d as findActiveSession, f as getCodexHome, g as RolloutParser, h as getLegacyStateDirectory, i as snapshotRootSessions, l as loadConfig, m as getHudStateDirectory, n as createSessionBindingPath, o as writeSessionBinding, p as getConfigPath, s as buildHudState, t as acquireSessionDiscoveryLock, u as DEFAULT_CONFIG } from "./session-binding-BsUFJLlQ.mjs";
import fs from "node:fs";
import path from "node:path";
import process$1, { stdin, stdout } from "node:process";
import os from "node:os";
import { styleText } from "node:util";
import l__default from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

//#region \0rolldown/runtime.js
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);

//#endregion
//#region node_modules/.pnpm/fast-string-truncated-width@3.0.3/node_modules/fast-string-truncated-width/dist/utils.js
const getCodePointsLength = (() => {
	const SURROGATE_PAIR_RE = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
	return (input) => {
		let surrogatePairsNr = 0;
		SURROGATE_PAIR_RE.lastIndex = 0;
		while (SURROGATE_PAIR_RE.test(input)) surrogatePairsNr += 1;
		return input.length - surrogatePairsNr;
	};
})();
const isFullWidth = (x) => {
	return x === 12288 || x >= 65281 && x <= 65376 || x >= 65504 && x <= 65510;
};
const isWideNotCJKTNotEmoji = (x) => {
	return x === 8987 || x === 9001 || x >= 12272 && x <= 12287 || x >= 12289 && x <= 12350 || x >= 12441 && x <= 12543 || x >= 12549 && x <= 12591 || x >= 12593 && x <= 12686 || x >= 12688 && x <= 12771 || x >= 12783 && x <= 12830 || x >= 12832 && x <= 12871 || x >= 12880 && x <= 19903 || x >= 65040 && x <= 65049 || x >= 65072 && x <= 65106 || x >= 65108 && x <= 65126 || x >= 65128 && x <= 65131 || x >= 127488 && x <= 127490 || x >= 127504 && x <= 127547 || x >= 127552 && x <= 127560 || x >= 131072 && x <= 196605 || x >= 196608 && x <= 262141;
};

//#endregion
//#region node_modules/.pnpm/fast-string-truncated-width@3.0.3/node_modules/fast-string-truncated-width/dist/index.js
const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\u001b\]8;[^;]*;.*?(?:\u0007|\u001b\u005c)/y;
const CONTROL_RE = /[\x00-\x08\x0A-\x1F\x7F-\x9F]{1,1000}/y;
const CJKT_WIDE_RE = /(?:(?![\uFF61-\uFF9F\uFF00-\uFFEF])[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Tangut}]){1,1000}/uy;
const TAB_RE = /\t{1,1000}/y;
const EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}|\u{1F3F4}[\u{E0061}-\u{E007A}]{2}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,3}\u{E007F}|(?:\p{Emoji}\uFE0F\u20E3?|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation})(?:\u200D(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation}|\p{Emoji}\uFE0F\u20E3?))*/uy;
const LATIN_RE = /(?:[\x20-\x7E\xA0-\xFF](?!\uFE0F)){1,1000}/y;
const MODIFIER_RE = /\p{M}+/gu;
const NO_TRUNCATION$1 = {
	limit: Infinity,
	ellipsis: ""
};
const getStringTruncatedWidth = (input, truncationOptions = {}, widthOptions = {}) => {
	const LIMIT = truncationOptions.limit ?? Infinity;
	const ELLIPSIS = truncationOptions.ellipsis ?? "";
	const ELLIPSIS_WIDTH = truncationOptions?.ellipsisWidth ?? (ELLIPSIS ? getStringTruncatedWidth(ELLIPSIS, NO_TRUNCATION$1, widthOptions).width : 0);
	const ANSI_WIDTH = 0;
	const CONTROL_WIDTH = widthOptions.controlWidth ?? 0;
	const TAB_WIDTH = widthOptions.tabWidth ?? 8;
	const EMOJI_WIDTH = widthOptions.emojiWidth ?? 2;
	const FULL_WIDTH_WIDTH = 2;
	const REGULAR_WIDTH = widthOptions.regularWidth ?? 1;
	const WIDE_WIDTH = widthOptions.wideWidth ?? FULL_WIDTH_WIDTH;
	const PARSE_BLOCKS = [
		[LATIN_RE, REGULAR_WIDTH],
		[ANSI_RE, ANSI_WIDTH],
		[CONTROL_RE, CONTROL_WIDTH],
		[TAB_RE, TAB_WIDTH],
		[EMOJI_RE, EMOJI_WIDTH],
		[CJKT_WIDE_RE, WIDE_WIDTH]
	];
	let indexPrev = 0;
	let index = 0;
	let length = input.length;
	let lengthExtra = 0;
	let truncationEnabled = false;
	let truncationIndex = length;
	let truncationLimit = Math.max(0, LIMIT - ELLIPSIS_WIDTH);
	let unmatchedStart = 0;
	let unmatchedEnd = 0;
	let width = 0;
	let widthExtra = 0;
	outer: while (true) {
		if (unmatchedEnd > unmatchedStart || index >= length && index > indexPrev) {
			const unmatched = input.slice(unmatchedStart, unmatchedEnd) || input.slice(indexPrev, index);
			lengthExtra = 0;
			for (const char of unmatched.replaceAll(MODIFIER_RE, "")) {
				const codePoint = char.codePointAt(0) || 0;
				if (isFullWidth(codePoint)) widthExtra = FULL_WIDTH_WIDTH;
				else if (isWideNotCJKTNotEmoji(codePoint)) widthExtra = WIDE_WIDTH;
				else widthExtra = REGULAR_WIDTH;
				if (width + widthExtra > truncationLimit) truncationIndex = Math.min(truncationIndex, Math.max(unmatchedStart, indexPrev) + lengthExtra);
				if (width + widthExtra > LIMIT) {
					truncationEnabled = true;
					break outer;
				}
				lengthExtra += char.length;
				width += widthExtra;
			}
			unmatchedStart = unmatchedEnd = 0;
		}
		if (index >= length) break outer;
		for (let i = 0, l = PARSE_BLOCKS.length; i < l; i++) {
			const [BLOCK_RE, BLOCK_WIDTH] = PARSE_BLOCKS[i];
			BLOCK_RE.lastIndex = index;
			if (BLOCK_RE.test(input)) {
				lengthExtra = BLOCK_RE === CJKT_WIDE_RE ? getCodePointsLength(input.slice(index, BLOCK_RE.lastIndex)) : BLOCK_RE === EMOJI_RE ? 1 : BLOCK_RE.lastIndex - index;
				widthExtra = lengthExtra * BLOCK_WIDTH;
				if (width + widthExtra > truncationLimit) truncationIndex = Math.min(truncationIndex, index + Math.floor((truncationLimit - width) / BLOCK_WIDTH));
				if (width + widthExtra > LIMIT) {
					truncationEnabled = true;
					break outer;
				}
				width += widthExtra;
				unmatchedStart = indexPrev;
				unmatchedEnd = index;
				index = indexPrev = BLOCK_RE.lastIndex;
				continue outer;
			}
		}
		index += 1;
	}
	return {
		width: truncationEnabled ? truncationLimit : width,
		index: truncationEnabled ? truncationIndex : length,
		truncated: truncationEnabled,
		ellipsed: truncationEnabled && LIMIT >= ELLIPSIS_WIDTH
	};
};

//#endregion
//#region node_modules/.pnpm/fast-string-width@3.0.2/node_modules/fast-string-width/dist/index.js
const NO_TRUNCATION = {
	limit: Infinity,
	ellipsis: "",
	ellipsisWidth: 0
};
const fastStringWidth = (input, options = {}) => {
	return getStringTruncatedWidth(input, NO_TRUNCATION, options).width;
};

//#endregion
//#region node_modules/.pnpm/fast-wrap-ansi@0.2.2/node_modules/fast-wrap-ansi/lib/main.js
const ESC = "\x1B";
const CSI = "";
const END_CODE = 39;
const ANSI_ESCAPE_BELL = "\x07";
const ANSI_CSI = "[";
const ANSI_OSC = "]";
const ANSI_SGR_TERMINATOR = "m";
const ANSI_ESCAPE_LINK = `${ANSI_OSC}8;;`;
const GROUP_REGEX = new RegExp(`(?:\\${ANSI_CSI}(?<code>\\d+)m|\\${ANSI_ESCAPE_LINK}(?<uri>.*)${ANSI_ESCAPE_BELL})`, "y");
const getClosingCode = (openingCode) => {
	if (openingCode >= 30 && openingCode <= 37) return 39;
	if (openingCode >= 90 && openingCode <= 97) return 39;
	if (openingCode >= 40 && openingCode <= 47) return 49;
	if (openingCode >= 100 && openingCode <= 107) return 49;
	if (openingCode === 1 || openingCode === 2) return 22;
	if (openingCode === 3) return 23;
	if (openingCode === 4) return 24;
	if (openingCode === 7) return 27;
	if (openingCode === 8) return 28;
	if (openingCode === 9) return 29;
	if (openingCode === 0) return 0;
};
const wrapAnsiCode = (code) => `${ESC}${ANSI_CSI}${code}${ANSI_SGR_TERMINATOR}`;
const wrapAnsiHyperlink = (url) => `${ESC}${ANSI_ESCAPE_LINK}${url}${ANSI_ESCAPE_BELL}`;
const wrapWord = (rows, word, columns) => {
	const characters = word[Symbol.iterator]();
	let isInsideEscape = false;
	let isInsideLinkEscape = false;
	let lastRow = rows.at(-1);
	let visible = lastRow === void 0 ? 0 : fastStringWidth(lastRow);
	let currentCharacter = characters.next();
	let nextCharacter = characters.next();
	let rawCharacterIndex = 0;
	while (!currentCharacter.done) {
		const character = currentCharacter.value;
		const characterLength = fastStringWidth(character);
		if (visible + characterLength <= columns) rows[rows.length - 1] += character;
		else {
			rows.push(character);
			visible = 0;
		}
		if (character === ESC || character === CSI) {
			isInsideEscape = true;
			isInsideLinkEscape = word.startsWith(ANSI_ESCAPE_LINK, rawCharacterIndex + 1);
		}
		if (isInsideEscape) {
			if (isInsideLinkEscape) {
				if (character === ANSI_ESCAPE_BELL) {
					isInsideEscape = false;
					isInsideLinkEscape = false;
				}
			} else if (character === ANSI_SGR_TERMINATOR) isInsideEscape = false;
		} else {
			visible += characterLength;
			if (visible === columns && !nextCharacter.done) {
				rows.push("");
				visible = 0;
			}
		}
		currentCharacter = nextCharacter;
		nextCharacter = characters.next();
		rawCharacterIndex += character.length;
	}
	lastRow = rows.at(-1);
	if (!visible && lastRow !== void 0 && lastRow.length && rows.length > 1) rows[rows.length - 2] += rows.pop();
};
const stringVisibleTrimSpacesRight = (string) => {
	const words = string.split(" ");
	let last = words.length;
	while (last) {
		if (fastStringWidth(words[last - 1])) break;
		last--;
	}
	if (last === words.length) return string;
	return words.slice(0, last).join(" ") + words.slice(last).join("");
};
const exec = (string, columns, options = {}) => {
	if (options.trim !== false && string.trim() === "") return "";
	let returnValue = "";
	let escapeCode;
	let escapeUrl;
	const words = string.split(" ");
	let rows = [""];
	let rowLength = 0;
	for (let index = 0; index < words.length; index++) {
		const word = words[index];
		if (options.trim !== false) {
			const row = rows.at(-1) ?? "";
			const trimmed = row.trimStart();
			if (row.length !== trimmed.length) {
				rows[rows.length - 1] = trimmed;
				rowLength = fastStringWidth(trimmed);
			}
		}
		if (index !== 0) {
			if (rowLength >= columns && (options.wordWrap === false || options.trim === false)) {
				rows.push("");
				rowLength = 0;
			}
			if (rowLength || options.trim === false) {
				rows[rows.length - 1] += " ";
				rowLength++;
			}
		}
		const wordLength = fastStringWidth(word);
		if (options.hard && wordLength > columns) {
			const remainingColumns = columns - rowLength;
			const breaksStartingThisLine = 1 + Math.floor((wordLength - remainingColumns - 1) / columns);
			if (Math.floor((wordLength - 1) / columns) < breaksStartingThisLine) rows.push("");
			wrapWord(rows, word, columns);
			rowLength = fastStringWidth(rows.at(-1) ?? "");
			continue;
		}
		if (rowLength + wordLength > columns && rowLength && wordLength) {
			if (options.wordWrap === false && rowLength < columns) {
				wrapWord(rows, word, columns);
				rowLength = fastStringWidth(rows.at(-1) ?? "");
				continue;
			}
			rows.push("");
			rowLength = 0;
		}
		if (rowLength + wordLength > columns && options.wordWrap === false) {
			wrapWord(rows, word, columns);
			rowLength = fastStringWidth(rows.at(-1) ?? "");
			continue;
		}
		rows[rows.length - 1] += word;
		rowLength += wordLength;
	}
	if (options.trim !== false) rows = rows.map((row) => stringVisibleTrimSpacesRight(row));
	const preString = rows.join("\n");
	let inSurrogate = false;
	for (let i = 0; i < preString.length; i++) {
		const character = preString[i];
		returnValue += character;
		if (!inSurrogate) {
			inSurrogate = character >= "\ud800" && character <= "\udbff";
			if (inSurrogate) continue;
		} else inSurrogate = false;
		if (character === ESC || character === CSI) {
			GROUP_REGEX.lastIndex = i + 1;
			const groups = GROUP_REGEX.exec(preString)?.groups;
			if (groups?.code !== void 0) {
				const code = Number.parseFloat(groups.code);
				escapeCode = code === END_CODE ? void 0 : code;
			} else if (groups?.uri !== void 0) escapeUrl = groups.uri.length === 0 ? void 0 : groups.uri;
		}
		if (preString[i + 1] === "\n") {
			if (escapeUrl) returnValue += wrapAnsiHyperlink("");
			const closingCode = escapeCode ? getClosingCode(escapeCode) : void 0;
			if (escapeCode && closingCode) returnValue += wrapAnsiCode(closingCode);
		} else if (character === "\n") {
			if (escapeCode && getClosingCode(escapeCode)) returnValue += wrapAnsiCode(escapeCode);
			if (escapeUrl) returnValue += wrapAnsiHyperlink(escapeUrl);
		}
	}
	return returnValue;
};
const CRLF_OR_LF = /\r?\n/;
function wrapAnsi(string, columns, options) {
	return String(string).normalize().split(CRLF_OR_LF).map((line) => exec(line, columns, options)).join("\n");
}

//#endregion
//#region node_modules/.pnpm/sisteransi@1.0.5/node_modules/sisteransi/src/index.js
var require_src = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const ESC = "\x1B";
	const CSI = `${ESC}[`;
	const beep = "\x07";
	const cursor = {
		to(x, y) {
			if (!y) return `${CSI}${x + 1}G`;
			return `${CSI}${y + 1};${x + 1}H`;
		},
		move(x, y) {
			let ret = "";
			if (x < 0) ret += `${CSI}${-x}D`;
			else if (x > 0) ret += `${CSI}${x}C`;
			if (y < 0) ret += `${CSI}${-y}A`;
			else if (y > 0) ret += `${CSI}${y}B`;
			return ret;
		},
		up: (count = 1) => `${CSI}${count}A`,
		down: (count = 1) => `${CSI}${count}B`,
		forward: (count = 1) => `${CSI}${count}C`,
		backward: (count = 1) => `${CSI}${count}D`,
		nextLine: (count = 1) => `${CSI}E`.repeat(count),
		prevLine: (count = 1) => `${CSI}F`.repeat(count),
		left: `${CSI}G`,
		hide: `${CSI}?25l`,
		show: `${CSI}?25h`,
		save: `${ESC}7`,
		restore: `${ESC}8`
	};
	const scroll = {
		up: (count = 1) => `${CSI}S`.repeat(count),
		down: (count = 1) => `${CSI}T`.repeat(count)
	};
	const erase = {
		screen: `${CSI}2J`,
		up: (count = 1) => `${CSI}1J`.repeat(count),
		down: (count = 1) => `${CSI}J`.repeat(count),
		line: `${CSI}2K`,
		lineEnd: `${CSI}K`,
		lineStart: `${CSI}1K`,
		lines(count) {
			let clear = "";
			for (let i = 0; i < count; i++) clear += this.line + (i < count - 1 ? cursor.up() : "");
			if (count) clear += cursor.left;
			return clear;
		}
	};
	module.exports = {
		cursor,
		scroll,
		erase,
		beep
	};
}));

//#endregion
//#region node_modules/.pnpm/@clack+core@1.4.3/node_modules/@clack/core/dist/index.mjs
var import_src = require_src();
function findCursor(s, o, l) {
	if (!l.some((r) => !r.disabled)) return s;
	const t = s + o, n = Math.max(l.length - 1, 0), e = t < 0 ? n : t > n ? 0 : t;
	return l[e]?.disabled ? findCursor(e, o < 0 ? -1 : 1, l) : e;
}
const settings = {
	actions: /* @__PURE__ */ new Set([
		"up",
		"down",
		"left",
		"right",
		"space",
		"enter",
		"cancel"
	]),
	aliases: /* @__PURE__ */ new Map([
		["k", "up"],
		["j", "down"],
		["h", "left"],
		["l", "right"],
		["", "cancel"],
		["escape", "cancel"]
	]),
	messages: {
		cancel: "Canceled",
		error: "Something went wrong"
	},
	withGuide: true,
	date: {
		monthNames: [...[
			"January",
			"February",
			"March",
			"April",
			"May",
			"June",
			"July",
			"August",
			"September",
			"October",
			"November",
			"December"
		]],
		messages: {
			required: "Please enter a valid date",
			invalidMonth: "There are only 12 months in a year",
			invalidDay: (n, e) => `There are only ${n} days in ${e}`,
			afterMin: (n) => `Date must be on or after ${n.toISOString().slice(0, 10)}`,
			beforeMax: (n) => `Date must be on or before ${n.toISOString().slice(0, 10)}`
		}
	}
};
function isActionKey(n, e) {
	if (typeof n == "string") return settings.aliases.get(n) === e;
	for (const s of n) if (s !== void 0 && isActionKey(s, e)) return true;
	return false;
}
function diffLines(i, s) {
	if (i === s) return;
	const e = i.split(`
`), t = s.split(`
`), r = Math.max(e.length, t.length), f = [];
	for (let n = 0; n < r; n++) e[n] !== t[n] && f.push(n);
	return {
		lines: f,
		numLinesBefore: e.length,
		numLinesAfter: t.length,
		numLines: r
	};
}
const R = globalThis.process.platform.startsWith("win");
const CANCEL_SYMBOL = Symbol("clack:cancel");
function isCancel(e) {
	return e === CANCEL_SYMBOL;
}
function setRawMode(e, r) {
	const o = e;
	o.isTTY && o.setRawMode(r);
}
const getColumns = (e) => "columns" in e && typeof e.columns == "number" ? e.columns : 80;
const getRows = (e) => "rows" in e && typeof e.rows == "number" ? e.rows : 20;
function wrapTextWithPrefix(e, r, o, t = o, s = o, n) {
	return wrapAnsi(r, getColumns(e ?? stdout) - o.length, {
		hard: true,
		trim: false
	}).split(`
`).map((c, i, m) => {
		const d = n ? n(c, i) : c;
		return i === 0 ? `${t}${d}` : i === m.length - 1 ? `${s}${d}` : `${o}${d}`;
	}).join(`
`);
}
function runValidation(e, n) {
	if ("~standard" in e) {
		const a = e["~standard"].validate(n);
		if (a instanceof Promise) throw new TypeError("Schema validation must be synchronous. Update `validate()` and remove any asynchronous logic.");
		return a.issues?.at(0)?.message;
	}
	return e(n);
}
var V = class {
	input;
	output;
	_abortSignal;
	rl;
	opts;
	_render;
	_track = false;
	_prevFrame = "";
	_subscribers = /* @__PURE__ */ new Map();
	_cursor = 0;
	state = "initial";
	error = "";
	value;
	userInput = "";
	constructor(t, e = true) {
		const { input: i = stdin, output: n = stdout, render: s, signal: r, ...o } = t;
		this.opts = o, this.onKeypress = this.onKeypress.bind(this), this.close = this.close.bind(this), this.render = this.render.bind(this), this._render = s.bind(this), this._track = e, this._abortSignal = r, this.input = i, this.output = n;
	}
	/**
	* Unsubscribe all listeners
	*/
	unsubscribe() {
		this._subscribers.clear();
	}
	/**
	* Set a subscriber with opts
	* @param event - The event name
	*/
	setSubscriber(t, e) {
		const i = this._subscribers.get(t) ?? [];
		i.push(e), this._subscribers.set(t, i);
	}
	/**
	* Subscribe to an event
	* @param event - The event name
	* @param cb - The callback
	*/
	on(t, e) {
		this.setSubscriber(t, { cb: e });
	}
	/**
	* Subscribe to an event once
	* @param event - The event name
	* @param cb - The callback
	*/
	once(t, e) {
		this.setSubscriber(t, {
			cb: e,
			once: true
		});
	}
	/**
	* Emit an event with data
	* @param event - The event name
	* @param data - The data to pass to the callback
	*/
	emit(t, ...e) {
		const i = this._subscribers.get(t) ?? [], n = [];
		for (const s of i) s.cb(...e), s.once && n.push(() => i.splice(i.indexOf(s), 1));
		for (const s of n) s();
	}
	prompt() {
		return new Promise((t) => {
			if (this._abortSignal) {
				if (this._abortSignal.aborted) return this.state = "cancel", this.close(), t(CANCEL_SYMBOL);
				this._abortSignal.addEventListener("abort", () => {
					this.state = "cancel", this.close();
				}, { once: true });
			}
			this.rl = l__default.createInterface({
				input: this.input,
				tabSize: 2,
				prompt: "",
				escapeCodeTimeout: 50,
				terminal: true
			}), this.rl.prompt(), this.opts.initialUserInput !== void 0 && this._setUserInput(this.opts.initialUserInput, true), this.input.on("keypress", this.onKeypress), setRawMode(this.input, true), this.output.on("resize", this.render), this.render(), this.once("submit", () => {
				this.output.write(import_src.cursor.show), this.output.off("resize", this.render), setRawMode(this.input, false), t(this.value);
			}), this.once("cancel", () => {
				this.output.write(import_src.cursor.show), this.output.off("resize", this.render), setRawMode(this.input, false), t(CANCEL_SYMBOL);
			});
		});
	}
	_isActionKey(t, e) {
		return t === "	";
	}
	_shouldSubmit(t, e) {
		return true;
	}
	_setValue(t) {
		this.value = t, this.emit("value", this.value);
	}
	_setUserInput(t, e) {
		this.userInput = t ?? "", this.emit("userInput", this.userInput), e && this._track && this.rl && (this.rl.write(this.userInput), this._cursor = this.rl.cursor);
	}
	_clearUserInput() {
		this.rl?.write(null, {
			ctrl: true,
			name: "u"
		}), this._setUserInput("");
	}
	onKeypress(t, e) {
		if (this._track && e.name !== "return" && (e.name && this._isActionKey(t, e) && this.rl?.write(null, {
			ctrl: true,
			name: "h"
		}), this._cursor = this.rl?.cursor ?? 0, this._setUserInput(this.rl?.line)), this.state === "error" && (this.state = "active"), e?.name && (!this._track && settings.aliases.has(e.name) && this.emit("cursor", settings.aliases.get(e.name)), settings.actions.has(e.name) && this.emit("cursor", e.name)), t && (t.toLowerCase() === "y" || t.toLowerCase() === "n") && this.emit("confirm", t.toLowerCase() === "y"), this.emit("key", t, e), e?.name === "return" && this._shouldSubmit(t, e)) {
			if (this.opts.validate) {
				const i = runValidation(this.opts.validate, this.value);
				i && (this.error = i instanceof Error ? i.message : i, this.state = "error", this.rl?.write(this.userInput));
			}
			this.state !== "error" && (this.state = "submit");
		}
		isActionKey([
			t,
			e?.name,
			e?.sequence
		], "cancel") && (this.state = "cancel"), (this.state === "submit" || this.state === "cancel") && this.emit("finalize"), this.render(), (this.state === "submit" || this.state === "cancel") && this.close();
	}
	close() {
		this.input.unpipe(), this.input.removeListener("keypress", this.onKeypress), this.output.write(`
`), setRawMode(this.input, false), this.rl?.close(), this.rl = void 0, this.emit(`${this.state}`, this.value), this.unsubscribe();
	}
	restoreCursor() {
		const t = wrapAnsi(this._prevFrame, process.stdout.columns, {
			hard: true,
			trim: false
		}).split(`
`).length - 1;
		this.output.write(import_src.cursor.move(-999, t * -1));
	}
	render() {
		const t = wrapAnsi(this._render(this) ?? "", process.stdout.columns, {
			hard: true,
			trim: false
		});
		if (t !== this._prevFrame) {
			if (this.state === "initial") this.output.write(import_src.cursor.hide);
			else {
				const e = diffLines(this._prevFrame, t), i = getRows(this.output);
				if (this.restoreCursor(), e) {
					const n = Math.max(0, e.numLinesAfter - i), s = Math.max(0, e.numLinesBefore - i);
					let r = e.lines.find((o) => o >= n);
					if (r === void 0) {
						this._prevFrame = t;
						return;
					}
					if (e.lines.length === 1) {
						this.output.write(import_src.cursor.move(0, r - s)), this.output.write(import_src.erase.lines(1));
						const o = t.split(`
`);
						this.output.write(o[r]), this._prevFrame = t, this.output.write(import_src.cursor.move(0, o.length - r - 1));
						return;
					} else if (e.lines.length > 1) {
						if (n < s) r = n;
						else {
							const h = r - s;
							h > 0 && this.output.write(import_src.cursor.move(0, h));
						}
						this.output.write(import_src.erase.down());
						const f = t.split(`
`).slice(r);
						this.output.write(f.join(`
`)), this._prevFrame = t;
						return;
					}
				}
				this.output.write(import_src.erase.down());
			}
			this.output.write(t), this.state === "initial" && (this.state = "active"), this._prevFrame = t;
		}
	}
};
var r = class extends V {
	get cursor() {
		return this.value ? 0 : 1;
	}
	get _value() {
		return this.cursor === 0;
	}
	constructor(t) {
		super(t, false), this.value = !!t.initialValue, this.on("userInput", () => {
			this.value = this._value;
		}), this.on("confirm", (i) => {
			this.output.write(import_src.cursor.move(0, -1)), this.value = i, this.state = "submit", this.close();
		}), this.on("cursor", () => {
			this.value = !this.value;
		});
	}
};
var a = class extends V {
	options;
	cursor = 0;
	get _value() {
		return this.options[this.cursor]?.value;
	}
	get _enabledOptions() {
		return this.options.filter((e) => e.disabled !== true);
	}
	toggleAll() {
		const e = this._enabledOptions, i = this.value !== void 0 && this.value.length === e.length;
		this.value = i ? [] : e.map((t) => t.value);
	}
	toggleInvert() {
		const e = this.value;
		if (!e) return;
		const i = this._enabledOptions.filter((t) => !e.includes(t.value));
		this.value = i.map((t) => t.value);
	}
	toggleValue() {
		this.value === void 0 && (this.value = []);
		const e = this.value.includes(this._value);
		this.value = e ? this.value.filter((i) => i !== this._value) : [...this.value, this._value];
	}
	constructor(e) {
		super(e, false), this.options = e.options, this.value = [...e.initialValues ?? []];
		const i = Math.max(this.options.findIndex(({ value: t }) => t === e.cursorAt), 0);
		this.cursor = this.options[i]?.disabled ? findCursor(i, 1, this.options) : i, this.on("key", (t, l) => {
			l.name === "a" && this.toggleAll(), l.name === "i" && this.toggleInvert();
		}), this.on("cursor", (t) => {
			switch (t) {
				case "left":
				case "up":
					this.cursor = findCursor(this.cursor, -1, this.options);
					break;
				case "down":
				case "right":
					this.cursor = findCursor(this.cursor, 1, this.options);
					break;
				case "space":
					this.toggleValue();
					break;
			}
		});
	}
};
let n$1 = class n extends V {
	options;
	cursor = 0;
	get _selectedValue() {
		return this.options[this.cursor];
	}
	changeValue() {
		const e = this._selectedValue;
		this.value = e === void 0 ? void 0 : e.value;
	}
	constructor(e) {
		super(e, false), this.options = e.options;
		const o = this.options.findIndex(({ value: s }) => s === e.initialValue), t = o === -1 ? 0 : o;
		this.cursor = this.options[t]?.disabled ? findCursor(t, 1, this.options) : t, this.changeValue(), this.on("cursor", (s) => {
			switch (s) {
				case "left":
				case "up":
					this.cursor = findCursor(this.cursor, -1, this.options);
					break;
				case "down":
				case "right":
					this.cursor = findCursor(this.cursor, 1, this.options);
					break;
			}
			this.changeValue();
		});
	}
};

//#endregion
//#region node_modules/.pnpm/@clack+prompts@1.7.0/node_modules/@clack/prompts/dist/index.mjs
function isUnicodeSupported() {
	if (process$1.platform !== "win32") return process$1.env.TERM !== "linux";
	return Boolean(process$1.env.CI) || Boolean(process$1.env.WT_SESSION) || Boolean(process$1.env.TERMINUS_SUBLIME) || process$1.env.ConEmuTask === "{cmd::Cmder}" || process$1.env.TERM_PROGRAM === "Terminus-Sublime" || process$1.env.TERM_PROGRAM === "vscode" || process$1.env.TERM === "xterm-256color" || process$1.env.TERM === "alacritty" || process$1.env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}
const unicode = isUnicodeSupported();
const unicodeOr = (o, e) => unicode ? o : e;
const S_STEP_ACTIVE = unicodeOr("◆", "*");
const S_STEP_CANCEL = unicodeOr("■", "x");
const S_STEP_ERROR = unicodeOr("▲", "x");
const S_STEP_SUBMIT = unicodeOr("◇", "o");
const S_BAR_START = unicodeOr("┌", "T");
const S_BAR = unicodeOr("│", "|");
const S_BAR_END = unicodeOr("└", "—");
const S_BAR_START_RIGHT = unicodeOr("┐", "T");
const S_BAR_END_RIGHT = unicodeOr("┘", "—");
const S_RADIO_ACTIVE = unicodeOr("●", ">");
const S_RADIO_INACTIVE = unicodeOr("○", " ");
const S_CHECKBOX_ACTIVE = unicodeOr("◻", "[•]");
const S_CHECKBOX_SELECTED = unicodeOr("◼", "[+]");
const S_CHECKBOX_INACTIVE = unicodeOr("◻", "[ ]");
const S_PASSWORD_MASK = unicodeOr("▪", "•");
const S_BAR_H = unicodeOr("─", "-");
const S_CORNER_TOP_RIGHT = unicodeOr("╮", "+");
const S_CONNECT_LEFT = unicodeOr("├", "+");
const S_CORNER_BOTTOM_RIGHT = unicodeOr("╯", "+");
const S_CORNER_BOTTOM_LEFT = unicodeOr("╰", "+");
const S_CORNER_TOP_LEFT = unicodeOr("╭", "+");
const S_INFO = unicodeOr("●", "•");
const S_SUCCESS = unicodeOr("◆", "*");
const S_WARN = unicodeOr("▲", "!");
const S_ERROR = unicodeOr("■", "x");
const symbol = (o) => {
	switch (o) {
		case "initial":
		case "active": return styleText("cyan", S_STEP_ACTIVE);
		case "cancel": return styleText("red", S_STEP_CANCEL);
		case "error": return styleText("yellow", S_STEP_ERROR);
		case "submit": return styleText("green", S_STEP_SUBMIT);
	}
};
const symbolBar = (o) => {
	switch (o) {
		case "initial":
		case "active": return styleText("cyan", S_BAR);
		case "cancel": return styleText("red", S_BAR);
		case "error": return styleText("yellow", S_BAR);
		case "submit": return styleText("green", S_BAR);
	}
};
function formatInstructionFooter(o, e) {
	const r = [`${e ? `${styleText("cyan", S_BAR)}  ` : ""}${o.join(" • ")}`];
	return e && r.push(styleText("cyan", S_BAR_END)), r;
}
const I = (l, e, w, p, b, C = false) => {
	let r = e, O = 0;
	if (C) for (let i = p - 1; i >= w; i--) {
		const m = l[i];
		if (m && (r -= m.length), O++, r <= b) break;
	}
	else for (let i = w; i < p; i++) {
		const m = l[i];
		if (m && (r -= m.length), O++, r <= b) break;
	}
	return {
		lineCount: r,
		removals: O
	};
};
const limitOptions = ({ cursor: l, options: e, style: w, output: p = process.stdout, maxItems: b = Number.POSITIVE_INFINITY, columnPadding: C = 0, rowPadding: r = 4 }) => {
	const i = getColumns(p) - C, m = getRows(p), M = styleText("dim", "..."), v = Math.max(m - r, 0), a = Math.max(Math.min(b, v), 5);
	let f = 0;
	l >= a - 3 && (f = Math.max(Math.min(l - a + 3, e.length - a), 0));
	let d = a < e.length && f > 0, c = a < e.length && f + a < e.length;
	const W = Math.min(f + a, e.length), s = [];
	let g = 0;
	d && g++, c && g++;
	const T = f + (d ? 1 : 0), y = W - (c ? 1 : 0);
	for (let t = T; t < y; t++) {
		const n = e[t], h = wrapAnsi(n ? w(n, t === l) : "", i, {
			hard: true,
			trim: false
		}).split(`
`);
		s.push(h), g += h.length;
	}
	if (g > v) {
		let t = 0, n = 0, o = g;
		const h = l - T;
		let u = v;
		const L = () => I(s, o, 0, h, u), E = () => I(s, o, h + 1, s.length, u, true);
		d ? ({lineCount: o, removals: t} = L(), o > u && (c || (u -= 1), {lineCount: o, removals: n} = E())) : (c || (u -= 1), {lineCount: o, removals: n} = E(), o > u && (u -= 1, {lineCount: o, removals: t} = L())), t > 0 && (d = true, s.splice(0, t)), n > 0 && (c = true, s.splice(s.length - n, n));
	}
	const x = [];
	d && x.push(M);
	for (const t of s) for (const n of t) x.push(n);
	return c && x.push(M), x;
};
const confirm = (i) => {
	const a = i.active ?? "Yes", s = i.inactive ?? "No";
	return new r({
		active: a,
		inactive: s,
		signal: i.signal,
		input: i.input,
		output: i.output,
		initialValue: i.initialValue ?? true,
		render() {
			const e = i.withGuide ?? settings.withGuide, u = `${symbol(this.state)}  `, l = e ? `${styleText("gray", S_BAR)}  ` : "", f = wrapTextWithPrefix(i.output, i.message, l, u), o = `${e ? `${styleText("gray", S_BAR)}
` : ""}${f}
`, c = this.value ? a : s;
			switch (this.state) {
				case "submit": return `${o}${e ? `${styleText("gray", S_BAR)}  ` : ""}${styleText("dim", c)}`;
				case "cancel": return `${o}${e ? `${styleText("gray", S_BAR)}  ` : ""}${styleText(["strikethrough", "dim"], c)}${e ? `
${styleText("gray", S_BAR)}` : ""}`;
				default: {
					const r = e ? `${styleText("cyan", S_BAR)}  ` : "", g = e ? styleText("cyan", S_BAR_END) : "";
					return `${o}${r}${this.value ? `${styleText("green", S_RADIO_ACTIVE)} ${a}` : `${styleText("dim", S_RADIO_INACTIVE)} ${styleText("dim", a)}`}${i.vertical ? e ? `
${styleText("cyan", S_BAR)}  ` : `
` : ` ${styleText("dim", "/")} `}${this.value ? `${styleText("dim", S_RADIO_INACTIVE)} ${styleText("dim", s)}` : `${styleText("green", S_RADIO_ACTIVE)} ${s}`}
${g}
`;
				}
			}
		}
	}).prompt();
};
const MULTISELECT_INSTRUCTIONS = [
	`${styleText("dim", "↑/↓")} to navigate`,
	`${styleText("dim", "Space:")} select`,
	`${styleText("dim", "Enter:")} confirm`
];
const m = (i, u) => i.split(`
`).map((d) => u(d)).join(`
`);
const multiselect = (i) => {
	const u = (t, a) => {
		const r = t.label ?? String(t.value);
		return a === "disabled" ? `${styleText("gray", S_CHECKBOX_INACTIVE)} ${m(r, (o) => styleText(["strikethrough", "gray"], o))}${t.hint ? ` ${styleText("dim", `(${t.hint ?? "disabled"})`)}` : ""}` : a === "active" ? `${styleText("cyan", S_CHECKBOX_ACTIVE)} ${r}${t.hint ? ` ${styleText("dim", `(${t.hint})`)}` : ""}` : a === "selected" ? `${styleText("green", S_CHECKBOX_SELECTED)} ${m(r, (o) => styleText("dim", o))}${t.hint ? ` ${styleText("dim", `(${t.hint})`)}` : ""}` : a === "cancelled" ? `${m(r, (o) => styleText(["strikethrough", "dim"], o))}` : a === "active-selected" ? `${styleText("green", S_CHECKBOX_SELECTED)} ${r}${t.hint ? ` ${styleText("dim", `(${t.hint})`)}` : ""}` : a === "submitted" ? `${m(r, (o) => styleText("dim", o))}` : `${styleText("dim", S_CHECKBOX_INACTIVE)} ${m(r, (o) => styleText("dim", o))}`;
	}, d = i.required ?? true, v = i.showInstructions ?? true;
	return new a({
		options: i.options,
		signal: i.signal,
		input: i.input,
		output: i.output,
		initialValues: i.initialValues,
		required: d,
		cursorAt: i.cursorAt,
		validate(t) {
			if (d && (t === void 0 || t.length === 0)) return `Please select at least one option.
${styleText("reset", styleText("dim", `Press ${styleText([
				"gray",
				"bgWhite",
				"inverse"
			], " space ")} to select, ${styleText("gray", styleText("bgWhite", styleText("inverse", " enter ")))} to submit`))}`;
		},
		render() {
			const t = i.withGuide ?? settings.withGuide, a = wrapTextWithPrefix(i.output, i.message, t ? `${symbolBar(this.state)}  ` : "", `${symbol(this.state)}  `), r = `${t ? `${styleText("gray", S_BAR)}
` : ""}${a}
`, o = this.value ?? [], p = (n, l) => {
				if (n.disabled) return u(n, "disabled");
				const s = o.includes(n.value);
				return l && s ? u(n, "active-selected") : s ? u(n, "selected") : u(n, l ? "active" : "inactive");
			};
			switch (this.state) {
				case "submit": {
					const n = this.options.filter(({ value: s }) => o.includes(s)).map((s) => u(s, "submitted")).join(styleText("dim", ", ")) || styleText("dim", "none");
					return `${r}${wrapTextWithPrefix(i.output, n, t ? `${styleText("gray", S_BAR)}  ` : "")}`;
				}
				case "cancel": {
					const n = this.options.filter(({ value: s }) => o.includes(s)).map((s) => u(s, "cancelled")).join(styleText("dim", ", "));
					if (n.trim() === "") return `${r}${styleText("gray", S_BAR)}`;
					return `${r}${wrapTextWithPrefix(i.output, n, t ? `${styleText("gray", S_BAR)}  ` : "")}${t ? `
${styleText("gray", S_BAR)}` : ""}`;
				}
				case "error": {
					const n = t ? `${styleText("yellow", S_BAR)}  ` : "", l = this.error.split(`
`).map(($, C) => C === 0 ? `${t ? `${styleText("yellow", S_BAR_END)}  ` : ""}${styleText("yellow", $)}` : `   ${$}`).join(`
`), s = r.split(`
`).length, h = l.split(`
`).length + 1;
					return `${r}${n}${limitOptions({
						output: i.output,
						options: this.options,
						cursor: this.cursor,
						maxItems: i.maxItems,
						columnPadding: n.length,
						rowPadding: s + h,
						style: p
					}).join(`
${n}`)}
${l}
`;
				}
				default: {
					const n = t ? `${styleText("cyan", S_BAR)}  ` : "", l = r.split(`
`).length, s = v ? formatInstructionFooter(MULTISELECT_INSTRUCTIONS, t) : t ? [styleText("cyan", S_BAR_END)] : [], h = s.join(`
`), $ = s.length + 1;
					return `${r}${n}${limitOptions({
						output: i.output,
						options: this.options,
						cursor: this.cursor,
						maxItems: i.maxItems,
						columnPadding: n.length,
						rowPadding: l + $,
						style: p
					}).join(`
${n}`)}
${h}
`;
				}
			}
		}
	}).prompt();
};
const cancel = (o = "", t) => {
	const i = t?.output ?? process.stdout, e = t?.withGuide ?? settings.withGuide ? `${styleText("gray", S_BAR_END)}  ` : "";
	i.write(`${e}${styleText("red", o)}

`);
};
const intro = (o = "", t) => {
	const i = t?.output ?? process.stdout, e = t?.withGuide ?? settings.withGuide ? `${styleText("gray", S_BAR_START)}  ` : "";
	i.write(`${e}${o}
`);
};
const outro = (o = "", t) => {
	const i = t?.output ?? process.stdout, e = t?.withGuide ?? settings.withGuide ? `${styleText("gray", S_BAR)}
${styleText("gray", S_BAR_END)}  ` : "";
	i.write(`${e}${o}

`);
};
const W$1 = (o) => o;
const C = (o, e, s) => {
	const a = {
		hard: true,
		trim: false
	}, i = wrapAnsi(o, e, a).split(`
`), c = i.reduce((n, t) => Math.max(fastStringWidth(t), n), 0);
	return wrapAnsi(o, e - (i.map(s).reduce((n, t) => Math.max(fastStringWidth(t), n), 0) - c), a);
};
const note = (o = "", e = "", s) => {
	const a = s?.output ?? process$1.stdout, i = s?.withGuide ?? settings.withGuide, c = s?.format ?? W$1, g = [
		"",
		...C(o, getColumns(a) - 6, c).split(`
`).map(c),
		""
	], n = fastStringWidth(e), t = Math.max(g.reduce((m, F) => {
		const O = fastStringWidth(F);
		return O > m ? O : m;
	}, 0), n) + 2, h = g.map((m) => `${styleText("gray", S_BAR)}  ${m}${" ".repeat(t - fastStringWidth(m))}${styleText("gray", S_BAR)}`).join(`
`), T = i ? `${styleText("gray", S_BAR)}
` : "", l$1 = i ? S_CONNECT_LEFT : S_CORNER_BOTTOM_LEFT;
	a.write(`${T}${styleText("green", S_STEP_SUBMIT)}  ${styleText("reset", e)} ${styleText("gray", S_BAR_H.repeat(Math.max(t - n - 1, 1)) + S_CORNER_TOP_RIGHT)}
${h}
${styleText("gray", l$1 + S_BAR_H.repeat(t + 2) + S_CORNER_BOTTOM_RIGHT)}
`);
};
const u = {
	light: unicodeOr("─", "-"),
	heavy: unicodeOr("━", "="),
	block: unicodeOr("█", "#")
};
const SELECT_INSTRUCTIONS = [`${styleText("dim", "↑/↓")} to navigate`, `${styleText("dim", "Enter:")} confirm`];
const c = (t, o) => t.includes(`
`) ? t.split(`
`).map((d) => o(d)).join(`
`) : o(t);
const select = (t) => {
	const o = (n, m) => {
		if (n === void 0) return "";
		const s = n.label ?? String(n.value);
		switch (m) {
			case "disabled": return `${styleText("gray", S_RADIO_INACTIVE)} ${c(s, (i) => styleText("gray", i))}${n.hint ? ` ${styleText("dim", `(${n.hint ?? "disabled"})`)}` : ""}`;
			case "selected": return `${c(s, (i) => styleText("dim", i))}`;
			case "active": return `${styleText("green", S_RADIO_ACTIVE)} ${s}${n.hint ? ` ${styleText("dim", `(${n.hint})`)}` : ""}`;
			case "cancelled": return `${c(s, (i) => styleText(["strikethrough", "dim"], i))}`;
			default: return `${styleText("dim", S_RADIO_INACTIVE)} ${c(s, (i) => styleText("dim", i))}`;
		}
	}, d = t.showInstructions ?? true;
	return new n$1({
		options: t.options,
		signal: t.signal,
		input: t.input,
		output: t.output,
		initialValue: t.initialValue,
		render() {
			const n = t.withGuide ?? settings.withGuide, m = `${symbol(this.state)}  `, s = `${symbolBar(this.state)}  `, i = wrapTextWithPrefix(t.output, t.message, s, m), u = `${n ? `${styleText("gray", S_BAR)}
` : ""}${i}
`;
			switch (this.state) {
				case "submit": {
					const r = n ? `${styleText("gray", S_BAR)}  ` : "";
					return `${u}${wrapTextWithPrefix(t.output, o(this.options[this.cursor], "selected"), r)}`;
				}
				case "cancel": {
					const r = n ? `${styleText("gray", S_BAR)}  ` : "";
					return `${u}${wrapTextWithPrefix(t.output, o(this.options[this.cursor], "cancelled"), r)}${n ? `
${styleText("gray", S_BAR)}` : ""}`;
				}
				default: {
					const r = n ? `${styleText("cyan", S_BAR)}  ` : "", a = u.split(`
`).length, p = d ? formatInstructionFooter(SELECT_INSTRUCTIONS, n) : n ? [styleText("cyan", S_BAR_END)] : [], b = p.join(`
`), f = p.length + 1;
					return `${u}${r}${limitOptions({
						output: t.output,
						cursor: this.cursor,
						options: this.options,
						maxItems: t.maxItems,
						columnPadding: r.length,
						rowPadding: a + f,
						style: (g, x) => o(g, g.disabled ? "disabled" : x ? "active" : "inactive")
					}).join(`
${r}`)}
${b}
`;
				}
			}
		}
	}).prompt();
};
const i = `${styleText("gray", S_BAR)}  `;

//#endregion
//#region src/config/presets.ts
function cloneDefault() {
	return structuredClone(DEFAULT_CONFIG);
}
function createPreset(preset) {
	const config = cloneDefault();
	if (preset === "full") {
		Object.assign(config.display, {
			showConfigCounts: false,
			showCost: false,
			showDuration: true,
			showSpeed: false,
			showTokenBreakdown: true,
			showTools: true,
			showSkills: true,
			showMcp: true,
			showAgents: true,
			showTodos: true,
			showGoal: true,
			showSessionName: true,
			showAuth: true,
			showAuthUser: true,
			toolNameMaxLength: 20,
			toolsMaxVisible: 3,
			showCodexVersion: false,
			showEffortLevel: true,
			showApprovalPolicy: false,
			showSandboxMode: false,
			showCollaborationMode: false,
			showMemoryUsage: false,
			showPromptCache: true,
			showSessionTokens: false,
			showSessionStartDate: false,
			showLastResponseAt: false,
			showCompactions: true,
			showSessionId: false
		});
		return config;
	}
	if (preset === "essential") {
		Object.assign(config.display, {
			showDuration: true,
			showTools: true,
			showAgents: true,
			showTodos: true,
			showGoal: true,
			showEffortLevel: true,
			showUsage: false
		});
		return config;
	}
	config.lineLayout = "compact";
	config.elementOrder = ["project", "context"];
	config.display.showUsage = false;
	config.display.showAddedDirs = false;
	config.display.showGoal = false;
	return config;
}

//#endregion
//#region src/config/write.ts
function mergeKnownConfig(raw, config) {
	const rawGit = typeof raw.gitStatus === "object" && raw.gitStatus !== null && !Array.isArray(raw.gitStatus) ? raw.gitStatus : {};
	const rawDisplay = typeof raw.display === "object" && raw.display !== null && !Array.isArray(raw.display) ? raw.display : {};
	const rawColors = typeof raw.colors === "object" && raw.colors !== null && !Array.isArray(raw.colors) ? raw.colors : {};
	return {
		...raw,
		...config,
		gitStatus: {
			...rawGit,
			...config.gitStatus
		},
		display: {
			...rawDisplay,
			...config.display
		},
		colors: {
			...rawColors,
			...config.colors
		}
	};
}
function writeConfig(config, raw = {}, env = process$1.env) {
	const configPath = getConfigPath(env);
	const directory = path.dirname(configPath);
	fs.mkdirSync(directory, {
		recursive: true,
		mode: 448
	});
	const temporaryPath = path.join(directory, `.${path.basename(configPath)}.${process$1.pid}.tmp`);
	const serialized = `${JSON.stringify(mergeKnownConfig(raw, config), null, 2)}\n`;
	fs.writeFileSync(temporaryPath, serialized, {
		encoding: "utf8",
		mode: 384
	});
	fs.renameSync(temporaryPath, configPath);
	return configPath;
}

//#endregion
//#region src/commands/configure.ts
const GUIDED_TOGGLES = [
	"git",
	"usage",
	"tools",
	"skills",
	"mcp",
	"agents",
	"todos",
	"goal",
	"configCounts",
	"duration",
	"speed",
	"promptCache",
	"sessionName",
	"auth",
	"memory",
	"sessionTokens",
	"compactions"
];
function optionValue(args, name) {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] ?? null : null;
}
function isPreset(value) {
	return value === "full" || value === "essential" || value === "minimal";
}
function isLanguage(value) {
	return value === "en" || value === "zh-Hans" || value === "zh-Hant";
}
function isLayout(value) {
	return value === "compact" || value === "expanded";
}
function cancelled(value) {
	if (isCancel(value)) {
		cancel("Configuration cancelled.");
		return true;
	}
	return false;
}
function preserveAdvancedSettings(target, source) {
	target.maxWidth = source.maxWidth;
	target.forceMaxWidth = source.forceMaxWidth;
	target.refreshIntervalMs = source.refreshIntervalMs;
	target.showSeparators = source.showSeparators;
	target.colors = structuredClone(source.colors);
	for (const key of [
		"contextValue",
		"usageValue",
		"usageBarEnabled",
		"usageCompact",
		"showResetLabel",
		"toolNameMaxLength",
		"toolsMaxVisible",
		"authUserLength",
		"showAuthUser",
		"mergeGroups",
		"contextWarningThreshold",
		"contextCriticalThreshold",
		"usageThreshold",
		"sevenDayThreshold",
		"environmentThreshold",
		"externalUsagePath",
		"externalUsageWritePath",
		"externalUsageFreshnessMs",
		"modelFormat",
		"modelOverride",
		"showProvider",
		"providerName",
		"customLine",
		"customLinePosition",
		"timeFormat",
		"autoCompactWindow",
		"promptCacheTtlSeconds"
	]) target.display[key] = structuredClone(source.display[key]);
}
function currentToggles(config) {
	return GUIDED_TOGGLES.filter((toggle) => {
		return {
			git: config.gitStatus.enabled,
			usage: config.display.showUsage,
			tools: config.display.showTools,
			skills: config.display.showSkills,
			mcp: config.display.showMcp,
			agents: config.display.showAgents,
			todos: config.display.showTodos,
			goal: config.display.showGoal,
			configCounts: config.display.showConfigCounts,
			duration: config.display.showDuration,
			speed: config.display.showSpeed,
			promptCache: config.display.showPromptCache,
			sessionName: config.display.showSessionName,
			auth: config.display.showAuth,
			memory: config.display.showMemoryUsage,
			sessionTokens: config.display.showSessionTokens,
			compactions: config.display.showCompactions
		}[toggle];
	});
}
function applyToggles(config, selected) {
	const enabled = new Set(selected);
	config.gitStatus.enabled = enabled.has("git");
	config.display.showUsage = enabled.has("usage");
	config.display.showTools = enabled.has("tools");
	config.display.showSkills = enabled.has("skills");
	config.display.showMcp = enabled.has("mcp");
	config.display.showAgents = enabled.has("agents");
	config.display.showTodos = enabled.has("todos");
	config.display.showGoal = enabled.has("goal");
	config.display.showConfigCounts = enabled.has("configCounts");
	config.display.showDuration = enabled.has("duration");
	config.display.showSpeed = enabled.has("speed");
	config.display.showPromptCache = enabled.has("promptCache");
	config.display.showSessionName = enabled.has("sessionName");
	config.display.showAuth = enabled.has("auth");
	config.display.showMemoryUsage = enabled.has("memory");
	config.display.showSessionTokens = enabled.has("sessionTokens");
	config.display.showCompactions = enabled.has("compactions");
}
function preview(config) {
	const parser = new RolloutParser();
	const candidate = findActiveSession({ cwd: process$1.cwd() });
	parser.setFile(candidate?.path ?? null);
	const now = /* @__PURE__ */ new Date();
	return renderHud({
		config,
		state: buildHudState(process$1.cwd(), parser.parse(), now, config, now),
		options: {
			width: Math.min(process$1.stdout.columns || 120, 140),
			height: 8,
			color: process$1.stdout.isTTY && !process$1.env.NO_COLOR
		},
		now
	}).join("\n") || "(No active Codex session data yet)";
}
async function runConfigure(args) {
	const loaded = loadConfig();
	let preset = optionValue(args, "--preset");
	let language = optionValue(args, "--language");
	let layout = optionValue(args, "--layout");
	const nonInteractive = args.includes("--yes") || !process$1.stdin.isTTY;
	if (!isPreset(preset)) if (nonInteractive) preset = "essential";
	else {
		intro("Codex HUD configuration");
		const selected = await select({
			message: "Choose a display preset",
			initialValue: "essential",
			options: [
				{
					value: "full",
					label: "Full",
					hint: "All telemetry and activity"
				},
				{
					value: "essential",
					label: "Essential",
					hint: "Context, quota, tools, agents, tasks"
				},
				{
					value: "minimal",
					label: "Minimal",
					hint: "Model, project, context"
				}
			]
		});
		if (cancelled(selected)) return 1;
		preset = selected;
	}
	if (!isLanguage(language)) if (nonInteractive) language = loaded.config.language;
	else {
		const selected = await select({
			message: "Choose label language",
			initialValue: loaded.config.language,
			options: [
				{
					value: "en",
					label: "English"
				},
				{
					value: "zh-Hans",
					label: "简体中文"
				},
				{
					value: "zh-Hant",
					label: "繁體中文"
				}
			]
		});
		if (cancelled(selected)) return 1;
		language = selected;
	}
	const selectedPreset = isPreset(preset) ? preset : "essential";
	const selectedLanguage = isLanguage(language) ? language : loaded.config.language;
	const config = createPreset(selectedPreset);
	preserveAdvancedSettings(config, loaded.config);
	config.language = selectedLanguage;
	if (!isLayout(layout) && !nonInteractive) {
		const selected = await select({
			message: "Choose layout",
			initialValue: config.lineLayout,
			options: [{
				value: "expanded",
				label: "Expanded",
				hint: "Multiple readable lines"
			}, {
				value: "compact",
				label: "Compact",
				hint: "Dense header plus activity"
			}]
		});
		if (cancelled(selected)) return 1;
		layout = selected;
	}
	if (isLayout(layout)) config.lineLayout = layout;
	if (!nonInteractive) {
		const toggles = await multiselect({
			message: "Choose visible HUD elements",
			initialValues: currentToggles(config),
			required: false,
			options: [
				{
					value: "git",
					label: "Git status"
				},
				{
					value: "usage",
					label: "Rate limits and credits"
				},
				{
					value: "tools",
					label: "Tool activity"
				},
				{
					value: "skills",
					label: "Active skills"
				},
				{
					value: "mcp",
					label: "MCP activity"
				},
				{
					value: "agents",
					label: "Subagents"
				},
				{
					value: "todos",
					label: "Plan / todos"
				},
				{
					value: "goal",
					label: "Durable goal"
				},
				{
					value: "configCounts",
					label: "Environment counts"
				},
				{
					value: "duration",
					label: "Session duration"
				},
				{
					value: "speed",
					label: "Output speed"
				},
				{
					value: "promptCache",
					label: "Prompt-cache countdown"
				},
				{
					value: "sessionName",
					label: "Session title"
				},
				{
					value: "auth",
					label: "Authentication method"
				},
				{
					value: "memory",
					label: "Approximate system memory"
				},
				{
					value: "sessionTokens",
					label: "Session token totals"
				},
				{
					value: "compactions",
					label: "Compaction count"
				}
			]
		});
		if (cancelled(toggles)) return 1;
		applyToggles(config, toggles);
		const pathLevels = await select({
			message: "Project path depth",
			initialValue: config.pathLevels,
			options: [
				{
					value: 1,
					label: "Project only"
				},
				{
					value: 2,
					label: "Parent / project"
				},
				{
					value: 3,
					label: "Two parents / project"
				}
			]
		});
		if (cancelled(pathLevels)) return 1;
		config.pathLevels = pathLevels;
		note(preview(config), "HUD preview");
		const confirmed = await confirm({
			message: `Save ${selectedPreset} / ${selectedLanguage} / ${config.lineLayout} configuration?`,
			initialValue: true
		});
		if (cancelled(confirmed) || !confirmed) return 1;
	}
	const configPath = writeConfig(config, loaded.raw);
	if (!nonInteractive) outro(`Saved ${configPath}`);
	else process$1.stdout.write(`${configPath}\n`);
	return 0;
}

//#endregion
//#region src/runtime/process.ts
function findExecutable(name, env = process$1.env, excludedPaths = []) {
	const explicit = name === "codex" ? env.CODEX_HUD_CODEX_BIN || env.CODEX_HUB_CODEX_BIN : void 0;
	const candidates = explicit ? [explicit] : (env.PATH ?? "").split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, name));
	const excluded = new Set(excludedPaths.map((value) => path.resolve(value)));
	for (const candidate of candidates) {
		const resolved = path.resolve(candidate);
		if (excluded.has(resolved)) continue;
		try {
			fs.accessSync(resolved, fs.constants.X_OK);
			if (fs.statSync(resolved).isFile()) {
				if (name === "codex") {
					const codexHome = path.resolve(env.CODEX_HOME || path.join(os.homedir(), ".codex"));
					for (const directory of ["codex-hud", "codex-hub"]) try {
						const state = JSON.parse(fs.readFileSync(path.join(codexHome, directory, "install.json"), "utf8"));
						if (Array.isArray(state.managedFiles) && state.managedFiles.map((value) => path.resolve(String(value))).includes(resolved) && typeof state.realCodex === "string") {
							fs.accessSync(state.realCodex, fs.constants.X_OK);
							return path.resolve(state.realCodex);
						}
					} catch {}
				}
				return resolved;
			}
		} catch {}
	}
	return null;
}
function shellQuote(value) {
	if (value.length === 0) return "''";
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function shellCommand(command, args) {
	return [command, ...args].map(shellQuote).join(" ");
}

//#endregion
//#region src/commands/install.ts
const MANAGED_MARKER = "# Managed by Codex HUD";
const LEGACY_MANAGED_MARKER = "# Managed by Codex Hub";
function output(message) {
	process$1.stdout.write(`${message}\n`);
}
function statePath() {
	return path.join(getHudStateDirectory(), "install.json");
}
function readInstallState() {
	try {
		const state = JSON.parse(fs.readFileSync(statePath(), "utf8"));
		return state.version === 1 && Array.isArray(state.managedFiles) ? state : null;
	} catch {
		return null;
	}
}
function isManagedLauncher(filePath) {
	try {
		const content = fs.readFileSync(filePath, "utf8");
		return [MANAGED_MARKER, LEGACY_MANAGED_MARKER].some((marker) => content.startsWith(`#!/bin/sh\n${marker}\n`));
	} catch {
		return false;
	}
}
function binDirectory() {
	const explicit = process$1.env.CODEX_HUD_BIN_DIR || process$1.env.CODEX_HUB_BIN_DIR;
	return explicit ? path.resolve(explicit) : path.join(os.homedir(), ".local", "bin");
}
function migrateLegacyState(dryRun) {
	const legacy = getLegacyStateDirectory();
	const canonical = getHudStateDirectory();
	if (legacy === canonical || !fs.existsSync(legacy) || fs.existsSync(canonical)) return;
	if (dryRun) {
		output(`Would migrate ${legacy} -> ${canonical}`);
		return;
	}
	fs.cpSync(legacy, canonical, {
		recursive: true,
		preserveTimestamps: true
	});
}
function executablePaths() {
	const directory = path.dirname(process$1.argv[1]);
	return {
		cli: path.join(directory, "cli.mjs"),
		render: path.join(directory, "render-cli.mjs")
	};
}
function ensureManagedTarget(target, dryRun) {
	if (!fs.existsSync(target)) return;
	let managed = false;
	const state = readInstallState();
	managed = Boolean(state?.managedFiles.includes(target) && isManagedLauncher(target));
	if (!managed && !dryRun) throw new Error(`Refusing to overwrite unmanaged file: ${target}`);
}
function writeLauncher(target, source, dryRun, realCodex) {
	ensureManagedTarget(target, dryRun);
	if (dryRun) {
		output(`Would install ${target} -> ${source}`);
		return;
	}
	const realCodexExport = realCodex ? `export CODEX_HUD_CODEX_BIN=${shellQuote(realCodex)}\n` : "";
	const content = `#!/bin/sh\n${MANAGED_MARKER}\n${realCodexExport}exec /usr/bin/env node ${shellQuote(source)} "$@"\n`;
	fs.writeFileSync(target, content, {
		encoding: "utf8",
		mode: 493
	});
}
function runInstall(args) {
	const dryRun = args.includes("--dry-run");
	const installCodexShim = args.includes("--codex-shim");
	migrateLegacyState(dryRun);
	const directory = binDirectory();
	const paths = executablePaths();
	const realCodex = findExecutable("codex", process$1.env, [path.join(directory, "codex")]);
	if (!realCodex) throw new Error("Unable to find the real Codex executable before installing the shim.");
	const managedFiles = [path.join(directory, "codex-hud"), path.join(directory, "codex-hud-render")];
	if (installCodexShim) managedFiles.push(path.join(directory, "codex"));
	const legacyManagedFiles = [path.join(directory, "codex-hub"), path.join(directory, "codex-hub-render")];
	if (!dryRun) {
		fs.mkdirSync(directory, { recursive: true });
		fs.mkdirSync(getHudStateDirectory(), {
			recursive: true,
			mode: 448
		});
	}
	const previousState = readInstallState();
	writeLauncher(managedFiles[0], paths.cli, dryRun, realCodex);
	writeLauncher(managedFiles[1], paths.render, dryRun);
	if (installCodexShim) {
		const target = managedFiles[2];
		ensureManagedTarget(target, dryRun);
		if (dryRun) output(`Would install Codex shim ${target}`);
		else {
			const content = `#!/bin/sh\n${MANAGED_MARKER}\nexport CODEX_HUD_CODEX_BIN=${shellQuote(realCodex)}\nexec /usr/bin/env node ${shellQuote(paths.cli)} "$@"\n`;
			fs.writeFileSync(target, content, {
				encoding: "utf8",
				mode: 493
			});
		}
	}
	if (!dryRun) {
		for (const obsolete of previousState?.managedFiles ?? []) if (!managedFiles.includes(obsolete) && isManagedLauncher(obsolete)) fs.rmSync(obsolete, { force: true });
		for (const obsolete of legacyManagedFiles) if (isManagedLauncher(obsolete)) fs.rmSync(obsolete, { force: true });
		const state = {
			version: 1,
			realCodex,
			managedFiles
		};
		fs.writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, {
			encoding: "utf8",
			mode: 384
		});
		output(`Installed Codex HUD commands in ${directory}`);
	}
	return 0;
}
function runUninstall(args) {
	const dryRun = args.includes("--dry-run");
	let state;
	try {
		const loaded = readInstallState();
		if (!loaded) throw new Error("Missing or invalid install state");
		state = loaded;
	} catch {
		output("Codex HUD has no managed installation state.");
		return 0;
	}
	for (const filePath of state.managedFiles) if (dryRun) output(`Would remove ${filePath}`);
	else if (isManagedLauncher(filePath)) fs.rmSync(filePath, { force: true });
	else output(`Skipped modified or unmanaged file: ${filePath}`);
	if (!dryRun) {
		fs.rmSync(statePath(), { force: true });
		output("Removed Codex HUD managed launchers.");
	}
	return 0;
}

//#endregion
//#region src/runtime/command.ts
function resolveHubCommand(args) {
	return args[0] ?? "start";
}

//#endregion
//#region src/runtime/tmux.ts
function createTmuxRunner(env = process$1.env) {
	return { run(args, stdio = "pipe") {
		return spawnSync("tmux", args, {
			encoding: "utf8",
			env,
			stdio: stdio === "inherit" ? "inherit" : [
				"ignore",
				"pipe",
				"pipe"
			]
		});
	} };
}
function tmuxSessionName(cwd, launchIdentity = "") {
	const base = path.basename(cwd).replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "") || "project";
	const digest = createHash("sha1").update(path.resolve(cwd)).digest("hex").slice(0, 8);
	const launch = launchIdentity ? `-${createHash("sha1").update(launchIdentity).digest("hex").slice(0, 6)}` : "";
	return `codex-hud-${base.slice(0, 30)}-${digest}${launch}`;
}
function ensureSuccess(result, action) {
	if (result.status !== 0) throw new Error(`${action} failed: ${result.stderr || `exit ${String(result.status)}`}`);
}
function renderCommand(options) {
	const args = [
		"--max-old-space-size=64",
		"--max-semi-space-size=2",
		options.renderCliPath,
		"--cwd",
		options.cwd,
		"--launched-after",
		options.launchedAfter.toISOString(),
		"--session-binding",
		options.bindingPath,
		"--max-height",
		String(options.height)
	];
	if (options.sessionPath) args.push("--session", options.sessionPath);
	return shellCommand(process$1.execPath, args);
}
function launchInsideTmux(options, runner = createTmuxRunner(options.env)) {
	const targetPane = options.env?.TMUX_PANE ?? process$1.env.TMUX_PANE;
	const splitArgs = [
		"split-window",
		"-v",
		"-l",
		String(options.height),
		"-d",
		"-P",
		"-F",
		"#{pane_id}"
	];
	if (targetPane) splitArgs.push("-t", targetPane);
	splitArgs.push(renderCommand(options));
	const split = runner.run(splitArgs);
	ensureSuccess(split, "tmux split-window");
	return {
		sessionName: null,
		hudPaneId: split.stdout.trim() || null,
		exitCode: 0
	};
}
function launchNewTmuxSession(options, runner = createTmuxRunner(options.env)) {
	const sessionName = tmuxSessionName(options.cwd, `${options.launchedAfter.toISOString()}:${process$1.pid}`);
	const internalCommand = shellCommand(process$1.execPath, [
		options.cliPath,
		"__run-codex",
		"--tmux-session",
		sessionName,
		"--cwd",
		options.cwd,
		"--session-binding",
		options.bindingPath,
		...!options.detached ? ["--wait-for-client"] : [],
		"--",
		...options.codexArgs
	]);
	if (runner.run([
		"has-session",
		"-t",
		sessionName
	]).status === 0) runner.run([
		"kill-session",
		"-t",
		sessionName
	]);
	ensureSuccess(runner.run([
		"new-session",
		"-d",
		"-s",
		sessionName,
		"-c",
		options.cwd,
		internalCommand
	]), "tmux new-session");
	runner.run([
		"set-option",
		"-t",
		sessionName,
		"remain-on-exit",
		"off"
	]);
	runner.run([
		"set-option",
		"-t",
		sessionName,
		"pane-border-status",
		"off"
	]);
	runner.run([
		"set-option",
		"-t",
		sessionName,
		"status",
		"off"
	]);
	runner.run([
		"set-option",
		"-t",
		sessionName,
		"mouse",
		"on"
	]);
	const split = runner.run([
		"split-window",
		"-t",
		`${sessionName}:0`,
		"-v",
		"-l",
		String(options.height),
		"-d",
		"-c",
		options.cwd,
		"-P",
		"-F",
		"#{pane_id}",
		renderCommand(options)
	]);
	if (split.status !== 0) {
		runner.run([
			"kill-session",
			"-t",
			sessionName
		]);
		ensureSuccess(split, "tmux split-window");
	}
	runner.run([
		"select-pane",
		"-t",
		`${sessionName}:0.0`
	]);
	if (!options.detached) {
		const attached = runner.run([
			"attach-session",
			"-t",
			sessionName
		], "inherit");
		return {
			sessionName,
			hudPaneId: split.stdout.trim() || null,
			exitCode: attached.status ?? 1
		};
	}
	return {
		sessionName,
		hudPaneId: split.stdout.trim() || null,
		exitCode: 0
	};
}

//#endregion
//#region src/runtime/launcher.ts
const CODEX_OPTIONS_WITH_VALUES = /* @__PURE__ */ new Set([
	"-C",
	"-c",
	"-m",
	"-p",
	"--ask-for-approval",
	"--cd",
	"--config",
	"--model",
	"--profile",
	"--sandbox"
]);
function isResumeInvocation(args) {
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--") return false;
		if (CODEX_OPTIONS_WITH_VALUES.has(argument)) {
			index += 1;
			continue;
		}
		if (!argument.startsWith("-")) return argument === "resume";
	}
	return false;
}
function runtimePaths() {
	const modulePath = fileURLToPath(import.meta.url);
	const cliPath = modulePath.endsWith(".ts") ? path.resolve("dist/cli.mjs") : path.join(path.dirname(modulePath), "cli.mjs");
	return {
		cliPath,
		renderCliPath: path.join(path.dirname(cliPath), "render-cli.mjs")
	};
}
function launchCodex(options) {
	const env = options.env ?? process$1.env;
	const codex = findExecutable("codex", env);
	if (!codex) throw new Error("Codex executable not found. Install @openai/codex or set CODEX_HUD_CODEX_BIN.");
	const runDirect = () => {
		return {
			sessionName: null,
			hudPaneId: null,
			exitCode: spawnSync(codex, options.codexArgs, {
				cwd: options.cwd,
				env,
				stdio: "inherit"
			}).status ?? 1
		};
	};
	if (options.noHud) return runDirect();
	if (!findExecutable("tmux", env)) {
		process$1.stderr.write("Codex HUD: tmux is unavailable; starting Codex without the HUD.\n");
		return runDirect();
	}
	const paths = runtimePaths();
	const launchedAfter = /* @__PURE__ */ new Date();
	const bindingPath = createSessionBindingPath(options.cwd);
	const tmuxOptions = {
		cwd: options.cwd,
		cliPath: paths.cliPath,
		renderCliPath: paths.renderCliPath,
		codexArgs: options.codexArgs,
		height: options.height,
		detached: options.detached,
		launchedAfter,
		bindingPath,
		env
	};
	const runner = createTmuxRunner(env);
	try {
		if (env.TMUX) {
			const hud = launchInsideTmux(tmuxOptions, runner);
			const result = spawnSync(process$1.execPath, [
				paths.cliPath,
				"__run-codex",
				"--cwd",
				options.cwd,
				"--session-binding",
				bindingPath,
				"--",
				...options.codexArgs
			], {
				cwd: options.cwd,
				env,
				stdio: "inherit"
			});
			if (hud.hudPaneId) runner.run([
				"kill-pane",
				"-t",
				hud.hudPaneId
			]);
			return {
				...hud,
				exitCode: result.status ?? 1
			};
		}
		return launchNewTmuxSession(tmuxOptions, runner);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process$1.stderr.write(`Codex HUD: HUD startup failed (${message}); starting Codex directly.\n`);
		return runDirect();
	}
}
async function runCodexChild(args, sessionName, waitForClient = false, cwd = process$1.cwd(), bindingPath = null) {
	const codex = findExecutable("codex");
	if (!codex) return 127;
	if (waitForClient && sessionName && process$1.env.TMUX) waitForTmuxClient(sessionName);
	const release = bindingPath ? await acquireSessionDiscoveryLock(cwd) : null;
	const snapshot = bindingPath ? snapshotRootSessions(cwd) : null;
	const allowModifiedSession = isResumeInvocation(args);
	const child = spawn(codex, args, {
		cwd,
		stdio: "inherit",
		env: process$1.env
	});
	const discoveryController = new AbortController();
	let childExited = false;
	const exitCodePromise = new Promise((resolve) => {
		const finish = (code) => {
			childExited = true;
			discoveryController.abort();
			resolve(code);
		};
		child.once("error", () => finish(1));
		child.once("exit", (code) => finish(code ?? 1));
	});
	if (bindingPath && snapshot && release) try {
		let rolloutPath = await waitForNewRootSession(cwd, snapshot, void 0, void 0, discoveryController.signal, allowModifiedSession);
		if (!rolloutPath && childExited) rolloutPath = await waitForNewRootSession(cwd, snapshot, void 0, 250, void 0, allowModifiedSession);
		if (rolloutPath) writeSessionBinding(bindingPath, rolloutPath);
	} finally {
		release();
	}
	const exitCode = await exitCodePromise;
	if (sessionName && process$1.env.TMUX) spawn("tmux", [
		"kill-session",
		"-t",
		sessionName
	], {
		detached: true,
		stdio: "ignore"
	}).unref();
	return exitCode;
}
function defaultClientProbe(sessionName) {
	const result = spawnSync("tmux", [
		"display-message",
		"-p",
		"-t",
		sessionName,
		"#{session_attached}"
	], {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		]
	});
	return result.status === 0 ? Number.parseInt(result.stdout.trim(), 10) || 0 : 0;
}
function waitForTmuxClient(sessionName, timeoutMs = 3e4, probe = defaultClientProbe, pause = (milliseconds) => {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}) {
	const deadline = Date.now() + timeoutMs;
	do {
		if (probe(sessionName) > 0) return true;
		pause(50);
	} while (Date.now() < deadline);
	return false;
}

//#endregion
//#region src/runtime/passthrough.ts
const NON_INTERACTIVE_COMMANDS = /* @__PURE__ */ new Set([
	"app-server",
	"app",
	"apply",
	"cloud",
	"completion",
	"debug",
	"exec",
	"features",
	"login",
	"logout",
	"mcp",
	"mcp-server",
	"plugin",
	"review",
	"sandbox"
]);
const OPTIONS_WITH_VALUES = /* @__PURE__ */ new Set([
	"-C",
	"-c",
	"-m",
	"-p",
	"--ask-for-approval",
	"--cd",
	"--config",
	"--model",
	"--profile",
	"--sandbox"
]);
function shouldBypassHud(args) {
	if (args.some((argument) => argument === "--version" || argument === "-V" || argument === "--help" || argument === "-h")) return true;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--") return false;
		if (OPTIONS_WITH_VALUES.has(argument)) {
			index += 1;
			continue;
		}
		if (argument.startsWith("-")) continue;
		return NON_INTERACTIVE_COMMANDS.has(argument);
	}
	return false;
}

//#endregion
//#region src/cli.ts
function printHelp() {
	console.log(`Codex HUD

Usage:
  codex-hud [start] [HUD options] [--] [codex arguments]
  codex-hud render [--once] [--cwd <path>] [--no-color]
  codex-hud doctor [--json]
  codex-hud configure [--preset full|essential|minimal] [--language en|zh-Hans|zh-Hant]
  codex-hud install [--codex-shim] [--dry-run]
  codex-hud uninstall [--dry-run]
  codex-hud --help

HUD options:
  --cwd <path>       Working directory for Codex and the HUD
  --hud-height <n>   HUD pane maximum height (default: 5)
  --detach           Start the tmux session without attaching
  --no-hud           Run Codex directly without tmux`);
}
function installedPluginManifest() {
	const root = path.join(getCodexHome(), "plugins", "cache");
	try {
		const matches = [];
		const visit = (directory, depth) => {
			if (depth > 5) return;
			for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
				const entryPath = path.join(directory, entry.name);
				if (entry.isDirectory()) visit(entryPath, depth + 1);
				else if (entry.name === "plugin.json" && entryPath.includes(`${path.sep}codex-hud${path.sep}`)) matches.push(entryPath);
			}
		};
		visit(root, 0);
		return matches.sort().at(-1) ?? null;
	} catch {
		return null;
	}
}
function startOptions(args) {
	let cwd = process$1.cwd();
	let height = Number(process$1.env.CODEX_HUD_HEIGHT) || 5;
	let detached = false;
	let noHud = false;
	const codexArgs = [];
	let passthrough = false;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (passthrough) codexArgs.push(argument);
		else if (argument === "--") passthrough = true;
		else if ((argument === "--cwd" || argument === "-C") && args[index + 1]) {
			cwd = args[++index];
			codexArgs.push("-C", cwd);
		} else if (argument === "--hud-height" && args[index + 1]) height = Math.max(5, Math.min(30, Number(args[++index]) || 5));
		else if (argument === "--detach") detached = true;
		else if (argument === "--no-hud") noHud = true;
		else codexArgs.push(argument);
	}
	if (shouldBypassHud(args)) noHud = true;
	return {
		cwd,
		height,
		detached,
		noHud,
		codexArgs
	};
}
async function main(args = process$1.argv.slice(2)) {
	const command = resolveHubCommand(args);
	if (command === "__run-codex") {
		const separator = args.indexOf("--");
		const sessionIndex = args.indexOf("--tmux-session");
		const sessionName = sessionIndex >= 0 ? args[sessionIndex + 1] : null;
		const waitForClient = args.includes("--wait-for-client");
		const cwdIndex = args.indexOf("--cwd");
		const cwd = cwdIndex >= 0 && args[cwdIndex + 1] ? args[cwdIndex + 1] : process$1.cwd();
		const bindingIndex = args.indexOf("--session-binding");
		const bindingPath = bindingIndex >= 0 ? args[bindingIndex + 1] : null;
		process$1.exitCode = await runCodexChild(separator >= 0 ? args.slice(separator + 1) : [], sessionName, waitForClient, cwd, bindingPath);
		return;
	}
	if (command === "render") {
		const { runRenderCli } = await import("./render-cli.mjs");
		await runRenderCli(args.slice(1));
		return;
	}
	if (command === "doctor") {
		const cwdIndex = args.indexOf("--cwd");
		const cwd = cwdIndex >= 0 && args[cwdIndex + 1] ? args[cwdIndex + 1] : process$1.cwd();
		const session = findActiveSession({ cwd });
		const config = loadConfig();
		const parser = new RolloutParser();
		parser.setFile(session?.path ?? null);
		const parsed = parser.parse();
		const pluginManifest = installedPluginManifest();
		const installState = path.join(getHudStateDirectory(), "install.json");
		const codex = findExecutable("codex");
		const cliPath = path.resolve(process$1.argv[1]);
		const report = {
			node: process$1.version,
			codex,
			tmux: findExecutable("tmux"),
			cwd,
			configPath: getConfigPath(),
			configValid: config.error === null,
			configError: config.error?.message ?? null,
			activeSession: session?.path ?? null,
			sessionId: session?.sessionId ?? null,
			sessionParsed: parsed.session?.id === session?.sessionId,
			model: parsed.session?.model ?? null,
			pluginManifest,
			pluginInstalled: Boolean(pluginManifest),
			managedInstall: fs.existsSync(installState),
			terminal: {
				tty: Boolean(process$1.stdout.isTTY),
				color: !process$1.env.NO_COLOR,
				columns: process$1.stdout.columns ?? null,
				rows: process$1.stdout.rows ?? null
			},
			shimRecursion: codex === cliPath
		};
		if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
		else {
			console.log(`Node: ${report.node}`);
			console.log(`Codex: ${report.codex ?? "not found"}`);
			console.log(`tmux: ${report.tmux ?? "not found"}`);
			console.log(`Config: ${report.configPath}`);
			console.log(`Session: ${report.activeSession ?? "not found"}`);
			console.log(`Plugin: ${report.pluginManifest ?? "not installed"}`);
			console.log(`Session parse: ${report.sessionParsed ? "ok" : "not ready"}`);
			if (report.shimRecursion) console.log("Warning: Codex executable resolves to the Hub CLI itself.");
		}
		return;
	}
	if (command === "configure") {
		process$1.exitCode = await runConfigure(args.slice(1));
		return;
	}
	if (command === "install") {
		process$1.exitCode = runInstall(args.slice(1));
		return;
	}
	if (command === "uninstall") {
		process$1.exitCode = runUninstall(args.slice(1));
		return;
	}
	if (command === "help" || command === "--help" || command === "-h") {
		printHelp();
		return;
	}
	const options = startOptions(command === "start" ? args.slice(1) : args);
	const launched = launchCodex(options);
	if (options.detached && launched.sessionName) console.log(`Codex HUD started in tmux session ${launched.sessionName}`);
	process$1.exitCode = launched.exitCode;
}
main().catch((error) => {
	console.error(error);
	process$1.exitCode = 1;
});

//#endregion
export {  };
//# sourceMappingURL=cli.mjs.map
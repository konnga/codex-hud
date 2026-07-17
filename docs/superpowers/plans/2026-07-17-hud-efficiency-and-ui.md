# HUD Efficiency and UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make Codex HUD fail-open and non-interfering, automatically fit the HUD pane to rendered content, reduce steady-state resource use, and improve information hierarchy and localization.

**Architecture:** Keep the official Codex child as the primary process and treat every HUD/tmux operation as optional decoration. Add a pure pane-height calculation plus a renderer-side tmux resize controller, introduce TTL/mtime caches around expensive collectors, and revise the Full preset and render lines so actionable data is prominent while diagnostics remain opt-in.

**Tech Stack:** Node.js 20+, TypeScript, tmux, Codex rollout JSONL, pnpm 10, Vitest, tsdown.

---

The workspace is not a Git repository, so each task ends with a verification checkpoint instead of a commit.

## Task 1: Make HUD launch fail-open

**Files:**

- Modify: `src/runtime/launcher.ts`
- Modify: `src/runtime/tmux.ts`
- Modify: `src/runtime/passthrough.ts`
- Test: `src/runtime/launcher.test.ts`
- Test: `src/runtime/tmux.test.ts`
- Test: `src/runtime/passthrough.test.ts`

- [x] **Step 1: Write failing tests** proving missing tmux, failed split, and failed HUD session creation fall back to the official Codex binary; add `codex app` to transparent passthrough.
- [x] **Step 2: Run `pnpm vitest run src/runtime`** and confirm the new assertions fail.
- [x] **Step 3: Implement fail-open launch** so only a missing official Codex binary remains fatal; clean up only Hub-owned tmux state before direct fallback.
- [x] **Step 4: Re-run runtime tests** and confirm Codex arguments and exit codes are unchanged in every fallback path.

## Task 2: Auto-fit the tmux pane

**Files:**

- Create: `src/runtime/pane-size.ts`
- Test: `src/runtime/pane-size.test.ts`
- Modify: `src/render-cli.ts`
- Modify: `src/runtime/tmux.ts`

- [x] **Step 1: Write failing pure-function tests** for desired height: exact content height, minimum 2, configured maximum, unchanged-height suppression, and non-tmux no-op.
- [x] **Step 2: Run the focused test** and confirm it fails before implementation.
- [x] **Step 3: Render against the configured maximum height**, calculate the visible content height, and resize only the HUD's own pane through `tmux resize-pane -y` when the desired height changes.
- [x] **Step 4: Pass `--max-height` from the launcher** and hide the tmux status bar only for Hub-owned sessions.
- [x] **Step 5: Verify the screenshot scenario** produces a seven-row pane instead of twelve rows and can grow again when agent/tool lines appear.

## Task 3: Reduce steady-state resource consumption

**Files:**

- Modify: `src/render-cli.ts`
- Modify: `src/collectors/project.ts`
- Modify: `src/collectors/agents.ts`
- Modify: `src/collectors/session-metadata.ts`
- Modify: `src/collectors/git.ts`
- Test: `src/collectors/project.test.ts`
- Test: `src/collectors/agents.test.ts`
- Test: `src/collectors/session-metadata.test.ts`

- [x] **Step 1: Add cache-behavior tests** showing unchanged project metadata, auth, titles, Git, and agent rollout files are not rescanned or reparsed every render.
- [x] **Step 2: Add TTL/mtime caches**: project metadata 30 seconds, auth 30 seconds, session title 30 seconds, Git 2 seconds, and per-agent rollout parsing keyed by path plus mtime/size.
- [x] **Step 3: Stop reloading config every second**; rely on `fs.watch` and use a ten-second safety mtime check.
- [x] **Step 4: Keep rollout updates event-driven** with a one-second safety parse, debounce watcher bursts, and ensure only visible opt-in collectors run.
- [x] **Step 5: Compare renderer RSS and CPU/I/O activity** before and after using an idle 30-second smoke session.

## Task 4: Improve visual hierarchy and defaults

**Files:**

- Modify: `src/config/presets.ts`
- Modify: `src/render/i18n.ts`
- Modify: `src/render/environment-line.ts`
- Modify: `src/render/activity-lines.ts`
- Modify: `src/render/session-line.ts`
- Modify: `src/render/index.ts`
- Test: `src/render/index.test.ts`
- Test: `src/render/__snapshots__/index.test.ts.snap`

- [x] **Step 1: Add snapshots** for the screenshot-width Full layout, a quiet session, an active-tool session, and Chinese labels.
- [x] **Step 2: Make Full useful rather than exhaustive by default**: keep model/project/context/quota/tools/agents/todos/goal/duration, while memory, config counts, session start, session ID, and detailed token totals remain opt-in diagnostics.
- [x] **Step 3: Localize operational labels** such as approval, sandbox, mode, started, last response, input/cache/output, and expiry.
- [x] **Step 4: Bound noisy text** using width-aware goal/tool/session truncation, suppress zero-value environment fields, and reject implausible output-speed samples.
- [x] **Step 5: Update the active user config** to the refined Full defaults while preserving colors, thresholds, paths, and manual overrides unrelated to display density.

## Task 5: Release and real-terminal verification

**Files:**

- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `CHANGELOG.md`
- Modify: `plugins/codex-hud/.codex-plugin/plugin.json` through the cachebuster helper

- [x] **Step 1: Run `pnpm lint --fix`, `pnpm typecheck`, `pnpm test`, and `pnpm build`** with all checks passing.
- [x] **Step 2: Validate the plugin and skills**, update the cachebuster with the official helper, and reinstall from the existing personal marketplace.
- [x] **Step 3: Launch real Codex with no arguments** and verify normal input, shortcuts, subcommands, exit behavior, and exit code remain intact.
- [x] **Step 4: Measure the idle HUD pane**: no blank rows, no orphan tmux sessions, lower steady-state I/O, and stable RSS.
- [x] **Step 5: Update every checkbox in this plan** only after the real smoke test passes.

# Codex HUD Session Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan inline with Vitest red-green verification. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind every managed Codex HUD instance to the rollout created by its own Codex process so simultaneous sessions in one directory cannot exchange HUD data.

**Architecture:** Give each launch a unique binding file. The Codex child wrapper serializes only the short rollout-discovery phase per working directory, snapshots existing root sessions, starts official Codex, writes the newly created rollout path to the binding file, and then releases the discovery lock. The renderer reads that binding once and permanently fixes its parser to that rollout; if binding fails, it displays no foreign session data.

**Tech Stack:** TypeScript, Node.js child processes and filesystem primitives, tmux, pnpm, Vitest.

---

## Task 1: Test unique session discovery

**Files:**

- Create: `src/runtime/session-binding.ts`
- Create: `src/runtime/session-binding.test.ts`
- Modify: `src/codex/session-finder.ts`

- [ ] Add a test with two existing sessions and one newly created session in the same directory.
- [ ] Assert discovery returns only a rollout absent from the pre-launch snapshot.
- [ ] Add exact-working-directory filtering for root sessions used by launch binding.

## Task 2: Pass a unique binding through tmux

**Files:**

- Modify: `src/runtime/launcher.ts`
- Modify: `src/runtime/tmux.ts`
- Modify: `src/cli.ts`
- Test: `src/runtime/launcher.test.ts`
- Test: `src/runtime/tmux.test.ts`

- [ ] Generate one binding path for each HUD launch.
- [ ] Pass the path and working directory to the internal Codex child command.
- [ ] Start Codex through the same child wrapper both inside an existing tmux client and in a new tmux session.
- [ ] Preserve official Codex arguments, terminal I/O, exit status, fail-open behavior, and wait-for-client startup ordering.

## Task 3: Lock the renderer to the binding

**Files:**

- Modify: `src/render-cli.ts`
- Test: `src/runtime/tmux.test.ts`

- [ ] Add `--session-binding <path>` parsing.
- [ ] Poll only the launch binding until it contains a valid rollout path.
- [ ] Permanently set the parser to that path and never call directory-based active-session discovery for managed launches.
- [ ] Leave the HUD unbound instead of showing another session when binding is unavailable.

## Task 4: Validate and install

**Files:**

- Generated: `dist/`
- Generated: `plugins/codex-hud/runtime/`
- Updated by helper: `plugins/codex-hud/.codex-plugin/plugin.json`

- [ ] Run focused Vitest tests, the full test suite, lint, typecheck, and build.
- [ ] Update the plugin cachebuster, read the marketplace name, validate the plugin, and reinstall `codex-hud@personal`.
- [ ] Reinstall managed commands and verify `codex --version` plus `codex-hud doctor --json`.

# Codex HUD Scroll, Isolation, and Emoji Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute inline with Vitest regression tests and snapshot review before reinstalling the plugin.

**Goal:** Restore terminal scrollback behavior, prevent ordinary new sessions from binding old same-directory rollouts, and add consistent emoji icons to the HUD.

**Architecture:** Enable tmux mouse handling only for sessions created and owned by Codex HUD. Distinguish new launches from resume launches during rollout discovery, allowing modified existing files only for resume. Add emoji at the rendering-label layer so language translations and ANSI coloring remain intact.

**Tech Stack:** TypeScript, tmux, pnpm, Vitest, snapshot tests, Codex plugin runtime.

---

## Task 1: Restore scrollback

**Files:**

- Modify: `src/runtime/tmux.ts`
- Modify: `src/runtime/tmux.test.ts`

- [ ] Assert newly created Codex HUD tmux sessions enable `mouse on`.
- [ ] Do not change mouse settings when splitting inside a user-owned tmux session.

## Task 2: Separate new and resumed sessions

**Files:**

- Modify: `src/runtime/session-binding.ts`
- Modify: `src/runtime/launcher.ts`
- Modify: `src/runtime/session-binding.test.ts`
- Modify: `src/runtime/launcher.test.ts`

- [ ] Make new launches accept only rollout paths absent from the pre-launch snapshot.
- [ ] Allow modified existing rollouts only for `codex resume` invocations.
- [ ] Test that an active old session cannot win before the new rollout appears.

## Task 3: Add emoji icons

**Files:**

- Modify: `src/render/i18n.ts`
- Modify: `src/render/*.ts` as needed
- Modify: `src/render/__snapshots__/index.test.ts.snap`

- [ ] Add consistent emoji icons for context, usage, cache, environment, tools, agents, todos, goals, and session information.
- [ ] Preserve terminal-width calculations and review compact and expanded snapshots.

## Task 4: Validate and reinstall

**Files:**

- Generated: `dist/`
- Generated: `plugins/codex-hud/runtime/`
- Updated by helper: `plugins/codex-hud/.codex-plugin/plugin.json`

- [ ] Run focused tests, full tests, lint, typecheck, and build.
- [ ] Update cachebuster, validate, reinstall plugin and managed launchers.

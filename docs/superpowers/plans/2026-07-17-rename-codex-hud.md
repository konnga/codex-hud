# Codex HUD Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan inline and verify each migration boundary before updating the installed launchers.

**Goal:** Rename the project, CLI, plugin, configuration namespace, and user-facing product identity from `codex-hud` to `codex-hud` without breaking the official Codex CLI or losing existing local configuration.

**Architecture:** Make `codex-hud` the canonical identity everywhere. Preserve read-only compatibility for the former `CODEX_HUD_*` environment variables and migrate the former state directory during installation, while replacing managed `codex-hud` launchers with `codex-hud` launchers.

**Tech Stack:** TypeScript, Node.js, pnpm, Vitest, tsdown, Codex local plugins, tmux.

---

## Task 1: Rename canonical project and plugin identities

**Files:**

- Rename: project root `codex-hud/` to `codex-hud/`
- Rename: `plugins/codex-hud/` to `plugins/codex-hud/`
- Modify: package metadata, plugin manifest, marketplace metadata, runtime sync script, docs, Skills, snapshots, and fixtures

- [ ] Replace canonical command names and product copy with `codex-hud` / Codex HUD.
- [ ] Keep HUD terminology for the tmux display pane and remove Hub as the product name.

## Task 2: Add safe local migration

**Files:**

- Modify: `src/config/constants.ts`
- Modify: `src/config/paths.ts`
- Modify: `src/runtime/process.ts`
- Modify: `src/commands/install.ts`
- Test: related config, process, and installer tests

- [ ] Store new state in `${CODEX_HOME}/codex-hud`.
- [ ] Read legacy `CODEX_HUD_*` variables only as fallbacks to new `CODEX_HUD_*` variables.
- [ ] On install, migrate existing configuration and managed-launcher state without overwriting unmanaged files.
- [ ] Remove obsolete managed `codex-hud` and `codex-hud-render` launchers.

## Task 3: Verify and reinstall

**Files:**

- Generated: `dist/`
- Generated: `plugins/codex-hud/runtime/`
- Updated by helper: `plugins/codex-hud/.codex-plugin/plugin.json`

- [ ] Run lint, typecheck, tests, and build with pnpm.
- [ ] Validate the renamed plugin.
- [ ] Update the plugin cachebuster and reinstall `codex-hud` from the local marketplace.
- [ ] Install the `codex-hud` commands and optional `codex` shim, then verify command resolution and passthrough.

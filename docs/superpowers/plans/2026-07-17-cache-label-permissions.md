# Cache Label and Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute inline with Vitest and snapshot validation before reinstalling the plugin.

**Goal:** Clarify the cache countdown, remove second-level noise, and show the current Codex session permission profile.

**Architecture:** Rename the localized cache label at the i18n layer, format its remaining TTL at minute granularity, and extend the environment permission segment to render rollout `permission_profile` independently from approval and sandbox settings.

**Tech Stack:** TypeScript, Codex rollout JSONL, pnpm, Vitest, snapshot tests.

---

## Task 1: Improve cache TTL display

**Files:**

- Modify: `src/render/i18n.ts`
- Modify: `src/render/prompt-cache-line.ts`
- Modify: related tests and snapshots

- [ ] Rename English to `Cache TTL`, Simplified Chinese to `缓存有效期`, and Traditional Chinese to `快取有效期`.
- [ ] Render only minutes and hours, with `<1m` for a positive remainder below one minute.

## Task 2: Show Permissions

**Files:**

- Modify: `src/types/config.ts`
- Modify: `src/config/presets.ts`
- Modify: `src/config/validate.ts`
- Modify: `src/render/environment-line.ts`
- Modify: related tests and snapshots

- [ ] Add a `showPermissionProfile` display toggle.
- [ ] Enable it in Full and Essential presets.
- [ ] Render the current session `permissionProfile` with a localized Permissions label.

## Task 3: Validate and reinstall

**Files:**

- Generated: `dist/`
- Generated: `plugins/codex-hud/runtime/`
- Updated by helper: `plugins/codex-hud/.codex-plugin/plugin.json`

- [ ] Run lint, typecheck, full tests, build, plugin validation, cachebuster update, reinstall, and preview.

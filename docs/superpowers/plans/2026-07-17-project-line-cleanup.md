# Project Line Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default HUD identity line show the model, visually attach Git status to the project name without a vertical separator, and omit the Full preset session title from the default presentation.

**Architecture:** Keep the existing project-line renderer and configuration schema. Change only how the project and Git segments are grouped, adjust the Full preset's visible defaults, and update renderer snapshots and README previews to match the resulting output.

**Tech Stack:** TypeScript, Vitest snapshots, tsdown, Markdown

---

## Task 1: Lock the desired identity-line behavior in tests

**Files:**

- Modify: `src/render/index.test.ts`
- Modify: `src/config/load.test.ts`
- Modify: `src/types/config.test.ts`

- [x] **Step 1: Add renderer assertions for project/Git grouping and model visibility**

In the Full renderer test, assert that the first line contains `[gpt-5.5 high]` and `codex-hud +shared git:(main* ↑1)`, and does not contain `+shared │ git:` or `HUD fidelity audit`.

- [x] **Step 2: Add preset and default assertions**

Assert that `DEFAULT_CONFIG.display.showModel` is `true`, `createPreset('full').display.showModel` is `true`, and `createPreset('full').display.showSessionName` is `false`.

- [x] **Step 3: Run focused tests and confirm they fail before implementation**

Run:

```bash
pnpm vitest run src/render/index.test.ts src/config/load.test.ts src/types/config.test.ts
```

Expected: the project/Git grouping and Full session-title assertions fail against the current implementation.

## Task 2: Implement the identity-line and Full preset changes

**Files:**

- Modify: `src/render/project-line.ts`
- Modify: `src/config/presets.ts`

- [x] **Step 1: Group project and Git into one visual segment**

Build the project label and Git label separately, combine them with a single space when both exist, then join that combined segment to model/auth fields with `│`. Preserve the existing `branchOverflow: 'wrap'` behavior by moving only the Git label to the next line when the completed line exceeds the terminal width.

- [x] **Step 2: Remove session titles from the Full preset**

Set `showSessionName: false` in `createPreset('full')`. Keep `DEFAULT_CONFIG.display.showModel: true`, and explicitly preserve model visibility in the Full preset.

- [x] **Step 3: Run focused tests**

Run:

```bash
pnpm vitest run src/render/index.test.ts src/config/load.test.ts src/types/config.test.ts
```

Expected: all focused tests pass and the renderer snapshot is the only expected snapshot change.

## Task 3: Update documentation previews and generated runtime

**Files:**

- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `src/render/__snapshots__/index.test.ts.snap`
- Modify generated output under: `dist/`
- Modify generated output under: `plugins/codex-hud/runtime/`

- [x] **Step 1: Update both README previews**

Show `[gpt-5.5 high] │ codex-hud +shared git:(main* ↑1) │ ChatGPT pro (builder)` and remove the synthetic `HUD fidelity audit` / `HUD 完整展示` session-title segment.

- [x] **Step 2: Update the renderer snapshot**

Regenerate or edit the snapshot so its first line matches the new project/Git grouping and omitted Full session title.

- [x] **Step 3: Run the full verification suite**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: every command exits successfully; the build synchronizes the updated runtime into the plugin bundle.

- [ ] **Step 4: Commit the completed change if requested**

```bash
git add README.md README.zh.md src docs/superpowers/plans/2026-07-17-project-line-cleanup.md dist plugins/codex-hud/runtime
git commit -m "fix: simplify the default HUD identity line"
```

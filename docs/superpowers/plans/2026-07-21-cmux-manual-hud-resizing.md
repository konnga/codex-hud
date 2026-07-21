# cmux Manual HUD Resizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag the cmux HUD divider without the renderer fighting the manual height or causing resize jitter.

**Architecture:** Keep content-fitted automatic sizing while the HUD owns the pane height. Track the last height successfully requested by Codex HUD; when a cmux `SIGWINCH` reports a different row count, treat that as external/manual ownership and permanently stop issuing automatic resize commands for that HUD process. Continue rendering against the actual viewport so smaller panes clip and larger panes remain stable.

**Tech Stack:** TypeScript, Node.js terminal signals, cmux directional resize API, Vitest.

---

## Task 1: Add pane ownership tests

**Files:**

- Modify: `src/runtime/pane-size.test.ts`

- [ ] **Step 1: Test unchanged automatic height suppression**

Call `resizeCmuxPane` with `previousHeight === desiredHeight` and a different current viewport. Assert no cmux command is issued because the renderer already owns that desired height.

- [ ] **Step 2: Test manual resize detection**

Add tests for a helper that returns true only when a valid current row count differs from the last HUD-managed height. Cover equal height, changed height, missing height, and invalid row counts.

- [ ] **Step 3: Run the focused test**

Run: `pnpm vitest run src/runtime/pane-size.test.ts`

Expected: FAIL because unchanged cmux requests are not suppressed and manual resize detection does not exist.

## Task 2: Hand height ownership to the user

**Files:**

- Modify: `src/runtime/pane-size.ts`
- Modify: `src/render-cli.ts`

- [ ] **Step 1: Suppress repeated managed resize commands**

Return the previous height before invoking cmux when `previousHeight === desiredHeight`.

- [ ] **Step 2: Detect an external cmux viewport change**

On `SIGWINCH`, compare `process.stdout.rows` with the last HUD-managed height. If they differ, set a per-renderer manual-height flag.

- [ ] **Step 3: Stop resizing after manual ownership**

When the manual-height flag is active, skip `resizeCmuxPane` but continue rendering using the current terminal dimensions. Do not disable normal redraws or conversation navigation.

- [ ] **Step 4: Run focused tests**

Run: `pnpm vitest run src/runtime/pane-size.test.ts src/runtime/cmux.test.ts`

Expected: PASS.

## Task 3: Document and validate

**Files:**

- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `README.zh.md`
- Generated: `plugins/codex-hud/runtime/**`

- [ ] **Step 1: Document the behavior**

State that cmux starts with content-fitted sizing, but dragging the divider transfers height control to the user for the remainder of that HUD session.

- [ ] **Step 2: Run complete verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm release:check
git diff --check
```

Expected: all commands pass.

- [ ] **Step 3: Reinstall and smoke test**

Install the built runtime with `node dist/cli.mjs install --codex-shim`, verify the stable launcher, and start a new Codex session for manual cmux divider testing.

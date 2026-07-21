# cmux HUD Pane Lifecycle Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent cmux 0.64.20 sessions from accumulating duplicate Codex HUD splits when a launcher is restarted or terminated before normal cleanup.

**Architecture:** Add a per-source-surface ownership record under the existing Codex HUD state directory. Before creating a new cmux HUD, close any previously recorded surface for that same workspace/source surface; after creation, atomically record the new surface. Wrap launcher cleanup in signal-aware, idempotent lifecycle handling so normal exits and SIGINT/SIGTERM/SIGHUP all close the owned surface and remove only the matching ownership record.

**Tech Stack:** TypeScript, Node.js process/filesystem APIs, cmux CLI, Vitest.

---

## Task 1: Add failing ownership and cleanup tests

**Files:**

- Modify: `src/runtime/cmux.test.ts`
- Modify: `src/runtime/launcher.test.ts`

- [ ] **Step 1: Test stale ownership replacement**

Create a temporary `CODEX_HOME`, prewrite an ownership record for the same workspace/source surface, launch a new HUD with a recording runner, and assert that `close-surface` for the old surface happens before `new-split`.

- [ ] **Step 2: Test matching ownership cleanup**

Close the new HUD handle and assert that its ownership record is removed. Replace the record with a different surface ID first and assert cleanup preserves the newer record.

- [ ] **Step 3: Test signal-aware cleanup**

Use a fake signal target to trigger `SIGTERM`; assert cleanup runs once, handlers are removed, and the signal is re-delivered after cleanup.

- [ ] **Step 4: Run focused tests and verify failure**

Run: `pnpm vitest run src/runtime/cmux.test.ts src/runtime/launcher.test.ts`

Expected: FAIL because ownership and termination cleanup helpers do not exist yet.

## Task 2: Implement cmux surface ownership

**Files:**

- Modify: `src/runtime/cmux.ts`
- Modify: `src/runtime/cmux.test.ts`

- [ ] **Step 1: Define ownership metadata**

Add workspace ID, source surface ID, HUD pane ID, HUD surface ID, and owner PID to the handle/record shape. Derive a stable filename from workspace and source-surface IDs under `${CODEX_HOME}/codex-hud/cmux`.

- [ ] **Step 2: Replace a previously owned surface**

Before `new-split`, read the ownership record. If it matches the current workspace and source surface, issue:

```text
cmux close-surface --workspace <workspace> --surface <old-surface>
```

Then remove the old record regardless of whether cmux reports that the already-stale surface is gone.

- [ ] **Step 3: Record the new surface atomically**

After renderer startup succeeds, write the record through a PID-scoped temporary file and rename it into place with private directory/file permissions.

- [ ] **Step 4: Make close idempotent and ownership-safe**

`closeCmuxHud` must always attempt to close the surface, but remove the record only when it still names that exact surface, so an older launcher cannot erase a newer launch's ownership.

- [ ] **Step 5: Run focused cmux tests**

Run: `pnpm vitest run src/runtime/cmux.test.ts`

Expected: PASS.

## Task 3: Add signal-aware launcher cleanup

**Files:**

- Modify: `src/runtime/launcher.ts`
- Modify: `src/runtime/launcher.test.ts`

- [ ] **Step 1: Add an injectable termination cleanup helper**

Register one-time handlers for `SIGINT`, `SIGTERM`, and `SIGHUP`. On a signal, execute cleanup once, unregister all handlers, then re-deliver the original signal so Node retains normal signal exit semantics.

- [ ] **Step 2: Install it around the cmux Codex child lifecycle**

Immediately after `launchCmuxHud`, create one idempotent cleanup closure that closes the cmux surface and removes the session binding. Install signal handlers before awaiting Codex. In `finally`, unregister the handlers and invoke the same cleanup closure.

- [ ] **Step 3: Run focused launcher tests**

Run: `pnpm vitest run src/runtime/launcher.test.ts`

Expected: PASS.

## Task 4: Build and regression verification

**Files:**

- Generated: `plugins/codex-hud/runtime/**`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document the fix**

Add an Unreleased fix noting that cmux HUD ownership and signal cleanup prevent duplicate/stale splits after launcher restarts.

- [ ] **Step 2: Run all checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all commands pass.

- [ ] **Step 3: Verify generated runtime**

Run: `git status --short`

Expected: source, tests, changelog, plan, and synchronized plugin runtime are the only intended changes.

# Stable Managed Runtime Installation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep managed Codex HUD launchers working after Codex plugin cache upgrades or cleanup.

**Architecture:** During setup/install, copy the complete bundled runtime directory into `${CODEX_HOME}/codex-hud/runtime` through a staging directory, then point all managed launchers at that stable copy. Preserve the existing real-Codex resolution and unmanaged-file protections. On uninstall, remove only the recorded managed runtime directory while retaining configuration.

**Tech Stack:** TypeScript, Node.js filesystem APIs, POSIX launchers, Vitest.

---

## Task 1: Add stable-runtime installer tests

**Files:**

- Modify: `src/commands/install.test.ts`

- [ ] **Step 1: Create an isolated runtime fixture**

Create a temporary source directory containing `cli.mjs`, `render-cli.mjs`, and a shared chunk. Expose it to the installer with `CODEX_HUD_RUNTIME_DIR`.

- [ ] **Step 2: Assert launcher stability**

Run `runInstall(['--codex-shim'])`, then assert all launchers reference `${CODEX_HOME}/codex-hud/runtime` instead of the source directory. Delete the source directory and execute the installed `codex --no-hud --version`; it must still succeed through the copied runtime.

- [ ] **Step 3: Assert runtime replacement**

Change the source runtime contents, rerun install, and assert the stable runtime contains the new files while obsolete files from the previous copy are removed.

- [ ] **Step 4: Assert uninstall cleanup**

Run uninstall and assert the managed runtime directory is removed while `config.json` remains.

- [ ] **Step 5: Run the focused test**

Run: `pnpm vitest run src/commands/install.test.ts`

Expected: FAIL because launchers still reference the source plugin cache.

## Task 2: Deploy the runtime into stable state

**Files:**

- Modify: `src/commands/install.ts`
- Modify: `src/commands/install.test.ts`

- [ ] **Step 1: Resolve source and target runtime directories**

Use `CODEX_HUD_RUNTIME_DIR` when set; otherwise use the directory containing the executing `cli.mjs`. Use `${getHudStateDirectory()}/runtime` as the managed target.

- [ ] **Step 2: Copy with staging and replacement**

Copy the entire source directory to a PID-scoped staging directory, verify both entrypoints exist, move the old target aside, rename staging into place, and restore the old target if replacement fails.

- [ ] **Step 3: Point launchers at the stable entrypoints**

Generate `codex-hud`, `codex-hud-render`, and the optional `codex` shim using the target runtime paths.

- [ ] **Step 4: Record and remove the managed runtime**

Store `runtimeDirectory` in `install.json`. During uninstall, remove only that recorded directory after processing managed launcher files.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run src/commands/install.test.ts src/commands/setup.test.ts`

Expected: PASS.

## Task 3: Document and validate

**Files:**

- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `README.zh.md`
- Generated: `plugins/codex-hud/runtime/**`

- [ ] **Step 1: Document stable launcher behavior**

Explain that setup copies runtime into the Codex HUD state directory so plugin cache cleanup cannot break managed commands.

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

- [ ] **Step 3: Inspect intended changes**

Run: `git status --short`

Expected: the prior cmux lifecycle fix plus installer, tests, documentation, this plan, and synchronized plugin runtime changes.

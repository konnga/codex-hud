# Interactive Configure Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `$codex-hud:configure` workflow that lets users inspect and selectively enable or disable HUD elements, then applies the result to the current running HUD without resetting unrelated settings.

**Architecture:** Keep the existing atomic JSON config and renderer file watcher as the live-update mechanism. Extend `codex-hud configure` with a current-state JSON report and deterministic `--enable` / `--disable` updates, revise the terminal TUI to edit the current config by default, and expose those primitives through a concise plugin Skill.

**Tech Stack:** TypeScript, `@clack/prompts`, Vitest, Codex Skills, YAML, tmux-backed live renderer.

---

## Task 1: Extract the guided element catalog

**Files:**

- Create: `src/config/guided-elements.ts`
- Modify: `src/commands/configure.ts`
- Test: `src/config/guided-elements.test.ts`

- [ ] **Step 1: Write failing catalog tests**

Test that `guidedElementState(config)` returns stable enabled and disabled element names and that `applyGuidedElementChanges(config, { enable, disable })` only changes the named booleans. Include `git`, `usage`, `tools`, `skills`, `mcp`, `agents`, `todos`, `goal`, `configCounts`, `duration`, `speed`, `promptCache`, `sessionName`, `auth`, `memory`, `sessionTokens`, and `compactions`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm vitest run src/config/guided-elements.test.ts`

Expected: FAIL because `guided-elements.ts` does not exist.

- [ ] **Step 3: Implement the shared catalog**

Export a `GuidedElement` string union, label metadata, `guidedElementState`, `parseGuidedElements`, and `applyGuidedElementChanges`. Reject unknown names with a clear error and make `disable` win when the same name appears in both lists.

- [ ] **Step 4: Replace configure-local toggle code**

Import the shared helpers in `src/commands/configure.ts` and remove the duplicate `GUIDED_TOGGLES`, `currentToggles`, and `applyToggles` implementations.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run src/config/guided-elements.test.ts src/config/load.test.ts`

Expected: PASS.

## Task 2: Add selective non-interactive updates and current-state output

**Files:**

- Modify: `src/commands/configure.ts`
- Modify: `src/cli.ts`
- Test: `src/config/load.test.ts`

- [ ] **Step 1: Write failing command tests**

Add tests that invoke:

```text
configure --status --json
configure --enable tools,skills,agents --disable memory --yes
```

Assert that status JSON includes `configPath`, `language`, `layout`, `enabled`, and `disabled`; selective updates preserve colors, thresholds, and every unnamed display field.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm vitest run src/config/load.test.ts`

Expected: FAIL because the new options are unsupported.

- [ ] **Step 3: Implement status and update modes**

For `--status`, load and print the current validated config without writing. For `--enable` or `--disable`, clone `loaded.config`, apply only requested changes, optionally apply `--language` and `--layout`, atomically write through `writeConfig(config, loaded.raw)`, and avoid creating a preset unless `--preset` is explicitly supplied.

- [ ] **Step 4: Update help text**

Document `--status --json`, `--enable <names>`, and `--disable <names>` under the configure command.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run src/config/load.test.ts`

Expected: PASS.

## Task 3: Make terminal configuration edit current settings by default

**Files:**

- Modify: `src/commands/configure.ts`
- Test: `src/config/load.test.ts`

- [ ] **Step 1: Add a current-config base mode**

When interactive and no explicit preset is supplied, offer `Current settings`, `Full`, `Essential`, and `Minimal`, with current settings selected initially. Use `structuredClone(loaded.config)` for the current option and preserve unknown JSON keys on save.

- [ ] **Step 2: Keep manual element selection and preview**

Initialize the multiselect from the chosen base, render a preview up to the default HUD maximum, and write only after confirmation.

- [ ] **Step 3: Confirm live-update semantics**

Keep atomic rename in `writeConfig`; verify the renderer's `fs.watch` and mtime safety interval reload the file without restarting the Codex process.

- [ ] **Step 4: Run focused tests**

Run: `pnpm vitest run src/config/load.test.ts src/runtime/pane-size.test.ts`

Expected: PASS.

## Task 4: Create the dedicated configure Skill

**Files:**

- Create: `plugins/codex-hud/skills/configure/SKILL.md`
- Create: `plugins/codex-hud/skills/configure/agents/openai.yaml`
- Modify: `plugins/codex-hud/skills/setup/SKILL.md`
- Modify: `plugins/codex-hud/.codex-plugin/plugin.json`

- [ ] **Step 1: Initialize the Skill folder**

Run `skill-creator/scripts/init_skill.py configure --path plugins/codex-hud/skills` with interface values for `Configure Codex HUD`, a short selective-configuration description, and a default prompt explicitly naming `$codex-hud:configure`.

- [ ] **Step 2: Write the configure workflow**

Instruct Codex to run `codex-hud configure --status --json`, summarize enabled and disabled fields, gather requested changes in one concise interaction, apply them with `--enable` / `--disable --yes`, then run `codex-hud render --once --cwd <project> --no-color` and `codex-hud doctor --json`. State that the running renderer watches the config and should update immediately.

- [ ] **Step 3: Narrow setup responsibilities**

Keep `$codex-hud:setup` focused on installation, upgrades, presets, and advanced configuration; route selective visible-element changes to `$codex-hud:configure`.

- [ ] **Step 4: Update plugin prompts**

Add a default prompt for selective HUD configuration without removing the existing setup and diagnosis prompts.

- [ ] **Step 5: Validate both Skills**

Run `skill-creator/scripts/quick_validate.py` for `setup`, `configure`, and `doctor`.

Expected: all valid.

## Task 5: Document, build, reinstall, and smoke test

**Files:**

- Modify: `README.md`
- Modify: `README.zh.md`
- Update through build: `plugins/codex-hud/runtime/*`
- Update through helper: `plugins/codex-hud/.codex-plugin/plugin.json`

- [ ] **Step 1: Document both interaction surfaces**

Document `$codex-hud:configure` for in-Codex guided changes and `codex-hud configure` for the terminal multiselect. Explain that saved changes hot-reload in the current HUD session.

- [ ] **Step 2: Run full verification**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`

Expected: all commands pass.

- [ ] **Step 3: Update and validate the plugin package**

Run the plugin cachebuster helper, validate the plugin, and reinstall `codex-hud@personal` from the existing local marketplace.

- [ ] **Step 4: Smoke-test selective live updates**

Capture the current status, toggle a harmless display field through the new command, confirm `render --once` changes, then restore the original field and confirm the renderer/config is restored.

- [ ] **Step 5: Verify installed plugin contents**

Run `codex plugin list` and confirm the cached plugin contains `skills/configure/SKILL.md`. Start a new Codex thread to load the new Skill entry; already-running HUD renderer processes should reload configuration changes without restart.

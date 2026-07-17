# Codex HUD Setup Skill Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute inline and validate the updated skill and plugin before reinstalling.

**Goal:** Expose Codex HUD setup and configuration through `$codex-hud:setup` and the `/skills` selector, without a separate configure Skill.

**Architecture:** Keep `codex-hud configure` as the deterministic CLI backend. Expand the setup Skill to route install, diagnostics, presets, display customization, preview, and advanced configuration; remove the redundant configure Skill so the Skills selector has one clear Codex HUD entry.

**Tech Stack:** Codex Skills, Codex plugin manifest, Markdown, YAML, plugin validation.

---

## Task 1: Consolidate the Skills

**Files:**

- Modify: `plugins/codex-hud/skills/setup/SKILL.md`
- Modify: `plugins/codex-hud/skills/setup/agents/openai.yaml`
- Delete: `plugins/codex-hud/skills/configure/SKILL.md`
- Delete: `plugins/codex-hud/skills/configure/agents/openai.yaml`

- [ ] Make setup handle both first-time installation and later display configuration.
- [ ] Keep the skill concise and route deterministic changes through `codex-hud configure`.
- [ ] Update UI metadata so `/skills` presents one setup-and-configure entry.

## Task 2: Update plugin copy and documentation

**Files:**

- Modify: `plugins/codex-hud/.codex-plugin/plugin.json`
- Modify: `README.md`
- Modify: `README.zh.md`

- [ ] Replace `$codex-hud:configure` instructions with `$codex-hud:setup`.
- [ ] Document both explicit `$codex-hud:setup` invocation and `/skills` selection.

## Task 3: Validate and reinstall

**Files:**

- Updated by helper: `plugins/codex-hud/.codex-plugin/plugin.json`

- [ ] Run skill validation, lint, tests, build, and plugin validation.
- [ ] Update the cachebuster and reinstall `codex-hud@personal`.
- [ ] Verify the installed plugin contains setup and no configure Skill.

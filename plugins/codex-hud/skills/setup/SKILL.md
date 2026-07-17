---
name: setup
description: Set up and configure Codex HUD, including installation, upgrades, diagnostics, presets, layout, language, visible telemetry, advanced display settings, previews, and smoke tests. Use when the user asks to install, enable, initialize, upgrade, customize, simplify, expand, translate, reset, diagnose, or preview Codex HUD.
---

# Set up Codex HUD

1. Read `${CODEX_HOME:-~/.codex}/codex-hud/config.json` when it exists and preserve unknown or advanced keys.
2. Resolve `../../scripts/codex-hud-plugin.mjs` relative to this `SKILL.md`.
3. For installation, initialization, or upgrade requests, run `node <resolved-script> setup`, then inspect `codex-hud doctor --json`.
4. If tmux is missing, install it only when the user authorized machine setup; otherwise report the exact platform command.
5. For display changes, determine the requested preset, language, layout, and visible elements. Ask concise questions only when the choice materially changes the result.
6. Apply presets with `codex-hud configure --preset <full|essential|minimal> --yes`, adding `--language <en|zh-Hans|zh-Hant>` and `--layout <compact|expanded>` when requested.
7. For advanced settings, edit the config JSON directly, preserve unrelated keys, and validate with `codex-hud doctor --json`.
8. Preview with `codex-hud render --once --cwd <current-project> --no-color` and report the resulting configuration path.
9. After plugin installation or Skill updates, tell the user to start a new Codex session. New terminal sessions can run `codex` normally; existing shells may need `hash -r`.

Never overwrite an unmanaged executable. The installer must stop when `~/.local/bin/codex`, `codex-hud`, or `codex-hud-render` exists without Codex HUD installation state.

Use `full` for maximum telemetry, `essential` for normal daily activity, and `minimal` for model, project, and context only.

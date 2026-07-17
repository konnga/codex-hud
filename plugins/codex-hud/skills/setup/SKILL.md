---
name: setup
description: Set up Codex HUD, including installation, upgrades, presets, layout, language, advanced display settings, previews, and smoke tests. Use when the user asks to install, initialize, upgrade, reset to a preset, translate, diagnose setup, or change advanced Codex HUD configuration. Use the configure Skill for selective visible-element toggles.
---

# Set up Codex HUD

1. Read `${CODEX_HOME:-~/.codex}/codex-hud/config.json` when it exists and preserve unknown or advanced keys.
2. Resolve `../../scripts/codex-hud-plugin.mjs` relative to this `SKILL.md`.
3. For installation, initialization, or upgrade requests, run `node <resolved-script> setup`. In an interactive terminal, first-time setup starts from Full and opens the visible-element selection panel with a preview; pass `--yes` only when deterministic non-interactive setup is required. Then inspect `codex-hud doctor --json`.
4. If tmux is missing, install it only when the user authorized machine setup; otherwise report the exact platform command.
5. For setup changes, determine the requested preset, language, and layout. Existing configuration is preserved unless the user explicitly selects a preset. Route later selective visible-element changes to `$codex-hud:configure`.
6. Apply presets with `codex-hud configure --preset <full|essential|minimal> --yes`, adding `--language <en|zh-Hans|zh-Hant>` and `--layout <compact|expanded>` when requested.
7. For advanced settings, edit the config JSON directly, preserve unrelated keys, and validate with `codex-hud doctor --json`.
8. Preview with `codex-hud render --once --cwd <current-project> --no-color` and report the resulting configuration path.
9. After plugin installation or Skill updates, tell the user to start a new Codex session. New terminal sessions can run `codex` normally; existing shells may need `hash -r`.

Never overwrite an unmanaged executable. The installer must stop when `~/.local/bin/codex`, `codex-hud`, or `codex-hud-render` exists without Codex HUD installation state.

Use `full` for maximum telemetry, `essential` for normal daily activity, and `minimal` for model, project, and context only.

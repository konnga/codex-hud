---
name: doctor
description: Diagnose Codex HUD installation, tmux, Codex executable resolution, config loading, active-session discovery, rollout parsing, stale HUD panes, and terminal rendering. Use when the HUD is missing, blank, attached to the wrong session, stale, malformed, or unable to start.
---

# Diagnose Codex HUD

1. Resolve `../../scripts/codex-hud-plugin.mjs` relative to this `SKILL.md`.
2. Run `node <resolved-script> doctor`.
3. Run `codex-hud doctor --json --cwd <project>` for machine-readable evidence.
4. If no session is found, verify that Codex was launched from the same real project path and inspect the newest `$CODEX_HOME/sessions/**/rollout-*.jsonl` metadata without printing prompt or response bodies.
5. If the HUD is blank, run `codex-hud render --once --cwd <project> --no-color`.
6. If tmux panes are stale, list only `codex-hud-*` sessions and remove only HUD-owned sessions or panes.
7. If the `codex` shim recurses, inspect `${CODEX_HOME:-~/.codex}/codex-hud/install.json` and ensure `CODEX_HUD_CODEX_BIN` points to the real OpenAI Codex executable.
8. Report the failing layer and the smallest repair; do not reinstall or overwrite unmanaged files unless the user asks for repair.

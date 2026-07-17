---
name: configure
description: Interactively review and selectively change visible Codex HUD elements without resetting unrelated settings. Use when the user wants to turn HUD fields on or off, inspect what is currently enabled, simplify or expand the live HUD, or apply display changes to the current running Codex session.
---

# Configure Codex HUD

1. Run `codex-hud configure --status --json` and read the current `enabled`, `disabled`, `language`, and `layout` values.
2. If the user already named the desired changes, do not ask again. Otherwise summarize the current state and ask one concise question for everything to enable and disable. Use an interactive input control when available; otherwise accept a comma-separated or natural-language answer.
3. Map user-facing names to CLI names:
   - Git → `git`; quota/limits → `usage`; tools → `tools`; Skills → `skills`; MCP → `mcp`; subagents → `agents`; tasks/todos → `todos`; durable goal → `goal`.
   - config counts → `configCounts`; duration → `duration`; output speed → `speed`; prompt cache → `promptCache`; session title → `sessionName`; authentication → `auth`; memory → `memory`; session tokens → `sessionTokens`; compactions → `compactions`.
4. Apply only the selected changes:

   ```bash
   codex-hud configure --enable <comma-separated-names> --disable <comma-separated-names> --yes
   ```

   Omit an option when its list is empty. Never apply a preset unless the user explicitly requests a reset to Full, Essential, or Minimal.

5. Preview with `codex-hud render --once --cwd <current-project> --no-color`, then validate with `codex-hud doctor --json --cwd <current-project>`.
6. Report the saved config path and the resulting enabled/disabled changes. The running HUD watches the config and should refresh in the current session without restarting Codex.

Preserve unknown and advanced settings. Do not edit unrelated fields or reinstall the plugin for ordinary display changes.

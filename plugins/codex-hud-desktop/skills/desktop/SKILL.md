---
name: desktop
description: Open the Codex HUD Desktop dashboard for the current local Codex session. Use when the user asks to open, show, display, or refresh Codex HUD in the ChatGPT desktop app.
---

# Codex HUD Desktop

Use the bundled `codex_hud_open` MCP tool without a session ID first. The server automatically binds to `CODEX_THREAD_ID` when the desktop host exposes it.

This Skill is only for the in-chat MCP Apps dashboard. Do not run Codex HUD setup, start `render-cli.mjs`, create a tmux/cmux pane, or open a terminal window.

If automatic binding reports that no readable local rollout exists:

1. Call `codex_hud_list_sessions`.
2. Match the current project directory and most recently updated root session.
3. Call `codex_hud_open` with that session ID.

Do not select a subagent session. Do not modify Codex rollout files or the state database. The dashboard is read-only.

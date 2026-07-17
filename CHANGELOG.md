# Changelog

## 0.1.0

- Initial TypeScript CLI and Codex plugin scaffold.
- Incremental rollout JSONL parsing and official context calculation.
- Claude HUD-style project, context, usage, activity, agent, task, and session rendering.
- tmux persistent HUD launcher with detached and in-tmux modes.
- Full, Essential, and Minimal presets with English and Chinese labels.
- Reversible installer, optional `codex` shim, diagnostics, and plugin skills.
- Prompt-cache countdown, output speed, session title/auth, Git file stats, and auto-compact window support.
- External usage snapshot read/write with private permissions.
- Event-driven rollout/config refresh, resize handling, and launch-scoped multi-session isolation.
- Guided per-element configuration with a live preview and preserved advanced overrides.
- Managed-launcher marker checks and installer/uninstaller regression tests.
- Audited Claude HUD 0.5.0 parity matrix with explicit Codex telemetry boundaries.
- Added fail-open startup so missing/broken tmux never blocks official Codex.
- Added compact HUD pane sizing; normal interactive sessions use a stable five-row pane instead of reserving twelve or resizing Codex after startup.
- Delayed interactive Codex startup until a real tmux client is attached so terminal foreground/background detection and Composer styling remain intact.
- Reduced idle work with opt-in collectors, 30-second metadata caches, per-agent mtime caches, and ten-second config safety checks.
- Bounded the renderer V8 heap; real macOS smoke RSS dropped from roughly 86 MiB to roughly 64–70 MiB with 0.0% idle CPU.
- Refined Full defaults and Chinese labels, shortened noisy goals/tools, and suppressed implausible output-speed samples.
- Added a unified setup flow that starts first-time configuration from Full and opens the guided display-element panel in interactive terminals.
- Isolated non-nested launches in a per-launch private tmux socket without loading user tmux configuration; existing tmux sessions remain pane-only and option-free.
- Removed per-launch session bindings after Codex exits and hid tmux implementation details from detached-start output.

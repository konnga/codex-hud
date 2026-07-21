# Changelog

## [Unreleased]

## 0.2.1 - 2026-07-21

### Fixed

- Prevented duplicate or stale cmux HUD splits by replacing the previously owned HUD for the same source surface and cleaning it up on launcher termination signals.
- Kept managed launchers working after plugin upgrades or cache cleanup by installing a private runtime copy under the Codex HUD state directory instead of referencing the ephemeral plugin cache.
- Stopped cmux divider jitter by handing HUD height control to the user after a manual pane resize instead of repeatedly restoring the content-fitted height.

## 0.2.0 - 2026-07-19

### Added

- Added a native cmux backend that keeps Codex in its original surface and places the HUD in an independent bottom split, preserving terminal-native scrollback, selection, and copying.
- Added a conversation navigator for browsing, searching, and opening user turns directly inside the HUD pane.
- Added launch-scoped session and pane binding so concurrent Codex sessions in the same directory receive independent HUDs.
- Added automated SemVer, plugin cachebuster, CHANGELOG, CI, archive, checksum, and GitHub Release management.

### Changed

- HUD panes now grow and shrink to fit rendered content in both cmux and tmux instead of reserving unused rows.
- Added documented upgrade steps for existing marketplace installations, explicit language-default guidance, and an actual tmux screenshot.

### Fixed

- Updated cmux resizing for the 0.64 directional API, fixing new Codex sessions that could start without a HUD after `Pane has no adjacent border in direction right`.
- Redraw and resize the cmux HUD when its panel dimensions change.

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

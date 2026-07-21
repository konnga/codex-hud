# Changelog

## [Unreleased]

### Changed

- Enabled cumulative session token totals by default in the Full preset.

---

### 变更

- Full 预设现在默认显示会话累计 Token。

## 0.2.1 - 2026-07-21

### Fixed

- Prevented duplicate or stale cmux HUD splits by replacing the previously owned HUD for the same source surface and cleaning it up on launcher termination signals.
- Kept managed launchers working after plugin upgrades or cache cleanup by installing a private runtime copy under the Codex HUD state directory instead of referencing the ephemeral plugin cache.
- Stopped cmux divider jitter by handing HUD height control to the user after a manual pane resize instead of repeatedly restoring the content-fitted height.

---

### 修复

- 通过替换同一来源 surface 之前持有的 HUD，并在 launcher 收到终止信号时完成清理，避免 cmux 中出现重复或残留的 HUD split。
- 将私有运行时副本安装到 Codex HUD 状态目录，避免插件升级或缓存清理后，受管 launcher 继续引用已经删除的临时插件缓存。
- 用户手动调整 pane 高度后，将 HUD 高度控制权交给用户，避免刷新时反复恢复内容适配高度造成 cmux 分隔线抖动。

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

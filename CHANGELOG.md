# Changelog

## [Unreleased]

### Fixed

- The cmux HUD pane no longer gets stuck at the enlarged height after closing the conversation navigator. The renderer treated any `SIGWINCH` whose row count differed from the height it had *requested* as a manual divider drag and permanently disabled auto-fit — but the two routinely differ: resize amounts were converted with a hard-coded 20 points per row while the actual cell height varies with font and display scale, cmux clamps requests against the workspace, and cmux defers PTY row updates for hidden workspaces so the signal can arrive long after the resize that caused it. Manual-resize detection is now based on divider geometry instead: the renderer measures the real points-per-row from `cmux list-panes` before converting, records the pane's share of the container after each resize it issues, and on `SIGWINCH` only hands height ownership to the user when the divider has actually moved from where the HUD left it. Everything else — clamped requests, conversion drift, whole-window resizes — re-adopts the actual height and keeps fitting content.
---

### 修复

- 关闭会话导航器后 cmux HUD 面板不再停留在放大后的高度。此前只要 `SIGWINCH` 报告的行数与渲染器“请求的高度”不一致，就会被判定为用户手动拖动分隔条并永久关闭自动适配——但两者经常不一致：行数换算硬编码为每行 20 points 而实际行高随字体与缩放变化、cmux 会按工作区尺寸钳制 resize 请求、且 cmux 对后台工作区延迟同步 PTY 行数（信号可能在 resize 很久之后才到达）。现在手动检测改为基于分隔线几何：渲染器在换算前通过 `cmux list-panes` 实测每行 points，在每次自己发出 resize 后记录面板占容器高度的比例，`SIGWINCH` 到来时只有分隔线确实偏离了 HUD 自己设置的位置才把高度控制权移交给用户；其余情况（请求被钳制、换算偏差、整窗缩放）一律采纳实际高度并继续按内容自适应。
## 0.3.1 - 2026-07-26

### Fixed

- The `auth` provider label now reports the endpoint the current session actually connected to, read from Codex's own log database, instead of whatever `config.toml` contains at render time. Editing `base_url` mid-flight no longer relabels panes whose sessions are still talking to the previous endpoint. When neither the log database nor an unmodified `config.toml` can prove the endpoint, the label degrades to `API Key` rather than naming the wrong host.
- Codex writes no rollout until the first message, so a freshly launched pane had no session to attribute an endpoint to and briefly showed whatever `config.toml` held — the provider the user had just switched away from. The launcher now publishes the Codex process id in the session binding, letting the HUD resolve that process's endpoint from launch, and the label never borrows `config.toml` while unbound.
- The provider label is now the registrable host name rather than the hostname minus its last segment, so `https://api.openai.com/v1` reads `openai` instead of `api.openai`.

### Changed

- `codex-hud doctor` reports the resolved session endpoint, where it came from, and the Codex log database path.
- Session bindings now carry the Codex process id alongside the rollout path, and are written as soon as Codex starts rather than only once its rollout appears.

---

### 修复

- API key 场景下的 `auth` 标签改为显示当前会话实际连接的 endpoint（取自 Codex 自身的日志数据库），不再显示渲染时 `config.toml` 里的值。中途修改 `base_url` 不会再影响仍在使用旧 endpoint 的会话面板。当日志数据库与未被改写的 `config.toml` 都无法证明 endpoint 时，标签降级为 `API Key`，而不是显示错误的主机名。
- Codex 在第一条消息之前不会创建 rollout，因此刚启动的面板没有会话可依据，会短暂显示 `config.toml` 当时的值——也就是用户刚刚切走的那个 provider。现在启动器会把 codex 进程号写入 session binding，HUD 从启动起就能解析该进程的 endpoint；未绑定会话时也不再借用 `config.toml`。
- provider 标签改为取可注册域名而非“主机名去掉最后一段”，因此 `https://api.openai.com/v1` 显示为 `openai` 而不是 `api.openai`。

### 变更

- `codex-hud doctor` 新增会话 endpoint、来源以及 Codex 日志数据库路径的诊断输出。
- session binding 现在除 rollout 路径外还记录 codex 进程号，并在 Codex 启动时即写入，而不是等到 rollout 出现。

## 0.3.0 - 2026-07-25

### Features

- Expanded git working-tree markers to include renamed/copied/type-changed/conflicted states with IntelliJ-style letters (`M/A/D/R/C/T/?/!`) and enabled per-status file counts by default.
- Conversation navigator header now shows the full Codex session id for rollout correlation.
- `auth` display now shows the provider hostname (derived from `base_url`) for API-key sessions instead of a generic label.

### Docs

- Added a dedicated git status-marker reference table to both README files.
- Moved the screenshot asset from `docs/assets/` to `.github/assets/` and updated both README files accordingly.

### Chores

- Excluded `docs/superpowers/plans/` from version control; local planning documents are no longer committed.

---

### 功能

- 扩展 git 工作区状态标记，新增重命名/复制/类型变更/冲突状态，采用 IntelliJ 风格字母（`M/A/D/R/C/T/?/!`），并默认开启分状态文件计数。
- 会话历史导航器标题行现在显示完整的 Codex session id，方便与 rollout 文件对应。
- API key 场景下，`auth` 字段现在显示 provider 主机名（取自 `base_url`），而非通用标签。

### 文档

- 在两个 README 中新增专门的 git 状态标记参考表格。
- 将截图素材从 `docs/assets/` 迁移至 `.github/assets/`，并同步更新两个 README 的引用路径。

### 杂项

- 将 `docs/superpowers/plans/` 排除在版本控制之外，本地计划文档不再提交。

## 0.2.2 - 2026-07-21

### Changed

- Enabled cumulative session token totals by default in the Full preset.
- Clarified plugin version update steps, including recovery for stale or conflicting marketplace registrations.

---

### 变更

- Full 预设现在默认显示会话累计 Token。
- 完善插件版本更新步骤，并补充 marketplace 快照过期或同名来源冲突时的恢复流程。

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

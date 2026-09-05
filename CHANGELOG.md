# Changelog

## [Unreleased]

## 0.9.1 - 2026-09-05

### Added

- Right-aligned the current HUD version on the last visible line when the terminal has spare width, while keeping narrow layouts focused on existing telemetry.

### Fixed

- Kept every live HUD session on the newest account-wide quota observation, so an expired in-memory cache or an older tracing-log event can no longer freeze usage or move it backward after another session publishes an update.

---

### 新增

- 终端宽度充足时，在最后一条可见行的右侧显示当前 HUD 版本；窄布局仍优先保留既有遥测内容。

### 修复

- 所有存活 HUD 会话现在都会采用最新的账户级额度观测；其他会话发布更新后，过期的进程内缓存或更旧的 tracing 日志事件不再导致用量停滞或倒退。

## 0.9.0 - 2026-09-05

### Added

- Expanded `doctor --json` with usage provenance, trust decisions, freshness, hidden reasons, parsed windows, context and prompt-cache provenance, live Codex log schema targets, plugin/runtime version matching, and managed-install checksum validation. Added `codex-hud hud-version` for a direct runtime version check.
- Added a Presentation preset plus independent controls for tool-target and image details, with localized setup/configure prompts and render fallbacks in Simplified Chinese.
- Added all-source coverage gates and artifacts to CI, a macOS/cmux compatibility job, and a captured Codex 0.153 rollout fixture for schema regression coverage.

### Changed

- Essential and Expanded layouts now keep trusted subscription usage visible, including low weekly usage that was previously omitted. ChatGPT authentication can recover official usage without relying on a stale endpoint only when verified ChatGPT credentials and provider settings agree.
- Reduced idle work by migrating the default refresh interval from 300 ms to 1 second and loading conversation bodies only when the navigator is opened.
- Hardened Codex log discovery to follow live rate-limit event shapes and bounded payloads instead of matching diagnostic command text or fixed source targets.

### Fixed

- Kept account-wide ChatGPT quota windows separate from named model-specific limits, and shared fresh rollout observations across official-endpoint HUD sessions when Codex writes no account limit event to its tracing log.
- Persisted the last confirmed origin for each active session, with bounded atomic state and schema-aware fallback, so log rotation or compaction no longer makes valid 5-hour and weekly usage disappear.
- Redacted sensitive command text from HUD output and restricted relay credentials to HTTPS endpoints, while retaining explicit localhost development support.
- Recorded managed runtime versions and checksums during setup so stale or partially replaced installations can be identified reliably.

---

### 新增

- 扩展 `doctor --json`：现在会报告用量来源、可信判定、新鲜度、隐藏原因、解析后的窗口、上下文与 prompt cache 来源、Codex 实时日志 schema/目标、插件与 runtime 版本匹配，以及托管安装 checksum 校验；新增 `codex-hud hud-version`，可直接核对当前 runtime 版本。
- 新增演示预设，并可分别控制工具目标和图片详情；setup/configure 提示、渲染降级文案与图片回退均补齐简体中文。
- CI 新增全源码覆盖率门禁与产物、macOS/cmux 兼容性任务，并加入 Codex 0.153 rollout 夹具，持续覆盖日志 schema 兼容性。

### 调整

- Essential 与 Expanded 布局会持续显示可信的订阅用量，包括此前可能被省略的低占用周额度；只有 ChatGPT 凭据与 provider 配置均通过核验时，才允许在端点暂时缺失时恢复官方 ChatGPT 用量。
- 默认刷新间隔由 300 毫秒迁移为 1 秒，会话正文改为仅在打开导航器时加载，降低空闲开销。
- Codex 日志发现改为跟随真实 rate-limit 事件结构并限制负载大小，不再因诊断命令文本或固定 source target 产生误判。

### 修复

- 将 ChatGPT 账户级额度窗口与具名模型专属额度分开处理；当 Codex 未把账户额度事件写入 tracing 日志时，在同一官方端点的 HUD 会话之间共享 rollout 中的新鲜账户额度。
- 按活动会话持久化最近一次已确认的 origin，并使用有界、原子和 schema 感知的状态回退；日志轮换或压缩后，有效的 5 小时与周额度不再消失。
- HUD 输出会遮蔽敏感命令文本；中转凭据仅允许发送到 HTTPS 端点，同时保留显式的 localhost 本地开发支持。
- setup 会记录托管 runtime 版本与 checksum，能够可靠识别陈旧或替换不完整的安装。

## 0.8.0 - 2026-08-31

### Changed

- Display quota reset times as compact, server-provided local dates and times by default instead of countdowns. Legacy configurations using the previous default are migrated automatically, while other time format modes remain available.

---

### 调整

- 额度重置时间默认改为显示服务端提供的本地日期和时间，并使用更紧凑的文案，不再只显示倒计时。旧配置中的默认格式会自动迁移，其他时间格式仍可继续使用。

## 0.7.2 - 2026-08-28

### Fixed

- Kept the most recent ChatGPT subscription usage windows and plan metadata when later rollout token-count events contain partial or empty rate-limit data, so displayed weekly usage no longer disappears between updates.

---

### 修复

- 后续 rollout token-count 事件只包含部分或空的 rate-limit 数据时，继续保留最近一次的 ChatGPT 订阅额度窗口和套餐信息，避免周额度在更新间隙消失。

## 0.7.1 - 2026-08-27

### Fixed

- Retried transient cmux split failures once, persisted HUD startup failures for later diagnosis, reported the latest failure and cmux ownership health through `doctor`, and cleaned up old ownership metadata after its owner process exits.

---

### 修复

- cmux 分屏瞬时失败时自动重试一次；HUD 启动失败会持久化供后续诊断；`doctor` 现在报告最近失败与 cmux ownership 健康状态，并清理 owner 进程退出后的旧 ownership 元数据。

## 0.7.0 - 2026-08-27

### Added

- Added the Codex HUD version to conversation navigator headers, omitting it first when a narrow terminal cannot fit the full title.

### Fixed

- Stopped rendering the literal `0` credit balance emitted for ChatGPT accounts that do not have purchased credits.
- Allowed multiline user messages to wrap in the conversation navigator list instead of collapsing and truncating them to one row.

---

### 新增

- 会话历史导航标题现在显示 Codex HUD 版本；终端较窄时会优先省略版本号。

### 修复

- ChatGPT 账户未购买额外 credits 时，不再显示服务端返回的字面量余额 `0`。
- 会话历史导航列表现在支持用户消息按原始换行和终端宽度折行，不再强制压缩并截断为单行。

## 0.6.0 - 2026-08-23

### Added

- Added a visible copy shortcut beside the conversation navigator's session ID. Press `y` in either navigator view to copy the full ID with success or failure feedback.

### Changed

- Removed Traditional Chinese output. Codex HUD now supports English and Simplified Chinese only, with legacy Chinese values falling back to Simplified Chinese.

---

### 新增

- 在会话历史导航标题的 session ID 旁新增复制快捷入口；列表和详情页均可按 `y` 复制完整 ID，并显示成功或失败反馈。

### 调整

- 移除繁体中文输出；Codex HUD 现在仅支持英文和简体中文，旧中文语言值统一回退到简体中文。

## 0.5.1 - 2026-08-13

### Changed

- Relay balance queries are now disabled by default and require an explicit first-time setup choice, `--relay-usage`, or configuration entry. Queries refresh in the background without blocking HUD frames.
- The configured refresh interval now controls the HUD heartbeat. Git status uses one porcelain-v2 command per refresh, subagent rollouts are parsed incrementally, and long-lived caches have bounded TTL and capacity.

### Fixed

- Preserved the last valid HUD configuration across transient malformed writes during hot reload.
- Isolated relay balance caches by credential and user, stopped dedicated-key configurations from falling back to inference keys, bounded stale results and response sizes, and prevented concurrent duplicate refreshes.

---

### 调整

- 中转余额查询现在默认关闭，需要在首次 setup 中明确选择、传入 `--relay-usage` 或添加配置后才会启用；查询在后台刷新，不会阻塞 HUD 帧。
- 配置的刷新间隔现在会实际控制 HUD heartbeat。Git 状态每次刷新只执行一次 porcelain-v2 命令，子 Agent rollout 改为增量解析，长期缓存增加 TTL 和容量上限。

### 修复

- 配置热加载遇到短暂的无效写入时继续保留上一份有效配置。
- 中转余额缓存按凭据和用户隔离；专用 Key 缺失时不再回退推理 Key，并限制旧值保留时间、响应体大小以及并发重复刷新。

## 0.5.0 - 2026-08-13

### Added

- Added relay balance queries for third-party Codex endpoints. The HUD now supports the CC Switch-compatible general protocol by default, plus configurable New API and Sub2API templates, and displays the resulting balance beside the API-key provider name. Queries are scoped to the matching non-official session origin, keep credentials in environment variables, and preserve the last successful result across transient failures.

### Fixed

- Ignored Codex-shaped native usage-limit events from third-party relays, which can describe a shared upstream pool rather than the user's OpenAI subscription. Native usage windows are now trusted only for official ChatGPT and OpenAI API endpoints.

---

### 新增

- 新增第三方 Codex 中转站余额查询。HUD 默认支持与 CC Switch 兼容的通用协议，并提供可配置的 New API 和 Sub2API 模板；查询结果显示在 API Key 服务商名称旁。查询只会访问当前会话匹配的非官方 origin，凭据仅从环境变量读取，短暂失败时继续显示上一次成功结果。

### 修复

- 忽略第三方中转返回的 Codex 格式原生额度事件；这类事件可能描述共享上游账户池，而不是用户自己的 OpenAI 套餐。原生用量窗口现在仅信任 ChatGPT 和 OpenAI API 官方端点。

## 0.4.2 - 2026-08-11

### Fixed

- Kept the weekly account quota synchronized across open HUD sessions, including custom providers whose rollout token-count events contain null rate limits. The HUD now consumes Codex's account-level rate-limit events, merges updates by window duration so 5h and 1w limits remain distinct, and shares a private cached snapshot across renderer processes and log rotation.

---

### 修复

- 修复多个已打开 HUD 会话之间的周额度同步，包括 rollout token-count 事件中额度为空的自定义 provider。HUD 现在读取 Codex 的账户级额度事件，按窗口时长合并更新以避免混淆 5h 与 1w，并通过私有缓存快照在多个 renderer 进程及日志轮转后继续共享最新额度。

## 0.4.1 - 2026-08-05

### Fixed

- Restored tmux mouse handling in HUD-managed sessions so wheel scrolling uses tmux history and clicking the HUD pane allows its navigator and image-gallery shortcuts to receive input.

---

### 修复

- 恢复 HUD 托管 tmux 会话的鼠标处理，使滚轮查看 tmux 历史，并允许点击 HUD pane 后使用导航器和图片画廊快捷键。

## 0.4.0 - 2026-08-05

### Added

- Added a session-scoped image gallery for local paths emitted by `view_image` and image-generation tools. The HUD can list images, render inline terminal previews through optional `chafa`, open files with the system image viewer, and copy paths without mixing images from concurrent Codex sessions in the same project.

### Docs

- Documented image gallery controls, optional `chafa` installation, system-viewer behavior, and fallback limitations in both README files and the dedicated image viewer guide.

---

### 新增

- 新增按会话隔离的图片画廊，用于展示 `view_image` 和图片生成工具产生的本地路径。HUD 支持图片列表、通过可选 `chafa` 进行终端内联预览、调用系统图片查看器打开，以及复制路径；同一项目中的并发 Codex 会话不会混用图片。

### 文档

- 在中英文 README 和图片查看器专门文档中补充了图片画廊快捷键、可选 `chafa` 安装、系统查看器行为和降级限制。

## 0.3.3 - 2026-07-30

### Fixed

- Existing unversioned configurations now enable per-status Git file counts during managed runtime upgrades, matching the 0.3 default. The one-time migration is versioned so later user changes remain respected.
- HUD startup now measures complete content before fitting the initial five-row pane, so rows beyond the startup viewport are no longer hidden until a manual resize. Explicit cmux manual heights remain viewport-constrained.
- Completed durable goals now leave the HUD instead of permanently occupying a row with a `[completed]` label; active, paused, and blocked goals remain visible.

### Changed

- Cumulative session tokens now group cached input with total input and show its percentage, making clear that cached tokens are a subset rather than an additional token category.
- Weekly usage windows now start directly with their `1w` label instead of a redundant `Usage` prefix. Missing window durations use a neutral `limit` label rather than assuming the discontinued five-hour limit; balance-only output keeps the prefix for context.

---

### 修复

- 升级受管 runtime 时，现有未带版本号的配置会开启 Git 分状态文件计数，与 0.3 的默认行为保持一致。迁移只执行一次并记录配置版本，之后仍会尊重用户的手动设置。
- HUD 启动时会先测量完整内容再调整初始五行 pane，超出启动 viewport 的内容不再需要手动拉高后才能显示；cmux 用户手动设置的高度仍按实际 viewport 裁剪。
- 持久 Goal 完成后会从 HUD 中移除，不再以 `[completed]` 状态长期占用一行；active、paused 和 blocked 状态仍会显示。

### 变更

- 会话累计 Token 现在将缓存输入与总输入归为一组并显示占比，明确缓存 Token 是输入的子集，而不是额外相加的独立类别。
- 周额度窗口现在直接从 `1w` 标签开始，不再重复显示 `额度` 前缀。窗口时长缺失时改用中性的 `limit` 标签，不再假设已经取消的 5 小时限制；仅显示余额时仍保留前缀以说明含义。

## 0.3.2 - 2026-07-26

### Fixed

- The cmux HUD pane no longer gets stuck at the enlarged height after closing the conversation navigator. The renderer treated any `SIGWINCH` whose row count differed from the height it had *requested* as a manual divider drag and permanently disabled auto-fit — but the two routinely differ: resize amounts were converted with a hard-coded 20 points per row while the actual cell height varies with font and display scale, cmux clamps requests against the workspace, and cmux defers PTY row updates for hidden workspaces so the signal can arrive long after the resize that caused it. Manual-resize detection is now based on divider geometry instead: the renderer measures the real points-per-row from `cmux list-panes` before converting, records the pane's share of the container after each resize it issues, and on `SIGWINCH` only hands height ownership to the user when the divider has actually moved from where the HUD left it. Everything else — clamped requests, conversion drift, whole-window resizes — re-adopts the actual height and keeps fitting content.
- The memory line no longer reads ~100% on every Mac. `os.freemem()` counts only wholly free pages, so macOS file cache and inactive memory registered as used; the collector now derives available memory from `vm_stat` reclaimable pages (free, inactive, speculative, purgeable) and caches the reading for five seconds.
- MCP servers are now detected from the `mcp_tool_call_begin`/`mcp_tool_call_end` events Codex itself writes, which carry the server name. Previously only tools named in Claude Code's `mcp__server__tool` style were recognized, so Codex-native MCP usage never appeared in the HUD.

### Changed

- The memory line shows used and total memory in scaled byte units (e.g. `12.4 GB/32 GB`) instead of a MiB figure formatted as a token count.

---

### 修复

- 关闭会话导航器后 cmux HUD 面板不再停留在放大后的高度。此前只要 `SIGWINCH` 报告的行数与渲染器“请求的高度”不一致，就会被判定为用户手动拖动分隔条并永久关闭自动适配——但两者经常不一致：行数换算硬编码为每行 20 points 而实际行高随字体与缩放变化、cmux 会按工作区尺寸钳制 resize 请求、且 cmux 对后台工作区延迟同步 PTY 行数（信号可能在 resize 很久之后才到达）。现在手动检测改为基于分隔线几何：渲染器在换算前通过 `cmux list-panes` 实测每行 points，在每次自己发出 resize 后记录面板占容器高度的比例，`SIGWINCH` 到来时只有分隔线确实偏离了 HUD 自己设置的位置才把高度控制权移交给用户；其余情况（请求被钳制、换算偏差、整窗缩放）一律采纳实际高度并继续按内容自适应。
- 内存行在 macOS 上不再恒显 ~100%。`os.freemem()` 只统计完全空闲的页，macOS 的文件缓存和 inactive 内存都会被算成已用；现在改由 `vm_stat` 的可回收页（free、inactive、speculative、purgeable）推算可用内存，并缓存 5 秒。
- MCP 服务器改为从 Codex 自身写入的 `mcp_tool_call_begin`/`mcp_tool_call_end` 事件识别（事件里携带服务器名）。此前只识别 Claude Code 风格的 `mcp__server__tool` 工具命名，Codex 原生 MCP 调用一直不会显示。

### 变更

- 内存行以自动换算的字节单位显示“已用/总量”（如 `12.4 GB/32 GB`），不再显示按 token 计数格式化的 MiB 数值。

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

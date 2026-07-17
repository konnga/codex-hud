# Codex HUD

Codex HUD is a persistent Claude HUD-style heads-up display for OpenAI Codex CLI. It keeps the official Codex binary unchanged, runs a dedicated tmux pane below the Codex input area, and incrementally reads local rollout JSONL telemetry.

## Full display preview

With the Full preset and active session telemetry, the HUD expands to show identity, context and quota usage, environment policy, live activity, and session timing:

```text
[gpt-5.5 high] │ codex-hud +shared git:(main* ↑1) │ ChatGPT pro (builder)
Context ██████░░░░ 59% │ Usage 5h: ███░░░░░░░ 25% (resets in 1h 30m) │ 1w: ████████░░ 82% (resets in 4d) │ $12.50
Cache TTL ⏱️ 5m
Approval: on-request │ Permissions: workspace-write │ Sandbox: workspace-write
🛠️ Tools: ◐ exec_command: pnpm test │ ✓ view_image ×1
🧩 ✓ Skills (2): openai-docs, plugin-creator
🔌 ✓ MCPs (1): github
🤖 ◐ explorer: Inspect protocol (2m)
📋 ▸ Render HUD (1/3)
⏱️ 1h │ Compactions: 1
```

Rows without available telemetry are omitted automatically. When there is no active plan, the task row can instead show the durable goal.

Highlights:

- Model, provider, reasoning effort, project, and Git status
- Official Codex context-window calculation and token breakdown
- Primary, secondary, spend-control, reset-time, and credit usage data
- Live tools, skills, MCP servers, subagents, plan items, and durable goals
- Compact/expanded layouts, Full/Essential/Minimal presets, and English/Chinese labels
- Standard Codex plugin skills for setup, selective live configuration, and diagnostics
- Reversible launchers and an optional managed `codex` shim
- Prompt-cache countdown, output speed, session title/auth, Git file stats, and external usage snapshots
- Event-driven refresh and launch-scoped isolation for concurrent sessions in the same directory
- Content-fitted tmux pane height with no reserved blank rows
- Fail-open startup: HUD/tmux failures fall back to untouched official Codex execution
- Cached collectors and a bounded renderer heap for lower idle resource usage

See the audited [Claude HUD parity matrix](./docs/claude-hud-parity.md) for every upstream capability and the exact fallback used when Codex has no equivalent telemetry.

## Requirements

- Node.js 20 or newer
- A working official OpenAI Codex CLI installation
- tmux
- pnpm 10 when building from source

Install tmux with `brew install tmux` on macOS, `sudo apt install tmux` on Debian/Ubuntu, or the equivalent command for your platform. If tmux is unavailable, Codex HUD safely runs official Codex without the HUD.

## Recommended plugin installation

The flow mirrors Claude HUD, using Codex CLI's marketplace commands:

```bash
codex plugin marketplace add konnga/codex-hud
codex plugin add codex-hud@codex-hud
```

`konnga/codex-hud` is GitHub shorthand for `https://github.com/konnga/codex-hud.git`. The first command fetches and registers the marketplace snapshot; it does not install the plugin. The second command installs plugin `codex-hud` from marketplace `codex-hud`.

Verify discovery with:

```bash
codex plugin marketplace list --json
codex plugin list --marketplace codex-hud --available --json
```

Start a new Codex session and run:

```text
$codex-hud:setup
```

You can also open `/skills` and select the Codex HUD setup Skill. Setup installs the managed launchers, starts first-time configuration from Full, and guides you through the visible fields. Then restart Codex:

```bash
hash -r
codex
```

In short: add the marketplace, install the plugin, run the setup Skill, and restart Codex.

> Installation reads the committed GitHub default branch, not an uncommitted local worktree. Maintainers must push `.agents/plugins/marketplace.json`, `plugins/codex-hud/`, and the built plugin runtime before users can install a new release.

To migrate from the former `personal` marketplace name:

```bash
codex plugin remove codex-hud@personal
codex plugin marketplace remove personal
codex plugin marketplace add konnga/codex-hud
codex plugin add codex-hud@codex-hud
```

## Install from source

```bash
pnpm install
pnpm build
node dist/cli.mjs setup --codex-shim
hash -r
codex
```

`setup` installs the managed launchers and opens a Full-based visible-element selection panel with a live preview. If `~/.local/bin` is not already available, add it to your shell path:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Use `node dist/cli.mjs setup` without `--codex-shim` if you do not want to replace the `codex` command, then start sessions with `codex-hud`. Existing configuration is preserved unless you explicitly select a preset.

The managed shim transparently passes non-interactive commands such as `codex plugin`, `exec`, `login`, `mcp`, `completion`, and `--version` to the official binary; only interactive TUI sessions receive a HUD pane.

The HUD is an optional decoration layer. If tmux or HUD startup fails, Codex HUD runs the official Codex binary directly with the same arguments and propagates its exit code. The pane starts at five rows and then fits the rendered content up to the configured maximum height.

## Daily usage

With the optional shim installed, use Codex normally:

```bash
codex
codex --model gpt-5.5
codex -C /path/to/project
codex resume --last
```

Without the shim:

```bash
codex-hud
codex-hud -- --model gpt-5.5
```

Temporarily bypass the HUD or inspect a single rendered frame:

```bash
codex --no-hud
codex-hud render --once --cwd "$PWD" --no-color
```

`--detach` is intended mainly for automation and smoke tests; it starts the session in the background without attaching the current terminal.

## Display configuration

Run the interactive selection panel at any time:

```bash
codex-hud configure
```

Apply a preset or deterministic changes:

```bash
codex-hud configure --preset full --yes
codex-hud configure --status --json
codex-hud configure --enable tools,skills,agents --disable memory,speed --yes
```

Selectable names are `git`, `usage`, `promptCache`, `tools`, `skills`, `mcp`, `agents`, `todos`, `goal`, `configCounts`, `auth`, `memory`, `duration`, `speed`, `sessionName`, `sessionTokens`, and `compactions`. Saved changes are reloaded by the running HUD without restarting Codex.

Configuration lives at `${CODEX_HOME:-~/.codex}/codex-hud/config.json`.

## Diagnostics and uninstall

```bash
codex-hud doctor
codex-hud doctor --json --cwd "$PWD"
codex-hud uninstall --dry-run
codex-hud uninstall
```

Uninstall removes only launchers recorded in the managed installation state. It does not delete the HUD configuration or official Codex data.

If installed through the Codex plugin marketplace, remove the managed launchers first and then remove the plugin and marketplace:

```bash
codex-hud uninstall
codex plugin remove codex-hud@codex-hud
codex plugin marketplace remove codex-hud
```

## Verification

```bash
pnpm lint --fix
pnpm typecheck
pnpm test
pnpm build
node dist/render-cli.mjs --once --cwd "$PWD" --no-color
node dist/cli.mjs doctor --json
```

See [README.zh.md](./README.zh.md) for complete Chinese usage and architecture notes. Inside Codex, use `$codex-hud:setup`, `$codex-hud:configure`, or `$codex-hud:doctor`; all three are also available through `/skills`.

Outside an existing tmux client, Codex HUD creates a private per-launch tmux socket and does not load the user's tmux configuration. Inside tmux, it only creates and later removes the HUD pane without changing session, server, mouse, status, or key-binding options.

## Attribution

The layout, configuration model, and portions of the rendering behavior are adapted from Jarrod Watts' MIT-licensed [claude-hud](https://github.com/jarrodwatts/claude-hud). See [NOTICE](./NOTICE).

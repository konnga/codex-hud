# Codex HUD

> 🌐 English | [中文文档](./README.zh.md)

Keep context, quota, Git status, tools, agents, tasks, and session details visible in a persistent pane below Codex. The official Codex binary remains untouched.

## Full display preview

With the Full preset, available session telemetry expands into model and project identity, context and quota, live activity, environment policy, and session status:

```text
[gpt-5.5 high] │ codex-hud git:(main* ↑1) M2 A1 ?1 │ ChatGPT pro
Context ██████░░░░ 59% │ 1w: ████████░░ 82% (resets in 4d)
🛠️ Tools: ◐ exec_command: pnpm test │ ✓ view_image ×1
🤖 ◐ explorer: Inspect protocol (2m)
📋 ▸ Render HUD (1/3)
⏱️ 1h │ Tokens: 55k (in 50k, cache 30k · 60%; out 5k)
```

Actual terminal view:

![Codex HUD terminal view](./.github/assets/codex.png)

## What is Codex HUD?

Codex HUD is a persistent terminal information panel for OpenAI Codex CLI. It brings context, quota, Git status, tool calls, agents, tasks, and session details together below Codex, so you can understand the active session without leaving your workflow.

It does not replace or modify the official Codex binary. Instead, it reads local Codex rollout data and creates a dedicated HUD pane. It uses a native split in cmux and a tmux compatibility backend elsewhere; if no backend works or HUD startup fails, Codex still runs normally with the original arguments.

Only rows with available telemetry are rendered; unavailable data stays out of the way.

| Category | Examples |
| --- | --- |
| Model and project | Model, reasoning effort, project path, Git branch, and file status |
| Context and quota | Context usage, cumulative tokens, cache ratio, weekly limit, reset time, and credits |
| Live activity | Tool calls, Skills, MCP servers, subagents, plan items, and durable goals |
| Environment | Approval policy, sandbox, permissions, and collaboration mode |
| Session | Session title, duration, output speed, compactions, and turn navigation |

See the audited [feature and telemetry support matrix](./docs/claude-hud-parity.md) for exact data sources and fallback behavior.

## Quick start

For a new installation, follow steps 1–4. Existing users can jump directly to step 5.

```text
prepare cmux/tmux → install the plugin → run setup → restart Codex
```

### 1. Prepare the environment

You need:

- Node.js 20 or newer
- A working official OpenAI Codex CLI installation
- cmux 0.64 or newer, or tmux

tmux is not required inside cmux. Other terminals use tmux as the compatibility backend:

```bash
# macOS
brew install tmux

# Debian / Ubuntu
sudo apt install tmux
```

`sqlite3` is optional and enables session titles and per-session endpoint detection.

### 2. Install the Codex HUD plugin

Run in a regular terminal:

```bash
codex plugin marketplace add konnga/codex-hud
codex plugin add codex-hud@codex-hud
```

### 3. Run first-time setup

Start a new Codex session, then enter:

```text
$codex-hud:setup
```

You can also open `/skills` and select the Codex HUD setup Skill. It installs the managed launchers and opens a visible-field selector with a live preview.

> Setup cannot inject a HUD into the Codex TUI that is already running. This is a terminal-pane limitation, not an installation failure.

### 4. Restart Codex

Exit the current session after setup, then run in a regular terminal:

```bash
hash -r
codex
```

Installation is complete when the new session opens with a HUD pane below Codex. To verify the environment, run:

```bash
codex-hud doctor
```

### 5. Update

Tell Codex directly:

```text
Update Codex HUD to the latest version, preserve my existing configuration, and run doctor when finished.
```

The AI can refresh the marketplace, reinstall the plugin, update the managed runtime, and verify the installation. The update does not delete `${CODEX_HOME:-~/.codex}/codex-hud/config.json`.

> The current session cannot load newly installed Skills or gain the updated HUD pane. Exit and restart Codex after the update finishes.

<details>
<summary><strong>Manual update commands</strong></summary>

Codex currently has no separate plugin upgrade command, so refresh the marketplace and reinstall the plugin:

```bash
codex plugin marketplace upgrade codex-hud
codex plugin remove codex-hud@codex-hud
codex plugin add codex-hud@codex-hud
```

Then start Codex, run `$codex-hud:setup`, and restart Codex once more.

If the marketplace source conflicts or no plugin appears after refreshing, rebuild the registration:

```bash
codex plugin remove codex-hud@codex-hud
codex plugin marketplace remove codex-hud
codex plugin marketplace add https://github.com/konnga/codex-hud.git
codex plugin add codex-hud@codex-hud
```

Removing the plugin or marketplace does not delete the existing HUD configuration.

</details>

## Everyday commands

| Where | Command or key | Purpose |
| --- | --- | --- |
| Inside Codex | `$codex-hud:configure` | Choose visible fields with a live preview |
| Inside Codex | `$codex-hud:doctor` | Check the launcher, backend, configuration, and active session |
| HUD pane | `n` | Open the conversation navigator |
| Terminal | `codex` | Start interactive Codex with the HUD |
| Terminal | `codex --no-hud` | Temporarily bypass the HUD and run official Codex directly |
| Terminal | `codex-hud render --once --cwd "$PWD" --no-color` | Print one plain-text HUD frame |

Non-interactive commands such as `codex exec`, `plugin`, `login`, `mcp`, `completion`, `--help`, and `--version` pass directly to the official Codex executable.

## Configure the display

Open the interactive selector at any time:

```bash
codex-hud configure
```

Or apply a preset directly:

| Preset | Best for |
| --- | --- |
| `full` | First-time use and complete day-to-day information |
| `essential` | Project, context, quota, and primary activity only |
| `minimal` | A small information set for narrow terminals |

```bash
codex-hud configure --preset full --yes
codex-hud configure --preset essential --yes
codex-hud configure --preset minimal --yes
```

Enable or disable exact fields:

```bash
codex-hud configure --enable tools,skills,agents --disable memory,speed --yes
codex-hud configure --status --json
```

The HUD defaults to English and does not automatically follow the README or system language:

```bash
codex-hud configure --language zh-Hans
codex-hud configure --language zh-Hant
```

Configuration is stored at `${CODEX_HOME:-~/.codex}/codex-hud/config.json`. Sessions that already have a HUD pane reload saved changes automatically. A Codex process started without the Codex HUD launcher still needs to be restarted.

<details>
<summary><strong>All configurable fields and environment variables</strong></summary>

Names accepted by `--enable` and `--disable`:

| Name | Content |
| --- | --- |
| `git` | Git branch and working-tree status |
| `usage` | Usage windows, reset times, and credits |
| `promptCache` | Prompt-cache countdown |
| `tools` / `skills` / `mcp` | Tool, Skill, and MCP activity |
| `agents` | Subagent status |
| `todos` / `goal` | Plans, tasks, and durable goals |
| `turns` | Conversation count and navigator hint |
| `configCounts` | Config, rule, Skill, and MCP counts |
| `auth` | ChatGPT plan or the actual endpoint host for the current session |
| `memory` | Approximate system memory |
| `duration` / `speed` | Session duration and output speed |
| `sessionName` / `sessionTokens` | Session title and cumulative tokens |
| `compactions` | Context compaction count |

Common environment variables:

| Variable | Purpose |
| --- | --- |
| `CODEX_HOME` | Codex data and configuration directory |
| `CODEX_HUD_CONFIG` | Override the HUD configuration path |
| `CODEX_HUD_CODEX_BIN` | Point to the real Codex executable |
| `CODEX_HUD_BIN_DIR` | Launcher directory, default `~/.local/bin` |
| `CODEX_HUD_HEIGHT` | Maximum HUD pane height, default 30 |
| `NO_COLOR` | Disable ANSI colors |

</details>

<details>
<summary><strong>Git status markers</strong></summary>

For example, `git:(main* ↑1) M2 A1 ?1` means branch `main` has uncommitted changes, is one commit ahead of upstream, and contains two modified files, one staged addition, and one untracked file.

| Marker | Meaning |
| --- | --- |
| `M` | Modified |
| `A` | Added (staged) |
| `D` | Deleted |
| `R` | Renamed |
| `C` | Copied |
| `T` | Type changed |
| `?` | Untracked |
| `!` | Conflict (unmerged) |

</details>

## Conversation navigator

When the HUD shows a `Turns` row, click the HUD pane and press `n`:

- `j` / `k` or arrow keys: select the previous or next turn
- `Enter` or right arrow: open the full turn
- `/`: search user and assistant text
- Page Up / Page Down: scroll the open turn
- `Esc`: return to the list, then close
- `q`: close immediately

The navigator lists real user submissions only; injected environment context and developer instructions are excluded. See [Conversation navigator](./docs/conversation-navigator.md) for its data model, privacy behavior, and limitations.

## System support

| System or environment | Support | Requirements and notes |
| --- | --- | --- |
| macOS | Supported | Use cmux 0.64+ or tmux; cmux preserves native scrolling, selection, and copying |
| Linux | Supported | Requires tmux as the HUD pane backend |
| WSL2 | Supported | Node.js, Codex, tmux, and Codex HUD must be installed in the same Linux distribution |
| Native Windows | Full HUD unsupported | PowerShell, Command Prompt, and native Windows Terminal cannot create a supported HUD pane |

Every supported environment requires Node.js 20 or newer and a working official Codex CLI installation. `sqlite3` is optional and enables session titles and actual endpoint detection.

If no usable cmux/tmux environment is available or HUD startup fails, Codex HUD runs official Codex directly. Commands remain available, but no HUD is displayed.

## Troubleshooting

Start with:

```bash
codex-hud doctor
codex-hud render --once --cwd "$PWD" --no-color
```

Common cases:

| Symptom | Fix |
| --- | --- |
| Setup succeeded, but the current session has no HUD | Exit Codex, run `hash -r`, and start `codex` again |
| `tmux: not found` | Install tmux; cmux users do not need it |
| `Session: not found` | Run Codex and doctor with the same real project directory |
| The command still resolves to an old launcher | Run `hash -r` or open a new terminal |
| You want to confirm whether the HUD is involved | Temporarily use `codex --no-hud` |

## Development

Building from source requires pnpm 10:

```bash
pnpm install
pnpm build
node dist/cli.mjs setup --codex-shim
hash -r
codex
```

The managed runtime is installed at `${CODEX_HOME:-~/.codex}/codex-hud/runtime`, so it does not depend on a plugin cache directory that an upgrade might remove.

## Uninstall

Remove managed launchers first, then optionally remove the plugin and marketplace:

```bash
codex-hud uninstall --dry-run
codex-hud uninstall
codex plugin remove codex-hud@codex-hud
codex plugin marketplace remove codex-hud
```

Uninstall does not delete the HUD configuration, official Codex data, or files that are not managed by Codex HUD.

## Privacy and safety

- The HUD reads local Codex rollout data, configuration metadata, and Git status only.
- The persistent HUD does not display user prompts, model response bodies, or tool output bodies.
- Conversation content is displayed only after the user explicitly opens the navigator and remains local.
- All rendered text is stripped of terminal control characters.
- Codex HUD does not modify the official Codex binary, and `--no-hud` bypasses it at any time.

Codex HUD is released under the [MIT License](./LICENSE). See [NOTICE](./NOTICE) for attribution of adapted work.

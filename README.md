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

## Development install

```bash
pnpm install
pnpm build
node dist/cli.mjs install --codex-shim
codex-hud configure --preset full --yes
hash -r
codex
```

Use `codex-hud` directly if you do not want the optional `codex` shim. Run `codex-hud uninstall` to remove only managed launchers.

The managed shim transparently passes non-interactive commands such as `codex plugin`, `exec`, `login`, `mcp`, `completion`, and `--version` to the official binary; only interactive TUI sessions receive a HUD pane.

The HUD is an optional decoration layer. If tmux or HUD startup fails, Codex HUD runs the official Codex binary directly with the same arguments and propagates its exit code. The pane starts at the configured maximum height and immediately fits itself to the rendered line count.

## Verification

```bash
pnpm lint --fix
pnpm typecheck
pnpm test
pnpm build
node dist/render-cli.mjs --once --cwd "$PWD" --no-color
node dist/cli.mjs doctor --json
```

Configuration lives at `${CODEX_HOME:-~/.codex}/codex-hud/config.json`. See [README.zh.md](./README.zh.md) for complete usage and architecture notes.

Run `codex-hud configure` for a terminal multiselect that edits the current settings, or use deterministic updates such as:

```bash
codex-hud configure --status --json
codex-hud configure --enable tools,skills,agents --disable memory --yes
```

The running HUD watches the config directory and reloads saved changes in the current Codex session. Inside Codex, use `$codex-hud:setup` for installation and presets, or `$codex-hud:configure` to review and selectively change visible fields. Both are also available through `/skills`.

## Attribution

The layout, configuration model, and portions of the rendering behavior are adapted from Jarrod Watts' MIT-licensed [claude-hud](https://github.com/jarrodwatts/claude-hud). See [NOTICE](./NOTICE).

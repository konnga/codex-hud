# Conversation navigator

The conversation navigator expands the persistent Codex HUD pane into a terminal-native viewer for the current Codex session. It provides logical navigation by user turn without modifying or controlling Codex's own TUI viewport.

## Overview

In its normal state, the HUD shows only the number of recorded user turns and an activation hint:

```text
↕ Turns: 6 · click HUD and press n
```

After activation, the same HUD pane expands and displays a searchable list:

```text
Conversation navigator · 3 turns
#01 22:46 The first user request
#02 22:53 A follow-up question
> #03 22:56 The current request
j/k move · Enter open · / search · q/Esc close
```

Opening a turn shows the complete user message and the corresponding assistant response. Closing the navigator restores the normal HUD height and returns focus to the Codex pane.

## Usage

1. Start a new Codex session through `codex` or `codex-hud` so the current HUD renderer is loaded.
2. Click the HUD pane to focus it.
3. Press `n` or `Enter` to open the navigator.

The navigator is available when the `turns` display element is enabled and the active rollout contains at least one user submission.

### Key bindings

| Context            | Key                       | Action                                  |
| ------------------ | ------------------------- | --------------------------------------- |
| HUD                | `n`, `N`, or `Enter`      | Open the navigator                      |
| Turn list          | `j`, `k`, Up, Down        | Move between matching user turns        |
| Turn list          | `g`, `G`                  | Jump to the first or last matching turn |
| Turn list          | `Enter`, `l`, or Right    | Open the selected turn                  |
| Turn list          | `/`                       | Start incremental search                |
| Search             | `Enter` or `Esc`          | Finish editing the query                |
| Detail             | `j`, `k`, Up, Down        | Scroll one rendered line                |
| Detail             | Page Up, Page Down, Space | Scroll by a page                        |
| Detail             | `h`, Left, or `Esc`       | Return to the turn list                 |
| Any navigator view | `q`                       | Close immediately                       |
| Turn list          | `Esc`                     | Close the navigator                     |

Search matches both user messages and assistant responses. Terminal input chunks are split into logical key events, so rapidly entered keys and multibyte text remain usable.

## Configuration

The navigator hint and activation are controlled by the `turns` guided element:

```bash
codex-hud configure --enable turns --yes
codex-hud configure --disable turns --yes
```

The equivalent JSON setting is:

```json
{
  "display": {
    "showTurns": true
  }
}
```

Full and Essential presets enable the navigator. Minimal disables it.

The expanded navigator uses the existing HUD height limit. Increase it when more visible history is useful:

```bash
codex-hud --hud-height 30
```

The maximum remains 30 rows.

## Data model

The navigator incrementally reads the active `$CODEX_HOME/sessions/**/rollout-*.jsonl` file already bound to the HUD renderer.

- `event_msg.user_message` creates a logical conversation turn.
- The active `turn_id` from turn context becomes the stable logical anchor when available.
- `event_msg.agent_message` updates the assistant side of the current turn.
- Commentary is available while a turn is running; a `final_answer` replaces it when the final response arrives.
- Injected `environment_context`, developer instructions, and other `response_item` records are not treated as user submissions.

Navigation uses logical turns rather than terminal line numbers. This keeps the index stable when terminal width changes, text reflows, or the HUD pane is resized.

## Backend behavior

### cmux

The existing native HUD split expands in place. When the navigator closes, `cmux last-pane` restores the previously focused Codex pane.

### tmux

The existing HUD pane expands in place. When it closes, Codex HUD selects the pane above the HUD pane.

### Other terminals

Other supported terminals use the tmux compatibility backend, so their behavior matches the tmux path. Native Windows terminals without a supported backend do not receive a HUD or navigator.

## Privacy and security

Unlike the compact telemetry HUD, the navigator intentionally reads user and assistant message bodies from the local rollout file.

- Message bodies are shown only after the user focuses the HUD and opens the navigator.
- The compact HUD shows only a turn count, never prompt previews.
- Navigator data is not sent over the network.
- Codex HUD does not create a second transcript file or write message bodies into its configuration.
- Search is performed in renderer memory.

User prompts can contain secrets or private project information. Avoid opening the navigator while screen sharing, recording, or presenting an untrusted terminal session.

## Current limitations

- The navigator does not scroll or reposition Codex's native TUI.
- It displays a separate reconstruction of user and assistant messages from rollout events.
- Tool calls, reasoning records, images, and tool output bodies are not shown in the detail view.
- Navigation is limited to the active root session bound to the HUD. Subagent transcripts are not mixed into the root conversation.
- The HUD pane must be focused before its keyboard shortcuts can receive input.
- An already running renderer does not gain newly installed navigator code; restart Codex after upgrading Codex HUD.

These boundaries keep the feature independent of undocumented Codex TUI internals and preserve compatibility across Codex CLI releases.

---

## 中文说明

会话历史导航器会把常驻 HUD pane 临时展开成终端内的历史查看器。它按照用户轮次进行浏览和搜索，但不会修改或控制 Codex 原生 TUI 的滚动位置。

基本操作：

1. 通过新的 `codex` 或 `codex-hud` 会话启动最新版 renderer。
2. 点击 HUD pane，使其获得键盘焦点。
3. 按 `n` 或 `Enter` 打开导航器。
4. 使用 `j/k` 选择轮次，`Enter` 查看详情，`/` 搜索，`Esc` 或 `q` 退出。

导航器只把 `event_msg.user_message` 识别为真实用户提交，因此不会把环境上下文或 developer 指令列入历史。详情中的 assistant 内容来自相应的 `agent_message`；最终回复到达后会替换执行过程中的 commentary。

隐私边界：紧凑 HUD 只显示轮次数量；完整消息只会在用户主动打开导航器后显示。消息不会上传网络，也不会被复制到新的 transcript 或 HUD 配置文件中。由于用户输入可能包含敏感信息，屏幕共享或录屏时应谨慎打开。

可以通过以下命令开关：

```bash
codex-hud configure --enable turns --yes
codex-hud configure --disable turns --yes
```

当前限制包括：不能让 Codex 原生 TUI 跳转、不会展示工具输出和 reasoning、只浏览当前绑定的根会话，并且必须先聚焦 HUD pane 才能接收快捷键。

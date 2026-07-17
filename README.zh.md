# Codex HUD

Codex HUD 是面向 OpenAI Codex CLI 的常驻终端 HUD，目标是完整复刻 [Claude HUD](https://github.com/jarrodwatts/claude-hud) 的信息密度与使用体验。

它不修改 Codex 二进制。Codex HUD 使用 tmux 在 Codex 输入区下方创建独立 HUD pane，并增量读取 `$CODEX_HOME/sessions/**/rollout-*.jsonl`。上下文百分比采用 Codex 官方的 12,000 token 基线算法，额度窗口直接使用 Codex 写入的 `used_percent`、`window_minutes` 与 `resets_at`。

## 当前能力

- 模型、provider、reasoning effort、项目路径和 Git 状态
- Context 进度条、剩余百分比、当前/累计 token、缓存 token、压缩次数
- 5 小时、周额度、spend control、reset 时间和 credits balance
- 实时工具调用、Skills、MCP server、子 Agent、计划与持久 Goal
- approval、sandbox、collaboration mode、Codex 版本、session ID 和耗时
- compact/expanded 布局、Full/Essential/Minimal 预设
- 英文、简体中文、繁体中文标签
- ANSI/256 色/True Color、宽度裁剪、窄终端适配
- 标准 Codex 插件、setup/configure/doctor 技能
- 可逆安装、可选 `codex` shim、诊断与卸载
- prompt-cache 倒计时、输出速度、session title/auth、Git 文件统计
- 外部额度快照读写、事件驱动刷新和同目录多会话隔离
- HUD pane 根据实际内容自动收缩/增长，不再保留空白行
- tmux 或 HUD 启动失败时自动降级为原生 Codex，不阻断任何 Codex 命令
- 项目/认证/Git/Agent 元数据缓存和受限 V8 heap，降低空闲资源占用

逐项兼容审计见 [Claude HUD 功能对照表](./docs/claude-hud-parity.md)。其中 Claude 专属且 Codex 没有权威数据源的项目（例如 billed cost、advisor）会明确标注，不会用猜测值冒充官方遥测。

## 本地开发安装

```bash
cd /Users/cheng/Documents/code/konnga/codex-hud
pnpm install
pnpm build
node dist/cli.mjs install --codex-shim
codex-hud configure --preset full --language zh-Hans --yes
hash -r
```

之后正常运行：

```bash
codex
```

受管 shim 对 `codex plugin`、`exec`、`login`、`mcp`、`completion`、`--version` 等非互动命令自动直通官方 Codex，只为互动 TUI 会话创建 HUD。

不希望替换 `codex` 命令时，省略 `--codex-shim`，改用：

```bash
codex-hud
```

卸载受管启动器：

```bash
codex-hud uninstall
```

安装器不会覆盖未被 Codex HUD 管理的文件。

## 开发命令

```bash
pnpm lint --fix
pnpm typecheck
pnpm test
pnpm build

node dist/render-cli.mjs --once --cwd "$PWD" --no-color
node dist/cli.mjs doctor --json
node dist/cli.mjs start --detach -- "Reply with exactly HUB-OK"
```

## 配置

默认配置：

```text
${CODEX_HOME:-~/.codex}/codex-hud/config.json
```

快速预设：

```bash
codex-hud configure --preset full --yes
codex-hud configure --preset essential --yes
codex-hud configure --preset minimal --yes
```

常用环境变量：

| 变量                  | 作用                                                     |
| --------------------- | -------------------------------------------------------- |
| `CODEX_HOME`          | Codex 数据与配置目录                                     |
| `CODEX_HUD_CONFIG`    | 覆盖 Hub 配置路径                                        |
| `CODEX_HUD_CODEX_BIN` | 指定真实 Codex 可执行文件，避免 shim 递归                |
| `CODEX_HUD_BIN_DIR`   | 安装启动器的目录，默认 `~/.local/bin`                    |
| `CODEX_HUD_HEIGHT`    | HUD pane 最大高度，默认 5；显式调高后可在 5 到上限间适配 |
| `NO_COLOR`            | 禁用 ANSI 颜色                                           |

Claude HUD 的 `zh` 与 `zh-TW` language 别名也可直接使用，保存时会规范化为 `zh-Hans` 与 `zh-Hant`。完整高级配置项与支持边界见功能对照表。

## Codex 插件

仓库包含标准插件：

```text
plugins/codex-hud/
```

技能：

- `$codex-hud:setup`
- `$codex-hud:doctor`

在 Codex 会话中直接输入 `$codex-hud:setup` 可以完成安装或显示配置；也可以输入 `/skills`，然后选择 **Set Up Codex HUD**。底层 `codex-hud configure` CLI 命令仍然保留，由 setup Skill 调用。

插件 runtime 会在 `pnpm build` 后同步到 `plugins/codex-hud/runtime/`。

## 为什么使用 tmux

Claude Code 提供可执行自定义 statusline renderer；Codex CLI 当前只提供固定字段的 `tui.status_line`，插件不能直接注入任意多行 TUI footer。Codex HUD 因此使用独立 tmux pane，保持官方 Codex 二进制不变，同时支持工具、Agent 和任务活动等多行信息。

HUD 是纯附加层：tmux 不可用、pane 创建失败或 renderer 异常时，启动器会直接运行官方 Codex 并保留原始参数与退出码。Full 预设默认聚焦日常信息；系统内存、配置计数、Session ID、开始日期和详细 Token 等诊断字段仍可在配置中单独开启。

## 隐私与安全

- HUD 只读取本地 Codex rollout、配置元数据和 Git 状态。
- 渲染器不显示用户 prompt、模型回复正文或工具输出正文。
- 所有显示文本都会移除终端控制字符。
- 安装器只删除 `install.json` 中记录的受管文件。
- `--no-hud` 可绕过 tmux 并直接运行官方 Codex。

## 致谢

布局、配置模型和部分渲染行为基于 Jarrod Watts 的 MIT 许可项目 [claude-hud](https://github.com/jarrodwatts/claude-hud) 进行 Codex 适配。详见 [NOTICE](./NOTICE)。

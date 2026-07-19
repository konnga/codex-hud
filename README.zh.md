# Codex HUD

> 🌐 [English](./README.md) | 中文文档

Codex HUD 是面向 OpenAI Codex CLI 的常驻终端 HUD，集中展示上下文、额度、Git 状态、工具活动、Agent、任务与会话信息。

它不修改 Codex 二进制。Codex HUD 在 Codex 输入区下方创建独立 HUD pane，并增量读取 `$CODEX_HOME/sessions/**/rollout-*.jsonl`。在 cmux 中使用原生 split，使 Codex 保留原生滚动与复制；其他终端保留 tmux 兼容 backend。上下文百分比采用 Codex 官方的 12,000 token 基线算法，额度窗口直接使用 Codex 写入的 `used_percent`、`window_minutes` 与 `resets_at`。

## 完整展示效果

启用 Full 预设且当前会话存在相应遥测数据时，HUD 会展开显示模型与项目、上下文和额度、运行环境、实时活动及会话状态：

```text
[gpt-5.5 high] │ codex-hud +shared git:(main* ↑1) │ ChatGPT pro (builder)
上下文 ██████░░░░ 59% │ 额度 5h: ███░░░░░░░ 25% (重置于 1h 30m) │ 1w: ████████░░ 82% (重置于 4d) │ $12.50
缓存有效期 ⏱️ 5m
审批: on-request │ 权限: workspace-write │ 沙箱: workspace-write
🛠️ 工具: ◐ exec_command: pnpm test │ ✓ view_image ×1
🧩 ✓ 技能 (2): openai-docs, plugin-creator
🔌 ✓ MCP (1): github
🤖 ◐ explorer: 检查协议 (2m)
📋 ▸ 渲染 HUD (1/3)
↕ 轮次: 3 · 点击 HUD 后按 n 导航
⏱️ 1h │ 压缩: 1
```

实际终端效果（tmux）：

![Codex HUD tmux 示例](./docs/assets/codex-hud-tmux-example.png)

没有可用遥测数据的行会自动隐藏；没有活动计划时，任务行会改为展示持久 Goal。

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
- 终端原生会话历史导航，可直接在 HUD pane 中浏览和搜索用户轮次
- HUD backend 启动失败时自动降级为原生 Codex，不阻断任何 Codex 命令
- 项目/认证/Git/Agent 元数据缓存和受限 V8 heap，降低空闲资源占用

逐项功能与遥测审计见 [支持矩阵](./docs/claude-hud-parity.md)。Codex 没有权威数据源的项目会明确标注，不会用猜测值冒充官方遥测。

## 使用前准备

需要以下环境：

- Node.js 20 或更高版本
- OpenAI Codex CLI，并确保官方 `codex` 命令可以正常运行
- cmux 0.64 或更高版本，或者作为兼容 backend 的 tmux
- 从源码构建时需要 pnpm 10

常见系统可以这样安装 tmux：

```bash
# macOS
brew install tmux

# Debian / Ubuntu
sudo apt install tmux

# Arch Linux
sudo pacman -S tmux
```

在 cmux 中不需要安装 tmux。其他终端使用 tmux 兼容 backend；没有可用 backend 时，Codex HUD 会运行原生 Codex，不会阻断命令，但不会显示 HUD。

### Windows 支持

原生 Windows shell 目前不能使用完整 HUD。PowerShell、CMD 和原生 Windows Terminal 会话没有受支持的 cmux/tmux backend，而且当前受管安装器生成的是 POSIX shell launcher，不是 `.cmd` 或 PowerShell wrapper。Codex 仍会安全启动，但不会显示 HUD。

WSL2 可以作为 Linux 环境使用。Node.js、Codex CLI、tmux 和 Codex HUD 必须安装在同一个 WSL distribution 中：

```bash
sudo apt update
sudo apt install tmux
tmux -V
```

不要混用 Windows 版 Codex 与 WSL 中的 tmux 或 launcher。Git Bash 和 MSYS2 尚未测试，也不属于当前支持范围。

## 推荐安装（Codex 插件）

Codex CLI 使用 shell 中的 `codex plugin` 命令管理 marketplace 和插件。

第一步，添加 Codex HUD marketplace：

```bash
codex plugin marketplace add konnga/codex-hud
```

`konnga/codex-hud` 是 GitHub shorthand，Codex 会从下面的仓库默认分支拉取 marketplace 快照：

```text
https://github.com/konnga/codex-hud.git
```

这一步只添加 marketplace，还没有安装插件。

第二步，安装插件：

```bash
codex plugin add codex-hud@codex-hud
```

其中前一个 `codex-hud` 是插件名，`@` 后面的 `codex-hud` 是 `.agents/plugins/marketplace.json` 中声明的 marketplace 名。

可以使用以下命令确认 marketplace 和插件是否已经被正确识别：

```bash
codex plugin marketplace list --json
codex plugin list --marketplace codex-hud --available --json
```

第三步，打开一个新的 Codex 会话，在会话中输入：

```text
$codex-hud:setup
```

也可以输入 `/skills`，然后选择 Codex HUD 的 setup Skill。setup 会安装受管启动器，以 Full 为首次配置基线，并引导选择需要显示的字段。

> **当前会话不会立即出现 HUD。** setup 只负责安装启动器和写入配置，无法把 cmux/tmux HUD pane 注入已经运行的 Codex TUI。必须退出当前 Codex，并通过新的 `codex` 或 `codex-hud` 进程启动 HUD。

setup 完成后退出并重新启动 Codex：

```bash
hash -r
codex
```

`hash -r` 只刷新当前 shell 缓存的命令路径，不会重新加载正在运行的 Codex 会话。cmux 用户不需要安装 tmux；其他终端可以安装 tmux 兼容 backend：

```bash
brew install tmux
hash -r
tmux -V
codex
```

完整安装流程：

```text
添加 marketplace → 安装 plugin → 运行 setup Skill → 重启 Codex
```

> 安装命令读取的是 GitHub 远端内容，而不是当前机器尚未提交的工作区。维护者必须先提交并推送 `.agents/plugins/marketplace.json`、`plugins/codex-hud/` 和构建后的 runtime，用户才能安装到最新版本。

如果之前安装过旧的 `personal` marketplace，可以先移除后重新添加：

```bash
codex plugin remove codex-hud@personal
codex plugin marketplace remove personal
codex plugin marketplace add konnga/codex-hud
codex plugin add codex-hud@codex-hud
```

### 插件 Skills

插件提供三个 Skill，可以直接输入名称，也可以从 `/skills` 中选择：

- `$codex-hud:setup`：安装或升级受管 launcher，并启动首次显示配置。
- `$codex-hud:configure`：打开显示项选择器，同时保留高级配置覆盖。
- `$codex-hud:doctor`：检查 launcher、backend、配置、插件和当前 session。

底层 `codex-hud configure` CLI 提供相同的交互式选择器，以及确定性的 `--enable` 和 `--disable` 更新方式。

## 从源码安装（开发者）

```bash
cd codex-hud
pnpm install
pnpm build
node dist/cli.mjs setup --codex-shim --language zh-Hans
hash -r
```

`setup` 是推荐入口，它会：

1. 安装受管的 `codex-hud` 与 `codex-hud-render` 启动器。
2. 使用 `--codex-shim` 时安装透明的 `codex` 启动器。
3. 首次配置以 Full 为基线打开显示项选择面板。
4. 显示实时预览并保存到 `${CODEX_HOME:-~/.codex}/codex-hud/config.json`。

如果 `~/.local/bin` 不在 `PATH` 中，将下面一行加入 shell 配置：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

之后正常运行：

```bash
codex
```

Codex 参数保持原样，例如：

```bash
codex --model gpt-5.5
codex -C /path/to/project
codex resume --last
```

受管 shim 对 `codex plugin`、`exec`、`login`、`mcp`、`completion`、`--version` 等非互动命令自动直通官方 Codex，只为互动 TUI 会话创建 HUD。

不希望替换 `codex` 命令时，省略 `--codex-shim`，改用：

```bash
node dist/cli.mjs setup --language zh-Hans
hash -r
codex-hud
codex-hud -- --model gpt-5.5
```

`setup` 会保留已经存在的配置；只有显式指定 `--preset` 才会重置常用显示项。自动化或非交互安装可以使用：

```bash
codex-hud setup --codex-shim --preset full --language zh-Hans --yes
```

只安装启动器而不打开配置流程时，可以使用底层命令：

```bash
codex-hud install --codex-shim
```

安装器不会覆盖未被 Codex HUD 管理的文件。

## 日常使用

安装 `codex` shim 后，正常使用 Codex 即可：

```bash
codex
codex resume --last
codex -C /path/to/project
```

只为互动 TUI 会话创建 HUD。`codex exec`、`plugin`、`login`、`mcp`、`completion`、`--help` 和 `--version` 等命令会直接运行官方 Codex。

临时绕过 HUD：

```bash
codex --no-hud
codex-hud --no-hud -- --model gpt-5.5
```

指定工作目录和 HUD 最大高度：

```bash
codex-hud --cwd /path/to/project --hud-height 12
codex-hud --backend cmux
codex-hud --backend tmux
```

单次查看当前 HUD 的纯文本渲染：

```bash
codex-hud render --once --cwd "$PWD" --no-color
```

### 会话历史导航

HUD 出现“轮次”行后，点击 HUD pane 并按 `n`，HUD 会展开为会话历史导航器。导航器读取当前 Codex rollout，只列出真实的用户提交，不会把注入的环境上下文或 developer 指令当作用户输入。

- `j` / `k` 或方向键：选择上一轮、下一轮用户输入
- `Enter` 或右方向键：打开选中的完整轮次
- `/`：搜索用户输入和助手回复
- `j` / `k`、Page Up、Page Down：滚动已打开的轮次
- `Esc`：先返回轮次列表，再关闭导航器
- `q`：立即关闭导航器

关闭后 HUD 会恢复原来的紧凑高度，并把焦点交回 Codex pane。导航器不会控制或改变 Codex 原生 TUI 的滚动位置。

数据来源、隐私边界、backend 行为和当前限制见[会话历史导航文档](./docs/conversation-navigator.md)。

`--detach` 主要用于自动化和烟雾测试，它会在后台启动会话而不附加当前终端。

## 配置显示内容

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

首次运行 `codex-hud setup` 会以 Full 为基线打开显示项选择面板并提供实时预览。之后直接运行 `codex-hud configure` 会从当前配置开始编辑。也可以查询或精确更新指定字段：

```bash
codex-hud configure --status --json
codex-hud configure --enable tools,skills,agents --disable memory --yes
```

选择面板按 Project、Usage、Activity、Environment 和 Session 分类。可用于 `--enable` / `--disable` 的字段名称如下：

| 名称            | 显示内容                       |
| --------------- | ------------------------------ |
| `git`           | Git 分支和工作区状态           |
| `usage`         | 额度窗口、reset 时间和 credits |
| `promptCache`   | Prompt Cache 倒计时            |
| `tools`         | 工具调用活动                   |
| `skills`        | Skills 活动                    |
| `mcp`           | MCP server 活动                |
| `agents`        | 子 Agent 状态                  |
| `todos`         | 计划与任务进度                 |
| `goal`          | 持久 Goal                      |
| `turns`         | 会话轮次数量与导航提示         |
| `configCounts`  | 配置、规则、Skill 和 MCP 数量  |
| `auth`          | 认证方式                       |
| `memory`        | 近似系统内存                   |
| `duration`      | 会话持续时间                   |
| `speed`         | 上一次回复的输出速度           |
| `sessionName`   | 显式命名的会话标题             |
| `sessionTokens` | 会话累计 Token                 |
| `compactions`   | Context 压缩次数               |

示例：

```bash
# 打开工具、Skills 和 Agent，关闭内存与输出速度
codex-hud configure --enable tools,skills,agents --disable memory,speed --yes

# 切换布局或语言，同时保留其他配置
codex-hud configure --layout compact --language zh-Hans

# 重置为 Full 后再进入选择面板
codex-hud configure --preset full
```

配置保存后，**已经存在 HUD pane** 的会话会监听配置目录并自动刷新，无需重启 Codex。配置热更新不能为未经过 Codex HUD launcher 启动的现有会话创建 HUD pane；这种情况仍然需要退出并重新启动 Codex。

默认 `auto` backend 选择顺序是：交互式 cmux surface 且 control socket 健康时使用 cmux 原生 split；已经位于用户 tmux 中时使用该 tmux；其他终端使用私有 tmux 兼容 backend。cmux socket 异常时会直接运行原生 Codex，不会静默回退到 tmux。可以使用 `--backend cmux|tmux|none` 显式覆盖。

cmux backend 让 Codex 保持在原 surface，只在下方创建不抢焦点的 HUD split，因此保留原生 scrollback、选择和复制。tmux backend 无法提供完全一致的终端原生语义；在用户自己的 tmux 中启动时，Codex HUD 不修改其 tmux 选项。

Codex HUD 使用 cmux 0.64 的方向式 pane resize API（`--pane`、`-U` / `-D` 和 `--amount`）。仍调用 tmux 风格 `-t ... -y ...` 参数的旧版 Codex HUD 会以 `Pane has no adjacent border in direction right` 错误安全降级为无 HUD 的原生 Codex；遇到该错误时应先重新构建或升级 Codex HUD，再启动新会话。

常用环境变量：

| 变量                  | 作用                                                             |
| --------------------- | ---------------------------------------------------------------- |
| `CODEX_HOME`          | Codex 数据与配置目录                                             |
| `CODEX_HUD_CONFIG`    | 覆盖 HUD 配置路径                                                |
| `CODEX_HUD_CODEX_BIN` | 指定真实 Codex 可执行文件，避免 shim 递归                        |
| `CODEX_HUD_BIN_DIR`   | 安装启动器的目录，默认`~/.local/bin`                             |
| `CODEX_HUD_HEIGHT`    | HUD pane 最大高度，默认 30；pane 从 5 行启动并按完整内容自动适配 |
| `NO_COLOR`            | 禁用 ANSI 颜色                                                   |

`zh` 与 `zh-TW` language 别名也可直接使用，保存时会规范化为 `zh-Hans` 与 `zh-Hant`。完整高级配置项与支持边界见功能对照表。

## 诊断

检查 Codex、tmux、配置、插件和当前 session：

```bash
codex-hud doctor
codex-hud doctor --json --cwd "$PWD"
```

HUD 没有内容时，可以先检查一次渲染结果：

```bash
codex-hud render --once --cwd "$PWD" --no-color
```

常见情况：

- `tmux: not found`：安装 tmux 后重新启动 Codex。
- setup 成功但当前会话没有 HUD：这是正常行为；退出当前 Codex，再运行 `codex` 或 `codex-hud`。
- `Session: not found`：确保 Codex 与 doctor 使用相同的真实项目目录。
- 安装后命令仍指向旧路径：运行 `hash -r` 或打开新终端。
- 需要临时恢复原生行为：使用 `codex --no-hud`。

## 卸载

卸载只删除 `install.json` 中登记且仍带有 Codex HUD 标记的启动器：

```bash
codex-hud uninstall
codex-hud uninstall --dry-run
```

配置文件和 Codex 自身数据不会被删除。

如果通过 Codex plugin 安装，还可以继续移除插件和 marketplace：

```bash
codex plugin remove codex-hud@codex-hud
codex plugin marketplace remove codex-hud
```

插件移除不会自动删除 setup 创建的启动器，因此建议先运行 `codex-hud uninstall`。

## 为什么使用独立 pane

Claude Code 提供可执行自定义 statusline renderer；Codex CLI 当前只提供固定字段的 `tui.status_line`，插件不能直接注入任意多行 TUI footer。Codex HUD 因此使用独立 pane：cmux 中使用原生 split，其他环境使用 tmux 兼容 backend，同时保持官方 Codex 二进制不变。

HUD 是纯附加层：backend 不可用、pane 创建失败或 renderer 异常时，启动器会直接运行官方 Codex 并保留原始参数与退出码。Full 预设默认聚焦日常信息；系统内存、配置计数、Session ID、开始日期和详细 Token 等诊断字段仍可在配置中单独开启。

## 隐私与安全

- HUD 只读取本地 Codex rollout、配置元数据和 Git 状态。
- 渲染器不显示用户 prompt、模型回复正文或工具输出正文。
- 所有显示文本都会移除终端控制字符。
- 安装器只删除 `install.json` 中记录的受管文件。
- `--no-hud` 可绕过 tmux 并直接运行官方 Codex。

## 开发与验证

```bash
pnpm lint --fix
pnpm typecheck
pnpm test
pnpm build

node dist/render-cli.mjs --once --cwd "$PWD" --no-color
node dist/cli.mjs doctor --json
node dist/cli.mjs start --detach -- "Reply with exactly HUD-OK"
```

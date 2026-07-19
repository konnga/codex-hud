# 版本与发布流程

Codex HUD 以 `package.json` 作为公开[语义化版本](https://semver.org/lang/zh-CN/)的唯一来源。插件 manifest 使用相同基础版本，并附加 Codex cachebuster：

```text
<semver>+codex.<UTC 时间戳>
```

例如，产品版本 `0.2.0` 对应的插件版本可以是 `0.2.0+codex.20260719143000`。后缀只用于使 Codex 插件缓存失效，不代表另一个产品版本。

## 版本规则

- Patch：向后兼容的修复和文档修正。
- Minor：向后兼容的新功能、新 HUD 字段或 backend 能力。
- Major：不兼容的配置、launcher 或行为变更。
- 尚未发布的用户可见变更统一记录在 `CHANGELOG.md` 的 `## [Unreleased]` 下。
- 本地开发只需要刷新插件时，不要增加 SemVer，应该只更新 cachebuster。

## 准备发布

1. 确认 `CHANGELOG.md` 的 `## [Unreleased]` 已完整记录本次变化。
2. 选择下一个 SemVer，然后运行：

   ```bash
   pnpm release:prepare 0.2.0
   ```

   该命令会同步更新 `package.json`，为插件 manifest 写入相同基础版本和新的 cachebuster，并把待发布 CHANGELOG 内容移动到带日期的版本章节。

3. 完成发布验证：

   ```bash
   pnpm release:check
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   git diff --check
   ```

4. 检查并提交源代码、构建 runtime、manifest 和文档：

   ```bash
   git add -A
   git commit -m "release: v0.2.0"
   git tag -a v0.2.0 -m "Codex HUD v0.2.0"
   git push origin main --follow-tags
   ```

推送 tag 后会触发 `.github/workflows/release.yml`。该 workflow 会校验 tag，运行完整测试与构建，生成 package 和 plugin 压缩包及 `SHA256SUMS`，从 CHANGELOG 提取对应版本说明，并创建 GitHub Release。对同一 tag 重新运行 workflow 时，会更新已有 Release 并替换附件。

Git tag、`package.json`、插件 manifest 的基础版本和 CHANGELOG 版本标题必须一致。版本校验、测试或构建失败时不会发布 GitHub Release。

## 刷新开发版本

如果 SemVer 不需要改变，但需要让 Codex 重新安装修改后的插件内容，运行：

```bash
pnpm release:cachebuster
codex plugin add codex-hud@codex-hud
```

重新安装后需要启动新的 Codex 会话，更新后的 Skill 和 runtime 才会被发现。

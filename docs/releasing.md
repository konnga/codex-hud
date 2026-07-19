# Versioning and releases

Codex HUD uses `package.json` as the single source of truth for its public [Semantic Version](https://semver.org/). The plugin manifest uses the same base version with a Codex cachebuster suffix:

```text
<semver>+codex.<UTC timestamp>
```

For example, package version `0.2.0` can be installed as plugin version `0.2.0+codex.20260719143000`. The suffix only invalidates the Codex plugin cache; it is not a separate product version.

## Release policy

- Patch: backward-compatible fixes and documentation corrections.
- Minor: backward-compatible features, new HUD fields, or backend capabilities.
- Major: incompatible configuration, launcher, or behavior changes.
- Keep pending user-visible changes under `## [Unreleased]` in `CHANGELOG.md`.
- Do not increment SemVer only to refresh an installed plugin during development; refresh the cachebuster instead.

## Prepare a release

1. Confirm that `CHANGELOG.md` has complete entries under `## [Unreleased]`.
2. Choose the next SemVer and run:

   ```bash
   pnpm release:prepare 0.2.0
   ```

   This updates `package.json`, updates the plugin manifest with the same base version and a fresh cachebuster, and moves the pending changelog entries into a dated release section.

3. Validate the release:

   ```bash
   pnpm release:check
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   git diff --check
   ```

4. Review and commit all source, generated runtime, manifest, and documentation changes:

   ```bash
   git add -A
   git commit -m "release: v0.2.0"
   git tag -a v0.2.0 -m "Codex HUD v0.2.0"
   git push origin main --follow-tags
   ```

Pushing the tag triggers `.github/workflows/release.yml`. It validates the tag, runs the complete test/build suite, creates package and plugin archives with `SHA256SUMS`, extracts the matching CHANGELOG section, and creates the GitHub Release. Re-running the workflow for the same tag updates the existing Release and replaces its assets.

The Git tag, `package.json`, plugin manifest base version, and changelog release heading must agree. A failed validation or build prevents the GitHub Release from being published.

## Refresh a development build

When the SemVer should remain unchanged but Codex needs to reinstall modified plugin content, run:

```bash
pnpm release:cachebuster
codex plugin add codex-hud@codex-hud
```

Start a new Codex session after reinstalling so updated Skills and runtime files are discovered.

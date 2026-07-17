# Security

Report vulnerabilities privately to the repository owner before opening a public issue.

Codex HUD reads local Codex rollout files and configuration metadata. It intentionally does not render prompt bodies, assistant message bodies, or tool output bodies. Display strings are sanitized before terminal output.

The installer refuses to overwrite unmanaged launchers and records every managed path in `${CODEX_HOME:-~/.codex}/codex-hud/install.json`. Uninstall removes a recorded launcher only while its Codex HUD marker is still present, so a user-replaced file is preserved.

Optional external usage snapshots must use absolute `.json` paths. Written snapshots use private file permissions on POSIX systems. Authentication detection reports only the method and an optional non-secret account label; API keys and access tokens are never rendered.

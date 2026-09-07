# Notes

## 2026-09-06

- Account quota reads can work in a shell but fail after a cmux HUD pane respawn: GUI panes can inherit a minimal PATH with a Codex forwarding script but without Homebrew. The quota reader must prefer the configured or managed Codex executable and provide the running HUD's Node directory for npm's launcher.

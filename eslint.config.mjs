import antfu from '@antfu/eslint-config'

export default antfu({
  formatters: true,
  ignores: [
    'dist/**',
    'coverage/**',
    'plugins/codex-hud/assets/**',
    'plugins/codex-hud/runtime/**',
    'plugins/codex-hud-desktop/runtime/**',
  ],
  typescript: true,
})

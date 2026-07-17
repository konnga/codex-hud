import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'cli': 'src/cli.ts',
    'render-cli': 'src/render-cli.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  minify: false,
  shims: true,
  deps: {
    alwaysBundle: [
      '@clack/prompts',
      'slice-ansi',
      'smol-toml',
      'string-width',
      'strip-ansi',
    ],
  },
  failOnWarn: 'ci-only',
  publint: false,
  attw: false,
})

import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'cli': 'src/cli.ts',
    'mcp-server': 'src/mcp-server.ts',
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
      '@modelcontextprotocol/ext-apps',
      '@modelcontextprotocol/sdk',
      'slice-ansi',
      'smol-toml',
      'string-width',
      'strip-ansi',
      'zod',
    ],
  },
  failOnWarn: 'ci-only',
  publint: false,
  attw: false,
})

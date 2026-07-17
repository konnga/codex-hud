#!/usr/bin/env node
// @env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const candidates = [
  path.join(pluginRoot, 'runtime', 'cli.mjs'),
  path.resolve(pluginRoot, '..', '..', 'dist', 'cli.mjs'),
]
const cli = candidates.find(candidate => fs.existsSync(candidate))
if (!cli) {
  console.error('Codex HUD runtime is missing. Rebuild or reinstall the plugin.')
  process.exit(1)
}

const action = process.argv[2] ?? 'doctor'
const extraArgs = process.argv.slice(3)
const args = action === 'setup'
  ? ['install', '--codex-shim', ...extraArgs]
  : action === 'configure' ? ['configure', ...extraArgs] : ['doctor', ...extraArgs]
const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' })
process.exit(result.status ?? 1)

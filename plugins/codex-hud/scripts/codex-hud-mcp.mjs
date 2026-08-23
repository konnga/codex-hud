#!/usr/bin/env node
// @env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const candidates = [
  path.join(pluginRoot, 'runtime', 'mcp-server.mjs'),
  path.resolve(pluginRoot, '..', '..', 'dist', 'mcp-server.mjs'),
]
const server = candidates.find(candidate => fs.existsSync(candidate))
if (!server) {
  console.error('Codex HUD MCP runtime is missing. Rebuild or reinstall the plugin.')
  process.exit(1)
}

const child = spawn(process.execPath, [server, ...process.argv.slice(2)], {
  env: process.env,
  stdio: 'inherit',
})
child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal)
    process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})

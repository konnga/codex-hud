// @env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const source = path.join(root, 'dist')
const target = path.join(root, 'plugins', 'codex-hud', 'runtime')
const desktopTarget = path.join(root, 'plugins', 'codex-hud-desktop', 'runtime')

fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })
for (const file of fs.readdirSync(source)) {
  if (!file.startsWith('mcp-server.'))
    fs.cpSync(path.join(source, file), path.join(target, file))
}

fs.rmSync(desktopTarget, { recursive: true, force: true })
fs.mkdirSync(desktopTarget, { recursive: true })
for (const file of fs.readdirSync(source)) {
  if (!file.startsWith('cli.') && !file.startsWith('render-cli.'))
    fs.cpSync(path.join(source, file), path.join(desktopTarget, file))
}

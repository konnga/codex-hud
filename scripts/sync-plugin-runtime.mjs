// @env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const source = path.join(root, 'dist')
const target = path.join(root, 'plugins', 'codex-hud', 'runtime')

fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(source, target, { recursive: true })

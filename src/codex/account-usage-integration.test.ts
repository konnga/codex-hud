import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { refreshAccountUsage } from './account-usage.js'

const directories: string[] = []
afterEach(() => {
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
})

describe('quota reader in a GUI terminal', () => {
  it.skipIf(process.platform === 'win32')('bypasses a terminal wrapper and finds Node with a minimal PATH', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-gui-quota-'))
    directories.push(home)
    const wrappers = path.join(home, 'cmux-cli-shims')
    fs.mkdirSync(wrappers)
    fs.mkdirSync(path.join(home, 'codex-hud'))
    // Taking the PATH wrapper would fail; only the managed absolute path works.
    fs.writeFileSync(path.join(wrappers, 'codex'), '#!/bin/sh\nexit 42\n', { mode: 0o755 })
    const executable = path.join(home, 'real-codex.mjs')
    fs.writeFileSync(executable, `#!/usr/bin/env node
import readline from 'node:readline'
const lines = readline.createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  const result = message.method === 'initialize' ? {}
    : message.method === 'account/read' ? { account: { type: 'chatgpt' } }
    : { rateLimits: { limitId: 'codex', primary: { usedPercent: 65, windowDurationMins: 10080 } } }
  process.stdout.write(JSON.stringify({ id: message.id, result }) + '\\n')
})
`, { mode: 0o755 })
    fs.writeFileSync(path.join(home, 'codex-hud', 'install.json'), JSON.stringify({
      version: 2,
      realCodex: executable,
      managedFiles: [],
    }))
    fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ tokens: {
      account_id: 'fixture-workspace',
      access_token: 'fixture-token',
    } }))
    const result = await refreshAccountUsage('https://chatgpt.com', {
      CODEX_HOME: home,
      PATH: [wrappers, '/usr/bin', '/bin'].join(path.delimiter),
    })
    expect(result).toMatchObject({ enabled: true, failed: false, usage: { source: 'account', primary: { percent: 65 } } })
  })
})

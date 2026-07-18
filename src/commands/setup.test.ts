import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getConfigPath } from '../config/paths.js'
import { runSetup } from './setup.js'

const directories: string[] = []
const originalEnv = { ...process.env }

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, originalEnv)
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
})

function environment(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-setup-'))
  directories.push(root)
  const realCodex = path.join(root, 'real-codex')
  fs.writeFileSync(realCodex, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  process.env.CODEX_HOME = path.join(root, 'codex-home')
  process.env.CODEX_HUD_BIN_DIR = path.join(root, 'bin')
  process.env.CODEX_HUD_CODEX_BIN = realCodex
}

describe('codex HUD setup', () => {
  it('uses Full as the first-run configuration in non-interactive setup', async () => {
    environment()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    expect(await runSetup(['--codex-shim', '--yes'])).toBe(0)
    expect(output).toHaveBeenCalledWith(expect.stringContaining(
      'The current Codex session cannot gain a HUD pane',
    ))

    const config = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'))
    expect(config.display.showTools).toBe(true)
    expect(config.display.showSkills).toBe(true)
    expect(config.display.showMcp).toBe(true)
    expect(config.display.showAgents).toBe(true)
    expect(config.display.showPromptCache).toBe(true)

    config.display.showMemoryUsage = true
    fs.writeFileSync(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`)
    expect(await runSetup(['--codex-shim', '--yes'])).toBe(0)
    const preserved = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'))
    expect(preserved.display.showMemoryUsage).toBe(true)
  })
})

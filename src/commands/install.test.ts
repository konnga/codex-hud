import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { runInstall, runUninstall } from './install.js'

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

function environment(): { root: string, bin: string, realCodex: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-install-'))
  directories.push(root)
  const bin = path.join(root, 'bin')
  const realCodex = path.join(root, 'real-codex')
  fs.writeFileSync(realCodex, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  process.env.CODEX_HOME = path.join(root, 'codex-home')
  process.env.CODEX_HUD_BIN_DIR = bin
  process.env.CODEX_HUD_CODEX_BIN = realCodex
  return { root, bin, realCodex }
}

describe('managed installer', () => {
  it('installs and reversibly removes marked launchers', () => {
    const { bin } = environment()
    expect(runInstall(['--codex-shim'])).toBe(0)
    for (const name of ['codex-hud', 'codex-hud-render', 'codex']) {
      expect(fs.readFileSync(path.join(bin, name), 'utf8')).toContain('# Managed by Codex HUD')
    }
    expect(runUninstall([])).toBe(0)
    expect(fs.existsSync(path.join(bin, 'codex-hud'))).toBe(false)
    expect(fs.existsSync(path.join(bin, 'codex'))).toBe(false)
  })

  it('does not overwrite or delete an unmanaged replacement', () => {
    const { bin } = environment()
    fs.mkdirSync(bin, { recursive: true })
    fs.writeFileSync(path.join(bin, 'codex-hud'), '#!/bin/sh\necho mine\n')
    expect(() => runInstall([])).toThrow(/Refusing to overwrite unmanaged file/)
    fs.rmSync(path.join(bin, 'codex-hud'))
    runInstall([])
    fs.writeFileSync(path.join(bin, 'codex-hud'), '#!/bin/sh\necho replaced\n')
    runUninstall([])
    expect(fs.readFileSync(path.join(bin, 'codex-hud'), 'utf8')).toContain('replaced')
  })

  it('removes a previously managed optional shim when reinstalled without it', () => {
    const { bin } = environment()
    runInstall(['--codex-shim'])
    expect(fs.existsSync(path.join(bin, 'codex'))).toBe(true)
    runInstall([])
    expect(fs.existsSync(path.join(bin, 'codex'))).toBe(false)
  })

  it('migrates legacy state and replaces legacy managed launchers', () => {
    const { bin, realCodex } = environment()
    const legacyState = path.join(process.env.CODEX_HOME!, 'codex-hub')
    fs.mkdirSync(bin, { recursive: true })
    fs.mkdirSync(legacyState, { recursive: true })
    const legacyFiles = ['codex-hub', 'codex-hub-render', 'codex'].map(name => path.join(bin, name))
    for (const file of legacyFiles) {
      fs.writeFileSync(file, '#!/bin/sh\n# Managed by Codex Hub\nexit 0\n', { mode: 0o755 })
    }
    fs.writeFileSync(path.join(legacyState, 'config.json'), '{"preset":"full"}\n')
    fs.writeFileSync(path.join(legacyState, 'install.json'), JSON.stringify({
      version: 1,
      realCodex,
      managedFiles: legacyFiles,
    }))

    expect(runInstall(['--codex-shim'])).toBe(0)

    expect(fs.existsSync(path.join(process.env.CODEX_HOME!, 'codex-hud', 'config.json'))).toBe(true)
    expect(fs.readFileSync(path.join(bin, 'codex'), 'utf8')).toContain('# Managed by Codex HUD')
    expect(fs.existsSync(path.join(bin, 'codex-hub'))).toBe(false)
    expect(fs.existsSync(path.join(bin, 'codex-hub-render'))).toBe(false)
  })
})

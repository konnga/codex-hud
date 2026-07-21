import { spawnSync } from 'node:child_process'
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

function writeRuntime(directory: string, marker: string, obsolete = false): void {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'shared.mjs'), `export const marker = ${JSON.stringify(marker)}\n`)
  fs.writeFileSync(path.join(directory, 'cli.mjs'), [
    `import { marker } from './shared.mjs'`,
    `process.stdout.write(\`runtime:\${marker} args:\${process.argv.slice(2).join(',')}\\n\`)`,
  ].join('\n'))
  fs.writeFileSync(path.join(directory, 'render-cli.mjs'), `import './shared.mjs'\n`)
  if (obsolete) {
    fs.writeFileSync(path.join(directory, 'obsolete.mjs'), 'export {}\n')
  }
}

function environment(): { root: string, bin: string, realCodex: string, runtime: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-install-'))
  directories.push(root)
  const bin = path.join(root, 'bin')
  const realCodex = path.join(root, 'real-codex')
  const runtime = path.join(root, 'plugin-cache', 'runtime')
  fs.writeFileSync(realCodex, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  writeRuntime(runtime, 'v1', true)
  process.env.CODEX_HOME = path.join(root, 'codex-home')
  process.env.CODEX_HUD_BIN_DIR = bin
  process.env.CODEX_HUD_CODEX_BIN = realCodex
  process.env.CODEX_HUD_RUNTIME_DIR = runtime
  return { root, bin, realCodex, runtime }
}

describe('managed installer', () => {
  it('installs and reversibly removes marked launchers', () => {
    const { bin, runtime } = environment()
    expect(runInstall(['--codex-shim'])).toBe(0)
    const stableRuntime = path.join(process.env.CODEX_HOME!, 'codex-hud', 'runtime')
    for (const name of ['codex-hud', 'codex-hud-render', 'codex']) {
      const launcher = fs.readFileSync(path.join(bin, name), 'utf8')
      expect(launcher).toContain('# Managed by Codex HUD')
      expect(launcher).toContain(stableRuntime)
      expect(launcher).not.toContain(runtime)
    }
    fs.rmSync(path.dirname(runtime), { recursive: true, force: true })
    const launched = spawnSync(path.join(bin, 'codex'), ['--no-hud', '--version'], { encoding: 'utf8' })
    expect(launched.status).toBe(0)
    expect(launched.stdout).toContain('runtime:v1 args:--no-hud,--version')
    expect(runUninstall([])).toBe(0)
    expect(fs.existsSync(path.join(bin, 'codex-hud'))).toBe(false)
    expect(fs.existsSync(path.join(bin, 'codex'))).toBe(false)
    expect(fs.existsSync(stableRuntime)).toBe(false)
  })

  it('atomically replaces the managed runtime and removes obsolete artifacts', () => {
    const { runtime } = environment()
    runInstall(['--codex-shim'])
    const stableRuntime = path.join(process.env.CODEX_HOME!, 'codex-hud', 'runtime')
    expect(fs.existsSync(path.join(stableRuntime, 'obsolete.mjs'))).toBe(true)

    fs.rmSync(runtime, { recursive: true, force: true })
    writeRuntime(runtime, 'v2')
    fs.writeFileSync(path.join(runtime, 'new-chunk.mjs'), 'export {}\n')
    runInstall(['--codex-shim'])

    expect(fs.readFileSync(path.join(stableRuntime, 'shared.mjs'), 'utf8')).toContain('v2')
    expect(fs.existsSync(path.join(stableRuntime, 'new-chunk.mjs'))).toBe(true)
    expect(fs.existsSync(path.join(stableRuntime, 'obsolete.mjs'))).toBe(false)
  })

  it('keeps configuration when uninstalling the managed runtime', () => {
    environment()
    runInstall(['--codex-shim'])
    const stateDirectory = path.join(process.env.CODEX_HOME!, 'codex-hud')
    const configPath = path.join(stateDirectory, 'config.json')
    fs.writeFileSync(configPath, '{"language":"en"}\n')

    runUninstall([])

    expect(fs.existsSync(path.join(stateDirectory, 'runtime'))).toBe(false)
    expect(fs.readFileSync(configPath, 'utf8')).toContain('language')
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

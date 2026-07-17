import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findExecutable, shellCommand } from './process.js'

const directories: string[] = []

afterEach(() => {
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
})

describe('process helpers', () => {
  it('resolves through a managed Codex shim to the official executable', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-process-'))
    directories.push(root)
    const bin = path.join(root, 'bin')
    const codexHome = path.join(root, 'codex-home')
    fs.mkdirSync(bin)
    fs.mkdirSync(path.join(codexHome, 'codex-hud'), { recursive: true })
    const shim = path.join(bin, 'codex')
    const real = path.join(root, 'real-codex')
    fs.writeFileSync(shim, '#!/bin/sh\n', { mode: 0o755 })
    fs.writeFileSync(real, '#!/bin/sh\n', { mode: 0o755 })
    fs.writeFileSync(path.join(codexHome, 'codex-hud', 'install.json'), JSON.stringify({
      version: 1,
      realCodex: real,
      managedFiles: [shim],
    }))
    expect(findExecutable('codex', { CODEX_HOME: codexHome, PATH: bin })).toBe(real)
  })

  it('accepts the legacy executable override during migration', () => {
    expect(findExecutable('codex', { CODEX_HUB_CODEX_BIN: '/missing' })).toBeNull()
  })

  it('quotes commands without losing spaces or apostrophes', () => {
    expect(shellCommand('/a b/node', ['it\'s', 'fine'])).toBe('\'/a b/node\' \'it\'"\'"\'s\' \'fine\'')
  })
})

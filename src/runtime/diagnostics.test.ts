import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readLatestHudLaunchFailure, recordHudLaunchFailure } from './diagnostics.js'

const roots: string[] = []

afterEach(() => {
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }))
})

describe('hud launch diagnostics', () => {
  it('records and reads the latest startup failure', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-diagnostics-'))
    roots.push(home)
    const env = { CODEX_HOME: home }
    recordHudLaunchFailure({ cwd: '/work/demo', backend: 'cmux', error: 'cmux new-split failed' }, env)
    expect(readLatestHudLaunchFailure(env)).toMatchObject({
      cwd: '/work/demo',
      backend: 'cmux',
      error: 'cmux new-split failed',
    })
    expect(fs.statSync(path.join(home, 'codex-hud', 'launch-errors.jsonl')).mode & 0o777).toBe(0o600)
  })

  it('ignores malformed diagnostic lines', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-diagnostics-'))
    roots.push(home)
    const directory = path.join(home, 'codex-hud')
    fs.mkdirSync(directory)
    fs.writeFileSync(path.join(directory, 'launch-errors.jsonl'), '{bad}\n')
    expect(readLatestHudLaunchFailure({ CODEX_HOME: home })).toBeNull()
  })
})

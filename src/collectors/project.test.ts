import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectProjectInfo } from './project.js'

const directories: string[] = []

afterEach(() => {
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
})

describe('project collector caching', () => {
  it('skips diagnostic scans when counts are hidden', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-project-'))
    directories.push(root)
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'test')
    const info = collectProjectInfo(root, [], { CODEX_HOME: path.join(root, '.home') }, false)
    expect(info.projectRoot).toBe(root)
    expect(info.agentsMdCount).toBe(0)
    expect(info.skillsCount).toBe(0)
  })

  it('keeps expensive counts for thirty seconds and refreshes after expiry', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-project-'))
    directories.push(root)
    const env = { CODEX_HOME: path.join(root, '.home') }
    expect(collectProjectInfo(root, [], env, true, 1_000).agentsMdCount).toBe(0)
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'test')
    expect(collectProjectInfo(root, [], env, true, 2_000).agentsMdCount).toBe(0)
    expect(collectProjectInfo(root, [], env, true, 32_000).agentsMdCount).toBe(1)
  })
})

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectGitStatus } from './git.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('git collector', () => {
  it('returns null outside a repository', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-non-git-'))
    temporaryDirectories.push(directory)
    expect(collectGitStatus(directory)).toBeNull()
  })

  it('reports branch and working tree changes', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-git-'))
    temporaryDirectories.push(directory)
    execFileSync('git', ['init', '-b', 'main'], { cwd: directory })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: directory })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: directory })
    fs.writeFileSync(path.join(directory, 'tracked.txt'), 'one\n')
    execFileSync('git', ['add', 'tracked.txt'], { cwd: directory })
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: directory })
    fs.appendFileSync(path.join(directory, 'tracked.txt'), 'two\n')
    fs.writeFileSync(path.join(directory, 'new.txt'), 'new\n')

    expect(collectGitStatus(directory)).toMatchObject({
      branch: 'main',
      isDirty: true,
      modified: 1,
      untracked: 1,
    })
  })
})

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectAuthInfo, collectSessionTitle } from './session-metadata.js'

const directories: string[] = []

afterEach(() => {
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
})

describe('session metadata collectors', () => {
  it('reports API-key auth without exposing the key', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-auth-'))
    directories.push(codexHome)
    fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-secret-value' }))
    expect(collectAuthInfo(null, { CODEX_HOME: codexHome })).toEqual({ method: 'API Key' })
  })

  it('reads a session title from the Codex state database when sqlite3 is available', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-title-'))
    directories.push(codexHome)
    const database = path.join(codexHome, 'state_5.sqlite')
    execFileSync('sqlite3', [database, 'CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, first_user_message TEXT NOT NULL); INSERT INTO threads VALUES (\'session-1\', \'Named session\', \'Original prompt\');'])
    expect(collectSessionTitle({
      id: 'session-1',
      rolloutPath: '/tmp/rollout.jsonl',
      startTime: new Date(),
      cwd: '/tmp',
    }, { CODEX_HOME: codexHome })).toBe('Named session')
  })

  it('does not expose the default title when it is the first user message', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-title-'))
    directories.push(codexHome)
    const database = path.join(codexHome, 'state_5.sqlite')
    execFileSync('sqlite3', [database, 'CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, first_user_message TEXT NOT NULL); INSERT INTO threads VALUES (\'session-private\', \'Sensitive prompt\', \'Sensitive prompt\');'])
    expect(collectSessionTitle({
      id: 'session-private',
      rolloutPath: '/tmp/rollout.jsonl',
      startTime: new Date(),
      cwd: '/tmp',
    }, { CODEX_HOME: codexHome })).toBeNull()
  })
})

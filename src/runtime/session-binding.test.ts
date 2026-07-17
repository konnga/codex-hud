import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findNewRootSession,
  readSessionBinding,
  snapshotRootSessions,
  waitForNewRootSession,
  writeSessionBinding,
} from './session-binding.js'

const directories: string[] = []

function writeSession(codexHome: string, name: string, cwd: string, timestamp: string): string {
  const directory = path.join(codexHome, 'sessions', '2026', '07', '17')
  fs.mkdirSync(directory, { recursive: true })
  const filePath = path.join(directory, `rollout-${name}.jsonl`)
  fs.writeFileSync(filePath, `${JSON.stringify({
    timestamp,
    type: 'session_meta',
    payload: { id: name, timestamp, cwd, source: 'cli' },
  })}\n`)
  return filePath
}

afterEach(() => {
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
})

describe('managed session binding', () => {
  it('selects only the root session created after the launch snapshot', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-binding-'))
    directories.push(codexHome)
    const cwd = path.join(codexHome, 'project')
    fs.mkdirSync(cwd)
    writeSession(codexHome, 'existing-a', cwd, '2026-07-17T01:00:00Z')
    writeSession(codexHome, 'existing-b', cwd, '2026-07-17T01:01:00Z')
    const snapshot = snapshotRootSessions(cwd, codexHome)
    const created = writeSession(codexHome, 'created-by-this-launch', cwd, '2026-07-17T01:02:00Z')

    expect(findNewRootSession(cwd, snapshot, codexHome)?.path).toBe(created)
  })

  it('does not bind a session launched from a nested or sibling directory', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-binding-'))
    directories.push(codexHome)
    const cwd = path.join(codexHome, 'project')
    fs.mkdirSync(path.join(cwd, 'nested'), { recursive: true })
    const snapshot = snapshotRootSessions(cwd, codexHome)
    writeSession(codexHome, 'nested', path.join(cwd, 'nested'), '2026-07-17T01:02:00Z')

    expect(findNewRootSession(cwd, snapshot, codexHome)).toBeNull()
  })

  it('binds a resumed session when Codex modifies its existing rollout', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-binding-'))
    directories.push(codexHome)
    const cwd = path.join(codexHome, 'project')
    fs.mkdirSync(cwd)
    const resumed = writeSession(codexHome, 'resumed', cwd, '2026-07-17T01:00:00Z')
    const snapshot = snapshotRootSessions(cwd, codexHome)
    const modified = new Date(Date.now() + 1_000)
    fs.utimesSync(resumed, modified, modified)

    expect(findNewRootSession(cwd, snapshot, codexHome)).toBeNull()
    expect(findNewRootSession(cwd, snapshot, codexHome, true)?.path).toBe(resumed)
  })

  it('does not let an updated old session win a normal new launch', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-binding-'))
    directories.push(codexHome)
    const cwd = path.join(codexHome, 'project')
    fs.mkdirSync(cwd)
    const existing = writeSession(codexHome, 'existing', cwd, '2026-07-17T01:00:00Z')
    const snapshot = snapshotRootSessions(cwd, codexHome)
    const modified = new Date(Date.now() + 1_000)
    fs.utimesSync(existing, modified, modified)

    expect(findNewRootSession(cwd, snapshot, codexHome)).toBeNull()
    const created = writeSession(codexHome, 'new-session', cwd, '2026-07-17T01:02:00Z')
    expect(findNewRootSession(cwd, snapshot, codexHome)?.path).toBe(created)
  })

  it('writes and reads one fixed rollout path', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-binding-'))
    directories.push(directory)
    const bindingPath = path.join(directory, 'binding.json')
    const rolloutPath = path.join(directory, 'rollout.jsonl')
    fs.writeFileSync(rolloutPath, '')

    writeSessionBinding(bindingPath, rolloutPath)

    expect(readSessionBinding(bindingPath)).toBe(rolloutPath)
  })

  it('stops rollout discovery immediately when the launch is aborted', async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-binding-'))
    directories.push(codexHome)
    const cwd = path.join(codexHome, 'project')
    fs.mkdirSync(cwd)
    const controller = new AbortController()
    controller.abort()
    const startedAt = Date.now()

    expect(await waitForNewRootSession(cwd, new Map(), codexHome, 10_000, controller.signal)).toBeNull()
    expect(Date.now() - startedAt).toBeLessThan(100)
  })
})

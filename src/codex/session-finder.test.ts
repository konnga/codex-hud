import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findActiveSession, isSubagentSource, readSessionCandidate } from './session-finder.js'

const temporaryDirectories: string[] = []

function writeSession(
  codexHome: string,
  name: string,
  payload: Record<string, unknown>,
  modifiedAt: Date,
): string {
  const directory = path.join(codexHome, 'sessions', '2026', '07', '16')
  fs.mkdirSync(directory, { recursive: true })
  const filePath = path.join(directory, `rollout-${name}.jsonl`)
  fs.writeFileSync(filePath, `${JSON.stringify({
    timestamp: payload.timestamp,
    type: 'session_meta',
    payload,
  })}\n`)
  fs.utimesSync(filePath, modifiedAt, modifiedAt)
  return filePath
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('session discovery', () => {
  it('reads canonical session metadata', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-session-'))
    temporaryDirectories.push(directory)
    const filePath = writeSession(directory, 'one', {
      id: 'session-one',
      timestamp: '2026-07-16T08:00:00Z',
      cwd: '/work/demo',
      source: 'cli',
    }, new Date('2026-07-16T08:05:00Z'))
    expect(readSessionCandidate(filePath)).toMatchObject({
      sessionId: 'session-one',
      cwd: '/work/demo',
      source: 'cli',
    })
  })

  it('selects the newest matching root session', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-session-'))
    temporaryDirectories.push(directory)
    const project = path.join(directory, 'project')
    fs.mkdirSync(project)
    writeSession(directory, 'old', {
      id: 'old',
      timestamp: '2026-07-16T08:00:00Z',
      cwd: project,
      source: 'cli',
    }, new Date('2026-07-16T08:01:00Z'))
    writeSession(directory, 'new', {
      id: 'new',
      timestamp: '2026-07-16T08:02:00Z',
      cwd: project,
      source: 'cli',
    }, new Date('2026-07-16T08:03:00Z'))
    writeSession(directory, 'child', {
      id: 'child',
      timestamp: '2026-07-16T08:04:00Z',
      cwd: project,
      source: { subagent: { thread_spawn: { parent_thread_id: 'new' } } },
    }, new Date('2026-07-16T08:05:00Z'))

    expect(findActiveSession({
      cwd: project,
      codexHome: directory,
      now: new Date('2026-07-16T08:06:00Z'),
    })?.sessionId).toBe('new')
  })
})

describe('subagent detection', () => {
  it('recognizes canonical thread-spawn sources', () => {
    expect(isSubagentSource({ subagent: { thread_spawn: { parent_thread_id: 'root' } } })).toBe(true)
    expect(isSubagentSource('cli')).toBe(false)
  })
})

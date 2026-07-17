import type { SessionInfo } from '../types/state.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectAgentEntries } from './agents.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('subagent collector', () => {
  it('finds a running canonical thread-spawn child', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-agents-'))
    temporaryDirectories.push(codexHome)
    const directory = path.join(codexHome, 'sessions', '2026', '07', '16')
    fs.mkdirSync(directory, { recursive: true })
    const childPath = path.join(directory, 'rollout-child.jsonl')
    fs.writeFileSync(childPath, [
      JSON.stringify({
        timestamp: '2026-07-16T08:00:00Z',
        type: 'session_meta',
        payload: {
          id: 'child',
          timestamp: '2026-07-16T08:00:00Z',
          cwd: '/work/demo',
          source: {
            subagent: {
              thread_spawn: {
                parent_thread_id: 'root',
                agent_path: '/root/explorer',
                agent_role: 'Inspect protocol',
              },
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: '2026-07-16T08:00:01Z',
        type: 'turn_context',
        payload: { model: 'gpt-5.5-mini' },
      }),
      JSON.stringify({
        timestamp: '2026-07-16T08:00:02Z',
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'turn-child', started_at: '2026-07-16T08:00:02Z' },
      }),
      '',
    ].join('\n'))
    fs.utimesSync(childPath, new Date('2026-07-16T08:00:02Z'), new Date('2026-07-16T08:00:02Z'))
    const session: SessionInfo = {
      id: 'root',
      rolloutPath: '/tmp/root.jsonl',
      startTime: new Date('2026-07-16T08:00:00Z'),
      cwd: '/work/demo',
    }
    expect(collectAgentEntries(session, { CODEX_HOME: codexHome }, new Date('2026-07-16T08:00:03Z'))).toEqual([
      expect.objectContaining({
        id: 'child',
        type: 'explorer',
        model: 'gpt-5.5-mini',
        description: 'Inspect protocol',
        status: 'running',
      }),
    ])
  })
})

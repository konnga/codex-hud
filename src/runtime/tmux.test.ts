import type { SpawnSyncReturns } from 'node:child_process'
import type { TmuxRunner } from './tmux.js'
import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { launchInsideTmux, launchNewTmuxSession, tmuxSessionName } from './tmux.js'

function result(status = 0, stdout = ''): SpawnSyncReturns<string> {
  return {
    pid: 1,
    output: [],
    stdout,
    stderr: '',
    status,
    signal: null,
    error: undefined,
  }
}

function recordingRunner(outputs: SpawnSyncReturns<string>[] = []): { runner: TmuxRunner, calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    runner: {
      run(args) {
        calls.push(args)
        return outputs.shift() ?? result()
      },
    },
  }
}

const options = {
  cwd: '/work/my project',
  cliPath: '/opt/codex hud/cli.mjs',
  renderCliPath: '/opt/codex hud/render-cli.mjs',
  codexArgs: ['--model', 'gpt-5.5', 'fix spaces'],
  height: 7,
  detached: true,
  launchedAfter: new Date('2026-07-16T09:00:00Z'),
  bindingPath: '/tmp/codex-hud-binding.json',
  sessionPath: '/tmp/rollout.jsonl',
  env: { TMUX: '/tmp/tmux', TMUX_PANE: '%1' },
}

describe('tmux launcher', () => {
  it('creates a stable project-scoped session name', () => {
    expect(tmuxSessionName('/work/my project')).toMatch(/^codex-hud-my-project-[a-f0-9]{8}$/)
    expect(tmuxSessionName('/work/my project')).toBe(tmuxSessionName('/work/my project'))
    expect(tmuxSessionName('/work/my project', 'launch-1')).not.toBe(tmuxSessionName('/work/my project', 'launch-2'))
  })

  it('splits the current tmux window without changing focus', () => {
    const { runner, calls } = recordingRunner([result(0, '%9\n')])
    const launched = launchInsideTmux(options, runner)
    expect(launched.hudPaneId).toBe('%9')
    expect(calls[0]).toContain('-d')
    expect(calls[0]).toContain('%1')
    expect(calls[0]).toContain('5')
    expect(calls[0].at(-1)).toContain('\'/work/my project\'')
    expect(calls[0].at(-1)).toContain('2026-07-16T09:00:00.000Z')
    expect(calls[0].at(-1)).toContain('/tmp/rollout.jsonl')
    expect(calls[0].at(-1)).toContain('/tmp/codex-hud-binding.json')
    expect(calls[0].at(-1)).toContain('--max-height')
    expect(calls[0].at(-1)).toContain('--max-old-space-size=64')
  })

  it('creates a detached session with Codex and HUD panes', () => {
    const { runner, calls } = recordingRunner([
      result(1),
      result(0),
      result(0),
      result(0),
      result(0),
      result(0),
      result(0, '%2\n'),
      result(0),
    ])
    const launched = launchNewTmuxSession({ ...options, env: {} }, runner)
    expect(launched.sessionName).toMatch(/^codex-hud-my-project-/)
    expect(launched.hudPaneId).toBe('%2')
    expect(calls.some(call => call[0] === 'new-session')).toBe(true)
    expect(calls.some(call => call[0] === 'split-window')).toBe(true)
    expect(calls.find(call => call[0] === 'split-window')).toContain('5')
    expect(calls.some(call => call.includes('status') && call.includes('off'))).toBe(true)
    expect(calls.some(call => call.includes('mouse') && call.includes('on'))).toBe(true)
    expect(calls.find(call => call[0] === 'new-session')?.at(-1)).not.toContain('--wait-for-client')
    expect(calls.find(call => call[0] === 'new-session')?.at(-1)).toContain('/tmp/codex-hud-binding.json')
  })

  it('attaches the terminal before interactive Codex performs terminal detection', () => {
    const { runner, calls } = recordingRunner([
      result(1),
      result(0),
      result(0),
      result(0),
      result(0),
      result(0),
      result(0, '%2\n'),
      result(0),
      result(0),
    ])
    launchNewTmuxSession({ ...options, detached: false, sessionPath: undefined, env: {} }, runner)
    expect(calls.find(call => call[0] === 'new-session')?.at(-1)).toContain('--wait-for-client')
    expect(calls.some(call => call[0] === 'attach-session')).toBe(true)
  })

  it('starts an isolated tmux server without loading the user tmux config', () => {
    const { runner, calls } = recordingRunner([
      result(0),
      result(0),
      result(0),
      result(0),
      result(0),
      result(0, '%2\n'),
      result(0),
    ])
    const launched = launchNewTmuxSession({
      ...options,
      env: {},
      socketPath: '/tmp/codex-hud-private.sock',
    }, runner)
    const create = calls.find(call => call.includes('new-session'))
    expect(calls.some(call => call.includes('has-session'))).toBe(false)
    expect(create?.slice(0, 2)).toEqual(['-f', os.devNull])
    expect(launched.socketPath).toBe('/tmp/codex-hud-private.sock')
  })

  it('does not change mouse settings in a user-owned tmux session', () => {
    const { runner, calls } = recordingRunner([result(0, '%9\n')])
    launchInsideTmux(options, runner)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe('split-window')
    expect(calls.some(call => call[0] === 'set-option')).toBe(false)
  })
})

import type { SpawnSyncReturns } from 'node:child_process'
import type { CmuxRunner } from './cmux.js'
import { describe, expect, it } from 'vitest'
import {
  closeCmuxHud,
  cmuxAvailable,
  isCmuxEnvironment,
  launchCmuxHud,
} from './cmux.js'

function result(status = 0, stdout = '', stderr = ''): SpawnSyncReturns<string> {
  return {
    pid: 1,
    output: [],
    stdout,
    stderr,
    status,
    signal: null,
    error: undefined,
  }
}

function recordingRunner(outputs: SpawnSyncReturns<string>[]): { runner: CmuxRunner, calls: string[][] } {
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
  cwd: '/work/demo',
  renderCliPath: '/opt/codex-hud/render-cli.mjs',
  launchedAfter: new Date('2026-07-18T10:00:00Z'),
  bindingPath: '/tmp/codex-hud-binding.json',
  maximumHeight: 12,
  allowModifiedSession: false,
  env: {
    CMUX_WORKSPACE_ID: 'workspace-uuid',
    CMUX_SURFACE_ID: 'source-surface-uuid',
  },
}

describe('cmux native HUD backend', () => {
  it('detects a complete cmux caller context', () => {
    expect(isCmuxEnvironment(options.env)).toBe(true)
    expect(isCmuxEnvironment({ CMUX_WORKSPACE_ID: 'workspace' })).toBe(false)
  })

  it('checks socket health through cmux ping', () => {
    expect(cmuxAvailable(recordingRunner([result()]).runner)).toBe(true)
    expect(cmuxAvailable(recordingRunner([result(1)]).runner)).toBe(false)
  })

  it('creates, sizes, and starts an unfocused bottom HUD split', () => {
    const { runner, calls } = recordingRunner([
      result(0, JSON.stringify({ caller: { pane_id: 'source-pane-uuid' } })),
      result(0, JSON.stringify({
        workspace_id: 'workspace-uuid',
        pane_id: 'pane-uuid',
        surface_id: 'surface-uuid',
      })),
      result(),
      result(),
    ])

    expect(launchCmuxHud(options, runner)).toEqual({
      workspaceId: 'workspace-uuid',
      paneId: 'pane-uuid',
      surfaceId: 'surface-uuid',
    })
    expect(calls[0]).toEqual([
      '--json',
      '--id-format',
      'uuids',
      'identify',
      '--workspace',
      'workspace-uuid',
      '--surface',
      'source-surface-uuid',
    ])
    expect(calls[1]).toEqual([
      '--json',
      '--id-format',
      'uuids',
      'new-split',
      'down',
      '--workspace',
      'workspace-uuid',
      '--surface',
      'source-surface-uuid',
      '--focus',
      'false',
    ])
    expect(calls[2]).toEqual([
      'resize-pane',
      '--workspace',
      'workspace-uuid',
      '--pane',
      'source-pane-uuid',
      '-D',
      '--amount',
      '10000',
    ])
    expect(calls[3]?.slice(0, 6)).toEqual([
      'send',
      '--workspace',
      'workspace-uuid',
      '--surface',
      'surface-uuid',
      '--',
    ])
    expect(calls[3]?.at(-1)).toContain(`exec '`)
    expect(calls[3]?.at(-1)).toContain(`'--cmux-pane' 'pane-uuid'`)
    expect(calls[3]?.at(-1)).toContain(`'--cmux-source-pane' 'source-pane-uuid'`)
    expect(calls[3]?.at(-1)).toContain(`'--cmux-workspace' 'workspace-uuid'`)
  })

  it('closes the created HUD surface', () => {
    const { runner, calls } = recordingRunner([result()])
    closeCmuxHud({ workspaceId: 'workspace', paneId: 'pane', surfaceId: 'surface' }, runner)
    expect(calls[0]).toEqual([
      'close-surface',
      '--workspace',
      'workspace',
      '--surface',
      'surface',
    ])
  })

  it('cleans up the split when renderer startup fails', () => {
    const { runner, calls } = recordingRunner([
      result(0, JSON.stringify({ caller: { pane_id: 'source-pane' } })),
      result(0, JSON.stringify({
        workspace_id: 'workspace',
        pane_id: 'pane',
        surface_id: 'surface',
      })),
      result(),
      result(1, '', 'send failed'),
      result(),
    ])
    expect(() => launchCmuxHud(options, runner)).toThrow('cmux send failed')
    expect(calls.at(-1)).toEqual([
      'close-surface',
      '--workspace',
      'workspace',
      '--surface',
      'surface',
    ])
  })
})

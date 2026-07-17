import { describe, expect, it } from 'vitest'
import { resolveHubCommand } from './command.js'

describe('hud command routing', () => {
  it('starts Codex when the shim is invoked without arguments', () => {
    expect(resolveHubCommand([])).toBe('start')
  })

  it('preserves explicit HUD subcommands', () => {
    expect(resolveHubCommand(['doctor', '--json'])).toBe('doctor')
    expect(resolveHubCommand(['setup', '--yes'])).toBe('setup')
    expect(resolveHubCommand(['help'])).toBe('help')
  })
})

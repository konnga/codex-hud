import { describe, expect, it } from 'vitest'
import { resolveHubCommand } from './command.js'

describe('hub command routing', () => {
  it('starts Codex when the shim is invoked without arguments', () => {
    expect(resolveHubCommand([])).toBe('start')
  })

  it('preserves explicit Hub subcommands', () => {
    expect(resolveHubCommand(['doctor', '--json'])).toBe('doctor')
    expect(resolveHubCommand(['help'])).toBe('help')
  })
})

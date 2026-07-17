import { describe, expect, it } from 'vitest'
import { shouldBypassHud } from './passthrough.js'

describe('codex shim passthrough', () => {
  it('bypasses the HUD for non-interactive Codex commands', () => {
    expect(shouldBypassHud(['plugin', 'list', '--json'])).toBe(true)
    expect(shouldBypassHud(['app'])).toBe(true)
    expect(shouldBypassHud(['--model', 'gpt-5.6', 'exec', 'echo ok'])).toBe(true)
    expect(shouldBypassHud(['--version'])).toBe(true)
  })

  it('keeps interactive prompts and resume flows in the HUD', () => {
    expect(shouldBypassHud(['Reply with exactly OK'])).toBe(false)
    expect(shouldBypassHud(['resume', '--last'])).toBe(false)
    expect(shouldBypassHud(['--', 'plugin'])).toBe(false)
  })
})

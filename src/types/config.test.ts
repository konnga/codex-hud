import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  DEFAULT_ELEMENT_ORDER,
  DEFAULT_MERGE_GROUPS,
} from './config.js'

describe('default HUD configuration', () => {
  it('starts in the Claude HUD-compatible expanded layout', () => {
    expect(DEFAULT_CONFIG.lineLayout).toBe('expanded')
    expect(DEFAULT_CONFIG.refreshIntervalMs).toBe(300)
    expect(DEFAULT_CONFIG.display.showModel).toBe(true)
  })

  it('keeps the canonical element order', () => {
    expect(DEFAULT_CONFIG.elementOrder).toEqual(DEFAULT_ELEMENT_ORDER)
    expect(DEFAULT_CONFIG.elementOrder).toEqual([
      'project',
      'addedDirs',
      'context',
      'usage',
      'promptCache',
      'memory',
      'environment',
      'tools',
      'skills',
      'mcp',
      'agents',
      'todos',
      'sessionTime',
    ])
  })

  it('merges context and usage by default', () => {
    expect(DEFAULT_CONFIG.display.mergeGroups).toEqual(DEFAULT_MERGE_GROUPS)
  })

  it('returns independent mutable arrays', () => {
    expect(DEFAULT_CONFIG.elementOrder).not.toBe(DEFAULT_ELEMENT_ORDER)
    expect(DEFAULT_CONFIG.display.mergeGroups).not.toBe(DEFAULT_MERGE_GROUPS)
    expect(DEFAULT_CONFIG.display.mergeGroups[0]).not.toBe(DEFAULT_MERGE_GROUPS[0])
  })
})

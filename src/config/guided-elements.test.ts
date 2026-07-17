import { describe, expect, it } from 'vitest'
import {
  applyGuidedElementChanges,
  GUIDED_ELEMENTS,
  guidedElementState,
  parseGuidedElements,
} from './guided-elements.js'
import { createPreset } from './presets.js'

describe('guided HUD elements', () => {
  it('exposes stable names and reports the current enabled state', () => {
    expect(GUIDED_ELEMENTS.map(element => element.name)).toEqual([
      'git',
      'usage',
      'tools',
      'skills',
      'mcp',
      'agents',
      'todos',
      'goal',
      'configCounts',
      'duration',
      'speed',
      'promptCache',
      'sessionName',
      'auth',
      'memory',
      'sessionTokens',
      'compactions',
    ])

    const state = guidedElementState(createPreset('essential'))
    expect(state.enabled).toContain('tools')
    expect(state.enabled).toContain('agents')
    expect(state.disabled).toContain('skills')
    expect(state.disabled).toContain('memory')
  })

  it('changes only named elements and lets disable win conflicts', () => {
    const config = createPreset('essential')
    const originalColors = structuredClone(config.colors)
    const originalUsage = config.display.showUsage

    applyGuidedElementChanges(config, {
      enable: ['skills', 'memory', 'tools'],
      disable: ['tools', 'goal'],
    })

    expect(config.display.showSkills).toBe(true)
    expect(config.display.showMemoryUsage).toBe(true)
    expect(config.display.showTools).toBe(false)
    expect(config.display.showGoal).toBe(false)
    expect(config.display.showUsage).toBe(originalUsage)
    expect(config.colors).toEqual(originalColors)
  })

  it('parses comma-separated names and rejects unknown elements', () => {
    expect(parseGuidedElements('tools, skills,agents')).toEqual(['tools', 'skills', 'agents'])
    expect(parseGuidedElements('')).toEqual([])
    expect(() => parseGuidedElements('tools,advisor')).toThrow('Unknown HUD element: advisor')
  })
})

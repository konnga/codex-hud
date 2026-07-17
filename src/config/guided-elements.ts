import type { HudConfig } from '../types/config.js'

export type GuidedElement
  = | 'git'
    | 'usage'
    | 'tools'
    | 'skills'
    | 'mcp'
    | 'agents'
    | 'todos'
    | 'goal'
    | 'configCounts'
    | 'duration'
    | 'speed'
    | 'promptCache'
    | 'sessionName'
    | 'auth'
    | 'memory'
    | 'sessionTokens'
    | 'compactions'

interface GuidedElementDefinition {
  name: GuidedElement
  label: string
  get: (config: HudConfig) => boolean
  set: (config: HudConfig, value: boolean) => void
}

export const GUIDED_ELEMENTS: readonly GuidedElementDefinition[] = [
  { name: 'git', label: 'Git status', get: config => config.gitStatus.enabled, set: (config, value) => config.gitStatus.enabled = value },
  { name: 'usage', label: 'Rate limits and credits', get: config => config.display.showUsage, set: (config, value) => config.display.showUsage = value },
  { name: 'tools', label: 'Tool activity', get: config => config.display.showTools, set: (config, value) => config.display.showTools = value },
  { name: 'skills', label: 'Active skills', get: config => config.display.showSkills, set: (config, value) => config.display.showSkills = value },
  { name: 'mcp', label: 'MCP activity', get: config => config.display.showMcp, set: (config, value) => config.display.showMcp = value },
  { name: 'agents', label: 'Subagents', get: config => config.display.showAgents, set: (config, value) => config.display.showAgents = value },
  { name: 'todos', label: 'Plan / todos', get: config => config.display.showTodos, set: (config, value) => config.display.showTodos = value },
  { name: 'goal', label: 'Durable goal', get: config => config.display.showGoal, set: (config, value) => config.display.showGoal = value },
  { name: 'configCounts', label: 'Environment counts', get: config => config.display.showConfigCounts, set: (config, value) => config.display.showConfigCounts = value },
  { name: 'duration', label: 'Session duration', get: config => config.display.showDuration, set: (config, value) => config.display.showDuration = value },
  { name: 'speed', label: 'Output speed', get: config => config.display.showSpeed, set: (config, value) => config.display.showSpeed = value },
  { name: 'promptCache', label: 'Prompt-cache countdown', get: config => config.display.showPromptCache, set: (config, value) => config.display.showPromptCache = value },
  { name: 'sessionName', label: 'Session title', get: config => config.display.showSessionName, set: (config, value) => config.display.showSessionName = value },
  { name: 'auth', label: 'Authentication method', get: config => config.display.showAuth, set: (config, value) => config.display.showAuth = value },
  { name: 'memory', label: 'Approximate system memory', get: config => config.display.showMemoryUsage, set: (config, value) => config.display.showMemoryUsage = value },
  { name: 'sessionTokens', label: 'Session token totals', get: config => config.display.showSessionTokens, set: (config, value) => config.display.showSessionTokens = value },
  { name: 'compactions', label: 'Compaction count', get: config => config.display.showCompactions, set: (config, value) => config.display.showCompactions = value },
]

const ELEMENTS_BY_NAME = new Map(GUIDED_ELEMENTS.map(element => [element.name, element]))

export function parseGuidedElements(value: string | null): GuidedElement[] {
  if (!value) {
    return []
  }
  const result: GuidedElement[] = []
  for (const item of value.split(',').map(item => item.trim()).filter(Boolean)) {
    if (!ELEMENTS_BY_NAME.has(item as GuidedElement)) {
      throw new Error(`Unknown HUD element: ${item}`)
    }
    const element = item as GuidedElement
    if (!result.includes(element)) {
      result.push(element)
    }
  }
  return result
}

export function guidedElementState(config: HudConfig): { enabled: GuidedElement[], disabled: GuidedElement[] } {
  const enabled: GuidedElement[] = []
  const disabled: GuidedElement[] = []
  for (const element of GUIDED_ELEMENTS) {
    ;(element.get(config) ? enabled : disabled).push(element.name)
  }
  return { enabled, disabled }
}

export function applyGuidedElementChanges(
  config: HudConfig,
  changes: { enable?: readonly GuidedElement[], disable?: readonly GuidedElement[] },
): void {
  for (const name of changes.enable ?? []) {
    ELEMENTS_BY_NAME.get(name)?.set(config, true)
  }
  for (const name of changes.disable ?? []) {
    ELEMENTS_BY_NAME.get(name)?.set(config, false)
  }
}

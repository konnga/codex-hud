import type { HudConfig } from '../types/config.js'
import { DEFAULT_CONFIG } from '../types/config.js'

export type ConfigPreset = 'full' | 'essential' | 'minimal'

function cloneDefault(): HudConfig {
  return structuredClone(DEFAULT_CONFIG)
}

export function createPreset(preset: ConfigPreset): HudConfig {
  const config = cloneDefault()

  if (preset === 'full') {
    Object.assign(config.display, {
      showConfigCounts: false,
      showCost: false,
      showDuration: true,
      showSpeed: false,
      showTokenBreakdown: true,
      showTools: true,
      showSkills: true,
      showMcp: true,
      showAgents: true,
      showTodos: true,
      showGoal: true,
      showSessionName: true,
      showAuth: true,
      showAuthUser: true,
      toolNameMaxLength: 20,
      toolsMaxVisible: 3,
      showCodexVersion: false,
      showEffortLevel: true,
      showApprovalPolicy: false,
      showSandboxMode: false,
      showCollaborationMode: false,
      showMemoryUsage: false,
      showPromptCache: true,
      showSessionTokens: false,
      showSessionStartDate: false,
      showLastResponseAt: false,
      showCompactions: true,
      showSessionId: false,
    })
    return config
  }

  if (preset === 'essential') {
    Object.assign(config.display, {
      showDuration: true,
      showTools: true,
      showAgents: true,
      showTodos: true,
      showGoal: true,
      showEffortLevel: true,
      showUsage: false,
    })
    return config
  }

  config.lineLayout = 'compact'
  config.elementOrder = ['project', 'context']
  config.display.showUsage = false
  config.display.showAddedDirs = false
  config.display.showGoal = false
  return config
}

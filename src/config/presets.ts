import type { HudConfig } from '../types/config.js'
import { DEFAULT_CONFIG } from '../types/config.js'

export type ConfigPreset = 'full' | 'essential' | 'minimal' | 'presentation'

function cloneDefault(): HudConfig {
  return structuredClone(DEFAULT_CONFIG)
}

export function createPreset(preset: ConfigPreset): HudConfig {
  const config = cloneDefault()

  if (preset === 'full') {
    Object.assign(config.display, {
      showModel: true,
      showConfigCounts: false,
      showCost: false,
      showDuration: true,
      showSpeed: false,
      showTokenBreakdown: true,
      showTools: true,
      showToolTargets: true,
      showSkills: true,
      showMcp: true,
      showAgents: true,
      showTodos: true,
      showGoal: true,
      showTurns: true,
      showImages: true,
      showSessionName: false,
      showAuth: true,
      showAuthUser: true,
      toolNameMaxLength: 20,
      toolsMaxVisible: 3,
      showCodexVersion: false,
      showEffortLevel: true,
      showApprovalPolicy: true,
      showPermissionProfile: true,
      showSandboxMode: true,
      showCollaborationMode: false,
      showMemoryUsage: false,
      showPromptCache: true,
      showSessionTokens: true,
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
      showTurns: true,
      showEffortLevel: true,
      showPermissionProfile: true,
      showUsage: true,
    })
    return config
  }

  if (preset === 'presentation') {
    config.lineLayout = 'compact'
    Object.assign(config.display, {
      showAddedDirs: false,
      showAuth: true,
      showAuthUser: false,
      showDuration: true,
      showTools: false,
      showToolTargets: false,
      showSkills: false,
      showMcp: false,
      showAgents: false,
      showTodos: false,
      showGoal: false,
      showTurns: false,
      showImages: false,
      showSessionName: false,
      showSessionId: false,
    })
    return config
  }

  config.lineLayout = 'compact'
  config.elementOrder = ['project', 'context']
  config.display.showUsage = false
  config.display.showAuth = false
  config.display.showAddedDirs = false
  config.display.showGoal = false
  config.display.showTurns = false
  config.display.showImages = false
  return config
}

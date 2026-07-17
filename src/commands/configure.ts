import type { ConfigPreset } from '../config/presets.js'
import type { HudConfig, Language, LineLayout } from '../types/config.js'
// @env node
import process from 'node:process'
import * as prompts from '@clack/prompts'
import { RolloutParser } from '../codex/rollout-parser.js'
import { findActiveSession } from '../codex/session-finder.js'
import { loadConfig } from '../config/load.js'
import { createPreset } from '../config/presets.js'
import { writeConfig } from '../config/write.js'
import { renderHud } from '../render/index.js'
import { buildHudState } from '../runtime/state.js'

const GUIDED_TOGGLES = [
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
] as const

type GuidedToggle = typeof GUIDED_TOGGLES[number]

function optionValue(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? null : null
}

function isPreset(value: string | null): value is ConfigPreset {
  return value === 'full' || value === 'essential' || value === 'minimal'
}

function isLanguage(value: string | null): value is Language {
  return value === 'en' || value === 'zh-Hans' || value === 'zh-Hant'
}

function isLayout(value: string | null): value is LineLayout {
  return value === 'compact' || value === 'expanded'
}

function cancelled(value: unknown): boolean {
  if (prompts.isCancel(value)) {
    prompts.cancel('Configuration cancelled.')
    return true
  }
  return false
}

function preserveAdvancedSettings(target: HudConfig, source: HudConfig): void {
  target.maxWidth = source.maxWidth
  target.forceMaxWidth = source.forceMaxWidth
  target.refreshIntervalMs = source.refreshIntervalMs
  target.showSeparators = source.showSeparators
  target.colors = structuredClone(source.colors)
  const advancedKeys: Array<keyof HudConfig['display']> = [
    'contextValue',
    'usageValue',
    'usageBarEnabled',
    'usageCompact',
    'showResetLabel',
    'toolNameMaxLength',
    'toolsMaxVisible',
    'authUserLength',
    'showAuthUser',
    'mergeGroups',
    'contextWarningThreshold',
    'contextCriticalThreshold',
    'usageThreshold',
    'sevenDayThreshold',
    'environmentThreshold',
    'externalUsagePath',
    'externalUsageWritePath',
    'externalUsageFreshnessMs',
    'modelFormat',
    'modelOverride',
    'showProvider',
    'providerName',
    'customLine',
    'customLinePosition',
    'timeFormat',
    'autoCompactWindow',
    'promptCacheTtlSeconds',
  ]
  for (const key of advancedKeys) {
    // Each key is copied from the same validated DisplayConfig shape.
    ;(target.display as unknown as Record<string, unknown>)[key] = structuredClone(source.display[key])
  }
}

function currentToggles(config: HudConfig): GuidedToggle[] {
  return GUIDED_TOGGLES.filter((toggle) => {
    const values: Record<GuidedToggle, boolean> = {
      git: config.gitStatus.enabled,
      usage: config.display.showUsage,
      tools: config.display.showTools,
      skills: config.display.showSkills,
      mcp: config.display.showMcp,
      agents: config.display.showAgents,
      todos: config.display.showTodos,
      goal: config.display.showGoal,
      configCounts: config.display.showConfigCounts,
      duration: config.display.showDuration,
      speed: config.display.showSpeed,
      promptCache: config.display.showPromptCache,
      sessionName: config.display.showSessionName,
      auth: config.display.showAuth,
      memory: config.display.showMemoryUsage,
      sessionTokens: config.display.showSessionTokens,
      compactions: config.display.showCompactions,
    }
    return values[toggle]
  })
}

function applyToggles(config: HudConfig, selected: GuidedToggle[]): void {
  const enabled = new Set(selected)
  config.gitStatus.enabled = enabled.has('git')
  config.display.showUsage = enabled.has('usage')
  config.display.showTools = enabled.has('tools')
  config.display.showSkills = enabled.has('skills')
  config.display.showMcp = enabled.has('mcp')
  config.display.showAgents = enabled.has('agents')
  config.display.showTodos = enabled.has('todos')
  config.display.showGoal = enabled.has('goal')
  config.display.showConfigCounts = enabled.has('configCounts')
  config.display.showDuration = enabled.has('duration')
  config.display.showSpeed = enabled.has('speed')
  config.display.showPromptCache = enabled.has('promptCache')
  config.display.showSessionName = enabled.has('sessionName')
  config.display.showAuth = enabled.has('auth')
  config.display.showMemoryUsage = enabled.has('memory')
  config.display.showSessionTokens = enabled.has('sessionTokens')
  config.display.showCompactions = enabled.has('compactions')
}

function preview(config: HudConfig): string {
  const parser = new RolloutParser()
  const candidate = findActiveSession({ cwd: process.cwd() })
  parser.setFile(candidate?.path ?? null)
  const now = new Date()
  const state = buildHudState(process.cwd(), parser.parse(), now, config, now)
  return renderHud({
    config,
    state,
    options: { width: Math.min(process.stdout.columns || 120, 140), height: 8, color: process.stdout.isTTY && !process.env.NO_COLOR },
    now,
  }).join('\n') || '(No active Codex session data yet)'
}

export async function runConfigure(args: string[]): Promise<number> {
  const loaded = loadConfig()
  let preset = optionValue(args, '--preset')
  let language = optionValue(args, '--language')
  let layout = optionValue(args, '--layout')
  const nonInteractive = args.includes('--yes') || !process.stdin.isTTY

  if (!isPreset(preset)) {
    if (nonInteractive) {
      preset = 'essential'
    }
    else {
      prompts.intro('Codex HUD configuration')
      const selected = await prompts.select({
        message: 'Choose a display preset',
        initialValue: 'essential',
        options: [
          { value: 'full', label: 'Full', hint: 'All telemetry and activity' },
          { value: 'essential', label: 'Essential', hint: 'Context, quota, tools, agents, tasks' },
          { value: 'minimal', label: 'Minimal', hint: 'Model, project, context' },
        ],
      })
      if (cancelled(selected)) {
        return 1
      }
      preset = selected as ConfigPreset
    }
  }

  if (!isLanguage(language)) {
    if (nonInteractive) {
      language = loaded.config.language
    }
    else {
      const selected = await prompts.select({
        message: 'Choose label language',
        initialValue: loaded.config.language,
        options: [
          { value: 'en', label: 'English' },
          { value: 'zh-Hans', label: '简体中文' },
          { value: 'zh-Hant', label: '繁體中文' },
        ],
      })
      if (cancelled(selected)) {
        return 1
      }
      language = selected as Language
    }
  }

  const selectedPreset = isPreset(preset) ? preset : 'essential'
  const selectedLanguage = isLanguage(language) ? language : loaded.config.language
  const config = createPreset(selectedPreset)
  preserveAdvancedSettings(config, loaded.config)
  config.language = selectedLanguage

  if (!isLayout(layout) && !nonInteractive) {
    const selected = await prompts.select({
      message: 'Choose layout',
      initialValue: config.lineLayout,
      options: [
        { value: 'expanded', label: 'Expanded', hint: 'Multiple readable lines' },
        { value: 'compact', label: 'Compact', hint: 'Dense header plus activity' },
      ],
    })
    if (cancelled(selected)) {
      return 1
    }
    layout = selected as LineLayout
  }
  if (isLayout(layout)) {
    config.lineLayout = layout
  }

  if (!nonInteractive) {
    const toggles = await prompts.multiselect({
      message: 'Choose visible HUD elements',
      initialValues: currentToggles(config),
      required: false,
      options: [
        { value: 'git', label: 'Git status' },
        { value: 'usage', label: 'Rate limits and credits' },
        { value: 'tools', label: 'Tool activity' },
        { value: 'skills', label: 'Active skills' },
        { value: 'mcp', label: 'MCP activity' },
        { value: 'agents', label: 'Subagents' },
        { value: 'todos', label: 'Plan / todos' },
        { value: 'goal', label: 'Durable goal' },
        { value: 'configCounts', label: 'Environment counts' },
        { value: 'duration', label: 'Session duration' },
        { value: 'speed', label: 'Output speed' },
        { value: 'promptCache', label: 'Prompt-cache countdown' },
        { value: 'sessionName', label: 'Session title' },
        { value: 'auth', label: 'Authentication method' },
        { value: 'memory', label: 'Approximate system memory' },
        { value: 'sessionTokens', label: 'Session token totals' },
        { value: 'compactions', label: 'Compaction count' },
      ],
    })
    if (cancelled(toggles)) {
      return 1
    }
    applyToggles(config, toggles as GuidedToggle[])

    const pathLevels = await prompts.select({
      message: 'Project path depth',
      initialValue: config.pathLevels,
      options: [
        { value: 1, label: 'Project only' },
        { value: 2, label: 'Parent / project' },
        { value: 3, label: 'Two parents / project' },
      ],
    })
    if (cancelled(pathLevels)) {
      return 1
    }
    config.pathLevels = pathLevels as 1 | 2 | 3

    prompts.note(preview(config), 'HUD preview')
    const confirmed = await prompts.confirm({
      message: `Save ${selectedPreset} / ${selectedLanguage} / ${config.lineLayout} configuration?`,
      initialValue: true,
    })
    if (cancelled(confirmed) || !confirmed) {
      return 1
    }
  }

  const configPath = writeConfig(config, loaded.raw)
  if (!nonInteractive) {
    prompts.outro(`Saved ${configPath}`)
  }
  else {
    process.stdout.write(`${configPath}\n`)
  }
  return 0
}

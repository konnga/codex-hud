import type { ConfigPreset } from '../config/presets.js'
import type { HudConfig, Language, LineLayout } from '../types/config.js'
// @env node
import process from 'node:process'
import * as prompts from '@clack/prompts'
import { RolloutParser } from '../codex/rollout-parser.js'
import { findActiveSession } from '../codex/session-finder.js'
import {
  applyGuidedElementChanges,
  GUIDED_ELEMENTS,
  guidedElementState,
  parseGuidedElements,
} from '../config/guided-elements.js'
import { loadConfig } from '../config/load.js'
import { createPreset } from '../config/presets.js'
import { writeConfig } from '../config/write.js'
import { renderHud } from '../render/index.js'
import { DEFAULT_HUD_MAX_HEIGHT } from '../runtime/pane-size.js'
import { buildHudState } from '../runtime/state.js'

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

function preview(config: HudConfig): string {
  const parser = new RolloutParser()
  const candidate = findActiveSession({ cwd: process.cwd() })
  parser.setFile(candidate?.path ?? null)
  const now = new Date()
  const state = buildHudState(process.cwd(), parser.parse(), now, config, now)
  return renderHud({
    config,
    state,
    options: {
      width: Math.min(process.stdout.columns || 120, 140),
      height: DEFAULT_HUD_MAX_HEIGHT,
      color: process.stdout.isTTY && !process.env.NO_COLOR,
    },
    now,
  }).join('\n') || '(No active Codex session data yet)'
}

export async function runConfigure(args: string[]): Promise<number> {
  const loaded = loadConfig()
  const preset = optionValue(args, '--preset')
  let language = optionValue(args, '--language')
  let layout = optionValue(args, '--layout')
  const nonInteractive = args.includes('--yes') || !process.stdin.isTTY
  const statusOnly = args.includes('--status')
  const json = args.includes('--json')
  const hasSelectiveChanges = args.includes('--enable') || args.includes('--disable')

  if (statusOnly) {
    const state = guidedElementState(loaded.config)
    const report = {
      configPath: loaded.path,
      language: loaded.config.language,
      layout: loaded.config.lineLayout,
      enabled: state.enabled,
      disabled: state.disabled,
    }
    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    }
    else {
      process.stdout.write(`${[
        `Config: ${report.configPath}`,
        `Language: ${report.language}`,
        `Layout: ${report.layout}`,
        `Enabled: ${report.enabled.join(', ') || '(none)'}`,
        `Disabled: ${report.disabled.join(', ') || '(none)'}`,
      ].join('\n')}\n`)
    }
    return 0
  }

  if (hasSelectiveChanges) {
    const config = isPreset(preset) ? createPreset(preset) : structuredClone(loaded.config)
    if (isPreset(preset)) {
      preserveAdvancedSettings(config, loaded.config)
    }
    if (isLanguage(language)) {
      config.language = language
    }
    if (isLayout(layout)) {
      config.lineLayout = layout
    }
    applyGuidedElementChanges(config, {
      enable: parseGuidedElements(optionValue(args, '--enable')),
      disable: parseGuidedElements(optionValue(args, '--disable')),
    })
    const configPath = writeConfig(config, loaded.raw)
    process.stdout.write(`${configPath}\n`)
    return 0
  }

  if (!nonInteractive) {
    prompts.intro('Codex HUD display configuration')
  }

  let base: ConfigPreset | 'current'

  if (isPreset(preset)) {
    base = preset
  }
  else {
    if (nonInteractive) {
      base = 'current'
    }
    else {
      const selected = await prompts.select({
        message: 'Choose a configuration base',
        initialValue: 'current',
        options: [
          { value: 'current', label: 'Current settings', hint: 'Edit only what you choose below' },
          { value: 'full', label: 'Full', hint: 'All telemetry and activity' },
          { value: 'essential', label: 'Essential', hint: 'Context, quota, tools, agents, tasks' },
          { value: 'minimal', label: 'Minimal', hint: 'Model, project, context' },
        ],
      })
      if (cancelled(selected)) {
        return 1
      }
      base = selected as ConfigPreset | 'current'
    }
  }

  const config = base === 'current' ? structuredClone(loaded.config) : createPreset(base)
  if (base !== 'current') {
    preserveAdvancedSettings(config, loaded.config)
  }

  if (!isLanguage(language)) {
    if (nonInteractive) {
      language = config.language
    }
    else {
      const selected = await prompts.select({
        message: 'Choose label language',
        initialValue: config.language,
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

  const selectedLanguage = isLanguage(language) ? language : config.language
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
      initialValues: guidedElementState(config).enabled,
      required: false,
      options: GUIDED_ELEMENTS.map(element => ({
        value: element.name,
        label: `${element.category} · ${element.label}`,
      })),
    })
    if (cancelled(toggles)) {
      return 1
    }
    const enabled = toggles as typeof GUIDED_ELEMENTS[number]['name'][]
    applyGuidedElementChanges(config, {
      enable: enabled,
      disable: GUIDED_ELEMENTS.map(element => element.name).filter(element => !enabled.includes(element)),
    })

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
      message: `Save ${base} / ${selectedLanguage} / ${config.lineLayout} configuration?`,
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

import type { ConfigPreset } from '../config/presets.js'
import type { HudConfig, Language, LineLayout } from '../types/config.js'
// @env node
import process from 'node:process'
import * as prompts from '@clack/prompts'
import { readConfiguredExternalUsage } from '../codex/external-usage.js'
import { persistRolloutRateLimits, readLatestLoggedRateLimits } from '../codex/log-rate-limits.js'
import { evaluateUsageTrust } from '../codex/rate-limits.js'
import { RolloutParser } from '../codex/rollout-parser.js'
import { isOfficialOpenAIEndpoint, resolveSessionEndpoint } from '../codex/session-endpoint.js'
import { findActiveSession } from '../codex/session-finder.js'
import { hasTrustedOpenAiAuth } from '../collectors/session-metadata.js'
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
import { DEFAULT_GENERAL_EXTERNAL_USAGE_QUERY } from '../types/config.js'

const CONFIGURE_MESSAGES = {
  'en': {
    intro: 'Codex HUD display configuration',
    cancelled: 'Configuration cancelled.',
    chooseBase: 'Choose a configuration base',
    current: 'Current settings',
    currentHint: 'Edit only what you choose below',
    full: 'Full',
    fullHint: 'All telemetry and activity',
    essential: 'Essential',
    essentialHint: 'Context, quota, tools, agents, tasks',
    minimal: 'Minimal',
    minimalHint: 'Model, project, context',
    presentation: 'Presentation',
    presentationHint: 'Hide transcript, auth user, image, and tool details',
    chooseLanguage: 'Choose label language',
    chooseLayout: 'Choose layout',
    expanded: 'Expanded',
    expandedHint: 'Multiple readable lines',
    compact: 'Compact',
    compactHint: 'Dense header plus activity',
    chooseElements: 'Choose visible HUD elements',
    pathDepth: 'Project path depth',
    projectOnly: 'Project only',
    parentProject: 'Parent / project',
    parentsProject: 'Two parents / project',
    preview: 'HUD preview',
    noSession: '(No active Codex session data yet)',
    config: 'Config',
    language: 'Language',
    layout: 'Layout',
    enabled: 'Enabled',
    disabled: 'Disabled',
    none: '(none)',
    categories: {
      Project: 'Project',
      Usage: 'Usage',
      Activity: 'Activity',
      Environment: 'Environment',
      Session: 'Session',
    },
    elements: {
      git: 'Git status',
      usage: 'Rate limits and credits',
      promptCache: 'Prompt-cache estimate',
      tools: 'Tool activity',
      skills: 'Active skills',
      mcp: 'MCP activity',
      agents: 'Subagents',
      todos: 'Plan / todos',
      goal: 'Durable goal',
      turns: 'Conversation navigator',
      images: 'Session image gallery',
      configCounts: 'Environment counts',
      auth: 'Authentication method',
      memory: 'Approximate system memory',
      duration: 'Session duration',
      speed: 'Output speed',
      sessionName: 'Session title',
      sessionTokens: 'Session token totals',
      compactions: 'Compaction count',
    },
  },
  'zh-Hans': {
    intro: 'Codex HUD 显示配置',
    cancelled: '已取消配置。',
    chooseBase: '选择配置基础',
    current: '当前设置',
    currentHint: '只修改下方明确选择的项目',
    full: '完整',
    fullHint: '显示全部遥测与活动信息',
    essential: '常用',
    essentialHint: '上下文、额度、工具、子代理与任务',
    minimal: '最简',
    minimalHint: '模型、项目与上下文',
    presentation: '演示',
    presentationHint: '隐藏对话、认证用户、图片与工具详情',
    chooseLanguage: '选择标签语言',
    chooseLayout: '选择布局',
    expanded: '展开',
    expandedHint: '多行显示，便于阅读',
    compact: '紧凑',
    compactHint: '密集标题与活动信息',
    chooseElements: '选择要显示的 HUD 元素',
    pathDepth: '项目路径层级',
    projectOnly: '仅项目名',
    parentProject: '父目录 / 项目',
    parentsProject: '两级父目录 / 项目',
    preview: 'HUD 预览',
    noSession: '（暂无活动 Codex 会话数据）',
    config: '配置',
    language: '语言',
    layout: '布局',
    enabled: '已启用',
    disabled: '已禁用',
    none: '（无）',
    categories: {
      Project: '项目',
      Usage: '额度',
      Activity: '活动',
      Environment: '环境',
      Session: '会话',
    },
    elements: {
      git: 'Git 状态',
      usage: '限额与余额',
      promptCache: '提示缓存估计',
      tools: '工具活动',
      skills: '活动技能',
      mcp: 'MCP 活动',
      agents: '子代理',
      todos: '计划 / 待办',
      goal: '持久目标',
      turns: '对话导航器',
      images: '会话图片画廊',
      configCounts: '环境配置计数',
      auth: '认证方式',
      memory: '系统内存估计',
      duration: '会话时长',
      speed: '输出速度',
      sessionName: '会话标题',
      sessionTokens: '会话 Token 汇总',
      compactions: '压缩次数',
    },
  },
} as const

function ui(language: Language) {
  return CONFIGURE_MESSAGES[language]
}

function optionValue(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? null : null
}

function isPreset(value: string | null): value is ConfigPreset {
  return value === 'full' || value === 'essential' || value === 'minimal' || value === 'presentation'
}

function isLanguage(value: string | null): value is Language {
  return value === 'en' || value === 'zh-Hans'
}

function isLayout(value: string | null): value is LineLayout {
  return value === 'compact' || value === 'expanded'
}

function cancelled(value: unknown, language: Language): boolean {
  if (prompts.isCancel(value)) {
    prompts.cancel(ui(language).cancelled)
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
    'externalUsageQueries',
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

async function preview(config: HudConfig): Promise<string> {
  const parser = new RolloutParser({ captureConversationBodies: false })
  const candidate = findActiveSession({ cwd: process.cwd() })
  parser.setFile(candidate?.path ?? null)
  const now = new Date()
  const rollout = parser.parse()
  const endpoint = rollout.session ? resolveSessionEndpoint(rollout.session.id) : null
  const usageTrust = evaluateUsageTrust(
    endpoint?.url ?? null,
    hasTrustedOpenAiAuth(rollout.session, process.env),
  )
  if (usageTrust.trusted) {
    persistRolloutRateLimits(
      rollout.usage,
      rollout.usageObservedAt,
      usageTrust.effectiveEndpoint,
    )
  }
  const loggedUsage = usageTrust.trusted && isOfficialOpenAIEndpoint(usageTrust.effectiveEndpoint)
    ? readLatestLoggedRateLimits(process.env, now.getTime(), usageTrust.effectiveEndpoint)?.usage ?? null
    : null
  const queriedUsage = config.display.showAuth
    ? await readConfiguredExternalUsage(config.display.externalUsageQueries, endpoint?.url ?? null, process.env, now.getTime())
    : null
  const state = buildHudState(
    process.cwd(),
    rollout,
    now,
    config,
    now,
    null,
    loggedUsage,
    queriedUsage,
    endpoint?.url ?? null,
  )
  return renderHud({
    config,
    state,
    options: {
      width: Math.min(process.stdout.columns || 120, 140),
      height: DEFAULT_HUD_MAX_HEIGHT,
      color: process.stdout.isTTY && !process.env.NO_COLOR,
    },
    now,
  }).join('\n') || ui(config.language).noSession
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
  let uiLanguage: Language = isLanguage(language) ? language : loaded.config.language

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
      const labels = ui(loaded.config.language)
      process.stdout.write(`${[
        `${labels.config}: ${report.configPath}`,
        `${labels.language}: ${report.language}`,
        `${labels.layout}: ${report.layout}`,
        `${labels.enabled}: ${report.enabled.join(', ') || labels.none}`,
        `${labels.disabled}: ${report.disabled.join(', ') || labels.none}`,
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
    prompts.intro(ui(uiLanguage).intro)
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
      const labels = ui(uiLanguage)
      const selected = await prompts.select({
        message: labels.chooseBase,
        initialValue: 'current',
        options: [
          { value: 'current', label: labels.current, hint: labels.currentHint },
          { value: 'full', label: labels.full, hint: labels.fullHint },
          { value: 'essential', label: labels.essential, hint: labels.essentialHint },
          { value: 'minimal', label: labels.minimal, hint: labels.minimalHint },
          { value: 'presentation', label: labels.presentation, hint: labels.presentationHint },
        ],
      })
      if (cancelled(selected, uiLanguage)) {
        return 1
      }
      base = selected as ConfigPreset | 'current'
    }
  }

  const config = base === 'current' ? structuredClone(loaded.config) : createPreset(base)
  if (base !== 'current') {
    preserveAdvancedSettings(config, loaded.config)
  }
  if (args.includes('--relay-usage')) {
    config.display.externalUsageQueries = [structuredClone(DEFAULT_GENERAL_EXTERNAL_USAGE_QUERY)]
  }
  else if (args.includes('--no-relay-usage')) {
    config.display.externalUsageQueries = []
  }

  if (!isLanguage(language)) {
    if (nonInteractive) {
      language = config.language
    }
    else {
      const labels = ui(uiLanguage)
      const selected = await prompts.select({
        message: labels.chooseLanguage,
        initialValue: config.language,
        options: [
          { value: 'en', label: 'English' },
          { value: 'zh-Hans', label: '简体中文' },
        ],
      })
      if (cancelled(selected, uiLanguage)) {
        return 1
      }
      language = selected as Language
    }
  }

  const selectedLanguage = isLanguage(language) ? language : config.language
  config.language = selectedLanguage
  uiLanguage = selectedLanguage

  if (!isLayout(layout) && !nonInteractive) {
    const labels = ui(uiLanguage)
    const selected = await prompts.select({
      message: labels.chooseLayout,
      initialValue: config.lineLayout,
      options: [
        { value: 'expanded', label: labels.expanded, hint: labels.expandedHint },
        { value: 'compact', label: labels.compact, hint: labels.compactHint },
      ],
    })
    if (cancelled(selected, uiLanguage)) {
      return 1
    }
    layout = selected as LineLayout
  }
  if (isLayout(layout)) {
    config.lineLayout = layout
  }

  if (!nonInteractive) {
    const labels = ui(uiLanguage)
    const toggles = await prompts.multiselect({
      message: labels.chooseElements,
      initialValues: guidedElementState(config).enabled,
      required: false,
      options: GUIDED_ELEMENTS.map(element => ({
        value: element.name,
        label: `${labels.categories[element.category]} · ${labels.elements[element.name]}`,
      })),
    })
    if (cancelled(toggles, uiLanguage)) {
      return 1
    }
    const enabled = toggles as typeof GUIDED_ELEMENTS[number]['name'][]
    applyGuidedElementChanges(config, {
      enable: enabled,
      disable: GUIDED_ELEMENTS.map(element => element.name).filter(element => !enabled.includes(element)),
    })

    const pathLevels = await prompts.select({
      message: labels.pathDepth,
      initialValue: config.pathLevels,
      options: [
        { value: 1, label: labels.projectOnly },
        { value: 2, label: labels.parentProject },
        { value: 3, label: labels.parentsProject },
      ],
    })
    if (cancelled(pathLevels, uiLanguage)) {
      return 1
    }
    config.pathLevels = pathLevels as 1 | 2 | 3

    prompts.note(await preview(config), labels.preview)
    const confirmed = await prompts.confirm({
      message: uiLanguage === 'zh-Hans'
        ? `保存 ${base} / ${selectedLanguage} / ${config.lineLayout} 配置？`
        : `Save ${base} / ${selectedLanguage} / ${config.lineLayout} configuration?`,
      initialValue: true,
    })
    if (cancelled(confirmed, uiLanguage) || !confirmed) {
      return 1
    }
  }

  const configPath = writeConfig(config, loaded.raw)
  if (!nonInteractive) {
    prompts.outro(uiLanguage === 'zh-Hans' ? `已保存 ${configPath}` : `Saved ${configPath}`)
  }
  else {
    process.stdout.write(`${configPath}\n`)
  }
  return 0
}

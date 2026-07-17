import type {
  ContextValueMode,
  CustomLinePosition,
  GitBranchOverflowMode,
  HudColorName,
  HudColorValue,
  HudConfig,
  HudElement,
  Language,
  LineLayout,
  ModelFormatMode,
  TimeFormatMode,
  UsageValueMode,
} from '../types/config.js'
import {
  DEFAULT_CONFIG,
  DEFAULT_ELEMENT_ORDER,
  DEFAULT_MERGE_GROUPS,
} from '../types/config.js'
import {
  KNOWN_ELEMENTS,
  MAX_PROMPT_CACHE_TTL_SECONDS,
  MAX_REFRESH_INTERVAL_MS,
  MIN_PROMPT_CACHE_TTL_SECONDS,
  MIN_REFRESH_INTERVAL_MS,
} from './constants.js'

type UnknownRecord = Record<string, unknown>

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const UNSAFE_CODEPOINT = /[\p{Cc}\p{Cf}\p{Variation_Selector}\p{Zl}\p{Zp}\p{Cn}]/u

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && !UNSAFE_CODEPOINT.test(value) ? value : fallback
}

function numberValue(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  const clamped = Math.min(max, Math.max(min, value))
  return integer ? Math.round(clamped) : clamped
}

function nullablePositiveInteger(value: unknown, fallback: number | null): number | null {
  if (value === null) {
    return null
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback
  }
  return Math.round(value)
}

function colorValue(value: unknown, fallback: HudColorValue): HudColorValue {
  const named: HudColorName[] = [
    'dim',
    'red',
    'green',
    'yellow',
    'magenta',
    'cyan',
    'brightBlue',
    'brightMagenta',
  ]
  if (typeof value === 'string' && (named.includes(value as HudColorName) || HEX_COLOR_PATTERN.test(value))) {
    return value
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255) {
    return value
  }
  return fallback
}

function barCharacter(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value || UNSAFE_CODEPOINT.test(value)) {
    return fallback
  }
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return Array.from(segmenter.segment(value)).length === 1 ? value : fallback
}

function languageValue(value: unknown, fallback: Language): Language {
  if (value === 'zh')
    return 'zh-Hans'
  if (value === 'zh-TW')
    return 'zh-Hant'
  return enumValue<Language>(value, ['en', 'zh-Hans', 'zh-Hant'], fallback)
}

function elementOrder(value: unknown): HudElement[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_ELEMENT_ORDER]
  }
  const seen = new Set<HudElement>()
  const result: HudElement[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !KNOWN_ELEMENTS.has(item as HudElement)) {
      continue
    }
    const element = item as HudElement
    if (!seen.has(element)) {
      seen.add(element)
      result.push(element)
    }
  }
  return result.length > 0 ? result : [...DEFAULT_ELEMENT_ORDER]
}

function mergeGroups(value: unknown): HudElement[][] {
  if (!Array.isArray(value)) {
    return DEFAULT_MERGE_GROUPS.map(group => [...group])
  }
  if (value.length === 0) {
    return []
  }
  const used = new Set<HudElement>()
  const result: HudElement[][] = []
  for (const rawGroup of value) {
    if (!Array.isArray(rawGroup)) {
      continue
    }
    const group: HudElement[] = []
    for (const item of rawGroup) {
      if (typeof item !== 'string' || !KNOWN_ELEMENTS.has(item as HudElement)) {
        continue
      }
      const element = item as HudElement
      if (!used.has(element) && !group.includes(element)) {
        group.push(element)
      }
    }
    if (group.length >= 2) {
      group.forEach(element => used.add(element))
      result.push(group)
    }
  }
  return result.length > 0 ? result : DEFAULT_MERGE_GROUPS.map(group => [...group])
}

export function validateConfig(value: unknown): HudConfig {
  const root = isRecord(value) ? value : {}
  const rawGit = isRecord(root.gitStatus) ? root.gitStatus : {}
  const rawDisplay = isRecord(root.display) ? root.display : {}
  const rawColors = isRecord(root.colors) ? root.colors : {}
  const fallback = DEFAULT_CONFIG

  return {
    language: languageValue(root.language, fallback.language),
    lineLayout: enumValue<LineLayout>(root.lineLayout, ['compact', 'expanded'], fallback.lineLayout),
    showSeparators: booleanValue(root.showSeparators, fallback.showSeparators),
    pathLevels: numberValue(root.pathLevels, fallback.pathLevels, 1, 3, true) as 1 | 2 | 3,
    maxWidth: nullablePositiveInteger(root.maxWidth, fallback.maxWidth),
    forceMaxWidth: booleanValue(root.forceMaxWidth, fallback.forceMaxWidth),
    refreshIntervalMs: numberValue(
      root.refreshIntervalMs,
      fallback.refreshIntervalMs,
      MIN_REFRESH_INTERVAL_MS,
      MAX_REFRESH_INTERVAL_MS,
      true,
    ),
    elementOrder: elementOrder(root.elementOrder),
    gitStatus: {
      enabled: booleanValue(rawGit.enabled, fallback.gitStatus.enabled),
      showDirty: booleanValue(rawGit.showDirty, fallback.gitStatus.showDirty),
      showAheadBehind: booleanValue(rawGit.showAheadBehind, fallback.gitStatus.showAheadBehind),
      showFileStats: booleanValue(rawGit.showFileStats, fallback.gitStatus.showFileStats),
      branchOverflow: enumValue<GitBranchOverflowMode>(
        rawGit.branchOverflow,
        ['truncate', 'wrap'],
        fallback.gitStatus.branchOverflow,
      ),
      pushWarningThreshold: numberValue(rawGit.pushWarningThreshold, fallback.gitStatus.pushWarningThreshold, 0, 10_000, true),
      pushCriticalThreshold: numberValue(rawGit.pushCriticalThreshold, fallback.gitStatus.pushCriticalThreshold, 0, 10_000, true),
    },
    display: {
      showModel: booleanValue(rawDisplay.showModel, fallback.display.showModel),
      showProject: booleanValue(rawDisplay.showProject, fallback.display.showProject),
      showAddedDirs: booleanValue(rawDisplay.showAddedDirs, fallback.display.showAddedDirs),
      addedDirsLayout: enumValue(rawDisplay.addedDirsLayout, ['inline', 'line'], fallback.display.addedDirsLayout),
      showContextBar: booleanValue(rawDisplay.showContextBar, fallback.display.showContextBar),
      contextValue: enumValue<ContextValueMode>(rawDisplay.contextValue, ['percent', 'tokens', 'remaining', 'both'], fallback.display.contextValue),
      showConfigCounts: booleanValue(rawDisplay.showConfigCounts, fallback.display.showConfigCounts),
      showCost: booleanValue(rawDisplay.showCost, fallback.display.showCost),
      showDuration: booleanValue(rawDisplay.showDuration, fallback.display.showDuration),
      showSpeed: booleanValue(rawDisplay.showSpeed, fallback.display.showSpeed),
      showTokenBreakdown: booleanValue(rawDisplay.showTokenBreakdown, fallback.display.showTokenBreakdown),
      showUsage: booleanValue(rawDisplay.showUsage, fallback.display.showUsage),
      usageValue: enumValue<UsageValueMode>(rawDisplay.usageValue, ['percent', 'remaining'], fallback.display.usageValue),
      usageBarEnabled: booleanValue(rawDisplay.usageBarEnabled, fallback.display.usageBarEnabled),
      usageCompact: booleanValue(rawDisplay.usageCompact, fallback.display.usageCompact),
      showResetLabel: booleanValue(rawDisplay.showResetLabel, fallback.display.showResetLabel),
      showTools: booleanValue(rawDisplay.showTools, fallback.display.showTools),
      showSkills: booleanValue(rawDisplay.showSkills, fallback.display.showSkills),
      showMcp: booleanValue(rawDisplay.showMcp, fallback.display.showMcp),
      toolNameMaxLength: numberValue(rawDisplay.toolNameMaxLength, fallback.display.toolNameMaxLength, 0, 256, true),
      toolsMaxVisible: numberValue(rawDisplay.toolsMaxVisible, fallback.display.toolsMaxVisible, 0, 100, true),
      showAgents: booleanValue(rawDisplay.showAgents, fallback.display.showAgents),
      showTodos: booleanValue(rawDisplay.showTodos, fallback.display.showTodos),
      showGoal: booleanValue(rawDisplay.showGoal, fallback.display.showGoal),
      showSessionName: booleanValue(rawDisplay.showSessionName, fallback.display.showSessionName),
      showAuth: booleanValue(rawDisplay.showAuth, fallback.display.showAuth),
      showAuthUser: booleanValue(rawDisplay.showAuthUser, fallback.display.showAuthUser),
      authUserLength: numberValue(rawDisplay.authUserLength, fallback.display.authUserLength, 0, 256, true),
      showCodexVersion: booleanValue(rawDisplay.showCodexVersion, fallback.display.showCodexVersion),
      showEffortLevel: booleanValue(rawDisplay.showEffortLevel, fallback.display.showEffortLevel),
      showApprovalPolicy: booleanValue(rawDisplay.showApprovalPolicy, fallback.display.showApprovalPolicy),
      showPermissionProfile: booleanValue(rawDisplay.showPermissionProfile, fallback.display.showPermissionProfile),
      showSandboxMode: booleanValue(rawDisplay.showSandboxMode, fallback.display.showSandboxMode),
      showCollaborationMode: booleanValue(rawDisplay.showCollaborationMode, fallback.display.showCollaborationMode),
      showMemoryUsage: booleanValue(rawDisplay.showMemoryUsage, fallback.display.showMemoryUsage),
      showPromptCache: booleanValue(rawDisplay.showPromptCache, fallback.display.showPromptCache),
      promptCacheTtlSeconds: numberValue(
        rawDisplay.promptCacheTtlSeconds,
        fallback.display.promptCacheTtlSeconds,
        MIN_PROMPT_CACHE_TTL_SECONDS,
        MAX_PROMPT_CACHE_TTL_SECONDS,
        true,
      ),
      showSessionTokens: booleanValue(rawDisplay.showSessionTokens, fallback.display.showSessionTokens),
      showSessionStartDate: booleanValue(rawDisplay.showSessionStartDate, fallback.display.showSessionStartDate),
      showLastResponseAt: booleanValue(rawDisplay.showLastResponseAt, fallback.display.showLastResponseAt),
      showCompactions: booleanValue(rawDisplay.showCompactions, fallback.display.showCompactions),
      showSessionId: booleanValue(rawDisplay.showSessionId, fallback.display.showSessionId),
      mergeGroups: mergeGroups(rawDisplay.mergeGroups),
      contextWarningThreshold: numberValue(rawDisplay.contextWarningThreshold, fallback.display.contextWarningThreshold, 0, 100),
      contextCriticalThreshold: numberValue(rawDisplay.contextCriticalThreshold, fallback.display.contextCriticalThreshold, 0, 100),
      usageThreshold: numberValue(rawDisplay.usageThreshold, fallback.display.usageThreshold, 0, 100),
      sevenDayThreshold: numberValue(rawDisplay.sevenDayThreshold, fallback.display.sevenDayThreshold, 0, 100),
      environmentThreshold: numberValue(rawDisplay.environmentThreshold, fallback.display.environmentThreshold, 0, 100),
      externalUsagePath: stringValue(rawDisplay.externalUsagePath, fallback.display.externalUsagePath),
      externalUsageWritePath: stringValue(rawDisplay.externalUsageWritePath, fallback.display.externalUsageWritePath),
      externalUsageFreshnessMs: numberValue(rawDisplay.externalUsageFreshnessMs, fallback.display.externalUsageFreshnessMs, 1_000, 86_400_000, true),
      modelFormat: enumValue<ModelFormatMode>(rawDisplay.modelFormat, ['full', 'compact', 'short'], fallback.display.modelFormat),
      modelOverride: stringValue(rawDisplay.modelOverride, fallback.display.modelOverride),
      showProvider: booleanValue(rawDisplay.showProvider, fallback.display.showProvider),
      providerName: stringValue(rawDisplay.providerName, fallback.display.providerName),
      customLine: stringValue(rawDisplay.customLine, fallback.display.customLine),
      customLinePosition: enumValue<CustomLinePosition>(rawDisplay.customLinePosition, ['first', 'last'], fallback.display.customLinePosition),
      timeFormat: enumValue<TimeFormatMode>(
        rawDisplay.timeFormat,
        ['relative', 'absolute', 'both', 'elapsed', 'elapsedAndAbsolute'],
        fallback.display.timeFormat,
      ),
      autoCompactWindow: nullablePositiveInteger(rawDisplay.autoCompactWindow, fallback.display.autoCompactWindow),
    },
    colors: {
      context: colorValue(rawColors.context, fallback.colors.context),
      usage: colorValue(rawColors.usage, fallback.colors.usage),
      warning: colorValue(rawColors.warning, fallback.colors.warning),
      usageWarning: colorValue(rawColors.usageWarning, fallback.colors.usageWarning),
      critical: colorValue(rawColors.critical, fallback.colors.critical),
      model: colorValue(rawColors.model, fallback.colors.model),
      project: colorValue(rawColors.project, fallback.colors.project),
      git: colorValue(rawColors.git, fallback.colors.git),
      gitBranch: colorValue(rawColors.gitBranch, fallback.colors.gitBranch),
      label: colorValue(rawColors.label, fallback.colors.label),
      custom: colorValue(rawColors.custom, fallback.colors.custom),
      barFilled: barCharacter(rawColors.barFilled, fallback.colors.barFilled),
      barEmpty: barCharacter(rawColors.barEmpty, fallback.colors.barEmpty),
    },
  }
}

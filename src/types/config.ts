export type Language = 'en' | 'zh-Hans' | 'zh-Hant'
export type LineLayout = 'compact' | 'expanded'
export type ContextValueMode = 'percent' | 'tokens' | 'remaining' | 'both'
export type UsageValueMode = 'percent' | 'remaining'
export type TimeFormatMode = 'relative' | 'absolute' | 'both' | 'elapsed' | 'elapsedAndAbsolute'
export type ModelFormatMode = 'full' | 'compact' | 'short'
export type GitBranchOverflowMode = 'truncate' | 'wrap'
export type AddedDirsLayout = 'inline' | 'line'
export type CustomLinePosition = 'first' | 'last'

export type HudElement
  = | 'project'
    | 'addedDirs'
    | 'context'
    | 'usage'
    | 'promptCache'
    | 'memory'
    | 'environment'
    | 'tools'
    | 'skills'
    | 'mcp'
    | 'agents'
    | 'todos'
    | 'turns'
    | 'sessionTime'

export type HudColorName
  = | 'dim'
    | 'red'
    | 'green'
    | 'yellow'
    | 'magenta'
    | 'cyan'
    | 'brightBlue'
    | 'brightMagenta'

export type HudColorValue = HudColorName | number | string

export interface HudColorOverrides {
  context: HudColorValue
  usage: HudColorValue
  warning: HudColorValue
  usageWarning: HudColorValue
  critical: HudColorValue
  model: HudColorValue
  project: HudColorValue
  git: HudColorValue
  gitBranch: HudColorValue
  label: HudColorValue
  custom: HudColorValue
  barFilled: string
  barEmpty: string
}

export interface GitDisplayConfig {
  enabled: boolean
  showDirty: boolean
  showAheadBehind: boolean
  showFileStats: boolean
  branchOverflow: GitBranchOverflowMode
  pushWarningThreshold: number
  pushCriticalThreshold: number
}

export interface DisplayConfig {
  showModel: boolean
  showProject: boolean
  showAddedDirs: boolean
  addedDirsLayout: AddedDirsLayout
  showContextBar: boolean
  contextValue: ContextValueMode
  showConfigCounts: boolean
  showCost: boolean
  showDuration: boolean
  showSpeed: boolean
  showTokenBreakdown: boolean
  showUsage: boolean
  usageValue: UsageValueMode
  usageBarEnabled: boolean
  usageCompact: boolean
  showResetLabel: boolean
  showTools: boolean
  showSkills: boolean
  showMcp: boolean
  toolNameMaxLength: number
  toolsMaxVisible: number
  showAgents: boolean
  showTodos: boolean
  showGoal: boolean
  showTurns: boolean
  showSessionName: boolean
  showAuth: boolean
  showAuthUser: boolean
  authUserLength: number
  showCodexVersion: boolean
  showEffortLevel: boolean
  showApprovalPolicy: boolean
  showPermissionProfile: boolean
  showSandboxMode: boolean
  showCollaborationMode: boolean
  showMemoryUsage: boolean
  showPromptCache: boolean
  promptCacheTtlSeconds: number
  showSessionTokens: boolean
  showSessionStartDate: boolean
  showLastResponseAt: boolean
  showCompactions: boolean
  showSessionId: boolean
  mergeGroups: HudElement[][]
  contextWarningThreshold: number
  contextCriticalThreshold: number
  usageThreshold: number
  sevenDayThreshold: number
  environmentThreshold: number
  externalUsagePath: string
  externalUsageWritePath: string
  externalUsageFreshnessMs: number
  modelFormat: ModelFormatMode
  modelOverride: string
  showProvider: boolean
  providerName: string
  customLine: string
  customLinePosition: CustomLinePosition
  timeFormat: TimeFormatMode
  autoCompactWindow: number | null
}

export interface HudConfig {
  language: Language
  lineLayout: LineLayout
  showSeparators: boolean
  pathLevels: 1 | 2 | 3
  maxWidth: number | null
  forceMaxWidth: boolean
  refreshIntervalMs: number
  elementOrder: HudElement[]
  gitStatus: GitDisplayConfig
  display: DisplayConfig
  colors: HudColorOverrides
}

export const DEFAULT_ELEMENT_ORDER: HudElement[] = [
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
  'turns',
  'sessionTime',
]

export const DEFAULT_MERGE_GROUPS: HudElement[][] = [
  ['context', 'usage'],
]

export const DEFAULT_CONFIG: HudConfig = {
  language: 'en',
  lineLayout: 'expanded',
  showSeparators: false,
  pathLevels: 1,
  maxWidth: null,
  forceMaxWidth: false,
  refreshIntervalMs: 300,
  elementOrder: [...DEFAULT_ELEMENT_ORDER],
  gitStatus: {
    enabled: true,
    showDirty: true,
    showAheadBehind: false,
    showFileStats: false,
    branchOverflow: 'truncate',
    pushWarningThreshold: 0,
    pushCriticalThreshold: 0,
  },
  display: {
    showModel: true,
    showProject: true,
    showAddedDirs: true,
    addedDirsLayout: 'inline',
    showContextBar: true,
    contextValue: 'percent',
    showConfigCounts: false,
    showCost: false,
    showDuration: false,
    showSpeed: false,
    showTokenBreakdown: true,
    showUsage: true,
    usageValue: 'percent',
    usageBarEnabled: true,
    usageCompact: false,
    showResetLabel: true,
    showTools: false,
    showSkills: false,
    showMcp: false,
    toolNameMaxLength: 0,
    toolsMaxVisible: 4,
    showAgents: false,
    showTodos: false,
    showGoal: true,
    showTurns: true,
    showSessionName: false,
    showAuth: false,
    showAuthUser: false,
    authUserLength: 8,
    showCodexVersion: false,
    showEffortLevel: false,
    showApprovalPolicy: false,
    showPermissionProfile: false,
    showSandboxMode: false,
    showCollaborationMode: false,
    showMemoryUsage: false,
    showPromptCache: false,
    promptCacheTtlSeconds: 300,
    showSessionTokens: false,
    showSessionStartDate: false,
    showLastResponseAt: false,
    showCompactions: false,
    showSessionId: false,
    mergeGroups: DEFAULT_MERGE_GROUPS.map(group => [...group]),
    contextWarningThreshold: 70,
    contextCriticalThreshold: 85,
    usageThreshold: 0,
    sevenDayThreshold: 80,
    environmentThreshold: 0,
    externalUsagePath: '',
    externalUsageWritePath: '',
    externalUsageFreshnessMs: 300_000,
    modelFormat: 'full',
    modelOverride: '',
    showProvider: false,
    providerName: '',
    customLine: '',
    customLinePosition: 'last',
    timeFormat: 'relative',
    autoCompactWindow: null,
  },
  colors: {
    context: 'green',
    usage: 'brightBlue',
    warning: 'yellow',
    usageWarning: 'brightMagenta',
    critical: 'red',
    model: 'cyan',
    project: 'yellow',
    git: 'magenta',
    gitBranch: 'cyan',
    label: 'dim',
    custom: 208,
    barFilled: '█',
    barEmpty: '░',
  },
}

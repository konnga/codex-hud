import type { SessionSource } from './rollout.js'

export type ToolStatus = 'running' | 'completed' | 'error'
export type AgentStatus = 'starting' | 'running' | 'completed' | 'error'
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface ToolEntry {
  id: string
  name: string
  target?: string
  status: ToolStatus
  startTime: Date
  endTime?: Date
  durationMs?: number
}

export interface AgentEntry {
  id: string
  type: string
  model?: string
  description?: string
  path?: string
  status: AgentStatus
  startTime: Date
  endTime?: Date
  activeDescendantCount?: number
}

export interface TodoItem {
  content: string
  status: TodoStatus
}

export interface GoalState {
  objective?: string
  status?: string
  tokenBudget?: number | null
  tokensUsed?: number
  timeUsedSeconds?: number
}

export interface UsageWindow {
  label: string
  percent: number | null
  resetAt: Date | null
  windowMinutes?: number | null
}

export interface UsageData {
  primary: UsageWindow | null
  secondary: UsageWindow | null
  individual: UsageWindow | null
  planType: string | null
  balanceLabel: string | null
  limitReachedType: string | null
}

export interface SessionTokenUsage {
  inputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  totalTokens: number
}

export interface ContextUsage {
  used: number
  total: number
  percent: number
  remainingPercent: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
}

export interface GitStatus {
  isGitRepo: boolean
  branch: string | null
  isDirty: boolean
  ahead: number
  behind: number
  modified: number
  added: number
  deleted: number
  untracked: number
}

export interface ProjectInfo {
  cwd: string
  projectRoot: string
  projectName: string
  workspaceRoots: string[]
  agentsMdCount: number
  codexConfigCount: number
  rulesCount: number
  hooksCount: number
  skillsCount: number
  pluginsCount: number
  mcpCount: number
}

export interface MemoryInfo {
  totalBytes: number
  usedBytes: number
  freeBytes: number
  usedPercent: number
}

export interface SessionInfo {
  id: string
  rolloutPath: string
  startTime: Date
  cwd: string
  workspaceRoots?: string[]
  originator?: string
  cliVersion?: string
  model?: string
  reasoningEffort?: string
  modelProvider?: string
  source?: SessionSource
  turnId?: string
  collaborationMode?: string
  approvalPolicy?: string
  sandboxMode?: string
  permissionProfile?: string
  sessionName?: string
  lastResponseAt?: Date
  lastTurnStartedAt?: Date
  lastTurnCompletedAt?: Date
  lastTurnDurationMs?: number
  timeToFirstTokenMs?: number
  outputTokensPerSecond?: number
}

export interface AuthInfo {
  method: string
  user?: string
}

export interface HudState {
  session: SessionInfo | null
  project: ProjectInfo
  git: GitStatus | null
  context: ContextUsage | null
  usage: UsageData | null
  sessionTokens: SessionTokenUsage | null
  tools: ToolEntry[]
  skills: string[]
  mcpServers: string[]
  agents: AgentEntry[]
  todos: TodoItem[]
  goal: GoalState | null
  compactCount: number
  memory: MemoryInfo | null
  auth: AuthInfo | null
  sessionStart: Date
}

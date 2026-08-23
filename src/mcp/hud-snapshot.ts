// @env node
import type {
  AgentEntry,
  ConversationTurn,
  GitStatus,
  HudState,
  ProjectInfo,
  SessionImage,
  SessionInfo,
  SessionTokenUsage,
  TodoItem,
  ToolEntry,
  UsageData,
} from '../types/state.js'

export interface HudSnapshot {
  generatedAt: string
  session: SerializedSessionInfo | null
  project: ProjectInfo
  git: GitStatus | null
  context: HudState['context']
  usage: SerializedUsageData | null
  sessionTokens: SessionTokenUsage | null
  tools: SerializedToolEntry[]
  images: SerializedSessionImage[]
  skills: string[]
  mcpServers: string[]
  agents: SerializedAgentEntry[]
  todos: TodoItem[]
  goal: HudState['goal']
  conversationTurns: SerializedConversationTurn[]
  compactCount: number
  memory: HudState['memory']
  auth: HudState['auth']
  sessionStart: string
}

interface SerializedSessionInfo extends Omit<SessionInfo, 'rolloutPath' | 'startTime' | 'lastResponseAt' | 'lastTurnStartedAt' | 'lastTurnCompletedAt'> {
  startTime: string
  lastResponseAt?: string
  lastTurnStartedAt?: string
  lastTurnCompletedAt?: string
}

interface SerializedUsageData extends Omit<UsageData, 'primary' | 'secondary' | 'individual'> {
  primary: SerializedUsageWindow | null
  secondary: SerializedUsageWindow | null
  individual: SerializedUsageWindow | null
}

interface SerializedUsageWindow {
  label: string
  percent: number | null
  resetAt: string | null
  windowMinutes?: number | null
}

interface SerializedToolEntry extends Omit<ToolEntry, 'startTime' | 'endTime'> {
  startTime: string
  endTime?: string
}

interface SerializedSessionImage extends Omit<SessionImage, 'createdAt'> {
  createdAt: string
}

interface SerializedAgentEntry extends Omit<AgentEntry, 'startTime' | 'endTime'> {
  startTime: string
  endTime?: string
}

interface SerializedConversationTurn extends Pick<ConversationTurn, 'id' | 'turnId' | 'assistantPhase'> {
  startedAt: string
}

function iso(value: Date | null | undefined): string | undefined {
  return value?.toISOString()
}

function serializeSession(session: SessionInfo | null): SerializedSessionInfo | null {
  if (!session)
    return null
  const { rolloutPath: _, ...safeSession } = session
  return {
    ...safeSession,
    startTime: session.startTime.toISOString(),
    lastResponseAt: iso(session.lastResponseAt),
    lastTurnStartedAt: iso(session.lastTurnStartedAt),
    lastTurnCompletedAt: iso(session.lastTurnCompletedAt),
  }
}

function serializeUsage(usage: UsageData | null): SerializedUsageData | null {
  if (!usage)
    return null
  const window = (value: UsageData['primary']): SerializedUsageWindow | null => value
    ? { ...value, resetAt: iso(value.resetAt) ?? null }
    : null
  return {
    ...usage,
    primary: window(usage.primary),
    secondary: window(usage.secondary),
    individual: window(usage.individual),
  }
}

export function toHudSnapshot(state: HudState, generatedAt = new Date()): HudSnapshot {
  return {
    generatedAt: generatedAt.toISOString(),
    session: serializeSession(state.session),
    project: state.project,
    git: state.git,
    context: state.context,
    usage: serializeUsage(state.usage),
    sessionTokens: state.sessionTokens,
    tools: state.tools.map(tool => ({ ...tool, startTime: tool.startTime.toISOString(), endTime: iso(tool.endTime) })),
    images: state.images.map(image => ({ ...image, createdAt: image.createdAt.toISOString() })),
    skills: state.skills,
    mcpServers: state.mcpServers,
    agents: state.agents.map(agent => ({ ...agent, startTime: agent.startTime.toISOString(), endTime: iso(agent.endTime) })),
    todos: state.todos,
    goal: state.goal,
    conversationTurns: state.conversationTurns.map(turn => ({
      id: turn.id,
      turnId: turn.turnId,
      assistantPhase: turn.assistantPhase,
      startedAt: turn.startedAt.toISOString(),
    })),
    compactCount: state.compactCount,
    memory: state.memory,
    auth: state.auth,
    sessionStart: state.sessionStart.toISOString(),
  }
}

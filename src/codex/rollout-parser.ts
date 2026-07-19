import type {
  EventMessagePayload,
  RawPlanStep,
  ResponseItemPayload,
  RolloutEntry,
  SessionMetaPayload,
  TokenUsage,
  TokenUsageInfo,
  TurnContextPayload,
} from '../types/rollout.js'
import type {
  ContextUsage,
  ConversationTurn,
  GoalState,
  SessionInfo,
  SessionTokenUsage,
  TodoItem,
  ToolEntry,
  UsageData,
} from '../types/state.js'
// @env node
import process from 'node:process'
import { calculateContextUsage } from './context-usage.js'
import { JsonlTail } from './jsonl-tail.js'
import { normalizeRateLimits } from './rate-limits.js'

const MAX_RECENT_TOOLS = 100
const MAX_TARGET_LENGTH = 80

export interface ParsedRolloutState {
  session: SessionInfo | null
  context: ContextUsage | null
  usage: UsageData | null
  sessionTokens: SessionTokenUsage | null
  tools: ToolEntry[]
  skills: string[]
  mcpServers: string[]
  todos: TodoItem[]
  goal: GoalState | null
  conversationTurns: ConversationTurn[]
  compactCount: number
}

function initialState(): ParsedRolloutState {
  return {
    session: null,
    context: null,
    usage: null,
    sessionTokens: null,
    tools: [],
    skills: [],
    mcpServers: [],
    todos: [],
    goal: null,
    conversationTurns: [],
    compactCount: 0,
  }
}

function safeDate(value: unknown, fallback: Date): Date {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return fallback
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date
}

function policyLabel(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('type' in value && typeof value.type === 'string') {
      return value.type
    }
    if ('granular' in value) {
      return 'granular'
    }
  }
  return undefined
}

function parseArguments(value: string | undefined): Record<string, unknown> | null {
  if (!value) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  }
  catch {
    return null
  }
}

function truncate(value: string): string {
  const normalized = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127 ? ' ' : character
  }).join('').replace(/\s+/g, ' ').trim()
  return normalized.length <= MAX_TARGET_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_TARGET_LENGTH - 1)}…`
}

function nestedToolName(input: string | undefined): string | null {
  if (!input) {
    return null
  }
  return /\btools\.(\w+)/.exec(input)?.[1] ?? null
}

function displayToolName(payload: ResponseItemPayload): string {
  if (payload.name === 'exec') {
    return nestedToolName(payload.input) ?? payload.name
  }
  return payload.name || 'tool'
}

function toolTarget(payload: ResponseItemPayload): string | undefined {
  const args = parseArguments(payload.arguments)
  if (args) {
    const candidates = [
      args.file_path,
      args.path,
      args.file,
      args.pattern,
      args.command,
      args.cmd,
      args.description,
      args.question,
      args.target,
    ]
    const target = candidates.find(value => typeof value === 'string')
    if (typeof target === 'string') {
      return truncate(target)
    }
  }
  if (payload.name === 'exec') {
    const nested = nestedToolName(payload.input)
    return nested ? undefined : payload.input ? truncate(payload.input) : undefined
  }
  return undefined
}

function isErrorOutput(output: unknown): boolean {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const record = output as Record<string, unknown>
    return record.success === false || record.status === 'error' || record.is_error === true
  }
  return false
}

function toSessionTokens(usage: TokenUsage | undefined): SessionTokenUsage | null {
  if (!usage) {
    return null
  }
  return {
    inputTokens: Math.max(0, usage.input_tokens ?? 0),
    outputTokens: Math.max(0, usage.output_tokens ?? 0),
    reasoningOutputTokens: Math.max(0, usage.reasoning_output_tokens ?? 0),
    cachedInputTokens: Math.max(0, usage.cached_input_tokens ?? 0),
    cacheWriteInputTokens: Math.max(0, usage.cache_write_input_tokens ?? 0),
    totalTokens: Math.max(0, usage.total_tokens ?? 0),
  }
}

function normalizePlan(plan: RawPlanStep[] | undefined): TodoItem[] {
  if (!Array.isArray(plan)) {
    return []
  }
  return plan.flatMap((item): TodoItem[] => {
    if (typeof item.step !== 'string' || !item.step.trim()) {
      return []
    }
    const status = item.status === 'in_progress'
      ? 'in_progress'
      : item.status === 'completed' ? 'completed' : 'pending'
    return [{ content: truncate(item.step), status }]
  })
}

function normalizeGoal(value: unknown): GoalState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const goal = value as Record<string, unknown>
  return {
    objective: typeof goal.objective === 'string' ? truncate(goal.objective) : undefined,
    status: typeof goal.status === 'string' ? goal.status : undefined,
    tokenBudget: typeof (goal.tokenBudget ?? goal.token_budget) === 'number'
      ? goal.tokenBudget as number ?? goal.token_budget as number
      : null,
    tokensUsed: typeof (goal.tokensUsed ?? goal.tokens_used) === 'number'
      ? (goal.tokensUsed ?? goal.tokens_used) as number
      : undefined,
    timeUsedSeconds: typeof (goal.timeUsedSeconds ?? goal.time_used_seconds) === 'number'
      ? (goal.timeUsedSeconds ?? goal.time_used_seconds) as number
      : undefined,
  }
}

export class RolloutParser {
  private readonly tail = new JsonlTail()
  private state: ParsedRolloutState = initialState()
  private filePath: string | null = null
  private readonly runningTools = new Map<string, ToolEntry>()
  private latestTokenUsage: TokenUsageInfo | null = null

  setFile(filePath: string | null): void {
    if (filePath === this.filePath) {
      return
    }
    this.filePath = filePath
    this.reset()
  }

  reset(): void {
    this.tail.reset()
    this.state = initialState()
    this.runningTools.clear()
    this.latestTokenUsage = null
  }

  getState(): ParsedRolloutState {
    return structuredClone(this.state)
  }

  parse(): ParsedRolloutState {
    if (!this.filePath) {
      return this.getState()
    }
    const result = this.tail.read(this.filePath)
    if (result.reset) {
      this.state = initialState()
      this.runningTools.clear()
      this.latestTokenUsage = null
    }
    for (const line of result.lines) {
      this.parseLine(line)
    }
    return this.getState()
  }

  private parseLine(line: string): void {
    let entry: RolloutEntry
    try {
      entry = JSON.parse(line) as RolloutEntry
    }
    catch {
      return
    }
    const timestamp = safeDate(entry.timestamp, new Date())

    if (entry.type === 'session_meta') {
      this.onSessionMeta(entry.payload as SessionMetaPayload, timestamp)
      return
    }
    if (entry.type === 'turn_context') {
      this.onTurnContext(entry.payload as TurnContextPayload)
      return
    }
    if (entry.type === 'response_item') {
      this.onResponseItem(entry.payload as ResponseItemPayload, timestamp)
      return
    }
    if (entry.type === 'event_msg') {
      this.onEvent(entry.payload as EventMessagePayload, timestamp)
    }
  }

  private onSessionMeta(payload: SessionMetaPayload, timestamp: Date): void {
    const id = payload.session_id ?? payload.id
    if (!id || !this.filePath) {
      return
    }
    this.state.session = {
      id,
      rolloutPath: this.filePath,
      startTime: safeDate(payload.timestamp, timestamp),
      cwd: payload.cwd ?? process.cwd(),
      originator: payload.originator,
      cliVersion: payload.cli_version,
      modelProvider: payload.model_provider,
      source: payload.thread_source ?? payload.source,
    }
  }

  private onTurnContext(payload: TurnContextPayload): void {
    if (!this.state.session) {
      return
    }
    this.state.session.turnId = payload.turn_id
    this.state.session.cwd = payload.cwd ?? this.state.session.cwd
    this.state.session.workspaceRoots = payload.workspace_roots ?? this.state.session.workspaceRoots
    this.state.session.model = payload.model
      ?? payload.collaboration_mode?.settings?.model
      ?? this.state.session.model
    this.state.session.reasoningEffort = payload.effort
      ?? payload.reasoning_effort
      ?? payload.collaboration_mode?.settings?.reasoning_effort
      ?? this.state.session.reasoningEffort
    this.state.session.collaborationMode = payload.collaboration_mode?.mode
    this.state.session.approvalPolicy = policyLabel(payload.approval_policy)
    this.state.session.sandboxMode = policyLabel(payload.sandbox_policy)
    this.state.session.permissionProfile = policyLabel(payload.permission_profile)
  }

  private onResponseItem(payload: ResponseItemPayload, timestamp: Date): void {
    if ((payload.type === 'function_call' || payload.type === 'custom_tool_call') && payload.name) {
      const id = payload.call_id ?? payload.id ?? `${payload.name}-${timestamp.getTime()}`
      const tool: ToolEntry = {
        id,
        name: displayToolName(payload),
        target: toolTarget(payload),
        status: 'running',
        startTime: timestamp,
      }
      this.runningTools.set(id, tool)
      this.state.tools.push(tool)
      this.state.tools = this.state.tools.slice(-MAX_RECENT_TOOLS)
      if (tool.name === 'Skill' && tool.target) {
        this.state.skills = Array.from(new Set([...this.state.skills, tool.target]))
      }
      const mcp = /^mcp__(.+?)__/.exec(tool.name)?.[1]
      if (mcp) {
        this.state.mcpServers = Array.from(new Set([...this.state.mcpServers, mcp]))
      }
      return
    }

    if ((payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') && payload.call_id) {
      const running = this.runningTools.get(payload.call_id)
      if (!running) {
        return
      }
      running.status = isErrorOutput(payload.output) ? 'error' : 'completed'
      running.endTime = timestamp
      running.durationMs = Math.max(0, timestamp.getTime() - running.startTime.getTime())
      this.runningTools.delete(payload.call_id)
      return
    }

    if (payload.type === 'message' && payload.role === 'assistant' && this.state.session) {
      this.state.session.lastResponseAt = timestamp
    }
  }

  private onEvent(payload: EventMessagePayload, timestamp: Date): void {
    if (payload.type === 'user_message' && typeof payload.message === 'string') {
      const userMessage = payload.message.trim()
      if (userMessage) {
        const turnId = payload.turn_id ?? this.state.session?.turnId
        this.state.conversationTurns.push({
          id: turnId ?? `turn-${String(this.state.conversationTurns.length + 1)}`,
          turnId,
          startedAt: timestamp,
          userMessage,
          assistantMessage: '',
        })
      }
      return
    }
    if (payload.type === 'agent_message' && typeof payload.message === 'string') {
      const turn = this.state.conversationTurns.at(-1)
      const message = payload.message.trim()
      if (!turn || !message) {
        return
      }
      if (payload.phase === 'final_answer') {
        turn.assistantMessage = message
        turn.assistantPhase = payload.phase
      }
      else if (turn.assistantPhase !== 'final_answer') {
        turn.assistantMessage = turn.assistantMessage
          ? `${turn.assistantMessage}\n\n${message}`
          : message
        turn.assistantPhase = payload.phase
      }
      return
    }
    if (payload.type === 'token_count') {
      this.latestTokenUsage = payload.info ?? this.latestTokenUsage
      this.state.context = calculateContextUsage(
        this.latestTokenUsage?.last_token_usage,
        this.latestTokenUsage?.model_context_window,
      )
      this.state.sessionTokens = toSessionTokens(this.latestTokenUsage?.total_token_usage)
      this.state.usage = normalizeRateLimits(payload.rate_limits) ?? this.state.usage
      return
    }
    if (payload.type === 'plan_update') {
      this.state.todos = normalizePlan(payload.plan)
      return
    }
    if (payload.type === 'thread_goal_updated') {
      this.state.goal = normalizeGoal(payload.goal)
      return
    }
    if (payload.type === 'context_compacted') {
      this.state.compactCount += 1
      return
    }
    if (!this.state.session) {
      return
    }
    if (payload.type === 'task_started') {
      this.state.session.lastTurnStartedAt = safeDate(payload.started_at, timestamp)
      if (typeof payload.model_context_window === 'number') {
        this.latestTokenUsage = {
          total_token_usage: this.latestTokenUsage?.total_token_usage ?? {},
          last_token_usage: this.latestTokenUsage?.last_token_usage ?? {},
          model_context_window: payload.model_context_window,
        }
      }
      return
    }
    if (payload.type === 'task_complete' || payload.type === 'turn_aborted') {
      this.state.session.lastTurnCompletedAt = safeDate(payload.completed_at, timestamp)
      this.state.session.lastTurnDurationMs = typeof payload.duration_ms === 'number' ? payload.duration_ms : undefined
      this.state.session.timeToFirstTokenMs = typeof payload.time_to_first_token_ms === 'number'
        ? payload.time_to_first_token_ms
        : undefined
      const outputTokens = this.latestTokenUsage?.last_token_usage?.output_tokens
      const generationMs = (this.state.session.lastTurnDurationMs ?? 0) - (this.state.session.timeToFirstTokenMs ?? 0)
      const outputSpeed = typeof outputTokens === 'number' && outputTokens >= 0 && generationMs > 0
        ? outputTokens / (generationMs / 1000)
        : undefined
      this.state.session.outputTokensPerSecond = outputSpeed !== undefined && outputSpeed <= 2_000
        ? outputSpeed
        : undefined
    }
  }
}

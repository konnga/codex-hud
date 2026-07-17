export type RolloutEntryType
  = | 'session_meta'
    | 'turn_context'
    | 'response_item'
    | 'event_msg'
    | 'world_state'

export interface RolloutEntry<T = unknown> {
  timestamp: string
  type: RolloutEntryType | string
  payload: T
}

export interface SessionMetaPayload {
  id?: string
  session_id?: string
  timestamp?: string
  cwd?: string
  originator?: string
  cli_version?: string
  source?: SessionSource
  thread_source?: SessionSource
  model_provider?: string
  forked_from_id?: string
  parent_thread_id?: string
  agent_path?: string
  context_window?: Record<string, unknown>
  git?: {
    commit_hash?: string
    branch?: string
    repository_url?: string
  }
}

export type SessionSource
  = | string
    | {
      custom?: string
      internal?: unknown
      subagent?: SubagentSource
      thread_spawn?: ThreadSpawnSource
    }

export interface ThreadSpawnSource {
  parent_thread_id?: string
  depth?: number
  agent_path?: string
  agent_nickname?: string
  agent_role?: string
}

export type SubagentSource
  = | string
    | ThreadSpawnSource
    | { thread_spawn?: ThreadSpawnSource }

export interface TurnContextPayload {
  turn_id?: string
  cwd?: string
  workspace_roots?: string[]
  approval_policy?: string | Record<string, unknown>
  sandbox_policy?: string | { type?: string, [key: string]: unknown }
  permission_profile?: string | Record<string, unknown> | null
  model?: string
  effort?: string
  reasoning_effort?: string
  collaboration_mode?: {
    mode?: string
    settings?: {
      model?: string
      reasoning_effort?: string
      [key: string]: unknown
    }
  }
}

export interface ResponseItemPayload {
  type?: string
  id?: string
  call_id?: string
  name?: string
  arguments?: string
  input?: string
  output?: unknown
  status?: string
  role?: string
  content?: unknown
  phase?: string
}

export interface EventMessagePayload {
  type?: string
  turn_id?: string
  started_at?: string
  completed_at?: string
  duration_ms?: number
  time_to_first_token_ms?: number
  model_context_window?: number
  info?: TokenUsageInfo
  rate_limits?: RawRateLimits | null
  plan?: RawPlanStep[]
  explanation?: string
  goal?: unknown
  threadId?: string
  reason?: string
  thread_settings?: Record<string, unknown>
  [key: string]: unknown
}

export interface TokenUsage {
  input_tokens?: number
  cached_input_tokens?: number
  cache_write_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
}

export interface TokenUsageInfo {
  total_token_usage?: TokenUsage
  last_token_usage?: TokenUsage
  model_context_window?: number
}

export interface RawPlanStep {
  step?: string
  status?: string
}

export interface RawRateLimitWindow {
  used_percent?: number | null
  used_percentage?: number | null
  utilization?: number | null
  resets_at?: string | number | null
  reset_at?: string | number | null
  window_minutes?: number | null
  [key: string]: unknown
}

export interface RawRateLimits {
  limit_id?: string | null
  limit_name?: string | null
  primary?: RawRateLimitWindow | null
  secondary?: RawRateLimitWindow | null
  credits?: Record<string, unknown> | null
  individual_limit?: RawRateLimitWindow | null
  spend_control_reached?: boolean | null
  plan_type?: string | null
  rate_limit_reached_type?: string | null
  [key: string]: unknown
}

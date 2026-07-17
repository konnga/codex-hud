import type { TokenUsage } from '../types/rollout.js'
import type { ContextUsage } from '../types/state.js'

export const BASELINE_TOKENS = 12_000

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function calculateContextUsage(
  usage: TokenUsage | null | undefined,
  contextWindow: number | null | undefined,
): ContextUsage | null {
  if (!usage || !contextWindow || contextWindow <= 0) {
    return null
  }

  const rawUsed = Math.max(0, usage.total_tokens ?? 0)
  let used: number
  let total: number

  if (contextWindow <= BASELINE_TOKENS) {
    total = contextWindow
    used = clamp(rawUsed, 0, total)
  }
  else {
    total = contextWindow - BASELINE_TOKENS
    used = clamp(rawUsed - BASELINE_TOKENS, 0, total)
  }

  const percent = total > 0 ? Math.round((used / total) * 100) : 0
  return {
    used,
    total,
    percent: clamp(percent, 0, 100),
    remainingPercent: clamp(100 - percent, 0, 100),
    inputTokens: Math.max(0, (usage.input_tokens ?? 0) - (usage.cached_input_tokens ?? 0)),
    outputTokens: Math.max(0, usage.output_tokens ?? 0),
    cachedTokens: Math.max(0, usage.cached_input_tokens ?? 0),
  }
}

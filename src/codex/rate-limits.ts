import type { RawRateLimits, RawRateLimitWindow } from '../types/rollout.js'
import type { UsageData, UsageWindow } from '../types/state.js'

function numberValue(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }
  return null
}

function resetDate(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000
    const date = new Date(milliseconds)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value === 'string' && value) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

function labelForWindow(window: RawRateLimitWindow, fallback: string): string {
  const minutes = numberValue(window.window_minutes)
  if (minutes === null) {
    return fallback
  }
  if (minutes % 10_080 === 0) {
    return `${minutes / 10_080}w`
  }
  if (minutes % 1_440 === 0) {
    return `${minutes / 1_440}d`
  }
  if (minutes % 60 === 0) {
    return `${minutes / 60}h`
  }
  return `${minutes}m`
}

function normalizeWindow(
  value: unknown,
  fallbackLabel: string,
  individual = false,
): UsageWindow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const window = value as RawRateLimitWindow & {
    remaining_percent?: number
  }
  const rawPercent = individual
    ? numberValue(
        typeof window.remaining_percent === 'number' ? 100 - window.remaining_percent : null,
        window.used_percent,
        window.used_percentage,
        window.utilization,
      )
    : numberValue(window.used_percent, window.used_percentage, window.utilization)
  const percent = rawPercent === null ? null : Math.min(100, Math.max(0, rawPercent))
  return {
    label: labelForWindow(window, fallbackLabel),
    percent,
    resetAt: resetDate(window.resets_at ?? window.reset_at),
    windowMinutes: numberValue(window.window_minutes),
  }
}

export function normalizeRateLimits(raw: RawRateLimits | null | undefined): UsageData | null {
  if (!raw) {
    return null
  }
  const credits = raw.credits && typeof raw.credits === 'object' ? raw.credits : null
  const balance = credits && typeof credits.balance === 'string' ? credits.balance : null
  return {
    primary: normalizeWindow(raw.primary, '5h'),
    secondary: normalizeWindow(raw.secondary, '7d'),
    individual: normalizeWindow(raw.individual_limit, 'spend', true),
    planType: typeof raw.plan_type === 'string' ? raw.plan_type : null,
    balanceLabel: balance,
    limitReachedType: typeof raw.rate_limit_reached_type === 'string'
      ? raw.rate_limit_reached_type
      : raw.spend_control_reached === true ? 'spend_control_reached' : null,
  }
}

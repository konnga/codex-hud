import type { RenderContext } from '../types/render.js'
import type { UsageWindow } from '../types/state.js'
import { color } from './colors.js'
import { formatResetTime, progressBar } from './format.js'
import { message } from './i18n.js'

function renderWindow(ctx: RenderContext, window: UsageWindow): string | null {
  if (window.percent === null) {
    return null
  }
  const value = ctx.config.display.usageValue === 'remaining'
    ? 100 - window.percent
    : window.percent
  const suffix = ctx.config.display.usageValue === 'remaining' ? '% left' : '%'
  const bar = ctx.config.display.usageBarEnabled && !ctx.config.display.usageCompact
    ? `${progressBar(window.percent, 10, ctx.config.colors.barFilled, ctx.config.colors.barEmpty)} `
    : ''
  const reset = formatResetTime(window.resetAt, ctx.now, ctx.config.display.timeFormat, window.windowMinutes)
  const resetText = reset
    ? ` (${ctx.config.display.showResetLabel ? `${message(ctx.config.language, 'resetsIn')} ` : ''}${reset})`
    : ''
  return `${window.label}: ${bar}${value}${suffix}${resetText}`
}

export function renderUsageLine(ctx: RenderContext): string | null {
  if (!ctx.config.display.showUsage || !ctx.state.usage) {
    return null
  }
  const usage = ctx.state.usage
  const effectiveUsage = Math.max(
    usage.primary?.percent ?? 0,
    usage.secondary?.percent ?? 0,
    usage.individual?.percent ?? 0,
  )
  if (effectiveUsage < ctx.config.display.usageThreshold) {
    return usage.balanceLabel
      ? color(`${message(ctx.config.language, 'usage')} ${usage.balanceLabel}`, ctx.config.colors.usage, ctx.options.color)
      : null
  }
  const secondary = usage.secondary && (!usage.primary || (usage.secondary.percent ?? 0) >= ctx.config.display.sevenDayThreshold)
    ? usage.secondary
    : null
  const windows = [usage.primary, secondary, usage.individual]
    .flatMap(window => window ? [renderWindow(ctx, window)] : [])
    .filter((value): value is string => Boolean(value))
  if (usage.balanceLabel) {
    windows.push(usage.balanceLabel)
  }
  if (windows.length === 0) {
    return null
  }
  const maxPercent = Math.max(
    usage.primary?.percent ?? 0,
    usage.secondary?.percent ?? 0,
    usage.individual?.percent ?? 0,
  )
  const selectedColor = maxPercent >= 100
    ? ctx.config.colors.critical
    : maxPercent >= 80 ? ctx.config.colors.usageWarning : ctx.config.colors.usage
  return color(`${message(ctx.config.language, 'usage')} ${windows.join(' │ ')}`, selectedColor, ctx.options.color)
}

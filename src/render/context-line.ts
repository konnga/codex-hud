import type { RenderContext } from '../types/render.js'
import { color, statusColor } from './colors.js'
import { formatTokens, progressBar } from './format.js'
import { message } from './i18n.js'

export function renderContextLine(ctx: RenderContext): string | null {
  const rawContext = ctx.state.context
  if (!rawContext) {
    return null
  }
  const config = ctx.config.display
  const effectiveTotal = config.autoCompactWindow
    ? Math.max(1, config.autoCompactWindow - 12_000)
    : rawContext.total
  const effectiveUsed = Math.min(effectiveTotal, rawContext.used)
  const effectivePercent = Math.min(100, Math.max(0, Math.round((effectiveUsed / effectiveTotal) * 100)))
  const context = {
    ...rawContext,
    used: effectiveUsed,
    total: effectiveTotal,
    percent: effectivePercent,
    remainingPercent: 100 - effectivePercent,
  }
  const selectedColor = statusColor(
    context.percent,
    ctx.config.colors.context,
    ctx.config.colors.warning,
    ctx.config.colors.critical,
    config.contextWarningThreshold,
    config.contextCriticalThreshold,
  )
  const parts = [message(ctx.config.language, 'context')]
  if (config.showContextBar) {
    parts.push(progressBar(context.percent, 10, ctx.config.colors.barFilled, ctx.config.colors.barEmpty))
  }
  if (config.contextValue === 'tokens') {
    parts.push(`${formatTokens(context.used)}/${formatTokens(context.total)}`)
  }
  else if (config.contextValue === 'remaining') {
    parts.push(`${context.remainingPercent}% left`)
  }
  else if (config.contextValue === 'both') {
    parts.push(`${context.percent}% (${formatTokens(context.used)}/${formatTokens(context.total)})`)
  }
  else {
    parts.push(`${context.percent}%`)
  }
  if (config.showTokenBreakdown && context.percent >= config.contextCriticalThreshold) {
    parts.push(`in ${formatTokens(context.inputTokens)} cache ${formatTokens(context.cachedTokens)} out ${formatTokens(context.outputTokens)}`)
  }
  return color(parts.join(' '), selectedColor, ctx.options.color)
}
